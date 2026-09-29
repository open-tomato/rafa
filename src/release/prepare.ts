/**
 * Step 1 of the release, whole: the loop's own write, run before the
 * wrap-up session is spawned. It writes the plan's change fragment
 * under `release.fragments` and answers either the record of what it
 * wrote or the one sentence saying why it wrote nothing.
 *
 * A branch never owns a version number: this module does NOT read the
 * base version, bump it, or touch `release.versionFile` or
 * `release.changelog`. Versions and changelog sections are written on
 * the base branch alone, by `rafa release settle`, folding the
 * fragments this module leaves (`.rafa/specs/rafa-367-releases-settle-base-branch.md`).
 *
 * ```text
 * prepareRelease({ repoRoot, settings, git, plan, declared, notes, title })
 *   → { kind: 'prepared', plan, fragment, file, base, fetched, ... }
 *   → { kind: 'skipped', reason, sentence, ... }
 * ```
 *
 * ## What the fragment holds
 *
 * The file is `./fragment.ts`'s format, written by
 * {@link serializeFragment}, so nothing written here is a file that
 * module would refuse to read:
 *
 *   - `plan` is the plan id the caller passes, which is the plan stub.
 *   - `title` is the plan's title, its whitespace collapsed to one line;
 *     the plan id stands in when the title is empty.
 *   - `level` is `./level.ts`'s reading: the plan's declaration, else
 *     the highest stored note, else `none`. A `none` level is WRITTEN,
 *     not skipped, so a missing fragment and "no release" stay two
 *     different readings downstream.
 *   - the notes are the plan's raw change notes as `- <area>: <summary>`
 *     lines, grouped by area through `groupChangeNotes` and
 *     `renderNoteLines` (`./changelog.ts`) — the grouping the fold
 *     renders a section with — for the wrap-up session to rewrite into
 *     one line per area in step 2.
 *
 * A level other than `none` whose notes all came out empty (no note
 * stored, or every one skipped) cannot be written bare: the format
 * refuses a `patch`, `minor` or `major` with no body. The plan's title
 * then becomes the one note, and {@link ReleasePrepared.problems} says
 * so, rather than the plan's declared release being dropped.
 *
 * ## The name, and why the base branch is read for it
 *
 * The file is named by `allocateFragmentName`: `<plan id>.md`, or
 * `-2`, `-3` and on when that name is taken by a fragment still
 * waiting unsettled. "Waiting" is read off the BASE branch's tree
 * (`./fragment-tree.ts`), after a `git fetch` of it, and not off the
 * working tree, for two reasons:
 *
 *   - The wrap-up merges the base only after this step, so a fragment
 *     an earlier run of the same plan left waiting on the base is not
 *     in the working tree yet. Allocating off the working tree would
 *     pick the same name and turn that merge into an add/add conflict.
 *   - A fragment THIS branch wrote on an earlier wrap-up is in the
 *     working tree and not on the base. Allocating off the base names
 *     that same file again, so a second wrap-up rewrites it rather than
 *     adding a second fragment of one plan to one branch.
 *
 * A FAILED FETCH does not stop the step: the tree read is then the ref
 * this clone already holds, {@link ReleasePrepared.fetched} is false,
 * and the sentence lands in {@link ReleasePrepared.problems}. A base
 * tree that cannot be READ at all does stop it, since no free name can
 * be chosen without it.
 *
 * ## The record is what step 3 works from
 *
 * {@link ReleasePrepared.file} carries the fragment file's text BEFORE
 * this step (null when the file was not there) and AFTER it, so step 3
 * can restore the loop's text without re-reading the file. The base
 * reading the name was allocated against rides along in
 * {@link ReleasePrepared.base}, so the forecast need not read it twice.
 *
 * ## The skip carries a sentence, not a code to translate
 *
 * A skipped preparation answers {@link ReleaseSkipped.sentence}: one
 * line, worded for the pull request body. {@link ReleaseSkipped.reason}
 * is beside it for a caller that wants to branch rather than print.
 * Every reading that can refuse is taken before the one write, so a
 * skip leaves the working tree as it found it. The level reading is on
 * both records, so a skip can still say what the plan declared and what
 * its notes claimed.
 */
