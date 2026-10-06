/**
 * Tests for `./secrets-env.js`: the carried bus variables, and the
 * spawned probe answering false under an environment that reaches no
 * secret store. The probe's child reader is shown answering true for a
 * child that prints what it was asked to, so its false is no reader that
 * cannot say anything else.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from './scratch-home-env.js';
import { probeSecrets, runProbeChild, secretsChildEnv, secretsEnv } from './secrets-env.js';

/** A session bus address naming a socket under a fresh scratch folder, which nothing listens on. */
function deadBusAddress(scratch: string): string {
  return `unix:path=${join(scratch, 'no-such-bus')}`;
}

describe('secretsEnv', () => {
  it('carries both bus variables the source holds and nothing else', () => {
    const source = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus', XDG_RUNTIME_DIR: '/run/user/1', PATH: '/bin' };

    expect(secretsEnv(source)).toEqual({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus', XDG_RUNTIME_DIR: '/run/user/1' });
  });

  it('leaves out a bus variable the source lacks rather than setting it empty', () => {
    expect(secretsEnv({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' })).toEqual({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' });
    expect(secretsEnv({})).toEqual({});
  });
});

describe('secretsChildEnv', () => {
  it('sets the bus variables beside the scratch HOME variables', () => {
    const home = join('/scratch', 'device', 'home');
    const source = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' };

    expect(secretsChildEnv(home, source)).toEqual({ ...scratchHomeEnv(home), DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' });
  });
});

describe('runProbeChild', () => {
  it('answers true for a child that exits 0 having printed the expected value', async () => {
    expect(await runProbeChild('process.stdout.write(\'probe-value\');', 'probe-value', {})).toBe(true);
  });

  it('answers false for a child that exits 0 having printed something else', async () => {
    expect(await runProbeChild('process.stdout.write(\'other\');', 'probe-value', {})).toBe(false);
  });

  it('answers false for a child that printed the value and exited non-zero', async () => {
    expect(await runProbeChild('process.stdout.write(\'probe-value\'); process.exit(3);', 'probe-value', {})).toBe(false);
  });
});

describe('probeSecrets', () => {
  let scratch = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'secrets-env-test-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('answers false on macOS without spawning a child, whatever the source holds', async () => {
    let spawned = 0;
    const spawnProbe = async (): Promise<boolean> => {
      spawned += 1;
      return true;
    };

    expect(await probeSecrets(process.env, { platform: 'darwin', spawnProbe })).toBe(false);
    expect(spawned).toBe(0);
  });

  it('spawns the probe child on Linux, answering what it answers', async () => {
    let spawned = 0;
    const spawnProbe = async (): Promise<boolean> => {
      spawned += 1;
      return true;
    };

    expect(await probeSecrets({}, { platform: 'linux', spawnProbe })).toBe(true);
    expect(spawned).toBe(1);
  });

  it('answers false when the session bus names a socket that does not exist and no runtime dir is set', async () => {
    const source = { DBUS_SESSION_BUS_ADDRESS: deadBusAddress(scratch) };

    expect(await probeSecrets(source)).toBe(false);
  });
});
