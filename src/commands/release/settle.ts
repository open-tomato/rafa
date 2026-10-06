/**
 * `rafa release settle [--dry-run]`: the fragments waiting on the base
 * branch folded into one version and one changelog section, committed
 * as `chore: release <version>` and delivered by `release.settle`. The
 * command reads its line and the config, hands the work to
 * `src/release/`, and prints what came back; it assembles no `git` or
 * `gh` argv of its own.
 *
 * ```text
 * rafa release settle            → fold, commit, deliver, maybe tag
 * rafa release settle --dry-run  → fold only; writes nothing
 * ```
 *
 * ## The steps
 *
 * Both forms run inside the scratch worktree of `origin/<pr.base>` that
 * `withSettleWorktree` (`src/release/settle-worktree.ts`) fetches, adds
 * and removes on every path out, so the caller's checkout and index are
 * never touched, whatever branch it is on.
 *
 *   - `--dry-run` reads the settle at the worktree's `HEAD`
 *     (`readSettle`, `src/release/settle.ts`) and stops: no file, no
 *     commit, no push. The worktree is scratch, so `git status` in the
 *     caller's checkout reads as it did before.
 *   - Without it, the delivery `release.settle` names runs:
 *     `settleByPush` (`src/release/settle-push.ts`) for `push`, the
 *     default, and `settleByPr` (`src/release/settle-pr.ts`) for `pr`,
 *     which first resolves the `gh` provider as every `pr` action does
 *     and is refused with exit code 2 without one. Then `tagSettle`
 *     (`src/release/settle-tag.ts`) applies `release.tag`.
 *
 * ## What it prints
 *
 * Every run names the strategy that answered, the base commit and the
 * version it declares, and the fragments in fold order — the order the
 * base received them, first-parent add commit first — each with its
 * level, its title and the commit and date that added it. A fold that
 * answered adds the version it moves to; a delivery adds one line for
 * what it did, and a tag one more. After a push that was retried, the
 * reading printed is the REBUILT one, the batch the base now holds.
 *
 * ## Exit codes
 *
 * 0 when the settle is done or there was nothing to do: a dry run that
 * folded or found nothing, a push or pull request delivered, a push
 * whose fragments another settle released first. 1 for everything
 * else — a base that could not be fetched or read, a fragment that
 * does not parse, a strategy that threw, a commit that could not be
 * built, a push refused twice, by branch protection or by a repository
 * rule, a pull request step that failed, and a tag that could not be
 * written or pushed after a push that landed. The failure's sentence is
 * the refusal; the reading above it is printed first either way, and no
 * success line follows it: a refused push's sentence carries none of
 * the `Done` git's `--porcelain` prints after a refusal
 * (`src/release/settle-push.ts`, #765). In json mode a
 * run exiting 0 gives {@link ReleaseSettleResult} as the terminal
 * result's data.
 *
 * It starts no Claude session and declares no `spends`.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { GitRunner, PullRequests } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';
import type { SettleDelivered, SettleTagOutcome } from '../../release/settle-tag.js';
import type { SettleWorktreeOptions } from '../../release/settle-worktree.js';
import type { SettleBuild, SettleReading, SettleSettings } from '../../release/settle.js';

import { CommandExit } from '../../cli/command.js';
import { createGitRunner, ghPullRequestsIn, requireGhProvider, resolvePrProvider } from '../../pr/index.js';
import { settleByPr } from '../../release/settle-pr.js';
import { settleByPush } from '../../release/settle-push.js';
import { tagSettle } from '../../release/settle-tag.js';
import { withSettleWorktree } from '../../release/settle-worktree.js';
import { readSettle, releaseCommitSubject } from '../../release/settle.js';
import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from '../../release/version.js';
import { expectNoArgument, readSwitch, resolveProjectConfig } from '../plan/plan-files.js';

/** The usage line this action's refusals name. */
export const RELEASE_SETTLE_USAGE = 'rafa release settle [--dry-run]';

/** The command's name, as a config refusal opens. */
const COMMAND_NAME = 'rafa release settle';

