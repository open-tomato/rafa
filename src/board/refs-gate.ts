/**
 * Check 4 of the readiness gate: the references a spec names, read
 * against the stamps its saved copy keeps, and the refusal a `dangling`
 * or `suspect` one ends `plan create` with
 * (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * The reading is `src/refs/reading.ts`'s: one {@link RefRow} per
 * reference, each in one of five states. This module holds what the
 * gate DOES with them, which is one of three things per state:
 *
 * | State | What check 4 does |
 * |---|---|
 * | `ok` | nothing |
 * | `dangling`, `suspect` | refuses, with exit {@link BOARD_REFUSAL_EXIT}, naming every such row |
 * | `resolved` | prints `resolved #<n> — rafa issue unblock <n>` and goes on |
 * | `unknown` | prints the row and goes on |
 *
 * A refused row reads `dangling <text> (line <n>)`, or `suspect
 * <text>: heading "<h>" changed (line <n>)` for an issue whose `##`
 * sections name what changed; the line is the body's, as the issue was
 * written. The refusal ends by naming the two ways past it: pass
 * `--accept-refs` on this run, or edit the issue.
 *
 * Nothing here spawns a process: the targets are read through the
 * {@link RefVerifier} the caller builds over its seams, so
 * `./refs-gate.test.ts` drives a fake verifier over copies under the
 * temp directory.
 *
 * ## Accepting
 *
 * `--accept-refs` for one run, and `dangerous.acceptStaleRefs: true`
 * for every run, do the same thing: every reference of the spec is
 * re-stamped as reviewed (`restampCopyRefs`) and the run goes on to
 * plan. The rows are still read against the stamps the copy held
 * first, so the resolved and unknown lines are printed as on any run
 * and every dangling and suspect row is named as accepted, not passed
 * over in silence. The two readings share one memoised verifier, so
 * each target is read once: a `gh issue view` per issue, not two.
 *
 * The flag wins when both are on, since it is what was typed for this
 * run. The config's own line is printed once at the START of the run by
 * {@link announceAcceptStaleRefs}, before any board read, so an
 * operator who forgot the setting is told before anything is spent,
 * and not only when a reference would have refused.
 *
 * ## What cannot be read
 *
 * A board issue `gh` could not read (`RefVerifyError`) and a refs block
 * the codec will not read (`RefsBlockError`) are refusals too, with the
 * same exit code and the error's own words: reading either failure as
 * a state would pass or refuse a spec on something that says nothing
 * about it. Any other error travels out as it was thrown.
 *
 * ## Where it runs
 *
 * Check 4 belongs on the `--issue` and `--next` routes of `plan create`,
 * after the snapshot has settled and before the planner session starts,
 * so a refusal writes no plan file and spends no session;
 * `src/commands/plan/refs-check.ts` places {@link enforceRefsGate}
 * there, and builds the verifier it reads with. `--spec` has no issue to read
 * a copy of, and `issue ready` does not run it: `rafa issue check` is
 * the reading on demand.
 */
import type { Output } from '../ports/index.js';
import type { RefRow, RefsReading } from '../refs/reading.js';
import type { LiveReading } from '../refs/stamp.js';
import type { RefVerifier } from '../refs/verify.js';

import { readFileSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { SETTINGS } from '../config-schema.js';
import { messageOf } from '../config-sections.js';
import { readCopyRefs, readRefsText, restampCopyRefs } from '../refs/reading.js';
import { RefsBlockError } from '../refs/stamp.js';
import { RefVerifyError } from '../refs/verify.js';

import { ACCEPT_REFS_FLAG } from './flags.js';
import { BOARD_REFUSAL_EXIT } from './plan-spec.js';

/**
 * The flag this module reads, re-exported: the reading is this
 * module's, and the word is `./flags.js`'s, which records why.
 */
export { ACCEPT_REFS_FLAG };

/** The config key that accepts every reference on every run, as `SETTINGS` spells it. */
export const ACCEPT_STALE_REFS_KEY = SETTINGS.dangerousAcceptStaleRefs.key;

/**
 * Why check 4 refuses nothing on a run: nobody said so, `--accept-refs`
 * was typed, or `dangerous.acceptStaleRefs` is on.
 */
export type RefsAcceptance = 'none' | 'flag' | 'config';

/** What {@link enforceRefsGate} is handed. */
export interface RefsGateOptions {
  /** The saved copy of the spec, its refs block included when it has one. */
  readonly path: string;
  /** The issue the copy is the spec of, named by a resolved row's unblock command. */
  readonly issue: number;
  /** What the refusal calls the spec: `issue #20`. */
  readonly source: string;
  /** Reads each target as it is now. */
  readonly verify: RefVerifier;
  /** Whether, and why, every reference is accepted on this run. */
  readonly acceptance: RefsAcceptance;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** What a run check 4 let through answered. */
export interface RefsGateAnswer {
  /** Every reference, read against the stamps the copy held before this run. */
  readonly rows: readonly RefRow[];
  /** The dangling and suspect rows an acceptance let through; empty when none was given. */
  readonly accepted: readonly RefRow[];
  /** True when the copy was re-stamped, which every acceptance does. */
  readonly restamped: boolean;
}

/** True when `--accept-refs` is among the words a command was handed. A bare word: it takes no value. */
export function readAcceptRefsFlag(args: readonly string[]): boolean {
  return args.includes(ACCEPT_REFS_FLAG);
}

/** The acceptance a run holds: the flag's when typed, else the config's, else none. */
export function refsAcceptance(flag: boolean, acceptStaleRefs: boolean): RefsAcceptance {
  if (flag) return 'flag';
  if (acceptStaleRefs) return 'config';
  return 'none';
}

/** The one line a run with `dangerous.acceptStaleRefs` on starts with. */
export function acceptStaleRefsPassLine(): string {
  return `⚠️  ${ACCEPT_STALE_REFS_KEY} is on: check 4 re-stamps every reference of the spec as reviewed`
    + ' and refuses none on this run.';
}

/**
 * Prints {@link acceptStaleRefsPassLine} when `acceptStaleRefs` is on,
 * and nothing when it is off. Called once, at the start of a `plan
 * create` run; see the module note.
 */
export function announceAcceptStaleRefs(acceptStaleRefs: boolean, output: Output = activeOutput()): void {
  if (acceptStaleRefs) output.warn(acceptStaleRefsPassLine());
}

/** True for a row check 4 refuses unless the run accepts it. */
export function isRefusedRow(row: RefRow): boolean {
  return row.state === 'dangling' || row.state === 'suspect';
}

/** `heading "A" changed`, or `headings "A", "B" changed`. */
function headingsChanged(headings: readonly string[]): string {
  const quoted = headings.map((heading) => `"${heading}"`).join(', ');
  const noun = headings.length === 1
    ? 'heading'
    : 'headings';
  return `${noun} ${quoted} changed`;
}

/** A dangling or suspect row, as the refusal lists it; see the module note. */
export function refusedRowLine(row: RefRow): string {
  const at = `(line ${String(row.line)})`;
  if (row.state === 'suspect' && row.changedHeadings.length > 0) {
    return `suspect ${row.text}: ${headingsChanged(row.changedHeadings)} ${at}`;
  }
  return `${row.state} ${row.text} ${at}`;
}

/** A resolved row, with the command that takes the spec off its blocked line. */
export function resolvedRowLine(row: RefRow): string {
  const unblock = row.unblock === null
    ? ''
    : ` — ${row.unblock}`;
  return `resolved ${row.text}${unblock}`;
}

/** An unknown row: listed, and never refused. */
export function unknownRowLine(row: RefRow): string {
  return `unknown ${row.text} (line ${String(row.line)}) — its repository could not be read, so it is not checked`;
}

/**
 * The refusal check 4 ends the command with: every dangling and suspect
 * row on its own line, then the two ways past it.
 */
export function refsRefusalMessage(source: string, rows: readonly RefRow[]): string {
  return [
    `❌ ${source} names references that are missing or changed since the spec was read:`,
    ...rows.filter(isRefusedRow).map((row) => `   • ${refusedRowLine(row)}`),
    `   Pass ${ACCEPT_REFS_FLAG} to re-stamp them as reviewed and plan on this run,`
    + ' or edit the issue so the spec names what is there now.',
  ].join('\n');
}

/** What an acceptance is called in the line that says it re-stamped the copy. */
function acceptedBy(acceptance: Exclude<RefsAcceptance, 'none'>): string {
  return acceptance === 'flag'
    ? ACCEPT_REFS_FLAG
    : ACCEPT_STALE_REFS_KEY;
}

/** The line an acceptance prints once the copy is re-stamped. */
export function restampedLine(acceptance: Exclude<RefsAcceptance, 'none'>, source: string, count: number): string {
  const noun = count === 1
    ? 'reference'
    : 'references';
  return `🔖 ${acceptedBy(acceptance)}: re-stamped ${String(count)} ${noun} of ${source} as reviewed.`;
}

/** Prints the resolved and unknown rows, which never refuse. */
function listPassingRows(rows: readonly RefRow[], output: Output): void {
  for (const row of rows) {
    if (row.state === 'resolved') output.info(resolvedRowLine(row));
    if (row.state === 'unknown') output.info(unknownRowLine(row));
  }
}

/** `verify`, reading each kind and text once however often it is asked. */
function memoised(verify: RefVerifier): RefVerifier {
  const read = new Map<string, Promise<LiveReading>>();
  return (ref) => {
    const key = `${ref.kind}\u0000${ref.text}`;
    const known = read.get(key);
    if (known !== undefined) return known;
    const reading = verify(ref);
    read.set(key, reading);
    return reading;
  };
}

/** The rows read against the stamps the copy holds, and the copy re-stamped; see the module note. */
async function acceptAll(options: RefsGateOptions, acceptance: Exclude<RefsAcceptance, 'none'>, output: Output): Promise<RefsGateAnswer> {
  const verify = memoised(options.verify);
  const before: RefsReading = await readRefsText({ copy: readFileSync(options.path, 'utf8'), issue: options.issue, verify });
  const after = await restampCopyRefs({ path: options.path, issue: options.issue, verify });
  const accepted = before.rows.filter(isRefusedRow);
  listPassingRows(before.rows, output);
  output.info(restampedLine(acceptance, options.source, after.stamps?.length ?? 0));
  for (const row of accepted) output.info(`   • accepted ${refusedRowLine(row)}`);
  return Object.freeze({ rows: before.rows, accepted: Object.freeze(accepted), restamped: true });
}

/** The rows read against the stamps the copy holds, refused when any is dangling or suspect. */
async function refuseStale(options: RefsGateOptions, output: Output): Promise<RefsGateAnswer> {
  const { rows } = await readCopyRefs({ path: options.path, issue: options.issue, verify: options.verify });
  listPassingRows(rows, output);
  if (rows.some(isRefusedRow)) throw new CommandExit(BOARD_REFUSAL_EXIT, refsRefusalMessage(options.source, rows));
  return Object.freeze({ rows, accepted: Object.freeze([]), restamped: false });
}

/**
 * Runs check 4 over the saved copy at `options.path`, by the rules in
 * the module note: prints the resolved and unknown rows, and either
 * re-stamps every reference when the run accepts them or refuses a
 * dangling or suspect one.
 *
 * Throws `CommandExit({@link BOARD_REFUSAL_EXIT}, ...)` for a refused
 * row, a board issue that could not be read and a refs block that could
 * not be read; any other error as it was thrown.
 */
export async function enforceRefsGate(options: RefsGateOptions): Promise<RefsGateAnswer> {
  const output = options.output ?? activeOutput();
  try {
    return options.acceptance === 'none'
      ? await refuseStale(options, output)
      : await acceptAll(options, options.acceptance, output);
  } catch (error) {
    if (error instanceof RefVerifyError || error instanceof RefsBlockError) {
      throw new CommandExit(BOARD_REFUSAL_EXIT, `❌ The references of ${options.source} could not be read: ${messageOf(error)}`);
    }
    throw error;
  }
}
