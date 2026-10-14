/**
 * Branch and plan-stub resolution: how a branch name splits into a type
 * and a stub, how plan stubs are read out of a directory listing, and
 * how a branch stub resolves against them.
 *
 * Moved down from `src/effort/attribution.ts`, which attributes a
 * session to its plan, issue and task text and re-exports these names
 * under the same names: the store's row types (`types.ts`) and its plan
 * CI reader (`plan-ci.ts`) need the resolution but not the session
 * attribution, so they import it here and the store imports nothing
 * above core for it. The module note of `attribution.ts` still explains
 * why a branch stub is not a plan stub and why the queue id is matched
 * whole.
 */
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
 * one place while the read stays with the caller — the plans directory,
 * `plan.dir`, is untracked by default and can be absent entirely, which
 * is the caller's problem to report and not this module's to guess at.
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
