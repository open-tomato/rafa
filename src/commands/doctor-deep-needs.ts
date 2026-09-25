/**
 * The Stack tools and Plan needs readings of `rafa doctor --deep`.
 *
 * A module of its own beside `./doctor-deep-settings.ts`, as
 * `./doctor.ts` is near the 800-line cap (`context/source.md`). It
 * re-derives nothing: which stack the project root marks, the symbol
 * program it needs and the skill naming that program are
 * `readStackNeeds`' (`src/plan/needs.ts`), what a plan needs is
 * `readPlanNeeds`', and which need a run would not have is `isUnmet`.
 * Their rules are documented there, not here. The `PATH` a program is
 * looked up on and the setting sources that decide visibility are the
 * caller's {@link DeepNeedsSeams}: hand them the session's, not the
 * shell's, and the rows read what a loop session would have.
 *
 * {@link stackToolsSection} renders a `readStackNeeds` reading, and
 * {@link readDeepPlanNeeds} reads a plan into data that
 * {@link planNeedsSection} renders, each through `./doctor-deep-row.ts`.
 *
 * ## The Stack tools rows
 *
 *   - **One per detected stack**: `ok` when met, naming the program's
 *     directory and the skill naming it; `warn` when not, saying which
 *     of the two is unmet, with the stack's `hint` — the line
 *     `plan needs` prints for it — verbatim as the fix. The directory
 *     of a program rafa ships (`ts-symbols`) is the rafa tier's
 *     `bundled/bin` when that holds it, and a missing one is read as
 *     neither there nor on `PATH`.
 *   - **One `note` when no stack is detected**, naming the marker files
 *     looked for, or that there is no project root to look in.
 *
 * ## The Plan needs rows
 *
 * The rows `rafa plan needs --missing` would print as needs, and no
 * others: every item of the reading `isUnmet` keeps, each a `warn`
 * saying where it was named, with a fix. A missing program is
 * installed on `PATH` (for one rafa ships, the fix is its stack row's
 * `install` text, which names a built rafa first), a missing agent or
 * skill added under the project's `.claude/`, a missing MCP server
 * declared in a loaded scope. A hidden agent, skill or MCP server is pointed at its row in
 * the Settings section rather than given a fix of its own: why it is
 * hidden (a source left out, a shadow, a switch) is that section's
 * reading. The exception is an item of the `rafa` or an `addon:`
 * source, which the Settings section leaves out: a hidden one is a
 * rafa item rafa does not serve (`inventory/index.ts`), or an add-on's,
 * which no session is ever handed. It reads as the missing item it is
 * to a session. A plan
 * with nothing unmet is one `ok` row. The stacks' own lines are not
 * repeated: they are the Stack tools section.
 *
 * A plan that is not there or does not read is one `warn` row carrying
 * `readPlanNeeds`' refusal: `--deep` never throws out of doctor and
 * never moves its exit code.
 *
 * ## Warnings
 *
 * Each reader warning is a `warn` row after the others, so a need read
 * as missing because its file did not parse is not read as a plain
 * miss. Most of them are the inventory's and the MCP reader's, which
 * the Settings section prints too; a caller rendering both hands the
 * ones already shown as `shown`, and they are left out here.
 *
 * Nothing here writes or reads the real home or `PATH`: every location
 * comes from {@link DeepNeedsSeams}.
 */
import type { DeepRow, DeepSection } from './doctor-deep-row.js';
import type { Need, NeedsReading, NeedsSeams, NeedsWarning, StackReading } from '../plan/needs.js';

import { messageOf } from '../config-sections.js';
import { isBundledProgram, isUnmet, readPlanNeeds, readStackNeeds, STACK_TOOLS } from '../plan/needs.js';

import { originsPhrase } from './plan/needs.js';

/** The Stack tools section's title. */
export const STACK_TOOLS_SECTION_TITLE = 'Stack tools';

/** The Plan needs section's title. */
export const PLAN_NEEDS_SECTION_TITLE = 'Plan needs';

/** What the readings are read through: the needs reader's own seams. */
export type DeepNeedsSeams = NeedsSeams;

/** What {@link readDeepPlanNeeds} answers: the plan, and its reading or why there is none. */
export interface DeepPlanNeedsReading {
  /** The plan as the caller names it in the rows. */
  readonly plan: string;
  /** The needs, or null when the plan was refused. */
  readonly needs: NeedsReading | null;
  /** `readPlanNeeds`' refusal, or null when the plan read. */
  readonly refusal: string | null;
}

/** The project's stack tools, read with no plan; see the module note. */
export function readDeepStackTools(seams: DeepNeedsSeams): Promise<NeedsReading> {
  return readStackNeeds(seams);
}

/**
 * What the plan at `planPath` needs, shown as `plan` in the rows.
 * Never throws: a refusal is carried as data; see the module note.
 */
export async function readDeepPlanNeeds(
  planPath: string,
  plan: string,
  seams: DeepNeedsSeams,
): Promise<DeepPlanNeedsReading> {
  try {
    return { plan, needs: await readPlanNeeds(planPath, seams), refusal: null };
  } catch (error) {
    return { plan, needs: null, refusal: messageOf(error) };
  }
}

/** The key a warning is compared under. */
function warningKey(warning: NeedsWarning): string {
  return `${warning.path}\u0000${warning.reason}`;
}

/** The `warn` rows of the warnings not already `shown`. */
function warningRows(warnings: readonly NeedsWarning[], shown: readonly NeedsWarning[]): readonly DeepRow[] {
  const seen = new Set(shown.map(warningKey));
  return warnings
    .filter((warning) => !seen.has(warningKey(warning)))
    .map((warning): DeepRow => ({ status: 'warn', name: warning.path, detail: warning.reason }));
}

