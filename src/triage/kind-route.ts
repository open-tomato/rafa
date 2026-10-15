/**
 * The kind routing of an `out_of_scope_bugs` entry ({@link routeByKind}):
 * where an entry goes once the security rule and the kind check
 * (`checkKind`, `./own-check.ts`) have read it. Of the six kinds only
 * `bug` reaches a tracker as an issue of its own; every other kind is
 * settled here, with no tracker call.
 *
 * `triageReport` (`./triage.ts`) makes one call per entry, after the
 * machine-fault reading and after an entry with no usable `what` is
 * skipped, and before anything is looked up. It answers either a settled
 * row, which `triageReport` keeps as it is, or an unsettled answer,
 * which sends the entry on to the public or private channel as before
 * kinds existed.
 *
 * ## The order
 *
 *   1. **Kinds off.** With `kinds` left out of the triage's options,
 *      every entry is unsettled with no kind, and is triaged exactly as
 *      before this module existed. `start/triage.ts` is what hands it.
 *   2. **The security rule.** An entry whose `security` is `true` or
 *      missing is unsettled under the kind it was said as, and takes the
 *      private channel whatever its kind: no security entry reaches a
 *      repair task, the follow-up issue, the pull request body or the
 *      store's `stale_docs` table, and no test is run for it.
 *   3. **The kind check.** For an entry said `bug`, `own-fallout` or
 *      `own-gap` that names a test case, the case is run on the head,
 *      then, only when it is `red` there, on the plan's base, through
 *      {@link KindRouteOptions.runTest}. The check then reads the entry,
 *      those readings and the plan's files. The other three kinds are
 *      taken as said and run nothing.
 *   4. **The route** of the kind the check answered, from the stage
 *      table below.
 *
 * ## The table
 *
 * | Kind | Answer |
 * | --- | --- |
 * | `bug`, inherited | unsettled, `inherited`: no issue is filed |
 * | `bug` | unsettled: the public channel, as before |
 * | `machine` | settled, `skipped` on the `machine` channel |
 * | `docs` | settled, `docs` on the `docs` channel: a `sighting` row of `stale_docs` |
 * | `convention` | settled, `pr-body` |
 * | `own-fallout`, `own-gap` | settled, `repair` while the plan's leftover repairs are below the cap, else `follow-up` |
 *
 * A settled `pr-body`, `follow-up` or `repair` row is on the `public`
 * channel, the one the security rule let it take; no tracker is called
 * for it. Its `bug_routes` row and, for `follow-up` and `pr-body`, the
 * issue line or body line it becomes are the wrap-up's, written from
 * the row's `kind` and action; nothing is written here for either.
 *
 * **A repair** is inserted through `insertLeftoverRepair`
 * (`./leftover-repair.ts`) above the first open plan task, its `what`
 * and `artifact` redacted first, as every text the triage writes is: a
 * repair task names files relative to the checkout and no secret. The
 * cap is {@link KindRouteOptions.retries}, `false` reading as zero, so
 * under the default every leftover is a `follow-up`. A tracker that
 * cannot be read, or a line it refuses, sends the entry to `follow-up`
 * too, its problem naming the failure, so the entry is never lost.
 *
 * **A `docs` entry** is stored through `writeStaleDocs` as a `sighting`,
 * its `what` the entry's `what` and its `where` the first path
 * `pathsNamedIn` (`./doc-only.ts`) finds in the `what`, then in the
 * `artifact`, or null when neither names one. A write that throws or
 * refuses the entry keeps the action and names the problem, as a
 * reference the store refuses does in `./triage.ts`.
 *
 * ## The readings
 *
 * {@link KindRouteOptions.runTest} is `runNamedTestAt` (`./base-run.ts`)
 * with the run's checkout and cache bound in; a unit test hands a stub.
 * The head is run first, since a case not `red` there reads as `bug`
 * whatever its base says, so the base run is saved. A plan base that was
 * not read, a head commit that was not read and a runner that throws
 * each read `unrunnable`, and so as `bug`: the cost of a reading the
 * loop could not take falls on filing, never on hiding.
 */
