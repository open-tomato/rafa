/**
 * The release readings any folder may take: how two versions order,
 * the versions a changelog's headings name, the release tags of a
 * repository, and the released versions no tag names. This is the
 * library half of `rafa release status`; its command half,
 * `src/commands/release/status.ts`, holds the command, its flags, the
 * version file and pending notes readings and the block they render
 * to, and imports these readers from here. Nothing here imports a
 * file under `src/commands/`, and nothing here imports `./audit.ts`,
 * which reads {@link changelogVersions} from this file: the command
 * half is the one that imports both.
 *
 * Every reader here READS: the one git command sent is `git tag
 * --list`, no file is opened for writing, and no network is reached.
 *
 * ## Why a released version is one the changelog names
 *
 * "Released" here is what the CHANGELOG says, not what the version
 * file says. The version file carries one number, the one the next
 * release will ship from; the changelog carries one section per
 * release that has already been made. So the untagged list is the
 * changelog's versions minus the versions the tags name, in the order
 * the changelog lists them, which is newest first because that is
 * where `./changelog.ts` inserts.
 *
 * The heading is a TEMPLATE (`release.heading`), so a version cannot
 * be read back by matching the rendered shape: a consumer's heading
 * may put the date first, or drop the title. {@link changelogVersions}
 * therefore takes every ATX heading outside a fenced code block and
 * keeps the first token in it that parses as a semantic version, a
 * `v` prefix allowed. A heading naming no version — `# Changelog`
 * itself, or an `## Unreleased` section — contributes none, which is
 * what a reader would expect of both.
 *
 * ## The tags read, and the order they are put in
 *
 * `git tag --list` answers every tag, and only the ones that parse as
 * `[v]<semver>` are release tags here. The latest is the highest by
 * SEMVER PRECEDENCE and not the newest by date: a tag pushed today on
 * an old maintenance branch is not the latest release, and git's own
 * `--sort=v:refname` is a version-sort of its own that would make the
 * answer depend on which git is installed. {@link compareVersions}
 * implements semver's precedence rule, prerelease identifiers
 * included, and {@link compareReleaseTags} reverses it so the highest
 * comes first, so the order is this module's own and is measured
 * against the sequence the specification prints.
 *
 * A bare `1.2.3` tag is accepted beside `v1.2.3` on purpose. `release
 * tag` writes the `v` form, but a repository that tagged its earlier
 * releases without one would otherwise have every one of them
 * reported as released and untagged, which is the opposite of what an
 * operator wants told.
 *
 * ## A reading that failed is kept, not thrown
 *
 * {@link readTags} and {@link readUntagged} answer a `problem`
 * sentence beside an empty reading when git or the file could not be
 * read. What a caller does with it is the caller's: `release status`
 * renders a `?` cell, and `rafa next`'s epic end leaves its release
 * line out rather than read a failed tag listing as no tags.
 */
import type { SemanticVersion } from './version.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitSaid } from '../pr/git.js';

import { parseSemanticVersion } from './version.js';

/** A semantic version in a heading, its optional `v` prefix left out of the capture. */
const HEADING_VERSION = /(?<![0-9A-Za-z.+-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g;

/** The marker of an ATX heading: up to three spaces, one to six hashes, then a space or the end. */
const ATX_HEADING = /^ {0,3}#{1,6}(?: |$)/;

/** The open or close of a fenced code block. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/** A tag naming a release: an optional `v`, then a version. */
const RELEASE_TAG = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** A prerelease identifier made only of digits, which compares numerically. */
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/;

/** One tag of the repository that names a release. */
export interface ReleaseTag {
  /** The tag as git spells it: `v0.5.0`, or `0.5.0` without the prefix. */
  readonly tag: string;
  /** The version it names, its `v` off. */
  readonly version: string;
  /** That version parsed, which is what the order is taken from. */
  readonly parsed: SemanticVersion;
}

/** What the repository's tags answered. */
export interface TagReading {
  /** Every tag of the repository that names a release, highest first. */
  readonly tags: readonly ReleaseTag[];
  /** The highest of them by semver precedence, or null when there is none. */
  readonly latest: ReleaseTag | null;
  /** What git said when the list could not be read, or null when it was. */
  readonly problem: string | null;
}

/** The released versions no tag names. */
export interface UntaggedReading {
  /** The path as `release.changelog` spells it. */
  readonly path: string;
  /** Every version the changelog names, in its own order, newest first. */
  readonly released: readonly string[];
  /** Those of them no tag names, in the same order. */
  readonly versions: readonly string[];
  /**
   * True when no file is there, which settle creates (#842): the status
   * block then prints `MISSING_CHANGELOG_CELL`
   * (`src/commands/release/status.ts`) and no problem line. `problem`
   * still carries the read failure for other readers (`rafa next`'s
   * epic end).
   */
  readonly missing: boolean;
  /** Why the changelog could not be read, or null when it was. */
  readonly problem: string | null;
}

/**
 * How two prerelease identifiers order, by semver's rule: two numeric
 * ones numerically, a numeric one below an alphanumeric one, and two
 * alphanumeric ones by ASCII.
 */
function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right
    ? -1
    : 1;
}

/**
 * How two prerelease tails order: an empty one is a release and ranks
 * ABOVE any prerelease, and two prereleases compare identifier by
 * identifier, the shorter one lower where every shared identifier is
 * equal.
 */
function comparePrereleases(left: string, right: string): number {
  if (left === right) return 0;
  if (left === '') return 1;
  if (right === '') return -1;
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifiers(leftParts[index] ?? '', rightParts[index] ?? '');
    if (order !== 0) return order;
  }
  return leftParts.length - rightParts.length;
}

