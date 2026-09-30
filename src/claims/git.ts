/**
 * The claim's git operations: making an empty ownership commit, reading
 * a claim branch off the remote, and the two pushes a claim is made and
 * moved with. What a commit SAYS is `./record.ts`'s; this module only
 * makes, moves and reads the commits.
 *
 * Git is reached through a `GitRunner` (`src/pr/git.ts`), never a shell
 * string, and every operation answers rather than throws when git
 * refuses or cannot run. The one throw is a caller's mistake: a branch
 * that is not `feat/rafa-<n>` or `feat/rafa-<n>-<slug>`, a pushed commit
 * or a lease that is not a full sha, or a record `formatClaimMessage`
 * refuses.
 *
 * ## The operations
 *
 * | Operation | Git it runs | Answers |
 * |---|---|---|
 * | {@link makeOwnershipCommit} | `rev-parse`, `commit-tree` | the new commit's sha |
 * | {@link fetchClaimBranches} then {@link readClaimBranch} | one `fetch`, then local reads | `absent`, `found` with the ownership, or `unreadable` |
 * | {@link readLocalClaimBranch} | local reads of `refs/heads/<branch>` | the same three |
 * | {@link pushNewClaimBranch} | `push`, no force | `pushed`, `claimed` naming the holder, or `failed` |
 * | {@link pushOwnershipCommit} | `push --force-with-lease` | `pushed`, `moved` meanwhile, or `failed` |
 *
 * **The empty commit touches no working tree and no index.** It is made
 * with `git commit-tree <parent>^{tree} -p <parent>`, which writes one
 * commit object and moves no ref at all, not even a local branch: the
 * caller decides where the sha goes. Its author and committer are the
 * repository's configured identity, as any commit's.
 *
 * **One fetch, then any number of reads.** {@link fetchClaimBranches}
 * fetches `+refs/heads/feat/rafa-*` into `refs/remotes/origin/feat/rafa-*`
 * with `--prune`, so a claim branch deleted on the remote leaves no
 * stale remote-tracking ref behind; the prune reaches only the refs the
 * refspec names, never `origin/main`. {@link readClaimBranch} then reads
 * the remote-tracking ref and nothing else, so walking several issues
 * costs one network round trip.
 *
 * {@link readLocalClaimBranch} reads the same way off the LOCAL branch,
 * `refs/heads/<branch>`, with no fetch at all: it is how `loop start`'s
 * preflight finds a claim commit `plan create` could not push, which
 * waits on the local branch with no upstream (`src/start/preflight-claim.ts`).
 *
 * **A branch's ownership commits are the claim commits in its history
 * that name its own issue.** Its history is walked with a
 * case-insensitive `--grep=rafa-claim`, a superset of every message
 * carrying one of the three trailers, and each candidate is parsed. An
 * ownership commit naming ANOTHER issue is passed over, since a base
 * that merged an earlier claim branch without squashing carries that
 * branch's claim commits. A malformed one (`./record.ts`'s `invalid`) is
 * kept, so `readOwnership` lists it in `ignored` to be reported.
 *
 * **Staleness reads the tip's committer date**, since git records no
 * push time and every ownership commit moves the tip.
 *
 * ## The two pushes, and what their refusals mean
 *
 * Both push one sha to `refs/heads/<branch>` with `--porcelain`, and the
 * outcome is read from the porcelain line for that ref, not from the
 * exit code, which is 1 for every refusal alike.
 *
 * {@link pushNewClaimBranch} pushes WITHOUT force. A second device's
 * claim commit is a different commit on the same parent, so the remote
 * refuses it, and that refusal is the compare-and-set: it answers
 * `claimed`, then fetches once and reads the branch so the answer names
 * who holds it. A branch that already points at the pushed sha answers
 * `pushed`: a retried push whose first attempt landed is still this
 * device's claim. A push that FAST-FORWARDS an existing branch lands
 * too and answers `pushed`; telling an existing branch from a new one
 * is the reading made before the push, not this one.
 *
 * {@link pushOwnershipCommit} pushes with
 * `--force-with-lease=refs/heads/<branch>:<sha last seen>`. When the
 * remote tip is no longer that sha, whether another device moved it or
 * deleted the branch, git refuses with `stale info` and this answers
 * `moved`. Before pushing it checks that the lease is an ancestor of the
 * pushed commit, and refuses otherwise without pushing, since a lease
 * that matched would otherwise let the push drop the branch's commits:
 * work commits never leave the branch.
 *
 * The pair of claims a claim ahead makes is pushed in ONE
 * `git push --atomic` by `./ahead.ts`, which reads each ref's porcelain
 * line with {@link porcelainFor} and the refusals above.
 *
 * ## What was measured
 *
 * On git 2.53.0 under Linux with `LC_ALL=C`, over a bare repository and
 * two clones (2026-09-30), the porcelain line for the pushed ref was:
 *
 *  - a new branch: `*` and `[new branch]`; the same sha again: `=` and
 *    `[up to date]`, exit 0; a lease that matched: a space flag and
 *    `<old>..<new>`;
 *  - the second clone's claim, before it had fetched the first:
 *    `!` and `[rejected] (fetch first)`; after fetching:
 *    `[rejected] (non-fast-forward)`. So both read as `claimed`;
 *  - a lease on a tip that had moved, and a lease on a branch the remote
 *    no longer has: `[rejected] (stale info)` both;
 *  - a remote that is not a repository: no porcelain line, exit 128.
 *
 * The same session measured `commit-tree -m` storing the message as
 * given, and a fetch with the glob refspec and `--prune` writing
 * `- [deleted] (none) -> origin/feat/rafa-7-x` for a deleted branch
 * while leaving `refs/remotes/origin/main` where it was.
 */
