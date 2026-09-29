/**
 * Step 3 of the release, the reading half: what the wrap-up session
 * left of the plan's fragment is checked against the record step 1
 * answered, and on any refusal the fragment goes back to the bytes
 * step 1 wrote.
 *
 * A branch never owns a version number (`.rafa/specs/rafa-367-releases-settle-base-branch.md`):
 * step 1 writes one fragment under `release.fragments` and nothing
 * else, and step 2's session rewrites the notes inside it. So step 3
 * is three readings and a restore — the fragment still parses, it
 * still carries the plan's level, and it is the only file the release
 * step changed — and nothing more: it does not commit, does not push,
 * and does not touch a pull request. `src/start/release-stage.ts` is
 * the caller that does all three with what this answers.
 *
 * ```text
 * verifyRelease(prepared, { git, settings })
 *   → { kind: 'verified', path, fragment, text }
 *   → { kind: 'refused', reason, sentence, restore }
 * ```
 *
 * ## The fragment is checked against step 1's record
 *
 * {@link ReleasePrepared} carries the fragment step 1 wrote and the
 * file's text before and after, so this module opens the file once, to
 * read what the session made of it, and parses it with `./fragment.ts`,
 * the reader settle folds with — a fragment this module passes is one
 * settle can read. The session may rewrite the notes and nothing is
 * asked of them beyond parsing (a shipping level with no note left is
 * the parser's own `empty-body` refusal). The `plan` field must still
 * be the plan id step 1 wrote, since the receipt comment names
 * fragments by it, and the `level` must still be step 1's level: the
 * session rewrites prose, it does not decide what a release is worth.
 * The title is the session's to reword.
 *
 * ## "The only file the release step changed" is git's reading
 *
 * The release step may change one file, the fragment. The files it
 * must leave alone are the rest of what the release concerns: the
 * version file, the changelog, and every other file under the fragments
 * directory — another plan's fragment, or a second one of this plan.
 * The session's other work (the code it commits, the leftovers
 * `release-stage.ts` never stages) is not the release step's, so it is
 * not read here.
 *
 * What changed is asked of `git status` over exactly those paths, the
 * working tree and the index against `HEAD`, untracked files listed
 * one by one: a fragments directory step 1 just made is untracked
 * whole, and without `--untracked-files=all` git names the directory
 * rather than the files in it, which is neither the fragment's path
 * nor a stray file's, so every such wrap-up would refuse and a stray
 * could not be told from the plan's own. `--no-renames` keeps each
 * entry one path, and `--literal-pathspecs` keeps a configured path
 * from being read as a glob. Any path other than the fragment's own
 * refuses, and a `git status` that fails refuses too, since the
 * reading it would have given cannot be assumed.
 *
 * A changelog section the session merged in from the base branch is a
 * commit, not a working-tree change, so this reading does not refuse
 * it; a merge the session left unfinished over one of those files
 * does refuse, which is the direction to be wrong in.
 *
 * ## The restore puts back step 1's text, and only that
 *
 * "On failure restore step 1's text" is taken literally: every path
 * out of this module that is not `verified` writes
 * {@link ReleaseFileEdit.after} back over the fragment first, a
 * fragment that could not be READ included, since unreadable is not
 * unwritable. The files the session changed outside the fragment are
 * NOT touched: step 1 never wrote them, so it has no text of theirs to
 * put back, and discarding a session's edit is not a reader's call.
 * They are named in the sentence instead, and stay out of the release
 * commit, which is made over the fragment path alone.
 *
 * The attempt answers a {@link ReleaseRestore}, and the refusal
 * sentence — one line, worded for the pull request body — says whether
 * it succeeded.
 */
import type { Fragment } from './fragment.js';
import type { ReleaseFileEdit, ReleasePrepared, ReleaseSettings } from './prepare.js';
import type { GitRunner } from '../pr/git.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

import { parseFragment } from './fragment.js';

/** Why a verification refused the session's edit. */
export type ReleaseRefusalReason =
  /** Git could not say which release files changed. */
  | 'status-unreadable'
  /** A release file other than the fragment changed. */
  | 'other-file-changed'
  /** The fragment could not be read back after the session. */
  | 'fragment-unreadable'
  /** It no longer parses as a fragment. */
  | 'fragment-unparsable'
  /** It names another plan id than the one step 1 wrote. */
  | 'plan-changed'
  /** It carries another level than the plan's. */
  | 'level-changed';

/** What the attempt to put step 1's text back did. */
export interface ReleaseRestore {
  /** The path relative to the repository root. */
  readonly path: string;
  /** True when step 1's bytes are back on disk. */
  readonly restored: boolean;
  /** One sentence saying why they are not, or null when they are. */
  readonly problem: string | null;
}

/** A release whose three readings all came out as step 1 left them. */
export interface ReleaseVerified {
  /** Tells this apart from {@link ReleaseRefused}. */
  readonly kind: 'verified';
  /** The fragment's path relative to the repository root. */
  readonly path: string;
  /** The fragment as the session left it, parsed. */
  readonly fragment: Fragment;
  /** The fragment file's text as it now stands, whole. */
  readonly text: string;
}

/** A release the verification refused, and what became of the fragment. */
export interface ReleaseRefused {
  /** Tells this apart from {@link ReleaseVerified}. */
  readonly kind: 'refused';
  /** Which reading refused; see {@link ReleaseRefusalReason}. */
  readonly reason: ReleaseRefusalReason;
  /** One line for the pull request body, restore outcome included. */
  readonly sentence: string;
  /** What putting step 1's fragment text back did. */
  readonly restore: ReleaseRestore;
}

/** What one call to {@link verifyRelease} answered. */
export type ReleaseVerification = ReleaseVerified | ReleaseRefused;

