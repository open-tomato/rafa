/**
 * What `rafa pr merge` refuses on, and the clean-up it runs after the
 * merge — both as data, neither of them spawning anything.
 *
 * The command around this module asks `gh` to merge and then runs five
 * git commands itself. Everything here is the part of that which can be
 * decided without a repository: a refusal is a pure reading over four
 * inputs the caller has already gathered, and the clean-up is a list of
 * steps rather than a function that runs them. Two things follow from
 * that split, and both are why it is drawn here:
 *
 *  - Every refusal is measurable from a literal. A dirty tree, a red
 *    PR, a conflicting one and a branch held by another worktree are
 *    four cases that would otherwise each need a repository planted
 *    into the state that produces them, and the case that matters most
 *    — a merge that should NOT happen — is the one hardest to plant.
 *  - The steps the command runs and the steps a failure prints for the
 *    operator to paste are the SAME list. A failure after the merge
 *    never undoes the merge (`.rafa/specs/rafa-20-pr-commands.md`); it
 *    reports what is left, and {@link remainingFrom} over the same
 *    array is how that stays true to what ran. Nothing here reverts,
 *    resets or force-pushes, and no step's argv writes history.
 *
 * ## The order the refusals are read in
 *
 * Working tree, then merge state, then checks, then worktrees — the
 * spec's own order, with one decision inside it. The MERGE STATE is
 * read before the checks verdict because a conflicting pull request
 * schedules no workflow run at all: GitHub cannot build
 * `refs/pull/<n>/merge` for a head that does not merge, so its checks
 * read `none` (`./checks.ts` records the same reading and leaves the
 * distinction to the caller, which is this). Reading the verdict first
 * would answer "it reports no checks at all" for a pull request whose
 * actual problem is a conflict, and send the operator to look for a
 * workflow that was never scheduled. `merge-state-before-checks` in
 * `merge.test.ts` holds that.
 *
 * ## `skipChecks`: verdict `none` alone
 *
 * {@link MergeRefusalReading.skipChecks} is `--skip-checks` read in. It
 * lifts the checks refusal for verdict `none` and for nothing else: a
 * pull request with zero check rows has nothing to wait for and nothing
 * to fix. On `pending`, `red` or `green` the flag is itself the refusal
 * (`skip-checks-refused`), because each has check rows and skipping them
 * would merge past a run still going, a run that failed, or — for green —
 * a flag that says something untrue about the merge. That refusal lists
 * each row of {@link MergeRefusalReading.rows} with its state, so the
 * operator sees what the flag would have skipped. It is read at the
 * checks' place in the order, so a dirty tree or a conflict still
 * answers first, and a conflicting pull request — whose checks read
 * `none` too — is still refused as a conflict, flag or no flag. What an
 * allowed unchecked merge then warns and asks is `./unchecked.ts`'s.
 *
 * Without the flag, verdict `none` is still refused, but not with the
 * triage pointer the `red` and `pending` refusals end with: triage has
 * nothing to fix where there are no check rows. That refusal names
 * `--skip-checks` and what merging with no checks means instead.
 *
 * `unknown` mergeability refuses too, rather than being treated as
 * mergeable: it is GitHub's answer while it is still computing the
 * merge commit, so acting on it sends a merge GitHub is about to refuse
 * (`./types.ts`).
 *
 * ## Which untracked paths refuse
 *
 * A tracked change always refuses: the switch and the pull after the
 * merge would carry it along or stop on it. An untracked path refuses
 * only when one of the INCOMING trees holds it — the pull request's
 * head, or the base's remote-tracking branch — since only then does the
 * clean-up write a file where it sits and stop on it (`git pull` refuses
 * to overwrite an untracked file). An untracked path neither holds, such
 * as an operator's `.claude/settings.local.json`, is left in place and
 * named in one line ({@link untrackedLeftLine}); it does not refuse
 * (`open-tomato/rafa#772`). Which paths the trees hold is the caller's
 * reading, {@link MergeRefusalReading.incoming}, handed in as data like
 * every other input here; `src/commands/pr/merge-refuse.ts` reads it
 * with `git ls-tree -r --name-only`. A folded untracked directory
 * (`?? dir/`, which `git status --porcelain` writes for a directory
 * holding no tracked file) is held when any incoming path lies under it.
 *
 * ## Which worktree is "another" one
 *
 * {@link worktreesHolding} compares paths as strings, so
 * {@link MergeRefusalReading.at} has to be the path GIT would print for
 * the current checkout, not `process.cwd()`. Measured on git 2.50.1
 * (Apple Git-155) under macOS, where `/tmp` is a symlink to
 * `/private/tmp`: `git worktree list --porcelain` printed
 * `worktree /private/tmp/mergeprobe/main` and
 * `git rev-parse --show-toplevel` printed `/private/tmp/mergeprobe/main`
 * for the same checkout. Both are git's resolved path and they agree,
 * so a caller handing `--show-toplevel` here matches; one handing
 * `process.cwd()` from a path reached through a symlink would refuse
 * its own worktree as somebody else's.
 *
 * Only the PULL REQUEST's branch is checked. The base being checked out
 * elsewhere blocks the first clean-up step, but that is `git switch`'s
 * own refusal, reported as a failed step with the rest of the list
 * printed after it — and the spec names one refusal here, for the
 * branch the clean-up DELETES.
 *
 * ## Why the local delete is `-D`, and the remote one conditional
 *
 * `git branch -d` refuses a branch git thinks unmerged, and a squash
 * merge leaves every branch unmerged in git's eyes: the squashed commit
 * is a new commit, not the branch's. So the step is `-D`, and it runs
 * after the base has been pulled, when the work is demonstrably on the
 * base. The REMOTE delete is in the list only when the caller found the
 * remote branch still there, because a repository with GitHub's
 * "automatically delete head branches" turned on has no branch left to
 * delete and the step would fail on a merge that went perfectly.
 *
 * The LOCAL delete stays in the list when the caller found no local
 * branch, but as a skipped step ({@link MergeStep.skip}): a branch
 * pushed from another clone, or from a worktree under another local
 * name, has nothing in this checkout's `refs/heads` to delete, and
 * `git branch -D` would fail with `branch '<name>' not found` and stop
 * the remote delete and the prune behind it. It is kept rather than
 * dropped so the report still names it in its place; {@link remainingFrom}
 * leaves it out of the commands to paste, since running it would fail.
 *
 * ## What is kept verbatim
 *
 * A {@link WorkingTreeStatus} entry, and a tracked one, is the porcelain
 * line as git wrote it, quoting included: `git status --porcelain` answered
 * `A  "src/a b.ts"` for a staged path with a space in the same reading
 * above. The refusal prints those lines rather than a re-rendering, so
 * what the operator sees is what `git status` would say. An untracked
 * entry is also kept as a PATH with git's quoting undone
 * ({@link unquoteGitPath}), because it is compared with the paths
 * `git ls-tree` prints, which quotes differently. A worktree's
 * path is likewise git's, and it reaches a pasteable command line
 * through {@link shellQuote} — `./preflight-items.ts` owns the one
 * shell quoter here, and a second one could disagree with it.
 */
