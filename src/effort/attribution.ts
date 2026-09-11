/**
 * Attributes one session to the plan it was run for, and to the task
 * text it was dispatched with.
 *
 * Both mappings are DERIVED rather than inferred. The reference
 * implementation this collector is modelled on reaches a per-issue
 * attribution by text-matching prompt content and walking merge
 * commits — four functions and a cache. Neither is needed here: every
 * record in these logs carries a top-level `gitBranch`, and this
 * repo's task prompt is assembled by `start.ts` from a single tracker
 * line, so both halves are a split of a string the log already holds.
 *
 * Measured over the live tree at the time of writing — 897 loose
 * session logs, 18 distinct branch values — 889 sessions carried
 * exactly ONE branch, 8 carried several and NONE carried zero. The
 * eight are long-running desktop sessions that outlived a checkout,
 * one of them spanning fifteen branches. So a session's branch is a
 * HISTOGRAM and not a field, and {@link dominantBranch} takes the
 * modal entry rather than assuming there is one. The zero-branch case
 * is handled anyway: `queue-operation` and `last-prompt` records carry
 * no branch, so a session that never ran a turn legitimately has an
 * empty histogram, and that is null rather than a fault.
 *
 * The branch-to-stub step is a SLASH SPLIT and deliberately not a list
 * of recognised branch types. `main` and `pw-align` are the two
 * measured values with no stub, and both fall out of the split for the
 * same reason — no type segment at all — where a type list would have
 * to be maintained and would silently drop attribution for the first
 * branch type nobody had added to it yet.
 *
 * A branch stub is NOT a plan stub, and that is the finding the rest of
 * this module is shaped by. Six of the eleven plan-driven branches name
 * their plan exactly (`feat/q15-ui-pages` against `PLAN-q15-ui-pages.md`);
 * the other five do not, and not by a prefix relation either —
 * `feat/q09-ingest-capture-score` was planned as
 * `q09-port-phase-5-ingest-capture-score`, and `feat/q17-dynamic-forms`
 * as `q17-dynamic-form-provider-v1`. What both halves do share is the
 * leading QUEUE ID, so {@link resolvePlanStub} tries an exact match
 * first and a unique queue-id match second, and answers `none` rather
 * than guessing. `q16` and `q16a` are distinct ids and do not match,
 * which is why the id is matched whole and never as a prefix.
 * Ambiguity is reported with its candidates instead of being settled by
 * an ordering nobody chose.
 *
 * The two stubs stay SEPARATE fields on the row. A report grouping by
 * plan wants the resolved one and has to decide for itself what to do
 * with a branch that resolved to nothing; folding the branch stub in as
 * a fallback here would make those two cases indistinguishable
 * downstream.
 *
 * The task text is the FIRST LINE of the prompt with the shape's own
 * prefix removed, and that is exact rather than approximate:
 * `findNextTask` captures a task line with `(.+)`, which cannot cross a
 * newline, so the text `start.ts` interpolates is single-line by
 * construction and the line after it is the loop's own boilerplate. The
 * prefix is read off {@link PROMPT_SHAPES} rather than retyped, which
 * puts this module behind the classifier's existing drift guard instead
 * of adding a second copy of a literal authored somewhere else.
 *
 * A task line carrying a trailing declaration block is deliberately out
 * of scope. Until the declaration stripper lands the block reaches the
 * prompt verbatim and IS part of the dispatched text; once it lands the
 * prompt no longer carries it. This reader wants no change either way,
 * and parsing the block here would be a second implementation of a
 * grammar that gets its own module.
 *
 * Nothing beyond that one line reaches a row. The task text is the
 * task's own sentence, which the plan file already holds in the clear;
 * no other prompt content, tool output or message body is carried.
 */
import type { SessionKind } from './classify.js';
import type { SessionStats } from './session-log.js';

import { planStubFromPrompt } from '../utils/plan-stamp.js';

import {
  classifyPromptContent,
  matchesShape,
  PROMPT_SHAPES,
} from './classify.js';

/** One branch name split into the two parts attribution reads. */
export interface BranchAttribution {
  /** The branch as recorded, trimmed, or null when there was none. */
  branch: string | null;
  /** The segment before the first slash, or null when there is none. */
  type: string | null;
  /** The segment after it, or null when the branch carries no stub. */
  stub: string | null;
}

/**
 * How a session was matched to a plan.
 *
 * `stamped` is the only member that does not come from a branch name:
 * the loop writes the stub into every prompt it dispatches, so it is
 * read back directly and outranks the branch. The rest describe the
 * branch-stub path, which is the fallback for a session recorded
 * before stamping existed, or one the loop did not dispatch.
 */
export type PlanStubMatch =
  | 'stamped'
  | 'exact'
  | 'queue-id'
  | 'none'
  | 'ambiguous';