import type { BranchCommit, ClaimRecord, Ownership } from './record.js';
import type { GitRunner } from '../pr/index.js';

import { gitSaid } from '../pr/index.js';
import { BRANCH_PREFIX, localRef, REMOTE, remoteTrackingRef } from '../start/branch-decision.js';

import { formatClaimMessage, parseClaimMessage, readOwnership } from './record.js';

/** The branches a claim can live on, as a glob under `refs/heads/`. */
export const CLAIM_BRANCH_GLOB = `${BRANCH_PREFIX}rafa-*`;

/** The one refspec {@link fetchClaimBranches} fetches. */
export const CLAIM_REFSPEC = `+refs/heads/${CLAIM_BRANCH_GLOB}:refs/remotes/${REMOTE}/${CLAIM_BRANCH_GLOB}`;

/** A claim branch: `feat/rafa-<n>`, or `feat/rafa-<n>-<slug>`. */
const CLAIM_BRANCH = /^feat\/rafa-([1-9]\d*)(?:-\S+)?$/;

/** A full object name, SHA-1 or SHA-256. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The porcelain flags of a push that left the ref at the pushed sha. */
export const LANDED_FLAGS: readonly string[] = ['*', ' ', '+', '='];

/** The refusals a push without force meets when the branch holds another commit. */
export const CLAIMED_REASONS: readonly string[] = ['[rejected] (non-fast-forward)', '[rejected] (fetch first)'];

/** The refusal a lease meets when the tip is no longer the sha it names. */
export const STALE_LEASE = '[rejected] (stale info)';

/** What {@link makeOwnershipCommit} answered. */
export type OwnershipCommit =
  | { readonly ok: true; readonly sha: string }
  | { readonly ok: false; readonly reason: string };

/** What {@link fetchClaimBranches} answered. */
export type ClaimFetch = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * What {@link readClaimBranch} read of one claim branch on the remote, or
 * {@link readLocalClaimBranch} of the local branch of that name.
 */
export type ClaimBranchReading =
  /** The remote has no such branch, as of the last fetch; or there is no such local branch. */
  | { readonly state: 'absent'; readonly branch: string }
  /** The branch, its tip, and who holds its claim. */
  | {
    readonly state: 'found';
    readonly branch: string;
    /** The sha of the branch's tip on the remote, or of the local branch's. */
    readonly tip: string;
    /** The tip's committer date, which staleness is read from. */
    readonly tipCommittedAt: Date;
    /** The branch's ownership commits for its issue, oldest first. */
    readonly commits: readonly BranchCommit[];
    /** `readOwnership` over {@link commits}. */
    readonly ownership: Ownership;
  }
  /** Git could not read the branch; `reason` is what it said. */
  | { readonly state: 'unreadable'; readonly branch: string; readonly reason: string };

/** What {@link pushNewClaimBranch} answered. */
export type ClaimPush =
  /** The branch now points at the pushed commit. */
  | { readonly outcome: 'pushed' }
  /** The branch holds another commit; `holder` is the branch as read after one fetch. */
  | { readonly outcome: 'claimed'; readonly holder: ClaimBranchReading }
  /** Anything else git refused or could not do; `reason` is what it said. */
  | { readonly outcome: 'failed'; readonly reason: string };

