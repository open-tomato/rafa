/**
 * Tests for the kept outlines (`src/refs/outline-cache.ts`): an outline
 * asked once per file content, a changed file outlined again, a null
 * answer never kept, and no outliner staying no outliner.
 *
 * The outliner is a planted function counting its calls; no case spawns
 * `ts-symbols`. The first case is the control: without a kept answer the
 * outliner is asked, which the later cases' "not asked" depends on.
 */
import type { SymbolOutliner } from './verify.js';

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { OUTLINE_CACHE_DIR, withOutlineCache } from './outline-cache.js';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-outline-cache-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An outliner answering `names` for every file, recording each file asked. */
function counting(names: readonly string[] | null): { outline: SymbolOutliner; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    outline: (file) => {
      asked.push(file);
      return Promise.resolve(names);
    },
  };
}

describe('withOutlineCache', () => {
  it('asks the outliner for a file it has kept nothing for, and answers what it said', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    const planted = counting(['a']);
    const outline = withOutlineCache(planted.outline, root);

    expect(await outline?.('a.ts')).toEqual(['a']);
    expect(planted.asked).toEqual(['a.ts']);
  });

  it('answers a file whose content is unchanged from what it kept, without asking again', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    const first = counting(['a']);
    await withOutlineCache(first.outline, root)?.('a.ts');
    const second = counting(['never asked']);

    expect(await withOutlineCache(second.outline, root)?.('a.ts')).toEqual(['a']);
    expect(second.asked).toEqual([]);
  });

  it('asks again once the file changed', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    await withOutlineCache(counting(['a']).outline, root)?.('a.ts');
    writeFileSync(join(root, 'a.ts'), 'export const b = 1;\n');
    const second = counting(['b']);

    expect(await withOutlineCache(second.outline, root)?.('a.ts')).toEqual(['b']);
    expect(second.asked).toEqual(['a.ts']);
  });

  it('keeps nothing for an outline that answered null', async () => {
    writeFileSync(join(root, 'a.ts'), 'not typescript at all');
    await withOutlineCache(counting(null).outline, root)?.('a.ts');
    const second = counting(['a']);
    await withOutlineCache(second.outline, root)?.('a.ts');

    expect(second.asked).toEqual(['a.ts']);
  });

  it('outlines a file it cannot read as if nothing were kept', async () => {
    const planted = counting(['x']);

    expect(await withOutlineCache(planted.outline, root)?.('missing.ts')).toEqual(['x']);
    expect(planted.asked).toEqual(['missing.ts']);
  });

  it('keeps one file per content under the versioned directory', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    await withOutlineCache(counting(['a']).outline, root)?.('a.ts');

    expect(readdirSync(join(root, OUTLINE_CACHE_DIR))).toHaveLength(1);
  });

  it('stays null with no outliner, so the grep answers alone as before', () => {
    expect(withOutlineCache(null, root)).toBeNull();
  });
});