import type { CheckRow, ChecksVerdict } from './checks.js';
import type { Mergeability } from './types.js';

import { formatRows } from './checks.js';
import { shellQuote } from './preflight-items.js';

/** How every refusal in this module opens. */
const REFUSAL_PREFIX = 'rafa pr merge refuses';

/** How many porcelain lines a dirty-tree refusal lists before eliding. */
const MAX_LISTED_CHANGES = 10;

/** The remote the clean-up pushes a branch delete to when none is named. */
const DEFAULT_REMOTE = 'origin';

/** What a worktree listing prefixes a branch with. */
const BRANCH_REF_PREFIX = 'refs/heads/';

/** The indent a refusal's listed lines carry, as `formatRows` uses. */
const INDENT = '   ';

/** The working tree of the checkout the merge would run in. */
export interface WorkingTreeStatus {
  /** True when git reported nothing at all. */
  readonly clean: boolean;
  /** Every porcelain line, as git wrote it; see the module note. */
  readonly entries: readonly string[];
  /** The porcelain lines naming a tracked path, as git wrote them. */
  readonly tracked: readonly string[];
  /**
   * The untracked paths, unquoted ({@link unquoteGitPath}). A directory
   * git folded into one line keeps its trailing `/`.
   */
  readonly untracked: readonly string[];
}

/** How `git status --porcelain` opens an untracked line. */
const UNTRACKED_PREFIX = '?? ';

/**
 * Parses `git status --porcelain` into a status.
 *
 * Every non-blank line lands in {@link WorkingTreeStatus.entries}, and
 * each one in exactly one of the two halves: a `?? ` line is untracked
 * and its path is unquoted, every other line is tracked and kept as git
 * wrote it. Which half refuses a merge is {@link readMergeRefusal}'s;
 * see the module note.
 */
