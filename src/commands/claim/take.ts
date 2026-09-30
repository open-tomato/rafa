/**
 * `rafa claim take <n> [--stale]`: takes over another store's claim on
 * issue `<n>` once it has gone stale, with one take commit naming this
 * device's store pushed to the claim branch
 * (`.rafa/plans/rafa-324-claim-issue-so-two`). Starts no Claude session
 * and declares no `spends`.
 *
 * ## What is read
 *
 * The line first: `--stale`, which takes no value, then exactly one
 * argument, the issue number (`readIssueArgument`). A line typed
 * `--stale 7` reads `7` as the flag's value and is refused, naming the
 * order to type it in. Then this device's store id, then one fetch of
 * the `feat/rafa-*` branches and every remote branch of the issue, as
 * `rafa claim release` reads them (`./release.ts`). No network means no
 * takeover. When a branch of the issue holds a claim, the issue's
 * labels are read once through the `labels` seam, and the clock once
 * through `now`.
 *
 * ## Which claim it takes
 *
 * Each branch is weighed with `readClaimState` (`src/claims/stale.ts`)
 * over its ownership, its tip's committer date, the issue's labels,
 * `claims.staleAfter` and the clock ({@link takeOf}):
 *
 * | Branch reading | `--stale` | Answer |
 * |---|---|---|
 * | `stale-claimed`, another store's | either | taken |
 * | `stale-in-development`, another store's | given | taken |
 * | `stale-in-development`, another store's | left out | refused, naming `--stale` |
 * | `held`, another store's: not stale, or `staleAfter` is `disabled` | either | refused, naming how long it has stood |
 * | held by this store, at any age | either | refused: nothing to take |
 * | `released` | either | taken: nobody holds it |
 * | no claim commit, or unreadable | either | refused: the branch stays taken |
 * | absent | either | passed over |
 *
 * A refused branch keeps the whole issue taken, so a takeover elsewhere
 * is refused too, every branch's reason named. Of the takeable branches
 * a stale claim is taken before a released one, since a released branch
 * beside a held one is the one nobody is working on; two takeable
 * branches of the same kind are refused, naming both.
 *
 * `--stale` widens the takeover to a claim in development and to
 * nothing else: it never makes a claim stale that has not stood
 * `claims.staleAfter`, and a `disabled` setting keeps every claim.
 *
 * ## The labels
 *
 * The labels are read, never written: the stage is the same whoever
 * holds the claim. A board that is not `gh` (the `labels` seam is null)
 * or a label read that fails leaves the labels unknown, and unknown
 * labels read as in development (`src/claims/stale.ts`): a stale claim
 * then needs `--stale`, and the refusal and the result both carry the
 * warning saying why.
 *
 * ## What it pushes
 *
 * One empty `take` commit naming this store, made on the branch's
 * remote tip and pushed with `--force-with-lease` on that tip
 * (`src/claims/git.ts`). An owner whose push lands between this
 * command's fetch and its push moves the tip, so the lease refuses the
 * take and nothing lands: a returning owner is never overwritten. No
 * local ref, index or working tree moves but the remote-tracking ref the
 * push writes.
 *
 * ## What it writes
 *
 * Text mode writes one line naming the issue, the branch, the store the
 * claim came from and the commit, then any label warning at `warn`. In
 * json mode the terminal result's `data` is a {@link ClaimTakeResult}.
 *
 * ## Refusals
 *
 * Exit code 1, each pushing nothing: a line that is not one issue number
 * with `--stale` at most, valueless; a store that names no id, or cannot
 * be read; a failed fetch; no remote branch of the issue; a branch that
 * keeps the issue taken, as the table words it; two takeable branches; a
 * branch that moved on the remote between the fetch and the push; and a
 * push git refused otherwise.
 */
import type { ClaimCommandSeams, ClaimDoing, FoundBranch } from './release.js';
import type { ClaimBranchReading } from '../../claims/git.js';
import type { ClaimState } from '../../claims/stale.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ClaimsStaleAfter } from '../../config-sections.js';
import type { RafaConfig } from '../../config.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { idleText } from '../../board/roadmap-claims.js';
import { readClaimState } from '../../claims/stale.js';
import { CommandExit } from '../../cli/command.js';
import { CLAIMS_STALE_DISABLED, messageOf } from '../../config-sections.js';
import { REMOTE } from '../../start/branch-decision.js';
import { createStartPreflightClaim } from '../../start/preflight-claim.js';
import { requireProject, resolveProjectConfig } from '../plan/plan-files.js';

