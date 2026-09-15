import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { EXIT_DONE, EXIT_REFUSED, RAFA_PACKAGE_NAME } from '../src/runtime/install.js';

import { defaultSeams, runSnapshot, TAG } from './snapshot-runtime.js';

/**
 * `bun run snapshot` as the thin caller of `src/runtime/install.ts`,
 * whose own suite holds the install. These cases hold what the script
 * adds: the checkout and the home it defaults to, the `[snapshot]` prefix,
 * where a refusal goes, and the `PATH` warning after an install.
 *
 * No case calls `defaultSeams` with no home, and none runs its build: a
 * case reads the seams' paths, or runs over a planted checkout and home
 * under a temporary directory of its own with a build that writes `dist/`.
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

describe('defaultSeams', () => {
  it('names this checkout and the home it is handed, and prefixes every line', () => {
    const home = join(base, 'home');

    const seams = defaultSeams(home);

    expect(seams.repoRoot).toBe(resolve(import.meta.dir, '..'));
    expect(seams.home).toBe(home);
    expect(TAG).toBe('[snapshot]');
  });
});

describe('runSnapshot', () => {
  it('writes the refusal to error after the prefix and answers 1, building nothing', () => {
    const { repoRoot, home } = plantCheckout();
    writeFile(join(repoRoot, '.rafa', 'plans', 'PLAN_TRACKER-a.md'), '- [ ] a task left\n');
    const out: string[] = [];
    const errors: string[] = [];

    const code = runSnapshot(seamsOver(repoRoot, home, out), (line) => errors.push(line), join(home, '.rafa', 'bin'));

    expect(code).toBe(EXIT_REFUSED);
    expect(errors[0]).toStartWith(`${TAG} REFUSED — 1 plan tracker(s) in .rafa/plans`);
    expect(errors.join('\n')).toContain('PLAN_TRACKER-a.md:1  [ ] a task left');
    expect(out.some((line) => line.includes('building'))).toBe(false);
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