/** What {@link pushOwnershipCommit} answered. */
export type OwnershipPush =
  /** The branch now points at the pushed commit. */
  | { readonly outcome: 'pushed' }
  /** The branch's tip is no longer the lease: it moved, or was deleted, meanwhile. */
  | { readonly outcome: 'moved' }
  /** Anything else git refused or could not do, or the push was not tried. */
  | { readonly outcome: 'failed'; readonly reason: string };

/** The issue number of a claim branch, or null when `branch` is not one. */
export function claimBranchIssue(branch: string): number | null {
  const match = CLAIM_BRANCH.exec(branch);
  return match === null
    ? null
    : Number(match[1]);
}

/** `text`, then what git said after a colon when it said anything. */
function saying(text: string, said: string): string {
  return said === ''
    ? text
    : `${text}: ${said}`;
}

/** Throws unless `value` is a full sha: a sha here is the caller's to get right. */
function assertSha(value: string, what: string): void {
  if (!FULL_SHA.test(value)) {
    throw new Error(`claim git: ${what} must be a full sha, not ${JSON.stringify(value)}`);
  }
}

/** The issue of `branch`, or a throw naming it: a branch here is the caller's to get right. */
function issueOf(branch: string): number {
  const issue = claimBranchIssue(branch);
  if (issue === null) {
    throw new Error(`claim git: ${JSON.stringify(branch)} is not a ${CLAIM_BRANCH_GLOB} branch`);
  }
  return issue;
}

/**
 * Makes one empty commit on `parent` whose message is `record`'s, and
 * answers its sha. No ref, index or working tree moves; see the module
 * note. Throws only where `formatClaimMessage` does.
 */
export function makeOwnershipCommit(git: GitRunner, parent: string, record: ClaimRecord): OwnershipCommit {
  const message = formatClaimMessage(record);
  if (parent === '' || parent.startsWith('-')) {
    return { ok: false, reason: `${JSON.stringify(parent)} names no commit` };
  }
  const resolved = git(['rev-parse', '--verify', '--quiet', `${parent}^{commit}`]);
  const parentSha = resolved.stdout.trim();
  if (!resolved.ok || parentSha === '') {
    return { ok: false, reason: saying(`${parent} names no commit`, gitSaid(resolved)) };
  }
  const made = git(['commit-tree', `${parentSha}^{tree}`, '-p', parentSha, '-m', message]);
  const sha = made.stdout.trim();
  return made.ok && FULL_SHA.test(sha)
    ? { ok: true, sha }
    : { ok: false, reason: `could not make the ${record.action} commit on ${parent}: ${gitSaid(made)}` };
}

/**
 * Fetches every `feat/rafa-*` branch of the remote into its
 * remote-tracking refs, pruning the ones the remote no longer has. The
 * one network call {@link readClaimBranch} reads after.
 */
export function fetchClaimBranches(git: GitRunner): ClaimFetch {
  const fetched = git(['fetch', '--quiet', '--prune', '--no-tags', REMOTE, CLAIM_REFSPEC]);
  return fetched.ok
    ? { ok: true }
    : { ok: false, reason: `could not fetch the ${CLAIM_BRANCH_GLOB} branches from ${REMOTE}: ${gitSaid(fetched)}` };
}

/**
 * Reads `branch` as the last {@link fetchClaimBranches} left it: its
 * tip, the tip's committer date and its ownership commits, with no
 * network call. Throws on a branch that is not a claim branch.
 */
export function readClaimBranch(git: GitRunner, branch: string): ClaimBranchReading {
  return readClaimRef(git, branch, remoteTrackingRef(branch));
}

/**
 * Reads the LOCAL `branch`, `refs/heads/<branch>`, as {@link readClaimBranch}
 * reads its remote-tracking ref, with no network call: `absent` when this
 * checkout has no such branch. Throws on a branch that is not a claim branch.
 */
export function readLocalClaimBranch(git: GitRunner, branch: string): ClaimBranchReading {
  return readClaimRef(git, branch, localRef(branch));
}

/** The claim reading of `branch` at `ref`, its remote-tracking ref or its local one. */
function readClaimRef(git: GitRunner, branch: string, ref: string): ClaimBranchReading {
  const issue = issueOf(branch);
  const resolved = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const tip = resolved.stdout.trim();
  if (!resolved.ok || tip === '') {
    const said = gitSaid(resolved);
    return said === ''
      ? { state: 'absent', branch }
      : { state: 'unreadable', branch, reason: said };
  }
  const dated = git(['log', '-1', '--format=%ct', tip]);
  const seconds = Number(dated.stdout.trim());
  if (!dated.ok || !Number.isSafeInteger(seconds)) {
    return { state: 'unreadable', branch, reason: `no committer date for ${tip}: ${gitSaid(dated)}` };
  }
  const walked = git(['log', '-z', '--reverse', '--regexp-ignore-case', '--fixed-strings', '--grep=rafa-claim', '--format=%H%n%B', tip]);
  if (!walked.ok) {
    return { state: 'unreadable', branch, reason: `could not walk ${branch}: ${gitSaid(walked)}` };
  }
  const commits = candidatesOf(walked.stdout).filter((commit) => belongsTo(commit, issue));
  return {
    state: 'found',
    branch,
    tip,
    tipCommittedAt: new Date(seconds * 1000),
    commits,
    ownership: readOwnership(commits),
  };
}