import { pushOnClaimTip, readClaimStoreId, readIssueArgument, readIssueBranches } from './release.js';

/** The usage line a refusal names. */
const USAGE = 'rafa claim take <n> [--stale]';

/** The command's name, as refusals open with it. */
const COMMAND = 'rafa claim take';

/** The flag that widens a takeover to a claim in development. */
const STALE_FLAG = 'stale';

/** How this command's refusals word a takeover. */
const TAKING: ClaimDoing = { during: 'was being taken over', nothing: 'nothing was taken' };

/** The seams `rafa claim take` reaches git, the board, the store and the clock through. */
export interface ClaimTakeSeams extends ClaimCommandSeams {
  /** Reads the labels on an issue, or null when the board is not `gh`. */
  readonly labels: ((issue: number) => Promise<readonly string[]>) | null;
  /** The clock a claim's idle time is read against. */
  readonly now: () => Date;
}

/** Makes the take seams for the project at `root` under `config`. */
export type ClaimTakeSeamsFactory = (root: string, config: RafaConfig) => ClaimTakeSeams;

/** Where a taken claim came from: a stale holder, or a release. */
export type TakenFrom = 'stale-claimed' | 'stale-in-development' | 'released';

/** What one takeover did. */
export interface ClaimTakeResult {
  readonly issue: number;
  readonly branch: string;
  /** This device's store, which holds the claim now. */
  readonly storeId: string;
  /** The store that held the claim, or released it. */
  readonly from: string;
  /** What the claim was when it was taken. */
  readonly was: TakenFrom;
  /** How long the claim had stood idle, or null for a released one. */
  readonly idleMs: number | null;
  /** The take commit now at the branch's tip on the remote. */
  readonly sha: string;
  /** Why the issue's labels could not be read, or null when they were or were not needed. */
  readonly labelWarning: string | null;
}

/** What {@link takeOf} weighs a branch against. */
export interface TakeWeights {
  readonly issue: number;
  readonly storeId: string;
  /** The issue's labels, empty when they could not be read. */
  readonly labels: readonly string[];
  /** Why the labels could not be read, or null. */
  readonly labelWarning: string | null;
  readonly staleAfter: ClaimsStaleAfter;
  readonly now: Date;
  /** Whether the line said `--stale`. */
  readonly stale: boolean;
}

/** Whether one branch can be taken over, and why not when it cannot; see the module note's table. */
export type TakeReading =
  /** Nothing on this branch: it neither offers nor keeps a claim. */
  | { readonly state: 'passed' }
  | { readonly state: 'takeable'; readonly from: string; readonly was: TakenFrom; readonly idleMs: number | null }
  /** The branch keeps the issue taken. */
  | { readonly state: 'refused'; readonly reason: string };

/** A refusal with exit code 1, opening with the command's name. */
function refuse(message: string): CommandExit {
  return new CommandExit(1, `❌ ${COMMAND}: ${message}`);
}

/** Whether the line says `--stale`; a refusal for a value typed to it. */
export function readStaleFlag(flags: RafaContext['flags']): boolean {
  const value = flags[STALE_FLAG];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  throw refuse(`--${STALE_FLAG} takes no value, and read "${value}" as one; type the issue number before the flags\nUsage: ${USAGE}`);
}

/** The labels' note a refusal of an in-development reading carries, or the empty string. */
function labelNote(weights: TakeWeights): string {
  return weights.labelWarning === null
    ? ''
    : ` (${weights.labelWarning}, so it reads as in development)`;
}

/** Why a held claim of another store that is not stale is kept. */
function freshReason(branch: string, owner: string, idleMs: number, weights: TakeWeights): string {
  const issue = `#${String(weights.issue)}`;
  if (weights.staleAfter === CLAIMS_STALE_DISABLED) {
    return `${issue} is claimed by store ${owner} on ${branch}, and claims.staleAfter is ${CLAIMS_STALE_DISABLED}, so no claim goes stale`;
  }
  return `${issue} is claimed by store ${owner} on ${branch}, idle ${idleText(idleMs)}:`
    + ` not stale until it has stood claims.staleAfter (${weights.staleAfter})`;
}

