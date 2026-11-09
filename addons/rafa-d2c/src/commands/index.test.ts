/**
 * The module seam: the manifest reads clean, and every command the entry
 * exports is one the dispatcher would mount.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { commandProblem } from '../../../../packages/rafa/src/core/command/index.js';
import { RUNNING_MANIFEST_SEAMS, validateManifest } from '../../../../packages/rafa/src/modules/manifest.js';

import commands from './index.js';

const PACKAGE_FILE = join(import.meta.dir, '..', '..', 'package.json');

describe('the rafa-d2c module seam', () => {
  it('manifest validates', async () => {
    const manifest = (await Bun.file(PACKAGE_FILE).json()) as { rafa: unknown };
    const validation = validateManifest(manifest.rafa, 'rafa', RUNNING_MANIFEST_SEAMS);
    expect(validation).toMatchObject({ ok: true });
    if (validation.ok) expect(validation.manifest.types).toEqual(['commands']);
  });

  it('every command passes the shape check', () => {
    for (const command of commands) {
      expect(commandProblem(command)).toBeNull();
      expect(command.subject).toBe('visual');
      expect(command.needsProject).toBe(false);
    }
  });

  it('actions are unique', () => {
    const actions = commands.map((command) => command.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