/** What a verification reads besides step 1's record. */
export interface ReleaseVerificationContext {
  /** Git, run in the repository root the configured paths are relative to. */
  readonly git: GitRunner;
  /** The `release` settings naming the files the release step must leave alone. */
  readonly settings: ReleaseSettings;
}

/** The status entry's two state letters and the space after them. */
const STATUS_PREFIX_LENGTH = 3;

/** A reading that refused, as its reason and the clause naming it. */
interface Refusal {
  /** Which reading it was. */
  readonly reason: ReleaseRefusalReason;
  /** The middle of the sentence: what was found, in one clause. */
  readonly because: string;
}

/** The release files `git status` named beside the fragment, or why it could not. */
type StatusReading =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly refusal: Refusal };

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** A configured path as git names it: `/`-separated, no `./`, no trailing `/`. */
function repoPath(path: string): string {
  const normal = posix.normalize(path.replace(/\\/g, '/'));
  return normal.endsWith('/') && normal.length > 1
    ? normal.slice(0, -1)
    : normal;
}

/** `names` as English: `a`, `a and b`, `a, b and c`. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** Writes step 1's text back over the fragment, answering what that did. */
function restoreFragment(file: ReleaseFileEdit): ReleaseRestore {
  try {
    writeFileSync(file.resolved, file.after);
    return { path: file.path, restored: true, problem: null };
  } catch (error) {
    return {
      path: file.path,
      restored: false,
      problem: `${file.path} could not be restored to the text the loop wrote: ${messageOf(error)}`,
    };
  }
}

/** A refusal: the fragment goes back to step 1's text first, then the sentence is worded over what that did. */
function refuse(prepared: ReleasePrepared, refusal: Refusal): ReleaseRefused {
  const restore = restoreFragment(prepared.file);
  const clause = restore.problem ?? `${restore.path} was restored to the text the loop wrote`;
  return {
    kind: 'refused',
    reason: refusal.reason,
    sentence: `no release commit: ${refusal.because}, and ${clause}`,
    restore,
  };
}

/**
 * The release files other than the fragment that `git status` reports
 * changed against `HEAD`, or the refusal a failed status produced. See
 * the module note for the flags.
 */
function changedBesideFragment(
  prepared: ReleasePrepared,
  context: ReleaseVerificationContext,
): StatusReading {
  const settings = context.settings;
  const watched = [settings.releaseVersionFile, settings.releaseChangelog, settings.releaseFragments].map(repoPath);
  const status = context.git([
    '--literal-pathspecs',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--',
    ...watched,
  ]);
  if (!status.ok) {
    return {
      ok: false,
      refusal: {
        reason: 'status-unreadable',
        because: `git status could not say which of ${listOf(watched)} changed: ${gitSaid(status)}`,
      },
    };
  }
  const fragment = repoPath(prepared.file.path);
  const paths = status.stdout
    .split('\0')
    .filter((entry) => entry.length > STATUS_PREFIX_LENGTH)
    .map((entry) => entry.slice(STATUS_PREFIX_LENGTH));
  return { ok: true, paths: [...new Set(paths)].filter((path) => path !== fragment).sort() };
}

/** The clause refusing `paths`, the files the release step should have left alone. */
function otherFilesRefusal(prepared: ReleasePrepared, paths: readonly string[]): Refusal {
  const verb = paths.length === 1
    ? 'was'
    : 'were';
  const them = paths.length === 1
    ? 'it'
    : 'them';
  return {
    reason: 'other-file-changed',
    because: `the release step may change ${prepared.file.path} alone, yet ${listOf(paths)} ${verb} changed too and ${verb} left as the wrap-up session left ${them}, out of any release commit`,
  };
}

/** The fragment's own readings: it reads, parses, and names the plan and level step 1 wrote. */
function checkFragment(prepared: ReleasePrepared, text: string): Fragment | Refusal {
  const path = prepared.file.path;
  const reading = parseFragment(text);
  if (!reading.ok) {
    return { reason: 'fragment-unparsable', because: `${path} no longer parses as a fragment: ${reading.sentence}` };
  }
  const expected = prepared.fragment;
  if (reading.fragment.plan !== expected.plan) {
    return {
      reason: 'plan-changed',
      because: `${path} names the plan ${reading.fragment.plan}, not the ${expected.plan} the loop wrote`,
    };
  }
  if (reading.fragment.level !== expected.level) {
    return {
      reason: 'level-changed',
      because: `${path} carries the level ${reading.fragment.level}, not the plan's ${expected.level}`,
    };
  }
  return reading.fragment;
}

/**
 * Step 3's three readings over what the wrap-up session left, and the
 * restore of step 1's fragment text on any refusal.
 *
 * The readings run in the order a refusal is most usefully reported
 * in: the files outside the fragment first, since that is the guard
 * that keeps a branch from owning a version, then the fragment's own
 * parse, plan and level. See the module note for what each is compared
 * against and why only the fragment is restored.
 */
export function verifyRelease(
  prepared: ReleasePrepared,
  context: ReleaseVerificationContext,
): ReleaseVerification {
  const changed = changedBesideFragment(prepared, context);
  if (!changed.ok) return refuse(prepared, changed.refusal);
  if (changed.paths.length > 0) return refuse(prepared, otherFilesRefusal(prepared, changed.paths));

  const path = prepared.file.path;
  const text = textOf(prepared.file.resolved);
  if (text === null) {
    return refuse(prepared, {
      reason: 'fragment-unreadable',
      because: `${path} could not be read back after the wrap-up session`,
    });
  }
  const fragment = checkFragment(prepared, text);
  if ('reason' in fragment) return refuse(prepared, fragment);

  return { kind: 'verified', path, fragment, text };
}
