/**
 * The module seam: the manifest in `package.json` reads clean against the
 * running rafa, its entry is this folder's `index.ts`, and every command
 * the entry exports is one the dispatcher would mount, `build` and `serve`
 * placed in a project and `describe` in none. The control shows the
 * manifest check can fail: a manifest naming no entry is refused.
 */
import { join } from 'node:path';

import { commandProblem } from '@open-tomato/rafa-core/core/command';
import { RUNNING_MANIFEST_SEAMS, validateManifest } from '@open-tomato/rafa-core/modules/manifest';
import { describe, expect, it } from 'bun:test';

import commands from './index.js';

const PACKAGE_FILE = join(import.meta.dir, '..', '..', 'package.json');

/** The `rafa` key of this package's manifest. */
async function manifestKey(): Promise<Record<string, unknown>> {
  return ((await Bun.file(PACKAGE_FILE).json()) as { rafa: Record<string, unknown> }).rafa;
}

describe('the rafa-atlas module seam', () => {
  it('manifest validates, naming this folder\'s entry', async () => {
    const validation = validateManifest(await manifestKey(), 'rafa', RUNNING_MANIFEST_SEAMS);

    expect(validation).toMatchObject({ ok: true });
    if (validation.ok) expect(validation.manifest.types).toEqual(['commands']);
    expect(await manifestKey()).toHaveProperty(['provides', 'commands', 'entry'], './src/commands/index.ts');
  });

  it('control: a manifest naming no commands entry is refused', async () => {
    const validation = validateManifest({ ...(await manifestKey()), provides: {} }, 'rafa', RUNNING_MANIFEST_SEAMS);

    expect(validation).toMatchObject({ ok: false });
  });

  it('exports build, serve and describe, each passing the shape check', () => {
    expect(commands.map((command) => command.action)).toEqual(['build', 'serve', 'describe']);
    for (const command of commands) {
      expect(commandProblem(command)).toBeNull();
      expect(command.subject).toBe('atlas');
    }
  });

  it('places build and serve in a project, and describe, which opens no replica, in none', () => {
    expect(commands.map((command) => [command.action, command.needsProject])).toEqual([
      ['build', true],
      ['serve', true],
      ['describe', false],
    ]);
  });
});
