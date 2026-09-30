/**
 * The sync-strategy check of the loop preflight (`./preflight-sync.ts`),
 * read in-process over configs parsed from text as a project's
 * `.rafa/config.yaml` would hold them. How `runStartPreflight` orders it
 * ahead of every probe is `preflight.test.ts`'s.
 *
 * Each refusal sits beside the reading that lets the run through: `git`
 * with no module refuses, and the same `git` with the `sync-fixture`
 * module under `src/modules/testdata/` on `modules:` and `allowList:`
 * passes, so the refusal is the missing module and not the kind. The
 * same `modules:` line without `allowList:` refuses again, so the module
 * is loaded through the config and not found some other way.
 *
 * Every root is a path under this file's temporary directory that is
 * never made, and the cases that read one hold it absent after, so the
 * check is read as touching no disk.
 */
import type { ResolvedConfig } from '../config.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { PORT_VERSIONS } from '../adapters/registry.js';
import { CommandExit } from '../cli/command.js';
import { parseConfigText, resolveConfig } from '../config.js';
import { MODULE_SYNC_STRATEGIES } from '../effort/sync/select.js';

import { refuseUnservedSync } from './preflight-sync.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-start-preflight-sync-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A project root under the temporary directory, never made. */
const ROOT = join(tempBase, 'project');

/** A home under the temporary directory, never made. */
const HOME = join(tempBase, 'home');

/** The module whose `git` sync adapter the passing control loads. */
const FIXTURE_MODULE = fileURLToPath(new URL('../modules/testdata/sync-fixture', import.meta.url));

/** The manifest seams the fixture module is held to, as `select.test.ts` holds it. */
const SEAMS = { syncModules: { manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } } };

/** The config a project's `.rafa/config.yaml` holding `lines` resolves to. */
function resolvedOf(lines: readonly string[]): ResolvedConfig {
  const file = parseConfigText(['version: 1', ...lines, ''].join('\n'), join(ROOT, '.rafa', 'config.yaml'));
  return resolveConfig({ cli: {}, file, user: null });
}

/**
 * Config lines naming `kind` as `effort.sync`, with the `hub.url` the
 * config refuses a `service` sync without, so the module check is reached.
 */
function syncLines(kind: string): string[] {
  const hub = kind === 'service'
    ? ['hub:', '  url: https://hub.example.org']
    : [];
  return ['effort:', `  sync: ${kind}`, ...hub];
}

/** Config lines loading the fixture module, with or without its `allowList:` line. */
function fixtureLines(allowed: boolean): string[] {
  const modules = ['modules:', `  - path: ${FIXTURE_MODULE}`];
  return allowed
    ? [...modules, 'allowList:', '  - sync-fixture']
    : modules;
}

/** The check over a config holding `lines`: what it answered, or what it threw. */
async function checkOf(lines: readonly string[]): Promise<{
  readonly passed: Awaited<ReturnType<typeof refuseUnservedSync>> | null;
  readonly refusal: CommandExit | null;
}> {
  try {
    const passed = await refuseUnservedSync(ROOT, { resolved: resolvedOf(lines), home: HOME, seams: SEAMS });
    return { passed, refusal: null };
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return { passed: null, refusal: error };
  }
}

describe('a strategy core serves', () => {
  it('lets a project naming no effort.sync through as local, touching no disk', async () => {
    const { passed, refusal } = await checkOf([]);

    expect(refusal).toBeNull();
    expect(passed?.strategy).toBe('local');
    expect(passed?.source).toBe('core');
    expect(existsSync(ROOT)).toBe(false);
  });

  it('lets a project naming file through', async () => {
    const { passed, refusal } = await checkOf(syncLines('file'));

    expect(refusal).toBeNull();
    expect(passed?.strategy).toBe('file');
    expect(existsSync(ROOT)).toBe(false);
  });
});

describe('a strategy a module brings', () => {
  it.each(MODULE_SYNC_STRATEGIES.map((kind) => [kind]))(
    'refuses %s with no module, exit 1, naming the kind and the modules: and allowList: lines',
    async (kind) => {
      const { passed, refusal } = await checkOf(syncLines(kind));

      expect(passed).toBeNull();
      expect(refusal?.exitCode).toBe(1);
      expect(refusal?.message).toStartWith('❌ Refusing to start: effort.sync names a strategy no adapter serves.\n');
      expect(refusal?.message).toContain(`   effort.sync is "${kind}", and no module registers a sync adapter`);
      expect(refusal?.message).toContain('\n   modules:\n     - path: <module directory>\n');
      expect(refusal?.message).toContain('\n   allowList:\n     - <module name>\n');
      expect(refusal?.message).toEndWith('\n   Nothing was checked and nothing was dispatched.');
      expect(existsSync(ROOT)).toBe(false);
    },
  );

  it('words the git refusal as the module note shows it', async () => {
    const { refusal } = await checkOf(syncLines('git'));

    expect(refusal?.message).toBe([
      '❌ Refusing to start: effort.sync names a strategy no adapter serves.',
      '   effort.sync is "git", and no module registers a sync adapter of that kind (registered: local, file).'
        + ' Core ships no git strategy; load a module that provides one with these lines in .rafa/config.yaml:',
      '   modules:',
      '     - path: <module directory>',
      '   allowList:',
      '     - <module name>',
      '   Nothing was checked and nothing was dispatched.',
    ].join('\n'));
  });

  it('lets git through as a module\'s once a module providing it is on modules: and allowList:', async () => {
    const { passed, refusal } = await checkOf([...syncLines('git'), ...fixtureLines(true)]);

    expect(refusal).toBeNull();
    expect(passed?.strategy).toBe('git');
    expect(passed?.source).toBe('module');
  });

  it('refuses git again when the module is on modules: but not on allowList:', async () => {
    const { passed, refusal } = await checkOf([...syncLines('git'), ...fixtureLines(false)]);

    expect(passed).toBeNull();
    expect(refusal?.exitCode).toBe(1);
    expect(refusal?.message).toContain('effort.sync is "git", and no module registers a sync adapter');
  });
});