import type { ChangelogNote } from './changelog.js';
import type { ReleaseEnabledSource, ReleaseFileReading, ReleaseFileSettings } from './enabled.js';
import type { TreeFragment } from './fragment-tree.js';
import type { Fragment } from './fragment.js';
import type { ReleaseLevelReading, ReleaseLevelSource } from './level.js';
import type { BaseVersionOptions } from './version.js';
import type { PlanReleaseLevel } from '../plan/parse.js';
import type { GitRunner } from '../pr/git.js';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

import { groupChangeNotes, renderNoteLines } from './changelog.js';
import { resolveReleaseEnabled } from './enabled.js';
import { readFragmentTree } from './fragment-tree.js';
import { allocateFragmentName, FRAGMENT_PLAN_ID_PATTERN, serializeFragment } from './fragment.js';
import { resolveReleaseLevel } from './level.js';
import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from './version.js';

/**
 * The `release` settings a preparation reads, named as `ResolvedConfig`
 * names them, so a resolved config is one and no caller has to take the
 * fields apart first.
 */
export interface ReleaseSettings extends ReleaseFileSettings {
  /** The directory fragments are written into. `release.fragments`. */
  readonly releaseFragments: string;
}

/** What one preparation is made from. */
export interface ReleasePreparationInput {
  /** The repository the configured paths are relative to. */
  readonly repoRoot: string;
  /** The `release` settings, as the config resolved them. */
  readonly settings: ReleaseSettings;
  /** The git the base branch's fragments are read through. */
  readonly git: GitRunner;
  /** The plan id the fragment is named and marked by: the plan stub. */
  readonly plan: string;
  /** The plan's own `release` field, null when it declares none. */
  readonly declared: PlanReleaseLevel | null;
  /** The plan's stored change notes, in append order. */
  readonly notes: readonly ChangelogNote[];
  /** The plan's title, as the fragment's `title` names it. */
  readonly title: string;
  /** Which remote branch the waiting fragments are read from. */
  readonly base?: BaseVersionOptions;
}

/** The one file step 1 wrote, in both its states. */
export interface ReleaseFileEdit {
  /** The path relative to the repository root, `/`-separated. */
  readonly path: string;
  /** The same path resolved against the repository root. */
  readonly resolved: string;
  /** Its text before step 1 wrote, or null when it was not there. */
  readonly before: string | null;
  /** Its text after step 1 wrote; what step 3 restores. */
  readonly after: string;
}

/** The base branch's fragments the name was allocated against. */
export interface ReleaseBaseReading {
  /** The ref read, e.g. `origin/main`. */
  readonly ref: string;
  /** The full hash of the commit that ref named when it was read. */
  readonly commit: string;
  /** The fragments waiting on it, in add order. */
  readonly waiting: readonly TreeFragment[];
}

/** Why a preparation wrote nothing. */
export type ReleaseSkipReason =
  /** `release.enabled` is off, or `auto` found a file missing. */
  | 'disabled'
  /** The plan id cannot name a fragment file. */
  | 'plan-unusable'
  /** The base branch's fragments could not be read to choose a name. */
  | 'base-unreadable'
  /** The fragment file, or its directory, could not be written. */
  | 'fragment-unwritable';

/** What every preparation carries, whether it wrote or skipped. */
interface ReleaseLevelFields {
  /** The level the release is worth; see {@link ReleaseLevelReading}. */
  readonly level: PlanReleaseLevel;
  /** Whether the plan, its notes, or the fallback decided it. */
  readonly levelSource: ReleaseLevelSource;
  /** The highest level among the notes, or null when there were none. */
  readonly notesLevel: PlanReleaseLevel | null;
}

