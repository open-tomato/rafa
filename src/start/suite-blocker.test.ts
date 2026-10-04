/**
 * Unit cases for the `bun test` paths {@link blockerText} writes: a
 * relative path gains `./` so bun reads it as a path, not a substring
 * filter, and an absolute one is written as it is.
 */
import type { SuiteFailure } from '../suite/run.js';

import { describe, expect, it } from 'bun:test';

import { blockerText, runnablePath } from './suite-blocker.js';

const verdict = (fresh: readonly SuiteFailure[], newErrors = 0) => ({ fresh, known: [], newErrors, unreported: false });

describe('runnablePath', () => {
  it('prefixes a relative path with ./ and leaves an absolute or ./-led one as it is', () => {
    expect(runnablePath('x.sweep.test.ts')).toBe('./x.sweep.test.ts');
    expect(runnablePath('src/a/x.test.ts')).toBe('./src/a/x.test.ts');
    expect(runnablePath('/abs/x.test.ts')).toBe('/abs/x.test.ts');
    expect(runnablePath('./x.test.ts')).toBe('./x.test.ts');
  });
});

describe('blockerText paths', () => {
  it('writes a nested failing file with ./ before it', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: 'src/a/b/x.sweep.test.ts', name: 'x > y' }]));
    expect(text).toContain('Run bun test ./src/a/b/x.sweep.test.ts and make them pass.');
  });

  it('writes an absolute failing file as it is', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: '/repo/src/x.test.ts', name: 'x > y' }]));
    expect(text).toContain('Run bun test /repo/src/x.test.ts and make them pass.');
    expect(text).not.toContain('./repo');
  });

  it('writes the files of errors outside any test the same way', () => {
    const unhandled = [{ file: 'src/a/boom.test.ts', firstLine: 'Error: x' }, { file: '/abs/boom.test.ts', firstLine: null }];
    const text = blockerText('stage step', { exitCode: 1, unhandled }, verdict([], 2));
    expect(text).toContain('Run bun test ./src/a/boom.test.ts /abs/boom.test.ts and make each load.');
  });
});
