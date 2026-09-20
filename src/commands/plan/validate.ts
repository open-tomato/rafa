/**
 * `rafa plan validate <file>`: a plan file read by `parsePlan`, every
 * issue the parser reports written out, and exit code 1 when there is
 * one.
 *
 * ## What is read
 *
 * The one file the line names, resolved against the working directory as
 * a shell completes it, wherever it sits: the command reads no config and
 * no repository, though the dispatcher runs it only inside a project, as
 * it runs every command but `module exec`, `init` and `describe`. It reads that file and
 * nothing else, and starts no
 * Claude Code session: `validate.test.ts` runs it with a stand-in `claude`
 * first on the PATH and finds the stand-in never called, where
 * `rafa plan create` under the same planting calls it.
 *
 * What is checked is what `parsePlan` reports in `PlanModel.issues`, each
 * issue carrying one `PlanIssueReason`. A task declaration's own issues
 * sit on the task, in `TaskDeclaration.issues`, not in that list, and are
 * not checked here.
 *
 * ## The agent roster
 *
 * Beside the parser's issues, the command checks the `agent=` of every
 * still-to-run task against the agents a session would resolve
 * (`agents/roster.ts`), which is the check `loop start`'s preflight
 * halts on (`start/preflight.ts`): a name no loaded scope defines stops
 * that task's dispatch with exit code 1 before any model call, so a plan
 * carrying one does not run however well it parses.
 *
 * The tasks checked are the ones the DISPATCHER will reach rather than
 * the ones the model holds, so a task line a `rafa:*` block the plan
 * never closed hides is checked as well, against the line it sits on.
 * Such a line is no task of the model — it is reported as a
 * `task-in-block` issue, and counted under none of the checkboxes
 * `tasks` counts — while `findNextTask` dispatches it all the same.
 *
 * The roster is resolved against the project the dispatcher found from
 * the working directory and the config that resolves there, whose
 * `loop.settingSources` decides whether `~/.claude/agents` is in reach.
 * A config `loadConfig` refuses is refused with exit code 1. Handed no
 * project, the command says so and checks no agent, since it needs no
 * repository to read a plan; that is why the check is the command's and
 * not `validatePlan`'s, which reads one file and nothing else.
 *
 * ## What it writes
 *
 * With nothing to report, json mode gives the terminal result `data`:
 * `file` (absolute), the number of `stages`, the task counts under
 * `tasks`, an empty `issues` and an empty `missingAgents`. Text mode
 * writes one line naming the file as typed, its stages and its counts.
 *
 * With issues, each is written at `error`, in line order, as
 * `<file>:<line>: <reason>: <text>`, with the file as typed and the line
 * counting from one: a `log` event in json mode, an `error: ` line on
 * stdout in text mode. Each missing agent follows them, at `error` too,
 * as `<file>: <the line `missingAgentLine` words>`, which names the
 * agent, the task lines that asked for it and the command that would fix
 * it or that no user definition carries the name. The command then
 * throws `CommandExit` with exit code 1 and a message counting what it
 * found, which text mode writes to stderr and json mode carries in the
 * terminal result.
 *
 * A line naming no file or more than one, and a path that is no file,
 * are refused with exit code 1 before anything is parsed.
 */
import type { TaskCounts } from './plan-files.js';
import type { MissingAgent } from '../../agents/roster.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { PlanIssue } from '../../plan/index.js';
import type { ProjectFound } from '../../project/scope.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { missingAgentLine, missingPlanAgents, resolveAgentRoster } from '../../agents/roster.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { ConfigError } from '../../config.js';
import { parsePlan } from '../../plan/index.js';

import { countTasks, expectOneArgument, formatCounts, isFile, issueLine, plural } from './plan-files.js';

/** The usage line a refusal names. */
const USAGE = 'rafa plan validate <file>';

/** Answers the directory a typed path is resolved against: the process's, unless a test hands another. */
export type WorkingDirectory = () => string;

/** A plan file read; see the module note. */
export interface PlanValidation {
  /** The file read, absolute. */
  readonly file: string;
  /** How many `# Stage:` headings it holds. */
  readonly stages: number;
  /** Its tasks, counted by checkbox. */
  readonly tasks: TaskCounts;
  /** Every issue `parsePlan` reported, in line order. */
  readonly issues: readonly PlanIssue[];
}

/** A plan file read, with the agents of its still-to-run tasks checked. */
export interface PlanValidationResult extends PlanValidation {
  /** Every `agent=` no loaded scope defines, each with its fix; empty when no project was found. */
  readonly missingAgents: readonly MissingAgent[];
}