import type { BaseRunAnswer, NamedTest } from './base-run.js';
import type { KindCheck, NamedTestReadings } from './own-check.js';
import type { PlanBaseReading, PlanFilesReading } from './plan-commits.js';
import type { BugTriage, BugTriageAction, TriageOptions } from './triage.js';
import type { LoopRetries } from '../config-schema-loop-retries.js';
import type { BugKind, ReportBug } from '@open-tomato/rafa/report/parse';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { writeStaleDocs } from '@open-tomato/rafa/store/stale-docs';

import { artifactOf } from './bug-key.js';
import { pathsNamedIn } from './doc-only.js';
import { insertLeftoverRepair } from './leftover-repair.js';
import { CHECKED_KINDS, checkKind, namedTestOf } from './own-check.js';

/** What the kind routing reads beside the entry: the check's inputs and the repair cap. */
export interface KindRouteOptions {
  /** The plan's base, as `readPlanBase` read it. */
  readonly planBase: PlanBaseReading;
  /** The commit the head reading is taken at, or null when it was not read. */
  readonly head: string | null;
  /** The plan's files, as `readPlanFiles` read them. */
  readonly planFiles: PlanFilesReading;
  /** Runs a named test at a commit: `runNamedTestAt` with the run's checkout and cache bound in. */
  readonly runTest: (commit: string, test: NamedTest) => Promise<BaseRunAnswer>;
  /** The run's resolved retry count, the cap on the plan's leftover repairs; `false` is none. */
  readonly retries: LoopRetries;
}

/** What {@link routeByKind} reads of the triage's options. */
export type KindRouteContext = Pick<
  TriageOptions,
  'repoRoot' | 'trackerPath' | 'dispatch' | 'outcome' | 'seams' | 'kinds'
>;

/** One entry on its way to {@link routeByKind}. */
export interface KindRouteEntry {
  /** The entry, as the report parser read it. */
  readonly bug: ReportBug;
  /** Its index in the report's parsed list. */
  readonly index: number;
  /** Its `what`, already known to hold text. */
  readonly what: string;
  /** Takes local paths and named secrets out of a text. */
  readonly redact: (text: string) => string;
}

/** What {@link routeByKind} answered. */
export type KindRouting =
  /** The entry went where its kind sends it; `row` is its result. */
  | { readonly settled: true; readonly row: BugTriage }
  /**
   * The entry goes on to the public or private channel. `kind` is the
   * kind it goes under, null with kinds off; `inherited` is true when the
   * check read its test as red on the plan's base and head.
   */
  | { readonly settled: false; readonly kind: BugKind | null; readonly inherited: boolean };

/** The answer that sends an entry on unchanged. */
const KINDS_OFF: KindRouting = Object.freeze({ settled: false, kind: null, inherited: false });

/** An `unrunnable` reading saying `problem`. */
function unrunnable(problem: string): BaseRunAnswer {
  return { answer: 'unrunnable', problem };
}

/** Runs `test` at `commit`, answering a throw as `unrunnable`. */
async function runSafely(options: KindRouteOptions, commit: string, test: NamedTest): Promise<BaseRunAnswer> {
  try {
    return await options.runTest(commit, test);
  } catch (error) {
    return unrunnable(`Running ${test.file} at ${commit} failed: ${messageOf(error)}`);
  }
}

/**
 * The named test's readings on the head and the plan's base, or null
 * when the entry's kind is not checked or it names no test case with a
 * file; see the module note for why the head runs first.
 */
async function readingsOf(bug: ReportBug, options: KindRouteOptions): Promise<NamedTestReadings | null> {
  if (!CHECKED_KINDS.includes(bug.kind)) return null;
  const test = namedTestOf(bug);
  if (test === null) return null;
  const head = options.head === null
    ? unrunnable('The head commit was not read, so the case was not run on it.')
    : await runSafely(options, options.head, test);
  if (head.answer !== 'red') return { base: unrunnable('The case was not run on the plan\'s base, since it is not red on the head.'), head };
  const base = options.planBase.ok
    ? await runSafely(options, options.planBase.sha, test)
    : unrunnable(options.planBase.problem);
  return { base, head };
}

/** A settled row for the entry, its unset fields null. */
function settledRow(
  entry: KindRouteEntry,
  channel: BugTriage['channel'],
  action: BugTriageAction,
  kind: BugKind,
  fields: Partial<BugTriage> = {},
): KindRouting {
  return {
    settled: true,
    row: {
      index: entry.index,
      channel,
      action,
      ref: null,
      foundBy: null,
      stored: null,
      problem: null,
      kind,
      ...fields,
    },
  };
}

