/**
 * `rafa plan validate <file>`: a plan file read by `parsePlan`, every
 * issue the parser reports written out, and exit code 1 when there is
 * one. This is the command half: the command, its roster check, its
 * effort-store rules, its bundled-item notes and what it writes. The
 * reading of the one file,
 * `validatePlan` with its `PlanValidation`, is the library half,
 * `../../plan/validate.ts`, which any folder may import.
 *
 * ## What is read
 *
 * The one file the line names, resolved against the working directory as
 * a shell completes it, wherever it sits, though the dispatcher runs it
 * only inside a project, as it runs every command but `module exec`,
 * `init` and `describe`. Beside that file it reads only what the checks
 * below name: the config and the tiers for the roster, the
 * `PREREQUISITES-<stub>.md` beside the plan for the store rules, and the
 * project's bundle for the bundled-item edits, the one thing it writes
 * being their pins. It starts no
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
 * both paths and the pin line that settles it. Every other name the
 * resolution does not resolve to a winner is reported too, exactly as an
 * agent is: held by no tier — a name the planner invented, or one only a
 * plugin or an add-on holds, which the skill index never lists —
 * switched off with `false`, or held only by a tier the session does not
 * load, each with the sentence naming its fix (`agents/roster.ts`).
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
 * ## The effort-store rules
 *
 * Beside both, the command checks the plan against the three rules of
 * `packages/rafa-run/src/plan/store-rules.ts`, which `loop start`'s preflight repeats: no
 * store change pinned by number, anywhere in the plan; and, in a plan
 * one of whose task lines names ``migration `<id>` ``, no still-to-run
 * task spelling a code span that runs `src/rafa.ts`, `dist/cli.js` or
 * `bun run rafa` without a leading `RAFA_EFFORT_DIR=`, and an `[auto]`
 * item probing `rafa effort schema --check` in the plan's
 * `PREREQUISITES-<stub>.md` beside it, read by `./store-check.ts`, the
 * one reading `rafa plan create` refuses a generated plan with too. They
 * need no project, so they run whether or not one was found; like the
 * roster, they are the command's and not `validatePlan`'s, which `packages/rafa-board/src/board/gate.ts` weighs a
 * planner's plan with and which reads one file only.
 *
 * ## The bundled-item edits
 *
 * After both, the command reads which agents and skills rafa bundles
 * the plan's still-to-run tasks edit, with `findBundledEdits` of
 * `./bundled-check.ts`, against the project's `src/bundled/` and the
 * `.claude/` links into it: a clone that merges such a plan holds a
 * project copy differing from the installed rafa's, and its next
 * `loop start` refuses the collision until the tier is pinned. Each edit
 * is a note, never a refusal: one line at `info` per edit,
 * `<file>:<lines>: <the line `bundledEditLine` words>` naming the item,
 * the path as typed and the `pinLine` pin, then what became of the pin.
 * When nothing else refuses the plan, `writeTierPins` writes each pin as
 * a `[human]` item of the `PREREQUISITES-<stub>.md` beside it, which a
 * second run leaves as it is; a plan something refuses gets its notes and
 * no write, and so does a plan not named `PLAN-<stub>.md`, which has no
 * such file. A file that cannot be written is warned about and changes
 * no exit code. Handed no project, the command reads no edit, and the
 * line saying no agent was checked says so too.
 *
 * ## What it writes
 *
 * With nothing to report, json mode gives the terminal result `data`:
 * `file` (absolute), the number of `stages`, the task counts under
 * `tasks`, an empty `issues`, an empty `missingAgents`, an empty
 * `skillCollisions`, an empty `unresolvedSkills`, an empty
 * `storeProblems` and the `bundledEdits` read, one `BundledEdit` each,
 * with the `warnings` `validatePlan` answered, which end nothing. Text
 * mode writes one line naming the file as typed, its stages and its
 * counts, after the bundled-edit notes, and does not write the warnings.
 *
 * With issues, each is written at `error`, in line order, as
 * `<file>:<line>: <reason>: <text>`, with the file as typed and the line
 * counting from one: a `log` event in json mode, an `error: ` line on
 * stdout in text mode. Each missing agent follows them, at `error` too,
 * as `<file>: <the line `missingAgentLine` words>`, which names the
 * agent, the task lines that asked for it, why it cannot be dispatched,
 * and the pin line or setting that settles it. Each colliding skill
 * follows those, at `error`, as `<file>: <the line `skillCollisionLine`
 * words>`, and each unresolved skill follows those, at `error`, as
 * `<file>: <the line `unresolvedSkillLine` words>`, which names the
 * skill, the task lines that asked for it, why and what settles it.
 * Each broken store rule follows those, at `error`, as
 * `<file>:<line>: <rule>: <text>` (`storeRuleLine`), the text ending
 * with what to write instead. The bundled-edit notes follow those, at
 * `info`, each saying its pin was not written. The command then
 * throws `CommandExit` with exit code 1 and a message counting what it
 * found, which text mode writes to stderr and json mode carries in the
 * terminal result.
 *
 * A line naming no file or more than one, and a path that is no file,
 * are refused with exit code 1 before anything is parsed.
 */
