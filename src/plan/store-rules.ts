/**
 * The three effort-store rules a plan is checked against, by
 * `rafa plan validate` (`src/commands/plan/validate.ts`) and again by
 * `loop start`'s preflight (`src/start/preflight.ts`), so a plan the
 * loop would refuse is refused before a run is started.
 *
 * `.rafa/specs/rafa-234-effort-store-migrations-older.md` catches each
 * old practice at the earliest step that can see it, and for a plan
 * that step is these checks:
 *
 *  1. **A store change pinned by number** (`pinned-migration`): any
 *     line outside a fence, a code span or an HTML comment matching
 *     `PINNED_MIGRATION`, read by the readiness gate's own reader
 *     (`findPinnedMigrations` in `src/board/readiness.ts`) so a spec and
 *     the plan written from it are held to one pattern. Asked of EVERY
 *     plan, since a plan that pins "migration 14" and never names the
 *     migration's id is the practice itself, and would otherwise escape
 *     the other two rules by never carrying a migration.
 *  2. **A working-tree command with no `RAFA_EFFORT_DIR=`**
 *     (`unprefixed-command`): a code span on a still-to-run task line
 *     that runs `src/rafa.ts`, `dist/cli.js` or `bun run rafa` with no
 *     `RAFA_EFFORT_DIR=` among the assignments in front of it. Asked
 *     only of a plan that CARRIES A MIGRATION, one whose task line, at
 *     any checkbox, names ``migration `<id>` ``: branch store code run
 *     over the live store is what the development-build refusal stops,
 *     and a plan that changes no store has no branch store code to run.
 *  3. **No probe** (`missing-probe`): a plan that carries a migration
 *     whose `PREREQUISITES-<stub>.md` holds no `[auto]` item probing
 *     exactly `rafa effort schema --check`, the probe that holds a
 *     store-changing plan back until the installed rafa reads the store.
 *     A missing file carries no such item.
 *
 * ## What "runs" is
 *
 * A span NAMING `src/rafa.ts` runs nothing, and a plan about this
 * repository names it constantly, so only a span that is a command
 * counts: split at `&&`, `||`, `;` and `|`, each segment's leading
 * `NAME=value` assignments set aside, then `bun` or `node` (with an
 * optional `run`) followed by a path ending in `src/rafa.ts` or
 * `dist/cli.js`, or `bun run rafa`. A value may be a `<placeholder>`
 * with spaces in it, as the dev-planner writes
 * `RAFA_EFFORT_DIR=<absolute path of that dir>`. An assignment covers
 * its own segment only, so the second half of
 * `RAFA_EFFORT_DIR=/x bun src/rafa.ts a && bun src/rafa.ts b` is
 * refused, as a shell would run it over the live store.
 *
 * The refusal's copy command is spelled with the runner the refused span
 * used, so a plan running `bun run rafa` is told `bun run rafa effort
 * copy`, and no literal here names the checkout-only entry
 * (`src/tests/user-facing-spelling.sweep.test.ts`).
 *
 * `effort copy` is the one command exempt: the dev-planner's own rule
 * runs `bun src/rafa.ts effort copy --to=.rafa/scratch/<stub>-effort`
 * unprefixed, because making the copy is how a task reaches a store it
 * may prefix with. The installed runtime (`rafa …`,
 * `~/.rafa/runtime/<version>/cli.js`) is never refused: it is not a
 * development build.
 *
 * Only still-to-run task lines are read for commands, the lines a
 * `rafa:*` block the plan never closed hides included, as the roster
 * check reads them: a ticked task will not run again, and a resumed run
 * should not be refused for a command it has already paid for.
 *
 * Everything here is pure: the callers read the plan and its
 * PREREQUISITES file and hand the text in.
 */
import type { PlanTask } from './parse.js';

import { findPinnedMigrations } from '../board/readiness.js';
import { parsePrerequisites } from '../preflight/prerequisites-md.js';

import { parsePlan } from './parse.js';

/** Which of the three rules a problem breaks. */
export type StoreRuleKind = 'pinned-migration' | 'unprefixed-command' | 'missing-probe';