/** The milliseconds from `tip` to `now`, never below 0, 0 for a date that is none. */
function idleMsOf(tip: Date, now: Date): number {
  const elapsed = now.getTime() - tip.getTime();
  return Number.isFinite(elapsed)
    ? Math.max(0, elapsed)
    : 0;
}

/** The answer for a claim `readClaimState` weighed on `branch`, idle for `idleMs`. */
function weighedTake(branch: string, idleMs: number, state: ClaimState, weights: TakeWeights): TakeReading {
  const issue = `#${String(weights.issue)}`;
  if (state.state === 'released') return { state: 'takeable', from: state.releasedBy, was: 'released', idleMs: null };
  if (state.owner === weights.storeId) {
    return { state: 'refused', reason: `this device (store ${weights.storeId}) already holds the claim on ${issue} on ${branch}; there is nothing to take` };
  }
  if (state.state === 'held') return { state: 'refused', reason: freshReason(branch, state.owner, idleMs, weights) };
  if (state.state === 'stale-claimed' || weights.stale) {
    return { state: 'takeable', from: state.owner, was: state.state, idleMs: state.idleMs };
  }
  return {
    state: 'refused',
    reason: `${issue} is claimed by store ${state.owner} on ${branch}, idle ${idleText(state.idleMs)} and stale, but in development${labelNote(weights)},`
      + ` which is never taken over without --${STALE_FLAG}; run rafa claim take ${String(weights.issue)} --${STALE_FLAG} to take it`,
  };
}

/** Whether `reading` can be taken over under `weights`; see the module note's table. */
export function takeOf(reading: ClaimBranchReading, weights: TakeWeights): TakeReading {
  const { branch } = reading;
  if (reading.state === 'absent') return { state: 'passed' };
  if (reading.state === 'unreadable') {
    return { state: 'refused', reason: `the claim on ${branch} could not be read, so #${String(weights.issue)} stays taken: ${reading.reason}` };
  }
  const { ownership, tipCommittedAt } = reading;
  if (ownership.state === 'none') {
    return { state: 'refused', reason: `${branch} exists on ${REMOTE} carrying no claim commit, so #${String(weights.issue)} stays taken` };
  }
  const { labels, staleAfter, now } = weights;
  const state = readClaimState({ ownership, tipCommittedAt, labels, staleAfter, now });
  return weighedTake(branch, idleMsOf(tipCommittedAt, now), state, weights);
}

/** The issue's labels and why they could not be read, read only when a branch holds a claim. */
async function readLabels(seams: ClaimTakeSeams, issue: number, readings: readonly ClaimBranchReading[]): Promise<{ readonly labels: readonly string[]; readonly warning: string | null }> {
  const held = readings.some((reading) => reading.state === 'found' && reading.ownership.state === 'held');
  if (!held) return { labels: [], warning: null };
  if (seams.labels === null) {
    return { labels: [], warning: `the board is not gh, so the stage labels of #${String(issue)} could not be read` };
  }
  try {
    return { labels: await seams.labels(issue), warning: null };
  } catch (error) {
    return { labels: [], warning: `the stage labels of #${String(issue)} could not be read: ${messageOf(error)}` };
  }
}

/** One takeable branch and what it offers. */
type Candidate = Extract<TakeReading, { readonly state: 'takeable' }> & { readonly reading: FoundBranch };

/** The one branch to take, or a refusal naming what each branch says; see the module note. */
function pickBranch(readings: readonly ClaimBranchReading[], weights: TakeWeights): Candidate {
  const weighed = readings.map((reading) => ({ reading, take: takeOf(reading, weights) }));
  const reasons = weighed.flatMap(({ take }) => (take.state === 'refused'
    ? [take.reason]
    : []));
  const issue = `#${String(weights.issue)}`;
  if (reasons.length > 0) {
    throw refuse(`the claim on ${issue} cannot be taken over, so ${TAKING.nothing}:\n${reasons.map((reason) => `   ${reason}`).join('\n')}`);
  }
  const candidates = weighed.flatMap(({ reading, take }) => (take.state === 'takeable' && reading.state === 'found'
    ? [{ ...take, reading }]
    : []));
  const stale = candidates.filter((candidate) => candidate.was !== 'released');
  const chosen = stale.length > 0
    ? stale
    : candidates;
  const [only] = chosen;
  if (chosen.length === 1 && only !== undefined) return only;
  if (chosen.length === 0) throw refuse(`${REMOTE} holds no branch of ${issue} with a claim to take, so ${TAKING.nothing}`);
  const names = chosen.map((candidate) => candidate.reading.branch).join(', ');
  throw refuse(`${issue} can be taken over on more than one branch: ${names}; ${TAKING.nothing}`);
}