export function parseWorkingTree(stdout: string): WorkingTreeStatus {
  const entries = stdout.split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
  const tracked = entries.filter((line) => !line.startsWith(UNTRACKED_PREFIX));
  const untracked = entries.filter((line) => line.startsWith(UNTRACKED_PREFIX))
    .map((line) => unquoteGitPath(line.slice(UNTRACKED_PREFIX.length)));
  return {
    clean: entries.length === 0,
    entries: Object.freeze(entries),
    tracked: Object.freeze(tracked),
    untracked: Object.freeze(untracked),
  };
}

/** The one-letter escapes git's path quoting writes, and the byte each stands for. */
const C_ESCAPES: Readonly<Record<string, number>> = {
  'a': 0x07, 'b': 0x08, 'f': 0x0c, 'n': 0x0a, 'r': 0x0d, 't': 0x09, 'v': 0x0b,
  '\\': 0x5c, '"': 0x22,
};

/** An octal escape: three digits after the backslash, one byte. */
const OCTAL_ESCAPE = /^[0-7]{3}$/;

/**
 * A path as git printed it, with git's quoting undone. git wraps a path
 * in double quotes when it holds a character it will not print bare —
 * `git status --porcelain` for a space, `git ls-tree` for a non-ASCII
 * byte, which it writes as octal escapes under `core.quotePath` — and
 * leaves every other path as it is. Measured on git 2.53.0: an
 * untracked `a b.txt` read `?? "a b.txt"` in porcelain and `a b.txt` in
 * `ls-tree -r --name-only`, and `é.txt` read `"\303\251.txt"` in both.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let at = 0; at < body.length; at += 1) {
    const char = body.charAt(at);
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const octal = body.slice(at + 1, at + 4);
    if (OCTAL_ESCAPE.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      at += 3;
      continue;
    }
    const escaped = C_ESCAPES[body.charAt(at + 1)];
    if (escaped === undefined) {
      bytes.push(...encoder.encode(char));
      continue;
    }
    bytes.push(escaped);
    at += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Parses `git ls-tree -r --name-only <tree>` into the paths the tree
 * holds, each unquoted ({@link unquoteGitPath}).
 */
export function parseTreePaths(stdout: string): readonly string[] {
  return Object.freeze(stdout.split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '')
    .map(unquoteGitPath));
}

/**
 * The untracked paths a merge would bring a file onto: those `incoming`
 * holds, and a folded directory (`dir/`) when it holds any path under
 * it. In `untracked`'s order.
 */
export function untrackedIncoming(
  untracked: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  const held = new Set(incoming);
  return Object.freeze(untracked.filter((path) => path.endsWith('/')
    ? incoming.some((file) => file.startsWith(path))
    : held.has(path)));
}

/**
 * The one line `rafa pr merge` prints for the untracked paths it leaves
 * where they are because neither incoming tree holds them, or null when
 * there are none. At most {@link MAX_LISTED_CHANGES} are named, each
 * quoted the way {@link shellQuote} quotes a word.
 */
export function untrackedLeftLine(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const named = paths.slice(0, MAX_LISTED_CHANGES).map((path) => shellQuote(path));
  const hidden = paths.length - named.length;
  const more = hidden > 0
    ? ` and ${hidden} more`
    : '';
  const which = paths.length === 1
    ? 'path'
    : 'paths';
  return `Leaving the untracked ${which} the merge does not touch in place: ${named.join(', ')}${more}.`;
}

/** One checkout in `git worktree list --porcelain`. */
export interface WorktreeEntry {
  /** Its path, as git resolved it; see the module note. */
  readonly path: string;
  /** The branch it holds, or null when it is detached or bare. */
  readonly branch: string | null;
}

/**
 * Parses `git worktree list --porcelain` into one entry per checkout.
 *
 * A block opens with `worktree <path>` and ends at the blank line; a
 * `branch refs/heads/<name>` line names the branch, and a block without
 * one is detached or bare. Any other line is ignored, which is what
 * keeps a `locked <reason>` or `prunable <reason>` line — both measured
 * in the same git reading as the module note's — from being read as a
 * new checkout.
 */