/**
 * How two versions order by semver precedence, lower first. The build
 * metadata is ignored, as semver ignores it; see the module note for
 * why the order is this module's own and not git's.
 */
export function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrereleases(left.prerelease, right.prerelease);
}

/** How two release tags order, highest first. */
export function compareReleaseTags(left: ReleaseTag, right: ReleaseTag): number {
  return compareVersions(right.parsed, left.parsed);
}

/**
 * The tags of `text`, one per line as `git tag --list` writes them,
 * that name a release, highest by precedence first. A line naming no
 * version at all is left out.
 */
export function releaseTagsOf(text: string): readonly ReleaseTag[] {
  const tags: ReleaseTag[] = [];
  for (const line of text.split('\n')) {
    const tag = line.trim();
    const found = RELEASE_TAG.exec(tag);
    const version = found?.[1];
    if (version === undefined) continue;
    const parsed = parseSemanticVersion(version);
    if (parsed === null) continue;
    tags.push({ tag, version, parsed });
  }
  return [...tags].sort(compareReleaseTags);
}

/**
 * Every version a changelog's headings name, in the file's own order
 * and without repeats. Headings inside a fenced code block are not
 * headings; see the module note for why the reading is a token search
 * and not a match on the rendered template.
 */
export function changelogVersions(text: string): readonly string[] {
  const versions: string[] = [];
  const seen = new Set<string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !ATX_HEADING.test(line)) continue;
    for (const found of line.matchAll(HEADING_VERSION)) {
      const version = found[1] ?? '';
      if (parseSemanticVersion(version) === null) continue;
      if (!seen.has(version)) {
        seen.add(version);
        versions.push(version);
      }
      break;
    }
  }
  return versions;
}

/** Those of `released` that no tag of `tags` names, in `released`'s order. */
export function untaggedVersions(
  released: readonly string[],
  tags: readonly ReleaseTag[],
): readonly string[] {
  const tagged = new Set(tags.map((tag) => tag.version));
  return released.filter((version) => !tagged.has(version));
}

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The release tags of the repository `git` runs in, highest first. */
export function readTags(git: GitRunner): TagReading {
  const result = git(['tag', '--list']);
  if (!result.ok) {
    return { tags: [], latest: null, problem: `the tags could not be listed: ${gitSaid(result)}` };
  }
  const tags = releaseTagsOf(result.stdout);
  return { tags, latest: tags[0] ?? null, problem: null };
}

/**
 * The versions the changelog at `configured` calls released, and which
 * of them carry no tag. An absent file sets `missing` beside its
 * problem; a file that exists and cannot be read sets the problem only.
 */
export function readUntagged(
  root: string,
  configured: string,
  tags: readonly ReleaseTag[],
): UntaggedReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return {
      path: configured,
      released: [],
      versions: [],
      missing: !existsSync(resolved),
      problem: `the changelog could not be read at ${resolved}`,
    };
  }
  const released = changelogVersions(text);
  return { path: configured, released, versions: untaggedVersions(released, tags), missing: false, problem: null };
}
