/**
 * `rafa docs plan`: one plan written from the open lines of the
 * release's stale-docs issues, a task for `doc-updater` per line, to be
 * run before a release. It starts no session and so declares no
 * `spends`: the plan is rendered in code from what the tracker holds.
 *
 * ## What is read
 *
 * The config that resolves for the project, once: `plan.dir` for where
 * the plan goes, and `tracker.default` and `tracker.fallback` for the
 * chain (`adapters/tracker/resolve.ts`), which lands on the first kind
 * whose preflight passes, each kind passed over warned about. Then the
 * open lines, through `readOpenStaleDocLines` (`src/docs/open-lines.ts`):
 * every unticked checklist item of every open `chore` issue whose body
 * holds the stale-docs marker, issue by issue in listing order, so a
 * forecast that shifted between two runs, and opened a second issue,
 * loses no line.
 *
 * ## What is written
 *
 * `<plan.dir>/PLAN-rafa-<n>-doc-update.md`, `<n>` the oldest issue an
 * open line came from: the lowest issue number among them, since both
 * the `github` and the `local` tracker number issues in the order they
 * were created. Its text is {@link renderDocUpdatePlan}'s:
 *
 *     # Plan: chore(doc-update)
 *
 *     ```rafa:plan
 *     stub: rafa-<n>-doc-update
 *     issue: "<n>"
 *     release: none
 *     ```
 *
 *     # Stage: Stale doc lines
 *
 *     - [ ] Repair the stale doc line at <where>: <what>  {agent=doc-updater}
 *
 *     <!-- ralph:plan=rafa-<n>-doc-update -->
 *
 * One task line per open line, in reading order. Every task is declared
 * `agent=doc-updater` and none `docs=repair`, so the plan is prose only
 * and takes no closing doc task (`packages/rafa/src/plan/doc-task.ts`).
 *
 * ## A line is untrusted text
 *
 * An issue line was written by a session or a person. Each is escaped
 * with `escapeBlockerText` (`utils/tracker.ts`), as a blocker comment is:
 * a line feed, a carriage return, U+2028, U+2029 and every other control
 * character but the tab are written as an escape, so no line opens a
 * second task line, a heading, a stage or a fence; and `<!--` and `-->`
 * are broken, so no line opens or closes a comment, the blocker comment
 * and the plan stamp included. The declaration is the line's trailing
 * brace group (`core/plan/declaration.ts`), and every task line ends on its
 * own `{agent=doc-updater}`, so a brace group a line holds stays in the
 * task's text and is never read as its declaration. The escaping is
 * `unescapeBlockerText`'s to reverse, which is how a line is found again
 * in its issue.
 *
 * ## Refusals
 *
 * Each is a `CommandExit` with exit code 1 and writes nothing: a word on
 * the line, a config `loadConfig` refuses, a chain landing nowhere, a
 * tracker that cannot list its open issues or whose listing failed, no
 * open line, an issue number no plan stub can carry, and a plan file
 * already at the path, which is never overwritten: run or remove it
 * first.
 *
 * ## Output
 *
 * Text mode prints the path written and how many tasks it holds from
 * how many issues. With `--output=json` the terminal result's `data` is
 * a {@link DocsPlanResult}.
 */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { PlansDir } from '@open-tomato/rafa/core/plan';
import type { Tracker } from '@open-tomato/rafa/ports';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { IssueSeams } from '@open-tomato/rafa-board';
import type { OpenStaleDocLine } from '@open-tomato/rafa-pr';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_ISSUE_SEAMS, resolveTracker } from '@open-tomato/rafa-board';
import {
  DOC_UPDATE_TASK_PREFIX,
  DOC_UPDATE_TITLE,
  readOpenStaleDocLines,
} from '@open-tomato/rafa-pr';