import type { BundledEdit } from './bundled-check.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { PlanValidation } from '@open-tomato/rafa/plan/validate';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { MissingAgent, SkillCollision, UnresolvedSkill } from '@open-tomato/rafa-inventory';
import type { StoreRuleProblem } from '@open-tomato/rafa-run';

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  collidingPlanSkills,
  missingAgentLine,
  missingPlanAgents,
  resolveAgentRoster,
  skillCollisionLine,
  unresolvedPlanSkills,
  unresolvedSkillLine,
} from '@open-tomato/rafa-inventory';
import { storeRuleLine } from '@open-tomato/rafa-run';

import { expectOneArgument } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { formatCounts, issueLine, plural } from '@open-tomato/rafa/core/plan';
import { validatePlan } from '@open-tomato/rafa/plan/validate';
import { prerequisitesPathForPlan } from '@open-tomato/rafa/preflight/prerequisites-md';

import { bundledEditLine, findBundledEdits, writeTierPins } from './bundled-check.js';
import { checkStoreRules } from './store-check.js';

/** The usage line a refusal names. */
const USAGE = 'rafa plan validate <file>';

/** Answers the directory a typed path is resolved against: the process's, unless a test hands another. */
export type WorkingDirectory = () => string;

/** What the roster check of one plan found; see the module note. */
export interface RosterFindings {
  /** Every `agent=` no loaded tier serves, each with why; empty when no project was found. */
  readonly missingAgents: readonly MissingAgent[];
  /** Every `skills=` name two loaded tiers hold with different contents; empty when no project was found. */
  readonly skillCollisions: readonly SkillCollision[];
  /** Every other `skills=` name the resolution resolves to no winner, each with why; empty when no project was found. */
  readonly unresolvedSkills: readonly UnresolvedSkill[];
}

/** A plan file read, with the agents and skills of its still-to-run tasks checked. */
export interface PlanValidationResult extends PlanValidation, RosterFindings {
  /** Every effort-store rule the plan breaks, in line order; see the module note. */
  readonly storeProblems: readonly StoreRuleProblem[];
  /** Every bundled agent and skill the still-to-run tasks edit; empty when no project was found. See the module note. */
  readonly bundledEdits: readonly BundledEdit[];
}

