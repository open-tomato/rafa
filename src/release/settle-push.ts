/**
 * Settle's `push` delivery (`release.settle: push`): the release commit
 * `./settle.ts` built in the scratch worktree is pushed straight to the
 * base branch, and git's refused push is the only lock between two
 * settles racing for it.
 *
 * ```text
 * settleByPush(worktree, settings) → build, push, and at most one rebuild
 * ```
 *
 * ## The refused-push rule
 *
 * The push is `git push --porcelain <remote> <release>:refs/heads/<base>`,
 * never `--force` and never `--force-with-lease`: a push that would drop
 * a commit the base holds is refused by git, and that refusal is how a
 * settle learns another device moved the base first. On a refusal that
 * is a race (`[rejected]`, the non-fast-forward family):
 *
 *   1. the base is fetched again and resolved to one commit;
 *   2. if EVERY fragment this settle folded is gone from that commit,
 *      another settle released them: the answer is `superseded`, exit 0,
 *      naming the commit that deleted them and its subject, since the
 *      winner's commit IS the release this one would have pushed;
 *   3. otherwise the base moved under the settle — new fragments
 *      arrived, another settle took part of the batch, or an unrelated
 *      commit landed — so the worktree is reset hard to the new base,
 *      the commit is built again from what is present there, and pushed
 *      once more;
 *   4. a second refusal of any kind is final: exit 1. A settle retries
 *      a refused push at most once, so two devices cannot loop.
 *
 * The rebuild is a whole new reading, so it can answer anything a first
 * build can: `nothing` (the other settle took every shipping fragment
 * and left only `none` ones, exit 0), or a failure (exit 1).
 *
 * ## The protected-branch refusal
 *
 * A base the forge protects refuses every direct push, and no retry can
 * change that; the fix is the other delivery. So a `[remote rejected]`
 * whose reason or remote output says `protected branch` (any case) is
 * answered `protected`, exit 1, with a sentence naming
 * `release.settle: pr`. The wording matched is the one forges print:
 * GitHub's `GH006: Protected branch update failed` line and its
 * `(protected branch hook declined)` reason, GitLab's `not allowed to
 * push code to protected branches`. Only the GH006 line is measured
 * here, planted by a `pre-receive` hook in a local bare origin (the
 * unit tests); a forge that words it otherwise is answered `unpushed`,
 * still exit 1, with what git said.
 *
 * ## What git prints, measured
 *
 * git 2.50.1 (2026-09-29), `--porcelain`, exit 1 in both cases, the
 * status line on stdout, its three fields tab-separated (shown here as
 * `<TAB>`):
 *
 * ```text
 * !<TAB>HEAD:refs/heads/main<TAB>[rejected] (fetch first)
 * !<TAB>HEAD:refs/heads/main<TAB>[remote rejected] (pre-receive hook declined)
 * ```
 *
 * with the hook's own words on stderr, prefixed `remote: `. When the
 * remote's commit is one the pushing repository already holds but not
 * an ancestor of what it pushes, the reason is `(non-fast-forward)`
 * instead of `(fetch first)`, measured the same day; both are the race.
 * A push that fails before any status line (no remote, no network) is
 * `unpushed`.
 *
 * ## Exit codes
 *
 * Every outcome carries `exitCode`: 0 for `pushed`, `superseded` and a
 * build that answered `nothing`; 1 for everything else. The command
 * (`rafa release settle`) prints and exits by it.
 */
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleBuild, SettleBuilt, SettleSettings } from './settle.js';
import type { GitRunner } from '../pr/git.js';

import { gitSaid } from '../pr/git.js';

import { buildSettle, releaseCommitSubject } from './settle.js';

/** How a settle ends for the shell: 0 settled or nothing to do, 1 not. */
export type SettleExitCode = 0 | 1;

/** How many pushes a settle made: one, or one retry after a rebuild. */
export type SettlePushAttempts = 1 | 2;

/** The config line a protected base is pointed to. */
export const SETTLE_PR_SETTING = 'release.settle: pr';

/** What marks a `[remote rejected]` as the forge's branch protection. */
const PROTECTED_WORDING = /protected branch/i;

/** One `--porcelain` status line of a refused ref: flag, refspec, summary, reason. */
const PORCELAIN_REFUSAL = /^!\t[^\t]*\t\[(rejected|remote rejected)\](?: \((.*)\))?$/;

/** How many characters of a hash a sentence names. */
const SHORT_HASH = 12;