/** A preparation that wrote the plan's fragment. */
export interface ReleasePrepared extends ReleaseLevelFields {
  /** Tells this apart from {@link ReleaseSkipped}. */
  readonly kind: 'prepared';
  /** The plan id the fragment carries. */
  readonly plan: string;
  /** The fragment as written, `none` level included. */
  readonly fragment: Fragment;
  /** The fragment file, before and after. */
  readonly file: ReleaseFileEdit;
  /** The base branch's waiting fragments the name was chosen against. */
  readonly base: ReleaseBaseReading;
  /** False when the fetch failed and the base may be stale. */
  readonly fetched: boolean;
  /** A sentence per reading that did not come out as asked. */
  readonly problems: readonly string[];
}

/** A preparation that wrote nothing, and why. */
export interface ReleaseSkipped extends ReleaseLevelFields {
  /** Tells this apart from {@link ReleasePrepared}. */
  readonly kind: 'skipped';
  /** Which reading refused; see {@link ReleaseSkipReason}. */
  readonly reason: ReleaseSkipReason;
  /** One line for the pull request body, saying what did not happen. */
  readonly sentence: string;
  /** Anything else read along the way that is worth reporting. */
  readonly problems: readonly string[];
}

/** What one call to {@link prepareRelease} answered. */
export type ReleasePreparation = ReleasePrepared | ReleaseSkipped;

/** The head every skip sentence opens with. */
const NO_FRAGMENT = 'no release fragment';

/** Any whitespace run, collapsed to one space in a title. */
const WHITESPACE = /\s+/g;

/** The level fields both records share, off one reading. */
function levelFields(reading: ReleaseLevelReading): ReleaseLevelFields {
  return { level: reading.level, levelSource: reading.source, notesLevel: reading.notesLevel };
}

/** A skipped preparation, worded by its caller. */
function skip(
  reason: ReleaseSkipReason,
  sentence: string,
  reading: ReleaseLevelReading,
  problems: readonly string[] = [],
): ReleaseSkipped {
  return { kind: 'skipped', reason, sentence, problems, ...levelFields(reading) };
}

/** Why `release.enabled` came out off, as a sentence. */
function disabledSentence(
  versionFile: ReleaseFileReading,
  changelog: ReleaseFileReading,
  source: ReleaseEnabledSource,
): string {
  const head = `${NO_FRAGMENT}: release.enabled is`;
  if (source === 'config') return `${head} false in this project`;
  const missing = [versionFile, changelog].filter((file) => !file.present).map((file) => file.path);
  const verb = missing.length === 1
    ? 'is'
    : 'are';
  return `${head} auto and ${missing.join(' and ')} ${verb} not there`;
}

/** The plan's title as one trimmed line, the plan id when it is empty. */
function fragmentTitle(title: string, plan: string): string {
  const line = title.replace(WHITESPACE, ' ').trim();
  return line === ''
    ? plan
    : line;
}

/** Why the notes rendered no line, for the problem the title note answers. */
function emptyNotesProblem(level: PlanReleaseLevel, notes: number, title: string): string {
  const why = notes === 0
    ? 'the plan stored no change note'
    : `all ${notes} of the plan's change notes were skipped`;
  return `the fragment's one note is the plan title, ${JSON.stringify(title)}: ${why}, and a ${level} fragment cannot be written with none`;
}

/**
 * The fragment's note lines: the raw notes grouped by area, or the
 * title as the one note when a shipping level would otherwise carry
 * none. See the module note.
 */
function fragmentNotes(
  input: ReleasePreparationInput,
  level: PlanReleaseLevel,
  title: string,
): { readonly notes: readonly string[]; readonly problem: string | null } {
  const notes = renderNoteLines(groupChangeNotes(input.notes));
  if (notes.length > 0 || level === 'none') return { notes, problem: null };
  const fallback = renderNoteLines(groupChangeNotes([{ level, area: null, summary: title }]));
  return { notes: fallback, problem: emptyNotesProblem(level, input.notes.length, title) };
}

