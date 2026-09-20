/**
 * `rafa pr merge [<n>] [--yes] [--method=squash|merge|rebase]`: the
 * pull request merged through the provider, and the five git steps
 * after it run here, each one reported.
 *
 * `src/pr/merge.ts` holds what this refuses on and what the clean-up
 * is, both as data and neither of them spawning anything. This module
 * is the half that acts: it gathers what that reading decides from,
 * asks the one question, sends the merge, and walks the steps.
 *
 * ## The order, and why everything is gathered before anything is asked
 *
 * The line first, then the config and the provider, then the pull
 * request, its checks and the three git readings, then ONE call to
 * `readMergeRefusal`, and only then the question. Two things follow:
 *
 *   - Nothing is asked and nothing is merged while any refusal stands,
 *     which is the spec's "refuse before it asks anything".
 *   - The refusal ORDER is `src/pr/merge.ts`'s alone. Gathering the
 *     working tree first and refusing on it before the provider is
 *     asked anything would save two `gh` calls on a dirty tree and put
 *     a second copy of that order here, where the two could drift. The
 *     calls are two round trips; the drift would be a refusal naming
 *     the wrong problem.
 *
 * ## The question
 *
 * `rafa init` reads an answer only when standard input is a TTY and
 * refuses otherwise, and this follows that shape: the summary line goes
 * through the output, the question goes to stderr through the same
 * {@link Prompter} `init` uses, so a json-mode stdout stays NDJSON, and
 * `--yes` skips it. Without a TTY and without `--yes` the command
 * refuses with exit code 1 rather than waiting on an answer nobody can
 * type, and it refuses BEFORE the summary line is written, so that
 * refusal carries the summary once, indented, and leaves stdout empty.
 * An answer that is not `y` or `yes`, the empty answer included,
 * declines: the question is spelled `[y/N]` and the default is no. A
 * declined merge is not a failure — nothing was merged and nothing was
 * broken — so it ends 0, saying so.
 *
 * ## After the merge, nothing is undone
 *
 * A step that fails ends the command with exit code 1 carrying that
 * step, what git said, and the whole remaining tail as commands to
 * paste ({@link remainingFrom}, `commandLine`). It never reverts,
 * resets or re-pushes: the pull request IS merged by then, and the
 * clean-up is housekeeping the operator can finish by hand. The
 * follow-ups are printed for a clean-up that finished, since what they
 * turn on — the version now on the base — is only true once the base
 * has been pulled.
 *
 * ## The roadmap tick
 *
 * GitHub closes an issue the merged pull request says `Closes #<n>` for
 * and does not tick the `- [ ] #<n>` box naming it on the roadmap, so
 * this command ticks it (per the PR commands spec). The rule and the two
 * `gh` calls are `src/board/roadmap-tick.ts`'s and the decision to make
 * them at all is `./merge-tick.ts`'s; what is decided HERE is WHEN, and
 * it is straight after the provider merged, before the clean-up. The
 * clean-up is local git and can fail, and a tick behind it would be the
 * one piece of the merge that a failed `git pull` silently dropped —
 * where the board write has nothing to do with this checkout and is as
 * true then as it is after.
 *
 * Nothing it comes to fails the command, so a roadmap that cannot be
 * read, an edit that would not land and a pull request closing no issue
 * all leave the merge reported exactly as it happened.
 *
 * ## The remote branch, and which remote
 *
 * Whether the remote branch is still there is read AFTER the merge, by
 * `git ls-remote --heads`, because a repository with GitHub's
 * "automatically delete head branches" turned on has none left by then
 * and the delete step would fail on a merge that went perfectly.
 * Measured on git 2.50.1 (2026-09-18): `ls-remote` exits 0 and writes
 * nothing for a branch the remote does not have, so the probe is "exit
 * 0 with a line", not "exit 0". A probe that FAILED is warned about and
 * read as absent, which drops one step from a clean-up that is about to
 * fail at `git pull` anyway, since every reason the probe cannot reach
 * the remote stops the pull first.
 *
 * {@link REMOTE} is the one spelling of the remote here: the probe and
 * the delete step are handed the same word, where letting
 * `cleanUpSteps` fall back to its own default would leave the probe
 * naming a remote the delete might not.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s: exit 2 for a provider that is not `gh`, exit 1 for
 * a second word, a word that is no whole number from 1, a flag that
 * swallowed the number, a config that cannot be used, a branch that
 * cannot be read, a detached HEAD, and a branch with no open pull
 * request. Its own, all exit 1: a `--method` that is none of the three;
 * a number the repository has no pull request for; a git reading that
 * failed; each of the four refusals `readMergeRefusal` answers; no
 * terminal to ask on and no `--yes`; a provider that would not merge;
 * and a clean-up step that failed.
 */
