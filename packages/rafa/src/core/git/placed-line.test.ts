/**
 * Tests for `placed-line.ts`: the same top level gives the bare
 * command, a different one gives `cd <checkout> && <command>`, a
 * top-level read git did not answer gives the prefix, and a checkout
 * that is not there answers `unplaced`.
 *
 * The seams are stubs, so each reading is the one the case names. Two
 * cases are controls. A same-place case that recorded the paths checked
 * shows the helper did check the path, and a missing checkout whose top
 * level matches still answers `unplaced`. `readTopLevel` runs a real git
 * in a temporary repository, and a temporary directory outside any
 * repository is its control.
 */
import type { PlaceSeams } from './placed-line.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from './git.js';
import { placeLine, readTopLevel } from './placed-line.js';

const CHECKOUT = '/work/checkout';
const COMMAND = 'rafa release tag';

/** Seams that read `topLevel` and find only the paths in `present`. */
function seams(topLevel: string | null, present: readonly string[] = [CHECKOUT]): PlaceSeams {
  return { readTopLevel: () => topLevel, pathExists: (path) => present.includes(path) };
}

describe('placeLine', () => {
  it('gives the bare command when the top level is the checkout', () => {
    const checked: string[] = [];
    const recording: PlaceSeams = {
      readTopLevel: () => CHECKOUT,
      pathExists: (path) => {
        checked.push(path);
        return true;
      },
    };

    expect(placeLine(COMMAND, CHECKOUT, recording)).toEqual({ kind: 'placed', line: COMMAND });
    expect(checked).toEqual([CHECKOUT]);
  });

  it('reads a trailing slash on either side as the same place', () => {
    expect(placeLine(COMMAND, `${CHECKOUT}/`, seams(CHECKOUT, [`${CHECKOUT}/`]))).toEqual({
      kind: 'placed',
      line: COMMAND,
    });
    expect(placeLine(COMMAND, CHECKOUT, seams(`${CHECKOUT}/`))).toEqual({ kind: 'placed', line: COMMAND });
  });

  it('puts cd <checkout> && in front when the top level is another checkout', () => {
    expect(placeLine(COMMAND, CHECKOUT, seams('/work/other'))).toEqual({
      kind: 'placed',
      line: `cd ${CHECKOUT} && ${COMMAND}`,
    });
  });

  it('keeps the prefix when git did not answer the top-level read', () => {
    expect(placeLine(COMMAND, CHECKOUT, seams(null))).toEqual({
      kind: 'placed',
      line: `cd ${CHECKOUT} && ${COMMAND}`,
    });
  });

  it('quotes a checkout that is not plain shell text', () => {
    const spaced = '/work/my checkout';

    expect(placeLine(COMMAND, spaced, seams(null, [spaced]))).toEqual({
      kind: 'placed',
      line: `cd '${spaced}' && ${COMMAND}`,
    });
  });

  it('answers unplaced when the checkout is not there, whatever the top level reads', () => {
    expect(placeLine(COMMAND, CHECKOUT, seams('/work/other', []))).toEqual({ kind: 'unplaced', checkout: CHECKOUT });
    expect(placeLine(COMMAND, CHECKOUT, seams(null, []))).toEqual({ kind: 'unplaced', checkout: CHECKOUT });
    expect(placeLine(COMMAND, CHECKOUT, seams(CHECKOUT, []))).toEqual({ kind: 'unplaced', checkout: CHECKOUT });
  });
});

describe('readTopLevel over a real git', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'placed-line-')));
  const repository = join(scratch, 'repository');
  const outside = join(scratch, 'outside');
  mkdirSync(join(repository, 'nested'), { recursive: true });
  mkdirSync(outside);
  spawnSync('git', ['init', '--quiet', repository]);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reads the repository root from a folder inside it', () => {
    expect(readTopLevel(createGitRunner(join(repository, 'nested')))).toBe(repository);
  });

  it('answers null outside any repository', () => {
    expect(readTopLevel(createGitRunner(outside))).toBeNull();
  });

  it('answers null when git printed nothing or refused', () => {
    expect(readTopLevel(() => ({ ok: true, stdout: '\n', stderr: '' }))).toBeNull();
    expect(readTopLevel(() => ({ ok: false, stdout: '/x', stderr: 'fatal' }))).toBeNull();
  });
});
