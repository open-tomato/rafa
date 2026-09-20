/**
 * Step 3 of the release, the reading half: what the wrap-up session
 * left behind is checked against the record step 1 answered, and on
 * any refusal both files go back to the bytes step 1 wrote.
 *
 * The spec's step 3 is three readings and a restore
 * (`.rafa/specs/rafa-21-changelog-and-release.md`): "verify the heading and
 * version are still there and match, that no other section changed,
 * and that the version file parses; on failure restore step 1's text
 * and say so in the PR body". This module is those three readings and
 * that restore, and nothing else: it does not commit, does not push,
 * and does not touch a pull request. `src/start/release-stage.ts` is
 * the caller that does all three with what this answers.
 *
 * ```text
 * verifyRelease(prepared)
 *   → { kind: 'verified', version, heading, section, lines, changelog }
 *   → { kind: 'refused', reason, sentence, restores }
 * ```
 *
 * ## Everything is checked against step 1's record, not against a
 * ## second reading of the files
 *
 * {@link ReleasePrepared} carries both texts of each file it wrote —
 * `before`, the bytes as it found them, and `after`, the bytes it
 * left — so this module opens each file exactly once, to read what the
 * session made of it. Nothing is re-derived: the version this release
 * ships is {@link ReleasePrepared.version}, the heading is the one
 * `./changelog.ts` rendered, and where the entry went is the insertion
 * this module recovers from the `before`/`after` pair.
 *
 * That is also what makes "the heading and version still match" a
 * comparison and not a parse. Both are compared against the same
 * record, so they match each other transitively, and no rule has to be
 * invented for extracting a version back out of a heading a consumer
 * configured. A `release.heading` template with no `{version}` field
 * at all is the one case that leaves the match vacuous — the heading
 * then names no version to disagree with — and it is still checked for
 * being present and first, which is all a heading without a version
 * can be checked for.
 *
 * ## "No other section changed" is an exact reading, not a diff
 *
 * Step 1 is a pure INSERTION: `after` is `before` with a run of lines
 * put in at one place (`insertChangelogEntry`, `./changelog.ts`). So
 * the lines before it and the lines after it are common to both texts,
 * and {@link changelogInsertionSpan} recovers their two counts by
 * walking in from each end of the pair. The file the session left has
 * to open with the same `prefix` lines and close with the same
 * `suffix` lines, byte for byte; whatever sits between them is the new
 * section, which is the session's to rewrite.
 *
 * No section parser is involved, which is the point — a heading walk
 * would have to decide what a section is in a consumer's changelog, and
 * would still have to say what happened to the blank lines around it.
 * The cost is that the reading is STRICT in both directions: a session
 * that adds a trailing newline to the file, or rewraps a line in the
 * preamble, is refused exactly as one that rewrites an old release.
 * That is the direction to be strict in — a refusal costs the pull
 * request its release commit and nothing else, while a missed edit
 * ships a rewritten history — but it is a real cost and worth knowing.
 *
 * It has one consequence worth naming. The wrap-up session merges
 * `origin/main` while it runs, and a merge that brings down a
 * changelog section another pull request added changes the file
 * outside this span. This module refuses that, and the restore then
 * writes step 1's text over the merged file. The release is what is
 * lost, not the branch: the restore only ever writes the two texts
 * step 1 itself produced, and a re-run of the wrap-up prepares the
 * release again from the merged base.
 *
 * ## The restore runs on every refusal, including an unreadable file
 *
 * "On failure restore step 1's text" is taken literally: every path
 * out of this module that is not `verified` writes
 * {@link ReleaseFileEdit.after} back over both files first. A
 * changelog that could not be READ is still restored, because
 * unreadable is not the same as unwritable and leaving a
 * half-rewritten entry behind for the next reader is worse than an
 * attempt that fails and says so.
 *
 * Each attempt answers a {@link ReleaseRestore}, and the refusal
 * sentence — one line, worded for the pull request body — says whether
 * they succeeded. A restore that fails puts its own problem in that
 * sentence rather than in a list a caller has to remember to print.
 */
import type { ReleaseFileEdit, ReleasePrepared } from './prepare.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { messageOf } from '../config-sections.js';

import { parseSemanticVersion, readManifestVersion } from './version.js';

