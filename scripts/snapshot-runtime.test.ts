import type { SessionRecord } from '../src/loop/sessions.js';

import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { EXIT_DONE, EXIT_REFUSED, RAFA_PACKAGE_NAME } from '../src/runtime/install.js';

import { defaultSeams, readOptions, runSnapshot, TAG } from './snapshot-runtime.js';

/**
 * `bun run snapshot` as the thin caller of `src/runtime/install.ts`,
 * whose own suite holds the install. These cases hold what the script
 * adds: the checkout and the home it defaults to, the `[snapshot]` prefix,
 * where a refusal goes, and the `PATH` warning after an install.
 *
 * No case calls `defaultSeams` with no home, and none runs its build: a
 * case reads the seams' paths, or runs over a planted checkout and home
 * under a temporary directory of its own with a build that writes `dist/`.
 *
 * `--force` is held at both ends: the words {@link readOptions} reads,
 * and the options reaching the install, which the case pairs with the
 * same world refusing without them.
 *
 * A live loop is a session record planted under the checkout's
 * `.rafa/runs/` naming this test process's own pid, read by the install's
 * default reading since the script's seams name none.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-snapshot-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A rafa checkout and a home under the case's directory. */
function plantCheckout(): { repoRoot: string; home: string } {
  const repoRoot = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), `${JSON.stringify({ name: RAFA_PACKAGE_NAME, version: '9.8.7' })}\n`);
  return { repoRoot, home };
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Seams over a planted checkout, each line recorded, the build writing a `cli.js`. */
function seamsOver(repoRoot: string, home: string, out: string[]): Parameters<typeof runSnapshot>[0] {
  expect(repoRoot.startsWith(`${base}${sep}`)).toBe(true);
  expect(home.startsWith(`${base}${sep}`)).toBe(true);
  return {
    ...defaultSeams(home),
    repoRoot,
    build: (root) => {
      writeFile(join(root, 'dist', 'cli.js'), 'console.log(1);\n');
      return 0;
    },
    log: (line) => out.push(`${TAG} ${line}`),
  };
}

