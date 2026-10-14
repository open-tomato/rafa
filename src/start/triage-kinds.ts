/**
 * The kind routing of `loop start`'s triage (`start/triage.ts`): the
 * readings each report's `out_of_scope_bugs` entries are routed by, and
 * the `bug_routes` row each routed entry leaves in the store.
 *
 * ## The readings, per report
 *
 * {@link createKindReader} is made once per run, from the run's checkout,
 * its `pr.base` and its resolved retry count, and answers one
 * {@link KindRouteOptions} per report that lists an out-of-scope entry,
 * which `start/triage.ts` hands to `triageReport` as its `kinds`:
 *
 *   - **the plan's base**, `readPlanBase` over the base branch
 *     `resolveBaseBranch` answers for `pr.base`, the branch resolved once
 *     per run and the merge base read again for each report;
 *   - **the head**, `git rev-parse HEAD` in the checkout, null when git
 *     answers no commit;
 *   - **the plan's files**, `readPlanFiles` from that base, a `problem`
 *     when the base was not read. A later task's commit adds files, so
 *     they are read again for every report;
 *   - **the test runner**, `runNamedTestAt` over the checkout with one
 *     `createBaseRunCache` for the run, so a file is run at most once per
 *     commit for the whole run. Each report's options also keep one
 *     answer per commit, file and case, so the check `start/triage.ts`
 *     takes before resolving the public tracker and the one
 *     `triageReport` takes read the same answer from one run;
 *   - **the cap**, the run's resolved retry count (`resolveRunRetries`),
 *     `false` reading as zero.
 *
 * Nothing here throws: a git that cannot run is a reading with a
 * `problem`, which the check reads as a base it cannot run on, and so
 * as `bug` (`triage/kind-route.ts`).
 *
 * ## The rows
 *
 * {@link bugRouteEntriesOf} answers one `bug_routes` entry
 * (`effort/store/bug-routes.ts`) per out-of-scope entry the triage
 * routed, and {@link storeBugRoutes} writes them under the task's
 * dispatch. The route is where the triage SENT the entry, not whether a
 * tracker took it:
 *
 * | What the triage answered | Route |
 * | --- | --- |
 * | the `machine` channel | `machine` |
 * | the `private` channel, whatever its action | `private` |
 * | `inherited` | `inherited` |
 * | `repair`, `follow-up`, `pr-body`, `docs` | the same word |
 * | the public channel: filed, commented on, or failed | `filed` |
 * | skipped for no usable `what` | no row |
 *
 * `kind` is the kind the triage routed the entry under: the row's own
 * `kind`, else `machine` on the machine channel, else the kind the
 * parser read. `said` is the kind the session wrote, read off the
 * report's own block body ({@link saidKindsOf}): null for an entry with no
 * `kind` key, and for one whose value is none of the six, which the
 * parser reads as `bug`. A store that refuses the write, or an entry it
 * refuses, is one warning line; neither stops the run.
 */
import type { LoopRetries } from '../config-schema-loop-retries.js';
import type { GitRunner } from '../core/git/index.js';
import type { BugRouteEntry, BugRoute } from '../effort/store/bug-routes.js';
import type { FindingsDispatch, FindingsWriterSeams } from '../effort/store/findings.js';
import type { BugKind, TaskReport } from '../report/parse.js';
import type { BaseRunAnswer, NamedTest } from '../triage/base-run.js';
import type { KindRouteOptions } from '../triage/kind-route.js';
import type { BugTriage, TriageResult } from '../triage/triage.js';

import { resolveBaseBranch } from '../cleanup/branches.js';
import { messageOf } from '../core/config/sections.js';
import { createGitRunner } from '../core/git/index.js';
import { writeBugRoutes } from '../effort/store/bug-routes.js';
import { BUG_KINDS } from '../report/parse.js';
import { createBaseRunCache, runNamedTestAt } from '../triage/base-run.js';
import { readPlanBase, readPlanFiles } from '../triage/plan-commits.js';

/** What the run's kind routing is made with. */
export interface StartKindOptions {
  /** The run checkout: git runs here, and the named tests run from its `node_modules`. */
  readonly checkout: string;
  /** The run's `pr.base`, or null for the branch `origin`'s `HEAD` names. */
  readonly prBase: string | null;
  /** The run's resolved retry count, the cap on the plan's leftover repairs. */
  readonly retries: LoopRetries;
  /** Git run in the checkout; `createGitRunner(checkout)` when left out. */
  readonly git?: GitRunner;
  /** Runs a named test at a commit; `runNamedTestAt` over the checkout when left out. */
  readonly runTest?: (commit: string, test: NamedTest) => Promise<BaseRunAnswer>;
}