/** Why a verification refused the session's edit. */
export type ReleaseRefusalReason =
  /** The changelog could not be read back after the session. */
  | 'changelog-unreadable'
  /** A line outside the inserted section is not the line it was. */
  | 'changelog-changed'
  /** The entry heading is gone, or no longer opens its section. */
  | 'heading-missing'
  /** The version file could not be read, or declares no version. */
  | 'version-unreadable'
  /** It declares something that is not a version at all. */
  | 'version-unparsable'
  /** It declares a version other than the one step 1 wrote. */
  | 'version-changed';

/** What one attempt to put step 1's text back did. */
export interface ReleaseRestore {
  /** The path as the config spells it, relative to the repository root. */
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
  /** The version this release ships, or null with no version file. */
  readonly version: string | null;
  /** The entry heading, still the first line of its section. */
  readonly heading: string;
  /** The section as the session left it, heading first, blank edges dropped. */
  readonly section: readonly string[];
  /** The same section without its heading: the prose for the pull request body. */
  readonly lines: readonly string[];
  /** The changelog as it now stands, whole. */
  readonly changelog: string;
}

/** A release the verification refused, and what became of the files. */
export interface ReleaseRefused {
  /** Tells this apart from {@link ReleaseVerified}. */
  readonly kind: 'refused';
  /** Which reading refused; see {@link ReleaseRefusalReason}. */
  readonly reason: ReleaseRefusalReason;
  /** One line for the pull request body, restore outcome included. */
  readonly sentence: string;
  /** One entry per file step 1 wrote, in the order they were restored. */
  readonly restores: readonly ReleaseRestore[];
}

/** What one call to {@link verifyRelease} answered. */
export type ReleaseVerification = ReleaseVerified | ReleaseRefused;

/** Where step 1's insertion sits in a changelog, as line counts. */
export interface ChangelogInsertionSpan {
  /** How many lines at the top of the file the insertion left alone. */
  readonly prefix: number;
  /** How many at the bottom it left alone. */
  readonly suffix: number;
  /** The lines it put between them, its padding blanks included. */
  readonly inserted: readonly string[];
}

/**
 * The span step 1's insertion occupies, recovered from the two texts
 * it recorded.
 *
 * `before` and `after` differ by one inserted run of lines, so the
 * walk in from each end finds the two common counts. The suffix walk
 * stops where the prefix already reached, so a file whose inserted
 * lines repeat its existing ones — a second release with the same
 * notes, say — splits at one place rather than overlapping.
 */
export function changelogInsertionSpan(before: string, after: string): ChangelogInsertionSpan {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const shortest = Math.min(beforeLines.length, afterLines.length);

  let prefix = 0;
  while (prefix < shortest && beforeLines[prefix] === afterLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < shortest - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;

  return { prefix, suffix, inserted: afterLines.slice(prefix, afterLines.length - suffix) };
}

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `lines` without the blank lines at either end of it. */
function withoutBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end);
}

/** One line that is not the line step 1 left, and where it sits. */
interface ChangedLine {
  /** Its 1-based line number in the file as it now stands. */
  readonly line: number;
  /** What step 1 left there. */
  readonly was: string;
  /** What is there now. */
  readonly now: string;
}

/**
 * The first line outside the inserted section that differs from the
 * text step 1 left, or null when every one of them matches.
 *
 * Both ends are compared against `before`, whose prefix and suffix are
 * the same lines as `after`'s by construction, so the comparison never
 * needs the inserted run itself.
 */
function changedOutside(
  current: readonly string[],
  before: readonly string[],
  span: ChangelogInsertionSpan,
): ChangedLine | null {
  for (let index = 0; index < span.prefix; index += 1) {
    const was = before[index] ?? '';
    const now = current[index] ?? '';
    if (was !== now) return { line: index + 1, was, now };
  }
  for (let back = span.suffix - 1; back >= 0; back -= 1) {
    const was = before[before.length - 1 - back] ?? '';
    const now = current[current.length - 1 - back] ?? '';
    if (was !== now) return { line: current.length - back, was, now };
  }
  return null;
}