/** The flag that reads without writing. */
const DRY_RUN_FLAG = 'dry-run';

/** What every line under a heading is indented by. */
const INDENT = '  ';

/** How many characters of a hash a line names. */
const SHORT_HASH = 12;

/** How the action reaches git, the scratch directory and the provider; each left out is the system's own. */
export interface ReleaseSettleSeams {
  /** Makes the git runner of the caller's repository. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /** Where the scratch worktree's directory is made. The system temporary directory when left out. */
  readonly scratchRoot?: string;
  /** The provider a `pr` delivery opens its pull request through. `ghPullRequestsIn` when left out. */
  readonly pullRequests?: (root: string) => PullRequests;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
}

/** The seams the registered action runs with: the system's own, every one. */
export const DEFAULT_RELEASE_SETTLE_SEAMS: ReleaseSettleSeams = Object.freeze({});

/** What a run answers: its lines, its exit code, and the sentence an exit 1 refuses with. */
export interface ReleaseSettleResult {
  /** True for `--dry-run`. */
  readonly dryRun: boolean;
  /** `release.settle`, or null for a dry run, which delivers nothing. */
  readonly delivery: RafaConfig['releaseSettle'] | null;
  /** The reading or the build the lines were rendered from. */
  readonly reading: SettleReading | SettleBuild;
  /** What the delivery answered, or null for a dry run. */
  readonly delivered: SettleDelivered | null;
  /** What `release.tag` did, or null for a dry run. */
  readonly tag: SettleTagOutcome | null;
  /** 0 or 1; see the module note. */
  readonly exitCode: 0 | 1;
  /** The refusal an exit 1 carries, or null for exit 0. */
  readonly problem: string | null;
  /** The text-mode lines, the refusal left out. */
  readonly lines: readonly string[];
}

/** The project the dispatcher resolved, which it resolves for this action. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error(`${COMMAND_NAME} runs inside a project, and was handed none`);
  return context.project;
}

/** The settings a settle reads, off the resolved config. */
function settleSettings(config: RafaConfig): SettleSettings {
  return {
    releaseVersionFile: config.releaseVersionFile,
    releaseChangelog: config.releaseChangelog,
    releaseFragments: config.releaseFragments,
    releaseStrategy: config.releaseStrategy,
    releaseHeading: config.releaseHeading,
  };
}

/** A hash as a line names it. */
function short(hash: string): string {
  return hash.slice(0, SHORT_HASH);
}

/**
 * The lines every reading prints: the strategy, then — for one that got
 * as far as the fold — the base, the fragments in fold order and the
 * version it moves to. `ref` names the base as the worktree was made.
 */
export function readingLines(reading: SettleReading | SettleBuild, ref: string): readonly string[] {
  const lines = [`Strategy: ${reading.strategy}`];
  if (reading.outcome === 'unread') return lines;
  if (reading.outcome === 'malformed') {
    return [...lines, `Base: ${ref} at ${short(reading.commit)}`];
  }
  lines.push(`Base: ${ref} at ${short(reading.commit)}, version ${reading.baseVersion}`);
  if (reading.fragments.length === 0) {
    lines.push('Fragments: none waiting');
  } else {
    lines.push('Fragments, in the order the base received them:');
    reading.fragments.forEach((each, index) => {
      const { level, title } = each.fragment;
      lines.push(`${INDENT}${String(index + 1)}. ${each.path} — ${level}, "${title}", added ${each.addedOn} in ${short(each.commit)}`);
    });
  }
  if (reading.outcome === 'folded' || reading.outcome === 'built' || reading.outcome === 'unbuilt') {
    lines.push(`Version: ${reading.baseVersion} → ${reading.version}`);
  }
  return lines;
}

