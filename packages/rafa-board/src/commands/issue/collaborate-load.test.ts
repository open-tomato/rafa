/**
 * Load tests for `collaborate.rafa`: fixture `.rafa/config.yaml` files read
 * through `loadConfig`, the real loader, rather than the section's reader
 * alone. A key declared in the type but missing from the runtime schema is
 * stripped on load, so only a file read end to end shows the value survives.
 *
 * Negative cases come first: a malformed value is refused naming the key,
 * and an absent key reads as null. The accepting control follows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collaborateTarget } from '@open-tomato/rafa/config-schema-collaborate';
import { loadConfig } from '@open-tomato/rafa/core/config/load';
import { describe, expect, it } from 'bun:test';

/** Runs `body` with a fresh project root holding `yaml` as `.rafa/config.yaml`. */
async function withConfig<T>(yaml: string, body: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'rafa-collaborate-load-'));
  try {
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), yaml);
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Loads the project at `root` with no user home and no warning output. */
function load(root: string): ReturnType<typeof loadConfig> {
  return loadConfig({ root, home: join(root, 'no-such-home') }, {}, () => {});
}

describe('collaborate.rafa through loadConfig: refused when malformed', () => {
  const MALFORMED: readonly (readonly [string, string])[] = [
    ['a bare name', 'rafa'],
    ['a third part', 'open-tomato/rafa/x'],
    ['a space', '"open tomato/rafa"'],
    ['a blank string', '""'],
    ['a number', '42'],
    ['a list', '[open-tomato/rafa]'],
  ];

  for (const [label, value] of MALFORMED) {
    it(`refuses ${label}, naming collaborate.rafa`, async () => {
      await withConfig(`collaborate:\n  rafa: ${value}\n`, async (root) => {
        let message = '';
        try {
          await load(root);
        } catch (error) {
          message = error instanceof Error
            ? error.message
            : String(error);
        }
        expect(message).toContain('collaborate.rafa');
      });
    });
  }
});

describe('collaborate.rafa through loadConfig: absent', () => {
  it('reads as null when the file has no collaborate section', async () => {
    await withConfig('board:\n  project:\n    number: 3\n', async (root) => {
      const { config } = await load(root);
      expect(config.collaborateRafa).toBeNull();
      expect(collaborateTarget(config, 'rafa')).toBeNull();
    });
  });

  it('reads as null when there is no config file at all', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-collaborate-load-'));
    try {
      const { config } = await load(root);
      expect(config.collaborateRafa).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('collaborate.rafa through loadConfig: kept', () => {
  it('keeps open-tomato/rafa as written after loading, not stripped', async () => {
    await withConfig('collaborate:\n  rafa: open-tomato/rafa\n', async (root) => {
      const { config } = await load(root);
      expect(config.collaborateRafa).toBe('open-tomato/rafa');
      expect(collaborateTarget(config, 'rafa')).toBe('open-tomato/rafa');
    });
  });
});