/** The commits of a `log -z --format=%H%n%B` capture. */
function candidatesOf(stdout: string): BranchCommit[] {
  return stdout
    .split('\0')
    .map((entry) => entry.replace(/^\n+/, ''))
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const newline = entry.indexOf('\n');
      return newline === -1
        ? { sha: entry.trim(), message: '' }
        : { sha: entry.slice(0, newline).trim(), message: entry.slice(newline + 1) };
    });
}

/** False only for a well-formed ownership commit naming another issue; see the module note. */
function belongsTo(commit: BranchCommit, issue: number): boolean {
  const reading = parseClaimMessage(commit.message);
  return reading.kind !== 'ownership' || reading.record.issue === issue;
}

/** The porcelain line `push --porcelain` wrote for `ref`, split into flag and summary, or null. */
export function porcelainFor(stdout: string, ref: string): { readonly flag: string; readonly summary: string } | null {
  for (const line of stdout.split('\n')) {
    const [flag, refs, summary] = line.split('\t');
    if (flag !== undefined && refs?.endsWith(`:${ref}`) === true && summary !== undefined) {
      return { flag, summary: summary.trim() };
    }
  }
  return null;
}

/**
 * Pushes `sha` to `branch` on the remote WITHOUT force. A refusal
 * because the branch holds another commit answers `claimed`, with the
 * branch as read after one fetch; see the module note. Throws on a
 * `sha` that is not a full sha or a branch that is not a claim branch.
 */
export function pushNewClaimBranch(git: GitRunner, sha: string, branch: string): ClaimPush {
  issueOf(branch);
  assertSha(sha, 'the pushed commit');
  const ref = `refs/heads/${branch}`;
  const pushed = git(['push', '--porcelain', REMOTE, `${sha}:${ref}`]);
  const line = porcelainFor(pushed.stdout, ref);
  if (pushed.ok && line !== null && LANDED_FLAGS.includes(line.flag)) {
    return { outcome: 'pushed' };
  }
  if (line?.flag !== '!' || !CLAIMED_REASONS.includes(line.summary)) {
    return { outcome: 'failed', reason: `could not push ${branch} to ${REMOTE}: ${gitSaid(pushed)}` };
  }
  const fetched = fetchClaimBranches(git);
  const holder: ClaimBranchReading = fetched.ok
    ? readClaimBranch(git, branch)
    : { state: 'unreadable', branch, reason: fetched.reason };
  return { outcome: 'claimed', holder };
}

/**
 * Pushes the ownership commit `sha` to `branch` with
 * `--force-with-lease` on `lease`, the tip last seen. A stale lease
 * answers `moved`. Refuses without pushing when `lease` is not an
 * ancestor of `sha`. Throws on a `sha` or a lease that is not a full
 * sha, or a branch that is not a claim branch.
 */
export function pushOwnershipCommit(git: GitRunner, sha: string, branch: string, lease: string): OwnershipPush {
  issueOf(branch);
  assertSha(sha, 'the pushed commit');
  assertSha(lease, 'the lease');
  const ancestry = git(['merge-base', '--is-ancestor', lease, sha]);
  if (!ancestry.ok) {
    const refusal = `${sha} does not descend from ${lease}, so pushing it would drop commits from ${branch}`;
    return { outcome: 'failed', reason: saying(refusal, gitSaid(ancestry)) };
  }
  const ref = `refs/heads/${branch}`;
  const pushed = git(['push', '--porcelain', `--force-with-lease=${ref}:${lease}`, REMOTE, `${sha}:${ref}`]);
  const line = porcelainFor(pushed.stdout, ref);
  if (pushed.ok && line !== null && LANDED_FLAGS.includes(line.flag)) {
    return { outcome: 'pushed' };
  }
  return line?.flag === '!' && line.summary === STALE_LEASE
    ? { outcome: 'moved' }
    : { outcome: 'failed', reason: `could not push ${branch} to ${REMOTE}: ${gitSaid(pushed)}` };
}