/** The sentence a reading that folded nothing and wrote nothing ends on, and whether it refuses. */
function unwrittenEnding(reading: Exclude<SettleReading, { outcome: 'folded' }>): { readonly line: string; readonly refuses: boolean } {
  switch (reading.outcome) {
    case 'unread':
      return { line: `❌ Nothing was folded: ${reading.problem}`, refuses: true };
    case 'malformed':
      return { line: `❌ No fragment was folded, since ${reading.problems.join('; ')}`, refuses: true };
    case 'failed':
      return { line: `❌ Nothing was written: ${reading.line}`, refuses: true };
    case 'nothing':
      return { line: 'Nothing to settle: no fragment waits that ships a release.', refuses: false };
  }
}

/** A result from its parts: an ending that refuses is the problem, any other is the last line. */
function resultOf(
  base: Pick<ReleaseSettleResult, 'dryRun' | 'delivery' | 'reading' | 'delivered' | 'tag'>,
  lines: readonly string[],
  problem: string | null,
): ReleaseSettleResult {
  const exitCode = problem === null
    ? 0
    : 1;
  return { ...base, lines, problem, exitCode };
}

/** The dry run's answer: the reading, and what a settle would commit. */
export function dryRunResult(reading: SettleReading, ref: string, branch: string): ReleaseSettleResult {
  const base = { dryRun: true, delivery: null, reading, delivered: null, tag: null };
  const lines = [...readingLines(reading, ref)];
  if (reading.outcome === 'folded') {
    lines.push(`Dry run: settle would commit "${releaseCommitSubject(reading.version)}" on ${branch}; nothing was written.`);
    return resultOf(base, lines, null);
  }
  const ending = unwrittenEnding(reading);
  return ending.refuses
    ? resultOf(base, lines, ending.line)
    : resultOf(base, [...lines, ending.line], null);
}

/** The delivery's line, and whether it refuses. */
function deliveryEnding(delivered: SettleDelivered, branch: string): { readonly line: string; readonly refuses: boolean } {
  const { outcome } = delivered;
  if (outcome.outcome === 'unsettled') {
    const { build } = outcome;
    if (build.outcome === 'unbuilt') return { line: `❌ The release commit could not be built: ${build.problem}`, refuses: true };
    return unwrittenEnding(build);
  }
  const subject = releaseCommitSubject(outcome.build.version);
  switch (outcome.outcome) {
    case 'pushed': {
      const retried = outcome.attempts === 2
        ? ', after one rebuild over a base that moved'
        : '';
      return { line: `✅ Pushed "${subject}" (${short(outcome.build.release)}) to ${branch}${retried}.`, refuses: false };
    }
    case 'superseded':
      return { line: `✅ ${outcome.sentence}`, refuses: false };
    case 'delivered': {
      const held = outcome.pushed
        ? ''
        : '; the branch already held this release';
      return { line: `✅ Release pull request #${String(outcome.pull.number)} ${outcome.action}, "${outcome.pull.title}" into ${branch}${held}: ${outcome.pull.url}`, refuses: false };
    }
    default:
      return { line: `❌ ${outcome.sentence}`, refuses: true };
  }
}

/** A settle's answer: the reading its delivery ended on, the delivery's line and the tag's. */
export function settledResult(
  delivered: SettleDelivered,
  tag: SettleTagOutcome,
  ref: string,
  branch: string,
): ReleaseSettleResult {
  const reading = delivered.outcome.build;
  const base = { dryRun: false, delivery: delivered.delivery, reading, delivered, tag };
  const lines = [...readingLines(reading, ref)];
  const ending = deliveryEnding(delivered, branch);
  if (ending.refuses) return resultOf(base, lines, ending.line);
  lines.push(ending.line);
  if (tag.outcome === 'failed') return resultOf(base, lines, `❌ ${tag.sentence}`);
  if (tag.outcome === 'tagged') lines.push(`✅ ${tag.sentence}`);
  if (tag.outcome === 'skipped' && tag.sentence !== null) lines.push(`Tag: ${tag.sentence}`);
  return resultOf(base, lines, null);
}

/** The provider a `pr` delivery needs, refused with exit code 2 when it is not `gh`. */
function providerFor(project: ProjectFound, config: RafaConfig, seams: ReleaseSettleSeams): PullRequests {
  requireGhProvider(resolvePrProvider({ configured: config.prProvider, dir: project.root, readRemote: seams.readRemote }));
  return (seams.pullRequests ?? ghPullRequestsIn)(project.root);
}