/** Takes over the claim on the issue the line names; see the module note. */
export async function takeClaim(context: RafaContext, makeSeams: ClaimTakeSeamsFactory): Promise<ClaimTakeResult> {
  const stale = readStaleFlag(context.flags);
  const issue = readIssueArgument(context.args, USAGE);
  const project = requireProject(context, COMMAND);
  const config = resolveProjectConfig(project, COMMAND, (message) => context.output.warn(message));
  const seams = makeSeams(project.root, config);
  const storeId = readClaimStoreId(seams, refuse);
  const readings = readIssueBranches(seams.git, issue, refuse);
  const labels = await readLabels(seams, issue, readings);
  const weights: TakeWeights = {
    issue,
    storeId,
    labels: labels.labels,
    labelWarning: labels.warning,
    staleAfter: config.claimsStaleAfter,
    now: seams.now(),
    stale,
  };
  const { reading, from, was, idleMs } = pickBranch(readings, weights);
  const sha = pushOnClaimTip(seams.git, reading, { action: 'take', issue, store: storeId }, refuse, TAKING);
  return { issue, branch: reading.branch, storeId, from, was, idleMs, sha, labelWarning: labels.warning };
}

/** The line text mode writes at `info`; a label warning goes at `warn`. */
export function renderTake(result: ClaimTakeResult): string {
  const how = result.was === 'released'
    ? `released by store ${result.from}`
    : `store ${result.from}'s, idle ${idleText(result.idleMs ?? 0)}${result.was === 'stale-in-development'
      ? ' and in development'
      : ''}`;
  return `Took over the claim on #${String(result.issue)} on ${result.branch} (${how}):`
    + ` take commit ${result.sha} pushed to ${REMOTE}; this device (store ${result.storeId}) now owns the claim.`;
}

/** The default seams: `loop start`'s claim seams, the issue's labels read through `gh`, and the wall clock. */
const DEFAULT_SEAMS: ClaimTakeSeamsFactory = (root, config) => {
  const base = createStartPreflightClaim(root, config);
  const reader = base.board === null
    ? null
    : createGhSpecIssueReader({ gh: createGhRunner({ cwd: root }) });
  const labels = reader === null
    ? null
    : async (issue: number): Promise<readonly string[]> => (await reader(issue)).labels;
  return { ...base, labels, now: () => new Date() };
};

/** The command, reaching git, the board, the store and the clock through `makeSeams`; see the module note. */
export function createClaimTakeCommand(makeSeams: ClaimTakeSeamsFactory = DEFAULT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'claim take',
    subject: 'claim',
    action: 'take',
    summary: 'take over another device\'s stale claim on an issue',
    description: 'Pushes one take commit naming this device\'s store to the issue\'s claim branch on'
      + ' origin, leased on the tip it read, so this device owns the claim from then on and an owner'
      + ' that pushed meanwhile is never overwritten. Refused while the claim has stood less than'
      + ' `claims.staleAfter`, whenever that is `disabled`, and for a stale claim in development'
      + ' (`rafa:in-development`, or labels that cannot be read) unless `--stale` is given. A released'
      + ' claim is taken as it is. No label and no local branch moves. With `--output=json` the issue,'
      + ' the branch, the stores and the take commit are the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number whose claim this device takes over.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: STALE_FLAG,
        description: 'Also take a stale claim in development, which is never taken over without it.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa claim take 324',
        note: 'Takes over the claim on #324 once it has stood claims.staleAfter at rafa:claimed.',
      },
      {
        cmd: 'rafa claim take 324 --stale',
        note: 'Takes over a stale claim whose loop was started, at rafa:in-development.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await takeClaim(context, makeSeams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(renderTake(result));
      if (result.labelWarning !== null) context.output.warn(result.labelWarning);
    },
  };
  return Object.freeze(command);
}

export default createClaimTakeCommand();
