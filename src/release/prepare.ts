/**
 * Step 1 of the release, whole: the loop's own write, run before the
 * wrap-up session is spawned, answering either the record of what it
 * wrote or the one sentence saying why it wrote nothing.
 *
 * The four modules beside this one are each one reading
 * (`.specs/rafa-21-changelog-and-release.md`, step 3's first item):
 * `./enabled.ts` says whether the release runs here, `./level.ts` what
 * bump the plan is worth, `./version.ts` what `origin/main` holds and
 * what the level makes of it, and `./changelog.ts` what the entry says
 * and where it goes. This module is the order they run in, the two
 * writes at the end of it, and the record step 3 verifies against.
 *
 * ```text
 * prepareRelease({ repoRoot, settings, git, declared, notes, title, now })
 *   → { kind: 'prepared', version, entry, changelog, versionFile, ... }
 *   → { kind: 'skipped', reason, sentence, ... }
 * ```
 *
 * ## Why the pure readings come first and the writes come last
 *
 * Every reading that can refuse the release — the config, the level,
 * both files' presence, the base version, the changelog's text — is
 * taken BEFORE either file is opened for writing. A preparation that
 * cannot finish then leaves the worktree exactly as it found it, which
 * is what lets the wrap-up carry on with a sentence instead of a
 * half-written release.
 *
 * Two writes remain, and they cannot be one: the version file's is
 * {@link writeManifestVersion}'s and the changelog's is this module's.
 * The version goes first, because a failure there has touched nothing.
 * A changelog write that fails after it RESTORES the version file's
 * previous bytes before answering, and says in its sentence whether
 * that restore succeeded — the one case in which this module can leave
 * a file changed, and it says so.
 *
 * ## What stops a release, and what only gets reported
 *
 * A FAILED FETCH does not stop it. `./version.ts` leaves that choice to
 * its caller, and this is the caller: a wrap-up that refused to prepare
 * a release because the network was down would cost the pull request
 * its entry for a reason unrelated to the diff, while a base read off
 * the ref this clone already holds is wrong only when `main` moved
 * since the last fetch — and step 3's verification and the merge the
 * wrap-up session performs both run after it. The sentence
 * `readBaseVersion` wrote lands in {@link ReleasePrepared.problems},
 * and {@link ReleasePrepared.fetched} is false, so whoever writes the
 * pull request body can say the base may be stale.
 *
 * A BASE THAT CANNOT BE READ AT ALL does stop it. There is then no
 * number to bump from, and bumping from the working tree's manifest
 * instead would ship the version of whatever branch this is — which on
 * a branch whose wrap-up already ran once is the version that wrap-up
 * wrote, bumped a second time.
 *
 * A MISSING CHANGELOG stops it too, version file or not. The entry is
 * the half of a release a person reads; a bump with no entry is the
 * shape this plan exists to retire, so the release writes both files or
 * neither.
 *
 * A MISSING VERSION FILE does not stop it, and is not a failure: the
 * spec's config section ends "a project with no version file gets the
 * changelog entry under a date heading and no bump". So the entry is
 * rendered with an empty `{version}` — `./changelog.ts` takes the
 * dangling separator with it — {@link ReleasePrepared.version} is null,
 * and no fetch runs at all, since nothing would be read from it.
 *
 * ## The record is what step 3 works from
 *
 * Each file this module wrote is a {@link ReleaseFileEdit} carrying
 * BOTH texts: `before`, the bytes as they were, and `after`, the bytes
 * step 1 wrote. Step 3 needs both and for different readings — `after`
 * is the text it restores when it refuses the session's edit, and
 * `before` is what it compares the session's file against to see that
 * no other section of the changelog changed. Keeping them here means
 * step 3 re-reads neither file from disk to know what it should hold.
 *
 * ## The skip carries a sentence, not a code to translate
 *
 * A skipped preparation answers {@link ReleaseSkipped.sentence}: one
 * line, worded for the pull request body the spec asks it to appear in
 * ("Level `none` skips all three steps and says so in the PR body").
 * {@link ReleaseSkipped.reason} is beside it for a caller that wants to
 * branch rather than print. The level reading is on both records, so a
 * skip can still say what the plan declared and what its notes claimed.
 */
