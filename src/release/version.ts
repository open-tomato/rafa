/**
 * The version half of a release: what `origin/main` holds now, what the
 * level makes of it, and how the new number gets into the manifest
 * without disturbing a byte around it.
 *
 * Three steps of the spec's step 1 live here, in the order the wrap-up
 * runs them (`.rafa/specs/rafa-21-changelog-and-release.md`):
 *
 * ```text
 * readBaseVersion(git, versionFile)  → the version on origin/main
 * nextVersion(base, level)           → the version this plan ships
 * writeManifestVersion(path, next)   → the manifest, one token changed
 * ```
 *
 * Each is callable on its own and none of them knows about the other
 * two: the git seam is {@link GitRunner} from `src/pr/git.ts`, the
 * level is whatever `./level.ts` resolved, and the write takes a path
 * and a string. So `./version.test.ts` drives the middle step from
 * literals, the first from a fake runner beside one real repository,
 * and the last in a temporary directory.
 *
 * ## Why the base comes off `origin/main` and not off the disk
 *
 * The spec wants "the base version ... the one on `main` at that
 * moment", and the working tree's manifest is the branch's, which may
 * already carry a bump from a wrap-up that ran and was not merged. So
 * the reading is `git show origin/main:<versionFile>`, preceded by a
 * `git fetch` of that branch so the ref is not the one this clone
 * happened to have.
 *
 * Measured 2026-09-20 on git 2.50.1 (Apple Git-155), against a scratch
 * clone of a scratch repository: `git fetch origin main` updates
 * `refs/remotes/origin/main` and not only `FETCH_HEAD`
 * (`9c3207a..fab6541  main -> origin/main`), so the `show` that follows
 * reads the tip that fetch just brought down. `./version.test.ts`
 * re-measures it rather than trusting this sentence, since an
 * opportunistic ref update is a git behaviour and not a promise this
 * module can keep.
 *
 * A fetch that FAILS does not stop the reading. The `show` still runs
 * against whatever ref this clone holds, and the reading says so
 * through {@link BaseVersionReading.fetched} and a sentence in
 * {@link BaseVersionReading.problems}. The two failures are
 * independent — no network, versus no such file on the base — and a
 * caller that must not bump from a possibly stale base has `fetched`
 * to refuse on, while one that would rather bump than stall has the
 * version. Deciding that here would take the choice away from the
 * wrap-up, which is the only place that knows whether a stale number
 * is worse than no release.
 *
 * ## The path is git's, not the filesystem's
 *
 * `release.versionFile` is relative to the repository root
 * (`src/config-schema.ts`), which is what `<ref>:<path>` wants. A
 * leading `./` is stripped ({@link gitPathOf}) because git reads
 * `<ref>:./<path>` relative to the CURRENT DIRECTORY instead: measured
 * 2026-09-20, `git show origin/main:./package.json` from a
 * subdirectory answers `fatal: path 'sub/package.json' does not exist
 * in 'origin/main'` while `git show origin/main:package.json` answers
 * the file.
 *
 * ## What `next` means for each level
 *
 * {@link nextVersion} follows npm's rules, measured 2026-09-20 against
 * `npm version <level> --no-git-tag-version` in a scratch package:
 *
 * | base | level | next |
 * |---|---|---|
 * | `1.2.3` | patch | `1.2.4` |
 * | `0.4.0` | minor | `0.5.0` |
 * | `1.2.3` | major | `2.0.0` |
 * | `1.2.3-rc.1` | patch | `1.2.3` |
 * | `1.2.3-rc.1` | minor | `1.3.0` |
 * | `1.3.0-rc.1` | minor | `1.3.0` |
 * | `2.0.0-rc.1` | major | `2.0.0` |
 * | `1.2.3+b9` | patch | `1.2.4` |
 *
 * The prerelease rows are the ones worth stating: a prerelease is a
 * version on its WAY to its own triple, so the bump that would have
 * landed on that triple lands on it exactly, and the `-rc.1` is
 * dropped rather than carried. Build metadata is dropped by every
 * bump. `none` answers the base unchanged, and is still refused for a
 * base that is no version at all, so a caller never has to ask which
 * levels validate.
 *
 * ## The write changes one token and nothing else
 *
 * `package.json` in this repository ends WITHOUT a trailing newline
 * (measured `tail -c 50 package.json | xxd`, 2026-09-19), and a
 * consumer's ends with one. Both have to survive the bump, which rules
 * out the obvious `JSON.parse` / `JSON.stringify` round trip: it would
 * have to be told the indent width, would drop a tab indent, a CRLF
 * line ending and any comment-shaped whitespace, and would still need
 * the trailing newline restored by hand.
 *
 * So {@link replaceManifestVersion} rewrites the manifest's version
 * STRING and leaves every other byte where it was. The trailing
 * newline is then not a case the module handles — it is a byte the
 * module never touches — and the same is true of the indentation, the
 * key order and the line endings. `./version.test.ts` asserts that
 * directly: everything outside the replaced span is compared byte for
 * byte.
 *
 * Finding the right token is the one subtlety. A manifest can hold a
 * NESTED `version` key — a tool block such as `volta` or `packageManager`
 * carrying its own — and a bare search for the first `"version":` pair
 * would write the release into it and leave the real one alone, a
 * corruption no gate would notice. Rather than a brace-depth scanner,
 * each candidate replacement is PARSED back: the one accepted is the
 * one whose parse has the new version at the top level and is otherwise
 * equal to the parse of the original. A candidate that fails either
 * check is skipped and the next pair tried.
 */
