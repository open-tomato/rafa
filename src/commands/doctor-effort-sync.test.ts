/**
 * The `effort sync` row of `rafa doctor` (`./doctor-effort-sync.ts`),
 * read in-process over configs parsed from text as a project's
 * `.rafa/config.yaml` would hold them.
 *
 * Each failure sits beside the reading that makes it pass: `git` with no
 * module fails, and the same `git` with the `sync-fixture` module under
 * `src/modules/testdata/` on `modules:` and `allowList:` passes as a
 * module's, so the row's failure is the missing module and not the kind.
 * The same `modules:` line without `allowList:` fails again, so the
 * module is loaded through the config and not found some other way.
 *
 * Every root is a path under this file's temporary directory that is
 * never made, and the cases that read one hold it absent after, so the
 * row is read as touching no disk.
 */
import type { ResolvedConfig } from '../config.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { PORT_VERSIONS } from '../adapters/registry.js';
import { parseConfigText, resolveConfig } from '../config.js';
import { readDoctorEffortSync } from '../effort/sync/doctor-reading.js';
import { MODULE_SYNC_STRATEGIES } from '../effort/sync/select.js';

import { effortSyncRefusal, renderDoctorEffortSync } from './doctor-effort-sync.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-effort-sync-')));
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

/** Reads the row for a config holding `lines`. */
async function rowOf(lines: readonly string[]): ReturnType<typeof readDoctorEffortSync> {
  return readDoctorEffortSync({ root: ROOT, home: HOME, resolved: resolvedOf(lines) }, SEAMS);
}

describe('a strategy core serves', () => {
  it('passes as local for a project naming no effort.sync, printing one row and no refusal', async () => {
    const reading = await rowOf([]);

    expect(reading).toEqual({ outcome: 'ok', strategy: 'local', source: 'core', missingModule: false, problem: null });
    expect(renderDoctorEffortSync(reading)).toEqual(['Effort sync: ok, local']);
    expect(effortSyncRefusal(reading)).toBeNull();
    expect(existsSync(ROOT)).toBe(false);
  });

  it('passes as file for a project naming it, touching no disk', async () => {
    const reading = await rowOf(syncLines('file'));

    expect(reading.outcome).toBe('ok');
    expect(reading.source).toBe('core');
    expect(renderDoctorEffortSync(reading)).toEqual(['Effort sync: ok, file']);
    expect(existsSync(ROOT)).toBe(false);
  });
});

describe('a strategy a module brings', () => {
  it.each(MODULE_SYNC_STRATEGIES.map((kind) => [kind]))(
    'fails for %s with no module, naming the kind and the modules: and allowList: lines',
    async (kind) => {
      const reading = await rowOf(syncLines(kind));
      const refusal = effortSyncRefusal(reading);

      expect(reading.outcome).toBe('fail');
      expect(reading.missingModule).toBe(true);
      expect(reading.source).toBeNull();
      expect(reading.problem).toStartWith(`effort.sync is "${kind}", and no module registers a sync adapter`);
      expect(reading.problem).toContain('\nmodules:\n');
      expect(reading.problem).toContain('\nallowList:\n');
      expect(refusal).toStartWith(`rafa doctor: effort sync: effort.sync is "${kind}"`);
      expect(refusal).not.toContain('effort sync: effort sync:');
      expect(existsSync(ROOT)).toBe(false);
    },
  );

  it('renders a failure as its row and each line of the problem indented under it', async () => {
    const reading = await rowOf(syncLines('git'));
    const rendered = renderDoctorEffortSync(reading);

    expect(rendered[0]).toBe('Effort sync: fail, git');
    const problemLines = String(reading.problem).split('\n');

    expect(rendered.slice(1)).toEqual(problemLines.map((line) => `  ${line}`));
    expect(rendered).toContain('  modules:');
    expect(rendered).toContain('  allowList:');
  });

  it('passes for git as a module\'s once a module providing it is on modules: and allowList:', async () => {
    const reading = await rowOf([...syncLines('git'), ...fixtureLines(true)]);

    expect(reading).toEqual({ outcome: 'ok', strategy: 'git', source: 'module', missingModule: false, problem: null });
    expect(renderDoctorEffortSync(reading)).toEqual(['Effort sync: ok, git (module)']);
    expect(effortSyncRefusal(reading)).toBeNull();
  });

  it('fails for git again when the module is on modules: alone, with no allowList: line', async () => {
    const reading = await rowOf([...syncLines('git'), ...fixtureLines(false)]);

    expect(reading.outcome).toBe('fail');
    expect(reading.missingModule).toBe(true);
  });
});

describe('a kind no strategy names', () => {
  it('fails a hand-built config\'s kind with selectSync\'s words, without a throw and without a module line', async () => {
    const resolved = resolvedOf([]);
    const config = { ...resolved.config, effortSync: 'pigeon' } as unknown as ResolvedConfig['config'];

    const reading = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved: { ...resolved, config } }, SEAMS);

    expect(reading.outcome).toBe('fail');
    expect(reading.strategy).toBe('pigeon');
    expect(reading.missingModule).toBe(false);
    expect(reading.problem).toContain('expected one of: local, file, git, service, p2p');
    expect(reading.problem).not.toContain('allowList:');
    expect(effortSyncRefusal(reading)).toStartWith('rafa doctor: effort sync: effort.sync is "pigeon"');
  });
});