/** The plan at the absolute path `file`, read, or a refusal with exit code 1 when it is no file. */
export function validatePlan(file: string): PlanValidation {
  if (!isFile(file)) throw new CommandExit(1, `❌ Plan file not found: ${file}`);
  const model = parsePlan(readFileSync(file, 'utf8'));
  return { file, stages: model.stages.length, tasks: countTasks(model.tasks), issues: model.issues };
}

/** The config as it resolves for the project, refusing one `loadConfig` refuses. */
function resolvedConfig(project: ProjectFound, warn: (message: string) => void): RafaConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      '❌ rafa plan validate: the config cannot be used:',
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

/**
 * The `agent=` of the plan's still-to-run tasks that no scope the project
 * loads defines. None, with one line saying so, when the command was
 * handed no project; see the module note.
 */
function checkAgents(context: RafaContext, markdown: string): readonly MissingAgent[] {
  const project = context.project;
  if (project === null) {
    context.output.info('ℹ️  No project was found from the working directory, so no `agent=` was checked.');
    return [];
  }

  const { settingSources } = resolvedConfig(project, (message) => {
    context.output.warn(message);
  });
  const roots = { repoRoot: project.root, home: project.home };
  return missingPlanAgents(markdown, resolveAgentRoster(roots, settingSources));
}

/** The refusal a plan with issues, missing agents or both ends with. */
function refusalFor(typed: string, issues: number, agents: number): string {
  const counts = [
    issues > 0
      ? plural(issues, 'issue')
      : null,
    agents > 0
      ? plural(agents, 'unresolvable agent')
      : null,
  ].filter((count): count is string => count !== null);
  const tail = issues > 0
    ? 'the plan does not read as written'
    : 'no session would be dispatched';
  return `❌ ${typed}: ${counts.join(', ')}; ${tail}`;
}

/** The command, resolving the typed path against `workingDirectory`; see the module note. */
export function createPlanValidateCommand(workingDirectory: WorkingDirectory = () => process.cwd()): RafaCommand {
  const command: RafaCommand = {
    name: 'plan validate',
    subject: 'plan',
    action: 'validate',
    summary: 'check that a plan file reads as written and routes to agents that resolve, starting no session',
    description: 'Reads one plan file with the plan parser, the rafa:* blocks and the checklist, and starts'
      + ' no session. When the parser reads the whole file as written, and every `agent=` of its'
      + ' still-to-run tasks resolves for a session spawned under `loop.settingSources`, it prints the'
      + ' stages and the tasks counted by checkbox. Otherwise it writes every issue the parser reported as'
      + ' an error line naming the file, the line and the reason, then one line per agent no loaded scope'
      + ' defines with the `rafa agent vendor` command that would fix it, then exits 1 — the same check'
      + ' `rafa loop start` halts on before it dispatches anything. The path is read relative to the'
      + ' working directory; the agents are read from the project found from it and the config that'
      + ' resolves there, and are left unchecked when there is no project. With `--output=json` each issue'
      + ' and each missing agent is an error log event, and a plan with neither is the data of the terminal'
      + ' result event.',
    args: [
      {
        name: 'file',
        description: 'The plan file to read, relative to the working directory.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa plan validate .plans/PLAN-my-feature.md',
        note: 'Prints one line when the plan reads as written, or one error line per issue and exits 1.',
      },
      {
        cmd: 'rafa plan validate .plans/PLAN-my-feature.md --output=json',
        note: 'Writes a start event, an error log event per issue, then a result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const typed = expectOneArgument(context.args, USAGE);
      const file = resolve(workingDirectory(), typed);
      const validation = validatePlan(file);
      const { issues, stages, tasks } = validation;
      const missingAgents = checkAgents(context, readFileSync(file, 'utf8'));
      const result: PlanValidationResult = { ...validation, missingAgents };
      if (issues.length > 0 || missingAgents.length > 0) {
        for (const issue of issues) context.output.error(issueLine(typed, issue));
        for (const agent of missingAgents) context.output.error(`${typed}: ${missingAgentLine(agent)}`);
        throw new CommandExit(1, refusalFor(typed, issues.length, missingAgents.length));
      }
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(`✅ ${typed}: no issues; ${plural(stages, 'stage')}, tasks ${formatCounts(tasks)}`);
    },
  };
  return Object.freeze(command);
}

export default createPlanValidateCommand();