/** The plan a branch stub resolved to, and how it got there. */
export interface PlanStubResolution {
  /** The resolved plan stub, or null unless the match is decisive. */
  stub: string | null;
  match: PlanStubMatch;
  /**
   * Every plan stub the queue id reached. One member on a `queue-id`
   * match, the branch stub itself on an `exact` one, and the whole
   * contested set on an `ambiguous` one — which is what makes an
   * ambiguity reportable rather than merely refused.
   */
  candidates: readonly string[];
}

/** The modal branch of a session, with the spread it was chosen from. */
export interface DominantBranch {
  /** The branch the most records carried, or null for none at all. */
  branch: string | null;
  /** Records carrying it; 0 when there is no branch. */
  recordCount: number;
  /** Distinct branches seen; above 1 outlived a checkout. */
  distinctCount: number;
}

/** One session's attribution row. Carries no transcript content. */
export interface SessionAttribution {
  sessionId: string;
  /** The modal branch; see {@link dominantBranch} for the tie rule. */
  branch: string | null;
  branchRecordCount: number;
  distinctBranchCount: number;
  branchType: string | null;
  branchStub: string | null;
  /** The resolved plan, or null — never the branch stub as a fallback. */
  planStub: string | null;
  planStubMatch: PlanStubMatch;
  kind: SessionKind;
  /** The dispatched task sentence, or null for every other kind. */
  taskText: string | null;
}

/**
 * A plan file, as `plan.ts` writes it: `PLAN-<stub>.md`.
 *
 * Anchored at both ends so the two siblings sharing the directory are
 * excluded by construction rather than by a filter — `PREREQUISITES-`
 * fails at the front, and `PLAN_TRACKER-` fails on the underscore that
 * a looser `^PLAN` would have let through.
 */
const PLAN_FILE_NAME = /^PLAN-(.+)\.md$/;

/**
 * A leading queue id: `q` then digits then an optional letter, ending
 * at a hyphen or at the end of the stub.
 *
 * The terminator is what keeps `q16` and `q16a` distinct. Matching the
 * id as a bare prefix would fold a `q16` branch onto a `q16a` plan and
 * report it as a decisive match.
 */
const QUEUE_ID = /^(q\d+[a-z]?)(?:-|$)/;

/** The task shape, looked up once; see the module note on drift. */
const TASK_SHAPE = PROMPT_SHAPES.find((shape) => shape.kind === 'task');

/** The content up to its first line break, or all of it if there is none. */
function firstLineOf(content: string): string {
  const breakAt = content.indexOf('\n');
  return breakAt === -1
    ? content
    : content.slice(0, breakAt);
}

/**
 * Splits a branch name into its type prefix and its plan stub.
 *
 * A name with no slash has no stub — that is the `main` and `pw-align`
 * case and it is the expected answer, not a degraded one. A stub that
 * would itself contain a slash is refused for a narrower reason: no
 * plan file can be named after it, `plan.ts` writing
 * `PLAN-<stub>.md` into one flat directory.
 */
export function attributeBranch(
  branch: string | null | undefined,
): BranchAttribution {
  const name = typeof branch === 'string'
    ? branch.trim()
    : '';
  if (name.length === 0) return { branch: null, type: null, stub: null };

  const slashAt = name.indexOf('/');
  if (slashAt <= 0) return { branch: name, type: null, stub: null };

  const type = name.slice(0, slashAt);
  const stub = name.slice(slashAt + 1);
  return stub.length === 0 || stub.includes('/')
    ? { branch: name, type, stub: null }
    : { branch: name, type, stub };
}

/**
 * Reads plan stubs out of a directory listing.
 *
 * Takes names rather than a directory so the naming convention lives in
 * one place while the read stays with the caller — `.plans/` is
 * gitignored and can be absent entirely, which is the caller's problem
 * to report and not this module's to guess at.
 *
 * Duplicates are collapsed: two listings concatenated would otherwise
 * make every queue-id match ambiguous against a stub and itself.
 */
export function planStubsFromFileNames(
  fileNames: readonly string[],
): string[] {
  const stubs = new Set<string>();

  for (const fileName of fileNames) {
    const match = PLAN_FILE_NAME.exec(fileName);
    if (match === null) continue;

    const stub = match[1];
    if (stub === undefined || stub.length === 0) continue;
    stubs.add(stub);
  }
  return [...stubs];
}

/** The leading queue id of a stub, or null when it carries none. */
export function queueIdOf(stub: string | null | undefined): string | null {
  if (typeof stub !== 'string') return null;

  const match = QUEUE_ID.exec(stub);
  return match === null
    ? null
    : match[1] ?? null;
}

