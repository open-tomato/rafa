/**
 * The claim a `rafa plan create` run makes on its issue, wired in
 * BEFORE its planning session, so a lost race costs no session
 * (`.rafa/plans/rafa-324-claim-issue-so-two`). `src/claims/plan-claim.ts`
 * makes the claim and answers claimed, refused or unclaimed; this module
 * is what the command does with each answer, and the loop that lets
 * `--next` walk on past a refused issue.
 *
 * ## Where the claim runs
 *
 * {@link resolveAndClaim} resolves the spec, then runs the command's
 * cheap refusals over it ({@link ClaimRouteSeams.prepare}: the stub, the
 * plan already there and the references check), then claims. So a run
 * refused for its words or its board's state makes no claim, and the
 * claim is the last thing before the usage check, the notices and the
 * session. A run that stops without a spec (`--dry-run`, an exhausted or
 * blocked roadmap) claims nothing.
 *
 * ## What each answer does
 *
 * | Answer | `--issue`, or `--spec` naming `rafa-<n>-` | `--next` |
 * |---|---|---|
 * | claimed | one line naming the branch and the store, then the plan | the same |
 * | refused | exit {@link CLAIM_REFUSAL_EXIT}, naming the owner | the issue passed, the walk resolved again |
 * | unclaimed | a warning with the reason, then the plan | the same |
 *
 * A `--spec` whose name opens no `rafa-<n>-` names no issue, so there is
 * nothing to claim: its `no-issue` answer prints nothing, and the run is
 * the one it always was. Every other unclaimed answer is a warning:
 * no reachable remote (the claim commit waits on the local branch for
 * `loop start`'s preflight to push), a store that names no claimant
 * (its reason names `rafa effort move --to=sqlite`), a `--stub` that
 * is no claim branch of the issue, or a claim ahead whose line ahead
 * could not be claimed (both or neither: the home claim commit waits on
 * the local branch as with no remote). An answer that carries a claim
 * ahead report (`src/claims/ahead.ts`) prints it next, one line for the
 * line ahead claimed and a warning for one not claimed. The warnings a
 * claimed or unclaimed answer carries, a label that could not be
 * written among them, are printed after it.
 *
 * ## `--next` walks on
 *
 * A refused `--next` pick is printed as passed, with the reason naming
 * its owner, and the spec is resolved again with every issue refused so
 * far handed in as `passOver` (`src/board/spec-source-roadmap.ts`), which
 * reads each as taken by the branch that refused it. So the walk goes on
 * to the next line, and ends as a walk ends: on a line to plan, or
 * stopped with nothing left. An issue refused twice in one run is a
 * defect in the walk and is thrown, never looped on. The first
 * resolution's snapshot of the refused issue stays under `specs.dir`;
 * it is the text of an issue either way.
 *
 * A store that cannot be read is not caught here: `readDeviceStoreId`
 * throws what the store's open throws, and the command ends on it.
 */
import type { GateIssue } from '../../board/gate.js';
import type { PlanSpecResolution } from '../../board/plan-spec.js';
import type { ResolvedSpec } from '../../board/spec-source.js';
import type { PlanClaim, PlanClaimContext, PlanClaimRequest } from '../../claims/plan-claim.js';
import type { RafaConfig } from '../../config.js';
import type { Output } from '../../ports/index.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { aheadClaimedLine, aheadNotClaimedWarning } from '../../claims/ahead.js';
import { readDeviceStoreId } from '../../claims/device.js';
import { CommandExit } from '../../cli/command.js';
import { createGitRunner } from '../../pr/git.js';
import { resolvePrProvider } from '../../pr/provider.js';

/** The exit code a refused `--issue` or `--spec` run ends with: another store holds the issue. */
export const CLAIM_REFUSAL_EXIT = 1;

/** Issues passed over this run, each with the branch whose claim refused it. */
export type PassOver = ReadonlyMap<number, string>;

/** How {@link resolveAndClaim} reaches the resolution, the refusals, the claim and the output. */
export interface ClaimRouteSeams {
  /** Resolves the spec, the issues in `passOver` read as taken by a `--next` walk. */
  readonly resolve: (passOver: PassOver) => Promise<PlanSpecResolution>;
  /** Runs the command's cheap refusals over the spec and answers the plan's stub. */
  readonly prepare: (spec: ResolvedSpec) => Promise<string>;
  /** Claims the issue; `claimPlanIssue` over the run's context. */
  readonly claim: (request: PlanClaimRequest) => Promise<PlanClaim>;
  /** Where the lines go. */
  readonly output: Output;
}

/** What {@link resolveAndClaim} answers: a spec to plan with its stub and claim, or a stop. */
export type ClaimedRoute =
  | { readonly outcome: 'stopped' }
  | {
    readonly outcome: 'spec';
    readonly spec: ResolvedSpec;
    readonly gate: GateIssue | null;
    readonly stub: string;
    readonly claim: PlanClaim;
  };

