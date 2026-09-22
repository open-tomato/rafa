/**
 * What `rafa pr current`, `show`, `view`, `list`, `merge`, `triage` and
 * `wait` share: the usage line each refuses with, the words and flags
 * each reads off its line, the provider check and its exit-2 refusal,
 * and which pull request an action acts on.
 *
 * ## The order an action does things in
 *
 * A line is read FIRST, by the readers here, then the config, then the
 * provider. So a line refused for its words reads no config, resolves no
 * provider and spawns no `gh`, which is the rule `issue-tracker.ts`
 * keeps for the `issue` subject; `pr-context.test.ts` holds it as a
 * reading over a seam that records whether it was reached.
 *
 * ## The provider, and the one refusal
 *
 * {@link openPrContext} resolves `pr.provider` through
 * `resolvePrProvider` (`src/pr/provider.ts`) with the PROJECT ROOT as
 * the repository, and hands the reading to `requireGhProvider`, which
 * throws `CommandExit(2, PR_NEEDS_GH)` for anything but `gh`. The
 * message is a constant there, so every one of the seven refuses a
 * repository without a `gh` provider with the same words, whether the
 * config said `none` or `origin` is no GitHub remote.
 *
 * What it does NOT check is whether `gh` is installed and authenticated.
 * That is the two REQUIRED preflight items a `gh` provider contributes
 * (`src/pr/preflight-items.ts`), checked ahead of any session and
 * printed by `rafa doctor`; probing again here would spawn `gh` twice
 * for every action. An action that then runs a `gh` which is absent
 * meets {@link onProvider}, which names what was being done and what
 * the CLI said.
 *
 * ## Which pull request
 *
 * `<n>` when the line names one, and otherwise the open pull request of
 * the branch checked out AT THE PROJECT ROOT — not at the process's
 * working directory, which is a subdirectory of it as often as not, and
 * may be another checkout entirely. `loop-sessions.ts` reads a branch at
 * a root for the same reason, and `utils/git.ts`'s reader, which reads
 * the process's own directory, is why neither imports it.
 *
 * Three readings of `git rev-parse --abbrev-ref HEAD`, measured on git
 * 2.51 (2026-09-18), shape {@link pickPullRequest}:
 *
 *   - At a detached HEAD it writes `HEAD` and exits 0. So a detached
 *     HEAD is not a branch name to look a pull request up by, and it is
 *     refused by name rather than sent to the provider, where it would
 *     come back as "no open pull request for the branch HEAD".
 *   - In a repository with no commit yet it writes `HEAD` too, and exits
 *     128 with `fatal: ambiguous argument 'HEAD'` on stderr.
 *   - Outside a repository it exits 128 with `fatal: not a git
 *     repository`.
 *
 * The last two throw out of `execFileSync`, and are refused as a branch
 * that cannot be read, with git's own words in the message.
 *
 * A number the line named is NOT checked against the repository here: it
 * is a whole number from 1 and nothing more. The action's own read
 * answers null for a pull request the repository has none of, and that
 * refusal is the action's, so nothing spends a `gh` call to find out
 * twice. What a branch lookup already answered is carried on the pick
 * ({@link PullPick.summary}), so an action that wants the title and the
 * state does not ask for them again.
 *
 * ## Type the number before the flags
 *
 * `parseArgs` gives a flag the word after it as its value unless that
 * word opens with `-`, whatever type the flag declares, so
 * `rafa pr merge --yes 12` reads `12` as the value of `--yes` and hands
 * the command no number at all. {@link readBooleanFlag} refuses that
 * value naming the order that works, and an action reads its flags
 * AHEAD of its argument, so the line meets that refusal rather than the
 * one saying it named no pull request, which is true of it and says
 * nothing about why. `agent vendor` and `skill check --fix` refuse the
 * same way.
 *
 * `--method`, `--max-attempts` and `--timeout` are read by the one
 * action each belongs to. They are a choice and two numbers, they are
 * refused in that action's own words, and a reader here would be shared
 * by nobody.
 *
 * ## The exit codes
 *
 * 2 for a provider that is not `gh`, and that alone: the spec gives
 * every `pr` action the same code and the same message for it. 1 for
 * every other refusal — a line handing an action the wrong words, a
 * flag swallowing the number, a config `loadConfig` refuses, a branch
 * that cannot be read, a detached HEAD, a branch with no open pull
 * request, and a provider call that rejected.
 */