/** Answers the readings one report is routed by; see the module note. */
export type KindReader = () => KindRouteOptions;

/** The commit `HEAD` names in the checkout, or null when git answers none. */
function readHead(git: GitRunner): string | null {
  const read = git(['rev-parse', 'HEAD']);
  const sha = read.stdout.trim();
  return read.ok && sha !== ''
    ? sha
    : null;
}

/** `run`, keeping one answer per commit, file and case. */
function remembering(run: KindRouteOptions['runTest']): KindRouteOptions['runTest'] {
  const answers = new Map<string, Promise<BaseRunAnswer>>();
  return (commit, test) => {
    const key = `${commit}\0${test.file}\0${test.name}`;
    const answer = answers.get(key) ?? run(commit, test);
    answers.set(key, answer);
    return answer;
  };
}

/**
 * Makes the run's reader of the kind routing's readings: the base branch
 * not yet resolved, one test cache for the run. See the module note.
 */
export function createKindReader(options: StartKindOptions): KindReader {
  const git = options.git ?? createGitRunner(options.checkout);
  const cache = createBaseRunCache();
  const runTest = options.runTest
    ?? ((commit: string, test: NamedTest) => runNamedTestAt(commit, test, { checkout: options.checkout, cache, git }));
  let base: string | null = null;

  return () => {
    base ??= resolveBaseBranch(git, options.prBase);
    const planBase = readPlanBase(git, base);
    return {
      planBase,
      head: readHead(git),
      planFiles: planBase.ok
        ? readPlanFiles(git, planBase.sha)
        : { ok: false, problem: planBase.problem },
      runTest: remembering(runTest),
      retries: options.retries,
    };
  };
}

/** True for a mapping: an object that is no list. */
function isEntry(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The kind the session wrote for each `out_of_scope_bugs` entry the
 * parser kept, in the parsed list's order: null for an entry with no
 * `kind` key or a value none of the six. Read off `body`, the report
 * block's own body, since the parser reads both as `bug`; a body that
 * does not read answers none.
 */
export function saidKindsOf(body: string): readonly (BugKind | null)[] {
  let document: unknown;
  try {
    document = Bun.YAML.parse(body);
  } catch {
    return [];
  }
  const entries = isEntry(document)
    ? document.out_of_scope_bugs
    : null;
  if (!Array.isArray(entries)) return [];
  return entries.filter(isEntry).map((entry) => {
    const said = entry.kind;
    return (BUG_KINDS as readonly unknown[]).includes(said)
      ? said as BugKind
      : null;
  });
}

/** Where the triage sent one entry, or null for one it skipped for no usable `what`. */
export function routeOf(bug: BugTriage): BugRoute | null {
  if (bug.channel === 'machine') return 'machine';
  if (bug.channel === 'private') return 'private';
  switch (bug.action) {
    case 'repair':
    case 'follow-up':
    case 'pr-body':
    case 'docs':
    case 'inherited':
      return bug.action;
    case 'skipped':
      return null;
    case 'filed':
    case 'commented':
    case 'failed':
      return 'filed';
  }
}

/**
 * One `bug_routes` entry per out-of-scope entry `result` routed, in the
 * report's order; see the module note's table. `said` is
 * {@link saidKindsOf} over the report's block body.
 */
export function bugRouteEntriesOf(
  result: Pick<TriageResult, 'bugs'>,
  report: Pick<TaskReport, 'outOfScopeBugs'>,
  said: readonly (BugKind | null)[],
): BugRouteEntry[] {
  return result.bugs.flatMap((bug): BugRouteEntry[] => {
    const reported = report.outOfScopeBugs[bug.index];
    const route = routeOf(bug);
    if (reported === undefined || route === null || typeof reported.what !== 'string') return [];
    const fallback: BugKind = bug.channel === 'machine'
      ? 'machine'
      : reported.kind;
    return [{
      entryIndex: bug.index,
      what: reported.what,
      said: said[bug.index] ?? null,
      kind: bug.kind ?? fallback,
      route,
    }];
  });
}

/**
 * Stores `routes` under `dispatch`, answering a warning sentence for each
 * entry the store refused, or one for a write it refused whole. Never
 * throws; see the module note.
 */
export function storeBugRoutes(
  repoRoot: string,
  dispatch: FindingsDispatch,
  routes: readonly BugRouteEntry[],
  seams?: FindingsWriterSeams,
): string[] {
  if (routes.length === 0) return [];
  try {
    const written = writeBugRoutes(repoRoot, { dispatch, routes }, seams);
    return written.rejected.map((rejection) => `out_of_scope_bugs: ${rejection.text}.`);
  } catch (error) {
    return [`out_of_scope_bugs: their routes were not stored: ${messageOf(error)}`];
  }
}
