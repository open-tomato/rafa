/**
 * Tests for the task prompt's gate lines (`task-gate-lines.ts`): the base
 * line naming `bun test --changed=<base>`, no line for a null base, an
 * abbreviated commit name taken, and a base that is not a commit name
 * refused; then the always-run line over the `tests.alwaysRun` files,
 * resolved against a stubbed `git ls-files` for the default, `[]` and a
 * glob matching nothing. Where `buildTaskPrompt` places the lines is
 * driven in `dispatch.test.ts`.
 */

import type { Output } from '../ports/index.js';
import type { GitRunner } from '../pr/index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createTextOutput } from '../adapters/output/text.js';
import { TESTS_DEFAULTS } from '../config-schema-tests.js';

import {
  alwaysRunFiles,
  alwaysRunLines,
  BASE_PROMPT_PREFIX,
  baseLines,
  readAlwaysRunFiles,
} from './task-gate-lines.js';

describe('baseLines, handing the task its base commit', () => {
  const BASE = 'a5a383a0c3f1e2d4b6a798011223344556677889';

  it('names the base and bun test --changed=<base> in one line', () => {
    expect(baseLines(BASE)).toEqual([
      `${BASE_PROMPT_PREFIX}${BASE}: run \`bun test --changed=${BASE}\` for the tests your changes reach.`,
    ]);
  });

  it('gives no line for a null base', () => {
    expect(baseLines(null)).toEqual([]);
  });

  it('takes an abbreviated commit name', () => {
    expect(baseLines('a5a383a').join('\n')).toContain('--changed=a5a383a`');
  });

  it('refuses a base that is not a commit name, which the line would paste into a shell command', () => {
    for (const base of ['', 'HEAD', 'origin/main', 'a5a383a; rm -rf .', 'A5A383A']) {
      expect(() => baseLines(base)).toThrow('is not a commit name');
    }
  });
});

/** Tracked paths holding two default sweeps, one test outside `src/` and plain modules. */
const TRACKED = [
  'src/tests/repo-hygiene.sweep.test.ts',
  'src/start/task-gate-lines.ts',
  'src/pr/conflict-sentence.sweep.test.ts',
  'packages/hub/x.sweep.test.ts',
  'src/start/task-gate-lines.test.ts',
];

/** A `git ls-files -z` stand-in answering `tracked`, recording each call's arguments. */
function lsFiles(tracked: readonly string[], calls: string[][] = []): GitRunner {
  return (args) => {
    calls.push([...args]);
    return { ok: true, stdout: tracked.map((path) => `${path}\0`).join(''), stderr: '' };
  };
}

/** Runs `act` with the active output written into the answered lines. */
function captured(act: () => void): string[] {
  const lines: string[] = [];
  const output: Output = createTextOutput({ verbosity: 0, stream: { write: (chunk: string) => lines.push(chunk) } });
  setActiveOutput(output);
  try {
    act();
  } finally {
    setActiveOutput(null);
  }
  return lines;
}

describe('the always-run line, over the tests.alwaysRun files', () => {
  afterEach(() => setActiveOutput(null));

  it('names the default glob\'s tracked sweeps under src/, sorted, each prefixed ./', () => {
    const files = readAlwaysRunFiles(lsFiles(TRACKED), TESTS_DEFAULTS.testsAlwaysRun);

    expect(files).toEqual(['src/pr/conflict-sentence.sweep.test.ts', 'src/tests/repo-hygiene.sweep.test.ts']);
    expect(alwaysRunLines(files)).toEqual([
      'Also run `bun test ./src/pr/conflict-sentence.sweep.test.ts ./src/tests/repo-hygiene.sweep.test.ts`: '
      + 'these are the `tests.alwaysRun` files, content sweeps no changed file selects.',
    ]);
  });

  it('gives no line and asks git nothing for an empty list', () => {
    const calls: string[][] = [];
    const lines = captured(() => {
      expect(alwaysRunLines(readAlwaysRunFiles(lsFiles(TRACKED, calls), []))).toEqual([]);
    });

    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('gives no line and prints nothing for a glob matching no tracked file', () => {
    const calls: string[][] = [];
    const lines = captured(() => {
      expect(alwaysRunLines(readAlwaysRunFiles(lsFiles(TRACKED, calls), ['src/**/*.nothing.test.ts']))).toEqual([]);
    });

    expect(calls).toEqual([['ls-files', '-z']]);
    expect(lines).toEqual([]);
  });

  it('names a file two globs match once', () => {
    expect(alwaysRunFiles(['src/**/*.sweep.test.ts', 'src/tests/*.ts'], TRACKED)).toEqual([
      'src/pr/conflict-sentence.sweep.test.ts',
      'src/tests/repo-hygiene.sweep.test.ts',
    ]);
  });

  it('single-quotes a path a shell would split, so the line stays one command', () => {
    expect(alwaysRunLines(['src/a b.sweep.test.ts', 'src/it\'s.sweep.test.ts']).join('\n')).toContain(
      'bun test \'./src/a b.sweep.test.ts\' \'./src/it\'\\\'\'s.sweep.test.ts\'`',
    );
  });

  it('warns and gives no line when git ls-files does not answer', () => {
    const failing: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });
    let files: readonly string[] = ['unset'];
    const lines = captured(() => {
      files = readAlwaysRunFiles(failing, TESTS_DEFAULTS.testsAlwaysRun);
    });

    expect(files).toEqual([]);
    expect(lines.join('')).toContain('git ls-files did not answer (fatal: not a git repository)');
  });
});
