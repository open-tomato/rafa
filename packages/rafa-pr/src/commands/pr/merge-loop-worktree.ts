/**
 * Freeing the loop worktree that holds a pull request's head branch, so
 * `rafa pr merge` can delete that branch after the merge instead of
 * refusing on it.
 *
 * A loop started with a worktree runs in `loop.worktreeDir/<stub>`
 * (`worktreePathFor`, `packages/rafa-run/src/start/worktree.ts`) on `feat/<stub>`, and it
 * leaves that worktree behind when it ends. Its pull request is then
 * merged from the main checkout, where `readMergeRefusal`
 * (`packages/rafa-pr/src/pr/merge.ts`) refuses, because the clean-up deletes a branch
 * another worktree holds. Removing the worktree by hand also deletes
 * the plan files the loop wrote inside it, since `.rafa/` is ignored
 * and `git worktree remove` takes ignored files with it. This module
 * does that removal for the one case where it is safe, and copies the
 * two plan files and the run's notes file out first.
 *
 * ## Which holder is a loop worktree
 *
 * The holder is the checkout `worktreesHolding` names for the branch,
 * other than the main checkout, the same reading `readMergeRefusal`
 * makes. It is a loop worktree only when it is ONE directory below
 * `loop.worktreeDir`, resolved from the main checkout by `worktreeDirAt`
 * (`packages/rafa/src/start/worktree-dir.ts`), and that directory's name is the
 * stub. Git prints each path resolved, so the directory is compared in
 * both spellings through {@link LoopWorktreeSeams.realPath}, as
 * `packages/rafa-pr/src/cleanup/worktrees.ts` compares its roots. A holder anywhere
 * else, more than one holder, or none answers `none`, and the existing
 * refusal stays the answer for it: somebody's own checkout is never
 * removed here.
 *
 * ## When it is freed, and when it is refused
 *
 * A loop worktree is freed only when it is clean and ended. Every rule
 * that holds is named on the refusal, not just the first:
 *
 *   - a live loop: a record of {@link LoopWorktreeReading.liveLoops}
 *     reading `running` or `paused` whose branch is the head branch, or
 *     whose recorded `worktree` is the holder. The record names the
 *     session and its pid.
 *   - a dirty tree: `git --no-optional-locks status` in the holder
 *     (`WORKTREE_STATUS`, `packages/rafa-pr/src/cleanup/worktrees.ts`) lists an
 *     uncommitted change or an untracked file. Ignored files do not
 *     count, which is also what `git worktree remove` without `--force`
 *     refuses on.
 *   - a status git would not give, since a rule that cannot be read may
 *     hold.
 *
 * `rafa pr merge` calls {@link freeLoopHolderBeforeMerge}, which reads
 * the session records through `readSessions` only once
 * {@link findLoopHolder} has named a loop worktree, so a record that
 * cannot be read refuses that merge alone and leaves every other one
 * to `readMergeRefusal`.
 *
 * ## Copy, then remove
 *
 * {@link freeLoopWorktree} copies `CLOSEOUT-<stub>.md` and
 * `PLAN_TRACKER-<stub>.md` from the holder's `plan.dir` into the main
 * checkout's, both read from {@link LoopWorktreeReading.planDir} as
 * configured, then the run's notes file, `.rafa/notes/<stub>.md` (see
 * {@link NOTES_DIR}), from the holder into the main checkout's
 * `.rafa/notes/`, and only then runs `git worktree remove <path>` in the
 * main checkout. The notes file holds the task captures, local-only
 * readings among them that CI does not repeat, and `.rafa/` being
 * ignored, the remove would delete it with the worktree. Each file has
 * one outcome, the notes file by the same rule as the plan files:
 *
 *   - `copied`, the main checkout's file replaced or made;
 *   - `kept`, when the main checkout's file has a LATER modification
 *     time than the holder's: an edit made in the main checkout after
 *     the loop ended is not overwritten. An equal time copies;
 *   - `absent`, when the holder has no such file, which a loop that
 *     never reached its close-out leaves. An absent notes file is left
 *     out of {@link FreeOutcome}'s files and the status line altogether,
 *     so a worktree without one frees as it did before notes were copied;
 *   - `in-place`, when an absolute `plan.dir` makes source and
 *     destination one file.
 *
 * Measured on git 2.53.0 under Linux (2026-10-04), in a repository
 * ignoring `.rafa/` with a worktree at `.rafa/worktrees/s`: with only
 * `.rafa/plans/CLOSEOUT-s.md` written inside it, the status above
 * printed nothing and `git worktree remove` exited 0 and deleted the
 * directory, the plan file with it, which is why the copy comes first.
 * With an untracked `notes.txt` instead, the remove exited 128 with
 * `fatal: '<path>' contains modified or untracked files, use --force to
 * delete it`.
 *
 * A copy that fails refuses before the remove, leaving the worktree in
 * place, and the refusal names the copies made before it. A remove git refuses is a refusal too, quoting git and naming
 * the copies that were made, and the caller merges nothing after
 * either. Nothing here passes `--force`.
 */