import type { ChangelogEntry, ChangelogInsertPoint, ChangelogNote } from './changelog.js';
import type { ReleaseEnabledReading, ReleaseEnabledSource, ReleaseFileReading, ReleaseFileSettings } from './enabled.js';
import type { ReleaseLevelReading, ReleaseLevelSource } from './level.js';
import type { BaseVersionOptions } from './version.js';
import type { PlanReleaseLevel } from '../plan/parse.js';
import type { GitRunner } from '../pr/git.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { messageOf } from '../config-sections.js';

import { changelogDate, insertChangelogEntry, renderChangelogEntry } from './changelog.js';
import { resolveReleaseEnabled } from './enabled.js';
import { resolveReleaseLevel } from './level.js';
import { nextVersion, readBaseVersion, writeManifestVersion } from './version.js';

/** The three levels that actually move a version number. */
export type ReleaseBumpLevel = Exclude<PlanReleaseLevel, 'none'>;

/**
 * The four `release` settings a preparation reads, named as
 * `ResolvedConfig` names them, so a resolved config is one and no
 * caller has to take the fields apart first.
 */
export interface ReleaseSettings extends ReleaseFileSettings {
  /** The template one entry's heading is rendered from. `release.heading`. */
  readonly releaseHeading: string;
}

/** What one preparation is made from. */
export interface ReleasePreparationInput {
  /** The repository the two configured paths are relative to. */
  readonly repoRoot: string;
  /** The `release` settings, as the config resolved them. */
  readonly settings: ReleaseSettings;
  /** The git to read the base version through; see `./version.ts`. */
  readonly git: GitRunner;
  /** The plan's own `release` field, null when it declares none. */
  readonly declared: PlanReleaseLevel | null;
  /** The plan's stored change notes, in append order. */
  readonly notes: readonly ChangelogNote[];
  /** The plan's title, as the heading names it. */
  readonly title: string;
  /** When the release is being made; the entry's date comes from it. */
  readonly now: Date;
  /** Which remote branch the base version is read from. */
  readonly base?: BaseVersionOptions;
}

/** One file step 1 rewrote, in both its states. */
export interface ReleaseFileEdit {
  /** The path as the config spells it, relative to the repository root. */
  readonly path: string;
  /** The same path resolved against the repository root. */
  readonly resolved: string;
  /** Its bytes before step 1 wrote; what step 3 compares against. */
  readonly before: string;
  /** Its bytes after step 1 wrote; what step 3 restores. */
  readonly after: string;
}

/** Why a preparation wrote nothing. */
export type ReleaseSkipReason =
  /** `release.enabled` is off, or `auto` found a file missing. */
  | 'disabled'
  /** The level resolved to `none`; the spec skips all three steps. */
  | 'level-none'
  /** No regular file sits at `release.changelog`. */
  | 'changelog-missing'
  /** The changelog is there and could not be read. */
  | 'changelog-unreadable'
  /** No version could be read off the base branch's manifest. */
  | 'base-unreadable'
  /** The version file could not be read, or its version not replaced. */
  | 'version-unwritable'
  /** The changelog could not be written; see the module note's restore. */
  | 'changelog-unwritable';

/** What every preparation carries, whether it wrote or skipped. */
interface ReleaseLevelFields {
  /** The level the release is worth; see {@link ReleaseLevelReading}. */
  readonly level: PlanReleaseLevel;
  /** Whether the plan, its notes, or the fallback decided it. */
  readonly levelSource: ReleaseLevelSource;
  /** The highest level among the notes, or null when there were none. */
  readonly notesLevel: PlanReleaseLevel | null;
}

/** A preparation that wrote both files it was asked to write. */
export interface ReleasePrepared extends ReleaseLevelFields {
  /** Tells this apart from {@link ReleaseSkipped}. */
  readonly kind: 'prepared';
  /** The bump: never `none`, which is a skip. */
  readonly level: ReleaseBumpLevel;
  /** The version this release ships, or null with no version file. */
  readonly version: string | null;
  /** The version the base branch held, or null with no version file. */
  readonly baseVersion: string | null;
  /** False when the fetch failed and the base may be stale. */
  readonly fetched: boolean;
  /** The entry as `./changelog.ts` rendered it. */
  readonly entry: ChangelogEntry;
  /** Which of the three places in the changelog the entry went. */
  readonly insertPoint: ChangelogInsertPoint;
  /** The 1-based line the entry's heading now sits on. */
  readonly insertLine: number;
  /** The changelog, before and after. */
  readonly changelog: ReleaseFileEdit;
  /** The version file, before and after, or null when there is none. */
  readonly versionFile: ReleaseFileEdit | null;
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
  const head = 'no version bump and no changelog entry: release.enabled is';
  if (source === 'config') return `${head} false in this project`;
  const missing = [versionFile, changelog].filter((file) => !file.present).map((file) => file.path);
  const verb = missing.length === 1
    ? 'is'
    : 'are';
  return `${head} auto and ${missing.join(' and ')} ${verb} not there`;
}