/** One rule a plan breaks; see the module note. */
export interface StoreRuleProblem {
  /** The rule it breaks. */
  readonly kind: StoreRuleKind;
  /** The plan line it sits on, counting from one. */
  readonly line: number;
  /** What is wrong and the one thing to do about it. */
  readonly text: string;
}

/** The probe a store-changing plan's PREREQUISITES carries under `[auto]`. */
export const STORE_SCHEMA_PROBE = 'rafa effort schema --check';

/** The item the missing-probe problem tells the planner to add, as the dev-planner rule spells it. */
export const STORE_SCHEMA_PROBE_ITEM = `- [ ] The installed rafa can read and write the live store: \`${STORE_SCHEMA_PROBE}\``;

/** The variable a development build's store is pointed at a copy through. */
const EFFORT_DIR_VARIABLE = 'RAFA_EFFORT_DIR';

/** A task line naming a migration by its id: ``migration `<id>` ``. */
const MIGRATION_BY_ID = /\bmigration\s+`[a-z0-9]+(?:-[a-z0-9]+)*`/iu;

/** A code span, read as the readiness gate reads one. */
const CODE_SPAN = /`([^`]+)`/gu;

/** What separates the commands of one span. */
const COMMAND_SEPARATOR = /&&|\|\||;|\|/u;

/** One leading `NAME=value` assignment, its value a `<placeholder>`, quoted, or bare. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(?:<[^>]*>|"[^"]*"|'[^']*'|\S*)\s+/u;

/** A command running the working tree's rafa: the runner, then what follows it. */
const WORKING_TREE_RUN = /^((?:bun|node)\s+(?:run\s+)?\S*(?:src\/rafa\.ts|dist\/cli\.js)|bun\s+run\s+rafa)(?=\s|$)(.*)$/u;

/** The one command a working-tree run may spell without the variable. */
const EXEMPT_SUBCOMMAND = /^\s+(?:--\s+)?effort\s+copy(?=\s|$)/u;

/** A command, its leading assignments set aside. */
interface SplitCommand {
  /** The names assigned in front of it. */
  readonly assigned: readonly string[];
  /** What runs. */
  readonly command: string;
}

/** `segment` with its leading assignments set aside. */
function splitAssignments(segment: string): SplitCommand {
  const assigned: string[] = [];
  let rest = segment.trim();
  for (let match = ASSIGNMENT.exec(rest); match !== null; match = ASSIGNMENT.exec(rest)) {
    assigned.push(match[1] ?? '');
    rest = rest.slice(match[0].length);
  }
  return { assigned, command: rest };
}

/** A code span running the working tree's rafa where one of its commands has no `RAFA_EFFORT_DIR=`. */
export interface UnprefixedCommand {
  /** The span, as written. */
  readonly span: string;
  /** The runner of its first unprefixed command, `bun src/rafa.ts` say, which the copy is made with. */
  readonly runner: string;
}

/**
 * The runner `segment` runs the working tree's rafa with, when it has no
 * `RAFA_EFFORT_DIR=` in front of it and is no `effort copy`; null otherwise.
 */
function unprefixedRunner(segment: string): string | null {
  const { assigned, command } = splitAssignments(segment);
  const run = WORKING_TREE_RUN.exec(command);
  if (run === null) return null;
  if (EXEMPT_SUBCOMMAND.test(run[2] ?? '')) return null;
  return assigned.includes(EFFORT_DIR_VARIABLE)
    ? null
    : (run[1] ?? '').replace(/\s+/gu, ' ');
}

/** `span` as an unprefixed command, or null when every command of it is prefixed or runs no working tree. */
function unprefixedSpan(span: string): UnprefixedCommand | null {
  for (const segment of span.split(COMMAND_SEPARATOR)) {
    const runner = unprefixedRunner(segment);
    if (runner !== null) return { span, runner };
  }
  return null;
}

/**
 * Every code span of `line` that runs the working tree's rafa with no
 * `RAFA_EFFORT_DIR=` in front of one of its commands; see the module note.
 */
export function unprefixedCommands(line: string): readonly UnprefixedCommand[] {
  return [...line.matchAll(CODE_SPAN)].flatMap((match) => {
    const found = unprefixedSpan(match[1] ?? '');
    return found === null
      ? []
      : [found];
  });
}

/** The first task line naming a migration by its id, or null when the plan carries none. */
function migrationTask(tasks: readonly PlanTask[]): PlanTask | null {
  return tasks.find((task) => MIGRATION_BY_ID.test(task.task)) ?? null;
}

/** True when `prerequisites` holds an `[auto]` item probing {@link STORE_SCHEMA_PROBE}. */
function hasSchemaProbe(prerequisites: string | null): boolean {
  if (prerequisites === null) return false;
  return parsePrerequisites(prerequisites)
    .some((item) => item.tag === 'auto' && item.probe?.replace(/\s+/gu, ' ') === STORE_SCHEMA_PROBE);
}

/** The pinned-number problems of `plan`. */
function pinnedProblems(plan: string): readonly StoreRuleProblem[] {
  return findPinnedMigrations(plan).map((pinned) => ({
    kind: 'pinned-migration',
    line: pinned.line,
    text: `pins a store change by number ("${pinned.text}"); name the migration by its id, as migration \`<id>\`,`
      + ' and never by a version number or an array position',
  }));
}