/** What reading the base branch answered, or the refusal it produced. */
type BaseOutcome =
  | {
    readonly ok: true;
    readonly base: ReleaseBaseReading;
    readonly fetched: boolean;
    readonly problems: readonly string[];
  }
  | { readonly ok: false; readonly sentence: string; readonly problems: readonly string[] };

/**
 * The fragments waiting on the base branch, after fetching it. The
 * module note holds why a failed fetch is carried and a failed read is
 * not.
 */
function readBase(input: ReleasePreparationInput): BaseOutcome {
  const remote = input.base?.remote ?? RELEASE_REMOTE;
  const branch = input.base?.branch ?? RELEASE_BASE_BRANCH;
  const ref = `${remote}/${branch}`;
  const problems: string[] = [];

  const fetched = input.git(['fetch', remote, branch]);
  if (!fetched.ok) {
    problems.push(`${branch} could not be fetched from ${remote}, so the fragments waiting on it are whatever this clone already holds for ${ref}: ${gitSaid(fetched)}`);
  }

  const tree = readFragmentTree(input.git, ref, input.settings.releaseFragments);
  if (!tree.ok) {
    return {
      ok: false,
      sentence: `${NO_FRAGMENT}: ${tree.problem}, so no free fragment name for ${input.plan} could be chosen`,
      problems,
    };
  }
  return {
    ok: true,
    base: { ref, commit: tree.commit, waiting: tree.fragments },
    fetched: fetched.ok,
    problems,
  };
}

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The file name of a repository path, `/`-separated. */
function nameOf(path: string): string {
  return posix.basename(path);
}

/**
 * Writes `text` to the fragment file, its directory made first when it
 * is not there, answering the problem or null.
 */
function writeFragment(path: string, resolved: string, text: string): string | null {
  try {
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, text);
    return null;
  } catch (error) {
    return `${path} could not be written: ${messageOf(error)}`;
  }
}

/**
 * Step 1 of the release: reads the level and the base branch's waiting
 * fragments, writes the plan's fragment, and answers what it wrote or
 * why it wrote nothing. Never touches the version file or the
 * changelog; see the module note.
 */
export function prepareRelease(input: ReleasePreparationInput): ReleasePreparation {
  const reading = resolveReleaseLevel(input.declared, input.notes);
  const files = resolveReleaseEnabled(input.settings, input.repoRoot);
  if (!files.enabled) {
    return skip('disabled', disabledSentence(files.versionFile, files.changelog, files.source), reading);
  }
  if (!FRAGMENT_PLAN_ID_PATTERN.test(input.plan)) {
    return skip(
      'plan-unusable',
      `${NO_FRAGMENT}: the plan id ${JSON.stringify(input.plan)} cannot name a fragment file`,
      reading,
    );
  }

  const read = readBase(input);
  if (!read.ok) return skip('base-unreadable', read.sentence, reading, read.problems);

  const level = reading.level;
  const title = fragmentTitle(input.title, input.plan);
  const lines = fragmentNotes(input, level, title);
  const fragment: Fragment = { plan: input.plan, title, level, notes: lines.notes };
  const name = allocateFragmentName(input.plan, read.base.waiting.map((waiting) => nameOf(waiting.path)));
  const path = posix.join(input.settings.releaseFragments.replace(/\\/g, '/'), name);
  const resolved = join(input.repoRoot, path);
  const before = textOf(resolved);
  const after = serializeFragment(fragment);
  const problems = lines.problem === null
    ? read.problems
    : [...read.problems, lines.problem];

  const failed = writeFragment(path, resolved, after);
  if (failed !== null) return skip('fragment-unwritable', `${NO_FRAGMENT}: ${failed}`, reading, problems);

  return {
    kind: 'prepared',
    ...levelFields(reading),
    plan: input.plan,
    fragment,
    file: { path, resolved, before, after },
    base: read.base,
    fetched: read.fetched,
    problems,
  };
}