/** Why a `none` level came out, as a sentence; the three sources word differently. */
function noneSentence(reading: ReleaseLevelReading): string {
  const tail = 'so this pull request ships no version bump and no changelog entry';
  if (reading.source === 'plan') return `the plan declares release: none, ${tail}`;
  if (reading.source === 'notes') {
    return `every change note this plan stored is at level none, ${tail}`;
  }
  return `this plan stored no change note and declares no release level, ${tail}`;
}

/** What the version half worked out, or the refusal that stopped it. */
type VersionOutcome =
  | {
    readonly refused: false;
    /** The version to write, or null when there is no version file. */
    readonly version: string | null;
    /** The version the base held, or null when there is no version file. */
    readonly baseVersion: string | null;
    /** False when the fetch failed; the reading went on regardless. */
    readonly fetched: boolean;
    /** Sentences worth carrying into the record. */
    readonly problems: readonly string[];
  }
  | {
    readonly refused: true;
    readonly reason: ReleaseSkipReason;
    readonly sentence: string;
    readonly problems: readonly string[];
  };

/**
 * The version this release ships: null when there is no version file,
 * else the base on `origin/main` bumped by `level`.
 *
 * The fetch and the show are `readBaseVersion`'s; the module note holds
 * why a failed fetch is carried and a failed read is not.
 */
function planVersion(
  input: ReleasePreparationInput,
  versionFile: ReleaseFileReading,
  level: ReleaseBumpLevel,
): VersionOutcome {
  if (!versionFile.present) {
    return {
      refused: false,
      version: null,
      baseVersion: null,
      fetched: false,
      problems: [`${versionFile.path} is not there, so the entry is dated and carries no version`],
    };
  }

  const base = readBaseVersion(input.git, input.settings.releaseVersionFile, input.base ?? {});
  if (base.version === null) {
    return {
      refused: true,
      reason: 'base-unreadable',
      sentence: `no version bump and no changelog entry: the base version could not be read from ${base.ref}:${base.path}`,
      problems: base.problems,
    };
  }

  const version = nextVersion(base.version, level);
  if (version === null) {
    return {
      refused: true,
      reason: 'base-unreadable',
      sentence: `no version bump and no changelog entry: ${base.ref}:${base.path} declares ${base.version}, which is no version to bump`,
      problems: base.problems,
    };
  }
  return { refused: false, version, baseVersion: base.version, fetched: base.fetched, problems: base.problems };
}

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Writes `text` to `path`, answering the problem or null. */
function writeText(path: string, text: string): string | null {
  try {
    writeFileSync(path, text);
    return null;
  } catch (error) {
    return `${path} could not be written: ${messageOf(error)}`;
  }
}

/** The version file rewritten, or the sentence that stopped the write. */
function writeVersionFile(
  file: ReleaseFileReading,
  version: string,
): { readonly edit: ReleaseFileEdit | null; readonly problem: string | null } {
  const before = textOf(file.resolved);
  if (before === null) {
    return { edit: null, problem: `${file.path} could not be read, so ${version} was not written to it` };
  }

  const written = writeManifestVersion(file.resolved, version);
  if (written.problem !== null) return { edit: null, problem: written.problem };

  const after = textOf(file.resolved);
  if (after === null) {
    return { edit: null, problem: `${file.path} could not be read back after ${version} was written to it` };
  }
  return { edit: { path: file.path, resolved: file.resolved, before, after }, problem: null };
}

/** Why an entry came out with no lines under its heading. */
function emptyEntryProblem(entry: ChangelogEntry, notes: number): string {
  const skipped = entry.noneNotes + entry.duplicateNotes + entry.blankNotes;
  return notes === 0
    ? `${entry.heading} has no lines under it: the plan stored no change note`
    : `${entry.heading} has no lines under it: all ${skipped} of the plan's change notes were skipped`;
}