import type { FollowUp } from './merge-followups.js';
import type { PrContext, PrSeams, PullSource } from './pr-context.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RoadmapTickResult } from '../../board/roadmap-tick.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ChecksVerdict, GitRunner, MergeMethod, MergeStepId, PullRequestDetail } from '../../pr/index.js';
import type { Prompter } from '../../project/root-choice.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { tickSentence } from '../../board/roadmap-tick.js';
import { CommandExit } from '../../cli/command.js';
import {
  cleanUpSteps,
  commandLine,
  createGitRunner,
  gitSaid,
  isMergeMethod,
  MERGE_METHODS,
  parseWorkingTree,
  parseWorktrees,
  readMergeRefusal,
  remainingFrom,
} from '../../pr/index.js';
import { createLinePrompter } from '../../project/root-choice.js';
import { RUNTIME_SUBDIR } from '../../start/runtime.js';

import { readFollowUps, readPackageFacts, versionTag } from './merge-followups.js';
import { tickRoadmapAfterMerge } from './merge-tick.js';
import {
  lineRefusal,
  onProvider,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readBooleanFlag,
  readPullArgument,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.merge;

/** The remote the branch is probed on and deleted from; see the module note. */
const REMOTE = 'origin';

/** The indent a listed command or a quoted git line carries. */
const INDENT = '   ';

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** How this action reaches git and the terminal, beside what every `pr` action reaches. */
export interface MergeSeams extends PrSeams {
  /** The git runner for a root. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /** The `gh` runner the roadmap tick sends its two calls through. `createGhRunner` when left out. */
  readonly gh?: (root: string) => GhRunner;
  /** True when a question can be answered. Standard input being a TTY when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_MERGE_SEAMS: MergeSeams = Object.freeze({});

/** One clean-up step that ran, as the result carries it. */
export interface MergeStepReport {
  readonly id: MergeStepId;
  /** What was reported as it ran. */
  readonly label: string;
  /** The whole command it ran, ready to paste. */
  readonly command: string;
  /** True when git exited 0. */
  readonly ok: boolean;
}

/** What json mode gives as the terminal result's `data`. */
export interface PrMergeResult {
  readonly number: number;
  /** `argument` when `<n>` named it, `branch` when the checked-out branch did. */
  readonly source: PullSource;
  /** The head branch, which the clean-up deletes. */
  readonly branch: string;
  /** The base branch, which the clean-up switches to and pulls. */
  readonly base: string;
  readonly method: MergeMethod;
  /** The line the question was asked under. */
  readonly summary: string;
  /** True when the provider merged it. */
  readonly merged: boolean;
  /** True when the question was answered with anything but yes. */
  readonly declined: boolean;
  /** What the provider said about the merge, empty when it said nothing. */
  readonly detail: string;
  /** Each clean-up step that ran, in order; empty for a declined merge. */
  readonly steps: readonly MergeStepReport[];
  /** The follow-ups that apply, empty when neither does. */
  readonly followUps: readonly FollowUp[];
  /** What the roadmap tick came to, or null when the pull request closes no issue. */
  readonly roadmapTick: RoadmapTickResult | null;
}

/** A refusal of this action with exit code 1. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, lines.join('\n'));
}

/**
 * The merge method `--method` names, or null when the line named none,
 * which reads `pr.mergeMethod`. Any other value is refused naming the
 * three GitHub takes.
 */
export function readMethodFlag(flags: RafaContext['flags'], usage: string): MergeMethod | null {
  const value = flags['method'];
  if (value === undefined) return null;
  if (isMergeMethod(value)) return value;
  const spelled = typeof value === 'boolean'
    ? '--method with no value'
    : `"${value}"`;
  throw lineRefusal(`${spelled} is no merge method; one of: ${MERGE_METHODS.join(', ')}`, usage);
}

/** What git answered, or a refusal naming what was being read and what git said. */
function gitOrRefuse(git: GitRunner, args: readonly string[], doing: string): string {
  const result = git(args);
  if (result.ok) return result.stdout;
  throw refusal([`❌ Could not ${doing}: ${gitSaid(result)}`]);
}

/** The line the question is asked under: the pull request, its branches and the method. */
export function summaryLine(detail: PullRequestDetail, method: MergeMethod): string {
  const title = detail.title.trim();
  const head = title === ''
    ? `#${detail.number}`
    : `#${detail.number} ${title}`;
  return `${head} — ${detail.headRefName} → ${detail.baseRefName} — ${method}`;
}

/** Everything `readMergeRefusal` reads off git, gathered at the project root. */
function refuseFromGit(git: GitRunner, detail: PullRequestDetail, verdict: ChecksVerdict): void {
  const tree = parseWorkingTree(gitOrRefuse(git, ['status', '--porcelain'], 'read the working tree'));
  const worktrees = parseWorktrees(gitOrRefuse(git, ['worktree', 'list', '--porcelain'], 'list the worktrees'));
  const at = gitOrRefuse(git, ['rev-parse', '--show-toplevel'], 'read the repository root').trim();
  const found = readMergeRefusal({
    number: detail.number,
    branch: detail.headRefName,
    base: detail.baseRefName,
    tree,
    merge: { mergeable: detail.mergeable, status: detail.mergeStateStatus },
    checks: verdict,
    worktrees,
    at,
  });
  if (found !== null) throw refusal([`❌ ${found.message}`]);
}

/**
 * Refuses when there is no terminal to ask on. Read BEFORE the summary
 * line is written, so the refusal carries it once and the run that
 * cannot be answered writes nothing to stdout.
 */
function requireTerminal(seams: MergeSeams, summary: string): void {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (isTerminal()) return;
  throw refusal([
    '❌ rafa pr merge asks before merging, and standard input is no terminal.',
    `${INDENT}${summary}`,
    'Merge it without the question with --yes.',
  ]);
}

/** Whether the operator answered the question with yes. */
async function confirmed(seams: MergeSeams): Promise<boolean> {
  const open = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = open();
  try {
    const answer = await prompter.ask('Merge? [y/N] ');
    return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/** Whether the remote still holds the branch; a probe that failed is warned about. See the module note. */
function remoteHoldsBranch(git: GitRunner, branch: string, warn: (message: string) => void): boolean {
  const probe = git(['ls-remote', '--heads', REMOTE, branch]);
  if (probe.ok) return probe.stdout.trim() !== '';
  warn(`${REMOTE} could not be asked whether it still holds ${branch}, so it is left alone: ${gitSaid(probe)}`);
  return false;
}

/** The text of a file, or the empty string when it cannot be read. */
function textOf(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** The follow-ups that apply once the base has been pulled; see `merge-followups.ts`. */
function followUpsFor(pr: PrContext, git: GitRunner): readonly FollowUp[] {
  const facts = readPackageFacts(textOf(join(pr.project.root, 'package.json')));
  if (facts.version === null) return [];
  const tags = git(['tag', '--list', versionTag(facts.version)]);
  return readFollowUps({
    version: facts.version,
    tagged: tags.ok && tags.stdout.trim() !== '',
    snapshotScript: facts.snapshotScript,
    runtimeInstalled: existsSync(join(pr.project.home, RUNTIME_SUBDIR, facts.version)),
  });
}

/**
 * Ticks the roadmap for the merge that just went through and prints the
 * one line it came to; see the module note. A tick that could not be
 * written is a warning and nothing else.
 */
async function reportTick(
  context: RafaContext,
  pr: PrContext,
  seams: MergeSeams,
  detail: PullRequestDetail,
): Promise<RoadmapTickResult | null> {
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const tick = await tickRoadmapAfterMerge({
    body: detail.body,
    configured: pr.roadmapIssue,
    gh: (seams.gh ?? ((root: string) => createGhRunner({ cwd: root })))(pr.project.root),
    warn,
  });
  if (tick === null) return null;

  if (tick.status === 'failed') warn(tickSentence(tick));
  else context.output.info(tickSentence(tick));
  return tick;
}

/** The line saying what is ready, which the remote delete having run changes. */
function readyLine(base: string, branch: string, remoteBranchPresent: boolean): string {
  const remote = remoteBranchPresent
    ? `and ${branch} is gone locally and on ${REMOTE}.`
    : `and ${branch} is gone locally; ${REMOTE} had already deleted it.`;
  return `${base} is checked out and pulled, ${remote}`;
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/** Runs the clean-up, reporting each step, and refuses at the first that failed; see the module note. */
function runCleanUp(
  context: RafaContext,
  git: GitRunner,
  detail: PullRequestDetail,
  remoteBranchPresent: boolean,
): readonly MergeStepReport[] {
  const steps = cleanUpSteps({
    branch: detail.headRefName,
    base: detail.baseRefName,
    remote: REMOTE,
    remoteBranchPresent,
  });
  const reports: MergeStepReport[] = [];
  for (const step of steps) {
    const result = git(step.argv.slice(1));
    reports.push({ id: step.id, label: step.label, command: commandLine(step), ok: result.ok });
    if (result.ok) {
      context.output.info(`${step.label}: done`);
      continue;
    }
    throw refusal([
      `❌ ${step.label}: failed`,
      ...quotedLines(gitSaid(result)),
      `#${detail.number} is merged, and the merge is left alone. Run the rest yourself:`,
      ...remainingFrom(steps, step.id).map((left) => `${INDENT}${commandLine(left)}`),
    ]);
  }
  return reports;
}

/** Merges the pull request and cleans up after it, reporting each line; see the module note. */
export async function runMerge(context: RafaContext, seams: MergeSeams): Promise<PrMergeResult> {
  const yes = readBooleanFlag(context.flags, 'yes', USAGE);
  const wanted = readMethodFlag(context.flags, USAGE);
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const git = (seams.git ?? createGitRunner)(pr.project.root);
  const method = wanted ?? pr.mergeMethod;

  const pick = await pickPullRequest(pr, asked, USAGE);
  const detail = await onProvider(`read pull request #${pick.number}`, () => pr.pulls.get(pick.number));
  if (detail === null) {
    throw lineRefusal(`No pull request #${pick.number} at ${pr.project.root}`, USAGE);
  }
  const checks = await onProvider(`read the checks of #${pick.number}`, () => pr.pulls.checks(pick.number));
  refuseFromGit(git, detail, checks.verdict);

  const summary = summaryLine(detail, method);
  if (!yes) requireTerminal(seams, summary);
  context.output.info(summary);
  // What the run answers if it stops here, and the base of what it answers if it does not.
  const answered: PrMergeResult = {
    number: detail.number,
    source: pick.source,
    branch: detail.headRefName,
    base: detail.baseRefName,
    method,
    summary,
    merged: false,
    declined: true,
    detail: '',
    steps: [],
    followUps: [],
    roadmapTick: null,
  };
  if (!yes && !await confirmed(seams)) {
    context.output.info('Nothing was merged.');
    return answered;
  }

  const outcome = await onProvider(`merge #${detail.number}`, () => pr.pulls.merge(detail.number, method));
  if (!outcome.merged) {
    throw refusal([`❌ ${pr.pulls.kind} would not merge #${detail.number}: ${outcome.detail}`]);
  }
  context.output.info(`Merged #${detail.number} into ${detail.baseRefName} (${method}).`);
  const roadmapTick = await reportTick(context, pr, seams, detail);

  const remoteBranchPresent = remoteHoldsBranch(git, detail.headRefName, (message) => {
    context.output.warn(message);
  });
  const steps = runCleanUp(context, git, detail, remoteBranchPresent);
  context.output.info(readyLine(detail.baseRefName, detail.headRefName, remoteBranchPresent));

  const followUps = followUpsFor(pr, git);
  if (followUps.length > 0) {
    context.output.info('Follow-ups:');
    for (const followUp of followUps) context.output.info(`${INDENT}${followUp.command} — ${followUp.why}`);
  }

  return { ...answered, merged: true, declined: false, detail: outcome.detail, steps, followUps, roadmapTick };
}

/** The command, reaching the provider, git and the terminal through `seams`; see the module note. */
export function createPrMergeCommand(seams: MergeSeams = DEFAULT_MERGE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr merge',
    subject: 'pr',
    action: 'merge',
    summary: 'merge a pull request and clean up both branches',
    description: 'Merges one pull request through the GitHub CLI and then, in code, switches to the base branch,'
      + ' pulls it fast-forward only, deletes the head branch locally and on the remote where it is still there,'
      + ' and prunes, reporting each step. Refuses before it asks anything on a dirty working tree, on a pull'
      + ' request that is not green or does not merge, and on a head branch checked out in another worktree. It'
      + ' shows the pull request, its branches and the method and asks `Merge? [y/N]`; `--yes` skips the question,'
      + ' and without a terminal and without `--yes` it refuses. A step that fails never undoes the merge: it'
      + ' prints what is left as commands to paste and exits 1. After the merge it ticks the `Closes #<n>` line of'
      + ' every issue the pull request closes on the roadmap issue, warning rather than failing when that write'
      + ' does not land. With `--output=json` the pull request, the method, the steps that ran, the follow-ups and'
      + ' the roadmap tick are the data of the terminal result event. Refuses with exit code 2 where `pr.provider`'
      + ' is not `gh`.',
    args: [
      {
        name: 'n',
        description: 'The pull request number. The open pull request of the current branch when it is left out.',
        type: 'number',
      },
    ],
    flags: [
      {
        name: 'yes',
        description: 'Merge without asking. Needed where standard input is no terminal.',
        type: 'boolean',
      },
      {
        name: 'method',
        description: 'How to merge: squash, merge or rebase. `pr.mergeMethod` when it is left out.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa pr merge',
        note: 'Asks, then merges the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr merge 41 --yes',
        note: 'Merges pull request 41 without asking, then runs the clean-up.',
      },
      {
        cmd: 'rafa pr merge 41 --method=rebase --output=json',
        note: 'Merges by rebase and writes a result event holding each clean-up step and the follow-ups.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const merged = await runMerge(context, seams);
      if (context.outputMode === 'json') context.output.result(merged);
    },
  };
  return Object.freeze(command);
}

export default createPrMergeCommand();