/** The config as it resolves for the project, refusing one `loadConfig` refuses. */
async function resolvedConfig(project: ProjectFound, warn: (message: string) => void): Promise<RafaConfig> {
  try {
    return (await loadConfig({ root: project.root, home: project.home }, {}, warn)).config;
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
 * loads serves, the `skills=` names two loaded tiers hold with
 * different contents, and the `skills=` names no loaded tier resolves.
 * None, with one line saying so, when the command
 * was handed no project; see the module note.
 */
async function checkRoster(context: RafaContext, markdown: string): Promise<RosterFindings> {
  const project = context.project;
  if (project === null) {
    context.output.info('ℹ️  No project was found from the working directory, so no `agent=` or `skills=` was checked'
      + ' and no edit of a bundled agent or skill was read.');
    return { missingAgents: [], skillCollisions: [], unresolvedSkills: [] };
  }

  const config = await resolvedConfig(project, (message) => {
    context.output.warn(message);
  });
  const roots = { repoRoot: project.root, home: project.home };
  const roster = resolveAgentRoster(roots, config);
  return {
    missingAgents: missingPlanAgents(markdown, roster),
    skillCollisions: collidingPlanSkills(markdown, roster),
    unresolvedSkills: unresolvedPlanSkills(markdown, roster),
  };
}

/** The bundled agents and skills the plan's still-to-run tasks edit, read in the project; none without one. */
function readBundledEdits(context: RafaContext, markdown: string): readonly BundledEdit[] {
  return context.project === null
    ? []
    : findBundledEdits(markdown, { repoRoot: context.project.root });
}

/** What became of the pins of one plan's bundled edits; see the module note. */
interface PinOutcome {
  /** The prerequisites file as the typed plan path spells it, or null when the plan's name carries no stub. */
  readonly file: string | null;
  /** True when something refuses the plan, so nothing was written. */
  readonly refused: boolean;
  /** The edits an item was written for in this run. */
  readonly written: readonly BundledEdit[];
  /** True when the file could not be written. */
  readonly failed: boolean;
}

/**
 * Writes the pins of `edits` into the prerequisites file beside the plan
 * at `file` unless the plan is `refused`, warning when it cannot; see
 * the module note.
 */
function writeBundledPins(
  context: RafaContext,
  plan: { readonly file: string; readonly typed: string },
  edits: readonly BundledEdit[],
  refused: boolean,
): PinOutcome {
  const path = prerequisitesPathForPlan(plan.file);
  const outcome: PinOutcome = { file: prerequisitesPathForPlan(plan.typed), refused, written: [], failed: false };
  if (refused || path === null || edits.length === 0) return outcome;
  try {
    return { ...outcome, written: writeTierPins(path, basename(plan.file), edits) };
  } catch (error) {
    context.output.warn(`${outcome.file ?? path}: the tier pins could not be written: ${messageOf(error)}`);
    return { ...outcome, failed: true };
  }
}

/** What became of `edit`'s pin, as the tail of its note. */
function pinTail(edit: BundledEdit, outcome: PinOutcome): string {
  if (outcome.refused) return 'not written while the plan is refused';
  if (outcome.file === null) return 'not written, since a plan not named PLAN-<stub>.md has no PREREQUISITES file';
  if (outcome.failed) return `not written to ${outcome.file}`;
  return outcome.written.includes(edit)
    ? `written to ${outcome.file} as a [human] prerequisite`
    : `already held by ${outcome.file}`;
}

/** Writes one note per bundled edit, each saying what became of its pin. */
function noteBundledEdits(context: RafaContext, typed: string, edits: readonly BundledEdit[], outcome: PinOutcome): void {
  for (const edit of edits) context.output.info(`ℹ️  ${bundledEditLine(typed, edit)}, ${pinTail(edit, outcome)}.`);
}

/** How many of each kind of refusal one plan met. */
interface RefusalCounts {
  readonly issues: number;
  readonly agents: number;
  readonly collisions: number;
  readonly unresolved: number;
  readonly store: number;
}

/** The refusal a plan with issues, missing agents, colliding or unresolved skills, or any mix ends with. */
function refusalFor(typed: string, { issues, agents, collisions, unresolved, store }: RefusalCounts): string {
  const counts = [
    issues > 0
      ? plural(issues, 'issue')
      : null,
    agents > 0
      ? plural(agents, 'unresolvable agent')
      : null,
    collisions > 0
      ? plural(collisions, 'skill collision')
      : null,
    unresolved > 0
      ? plural(unresolved, 'unresolvable skill')
      : null,
    store > 0
      ? plural(store, 'broken effort-store rule')
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
      + ' settles it, then one line per `skills=` name no loaded tier resolves (held by no tier, switched'
      + ' off, or held only by a tier the session does not load), naming what settles it, then one line'
      + ' per effort-store rule the plan breaks (a store change pinned by number; and, in a plan whose task'
      + ' names migration `<id>`, a command running src/rafa.ts, dist/cli.js or bun run rafa without a leading'
      + ' RAFA_EFFORT_DIR=, or no [auto] `rafa effort schema --check` probe in its PREREQUISITES), then exits 1'
      + ' — the same check'
      + ' `rafa loop start` halts on before it dispatches anything. A task that edits an agent or a skill'
      + ' rafa bundles, under src/bundled/ or through a .claude/ link into it, gets a note naming the item'
      + ' and the `tiers.agents` or `tiers.skills` pin a clone that merges the plan needs, never a refusal;'
      + ' when nothing refuses the plan the pin is written as a [human] item of the PREREQUISITES-<stub>.md'
      + ' beside it, once. The path is read relative to the'
      + ' working directory; the agents and the bundle are read from the project found from it and the'
      + ' config that resolves there, and are left unread when there is no project. With `--output=json`'
      + ' each issue and each missing agent is an error log event, each note an info log event, and a plan'
      + ' with neither is the data of the terminal result event, its `bundledEdits` listing the edits.',
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
        note: 'Prints one line when the plan reads as written, after a note per bundled agent or skill a task'
          + ' edits with its pin written to PREREQUISITES-my-feature.md, or one error line per issue and exits 1.',
      },
      {
        cmd: 'rafa plan validate .rafa/plans/PLAN-my-feature.md --output=json',
        note: 'Writes a start event, an error log event per issue, then a result event whose bundledEdits'
          + ' names each bundled item a task edits.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const typed = expectOneArgument(context.args, USAGE);
      const file = resolve(workingDirectory(), typed);
      const validation = validatePlan(file);
      const { issues, stages, tasks } = validation;
      const markdown = readFileSync(file, 'utf8');
      const findings = await checkRoster(context, markdown);
      const { missingAgents, skillCollisions, unresolvedSkills } = findings;
      const storeProblems = checkStoreRules(file, markdown);
      const bundledEdits = readBundledEdits(context, markdown);
      const result: PlanValidationResult = { ...validation, ...findings, storeProblems, bundledEdits };
      const counts = {
        issues: issues.length,
        agents: missingAgents.length,
        collisions: skillCollisions.length,
        unresolved: unresolvedSkills.length,
        store: storeProblems.length,
      };
      const refused = Object.values(counts).some((count) => count > 0);
      const pins = writeBundledPins(context, { file, typed }, bundledEdits, refused);
      if (refused) {
        for (const issue of issues) context.output.error(issueLine(typed, issue));
        for (const agent of missingAgents) context.output.error(`${typed}: ${missingAgentLine(agent)}`);
        for (const skill of skillCollisions) context.output.error(`${typed}: ${skillCollisionLine(skill)}`);
        for (const skill of unresolvedSkills) context.output.error(`${typed}: ${unresolvedSkillLine(skill)}`);
        for (const problem of storeProblems) context.output.error(storeRuleLine(typed, problem));
        noteBundledEdits(context, typed, bundledEdits, pins);
        throw new CommandExit(1, refusalFor(typed, counts));
      }
      noteBundledEdits(context, typed, bundledEdits, pins);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(`✅ ${typed}: no issues; ${plural(stages, 'stage')}, tasks ${formatCounts(tasks)}`);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createPlanValidateCommand();
export default command;