/** Writes the record of a loop of `repoRoot` in `state`, its pid this test process's own. */
function plantLoop(repoRoot: string, state: SessionRecord['state']): void {
  const record: SessionRecord = {
    sessionId: 'planted',
    planStub: 'a',
    plan: '.rafa/plans/PLAN-a.md',
    branch: 'feat/a',
    pid: process.pid,
    startedAt: '2026-10-12T10:00:00.000Z',
    state,
    task: null,
  };
  writeFile(join(repoRoot, '.rafa', 'runs', `${record.sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

describe('defaultSeams', () => {
  it('names this checkout and the home it is handed, prefixes every line, and names no reading of the live loops', () => {
    const home = join(base, 'home');

    const seams = defaultSeams(home);

    expect(seams.repoRoot).toBe(resolve(import.meta.dir, '..'));
    expect(seams.home).toBe(home);
    expect(seams.liveLoops).toBeUndefined();
    expect(TAG).toBe('[snapshot]');
  });
});

describe('readOptions', () => {
  it('reads --force and nothing else, and refuses any other word', () => {
    expect(readOptions([])).toEqual({ force: false });
    expect(readOptions(['--force'])).toEqual({ force: true });
    expect(() => readOptions(['--forced', 'now'])).toThrow('unknown argument(s): --forced now; usage: bun run snapshot [--force]');
  });
});

describe('runSnapshot', () => {
  it('refuses a version already installed, and replaces that directory whole under --force', () => {
    const { repoRoot, home } = plantCheckout();
    const runtimeDir = join(home, '.rafa', 'runtime', '9.8.7');
    writeFile(join(runtimeDir, 'marker.txt'), 'planted\n');
    const errors: string[] = [];
    const out: string[] = [];

    const refused = runSnapshot(seamsOver(repoRoot, home, out), (line) => errors.push(line), undefined);

    expect(refused).toBe(EXIT_REFUSED);
    expect(errors[0]).toBe(`${TAG} REFUSED — ${runtimeDir} already holds version 9.8.7, the version in package.json, and a loop may be running from it.`);
    expect(out.some((line) => line.includes('building'))).toBe(false);

    const forced = runSnapshot(seamsOver(repoRoot, home, out), (line) => errors.push(line), join(home, '.rafa', 'bin'), readOptions(['--force']));

    expect(forced).toBe(EXIT_DONE);
    expect(existsSync(join(runtimeDir, 'marker.txt'))).toBe(false);
    expect(readlinkSync(join(home, '.rafa', 'bin', 'rafa'))).toBe(join(runtimeDir, 'cli.js'));
  });

  it('writes the refusal to error after the prefix and answers 1, building nothing, while a loop is live', () => {
    const { repoRoot, home } = plantCheckout();
    writeFile(join(repoRoot, '.rafa', 'plans', 'PLAN_TRACKER-a.md'), '- [ ] a task left\n');
    plantLoop(repoRoot, 'running');
    const out: string[] = [];
    const errors: string[] = [];

    const code = runSnapshot(seamsOver(repoRoot, home, out), (line) => errors.push(line), join(home, '.rafa', 'bin'));

    expect(code).toBe(EXIT_REFUSED);
    expect(errors[0]).toStartWith(`${TAG} REFUSED — 1 plan tracker(s) in .rafa/plans`);
    expect(errors.join('\n')).toContain('PLAN_TRACKER-a.md:1  [ ] a task left');
    expect(out.some((line) => line.includes('building'))).toBe(false);
  });

  it('installs beside a tracker with a task left once its loop is done, warning on stderr after the prefix', () => {
    const { repoRoot, home } = plantCheckout();
    writeFile(join(repoRoot, '.rafa', 'plans', 'PLAN_TRACKER-a.md'), '- [ ] a task left\n');
    plantLoop(repoRoot, 'done');
    const warned: string[] = [];
    const errors: string[] = [];
    const seams = { ...seamsOver(repoRoot, home, []), warn: (line: string): number => warned.push(`${TAG} warn: ${line}`) };

    const code = runSnapshot(seams, (line) => errors.push(line), join(home, '.rafa', 'bin'));

    expect(code).toBe(EXIT_DONE);
    expect(errors).toEqual([]);
    expect(warned).toEqual([
      `${TAG} warn: installing with 1 plan tracker(s) in .rafa/plans still holding a task: ${join('.rafa', 'plans', 'PLAN_TRACKER-a.md')}:1`,
    ]);
    expect(readlinkSync(join(home, '.rafa', 'bin', 'rafa'))).toBe(join(home, '.rafa', 'runtime', '9.8.7', 'cli.js'));
  });

  it('installs ~/.rafa/bin/rafa and warns when ~/.rafa/bin is not ahead of ~/.bun/bin on PATH', () => {
    const { repoRoot, home } = plantCheckout();
    const rafaBin = join(home, '.rafa', 'bin');
    const bunBin = join(home, '.bun', 'bin');
    const errors: string[] = [];

    const code = runSnapshot(seamsOver(repoRoot, home, []), (line) => errors.push(line), [bunBin, rafaBin].join(delimiter));

    expect(code).toBe(EXIT_DONE);
    expect(readlinkSync(join(rafaBin, 'rafa'))).toBe(join(home, '.rafa', 'runtime', '9.8.7', 'cli.js'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith(`${TAG} warn: ${rafaBin} is on PATH after ${bunBin}`);
  });

  it('warns about nothing when ~/.rafa/bin leads the PATH, the control for the warning', () => {
    const { repoRoot, home } = plantCheckout();
    const errors: string[] = [];

    const code = runSnapshot(seamsOver(repoRoot, home, []), (line) => errors.push(line), join(home, '.rafa', 'bin'));

    expect(code).toBe(EXIT_DONE);
    expect(errors).toEqual([]);
  });
});