/**
 * Resolves a branch stub against the known plan stubs.
 *
 * Exact first, then a queue id that reaches exactly one plan. Anything
 * else answers `none` or `ambiguous` with its candidates — a report
 * would rather show an unattributed bucket than attribute a plan's
 * spend to the wrong plan.
 */
export function resolvePlanStub(
  branchStub: string | null | undefined,
  planStubs: readonly string[],
): PlanStubResolution {
  if (typeof branchStub !== 'string' || branchStub.length === 0) {
    return { stub: null, match: 'none', candidates: [] };
  }
  if (planStubs.includes(branchStub)) {
    return { stub: branchStub, match: 'exact', candidates: [branchStub] };
  }

  const queueId = queueIdOf(branchStub);
  if (queueId === null) return { stub: null, match: 'none', candidates: [] };

  const candidates = planStubs.filter((stub) => queueIdOf(stub) === queueId);
  if (candidates.length === 1) {
    return { stub: candidates[0] ?? null, match: 'queue-id', candidates };
  }
  return candidates.length === 0
    ? { stub: null, match: 'none', candidates }
    : { stub: null, match: 'ambiguous', candidates };
}

/**
 * Extracts the task sentence the loop dispatched, or null.
 *
 * Null for every prompt shape that is not a task, for content that is
 * not a string, and for a prefix followed by nothing — an empty task
 * text is no task text. The shape test is {@link matchesShape} rather
 * than a bare `startsWith`, so a shape that later grows a first-line
 * infix is honoured here without a second edit.
 */
export function taskTextFromPrompt(
  content: string | null | undefined,
): string | null {
  if (TASK_SHAPE === undefined) return null;
  if (typeof content !== 'string') return null;
  if (!matchesShape(content, TASK_SHAPE)) return null;

  const text = firstLineOf(content)
    .slice(TASK_SHAPE.prefix.length)
    .trim();
  return text.length === 0
    ? null
    : text;
}

/**
 * Picks the branch the most records carried.
 *
 * Ties go to the lexically smallest name. Object key order would
 * otherwise decide it, which is insertion order — stable in practice
 * and a property of how the histogram happened to be built rather than
 * of the session, so two readers folding the same records in different
 * orders could disagree. A non-positive count is not a sighting.
 */
export function dominantBranch(
  counts: Readonly<Record<string, number>>,
): DominantBranch {
  const entries = Object.entries(counts);
  let branch: string | null = null;
  let recordCount = 0;

  for (const [name, count] of entries) {
    if (count <= 0) continue;

    const wins = count > recordCount
      || (count === recordCount && branch !== null && name < branch);
    if (!wins) continue;

    branch = name;
    recordCount = count;
  }
  return { branch, recordCount, distinctCount: entries.length };
}

/**
 * Builds one attribution row from a stats row and its enqueue content.
 *
 * Takes the two fields it reads rather than the whole
 * {@link SessionStats}, which keeps the coupling visible and lets a
 * caller holding only a histogram use it. The roster is required rather
 * than defaulted: an empty one is a legitimate answer — no `.plans/`
 * directory — and a caller that forgot to pass one would otherwise get
 * the identical all-`none` result with nothing saying which it was.
 */
/**
 * Resolves a session's plan, stamp first and branch second.
 *
 * A stamp naming a plan the store does not know does NOT win. It is
 * ignored and the branch answers instead, because a stub nobody can
 * corroborate is a guess wearing a derivation's clothes — a renamed
 * or deleted plan would otherwise mint a group of one that no plan
 * file backs.
 */
export function resolveSessionPlan(
  enqueueContent: string | null,
  branchStub: string | null | undefined,
  planStubs: readonly string[],
): PlanStubResolution {
  const stamped = planStubFromPrompt(enqueueContent);
  if (stamped !== null && planStubs.includes(stamped)) {
    return { stub: stamped, match: 'stamped', candidates: [stamped] };
  }
  return resolvePlanStub(branchStub, planStubs);
}

export function attributeSession(
  stats: Pick<SessionStats, 'sessionId' | 'gitBranchCounts'>,
  enqueueContent: string | null,
  planStubs: readonly string[],
): SessionAttribution {
  const dominant = dominantBranch(stats.gitBranchCounts);
  const branch = attributeBranch(dominant.branch);
  const plan = resolveSessionPlan(enqueueContent, branch.stub, planStubs);

  return {
    sessionId: stats.sessionId,
    branch: branch.branch,
    branchRecordCount: dominant.recordCount,
    distinctBranchCount: dominant.distinctCount,
    branchType: branch.type,
    branchStub: branch.stub,
    planStub: plan.stub,
    planStubMatch: plan.match,
    kind: classifyPromptContent(enqueueContent),
    taskText: taskTextFromPrompt(enqueueContent),
  };
}