import type { PlanReleaseLevel } from '../plan/parse.js';
import type { GitRunner } from '../pr/git.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/git.js';

/** The remote the base version is read from, unless a caller names another. */
export const RELEASE_REMOTE = 'origin';

/** The branch on it that carries the released versions. */
export const RELEASE_BASE_BRANCH = 'main';

/**
 * A version as semver spells it: three numbers, with the prerelease and
 * the build metadata kept apart so a bump can drop them.
 */
export interface SemanticVersion {
  /** The first number. */
  readonly major: number;
  /** The second. */
  readonly minor: number;
  /** The third. */
  readonly patch: number;
  /** What followed a `-`, without it; empty when there was none. */
  readonly prerelease: string;
  /** What followed a `+`, without it; empty when there was none. */
  readonly build: string;
}

/**
 * Semver's shape, with leading zeros refused in each number as the
 * specification refuses them. No `v` prefix and no surrounding space:
 * a manifest's version is the string it stores, trimmed by
 * {@link readManifestVersion} before it arrives.
 */
const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** `raw` as its three numbers and two tails, or null when it is no version. */
export function parseSemanticVersion(raw: string): SemanticVersion | null {
  const found = VERSION_SHAPE.exec(raw);
  if (found === null) return null;
  return {
    major: Number(found[1]),
    minor: Number(found[2]),
    patch: Number(found[3]),
    prerelease: found[4] ?? '',
    build: found[5] ?? '',
  };
}