/** What every outcome carries. */
interface SettlePushBasis {
  /** 0 or 1; see the module note. */
  readonly exitCode: SettleExitCode;
  /** How many pushes were made. */
  readonly attempts: SettlePushAttempts;
}

/** The build answered something other than a commit, so nothing was pushed. */
export interface SettleUnsettled extends SettlePushBasis {
  readonly outcome: 'unsettled';
  /** The build as it answered: `nothing` exits 0, the rest exit 1. */
  readonly build: Exclude<SettleBuild, SettleBuilt>;
}

/** The release commit is on the base branch. */
export interface SettlePushed extends SettlePushBasis {
  readonly outcome: 'pushed';
  readonly exitCode: 0;
  /** The build that was pushed. */
  readonly build: SettleBuilt;
}

/** Another settle released every fragment this one folded. */
export interface SettleSuperseded extends SettlePushBasis {
  readonly outcome: 'superseded';
  readonly exitCode: 0;
  /** The build that was NOT pushed. */
  readonly build: SettleBuilt;
  /** The full hash of the base as fetched after the refusal. */
  readonly base: string;
  /** The commit that deleted the first folded fragment, or null when git could not name it. */
  readonly winner: { readonly commit: string; readonly subject: string } | null;
  /** One sentence naming the settle that won. */
  readonly sentence: string;
}

/** The push failed and settling again is the operator's call. */
export interface SettlePushFailed extends SettlePushBasis {
  /**
   * `refused`: a race refusal after the one retry; `protected`: the
   * base is a protected branch; `unpushed`: any other failure of the
   * push, or of the fetch or read after a refusal.
   */
  readonly outcome: 'refused' | 'protected' | 'unpushed';
  readonly exitCode: 1;
  /** The build whose push failed. */
  readonly build: SettleBuilt;
  /** One sentence naming what failed and what git said. */
  readonly sentence: string;
}

/** What {@link settleByPush} answers; see the module note. */
export type SettlePushOutcome = SettleUnsettled | SettlePushed | SettleSuperseded | SettlePushFailed;

/** How one push went, read off `--porcelain`. */
type PushReading =
  | { readonly kind: 'pushed' }
  | { readonly kind: 'behind' | 'protected' | 'failed'; readonly said: string };

/** Pushes `release` to the worktree's base branch, never forced, and reads the answer. */
function pushRelease(worktree: SettleWorktree, release: string): PushReading {
  const pushed = worktree.git(['push', '--porcelain', worktree.remote, `${release}:refs/heads/${worktree.branch}`]);
  if (pushed.ok) return { kind: 'pushed' };
  const said = gitSaid(pushed);
  for (const line of pushed.stdout.split('\n')) {
    const refusal = PORCELAIN_REFUSAL.exec(line.trimEnd());
    if (refusal === null) continue;
    if (refusal[1] === 'rejected') return { kind: 'behind', said };
    const reason = refusal[2] ?? '';
    return PROTECTED_WORDING.test(reason) || PROTECTED_WORDING.test(pushed.stderr)
      ? { kind: 'protected', said }
      : { kind: 'failed', said };
  }
  return { kind: 'failed', said };
}