/** One whole run: the line, the config, the worktree and what ran in it; see the module note. */
export async function runSettle(
  context: RafaContext,
  seams: ReleaseSettleSeams = DEFAULT_RELEASE_SETTLE_SEAMS,
): Promise<ReleaseSettleResult> {
  expectNoArgument(context.args, RELEASE_SETTLE_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${RELEASE_SETTLE_USAGE}`);
  const project = projectOf(context);
  const config = resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const settings = settleSettings(config);
  const branch = config.prBase ?? RELEASE_BASE_BRANCH;
  const pulls = !dryRun && config.releaseSettle === 'pr'
    ? providerFor(project, config, seams)
    : null;
  const options: SettleWorktreeOptions = {
    git: (seams.git ?? createGitRunner)(project.root),
    base: { remote: RELEASE_REMOTE, branch },
    scratchRoot: seams.scratchRoot,
  };

  const ran = await withSettleWorktree(options, async (worktree) => {
    if (dryRun) return dryRunResult(readSettle(worktree.git, 'HEAD', settings), worktree.ref, branch);
    const delivered: SettleDelivered = pulls === null
      ? { delivery: 'push', outcome: settleByPush(worktree, settings) }
      : { delivery: 'pr', outcome: await settleByPr(worktree, settings, pulls) };
    const tag = tagSettle(worktree, config.releaseTag, delivered);
    return settledResult(delivered, tag, worktree.ref, branch);
  });
  if (ran.leftover !== null) context.output.warn(`The settle worktree was not fully removed: ${ran.leftover}`);
  if (!ran.ok) throw new CommandExit(1, `❌ ${ran.problem}`);
  return ran.value;
}

/** The command, reaching git and the provider through `seams`; see the module note. */
export function createReleaseSettleCommand(seams: ReleaseSettleSeams = DEFAULT_RELEASE_SETTLE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'release settle',
    subject: 'release',
    action: 'settle',
    summary: 'fold the fragments waiting on the base branch into one version and changelog section',
    description: 'Fetches `origin/<pr.base>` (or `origin/main`) and works in a scratch worktree of it, so the'
      + ' checkout it runs from is never touched. It lists the fragments under `release.fragments` in the order'
      + ' the base received them, folds them through `release.strategy` into the next version and one'
      + ' changelog section, writes both, deletes the folded fragments and commits `chore: release <version>`.'
      + ' With `release.settle: push` (the default) the commit is pushed to the base, never forced; a refused'
      + ' push fetches again and ends as settled when another run released the same fragments, or rebuilds'
      + ' and pushes once more. With `release.settle: pr` it goes to `rafa/release` and one pending release'
      + ' pull request is opened or updated. `release.tag: settle` tags a pushed release. It prints the'
      + ' strategy, the base version, the fragments in order and the new version, and exits 0 when the'
      + ' release is delivered or nothing waits, 1 otherwise. With `--dry-run` it prints the same reading'
      + ' and writes nothing. With `--output=json` a run exiting 0 gives the reading and what was delivered'
      + ' as the data of the terminal result event. Starts no session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Print the fragments, their order, the strategy and the version, and write nothing:'
          + ' no commit, no push, no tag.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa release settle',
        note: 'Folds the waiting fragments into a release commit and delivers it by `release.settle`.',
      },
      {
        cmd: 'rafa release settle --dry-run',
        note: 'Prints what a settle would fold and the version it would write, writing nothing.',
      },
      {
        cmd: 'rafa release settle --output=json',
        note: 'Settles and gives the reading and the delivery as a result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await runSettle(context, seams);
      if (context.outputMode === 'json') {
        if (result.problem !== null) throw new CommandExit(1, result.problem);
        context.output.result(result);
        return;
      }
      for (const line of result.lines) context.output.info(line);
      if (result.problem !== null) throw new CommandExit(1, result.problem);
    },
  };
  return Object.freeze(command);
}

export default createReleaseSettleCommand();
