/**
 * Tests for the release switch (`src/release/enabled.ts`): `auto`
 * resolved against the two configured files, and the two explicit
 * readings that no file can overturn.
 *
 * Every case builds its own scratch repository under `mkdtemp` and
 * plants the files it is about, so nothing here reads the checkout the
 * suite runs in — where both `package.json` and `CHANGELOG.md` happen
 * to exist, and an `auto` case would pass whatever the module did with
 * them. The scratch directories are removed when the file is done.
 *
 * A switch passes while wrong in one direction most easily: a module
 * that answered true for everything satisfies every on case here. So
 * each on case sits beside the off case that differs from it in one
 * planted file, and the explicit pair asserts BOTH that a config
 * answer stands against the files and that the files were read anyway.
 *
 * Three mutations of `enabled.ts` were driven on 2026-09-20, one at a
 * time over `env -u CLAUDECODE bun test src/release/`, the module
 * restored from a scratch copy and verified with `shasum -c` after
 * each. 10 pass either side, and each count is that run's own:
 *
 *  - `auto` on when EITHER file is there: 4 fail, every off case under
 *    `auto` that plants one of the two — the missing changelog, the
 *    missing version file, the directory and the broken symlink.
 *  - presence read with `existsSync` instead of `statSync().isFile()`:
 *    1 fail, the directory case, which is the only one that puts
 *    something that is not a file at a configured path.
 *  - the explicit answers ignored, so the files decide always: 2 fail,
 *    both cases under an explicit answer.
 */
import type { ReleaseFileSettings } from './enabled.js';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { resolveReleaseEnabled } from './enabled.js';

/** Every scratch directory made here, removed when the file is done. */
const scratchDirs: string[] = [];

/** A repository root of this case's own, under the system temporary directory. */
function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-release-enabled-'));
  scratchDirs.push(dir);
  return dir;
}

/** The defaults the config layer carries, with `enabled` as the case wants it. */
function settings(releaseEnabled: ReleaseFileSettings['releaseEnabled']): ReleaseFileSettings {
  return {
    releaseEnabled,
    releaseVersionFile: 'package.json',
    releaseChangelog: 'CHANGELOG.md',
  };
}

/** Writes `body` at `path` under `root`, making the directories above it. */
function plant(root: string, path: string, body = 'planted\n'): string {
  const full = resolve(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('resolveReleaseEnabled under auto', () => {
  it('is on when both configured files are there', () => {
    const root = scratchRoot();
    plant(root, 'package.json', '{}\n');
    plant(root, 'CHANGELOG.md');

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.enabled).toBe(true);
    expect(reading.source).toBe('files');
    expect(reading.versionFile.present).toBe(true);
    expect(reading.changelog.present).toBe(true);
  });

  it('is off when the changelog is missing', () => {
    const root = scratchRoot();
    plant(root, 'package.json', '{}\n');

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.enabled).toBe(false);
    expect(reading.source).toBe('files');
    expect(reading.versionFile.present).toBe(true);
    expect(reading.changelog.present).toBe(false);
  });

  it('is off when the version file is missing', () => {
    const root = scratchRoot();
    plant(root, 'CHANGELOG.md');

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.enabled).toBe(false);
    expect(reading.versionFile.present).toBe(false);
    expect(reading.changelog.present).toBe(true);
  });

  it('is off when neither file is there', () => {
    const root = scratchRoot();

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.enabled).toBe(false);
    expect(reading.source).toBe('files');
  });

  it('reads a directory at a configured path as absent', () => {
    const root = scratchRoot();
    plant(root, 'package.json', '{}\n');
    mkdirSync(join(root, 'CHANGELOG.md'));

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.changelog.present).toBe(false);
    expect(reading.enabled).toBe(false);
  });

  it('reads a symlink to a file as present and a broken one as absent', () => {
    const root = scratchRoot();
    const target = plant(root, 'version-source.json', '{}\n');
    symlinkSync(target, join(root, 'package.json'));
    symlinkSync(join(root, 'nothing-here.md'), join(root, 'CHANGELOG.md'));

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.versionFile.present).toBe(true);
    expect(reading.changelog.present).toBe(false);
    expect(reading.enabled).toBe(false);
  });
});

describe('resolveReleaseEnabled under an explicit answer', () => {
  it('stays on when the config says true and neither file is there', () => {
    const root = scratchRoot();

    const reading = resolveReleaseEnabled(settings(true), root);

    expect(reading.enabled).toBe(true);
    expect(reading.source).toBe('config');
    expect(reading.versionFile.present).toBe(false);
    expect(reading.changelog.present).toBe(false);
  });

  it('stays off when the config says false and both files are there', () => {
    const root = scratchRoot();
    plant(root, 'package.json', '{}\n');
    plant(root, 'CHANGELOG.md');

    const reading = resolveReleaseEnabled(settings(false), root);

    expect(reading.enabled).toBe(false);
    expect(reading.source).toBe('config');
    expect(reading.versionFile.present).toBe(true);
    expect(reading.changelog.present).toBe(true);
  });
});

describe('the paths a reading carries', () => {
  it('reports each path as configured and as resolved under the root', () => {
    const root = scratchRoot();
    plant(root, 'packages/cli/package.json', '{}\n');
    plant(root, 'docs/CHANGELOG.md');

    const reading = resolveReleaseEnabled({
      releaseEnabled: 'auto',
      releaseVersionFile: 'packages/cli/package.json',
      releaseChangelog: 'docs/CHANGELOG.md',
    }, root);

    expect(reading.enabled).toBe(true);
    expect(reading.versionFile.path).toBe('packages/cli/package.json');
    expect(reading.versionFile.resolved).toBe(resolve(root, 'packages/cli/package.json'));
    expect(reading.changelog.path).toBe('docs/CHANGELOG.md');
    expect(reading.changelog.resolved).toBe(resolve(root, 'docs/CHANGELOG.md'));
  });

  it('resolves a path relative to the root and not to the working directory', () => {
    const root = scratchRoot();
    plant(root, 'package.json', '{}\n');
    plant(root, 'CHANGELOG.md');

    const reading = resolveReleaseEnabled(settings('auto'), root);

    expect(reading.versionFile.resolved.startsWith(root)).toBe(true);
    expect(reading.versionFile.resolved).not.toBe(resolve(process.cwd(), 'package.json'));
  });
});
