/**
 * `status()` and `sync()` of `createHubContact`
 * (`packages/rafa-effort/src/effort/sync/contact.ts`) through the REAL
 * `service` strategy (`packages/rafa-sync-service/src/sync.ts`) against
 * an in-process fake hub, the `Bun.serve` stand-in the strategy's own
 * tests use. No stub `Sync` stands in for the strategy; only its token
 * reader is replaced, so no secret store is read.
 *
 * What a command prints is the lines the contact warns, then the hub
 * line formatted from the reading's facts. The cases hold:
 *
 *   - the pull's own line (a projected pull's) comes first and the hub
 *     line second, so two lines at most per contact, for `status()` and
 *     for a whole `sync()`;
 *   - a pull with no line of its own leaves the hub line alone;
 *   - under a hub that is down, one line is written and no hub line
 *     follows, for `status()` and for `sync()`.
 *
 * Every device is a scratch git repository of this file's temporary
 * directory.
 */
import type { StandInHub } from '../../packages/rafa-sync-service/src/testdata/stand-in-hub.js';
import type { AdapterContext } from '@open-tomato/rafa/core/adapters';
import type { Sync } from '@open-tomato/rafa/ports';
import type { CommitEffortRow } from '@open-tomato/rafa/store';
import type { HubContactSeams, HubLineFacts } from '@open-tomato/rafa-effort/effort/sync/contact';

import '../config-registry.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { parseConfigText, resolveConfig } from '@open-tomato/rafa/core/config';
import { openSqliteStore } from '@open-tomato/rafa/store';
import { createHubContact, hubLine } from '@open-tomato/rafa-effort/effort/sync/contact';

import { createServiceSync } from '../../packages/rafa-sync-service/src/sync.js';
import { startStandInHub } from '../../packages/rafa-sync-service/src/testdata/stand-in-hub.js';

const TOKEN_SECRET = 'hub-token';
const FUTURE_MIGRATION = '9999-from-a-newer-rafa';
const HUB_LINE_PATTERN = /^hub: reachable, contract \S+, project \S+; pulled \d+ rows/u;

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-contact-service-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let hubs: StandInHub[] = [];

afterEach(async () => {
  await Promise.all(hubs.map((started) => started.stop()));
  hubs = [];
});

/** A stand-in hub, stopped after the case. */
function hub(): StandInHub {
  const started = startStandInHub();
  hubs = [...hubs, started];
  return started;
}

/** Runs git in `cwd`, failing the case when it fails. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
  const ran = Bun.spawnSync(['git', '-c', 'user.name=rafa-test', '-c', 'user.email=rafa-test@example.invalid', ...args], { cwd, env });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`);
}

let devices = 0;

/** A scratch repository whose store holds one commit row of its own. */
function device(): string {
  devices += 1;
  const root = realpathSync(mkdtempSync(join(scope, `device-${String(devices)}-`)));
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'root');
  const sha = new Bun.CryptoHasher('sha1')
    .update(`commit-${String(devices)}`)
    .digest('hex');
  openSqliteStore(root).append('commits', [{ sha, timestamp: '2026-10-01T08:00:00.000Z' } as CommitEffortRow]);
  return root;
}

/** The project config naming `service` and `over`, under `pull-projected`. */
function configText(over: StandInHub): string {
  return `effort:\n  sync: service\n  syncSkew: pull-projected\nhub:\n  url: ${over.url}\n`;
}

/** What one contact wrote and read. */
interface Contacting {
  readonly lines: string[];
  readonly contact: ReturnType<typeof createHubContact>;
}