/** The refusal a run that plans one named issue ends with, naming the owner through the reason. */
export function claimRefusalMessage(claim: Extract<PlanClaim, { outcome: 'refused' }>): string {
  return `❌ Refusing to plan issue #${String(claim.issue)}: ${claim.reason}. No session was started.`;
}

/** The line a `--next` walk prints for an issue whose claim was refused. */
export function passedOverLine(claim: Extract<PlanClaim, { outcome: 'refused' }>): string {
  return `   ⏭  #${String(claim.issue)} passed: ${claim.reason}; the walk goes on`;
}

/** The line a claimed run prints, naming how it came to hold the claim. */
export function claimedLine(claim: Extract<PlanClaim, { outcome: 'claimed' }>): string {
  const issue = `#${String(claim.issue)}`;
  const store = `store ${claim.storeId}`;
  if (claim.via === 'held') return `🔒 ${issue} is already claimed by this device (${store}) on ${claim.branch}.`;
  return claim.via === 'take'
    ? `🔒 Took over the claim on ${issue}: ${claim.branch} now names ${store}.`
    : `🔒 Claimed ${issue} on ${claim.branch} for ${store}.`;
}

/** The warning an unclaimed run prints before its plan is written, or null for a run with no issue. */
export function unclaimedWarning(claim: Extract<PlanClaim, { outcome: 'unclaimed' }>): string | null {
  if (claim.cause === 'no-issue' || claim.issue === null) return null;
  return `⚠️  Planning issue #${String(claim.issue)} unclaimed: ${claim.reason}`;
}

/** Prints a claimed or unclaimed answer and the warnings it carries. */
function report(claim: Exclude<PlanClaim, { outcome: 'refused' }>, output: Output): void {
  if (claim.outcome === 'claimed') {
    output.info(claimedLine(claim));
  } else {
    const warning = unclaimedWarning(claim);
    if (warning !== null) output.warn(warning);
  }
  if (claim.ahead?.outcome === 'claimed') output.info(aheadClaimedLine(claim.ahead));
  if (claim.ahead?.outcome === 'not-claimed') output.warn(aheadNotClaimedWarning(claim.ahead));
  claim.warnings.forEach((warning) => output.warn(`⚠️  ${warning}`));
}

/**
 * The spec a `plan create` run plans from, its stub and the claim made
 * on its issue, or a stop. Throws `CommandExit({@link CLAIM_REFUSAL_EXIT})`
 * when the claim on a named issue is refused, and whatever the seams
 * throw. See the module note.
 */
export async function resolveAndClaim(seams: ClaimRouteSeams): Promise<ClaimedRoute> {
  const { output } = seams;
  let passOver: PassOver = new Map<number, string>();
  for (;;) {
    const resolved = await seams.resolve(passOver);
    if (resolved.outcome === 'stopped') return { outcome: 'stopped' };

    const { spec, gate } = resolved;
    const stub = await seams.prepare(spec);
    const claim = await seams.claim({
      issue: spec.issue,
      specPath: spec.path,
      stub,
      labels: spec.read?.labels ?? null,
    });
    if (claim.outcome !== 'refused') {
      report(claim, output);
      return { outcome: 'spec', spec, gate, stub, claim };
    }
    if (spec.kind !== 'next') throw new CommandExit(CLAIM_REFUSAL_EXIT, claimRefusalMessage(claim));
    if (passOver.has(claim.issue)) {
      throw new Error(`plan claim route: the --next walk picked #${String(claim.issue)} again after its claim was refused`);
    }
    output.info(passedOverLine(claim));
    passOver = new Map([...passOver, [claim.issue, claim.branch]]);
  }
}

/**
 * The seams and settings a `plan create` run in `repoRoot` claims
 * through: `git` in the project root, the `gh` issue board when the
 * repository resolves to `pr.provider: gh` and none otherwise, this
 * device's store id read under `config.store`, `claims.staleAfter`,
 * `claims.ahead`, and the clock at the call.
 */
export function createPlanClaimContext(
  repoRoot: string,
  config: Pick<RafaConfig, 'prProvider' | 'store' | 'claimsStaleAfter' | 'claimsAhead'>,
): PlanClaimContext {
  const provider = resolvePrProvider({ configured: config.prProvider, dir: repoRoot }).provider;
  return {
    git: createGitRunner(repoRoot),
    board: provider === 'gh'
      ? createGhIssueBoard({ gh: createGhRunner({ cwd: repoRoot }) })
      : null,
    readStoreId: () => readDeviceStoreId(repoRoot, config),
    staleAfter: config.claimsStaleAfter,
    claimsAhead: config.claimsAhead,
    now: new Date(),
  };
}