import type { GitResult, GitRunner, WorktreeEntry } from '../../pr/index.js';
import type { PidProbe, SessionRecord } from '@open-tomato/rafa/core/loop';

import { copyFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { readSessions } from '@open-tomato/rafa/core/loop';
import { worktreeDirAt } from '@open-tomato/rafa/start/worktree-dir';
import { shellQuote } from '@open-tomato/rafa/utils/shell';

import { countChanges, WORKTREE_STATUS } from '../../cleanup/worktrees.js';
import { createGitRunner, gitSaid, worktreesHolding } from '../../pr/index.js';

/** How every refusal here opens, as `packages/rafa-pr/src/pr/merge.ts`'s refusals open. */
const REFUSAL_PREFIX = 'rafa pr merge refuses';

/**
 * Where a run's notes file sits, `<NOTES_DIR>/<stub>.md`, read from the
 * holder and from the main checkout alike: a fixed path under the
 * checkout, not a configured one like `plan.dir`.
 */
export const NOTES_DIR = '.rafa/notes';

/** The indent a refusal's listed lines carry. */
const INDENT = '   ';

/** The session states a live loop reads as. */
const LIVE_STATES: ReadonlySet<string> = new Set(['running', 'paused']);

/** What {@link readLoopHolder} and {@link freeLoopWorktree} read through. */
export interface LoopWorktreeSeams {
  /** Git in the main checkout, which runs the remove. */
  readonly git: GitRunner;
  /** Git in another directory: the holder, whose status is read. */
  readonly gitAt: (dir: string) => GitRunner;
  /** A file's modification time, or null when there is no file to read. */
  readonly modifiedAt: (path: string) => Date | null;
  /** Copies `from` over `to`, making `to`'s directory first. May throw. */
  readonly copyFile: (from: string, to: string) => void;
  /** A path with every link followed, or the path as given when it does not resolve. */
  readonly realPath: (path: string) => string;
}

/** What the holder is judged from. */
export interface LoopWorktreeReading {
  /** Every checkout of this repository, as `git worktree list --porcelain` lists them. */
  readonly worktrees: readonly WorktreeEntry[];
  /** The pull request's head branch. */
  readonly branch: string;
  /** The main checkout, as git prints it; the copies land under it. */
  readonly mainCheckout: string;
  /** `loop.worktreeDir` as configured, read from {@link mainCheckout}. */
  readonly worktreeDir: string;
  /** `plan.dir` as configured, read from the holder and from {@link mainCheckout}. */
  readonly planDir: string;
  /** The loop session records; those reading `running` or `paused` count. */
  readonly liveLoops: readonly SessionRecord[];
}

/** What tells whether the head branch's holder is a loop worktree at all. */
export type LoopHolderPlace = Pick<LoopWorktreeReading, 'worktrees' | 'branch' | 'mainCheckout' | 'worktreeDir'>;

/** A loop worktree that may be freed. */
export interface LoopHolder {
  readonly path: string;
  /** Its directory's name under `loop.worktreeDir`. */
  readonly stub: string;
}

/** What {@link readLoopHolder} answers. */
export type LoopHolderAnswer =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly path: string; readonly message: string }
  | ({ readonly kind: 'freeable' } & LoopHolder);