/** The `where` of a `docs` entry's row: the first path its `what`, then its `artifact`, names. */
export function docsWhereOf(bug: Pick<ReportBug, 'what' | 'artifact'>): string | null {
  const [first] = [...pathsNamedIn(bug.what ?? ''), ...pathsNamedIn(bug.artifact ?? '')];
  return first ?? null;
}

/** Stores a `docs` entry as a `sighting` row of `stale_docs`; see the module note. */
function routeDocs(entry: KindRouteEntry, context: KindRouteContext): KindRouting {
  const name = `out_of_scope_bugs[${entry.index}]`;
  try {
    const written = writeStaleDocs(context.repoRoot, {
      dispatch: context.dispatch,
      outcome: context.outcome,
      kind: 'sighting',
      staleDocs: [{ where: docsWhereOf(entry.bug), what: entry.what, extras: [] }],
    }, context.seams);
    const [rejected] = written.rejected;
    const problem = rejected === undefined
      ? null
      : entry.redact(`${name}: the stale-doc row was not stored: ${rejected.text}`);
    return settledRow(entry, 'docs', 'docs', 'docs', { problem });
  } catch (error) {
    return settledRow(entry, 'docs', 'docs', 'docs', {
      problem: entry.redact(`${name}: the stale-doc row was not stored: ${messageOf(error)}`),
    });
  }
}

/** Inserts the repair of an `own-` leftover, or answers `follow-up` past the cap; see the module note. */
function routeLeftover(
  entry: KindRouteEntry,
  kind: 'own-fallout' | 'own-gap',
  trackerPath: string,
  retries: LoopRetries,
): KindRouting {
  const artifact = artifactOf(entry.bug);
  try {
    const inserted = insertLeftoverRepair(trackerPath, {
      kind,
      what: entry.redact(entry.what),
      artifact: artifact === null
        ? null
        : entry.redact(artifact),
    }, retries);
    return inserted.inserted
      ? settledRow(entry, 'public', 'repair', kind, { repairLine: inserted.line })
      : settledRow(entry, 'public', 'follow-up', kind);
  } catch (error) {
    return settledRow(entry, 'public', 'follow-up', kind, {
      problem: entry.redact(`out_of_scope_bugs[${entry.index}]: the repair task was not inserted, so it is a follow-up: ${messageOf(error)}`),
    });
  }
}

/** The route of the kind the check answered; see the module note's table. */
function routeChecked(entry: KindRouteEntry, check: KindCheck, context: KindRouteContext, options: KindRouteOptions): KindRouting {
  switch (check.kind) {
    case 'bug':
      return { settled: false, kind: 'bug', inherited: check.inherited };
    case 'machine':
      return settledRow(entry, 'machine', 'skipped', 'machine', {
        problem: entry.redact(`out_of_scope_bugs[${entry.index}] is machine-scoped, as its kind says: ${entry.what}`),
      });
    case 'docs':
      return routeDocs(entry, context);
    case 'convention':
      return settledRow(entry, 'public', 'pr-body', 'convention');
    case 'own-fallout':
    case 'own-gap':
      return routeLeftover(entry, check.kind, context.trackerPath, options.retries);
  }
}

/**
 * Routes one entry by its kind, after the security rule and the kind
 * check: a settled row for every kind but `bug`, which no tracker was
 * called for, or an unsettled answer sending it on to the public or
 * private channel. Never rejects; see the module note.
 */
export async function routeByKind(entry: KindRouteEntry, context: KindRouteContext): Promise<KindRouting> {
  const options = context.kinds;
  if (options === undefined) return KINDS_OFF;
  if (entry.bug.security !== false) return { settled: false, kind: entry.bug.kind, inherited: false };
  return routeChecked(entry, await checkedKindOf(entry.bug, options), context, options);
}

/**
 * The kind check's answer for one entry: its named test read on the head
 * and the plan's base as {@link routeByKind} reads it, then `checkKind`.
 * Exported so `start/triage.ts` can tell, before `triageReport`, whether
 * a report routes anything to the public tracker; the security rule is
 * the caller's. Never rejects.
 */
export async function checkedKindOf(bug: ReportBug, options: KindRouteOptions): Promise<KindCheck> {
  const readings = await readingsOf(bug, options);
  return checkKind({ entry: bug, readings, planFiles: options.planFiles });
}