/** What writing the two files did, or the refusal that came out of it. */
type WriteOutcome =
  | { readonly ok: true; readonly versionFile: ReleaseFileEdit | null }
  | { readonly ok: false; readonly reason: ReleaseSkipReason; readonly sentence: string };

/**
 * Writes both files, or leaves both as they were: the version file
 * first, and the changelog second with the version file restored when
 * that write fails. The module note holds why that order.
 */
function writeBoth(
  files: ReleaseEnabledReading,
  version: string | null,
  changelog: string,
): WriteOutcome {
  const versionEdit = version === null
    ? { edit: null, problem: null }
    : writeVersionFile(files.versionFile, version);
  if (versionEdit.problem !== null) {
    return {
      ok: false,
      reason: 'version-unwritable',
      sentence: `no version bump and no changelog entry: ${versionEdit.problem}`,
    };
  }

  const failed = writeText(files.changelog.resolved, changelog);
  if (failed === null) return { ok: true, versionFile: versionEdit.edit };

  const restored = versionEdit.edit === null
    ? null
    : writeText(versionEdit.edit.resolved, versionEdit.edit.before);
  return {
    ok: false,
    reason: 'changelog-unwritable',
    sentence: changelogFailure(failed, versionEdit.edit, restored),
  };
}

/**
 * Step 1 of the release: reads, writes the version file and the
 * changelog, and answers what it did or why it did nothing.
 *
 * Either both files are written or neither is, with the one documented
 * exception — a changelog write that fails after the version file's
 * succeeded restores it and says so. See the module note for what stops
 * a release and what is only reported.
 */
export function prepareRelease(input: ReleasePreparationInput): ReleasePreparation {
  const reading = resolveReleaseLevel(input.declared, input.notes);
  const files = resolveReleaseEnabled(input.settings, input.repoRoot);
  if (!files.enabled) {
    return skip('disabled', disabledSentence(files.versionFile, files.changelog, files.source), reading);
  }

  const level = reading.level;
  if (level === 'none') return skip('level-none', noneSentence(reading), reading);

  if (!files.changelog.present) {
    return skip('changelog-missing', `no version bump and no changelog entry: ${files.changelog.path} is not there`, reading);
  }
  const changelogBefore = textOf(files.changelog.resolved);
  if (changelogBefore === null) {
    return skip('changelog-unreadable', `no version bump and no changelog entry: ${files.changelog.path} could not be read`, reading);
  }

  const planned = planVersion(input, files.versionFile, level);
  if (planned.refused) return skip(planned.reason, planned.sentence, reading, planned.problems);

  const entry = renderChangelogEntry({
    template: input.settings.releaseHeading,
    values: {
      version: planned.version ?? '',
      date: changelogDate(input.now),
      title: input.title,
    },
    notes: input.notes,
  });
  const insertion = insertChangelogEntry(changelogBefore, entry.text);
  const problems = [...planned.problems];
  if (entry.lines.length === 0) problems.push(emptyEntryProblem(entry, input.notes.length));

  const written = writeBoth(files, planned.version, insertion.text);
  if (!written.ok) return skip(written.reason, written.sentence, reading, problems);

  return {
    kind: 'prepared',
    ...levelFields(reading),
    level,
    version: planned.version,
    baseVersion: planned.baseVersion,
    fetched: planned.fetched,
    entry,
    insertPoint: insertion.point,
    insertLine: insertion.line,
    changelog: {
      path: files.changelog.path,
      resolved: files.changelog.resolved,
      before: changelogBefore,
      after: insertion.text,
    },
    versionFile: written.versionFile,
    problems,
  };
}

/**
 * The sentence a failed changelog write answers, naming what became of
 * the version file the write before it had already changed.
 */
function changelogFailure(
  failed: string,
  versionEdit: ReleaseFileEdit | null,
  restored: string | null,
): string {
  const head = `no changelog entry: ${failed}`;
  if (versionEdit === null) return head;
  return restored === null
    ? `${head}, and ${versionEdit.path} was restored to the version it held`
    : `${head}, and ${versionEdit.path} could not be restored to the version it held: ${restored}`;
}