/** What became of one plan file; see the module note. */
export type PlanFileOutcome = 'copied' | 'kept' | 'absent' | 'in-place';

/** One plan file, or the notes file, and what became of it. */
export interface PlanFileCopy {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** The main checkout's directory it is copied into, `plan.dir` or {@link NOTES_DIR}. */
  readonly into: string;
  readonly outcome: PlanFileOutcome;
}

/** What {@link freeLoopWorktree} answers. */
export type FreeOutcome =
  | { readonly ok: true; readonly files: readonly PlanFileCopy[]; readonly line: string }
  | { readonly ok: false; readonly message: string };

/** What {@link freeLoopHolder} answers: nothing to do, the line saying it was freed, or the refusal. */
export type LoopHolderOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'freed'; readonly line: string }
  | { readonly kind: 'refused'; readonly message: string };

/** The seams over the real git and disk, git run in `mainCheckout`. */
export function defaultLoopWorktreeSeams(mainCheckout: string): LoopWorktreeSeams {
  return {
    git: createGitRunner(mainCheckout),
    gitAt: createGitRunner,
    modifiedAt: (path) => statSync(path, { throwIfNoEntry: false })?.mtime ?? null,
    copyFile: (from, to) => {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    realPath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
  };
}

/**
 * Whether the head branch's holder is a loop worktree, and if so
 * whether it is clean and ended; see the module note.
 */
export function readLoopHolder(seams: LoopWorktreeSeams, reading: LoopWorktreeReading): LoopHolderAnswer {
  const holder = findLoopHolder(seams, reading);
  if (holder === null) return { kind: 'none' };

  const reasons = [...liveReasons(reading, holder.path), ...dirtyReasons(seams.gitAt(holder.path))];
  if (reasons.length === 0) return { kind: 'freeable', ...holder };
  return {
    kind: 'refused',
    path: holder.path,
    message: [
      `${REFUSAL_PREFIX}: branch ${reading.branch} is checked out in the loop worktree ${holder.path}, which cannot be freed:`,
      ...reasons.map((reason) => `${INDENT}${reason}`),
      'Once none of that holds, run rafa pr merge again.',
    ].join('\n'),
  };
}

/**
 * Copies `CLOSEOUT-<stub>.md` and `PLAN_TRACKER-<stub>.md` into the main
 * checkout's `plan.dir`, then the run's notes file `<stub>.md` into its
 * {@link NOTES_DIR} when the holder has one, each through the same
 * overwrite rule, and only then removes the worktree; see the module
 * note. The status line names every file and where it went, with no
 * notes clause when the holder has no notes file. A copy that fails
 * answers a refusal before the remove, naming the copies already made.
 */
export function freeLoopWorktree(seams: LoopWorktreeSeams, reading: LoopWorktreeReading, holder: LoopHolder): FreeOutcome {
  const into = resolve(reading.mainCheckout, reading.planDir);
  const files: PlanFileCopy[] = [];
  for (const source of copySources(reading, holder)) {
    const to = join(source.into, source.name);
    try {
      const outcome = copyPlanFile(seams, source.from, to);
      if (outcome !== 'absent' || !source.optional) files.push({ name: source.name, from: source.from, to, into: source.into, outcome });
    } catch (error) {
      return {
        ok: false,
        message: [
          `${REFUSAL_PREFIX}: ${source.name} could not be copied into ${source.into}: ${messageOf(error)}`,
          `${INDENT}${copiesClause(files) ?? 'nothing was copied'}; the worktree was left in place, and nothing was merged.`,
        ].join('\n'),
      };
    }
  }

  const removed = seams.git(['worktree', 'remove', holder.path]);
  const copies = copiesClause(files);
  if (!removed.ok) {
    return {
      ok: false,
      message: [
        `${REFUSAL_PREFIX}: the loop worktree ${holder.path} holding ${reading.branch} could not be removed, so nothing was merged.`,
        ...quotedLines(gitSaid(removed)),
        `${INDENT}${copies ?? `no plan file was there to copy into ${into}`}.`,
        `Run git worktree remove ${shellQuote(holder.path)} yourself, then rafa pr merge again.`,
      ].join('\n'),
    };
  }
  return {
    ok: true,
    files,
    line: `Freed the ended loop worktree ${holder.path} holding ${reading.branch}: `
      + `${copies ?? `no plan file to copy into ${into}`}, then the worktree removed.`,
  };
}

/**
 * The whole step `rafa pr merge` runs before `readMergeRefusal`: frees
 * the head branch's holder when it is a clean, ended loop worktree,
 * refuses when it is a loop worktree that is not, and answers `none`
 * for every other holder, which the existing refusal then reads.
 */
export function freeLoopHolder(seams: LoopWorktreeSeams, reading: LoopWorktreeReading): LoopHolderOutcome {
  const answer = readLoopHolder(seams, reading);
  if (answer.kind === 'none') return answer;
  if (answer.kind === 'refused') return { kind: 'refused', message: answer.message };
  const freed = freeLoopWorktree(seams, reading, answer);
  return freed.ok
    ? { kind: 'freed', line: freed.line }
    : { kind: 'refused', message: freed.message };
}

/**
 * The head branch's holder when it is a loop worktree, clean or not,
 * else null; reads nothing but the listing and the two paths.
 */
export function findLoopHolder(seams: LoopWorktreeSeams, reading: LoopHolderPlace): LoopHolder | null {
  const holders = worktreesHolding(reading.worktrees, reading.branch, reading.mainCheckout);
  const holder = holders[0];
  if (holders.length !== 1 || holder === undefined) return null;
  const stub = loopStubOf(seams, reading, holder.path);
  return stub === null
    ? null
    : { path: holder.path, stub };
}

/**
 * {@link freeLoopHolder} as `rafa pr merge` calls it, the loop
 * sessions read only once a loop worktree holds the branch, so a
 * session record that cannot be read refuses that merge alone. Read
 * from `sessionsRoot` through `readSessions`, every record reading
 * `running` or `paused` with its pid alive counts as live.
 */
export function freeLoopHolderBeforeMerge(
  seams: LoopWorktreeSeams,
  place: Omit<LoopWorktreeReading, 'liveLoops'>,
  sessions: { readonly root: string; readonly isAlive?: PidProbe },
): LoopHolderOutcome {
  const holder = findLoopHolder(seams, place);
  if (holder === null) return { kind: 'none' };
  let liveLoops: readonly SessionRecord[];
  try {
    liveLoops = readSessions(sessions.root, { isAlive: sessions.isAlive });
  } catch (error) {
    return {
      kind: 'refused',
      message: `${REFUSAL_PREFIX}: branch ${place.branch} is checked out in the loop worktree ${holder.path}, `
        + `and whether a loop still runs in it could not be read: ${messageOf(error)}`,
    };
  }
  return freeLoopHolder(seams, { ...place, liveLoops });
}

/** `CLOSEOUT-<stub>.md` and `PLAN_TRACKER-<stub>.md`, in the order they are copied. */
export function planFileNames(stub: string): readonly string[] {
  return [`CLOSEOUT-${stub}.md`, `PLAN_TRACKER-${stub}.md`];
}

/** One file {@link freeLoopWorktree} copies; an optional one is left unnamed when the holder has none. */
interface CopySource {
  readonly name: string;
  readonly from: string;
  readonly into: string;
  readonly optional: boolean;
}

/** The two plan files into `plan.dir`, then the notes file into {@link NOTES_DIR}, in copy order. */
function copySources(reading: LoopWorktreeReading, holder: LoopHolder): readonly CopySource[] {
  const planInto = resolve(reading.mainCheckout, reading.planDir);
  const notes = `${holder.stub}.md`;
  return [
    ...planFileNames(holder.stub).map((name) => ({
      name,
      from: resolve(holder.path, reading.planDir, name),
      into: planInto,
      optional: false,
    })),
    { name: notes, from: resolve(holder.path, NOTES_DIR, notes), into: resolve(reading.mainCheckout, NOTES_DIR), optional: true },
  ];
}

/** The holder's stub when it sits one directory below `loop.worktreeDir`, else null. */
function loopStubOf(seams: LoopWorktreeSeams, reading: LoopHolderPlace, path: string): string | null {
  const dir = worktreeDirAt(reading.mainCheckout, reading.worktreeDir);
  const forms = [...new Set([dir, seams.realPath(dir)])];
  for (const form of forms) {
    const below = relative(form, path);
    if (below !== '' && !below.startsWith('..') && !isAbsolute(below) && !below.includes(sep)) return below;
  }
  return null;
}

/** One line per live loop holding the branch or recording the worktree. */
function liveReasons(reading: LoopWorktreeReading, path: string): string[] {
  return reading.liveLoops
    .filter((loop) => LIVE_STATES.has(loop.state))
    .filter((loop) => loop.branch === reading.branch || loop.worktree === path)
    .map((loop) => `loop session ${loop.sessionId} (pid ${String(loop.pid)}) is ${loop.state} in it`);
}

/** What is uncommitted in the holder, or why that could not be read. */
function dirtyReasons(git: GitRunner): string[] {
  const status = git(WORKTREE_STATUS);
  if (!status.ok) return [`its changes could not be read: ${failure('git status', status)}`];
  const { changed, untracked } = countChanges(status.stdout);
  const parts = [
    ...changed > 0
      ? [plural(changed, 'uncommitted change')]
      : [],
    ...untracked > 0
      ? [plural(untracked, 'untracked file')]
      : [],
  ];
  return parts.length === 0
    ? []
    : [parts.join(', ')];
}

/** Copies one plan file, or the notes file, unless the rule in the module note keeps it. May throw. */
function copyPlanFile(seams: LoopWorktreeSeams, from: string, to: string): PlanFileOutcome {
  if (from === to) return 'in-place';
  const source = seams.modifiedAt(from);
  if (source === null) return 'absent';
  const destination = seams.modifiedAt(to);
  if (destination !== null && destination.getTime() > source.getTime()) return 'kept';
  seams.copyFile(from, to);
  return 'copied';
}

/**
 * `CLOSEOUT-x.md copied and PLAN_TRACKER-x.md kept (...) into <plan.dir>`,
 * then `, and x.md copied into <notes dir>` for the notes file, one
 * clause per destination directory in copy order; null when there are
 * no files yet.
 */
function copiesClause(files: readonly PlanFileCopy[]): string | null {
  const groups: { readonly into: string; readonly names: string[] }[] = [];
  for (const file of files) {
    const words = `${file.name} ${outcomeWords(file.outcome)}`;
    const last = groups.at(-1);
    if (last?.into === file.into) last.names.push(words);
    else groups.push({ into: file.into, names: [words] });
  }
  if (groups.length === 0) return null;
  return groups.map((group) => `${group.names.join(' and ')} into ${group.into}`).join(', and ');
}

function outcomeWords(outcome: PlanFileOutcome): string {
  if (outcome === 'kept') return 'kept (the main checkout\'s is newer)';
  if (outcome === 'in-place') return 'already in place';
  return outcome;
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/** `git <what> failed`, with the first line git said when it said anything. */
function failure(what: string, result: GitResult): string {
  const said = gitSaid(result).split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
  return said === ''
    ? `${what} failed`
    : `${what} failed: ${said}`;
}

/** `1 untracked file`, `2 untracked files`. */
function plural(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}