export function parseWorktrees(stdout: string): readonly WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;

  const flush = (): void => {
    if (path !== null) entries.push(Object.freeze({ path, branch }));
    path = null;
    branch = null;
  };

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      flush();
      path = line.slice('worktree '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      branch = ref.startsWith(BRANCH_REF_PREFIX)
        ? ref.slice(BRANCH_REF_PREFIX.length)
        : ref;
    }
  }
  flush();

  return Object.freeze(entries);
}

/** What GitHub said about merging the pull request. */
export interface MergeState {
  /** The narrowed answer (`./types.ts`). */
  readonly mergeable: Mergeability;
  /** GitHub's `mergeStateStatus` verbatim, which the refusal names. */
  readonly status: string;
}

/** Why a merge was refused. */
export type MergeRefusalReason =
  | 'dirty-tree'
  | 'not-mergeable'
  | 'checks-not-green'
  | 'skip-checks-refused'
  | 'branch-checked-out';

/** A refusal: the reason a caller switches on, and what it prints. */
export interface MergeRefusal {
  readonly reason: MergeRefusalReason;
  /** The whole refusal, one or more lines, ending without a newline. */
  readonly message: string;
}

/** Everything {@link readMergeRefusal} decides from. */
export interface MergeRefusalReading {
  /** The pull request's number, as the triage pointer names it. */
  readonly number: number;
  /** Its head branch: the one the clean-up deletes. */
  readonly branch: string;
  /** Its base branch, which the mergeability refusal names. */
  readonly base: string;
  /** The checkout the merge would run in. */
  readonly tree: WorkingTreeStatus;
  /**
   * Every path the incoming trees hold: the pull request's head and the
   * base's remote-tracking branch, together. An untracked path is
   * refused only when it is one of these; see the module note. Absent
   * reads as every untracked path being held, so a caller that read no
   * trees refuses as before.
   */
  readonly incoming?: readonly string[];
  /** What GitHub said about merging it. */
  readonly merge: MergeState;
  /** The verdict over its checks. */
  readonly checks: ChecksVerdict;
  /**
   * The check rows {@link checks} was read from. Only the
   * `skip-checks-refused` refusal reads them, to name each row and its
   * state; absent reads as no rows gathered, and that refusal then names
   * the verdict alone.
   */
  readonly rows?: readonly CheckRow[];
  /**
   * `--skip-checks`: allow a merge whose verdict is `none`, and refuse
   * the flag on every other verdict; see the module note. False when
   * absent.
   */
  readonly skipChecks?: boolean;
  /** Every checkout of this repository. */
  readonly worktrees: readonly WorktreeEntry[];
  /** The current checkout's path, as git prints it; see the module note. */
  readonly at: string;
}

/** `path` without a trailing separator, so two spellings compare equal. */
function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 && trimmed.endsWith('/')
    ? trimmed.slice(0, -1)
    : trimmed;
}

/**
 * The checkouts holding `branch` that are not `at` — the worktrees a
 * merge would have to delete a branch out from under. Empty when the
 * branch is checked out here, or nowhere.
 */
export function worktreesHolding(
  worktrees: readonly WorktreeEntry[],
  branch: string,
  at: string,
): readonly WorktreeEntry[] {
  const here = normalizePath(at);
  return worktrees.filter(
    (entry) => entry.branch === branch && normalizePath(entry.path) !== here,
  );
}

/** `one` or `n things`, so a count reads as English. */
function plural(count: number, singular: string, many: string): string {
  return count === 1
    ? `1 ${singular}`
    : `${count} ${many}`;
}

/** The porcelain lines a dirty-tree refusal shows, capped and indented. */
function listChanges(entries: readonly string[]): string[] {
  const shown = entries.slice(0, MAX_LISTED_CHANGES)
    .map((entry) => `${INDENT}${entry}`);
  const hidden = entries.length - shown.length;
  return hidden > 0
    ? [...shown, `${INDENT}... and ${hidden} more`]
    : shown;
}

/** The line every remote-side refusal ends with. */
function triagePointer(number: number): string {
  return `Run rafa pr triage ${number} to see why.`;
}

/** How the checks refusal names a verdict that is not green. */
function checksClause(verdict: ChecksVerdict): string {
  if (verdict === 'red') return 'its checks failed (red)';
  return 'its checks are still running (pending)';
}

/**
 * The refusal for verdict `none` without `--skip-checks`. It does not
 * point at triage, which has nothing to fix on a pull request with no
 * check rows; it names the flag instead, and what taking it means.
 */
