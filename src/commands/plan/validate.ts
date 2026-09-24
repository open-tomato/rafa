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
 * halts on (`start/preflight.ts`): a name no loaded tier serves — held
 * by no tier, switched off with `false`, held only by a tier the session
 * does not load, or held by two loaded tiers with different contents —
 * stops that task's dispatch with exit code 1 before any model call, or
 * would run it on a holder nobody chose, so a plan carrying one does not
 * run however well it parses.
 *
 * The `skills=` names of the same tasks are checked against the same
 * resolution: one two loaded tiers hold with different contents, with no
 * `tiers.skills` pin to choose, is served by nobody, and is reported with
 * both paths and the pin line that settles it. A skill name no tier holds
 * is not reported, since a skill may come from a plugin or an add-on
 * (`agents/roster.ts`).
 *
 * The tasks checked are the ones the DISPATCHER will reach rather than
 * the ones the model holds, so a task line a `rafa:*` block the plan
 * never closed hides is checked as well, against the line it sits on.
 * Such a line is no task of the model — it is reported as a
 * `task-in-block` issue, and counted under none of the checkboxes
 * `tasks` counts — while `findNextTask` dispatches it all the same.
 *
 * The roster is resolved against the project the dispatcher found from
 * the working directory and the config that resolves there: its
 * `loop.settingSources` decides whether `~/.claude/agents` is in reach,
 * `tiers.rafa` whether rafa's own tier is, and `tiers.agents` which
 * names are off or pinned, as `tiers.skills` decides for skills. The
 * rafa tier is the one beside the running entry.
 * A config `loadConfig` refuses is refused with exit code 1. Handed no
 * project, the command says so and checks no agent and no skill, since
 * it needs no repository to read a plan; that is why the check is the
 * command's and not `validatePlan`'s, which reads one file and nothing
 * else.
 *
 * ## What it writes
 *
 * With nothing to report, json mode gives the terminal result `data`:
 * `file` (absolute), the number of `stages`, the task counts under
 * `tasks`, an empty `issues`, an empty `missingAgents` and an empty
 * `skillCollisions`. Text mode
 * writes one line naming the file as typed, its stages and its counts.
 *
 * With issues, each is written at `error`, in line order, as
 * `<file>:<line>: <reason>: <text>`, with the file as typed and the line
 * counting from one: a `log` event in json mode, an `error: ` line on
 * stdout in text mode. Each missing agent follows them, at `error` too,
 * as `<file>: <the line `missingAgentLine` words>`, which names the
 * agent, the task lines that asked for it, why it cannot be dispatched,
 * and the pin line or setting that settles it. Each colliding skill
 * follows those, at `error`, as `<file>: <the line `skillCollisionLine`
 * words>`. The command then
 * throws `CommandExit` with exit code 1 and a message counting what it
 * found, which text mode writes to stderr and json mode carries in the
 * terminal result.
 *
 * A line naming no file or more than one, and a path that is no file,
 * are refused with exit code 1 before anything is parsed.
 */
import type { TaskCounts } from './plan-files.js';
import type { MissingAgent, SkillCollision } from '../../agents/roster.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { PlanIssue } from '../../plan/index.js';
import type { ProjectFound } from '../../project/scope.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collidingPlanSkills,
  missingAgentLine,
  missingPlanAgents,
  resolveAgentRoster,
  skillCollisionLine,
} from '../../agents/roster.js';
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

/** What the roster check of one plan found; see the module note. */
export interface RosterFindings {
  /** Every `agent=` no loaded tier serves, each with why; empty when no project was found. */
  readonly missingAgents: readonly MissingAgent[];
  /** Every `skills=` name two loaded tiers hold with different contents; empty when no project was found. */
  readonly skillCollisions: readonly SkillCollision[];
}

/** A plan file read, with the agents and skills of its still-to-run tasks checked. */
export interface PlanValidationResult extends PlanValidation, RosterFindings {}

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
 * The `agent=` of the plan's still-to-run tasks that no tier the project
 * loads serves, and the `skills=` names two loaded tiers hold with
 * different contents. None, with one line saying so, when the command
 * was handed no project; see the module note.
 */
function checkRoster(context: RafaContext, markdown: string): RosterFindings {
  const project = context.project;
  if (project === null) {
    context.output.info('ℹ️  No project was found from the working directory, so no `agent=` or `skills=` was checked.');
    return { missingAgents: [], skillCollisions: [] };
  }

  const config = resolvedConfig(project, (message) => {
    context.output.warn(message);
  });
  const roots = { repoRoot: project.root, home: project.home };
  const roster = resolveAgentRoster(roots, config);
  return {
    missingAgents: missingPlanAgents(markdown, roster),
    skillCollisions: collidingPlanSkills(markdown, roster),
  };
}

/** The refusal a plan with issues, missing agents, colliding skills or any mix ends with. */
function refusalFor(typed: string, issues: number, agents: number, skills: number): string {
  const counts = [
    issues > 0
      ? plural(issues, 'issue')
      : null,
    agents > 0
      ? plural(agents, 'unresolvable agent')
      : null,
    skills > 0
      ? plural(skills, 'skill collision')
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
    summary: 'check that a plan file reads as written and routes to agents and skills that resolve, starting no session',
    description: 'Reads one plan file with the plan parser, the rafa:* blocks and the checklist, and starts'
      + ' no session. When the parser reads the whole file as written, and every `agent=` of its'
      + ' still-to-run tasks resolves for a session spawned under `loop.settingSources`, `tiers.rafa` and'
      + ' `tiers.agents`, it prints the stages and the tasks counted by checkbox. Otherwise it writes every'
      + ' issue the parser reported as an error line naming the file, the line and the reason, then one'
      + ' line per agent no loaded tier serves, saying why (held by no tier, switched off, held only by a'
      + ' tier the session does not load, or held by two tiers with different contents) and naming the'
      + ' paths and the pin line or setting that settles it, then one line per `skills=` name two loaded'
      + ' tiers hold with different contents, naming both paths and the `tiers.skills` pin line that'
      + ' settles it, then exits 1 — the same check'
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
        cmd: 'rafa plan validate .rafa/plans/PLAN-my-feature.md',
        note: 'Prints one line when the plan reads as written, or one error line per issue and exits 1.',
      },
      {
        cmd: 'rafa plan validate .rafa/plans/PLAN-my-feature.md --output=json',
        note: 'Writes a start event, an error log event per issue, then a result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const typed = expectOneArgument(context.args, USAGE);
      const file = resolve(workingDirectory(), typed);
      const validation = validatePlan(file);
      const { issues, stages, tasks } = validation;
      const { missingAgents, skillCollisions } = checkRoster(context, readFileSync(file, 'utf8'));
      const result: PlanValidationResult = { ...validation, missingAgents, skillCollisions };
      if (issues.length > 0 || missingAgents.length > 0 || skillCollisions.length > 0) {
        for (const issue of issues) context.output.error(issueLine(typed, issue));
        for (const agent of missingAgents) context.output.error(`${typed}: ${missingAgentLine(agent)}`);
        for (const skill of skillCollisions) context.output.error(`${typed}: ${skillCollisionLine(skill)}`);
        throw new CommandExit(1, refusalFor(typed, issues.length, missingAgents.length, skillCollisions.length));
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