import type { RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { GhProviderReading, MergeMethod, PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { ProjectFound } from '../../project/scope.js';

import { execFileSync } from 'node:child_process';

import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { messageOf } from '../../config-sections.js';
import { ConfigError } from '../../config.js';
import { ghPullRequestsIn, requireGhProvider, resolvePrProvider } from '../../pr/index.js';

/** One of the seven actions of the `pr` subject. */
export type PrAction = 'current' | 'show' | 'view' | 'list' | 'merge' | 'triage' | 'wait';

/**
 * The usage line each action's refusals name.
 *
 * `<n>` is optional wherever an action takes one, because the branch
 * answers it; the flags come after it, for the reason in the module
 * note. A flag's placeholder here and the one help renders from the
 * flag's type are allowed to differ, as `skill check` and `agent vendor`
 * already do (`context/cli.md`).
 */
export const PR_USAGE: Readonly<Record<PrAction, string>> = Object.freeze({
  current: 'rafa pr current',
  show: 'rafa pr show [<n>]',
  view: 'rafa pr view [<n>]',
  list: 'rafa pr list',
  merge: 'rafa pr merge [<n>] [--yes] [--skip-checks] [--method=squash|merge|rebase]',
  triage: 'rafa pr triage [<n>] [--no-comment] [--resolve] [--max-attempts=<count>]',
  wait: 'rafa pr wait [<n>] [--timeout=<minutes>]',
});

/** A pull request number as a line writes it: a whole number from 1. */
const PULL_NUMBER = /^[1-9]\d*$/;

/** What `git rev-parse --abbrev-ref HEAD` writes at a detached HEAD; measured, see the module note. */
const DETACHED_HEAD = 'HEAD';

/** The flags of a line, as a command's context holds them. */
export type LineFlags = RafaContext['flags'];

/** A refusal of the line with exit code 1: the problem, then the usage line. */
export function lineRefusal(problem: string, usage: string): CommandExit {
  return new CommandExit(1, `❌ ${problem}\nUsage: ${usage}`);
}

/** Refuses a line handing an action taking no argument any word. */
export function expectNoArguments(args: readonly string[], usage: string): void {
  if (args.length === 0) return;
  throw lineRefusal(`Expected no arguments, got ${args.length}: ${args.join(' ')}`, usage);
}

/**
 * The pull request number a line names, or null when it names none — the
 * ordinary line, which the branch answers. A second word, and a word
 * that is no whole number from 1, are refused with exit code 1.
 */
export function readPullArgument(args: readonly string[], usage: string): number | null {
  if (args.length === 0) return null;
  if (args.length > 1) {
    throw lineRefusal(`Expected at most one pull request number, got ${args.length}: ${args.join(' ')}`, usage);
  }
  const word = args[0] ?? '';
  if (!PULL_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no pull request number, which is a whole number from 1`, usage);
  }
  return Number(word);
}

/**
 * A boolean flag as the line spelled it: bare, negated as `--no-<name>`,
 * or written `--<name>=true|false`. `whenAbsent` is what a line leaving
 * it out reads as, which is true for a flag spelled `--no-<name>`. Any
 * other value is refused naming the order that works; see the module
 * note.
 */
export function readBooleanFlag(flags: LineFlags, name: string, usage: string, whenAbsent = false): boolean {
  const value = flags[name];
  if (value === undefined) return whenAbsent;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(
    `--${name} takes no value, and read "${value}" as one; type the pull request number before the flags`,
    usage,
  );
}

/** How an action reaches the provider and the branch; each left out is the system's own. */
export interface PrSeams {
  /** The provider for a repository. {@link ghPullRequestsIn} when left out. */
  readonly pullRequests?: (root: string) => PullRequests;
  /** The branch checked out at a root; throws when it cannot be read. Git's own reader when left out. */
  readonly readBranch?: (root: string) => string;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
}

/** The seams the registered actions run with: the system's own, every one. */
export const DEFAULT_PR_SEAMS: PrSeams = Object.freeze({});

/** What every `pr` action runs with, once the provider has been checked. */
export interface PrContext {
  /** The project the dispatcher resolved, whose root every probe runs at. */
  readonly project: ProjectFound;
  /** The provider reading, whose provider is `gh`; `source` says which answer decided. */
  readonly reading: GhProviderReading;
  /** The provider itself, made for the project root. */
  readonly pulls: PullRequests;
  /** `pr.mergeMethod`, as `pr merge` uses it with no `--method`. */
  readonly mergeMethod: MergeMethod;
  /** `pr.base`, or null when nobody has named one. */
  readonly base: string | null;
  /** `pr.resolveBudget`, the US dollars each `pr triage --resolve` session is capped at. */
  readonly resolveBudget: number;
  /** `board.trustedAuthors`: the logins board text is trusted from without a permission lookup. */
  readonly trustedAuthors: readonly string[];
  /** `roadmap.issue`, or null when nobody named one, as `pr merge` ticks it. */
  readonly roadmapIssue: number | null;
  /** The branch checked out at the project root; throws when git cannot read it. */
  readonly readBranch: () => string;
}

/** Where a picked pull request number came from. */
export type PullSource = 'argument' | 'branch';

/** The pull request an action acts on, and what answering it already read. */
export interface PullPick {
  readonly number: number;
  /** `argument` when `<n>` named it, `branch` when the checked-out branch did. */
  readonly source: PullSource;
  /** The branch it was found on, or null when `<n>` named it. */
  readonly branch: string | null;
  /** What the branch lookup answered, or null when `<n>` named it; see the module note. */
  readonly summary: PullRequestSummary | null;
}

/** The pull request settings an action reads off the config. */
type PrConfig = Pick<
  RafaConfig,
  'prProvider' | 'prMergeMethod' | 'prBase' | 'prResolveBudget' | 'boardTrustedAuthors' | 'roadmapIssue'
>;

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa pr runs inside a project, and was handed none');
  return context.project;
}

/** The `pr` settings as the config resolves for the project, refusing a config `loadConfig` refuses. */
function prConfig(project: ProjectFound, warn: (message: string) => void): PrConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(
      1,
      ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'),
    );
  }
}

/** The branch checked out at `root`, read by git there; throws when it cannot be read. */
function gitBranch(root: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * The config, the provider and the branch reader every `pr` action runs
 * with, or the exit-2 refusal a provider that is not `gh` gets. Warnings
 * the config raises are written through the command's output. See the
 * module note for what it checks and what it leaves to preflight.
 */
export function openPrContext(context: RafaContext, seams: PrSeams = DEFAULT_PR_SEAMS): PrContext {
  const project = projectOf(context);
  const config = prConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const reading = requireGhProvider(resolvePrProvider({
    configured: config.prProvider,
    dir: project.root,
    readRemote: seams.readRemote,
  }));
  const makeProvider = seams.pullRequests ?? ghPullRequestsIn;
  const readBranch = seams.readBranch ?? gitBranch;

  return {
    project,
    reading,
    pulls: makeProvider(project.root),
    mergeMethod: config.prMergeMethod,
    base: config.prBase,
    resolveBudget: config.prResolveBudget,
    trustedAuthors: config.boardTrustedAuthors,
    roadmapIssue: config.roadmapIssue,
    readBranch: () => readBranch(project.root),
  };
}

/**
 * What `call` answers, or, when it rejects, a refusal with exit code 1
 * naming what was being done and what the provider said.
 */
export async function onProvider<T>(doing: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new CommandExit(1, `❌ Could not ${doing}: ${messageOf(error)}`);
  }
}

/** The branch a pull request is looked up by, refusing a detached HEAD and a branch git cannot read. */
function branchOf(pr: PrContext, usage: string): string {
  let branch: string;
  try {
    branch = pr.readBranch();
  } catch (error) {
    throw lineRefusal(`The branch checked out at ${pr.project.root} cannot be read: ${messageOf(error)}`, usage);
  }
  if (branch === DETACHED_HEAD || branch === '') {
    throw lineRefusal(`${pr.project.root} is on no branch, and a detached HEAD names no pull request`, usage);
  }
  return branch;
}

/**
 * The pull request an action acts on: `asked` when the line named one,
 * and otherwise the open pull request of the branch checked out at the
 * project root. A branch with no open pull request is refused with exit
 * code 1 naming the branch; see the module note.
 */
export async function pickPullRequest(pr: PrContext, asked: number | null, usage: string): Promise<PullPick> {
  if (asked !== null) {
    return { number: asked, source: 'argument', branch: null, summary: null };
  }
  const branch = branchOf(pr, usage);
  const summary = await onProvider(
    `read the open pull request for the branch "${branch}"`,
    () => pr.pulls.findOpen(branch),
  );
  if (summary === null) {
    throw lineRefusal(
      `No open pull request for the branch "${branch}" at ${pr.project.root}`
        + '\nRun rafa pr list to see the open pull requests.',
      usage,
    );
  }
  return { number: summary.number, source: 'branch', branch, summary };
}