/** Writes step 1's text back over `file`, answering what that did. */
function restoreFile(file: ReleaseFileEdit): ReleaseRestore {
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

/** `names` as English: `a`, `a and b`, `a, b and c`. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The clause naming what became of the files step 1 wrote. */
function restoreClause(restores: readonly ReleaseRestore[]): string {
  const failed = restores.filter((restore) => restore.problem !== null);
  if (failed.length > 0) return failed.map((restore) => restore.problem).join('; ');
  const names = restores.map((restore) => restore.path);
  const verb = restores.length === 1
    ? 'was'
    : 'were';
  return `${listOf(names)} ${verb} restored to the text the loop wrote`;
}

/**
 * A refusal: both files go back to step 1's text first, then the
 * sentence is worded over what that did.
 */
function refuse(
  prepared: ReleasePrepared,
  reason: ReleaseRefusalReason,
  because: string,
): ReleaseRefused {
  const files = prepared.versionFile === null
    ? [prepared.changelog]
    : [prepared.changelog, prepared.versionFile];
  const restores = files.map(restoreFile);
  return {
    kind: 'refused',
    reason,
    sentence: `no release commit: ${because}, and ${restoreClause(restores)}`,
    restores,
  };
}

/** A reading that refused, as its reason and the clause naming it. */
interface Refusal {
  /** Which reading it was. */
  readonly reason: ReleaseRefusalReason;
  /** The middle of the sentence: what was found, in one clause. */
  readonly because: string;
}

/**
 * What the version file declares now, or the refusal that reading it
 * produced. A release with no version file has nothing to read and
 * answers null, as step 1 wrote nothing there either.
 */
function checkVersion(prepared: ReleasePrepared): Refusal | null {
  const file = prepared.versionFile;
  if (file === null) return null;

  const text = textOf(file.resolved);
  if (text === null) {
    return { reason: 'version-unreadable', because: `${file.path} could not be read back after the wrap-up session` };
  }

  const declared = readManifestVersion(text);
  if (declared === null) {
    return { reason: 'version-unreadable', because: `${file.path} no longer parses as a manifest declaring a version` };
  }
  if (parseSemanticVersion(declared) === null) {
    return { reason: 'version-unparsable', because: `${file.path} declares ${declared}, which is no version` };
  }
  if (declared !== prepared.version) {
    return { reason: 'version-changed', because: `${file.path} declares ${declared}, not the ${prepared.version} this release was prepared for` };
  }
  return null;
}

/**
 * Step 3's three readings over the files the wrap-up session left, and
 * the restore of step 1's text on any refusal.
 *
 * The readings run in the order a refusal is most usefully reported
 * in: the changelog outside the new section first, since that is the
 * guard the spec names, then the heading that opens the section, then
 * the version file. See the module note for what each is compared
 * against and why the restore runs even when a file could not be read.
 */
export function verifyRelease(prepared: ReleasePrepared): ReleaseVerification {
  const changelog = prepared.changelog;
  const current = textOf(changelog.resolved);
  if (current === null) {
    return refuse(prepared, 'changelog-unreadable', `${changelog.path} could not be read back after the wrap-up session`);
  }

  const heading = prepared.entry.heading;
  const currentLines = current.split('\n');
  const beforeLines = changelog.before.split('\n');
  const span = changelogInsertionSpan(changelog.before, changelog.after);
  if (currentLines.length < span.prefix + span.suffix) {
    const lost = span.prefix + span.suffix - currentLines.length;
    const plural = lost === 1
      ? 'line'
      : 'lines';
    return refuse(prepared, 'changelog-changed', `${changelog.path} is ${lost} ${plural} shorter than the text the loop left around the ${heading} section`);
  }

  const changed = changedOutside(currentLines, beforeLines, span);
  if (changed !== null) {
    return refuse(
      prepared,
      'changelog-changed',
      `${changelog.path} line ${changed.line} reads ${JSON.stringify(changed.now)} where the loop left ${JSON.stringify(changed.was)}, outside the ${heading} section`,
    );
  }

  const section = withoutBlankEdges(currentLines.slice(span.prefix, currentLines.length - span.suffix));
  if (!section.includes(heading)) {
    return refuse(prepared, 'heading-missing', `the heading ${heading} is no longer in ${changelog.path}`);
  }
  if (section[0] !== heading) {
    return refuse(prepared, 'heading-missing', `the heading ${heading} no longer opens the section the loop inserted into ${changelog.path}`);
  }

  const version = checkVersion(prepared);
  if (version !== null) return refuse(prepared, version.reason, version.because);

  return {
    kind: 'verified',
    version: prepared.version,
    heading,
    section,
    lines: withoutBlankEdges(section.slice(1)),
    changelog: current,
  };
}