function noChecksRefusal(number: number): MergeRefusal {
  return {
    reason: 'checks-not-green',
    message: [
      `${REFUSAL_PREFIX}: #${number} reports no checks at all (none), so nothing on GitHub has tested it.`,
      `To merge it anyway, run rafa pr merge ${number} --skip-checks.`,
      'Merging with no checks means no check has passed: you rely on the checks run locally, and rafa asks before it merges.',
    ].join('\n'),
  };
}

/**
 * The untracked paths of `reading` the merge would bring a file onto:
 * those {@link MergeRefusalReading.incoming} holds, or every one when it
 * is absent.
 */
function heldUntracked(reading: Pick<MergeRefusalReading, 'tree' | 'incoming'>): readonly string[] {
  return reading.incoming === undefined
    ? reading.tree.untracked
    : untrackedIncoming(reading.tree.untracked, reading.incoming);
}

/**
 * The refusal for tracked changes and for the untracked paths in `held`,
 * or null when there are neither. It lists the porcelain lines of both
 * as git wrote them; an untracked path neither incoming tree holds is
 * not counted and not listed.
 */
function dirtyTreeRefusal(tree: WorkingTreeStatus, held: readonly string[]): MergeRefusal | null {
  const heldSet = new Set(held);
  const listed = tree.entries.filter((line) => !line.startsWith(UNTRACKED_PREFIX)
    || heldSet.has(unquoteGitPath(line.slice(UNTRACKED_PREFIX.length))));
  if (listed.length === 0) return null;
  const count = plural(listed.length, 'change', 'changes');
  const untrackedNote = held.length === 0
    ? []
    : ['An untracked path listed here is one the merge brings a file onto.'];
  return {
    reason: 'dirty-tree',
    message: [
      `${REFUSAL_PREFIX}: the working tree has ${count}.`,
      'Commit or stash them, then run rafa pr merge again.',
      ...untrackedNote,
      ...listChanges(listed),
    ].join('\n'),
  };
}

function mergeStateRefusal(reading: MergeRefusalReading): MergeRefusal {
  const { base, merge, number } = reading;
  const said = `GitHub says ${merge.mergeable} (${merge.status})`;
  const lines = merge.mergeable === 'conflicting'
    ? [
      `${REFUSAL_PREFIX}: #${number} does not merge into ${base} — ${said}.`,
      triagePointer(number),
    ]
    : [
      `${REFUSAL_PREFIX}: #${number} is not known to merge into ${base} yet — ${said}.`,
      `${triagePointer(number)} GitHub may still be computing the merge.`,
    ];
  return { reason: 'not-mergeable', message: lines.join('\n') };
}

function checksRefusal(reading: MergeRefusalReading): MergeRefusal {
  const { checks, number } = reading;
  if (checks === 'none') return noChecksRefusal(number);
  return {
    reason: 'checks-not-green',
    message: [
      `${REFUSAL_PREFIX}: #${number} is not green — ${checksClause(checks)}.`,
      triagePointer(number),
    ].join('\n'),
  };
}

function skipChecksRefusal(reading: MergeRefusalReading): MergeRefusal {
  const { checks, number, rows = [] } = reading;
  const listed = rows.length === 0
    ? []
    : [formatRows(rows)];
  return {
    reason: 'skip-checks-refused',
    message: [
      `${REFUSAL_PREFIX}: --skip-checks is only for a PR that reports no checks at all, and #${number} reports checks (${checks}).`,
      ...listed,
      'Run rafa pr merge without --skip-checks: the flag cannot skip checks that exist.',
    ].join('\n'),
  };
}

/** The checks refusal `reading` earns, or null when its checks let the merge on. */
function checksRefusalOf(reading: MergeRefusalReading): MergeRefusal | null {
  if (reading.skipChecks === true) {
    return reading.checks === 'none'
      ? null
      : skipChecksRefusal(reading);
  }
  return reading.checks === 'green'
    ? null
    : checksRefusal(reading);
}

function worktreeRefusal(branch: string, held: readonly WorktreeEntry[]): MergeRefusal {
  const where = held.length === 1
    ? 'another worktree'
    : `${held.length} other worktrees`;
  const which = held.length === 1
    ? 'it'
    : 'them';
  return {
    reason: 'branch-checked-out',
    message: [
      `${REFUSAL_PREFIX}: branch ${branch} is checked out in ${where}.`,
      `The clean-up deletes that branch, so remove ${which} first:`,
      ...held.map((entry) => `${INDENT}git worktree remove ${shellQuote(entry.path)}`),
    ].join('\n'),
  };
}

