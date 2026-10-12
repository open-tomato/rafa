import { describe, expect, it } from 'bun:test';

import { PACKAGE_TREE, TREE_ROOT } from '../tests/package-tree.js';

import { firstProjectPath } from './stack-path.js';

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
});