import { expectNoArgument, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { plansDirAt , isStampableStub, planStampLine , escapeBlockerText } from '@open-tomato/rafa/core/plan';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa docs plan';

// The title and task prefix live beside the tick that reads them back (`docs/release-issue.ts`).
export { DOC_UPDATE_TASK_PREFIX, DOC_UPDATE_TITLE };

/** The usage line a refusal names. */
export const DOCS_PLAN_USAGE = 'rafa docs plan';

/** The name of the one stage a doc-update plan holds. */
export const DOC_UPDATE_STAGE = 'Stale doc lines';

/** The declaration every task line ends on. */
export const DOC_UPDATE_DECLARATION = '{agent=doc-updater}';

/** The stub of the doc-update plan for issue `issue`. */
export function docUpdateStub(issue: string): string {
  return `rafa-${issue}-doc-update`;
}

/** The file name of the plan stubbed `stub`. */
export function docUpdatePlanFileName(stub: string): string {
  return `PLAN-${stub}.md`;
}

/** The task line for one open line's text, escaped; see the module note. */
export function docUpdateTaskLine(text: string): string {
  return `- [ ] ${DOC_UPDATE_TASK_PREFIX}${escapeBlockerText(text)}  ${DOC_UPDATE_DECLARATION}`;
}

/** What {@link renderDocUpdatePlan} renders. */
export interface DocUpdatePlanInput {
  /** The issue the plan names, the oldest an open line came from. */
  readonly issue: string;
  /** Each open line's text, `<where>: <what>` or `<what>`, as its issue holds it. */
  readonly lines: readonly string[];
}

/**
 * The plan's text for `input`; see the module note. Pure: it reads
 * nothing and writes nothing. Throws for an issue no plan stub can
 * carry, which the command refuses before calling it.
 */
export function renderDocUpdatePlan(input: DocUpdatePlanInput): string {
  const stub = docUpdateStub(input.issue);
  return [
    `# Plan: ${DOC_UPDATE_TITLE}`,
    '',
    '```rafa:plan',
    `stub: ${stub}`,
    `issue: ${JSON.stringify(input.issue)}`,
    'release: none',
    '```',
    '',
    `# Stage: ${DOC_UPDATE_STAGE}`,
    '',
    ...input.lines.map(docUpdateTaskLine),
    '',
    planStampLine(stub),
    '',
  ].join('\n');
}

/** An issue number, or null for an id that reads as none. */
function issueNumber(id: string): number | null {
  return /^\d+$/.test(id)
    ? Number(id)
    : null;
}

/**
 * The oldest issue `lines` came from: the lowest issue number, and the
 * first in reading order where an id is no number. `lines` is not empty.
 */
export function oldestIssue(lines: readonly OpenStaleDocLine[]): string {
  const ids = [...new Set(lines.map((line) => line.ref.externalId))];
  const numbered = ids.filter((id) => issueNumber(id) !== null)
    .sort((a, b) => (issueNumber(a) ?? 0) - (issueNumber(b) ?? 0));
  return numbered[0] ?? ids[0] ?? '';
}

/** What json mode gives as the terminal result's `data`. */
export interface DocsPlanResult {
  /** The plan file written, as `plan.dir` spells its directory. */
  readonly path: string;
  /** The plan's stub. */
  readonly stub: string;
  /** The issue the plan names. */
  readonly issue: string;
  /** How many task lines it holds, one per open line. */
  readonly tasks: number;
  /** The issues the open lines came from, in reading order. */
  readonly issues: readonly string[];
}

/** A refusal with exit code 1 naming the command. */
function refusal(problem: string): CommandExit {
  return new CommandExit(1, `❌ ${COMMAND_NAME}: ${problem}`);
}

/** The tracker the chain lands on for `project`; a refusal for a chain landing nowhere. */
async function landTracker(config: RafaConfig, project: ProjectFound, seams: IssueSeams): Promise<Tracker> {
  try {
    const resolution = await resolveTracker({
      config,
      context: { repoRoot: project.root, gh: seams.gh },
      registry: seams.registry,
    });
    return resolution.tracker;
  } catch (error) {
    throw refusal(`no tracker can be read: ${messageOf(error)}`);
  }
}

/** The open lines, and where plans sit; a refusal for each way of reading none. */
async function readLines(context: RafaContext, seams: IssueSeams): Promise<{
  readonly lines: readonly OpenStaleDocLine[];
  readonly plansDir: PlansDir;
}> {
  const project = requireProject(context, COMMAND_NAME);
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const tracker = await landTracker(config, project, seams);

  const reading = await readOpenStaleDocLines(tracker);
  if (reading.problem !== null) throw refusal(`the stale-docs issues cannot be read: ${reading.problem}`);
  if (reading.count === 0) throw refusal('no stale-docs line is open, so there is nothing to plan');
  return { lines: reading.lines, plansDir: plansDirAt(project.root, config.planDir) };
}

/** True when `error` is a file system error of `code`. */
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Writes the doc-update plan; see the module note. */
export async function writeDocsPlan(context: RafaContext, seams: IssueSeams): Promise<DocsPlanResult> {
  expectNoArgument(context.args, DOCS_PLAN_USAGE);
  const { lines, plansDir } = await readLines(context, seams);

  const issue = oldestIssue(lines);
  const stub = docUpdateStub(issue);
  if (!isStampableStub(stub)) throw refusal(`issue ${JSON.stringify(issue)} cannot name a plan stub`);

  const fileName = docUpdatePlanFileName(stub);
  const path = join(plansDir.label, fileName);
  const text = renderDocUpdatePlan({ issue, lines: lines.map((line) => line.text) });
  try {
    mkdirSync(plansDir.path, { recursive: true });
    writeFileSync(join(plansDir.path, fileName), text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (hasCode(error, 'EEXIST')) throw refusal(`${path} already exists; run or remove it first`);
    throw refusal(`${path} could not be written: ${messageOf(error)}`);
  }

  const issues = [...new Set(lines.map((line) => line.ref.externalId))];
  return { path, stub, issue, tasks: lines.length, issues };
}

/** The line text mode prints for `result`. */
export function docsPlanLine(result: DocsPlanResult): string {
  const tasks = result.tasks === 1
    ? '1 task'
    : `${result.tasks} tasks`;
  const issues = result.issues.length === 1
    ? '1 issue'
    : `${result.issues.length} issues`;
  return `Wrote ${result.path}: ${tasks} from ${issues}.`;
}

/** The command, resolving the chain with `seams`; see the module note. */
export function createDocsPlanCommand(seams: IssueSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'docs plan',
    subject: 'docs',
    action: 'plan',
    summary: 'write a plan repairing every open line of the stale-docs issues, one doc-updater task each',
    description: 'Reads every open chore issue holding the stale-docs marker on the tracker the chain lands on,'
      + ' and writes `<plan.dir>/PLAN-rafa-<n>-doc-update.md`, titled `chore(doc-update)`, `<n>` the oldest'
      + ' such issue: one `{agent=doc-updater}` task per unticked line, each line escaped so it opens no'
      + ' second task, fence or declaration. It starts no session. It refuses, writing nothing, when the plan'
      + ' file exists, when no line is open, and when no tracker can be read. With `--output=json` the path,'
      + ' the stub, the issue and the counts are the data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa docs plan',
        note: 'Writes the doc-update plan from the open stale-docs lines, then prints its path and task count.',
      },
      {
        cmd: 'rafa docs plan --output=json',
        note: 'Writes a start event, then a result event whose data holds the path, the stub and the counts.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await writeDocsPlan(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(docsPlanLine(result));
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createDocsPlanCommand();
export default command;
