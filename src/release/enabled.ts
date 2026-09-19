/**
 * Whether the release half of the wrap-up runs in this repository, and
 * what that answer was read from.
 *
 * `release.enabled` resolves in the config layer to `true`, `false` or
 * `auto` ({@link ReleaseEnabled}), and `auto` is its default. This
 * module is where `auto` becomes a yes or a no: the spec spells it
 * `auto = on when both files below exist`, which is a reading off a
 * disk and so cannot be a literal in the defaults layer. The two
 * explicit answers are taken as written and no file can overturn
 * either.
 *
 * ## Both files, not either
 *
 * Under `auto` the release is on only when `release.versionFile` AND
 * `release.changelog` are both there. A repository with a changelog and
 * no manifest, or a manifest and no changelog, is one that never opted
 * in to half a release, and inferring one from a lone file would start
 * writing into a project that asked for nothing. The spec's other
 * reading — "a project with no version file gets the changelog entry
 * under a date heading and no bump" — is about a release that IS on,
 * which here means `enabled: true` spelled in the config; it is
 * `release/version.ts` and `release/changelog.ts` that act on it, and
 * {@link ReleaseEnabledReading} carries each file's presence so they
 * need not stat the same two paths again.
 *
 * ## What counts as a file being there
 *
 * A path is present when `statSync` answers a REGULAR file for it, the
 * rule `board/gate.ts` applies to the files a session writes. Bare
 * existence is not enough: a directory named `CHANGELOG.md` would pass
 * `existsSync`, and then the wrap-up would turn itself on to write an
 * entry into something it cannot open. A symlink pointing at a real
 * file counts, because `statSync` follows it and the writer will too.
 *
 * A path that cannot be stat'd at all — absent, a broken symlink, or a
 * parent directory this process may not enter — reads as absent rather
 * than throwing. The direction is deliberate: under `auto` an
 * unreadable path turns the release OFF, which is the outcome that
 * writes nothing, and an operator who wanted it on either way has
 * `enabled: true` to say so.
 *
 * ## Paths are relative to the repository root
 *
 * Both settings are paths relative to the root (`src/config-schema.ts`),
 * so every reading resolves them against the `repoRoot` it is handed
 * and reports both spellings: `path` as the config wrote it, for a
 * message a person reads, and `resolved` as this module stat'd it, for
 * the module that opens it next.
 */
import type { ReleaseEnabled } from '../config-sections.js';

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { RELEASE_AUTO } from '../config-sections.js';

/**
 * The three `release` settings a reading is made from, named as
 * `ResolvedConfig` names them, so a resolved config is one itself and
 * no caller has to take the three fields apart first.
 */
export interface ReleaseFileSettings {
  /** `release.enabled`: the boolean as written, or `auto`. */
  readonly releaseEnabled: ReleaseEnabled;
  /** `release.versionFile`, relative to the repository root. */
  readonly releaseVersionFile: string;
  /** `release.changelog`, relative to the repository root. */
  readonly releaseChangelog: string;
}

/** One configured path, as written and as found. */
export interface ReleaseFileReading {
  /** The path as the config spells it, relative to the repository root. */
  readonly path: string;
  /** The same path resolved against the repository root. */
  readonly resolved: string;
  /** True when a regular file sits there; see the module note. */
  readonly present: boolean;
}

/** Which of the two answers decided a reading. */
export type ReleaseEnabledSource = 'config' | 'files';

/** Whether the release runs here, what decided it, and what the disk holds. */
export interface ReleaseEnabledReading {
  /** True when the wrap-up's release steps run in this repository. */
  readonly enabled: boolean;
  /** `config` when `release.enabled` was a boolean, `files` under `auto`. */
  readonly source: ReleaseEnabledSource;
  /** The version manifest the bump would be written to. */
  readonly versionFile: ReleaseFileReading;
  /** The changelog the entry would be inserted into. */
  readonly changelog: ReleaseFileReading;
}

/** True when a regular file sits at `full`; false for anything else. */
function isRegularFile(full: string): boolean {
  try {
    return statSync(full).isFile();
  } catch {
    return false;
  }
}

/** `path` resolved under `repoRoot` and stat'd, as a reading. */
function readFile(repoRoot: string, path: string): ReleaseFileReading {
  const resolved = resolve(repoRoot, path);
  return { path, resolved, present: isRegularFile(resolved) };
}

/**
 * Whether the release runs in the repository at `repoRoot`.
 *
 * Both configured files are stat'd whatever `release.enabled` says, so
 * a reading always carries what the disk holds: the explicit answers
 * decide `enabled` without consulting it, and the modules downstream
 * still need to know which file is missing. An `auto` reading is on
 * only when both are present.
 */
export function resolveReleaseEnabled(
  settings: ReleaseFileSettings,
  repoRoot: string,
): ReleaseEnabledReading {
  const versionFile = readFile(repoRoot, settings.releaseVersionFile);
  const changelog = readFile(repoRoot, settings.releaseChangelog);
  if (settings.releaseEnabled === RELEASE_AUTO) {
    return {
      enabled: versionFile.present && changelog.present,
      source: 'files',
      versionFile,
      changelog,
    };
  }
  return { enabled: settings.releaseEnabled, source: 'config', versionFile, changelog };
}
