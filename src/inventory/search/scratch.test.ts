import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { parseSearchBlock } from './block.js';
import { createScratchCopy, SCRATCH_PREFIX, withScratchCopy } from './scratch.js';

let home: string;
let root: string;
let skillPath: string;
let agentPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'rafa-scratch-test-'));
  root = join(home, 'run');
  mkdirSync(root);
  mkdirSync(join(home, 'skills', 'documentation'), { recursive: true });
  skillPath = join(home, 'skills', 'documentation', 'SKILL.md');
  writeFileSync(skillPath, 'Every exported symbol carries a TSDoc block\n');
  writeFileSync(join(home, 'skills', 'documentation', 'extra.md'), 'not copied\n');
  agentPath = join(home, 'reviewer.md');
  writeFileSync(agentPath, 'Reviews code\n');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const candidates = (): { name: string; path: string }[] => [
  { name: 'documentation', path: skillPath },
  { name: 'reviewer', path: agentPath },
];

describe('createScratchCopy', () => {
  test('copies each file, and only it, under a fresh directory in the root', () => {
    const scratch = createScratchCopy(candidates(), root);
    expect(readdirSync(root)).toEqual([scratch.dir.slice(root.length + 1)]);
    expect(scratch.dir.startsWith(join(root, SCRATCH_PREFIX))).toBe(true);
    expect(scratch.paths.get('documentation')).toBe(join(scratch.dir, 'documentation', 'SKILL.md'));
    expect(readFileSync(scratch.paths.get('reviewer') ?? '', 'utf8')).toBe('Reviews code\n');
    expect(readdirSync(join(scratch.dir, 'documentation'))).toEqual(['SKILL.md']);
    scratch.remove();
    expect(existsSync(scratch.dir)).toBe(false);
    scratch.remove();
  });

  test('defaults the root to the temp directory', () => {
    const scratch = createScratchCopy(candidates());
    try {
      expect(scratch.dir.startsWith(join(tmpdir(), SCRATCH_PREFIX))).toBe(true);
    } finally {
      scratch.remove();
    }
  });

  test.each(['', '.', '..', 'a/b', 'a\\b'])('refuses the name %p before making anything', (name) => {
    expect(() => createScratchCopy([{ name, path: agentPath }], root)).toThrow('Cannot copy candidate');
    expect(readdirSync(root)).toEqual([]);
  });

  test('refuses a repeated name', () => {
    expect(() => createScratchCopy([...candidates(), { name: 'reviewer', path: skillPath }], root))
      .toThrow('Two candidates are named \'reviewer\'');
    expect(readdirSync(root)).toEqual([]);
  });

  test('removes a partial copy when a file does not read', () => {
    const missing = [...candidates(), { name: 'ghost', path: join(home, 'ghost.md') }];
    expect(() => createScratchCopy(missing, root)).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('withScratchCopy', () => {
  test('removes the copy after a good answer and returns the body\'s value', async () => {
    let seen = '';
    const result = await withScratchCopy(candidates(), (scratch) => {
      seen = scratch.dir;
      expect(existsSync(scratch.paths.get('documentation') ?? '')).toBe(true);
      return 'answer';
    }, root);
    expect(result).toBe('answer');
    expect(seen).not.toBe('');
    expect(existsSync(seen)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  test('removes the copy when the body rejects', async () => {
    let seen = '';
    const run = withScratchCopy(candidates(), async (scratch) => {
      seen = scratch.dir;
      await Promise.resolve();
      throw new Error('session failed');
    }, root);
    await expect(run).rejects.toThrow('session failed');
    expect(existsSync(seen)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  test('removes the copy on a malformed answer', async () => {
    const output = '```rafa:search\nmatches: [oops\n```\n';
    let seen = '';
    const reading = await withScratchCopy(candidates(), (scratch) => {
      seen = scratch.dir;
      return parseSearchBlock(output, ['documentation', 'reviewer']);
    }, root);
    expect(reading.present).toBe(false);
    expect(existsSync(seen)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});