/** The unprefixed-command problems of the still-to-run `tasks`. */
function commandProblems(tasks: readonly PlanTask[]): readonly StoreRuleProblem[] {
  return tasks
    .filter((task) => task.status !== 'done')
    .flatMap((task) => unprefixedCommands(task.task).map(({ span, runner }) => ({
      kind: 'unprefixed-command' as const,
      line: task.lineNum + 1,
      text: `runs \`${span}\` without a leading ${EFFORT_DIR_VARIABLE}=, in a plan that carries a migration;`
        + ` copy the store first with \`${runner} effort copy --to=.rafa/scratch/<stub>-effort\``
        + ` and write the command as ${EFFORT_DIR_VARIABLE}=<absolute path of that dir> ${span}`,
    })));
}

/** The missing-probe problem, named against the task that carries the migration. */
function probeProblem(task: PlanTask, prerequisitesName: string): StoreRuleProblem {
  return {
    kind: 'missing-probe',
    line: task.lineNum + 1,
    text: `carries a migration, and ${prerequisitesName} holds no [auto] item probing \`${STORE_SCHEMA_PROBE}\`;`
      + ` add ${STORE_SCHEMA_PROBE_ITEM} under an [auto] heading`,
  };
}

/** A plan and its PREREQUISITES file, as the store rules read them. */
export interface StoreRuleInput {
  /** The plan's text. */
  readonly plan: string;
  /** The PREREQUISITES file's text, or null when there is none. */
  readonly prerequisites: string | null;
  /** The PREREQUISITES file's name, for the missing-probe problem. */
  readonly prerequisitesName: string;
}

/**
 * Every effort-store rule the plan breaks, in line order; none for a
 * plan that breaks none. See the module note.
 */
export function findStoreRuleProblems(input: StoreRuleInput): readonly StoreRuleProblem[] {
  const model = parsePlan(input.plan);
  const tasks = [...model.tasks, ...model.hiddenTasks].sort((a, b) => a.lineNum - b.lineNum);
  const carrier = migrationTask(tasks);
  const pinned = pinnedProblems(input.plan);
  if (carrier === null) return pinned;

  const probe = hasSchemaProbe(input.prerequisites)
    ? []
    : [probeProblem(carrier, input.prerequisitesName)];
  return [...pinned, ...commandProblems(tasks), ...probe].sort((a, b) => a.line - b.line);
}

/** One problem as a line naming `file`: `<file>:<line>: <kind>: <text>`. */
export function storeRuleLine(file: string, problem: StoreRuleProblem): string {
  return `${file}:${String(problem.line)}: ${problem.kind}: ${problem.text}`;
}