/** The base fetched again and resolved, or the sentence saying why not. */
function refetchBase(worktree: SettleWorktree): { readonly base: string } | { readonly problem: string } {
  const fetched = worktree.git(['fetch', worktree.remote, worktree.branch]);
  if (!fetched.ok) return { problem: `${worktree.branch} could not be fetched from ${worktree.remote} after the refused push: ${gitSaid(fetched)}` };
  const resolved = worktree.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${worktree.ref}^{commit}`]);
  const base = resolved.stdout.trim();
  if (!resolved.ok || base === '') return { problem: `${worktree.ref} could not be resolved after the refused push: ${gitSaid(resolved) || 'git names no such commit'}` };
  return { base };
}

/** Which of `paths` the tree of `commit` still holds, or the sentence saying why it could not be read. */
function stillPresent(
  git: GitRunner,
  commit: string,
  paths: readonly string[],
): { readonly present: readonly string[] } | { readonly problem: string } {
  const listed = git(['ls-tree', '-z', '--full-tree', '--name-only', commit, '--', ...paths]);
  if (!listed.ok) return { problem: `the tree of ${commit} could not be read: ${gitSaid(listed)}` };
  return { present: listed.stdout.split('\0').filter((path) => path !== '') };
}

/** The first-parent commit of `base` that deleted `path`, or null. */
function deletedBy(git: GitRunner, base: string, path: string): SettleSuperseded['winner'] {
  const found = git(['log', '--first-parent', '--diff-filter=D', '-1', '--format=%H%x09%s', base, '--', path]);
  const [commit, ...subject] = found.stdout.trim().split('\t');
  if (!found.ok || commit === undefined || commit === '') return null;
  return { commit, subject: subject.join('\t') };
}

/** The `superseded` answer for a build whose every fragment is gone from `base`. */
function superseded(
  worktree: SettleWorktree,
  build: SettleBuilt,
  base: string,
  attempts: SettlePushAttempts,
): SettleSuperseded {
  const first = build.deleted[0];
  const winner = first === undefined
    ? null
    : deletedBy(worktree.git, base, first);
  const gone = `every fragment this settle folded is gone from ${worktree.ref}`;
  const sentence = winner === null
    ? `${gone} at ${base.slice(0, SHORT_HASH)}: another settle released them first`
    : `${gone}: ${winner.commit.slice(0, SHORT_HASH)} "${winner.subject}" released them first`;
  return { outcome: 'superseded', exitCode: 0, attempts, build, base, winner, sentence };
}

/** The failed answer for a push that is not retried. */
function failed(
  outcome: SettlePushFailed['outcome'],
  build: SettleBuilt,
  attempts: SettlePushAttempts,
  sentence: string,
): SettlePushFailed {
  return { outcome, exitCode: 1, attempts, build, sentence };
}

/** A build that answered no commit, as the outcome that pushes nothing. */
function unsettled(build: Exclude<SettleBuild, SettleBuilt>, attempts: SettlePushAttempts): SettleUnsettled {
  const exitCode = build.outcome === 'nothing'
    ? 0
    : 1;
  return { outcome: 'unsettled', exitCode, attempts, build };
}

/** Answers a push that was not a race refusal, which is final on either attempt. */
function finalPush(
  worktree: SettleWorktree,
  build: SettleBuilt,
  attempts: SettlePushAttempts,
  pushed: PushReading,
): SettlePushOutcome {
  const subject = releaseCommitSubject(build.version);
  const target = `${worktree.remote} ${worktree.branch}`;
  if (pushed.kind === 'pushed') return { outcome: 'pushed', exitCode: 0, attempts, build };
  if (pushed.kind === 'protected') {
    return failed('protected', build, attempts, `${target} refused ${subject} as a protected branch, which no retry can push to; set ${SETTLE_PR_SETTING} to deliver it through a pull request: ${pushed.said}`);
  }
  if (pushed.kind === 'behind') {
    return failed('refused', build, attempts, `${target} moved again while settle rebuilt, and the retried push of ${subject} was refused too; settle retries once, so run it again: ${pushed.said}`);
  }
  return failed('unpushed', build, attempts, `${subject} could not be pushed to ${target}: ${pushed.said}`);
}

/** The one retry: the worktree reset to `base`, built again, and pushed once more. */
function rebuildAndPush(
  worktree: SettleWorktree,
  settings: SettleSettings,
  build: SettleBuilt,
  base: string,
): SettlePushOutcome {
  const reset = worktree.git(['reset', '-q', '--hard', base]);
  if (!reset.ok) {
    return failed('unpushed', build, 1, `the settle worktree could not be reset to ${base.slice(0, SHORT_HASH)} for the rebuild: ${gitSaid(reset)}`);
  }
  const rebuilt = buildSettle(worktree, settings);
  if (rebuilt.outcome !== 'built') return unsettled(rebuilt, 1);
  return finalPush(worktree, rebuilt, 2, pushRelease(worktree, rebuilt.release));
}

/**
 * Builds the release commit in `worktree` and pushes it to the base
 * branch, rebuilding and pushing once more when the base moved; see the
 * module note for the rule and each outcome's exit code. Never forces a
 * push, and touches no checkout but the worktree's.
 */
export function settleByPush(worktree: SettleWorktree, settings: SettleSettings): SettlePushOutcome {
  const build = buildSettle(worktree, settings);
  if (build.outcome !== 'built') return unsettled(build, 1);

  const pushed = pushRelease(worktree, build.release);
  if (pushed.kind !== 'behind') return finalPush(worktree, build, 1, pushed);

  const refetched = refetchBase(worktree);
  if ('problem' in refetched) return failed('unpushed', build, 1, refetched.problem);
  const present = stillPresent(worktree.git, refetched.base, build.deleted);
  if ('problem' in present) return failed('unpushed', build, 1, present.problem);
  if (present.present.length === 0) return superseded(worktree, build, refetched.base, 1);

  return rebuildAndPush(worktree, settings, build, refetched.base);
}