/** The item of `kind` and `name` among `items`, if any. */
function itemOf(items: readonly Need[], kind: Need['kind'], name: string | null): Need | undefined {
  return items.find((item) => item.kind === kind && item.name === name);
}

/** Where a missing program was looked for: `bundled/bin` as well as `PATH` for one rafa ships. */
function notFoundPhrase(program: string): string {
  return isBundledProgram(program)
    ? 'neither in bundled/bin nor on PATH'
    : 'not on PATH';
}

/** Where a stack's program was found, or that it was not. */
function programPhrase(stack: StackReading, items: readonly Need[]): string {
  const program = itemOf(items, 'program', stack.program);
  return program?.kind === 'program' && program.directory !== null
    ? `${stack.program} in ${program.directory}`
    : `${stack.program} ${notFoundPhrase(stack.program)}`;
}

/** The stack's skill, and whether a run sees it. */
function skillPhrase(stack: StackReading, items: readonly Need[]): string {
  if (stack.skill === null) return `no skill names ${stack.program}`;
  const skill = itemOf(items, 'skill', stack.skill);
  const seen = skill !== undefined && !isUnmet(skill);
  return seen
    ? `skill ${stack.skill} visible to a run`
    : `skill ${stack.skill} not visible to a run`;
}

/** One detected stack's row; see the module note. */
function stackRow(stack: StackReading, items: readonly Need[]): DeepRow {
  const detail = `${programPhrase(stack, items)}; ${skillPhrase(stack, items)}`;
  if (stack.met) return { status: 'ok', name: stack.stack, detail };
  return { status: 'warn', name: stack.stack, detail, fix: stack.hint ?? '' };
}

/** The row a reading with no detected stack shows. */
function noStackRow(seams: Pick<DeepNeedsSeams, 'projectRoot'>): DeepRow {
  const markers = STACK_TOOLS.flatMap((tool) => tool.markers).join(', ');
  const detail = seams.projectRoot === null
    ? 'no project root to read a stack from'
    : `none detected: no ${markers} at ${seams.projectRoot}`;
  return { status: 'note', name: 'stack', detail };
}

/**
 * The Stack tools section of a `readStackNeeds` reading of the project
 * root `seams` names, leaving out the warnings `shown` holds.
 */
export function stackToolsSection(
  reading: NeedsReading,
  seams: Pick<DeepNeedsSeams, 'projectRoot'>,
  shown: readonly NeedsWarning[] = [],
): DeepSection {
  const stacks = reading.stacks.length === 0
    ? [noStackRow(seams)]
    : reading.stacks.map((stack) => stackRow(stack, reading.items));
  return { title: STACK_TOOLS_SECTION_TITLE, rows: [...stacks, ...warningRows(reading.warnings, shown)] };
}

/** Where an unmet need stands, as a phrase. */
function unmetPhrase(need: Need): string {
  if (need.status === 'missing') {
    return need.kind === 'program'
      ? notFoundPhrase(need.name)
      : 'missing';
  }
  if (need.kind === 'program') return 'present';
  const from = need.kind === 'mcp'
    ? `mcp ${need.scope ?? ''}`
    : `${need.source ?? ''} ${need.state ?? ''}`;
  return `${from.trim()}, not visible to a run`;
}

/** Whether a source is rafa's own tier or an add-on's, which the Settings section leaves out. */
function isRafaSource(source: string | null): boolean {
  return source === 'rafa' || (source?.startsWith('addon:') ?? false);
}

/** The fix for an unmet need; see the module note. */
function unmetFix(need: Need): string {
  if (need.kind === 'program') {
    return STACK_TOOLS.find((tool) => tool.bundled && tool.program === need.name)?.install
      ?? `install ${need.name} on PATH`;
  }
  if (need.kind === 'mcp') {
    return need.status === 'present'
      ? `see the mcp server ${need.name} in the Settings section`
      : `declare the mcp server ${need.name} in a scope loop.settingSources loads`;
  }
  const add = `add the ${need.kind} ${need.name} under .claude/${need.kind}s/ in this project`;
  if (need.status === 'missing') return add;
  if (need.source === 'rafa') return `${add}: rafa does not serve its ${need.kind} ${need.name}`;
  return isRafaSource(need.source)
    ? `${add}: a session is never handed a ${need.source ?? ''} ${need.kind}`
    : `see the ${need.source ?? ''} ${need.kind} ${need.name} in the Settings section`;
}

/** One unmet need's `warn` row. */
function needRow(need: Need): DeepRow {
  return {
    status: 'warn',
    name: `${need.kind} ${need.name}`,
    detail: `${unmetPhrase(need)} (${originsPhrase(need.origins)})`,
    fix: unmetFix(need),
  };
}

/**
 * The Plan needs section of a {@link readDeepPlanNeeds} reading: its
 * `isUnmet` needs, leaving out the warnings `shown` holds.
 */
export function planNeedsSection(
  reading: DeepPlanNeedsReading,
  shown: readonly NeedsWarning[] = [],
): DeepSection {
  const title = `${PLAN_NEEDS_SECTION_TITLE} (${reading.plan})`;
  if (reading.needs === null) {
    return { title, rows: [{ status: 'warn', name: 'plan', detail: `cannot be read: ${reading.refusal ?? ''}` }] };
  }
  const unmet = reading.needs.items.filter(isUnmet);
  const needs: readonly DeepRow[] = unmet.length === 0
    ? [{ status: 'ok', name: 'plan', detail: 'nothing it needs is missing or hidden from a run' }]
    : unmet.map(needRow);
  return { title, rows: [...needs, ...warningRows(reading.needs.warnings, shown)] };
}
