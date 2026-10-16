/**
 * The units `rafa release tag` tags: the root package, read off
 * `release.versionFile` and `release.changelog` by `./tag.ts`'s
 * `readTagInputs`, and each publishable workspace package, read here by
 * {@link readUnitInputs}. Every unit is decided by `./tag.ts`'s
 * `decideTag` over the same five readings, so a package refuses for the
 * same reasons the root does and in the same order.
 *
 * ## A package's readings
 *
 * A workspace member that is not `private: true`
 * ({@link readTagPackages}, over `readWorkspacePackages`) is read from
 * its own folder, as settle writes it (`src/release/settle.ts`):
 *
 * - the version from `<dir>/package.json` ({@link readVersion});
 * - the newest release from `<dir>/CHANGELOG.md` ({@link readNewestRelease});
 * - the tags the repository holds for that package only, `<name>@<version>`;
 * - the commit that set the version, `readReleaseCommit` over
 *   `<dir>/package.json` (`./release-commit.ts`);
 * - the receipt of the version's section in `<dir>/CHANGELOG.md`.
 *
 * A project with no root `package.json` has no workspace, so it has no
 * package unit: its root is read off `release.versionFile` as before.
 *
 * ## Skipped
 *
 * A unit whose version a tag already names is done, not wrong: the run
 * passes over it ({@link unitDecisionOf} turns `decideTag`'s `tagged`
 * refusal into `skipped`) and tags the others. `./tag.ts` refuses
 * `tagged` only when every unit is skipped, so a one-package project
 * reads exactly as it did before units.
 *
 * ## Why the readers live here
 *
 * {@link readVersion} and {@link readNewestRelease} were `./tag.ts`'s.
 * They moved with the package readings so `./tag.ts` imports this
 * module and this module imports nothing of `./tag.ts` but types: the
 * two would otherwise import each other's values.
 */
import type { TagDecision, TagInputs, TagReady, TagRefused } from './tag.js';
import type { GitRunner } from '../../pr/index.js';
import type { WorkspacePackage } from '../../release/workspace-packages.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readReceiptVerdict } from '../../release/receipt.js';
import { changelogVersions, latestTagOf, readTags } from '../../release/status-readings.js';
import { readManifestVersion } from '../../release/version.js';
import { publishableOf, readWorkspacePackages } from '../../release/workspace-packages.js';

import { readReleaseCommit } from './release-commit.js';

/** The file a workspace package's version is read from, in its folder. */
const PACKAGE_MANIFEST = 'package.json';

/** The changelog a workspace package's releases are read from, in its folder, as settle writes it. */
const PACKAGE_CHANGELOG = 'CHANGELOG.md';

/** What the version file declared, and the text it declared it in. */
export interface VersionReading {
  /** The path as `release.versionFile` spells it, or `<dir>/package.json` for a package. */
  readonly path: string;
  /** The file's text, kept for the publish line, or null when it could not be read. */
  readonly text: string | null;
  /** The version it declares, or null when none could be read. */
  readonly version: string | null;
  /** Why there is none, or null when there is one. */
  readonly problem: string | null;
}

/** What the changelog's newest section names. */
export interface ChangelogReading {
  /** The path as `release.changelog` spells it, or `<dir>/CHANGELOG.md` for a package. */
  readonly path: string;
  /** The version its newest section names, or null when no section names one. */
  readonly version: string | null;
  /** Why the file could not be read, or null when it was. */
  readonly problem: string | null;
}

/** A unit's own readings: every one of {@link TagInputs} but the branch, which is read once for the run. */
export type UnitReadings = Omit<TagInputs, 'releaseBranch' | 'branch'>;

/** A unit whose version a tag already names: passed over, not refused; see the module note. */
export interface TagSkipped {
  /** Tells this apart from a ready or a refused decision. */
  readonly kind: 'skipped';
  /** The sentence naming the tag that holds the version, with no marker on the front. */
  readonly message: string;
}

/** What one unit's decision answered: its tag to write, the refusal that stops the run, or a skip. */
export type UnitDecision = TagReady | TagRefused | TagSkipped;

/** The publishable packages of the workspace, or why they could not be read. */
export type TagPackagesReading =
  | { readonly ok: true; readonly packages: readonly WorkspacePackage[] }
  | { readonly ok: false; readonly problem: string };

/** `path`'s text, or null when it could not be read. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** What the version file at `configured` under `root` declares, text included. */
export function readVersion(root: string, configured: string): VersionReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return {
      path: configured,
      text: null,
      version: null,
      problem: `the version file could not be read at ${resolved}`,
    };
  }
  const version = readManifestVersion(text);
  return version === null
    ? { path: configured, text, version: null, problem: `${resolved} declares no version this can read` }
    : { path: configured, text, version, problem: null };
}

/** What the newest section of the changelog at `configured` under `root` names. */
export function readNewestRelease(root: string, configured: string): ChangelogReading {
  const resolved = join(root, configured);
  const text = textOf(resolved);
  if (text === null) {
    return { path: configured, version: null, problem: `the changelog could not be read at ${resolved}` };
  }
  return { path: configured, version: changelogVersions(text)[0] ?? null, problem: null };
}

/**
 * The workspace packages that publish, in manifest-path order, read
 * off the disk at `root`; none for a project with no root manifest.
 */
export function readTagPackages(root: string): TagPackagesReading {
  if (!existsSync(join(root, PACKAGE_MANIFEST))) return { ok: true, packages: [] };
  const reading = readWorkspacePackages(root);
  return reading.ok
    ? { ok: true, packages: publishableOf(reading.packages) }
    : { ok: false, problem: `the workspace packages could not be read: ${reading.problem}` };
}

/**
 * The readings `member` is decided from, each from its own folder; see
 * the module note. `tags` holds the package's tags only, and its
 * `latest` is the package's highest. The commit that set the version is
 * looked up whenever there is a version, since `./tag.ts` reads a
 * package only once the branch check passed.
 */
export function readUnitInputs(root: string, git: GitRunner, member: WorkspacePackage): UnitReadings {
  const manifest = `${member.dir}/${PACKAGE_MANIFEST}`;
  const changelog = `${member.dir}/${PACKAGE_CHANGELOG}`;
  const version = readVersion(root, manifest);
  const tags = readTags(git);
  return {
    package: member.name,
    version,
    changelog: readNewestRelease(root, changelog),
    tags: {
      tags: tags.tags.filter((tag) => tag.package === member.name),
      latest: latestTagOf(tags, member.name),
      problem: tags.problem,
    },
    release: version.version === null
      ? null
      : readReleaseCommit(git, manifest, version.version),
    receipt: version.version === null
      ? null
      : readReceiptVerdict(root, changelog, version.version),
  };
}

/** `decision` as one unit's: a `tagged` refusal is a skip; see the module note. */
export function unitDecisionOf(decision: TagDecision): UnitDecision {
  return decision.kind === 'refused' && decision.reason === 'tagged'
    ? { kind: 'skipped', message: decision.message }
    : decision;
}