/**
 * The first refusal `reading` earns, or null when the merge may go
 * ahead. The order, why the merge state is read before the checks
 * verdict, and what `skipChecks` allows, are in the module note.
 */
export function readMergeRefusal(reading: MergeRefusalReading): MergeRefusal | null {
  const dirty = dirtyTreeRefusal(reading.tree, heldUntracked(reading));
  if (dirty !== null) return dirty;
  if (reading.merge.mergeable !== 'mergeable') return mergeStateRefusal(reading);
  const checks = checksRefusalOf(reading);
  if (checks !== null) return checks;

  const held = worktreesHolding(reading.worktrees, reading.branch, reading.at);
  return held.length === 0
    ? null
    : worktreeRefusal(reading.branch, held);
}

/** Which clean-up step a report, a failure or a paste line names. */
export type MergeStepId =
  | 'switch-base'
  | 'pull-base'
  | 'delete-local'
  | 'delete-remote'
  | 'prune-remotes';

/** One clean-up step: what it is called, and exactly what it runs. */
export interface MergeStep {
  readonly id: MergeStepId;
  /** What is reported as the step runs, lower case, no full stop. */
  readonly label: string;
  /** The whole command, `git` included, ready to spawn or to print. */
  readonly argv: readonly string[];
  /**
   * Why the step is not run, when it is not: the runner reports this in
   * place of spawning `argv`. Absent for a step that runs.
   */
  readonly skip?: string;
}

/** What the clean-up after a merge is built from. */
export interface CleanUpPlan {
  /** The branch merged, which is deleted on both sides. */
  readonly branch: string;
  /** The branch merged INTO, which is switched to and pulled. */
  readonly base: string;
  /** The remote the branch was pushed to. `origin` when absent. */
  readonly remote?: string;
  /**
   * Whether this checkout holds the branch under `refs/heads`. False
   * keeps the local delete as a skipped step; see the module note.
   */
  readonly localBranchPresent: boolean;
  /**
   * Whether the remote branch is still there AFTER the merge. False
   * drops the remote delete from the list; see the module note.
   */
  readonly remoteBranchPresent: boolean;
}

/**
 * The clean-up after a merge, in the order it runs: switch to the base,
 * pull it fast-forward only, delete the local branch (skipped when there
 * is none), delete the remote branch when it is still there, prune. Frozen, and the same array the
 * runner walks and a failure prints the tail of.
 */
export function cleanUpSteps(plan: CleanUpPlan): readonly MergeStep[] {
  const { base, branch, remote = DEFAULT_REMOTE, localBranchPresent, remoteBranchPresent } = plan;
  const steps: MergeStep[] = [
    { id: 'switch-base', label: `switch to ${base}`, argv: ['git', 'switch', base] },
    {
      id: 'pull-base',
      label: `pull ${base}, fast-forward only`,
      argv: ['git', 'pull', '--ff-only'],
    },
    {
      id: 'delete-local',
      label: `delete the local branch ${branch}`,
      argv: ['git', 'branch', '-D', branch],
      ...(localBranchPresent
        ? {}
        : { skip: `no local branch ${branch}; nothing to delete` }),
    },
  ];
  if (remoteBranchPresent) {
    steps.push({
      id: 'delete-remote',
      label: `delete ${remote}/${branch}`,
      argv: ['git', 'push', remote, '--delete', branch],
    });
  }
  steps.push({
    id: 'prune-remotes',
    label: 'prune deleted remote branches',
    argv: ['git', 'fetch', '--prune'],
  });

  return Object.freeze(steps.map((step) => Object.freeze({
    ...step,
    argv: Object.freeze(step.argv),
  })));
}

/**
 * `step` as one line the operator can paste, each word quoted the way
 * `./preflight-items.ts` quotes a shell word.
 */
export function commandLine(step: MergeStep): string {
  return step.argv.map((word) => shellQuote(word)).join(' ');
}

/**
 * The steps still to do once `failed` has failed: that step itself,
 * because it did not finish, and every step after it that is not
 * skipped. An id that is not in `steps` answers nothing, since there is
 * no tail to name.
 */
export function remainingFrom(
  steps: readonly MergeStep[],
  failed: MergeStepId,
): readonly MergeStep[] {
  const at = steps.findIndex((step) => step.id === failed);
  return at === -1
    ? Object.freeze([])
    : Object.freeze(steps.slice(at).filter((step) => step.skip === undefined));
}
