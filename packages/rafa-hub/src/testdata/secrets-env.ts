/**
 * The environment a spawned rafa CLI reaches `Bun.secrets` through, and a
 * probe that asks a child spawned under exactly that environment whether
 * it can: what `two-devices.integration.test.ts` and
 * `hub-unreachable.integration.test.ts` both gate on and spawn under.
 *
 * On Linux, a libsecret-backed `Bun.secrets` reaches the desktop secret
 * service over the session bus `DBUS_SESSION_BUS_ADDRESS` names (or the
 * one under `XDG_RUNTIME_DIR`), and a spawned process inherits neither
 * unless they are named in its own environment. {@link secretsEnv}
 * carries them from a source environment, `process.env` by default, and
 * {@link secretsChildEnv} sets them beside `scratchHomeEnv(home)`.
 *
 * A round trip in the test process says nothing about the child: the two
 * run under different environments. {@link probeSecrets} therefore spawns
 * one `bun -e` under {@link secretsChildEnv} with a scratch `HOME` of its
 * own, which sets, reads back and deletes a credential under a random
 * name, and answers true only when that child exits 0 having printed the
 * value it set. A suite computes it once at load; it costs one spawn.
 *
 * On macOS it answers false and spawns nothing. There `Bun.secrets` uses
 * the Keychain, which a child under a scratch `HOME` cannot reach: the
 * set opens a Keychain dialog on the person's screen and waits on it
 * until the probe's kill, so the hub suites skip there.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scratchHomeEnv } from './scratch-home-env.js';

/** The variables a libsecret-backed `Bun.secrets` reaches its session bus through. */
export const SECRET_BUS_ENV = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const;

/** Where every rafa secret lives (`packages/rafa-sync-service/src/token.ts`'s `SECRET_SERVICE`). */
const SECRET_SERVICE = 'rafa';

/** How long the probe child may take before it is killed, which reads as no secret store. */
const PROBE_TIMEOUT_MS = 10_000;

/** The source environment {@link secretsEnv} reads, `process.env`'s shape. */
export type SourceEnv = Readonly<Record<string, string | undefined>>;

/**
 * The {@link SECRET_BUS_ENV} variables `source` holds, carried as they
 * are; a variable `source` lacks is left out rather than set empty.
 */
export function secretsEnv(source: SourceEnv = process.env): Readonly<Record<string, string>> {
  return Object.fromEntries(SECRET_BUS_ENV
    .map((name): readonly [string, string | undefined] => [name, source[name]])
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

/**
 * The environment a spawned CLI reaches `Bun.secrets` under:
 * `scratchHomeEnv(home)` with {@link secretsEnv} of `source` beside it.
 */
export function secretsChildEnv(home: string, source: SourceEnv = process.env): Readonly<Record<string, string>> {
  return { ...scratchHomeEnv(home), ...secretsEnv(source) };
}

/**
 * Spawns `bun -e script` under `env` and answers true only when the
 * child exits 0 having printed exactly `expected` on stdout. The
 * mechanism {@link probeSecrets} reads its child through, exported so a
 * test can show it answers true at all.
 */
export async function runProbeChild(script: string, expected: string, env: Readonly<Record<string, string>>): Promise<boolean> {
  const child = Bun.spawn([process.execPath, '-e', script], {
    env,
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: PROBE_TIMEOUT_MS,
  });
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return exitCode === 0 && stdout === expected;
}

/** The `bun -e` script that sets, reads back, prints and deletes one credential. */
function roundTripScript(name: string, value: string): string {
  const probe = JSON.stringify({ service: SECRET_SERVICE, name });
  return [
    `const probe = ${probe};`,
    `await Bun.secrets.set({ ...probe, value: ${JSON.stringify(value)} });`,
    'try {',
    '  process.stdout.write((await Bun.secrets.get(probe)) ?? \'\');',
    '} finally {',
    '  await Bun.secrets.delete(probe).catch(() => false);',
    '}',
  ].join('\n');
}

/** What {@link probeSecrets} reads the host through, so a test can name another. */
export interface ProbeSeams {
  /** `process.platform`'s spelling. `process.platform` when absent. */
  readonly platform?: string;
  /** Spawns the probe child. {@link runProbeChild} when absent. */
  readonly spawnProbe?: typeof runProbeChild;
}

/**
 * Whether a child spawned under {@link secretsChildEnv} of `source`, with
 * a scratch `HOME`, can store a credential through `Bun.secrets` and read
 * it back; false on macOS with no child spawned. See the module note.
 */
export async function probeSecrets(source: SourceEnv = process.env, seams: ProbeSeams = {}): Promise<boolean> {
  if ((seams.platform ?? process.platform) === 'darwin') return false;
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-hub-secrets-probe-'));
  const value = randomUUID();
  try {
    const env = secretsChildEnv(join(scratch, 'home'), source);
    return await (seams.spawnProbe ?? runProbeChild)(roundTripScript(`secrets-probe-${randomUUID()}`, value), value, env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
