import { describe, expect, it } from 'bun:test';

import { firstProjectPath } from '@open-tomato/rafa/bugs/stack-path';

import { PACKAGE_TREE, TREE_ROOT } from '../../package-tree.js';

/**
 * The spec's one-second bound on a crafted text: the old path pattern,
 * tried from every character of a long run, took about 0.8 s on each
 * shape below and stopped at the regex engine's match limit, answering
 * no path at all.
 */
const REDOS_BOUND_MS = 1000;

/** Characters in each crafted run, about the 50,000 of the plan's slow shape. */
const CRAFTED_RUN = 50_000;

describe('the first file of the project a text names', () => {
  it('reads the file of a stack frame, relative to the root', () => {
    expect(firstProjectPath('TypeError: x\n    at run (/repo/packages/hub/src/deep/b.ts:10:5)', TREE_ROOT, PACKAGE_TREE))
      .toBe('packages/hub/src/deep/b.ts');
  });

  it('passes over a dependency\'s frame and one outside the project', () => {
    const stack = [
      '    at dep (/repo/node_modules/dep/index.js:1:1)',
      '    at far (/elsewhere/x.ts:2:2)',
      '    at near (/repo/src/a.ts:3:1)',
    ].join('\n');
    expect(firstProjectPath(stack, TREE_ROOT, PACKAGE_TREE)).toBe('src/a.ts');
  });

  it('reads a relative path and a file URL', () => {
    expect(firstProjectPath('error at src/a.ts:3:1', TREE_ROOT, PACKAGE_TREE)).toBe('src/a.ts');
    expect(firstProjectPath('at file:///repo/src/a.ts:3:1', TREE_ROOT, PACKAGE_TREE)).toBe('src/a.ts');
  });

  it('passes over a path that is not there', () => {
    expect(firstProjectPath('error at src/gone.ts:3:1, then src/a.ts', TREE_ROOT, PACKAGE_TREE)).toBe('src/a.ts');
  });

  it('answers null for a text naming no file of the project', () => {
    expect(firstProjectPath('TypeError: x is not a function', TREE_ROOT, PACKAGE_TREE)).toBeNull();
    expect(firstProjectPath('', TREE_ROOT, PACKAGE_TREE)).toBeNull();
  });

  it('reads the path after a long run of path characters, within REDOS_BOUND_MS', () => {
    const plusRun = `${'+'.repeat(CRAFTED_RUN)} src/a.ts:3:1`;
    const stepRun = `${'a/'.repeat(CRAFTED_RUN / 2)} src/a.ts:3:1`;

    const started = performance.now();
    const afterPlus = firstProjectPath(plusRun, TREE_ROOT, PACKAGE_TREE);
    const afterSteps = firstProjectPath(stepRun, TREE_ROOT, PACKAGE_TREE);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(afterPlus).toBe('src/a.ts');
    expect(afterSteps).toBe('src/a.ts');
  });
});
