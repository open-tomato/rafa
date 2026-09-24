/**
 * Tests for the install readings `rafa doctor` warns by
 * (`doctor-install.ts`), moved out of `./doctor.ts` whole: what
 * {@link readInstall} reads of a project root and a `PATH`, and what
 * {@link writeInstall} writes of it in text and json mode.
 *
 * Every case plants a project root and a home of its own under a
 * temporary directory, with no `.rafa/config.yaml`, so the config
 * resolves to the defaults and neither pre-init directory is named. The
 * clean project is the control of every warning case: it reads no
 * warning at all, so a reader that always warned would fail there. How
 * each reading words its line is its own module's; these cases hold that
 * each reaches the output, and in which mode.
 */
import type { InstallReadings } from './doctor-install.js';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { LEGACY_EFFORT_STORE_DIR, STORE_FILE_NAMES } from '../effort/store/legacy.js';
import { EFFORT_STORE_DIR } from '../effort/store.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { readInstall, writeInstall } from './doctor-install.js';

let base = '';
let root = '';
let home = '';

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'rafa-doctor-install-'));
  root = join(base, 'project');
  home = join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A `PATH` with `~/.rafa/bin` of the home ahead of `~/.bun/bin`. */
function goodPath(): string {
  return [join(home, '.rafa', 'bin'), join(home, '.bun', 'bin')].join(delimiter);
}

/** The readings of the planted project under `path`. */
function read(path: string = goodPath()): InstallReadings {
  return readInstall({ env: { PATH: path } }, { root, home });
}

/** What {@link writeInstall} writes of `install` in `mode`, level by level. */
function written(install: InstallReadings, mode: 'text' | 'json'): { info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  const output = sinkOutput({ info: (line) => info.push(line), warn: (line) => warn.push(line) });
  writeInstall({ output, outputMode: mode }, install);
  return { info, warn };
}

describe('readInstall', () => {
  it('reads a clean project with no warning and no store problem', () => {
    const install = read();

    expect(install.storeProblem).toBeNull();
    expect(install.binPath.warning).toBeNull();
    expect(install.legacyStore?.warning).toBeNull();
    expect(install.preInitDirs?.warning).toBeNull();
    expect(install.previousCopies).toEqual({ count: 0, warning: null });
  });

  it('reads a store left under .ralph/effort/ alone as a legacy-store warning', () => {
    mkdirSync(join(root, LEGACY_EFFORT_STORE_DIR), { recursive: true });
    writeFileSync(join(root, LEGACY_EFFORT_STORE_DIR, STORE_FILE_NAMES[0] ?? ''), '');

    expect(read().legacyStore?.warning).toContain(LEGACY_EFFORT_STORE_DIR);
  });

  it('turns a store file that cannot be checked into a store problem, not a throw', () => {
    const storeDir = join(root, EFFORT_STORE_DIR);
    mkdirSync(storeDir, { recursive: true });
    const looped = join(storeDir, STORE_FILE_NAMES[0] ?? '');
    symlinkSync(looped, looped);

    const install = read();

    expect(install.legacyStore).toBeNull();
    expect(install.storeProblem).toStartWith('rafa doctor: the effort store directories could not be checked: ');
  });

  it('reads a PATH without ~/.rafa/bin as a bin-path warning', () => {
    expect(read(join(home, '.bun', 'bin')).binPath.warning).not.toBeNull();
  });
});

describe('writeInstall', () => {
  it('writes the PATH-order line at info in text mode for a clean project, and nothing in json mode', () => {
    const install = read();

    expect(written(install, 'text')).toEqual({
      info: [`${join(home, '.rafa', 'bin')} is on PATH, and ${join(home, '.bun', 'bin')} is not ahead of it.`],
      warn: [],
    });
    expect(written(install, 'json')).toEqual({ info: [], warn: [] });
  });

  it('writes every warning in both modes, the store problem first and the PATH warning last, with no info line', () => {
    const storeDir = join(root, EFFORT_STORE_DIR);
    mkdirSync(storeDir, { recursive: true });
    const looped = join(storeDir, STORE_FILE_NAMES[0] ?? '');
    symlinkSync(looped, looped);
    const install = read(join(home, '.bun', 'bin'));
    const expected = { info: [], warn: [install.storeProblem ?? 'no store problem', install.binPath.warning ?? 'no PATH warning'] };

    expect(written(install, 'text')).toEqual(expected);
    expect(written(install, 'json')).toEqual(expected);
  });
});