/** A contact at `root` over the real `service` strategy for `over`, its warnings captured. */
function contacting(root: string, over: StandInHub): Contacting {
  const lines: string[] = [];
  const create = (context: AdapterContext): Sync => createServiceSync({
    repoRoot: context.repoRoot,
    backend: 'sqlite',
    hub: { url: over.url, tokenSecret: TOKEN_SECRET, timeoutMs: 2000, syncSkew: 'pull-projected' },
    readSecret: async () => 'ghp_contact_service_test_token',
  });
  const adapters = createAdapterRegistry([{ port: 'sync', kind: 'service', portVersion: PORT_VERSIONS.sync, create }]);
  const seams: HubContactSeams = { modules: { adapters, manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } } };
  const resolved = resolveConfig({ cli: {}, file: parseConfigText(configText(over), join(root, '.rafa', 'config.yaml')), user: null });
  const contact = createHubContact({
    root,
    home: join(scope, 'home'),
    resolved,
    warn: (line) => {
      lines.push(line);
    },
  }, seams);
  return { lines, contact };
}

/** A hub one migration ahead, projecting `commits`, holding one row of another device's. */
async function aheadHub(): Promise<StandInHub> {
  const over = hub();
  const other = contacting(device(), over);
  await other.contact.pushThenPull();
  over.setExtraMigrations([FUTURE_MIGRATION]);
  over.setProjection({ commits: [FUTURE_MIGRATION] }, { commits: ['future_a', 'future_b'] });
  return over;
}

/** The lines a command prints: what the contact warned, then the hub line when facts came. */
function printed(lines: readonly string[], facts: HubLineFacts | null): string[] {
  return facts === null
    ? [...lines]
    : [...lines, hubLine(facts)];
}

const PROJECTED_LINE = 'effort sync: pulled 1 rows projected to this rafa\'s schema; 2 columns wait for rafa self-update';

describe('status() and sync() through the real service strategy', () => {
  it('status() writes the projected pull\'s line first, the hub line second, and no third', async () => {
    const over = await aheadHub();
    const { lines, contact } = contacting(device(), over);

    const reading = await contact.status();

    if (reading.state !== 'contacted' || reading.hub.outcome !== 'done') throw new Error(`no hub facts: ${JSON.stringify(reading)}`);
    const out = printed(lines, reading.hub.result);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(PROJECTED_LINE);
    expect(out[1]).toMatch(HUB_LINE_PATTERN);
    expect(out[1]).toEndWith('; 1 rows held back');
  });

  it('a whole sync() holds the same order and count', async () => {
    const over = await aheadHub();
    const { lines, contact } = contacting(device(), over);

    const reading = await contact.sync();

    if (reading.state !== 'contacted' || reading.hub.outcome !== 'done') throw new Error(`no hub facts: ${JSON.stringify(reading)}`);
    const out = printed(lines, reading.hub.result);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(PROJECTED_LINE);
    expect(out[1]).toMatch(HUB_LINE_PATTERN);
  });

  it('leaves the hub line alone when the pull has no line of its own', async () => {
    const over = hub();
    await contacting(device(), over).contact.pushThenPull();
    const { lines, contact } = contacting(device(), over);

    const reading = await contact.status();

    if (reading.state !== 'contacted' || reading.hub.outcome !== 'done') throw new Error(`no hub facts: ${JSON.stringify(reading)}`);
    expect(lines).toEqual([]);
    expect(printed(lines, reading.hub.result)).toHaveLength(1);
    expect(hubLine(reading.hub.result)).toMatch(HUB_LINE_PATTERN);
  });

  it('writes one line and no hub line under a hub that is down, for status() and for sync()', async () => {
    const over = hub();
    const root = device();
    await over.stop();

    const asked = contacting(root, over);
    const status = await asked.contact.status();
    expect(asked.lines).toHaveLength(1);
    expect(asked.lines[0]).toContain('is unreachable');
    expect(status.state === 'contacted' && status.hub.outcome).toBe('skipped');

    const synced = contacting(root, over);
    const sync = await synced.contact.sync();
    expect(synced.lines).toHaveLength(1);
    expect(synced.lines[0]).toContain('is unreachable');
    expect(sync.state === 'contacted' && sync.hub.outcome).toBe('skipped');
  });
});