/** A parsed version back as the string it came from. */
export function formatSemanticVersion(version: SemanticVersion): string {
  const prerelease = version.prerelease === ''
    ? ''
    : `-${version.prerelease}`;
  const build = version.build === ''
    ? ''
    : `+${version.build}`;
  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`;
}

/** The three levels that actually move a number. */
type BumpLevel = Exclude<PlanReleaseLevel, 'none'>;

/** The triple one bump of `version` lands on; see the module note's table. */
function bumped(version: SemanticVersion, level: BumpLevel): SemanticVersion {
  const onPrerelease = version.prerelease !== '';
  const blank = { prerelease: '', build: '' };
  if (level === 'major') {
    const stays = onPrerelease && version.minor === 0 && version.patch === 0;
    const major = stays
      ? version.major
      : version.major + 1;
    return { major, minor: 0, patch: 0, ...blank };
  }
  if (level === 'minor') {
    const stays = onPrerelease && version.patch === 0;
    const minor = stays
      ? version.minor
      : version.minor + 1;
    return { major: version.major, minor, patch: 0, ...blank };
  }
  const patch = onPrerelease
    ? version.patch
    : version.patch + 1;
  return { major: version.major, minor: version.minor, patch, ...blank };
}

/**
 * The version `level` takes `base` to, or null when `base` is no
 * version at all.
 *
 * `none` answers `base` unchanged — a release of nothing still names
 * the version it did not move — and is refused for an unreadable base
 * like every other level, so one null check covers the four.
 */
export function nextVersion(base: string, level: PlanReleaseLevel): string | null {
  const parsed = parseSemanticVersion(base);
  if (parsed === null) return null;
  if (level === 'none') return formatSemanticVersion(parsed);
  return formatSemanticVersion(bumped(parsed, level));
}

/** `text` parsed as a JSON object, or null for anything else. */
function manifestFields(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * The `version` a manifest's text declares, trimmed, or null when the
 * text is no JSON object or its `version` is absent, blank or not a
 * string. Nothing here checks the shape: a manifest may hold a version
 * this module cannot bump, and saying which failed is
 * {@link nextVersion}'s job.
 */
export function readManifestVersion(text: string): string | null {
  const fields = manifestFields(text);
  if (fields === null) return null;
  const value = fields['version'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** Every `"version": "..."` pair in a text, its key and separator captured apart from its value. */
const VERSION_PAIR = /("version"\s*:\s*)"(?:[^"\\]|\\.)*"/g;

/** A manifest's text with its version replaced, and the version it replaced. */
export interface ManifestRewrite {
  /** The whole text, one token different; see the module note. */
  readonly text: string;
  /** What the version was before, trimmed. */
  readonly previous: string;
}

/** True when `after` differs from `before` in nothing but the version. */
function sameBesidesVersion(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const restored = { ...after, version: before['version'] };
  return JSON.stringify(restored) === JSON.stringify(before);
}

/**
 * `text` with its top-level version set to `next`, or null when it
 * holds no version to replace or no replacement parses back to one.
 *
 * Every byte outside the version's own token is the byte it was, the
 * trailing newline included; the module note says why that is the
 * whole of the byte-safety and how the top-level pair is told from a
 * nested one.
 */
export function replaceManifestVersion(text: string, next: string): ManifestRewrite | null {
  const previous = readManifestVersion(text);
  const before = manifestFields(text);
  if (previous === null || before === null) return null;

  for (const pair of text.matchAll(VERSION_PAIR)) {
    const start = pair.index;
    const candidate = `${text.slice(0, start)}${pair[1]}${JSON.stringify(next)}${text.slice(start + pair[0].length)}`;
    const after = manifestFields(candidate);
    if (after === null || after['version'] !== next) continue;
    if (!sameBesidesVersion(before, after)) continue;
    return { text: candidate, previous };
  }
  return null;
}

/** What one attempt to write a version into a manifest did. */
export interface ManifestWriteReading {
  /** The manifest, as the caller named it. */
  readonly path: string;
  /** True when the file was rewritten. */
  readonly written: boolean;
  /** The version the file held before, or null when none was read. */
  readonly previous: string | null;
  /** The version asked for. */
  readonly version: string;
  /** Why nothing was written, or null when something was. */
  readonly problem: string | null;
}

/**
 * Writes `next` as the version of the manifest at `path`, changing
 * nothing else in the file.
 *
 * A manifest that cannot be read, holds no version, or whose version
 * could not be replaced is REPORTED through
 * {@link ManifestWriteReading.problem} and left exactly as it was: the
 * release runs inside a wrap-up that has other things to say, and a
 * throw here would lose them. Writing the version the file already
 * holds is a write like any other and answers `written`.
 */
export function writeManifestVersion(path: string, next: string): ManifestWriteReading {
  const unwritten = { path, written: false, previous: null, version: next };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ...unwritten, problem: `${path} could not be read: ${messageOf(error)}` };
  }

  const rewritten = replaceManifestVersion(text, next);
  if (rewritten === null) {
    const previous = readManifestVersion(text);
    return {
      ...unwritten,
      previous,
      problem: previous === null
        ? `${path} declares no version to write ${next} over`
        : `${path} declares ${previous}, and the pair holding it could not be rewritten`,
    };
  }

  try {
    writeFileSync(path, rewritten.text);
  } catch (error) {
    return { ...unwritten, previous: rewritten.previous, problem: `${path} could not be written: ${messageOf(error)}` };
  }
  return { path, written: true, previous: rewritten.previous, version: next, problem: null };
}

/** Which remote branch a base version is read from. */
export interface BaseVersionOptions {
  /** The remote to fetch from; `origin` unless named. */
  readonly remote?: string;
  /** The branch on it; `main` unless named. */
  readonly branch?: string;
}

/** What the base branch's manifest says, and what could not be asked. */
export interface BaseVersionReading {
  /** The ref read, as git was given it: `origin/main`. */
  readonly ref: string;
  /** The manifest's path as git was given it; see {@link gitPathOf}. */
  readonly path: string;
  /** The version on the base, or null when none could be read. */
  readonly version: string | null;
  /** True when the fetch that refreshes the ref succeeded. */
  readonly fetched: boolean;
  /** A sentence per reading that failed, in the order they ran. */
  readonly problems: readonly string[];
}

/**
 * A repository-root-relative path as `<ref>:<path>` wants it: without
 * its leading `./`, which would send git to the current directory
 * instead. See the module note for the measurement.
 */
export function gitPathOf(versionFile: string): string {
  let path = versionFile;
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

/**
 * The version the base branch's manifest holds, after fetching that
 * branch.
 *
 * The fetch and the show fail independently and neither throws; the
 * module note holds why a failed fetch still reads, and what a caller
 * that cannot accept a stale base should check.
 */
export function readBaseVersion(
  git: GitRunner,
  versionFile: string,
  options: BaseVersionOptions = {},
): BaseVersionReading {
  const remote = options.remote ?? RELEASE_REMOTE;
  const branch = options.branch ?? RELEASE_BASE_BRANCH;
  const ref = `${remote}/${branch}`;
  const path = gitPathOf(versionFile);
  const problems: string[] = [];

  const fetched = git(['fetch', remote, branch]);
  if (!fetched.ok) {
    problems.push(`${branch} could not be fetched from ${remote}, so the base version is whatever this clone already holds for ${ref}: ${gitSaid(fetched)}`);
  }

  const shown = git(['show', `${ref}:${path}`]);
  if (!shown.ok) {
    problems.push(`${ref}:${path} could not be read: ${gitSaid(shown)}`);
    return { ref, path, version: null, fetched: fetched.ok, problems };
  }

  const version = readManifestVersion(shown.stdout);
  if (version === null) problems.push(`${ref}:${path} declares no version`);
  return { ref, path, version, fetched: fetched.ok, problems };
}
