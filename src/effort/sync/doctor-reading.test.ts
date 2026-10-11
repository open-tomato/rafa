/**
 * Tests for the reading of whether `effort.sync` has an adapter
 * (`effort/sync/doctor-reading.ts`): what a caller outside
 * `src/commands/` reads off {@link readDoctorEffortSync}.
 *
 * The row `rafa doctor` prints for the reading and the text it exits 1
 * with are covered by `commands/doctor-effort-sync.test.ts`, which also
 * reads every module strategy; this file holds the reading alone.
 *
 * Each reading sits beside its control: `git` with no module fails and
 * the same `git` with the `sync-fixture` module under
 * `src/modules/testdata/` passes as a module's; and the problem a failing
 * reading carries is compared with the message `selectSync` throws for
 * the same config, which opens with the row's name, so the name is seen
 * to be taken off rather than never there.
 *
 * Every root is a path under this file's temporary directory that is
 * never made.
 */
import type { ResolvedConfig } from '../../config.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../../adapters/registry.js';
import { messageOf } from '../../config-sections.js';
import { parseConfigText, resolveConfig } from '../../config.js';

import { EFFORT_SYNC_ROW, readDoctorEffortSync } from './doctor-reading.js';
import { selectSync } from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-sync-reading-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A project root under the temporary directory, never made. */
const ROOT = join(tempBase, 'project');

/** A home under the temporary directory, never made. */
const HOME = join(tempBase, 'home');

/** The module whose `git` sync adapter the passing control loads. */
const FIXTURE_MODULE = fileURLToPath(new URL('../../modules/testdata/sync-fixture', import.meta.url));

/** The manifest seams the fixture module is held to, as `select.test.ts` holds it. */
const SEAMS = { syncModules: { manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } } };

/** Config lines naming `git` as `effort.sync`. */
const GIT_LINES = ['effort:', '  sync: git'];

/** Config lines loading and allowing the fixture module. */
const FIXTURE_LINES = ['modules:', `  - path: ${FIXTURE_MODULE}`, 'allowList:', '  - sync-fixture'];

/** The config a project's `.rafa/config.yaml` holding `lines` resolves to. */
function resolvedOf(lines: readonly string[]): ResolvedConfig {
  const file = parseConfigText(['version: 1', ...lines, ''].join('\n'), join(ROOT, '.rafa', 'config.yaml'));
  return resolveConfig({ cli: {}, file, user: null });
}

/** `resolved` with `kind` as its `effortSync`, as only a hand-built config can hold it. */
function withKind(resolved: ResolvedConfig, kind: unknown): ResolvedConfig {
  const config = { ...resolved.config, effortSync: kind } as unknown as ResolvedConfig['config'];
  return { ...resolved, config };
}

/** What `selectSync` throws for `resolved` over core's registry, as a message. */
function selectMessage(resolved: ResolvedConfig): string {
  try {
    selectSync(ROOT, resolved.config, CORE_ADAPTER_REGISTRY);
  } catch (error) {
    return messageOf(error);
  }
  throw new Error('selectSync did not throw');
}

describe('readDoctorEffortSync', () => {
  it('reads local as core\'s for a config naming no effort.sync, with no seams and no disk touched', async () => {
    const reading = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved: resolvedOf([]) });

    expect(reading).toEqual({ outcome: 'ok', strategy: 'local', source: 'core', missingModule: false, problem: null });
    expect(existsSync(ROOT)).toBe(false);
  });

  it('fails git with no module as a missing module, and passes it as a module\'s once one provides it', async () => {
    const missing = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved: resolvedOf(GIT_LINES) }, SEAMS);
    const served = await readDoctorEffortSync(
      { root: ROOT, home: HOME, resolved: resolvedOf([...GIT_LINES, ...FIXTURE_LINES]) },
      SEAMS,
    );

    expect(missing.outcome).toBe('fail');
    expect(missing.source).toBeNull();
    expect(missing.missingModule).toBe(true);
    expect(served).toEqual({ outcome: 'ok', strategy: 'git', source: 'module', missingModule: false, problem: null });
  });

  it('carries the problem without the row\'s name, which selectSync\'s own message opens with', async () => {
    const resolved = resolvedOf(GIT_LINES);
    const thrown = selectMessage(resolved);

    const reading = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved }, SEAMS);

    expect(thrown).toStartWith(`${EFFORT_SYNC_ROW}: `);
    expect(reading.problem).toBe(thrown.slice(`${EFFORT_SYNC_ROW}: `.length));
  });

  it('fails a kind no strategy names without a throw and without calling it a missing module', async () => {
    const resolved = withKind(resolvedOf([]), 'pigeon');

    const reading = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved }, SEAMS);

    expect(reading.outcome).toBe('fail');
    expect(reading.strategy).toBe('pigeon');
    expect(reading.missingModule).toBe(false);
    expect(reading.problem).toContain('expected one of: local, file, git, service, p2p');
  });

  it('names a kind that is no string by its description, and fails it', async () => {
    const resolved = withKind(resolvedOf([]), 42);

    const reading = await readDoctorEffortSync({ root: ROOT, home: HOME, resolved }, SEAMS);

    expect(reading.outcome).toBe('fail');
    expect(reading.strategy).not.toBe('');
    expect(reading.strategy).toContain('42');
    expect(reading.source).toBeNull();
  });
});
