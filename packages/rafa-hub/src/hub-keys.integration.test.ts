/**
 * The hub's login and keys wired whole, under `hub.auth.adapter:
 * api-key` over a scratch config: {@link runLogin} sets the login in
 * the keys file, {@link runHub} serves over it, and `rafa-hub keys`
 * ({@link runKeys}) drives the key routes over real HTTP, all in this
 * process and never past the temporary directory. `bin.test.ts`,
 * `cli-keys.test.ts`, `server-keys.test.ts` and `identity/api-key.test.ts`
 * cover each half alone; this file is the seam between them.
 *
 * One case walks a key's life, every step through the command or HTTP
 * and never the store:
 *
 *   1. `rafa-hub login` reads the user and the password from two lines
 *      of standard input, as a script drives it.
 *   2. `rafa-hub keys create` prints the plain key, alone on standard
 *      output; `rafa-hub keys list` then shows it `active`, last used
 *      `never`.
 *   3. A push with the key as its bearer adds a row and stamps the key's
 *      use; `rafa-hub keys list` and the key page (`GET /login`) both
 *      read that same last use back.
 *   4. `rafa-hub keys pause` makes the next push `403`, its error naming
 *      the key; the list says `paused` and the last use did not move.
 *   5. `rafa-hub keys delete` makes the next push `401`, naming nothing
 *      the request carried; the list and the page say `deleted`.
 *   6. Every line the hub logged, and every line the commands printed
 *      besides the one `create` prints the key on, is scanned for the
 *      key's value and the password, in the clear and as the base64 an
 *      `Authorization: Basic` header carries it.
 *
 * `hub.port` refuses `0`, so the hub listens on a port the system handed
 * a probe server a moment before.
 */
import type { HubLogEntry, HubServer } from './server.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runHub } from './bin.js';
import { lineAnswers, runKeys, runLogin } from './cli-keys.js';
import { HUB_CONFIG_ENV } from './config.js';
import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE } from './identity/login-store.js';
import { HUB_ROUTES } from './server.js';

const REPOSITORY = 'open-tomato/rafa';
const KEY_NAME = 'laptop';
const LOGIN_USER = 'ada';
const LOGIN_PASSWORD = 'hub keys integration password 0001';
const DEVICE = 'cccccccc-0000-4000-8000-00000000000c';
const CONTRACT_VERSION = 1;

/** The variable `hub.auth.apiKeys` names, which holds no value this file reads back. */
const ENV_KEY_VARIABLE = 'RAFA_HUB_KEYS_INTEGRATION_KEY';
const ENV_KEY_VALUE = 'hub-keys-integration-env-key-0000000001';

/** How long the whole walk may take: one login, a hub, nine commands and four pushes. */
const CASE_TIMEOUT_MS = 60_000;

let root = '';
let server: HubServer | null = null;
let logged: HubLogEntry[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-keys-')));
  logged = [];
});

afterEach(async () => {
  await server?.stop();
  server = null;
  rmSync(root, { recursive: true, force: true });
});

/** A port the system just handed out, free again. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/** Writes the scratch hub config under `api-key` with its store under the case's root; answers its path. */
function writeConfig(port: number): string {
  const path = join(root, 'hub.yaml');
  writeFileSync(path, [
    'hub:',
    `  repository: ${REPOSITORY}`,
    `  port: ${String(port)}`,
    '  storePath: store/rafa-hub.sqlite',
    '  auth:',
    '    adapter: api-key',
    '    apiKeys:',
    `      - ${ENV_KEY_VARIABLE}`,
    '',
  ].join('\n'));
  return path;
}

/** What one command printed, line by line. */
interface Printed {
  readonly out: string[];
  readonly err: string[];
}

/** A sink for a command's lines. */
function printing(): Printed & { readonly options: { readonly out: (line: string) => void; readonly err: (line: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    options: {
      out: (line) => {
        out.push(line);
      },
      err: (line) => {
        err.push(line);
      },
    },
  };
}

/** A fixture device's export of one commit, as a device would push it, its row given {@link DEVICE} as its origin. */
function devicePayload(): WirePayload {
  const directory = mkdtempSync(join(root, 'device-'));
  const store = openSqliteStore(directory);
  store.append('commits', [{
    sha: 'e'.repeat(40),
    timestamp: '2026-11-09T10:00:00.000Z',
    subject: 'a commit pushed with a store key',
  } as never]);
  const exported = exportWirePayload({ path: store.path('commits') });
  const rows = (exported.tables['commits'] ?? []).map((row, at) => ({ ...row, origin_store: DEVICE, origin_seq: at + 1 }));
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: exported.migrations, tables: { commits: rows }, cursor: {} };
}

/** The envelope a hub answer holds. */
interface Envelope {
  readonly success: boolean;
  readonly data?: { readonly added?: number };
  readonly error?: string;
}

/** Pushes the fixture commit as `device` with `bearer`; answers the status and the envelope. */
async function push(hub: HubServer, bearer: string): Promise<{ readonly status: number; readonly body: Envelope }> {
  const response = await fetch(`${hub.url}${HUB_ROUTES.push}?device=${DEVICE}&contractVersion=${String(CONTRACT_VERSION)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: encodeWirePayload(devicePayload()),
  });
  return { status: response.status, body: await response.json() as Envelope };
}

/** The `Authorization: Basic` header value for the login. */
function basicHeader(): string {
  return `Basic ${Buffer.from(`${LOGIN_USER}:${LOGIN_PASSWORD}`).toString('base64')}`;
}

/** The key page's text, fetched with the login's basic credentials. */
async function keyPage(hub: HubServer): Promise<string> {
  const response = await fetch(`${hub.url}/login`, { headers: { authorization: basicHeader() } });
  expect(response.status).toBe(200);
  return await response.text();
}

/** The row of the key page that names `name`, or an empty string. */
function pageRowOf(page: string, name: string): string {
  return page.split('\n').find((line) => line.includes(`<td>${name}</td>`)) ?? '';
}

/**
 * The page's last use in `row`: its row holds the creation time in one
 * `<time>` cell and the last use in a second, which a key never used
 * lacks (it reads "never"); null for "never".
 */
function pageLastUse(row: string): string | null {
  const times = [...row.matchAll(/<time datetime="([^"]+)">/g)].map((found) => found[1] ?? '');
  return times.length >= 2
    ? times.at(-1) ?? null
    : null;
}

/** The last use a `rafa-hub keys list` line for `name` reports, `never` or an ISO time. */
function listLastUse(lines: readonly string[], name: string): string {
  const line = lines.find((candidate) => candidate.startsWith(`${name}\t`)) ?? '';
  const [, , , used = ''] = line.split('\t');
  return used.replace('last used ', '');
}

describe('the hub login and keys, wired whole under hub.auth.adapter api-key', () => {
  it('walks a key from creation to deletion over the CLI, the routes and the page, and logs neither the key nor the password', async () => {
    const config = writeConfig(await freePort());
    const hubEnv = { [HUB_CONFIG_ENV]: config, [ENV_KEY_VARIABLE]: ENV_KEY_VALUE };
    const cliEnv = { RAFA_HUB_URL: '', [LOGIN_USER_VARIABLE]: LOGIN_USER, [LOGIN_PASSWORD_VARIABLE]: LOGIN_PASSWORD };
    const commands: Printed[] = [];
    const run = async (args: readonly string[], env: Readonly<Record<string, string>> = cliEnv): Promise<{ readonly code: number; readonly printed: Printed }> => {
      const printed = printing();
      commands.push(printed);
      const code = await runKeys(args, { ...env, RAFA_HUB_URL: server?.url ?? '' }, printed.options);
      return { code, printed };
    };

    // 1. The login, from two lines of standard input.
    const login = printing();
    commands.push(login);
    const loggedIn = await runLogin(hubEnv, { ...login.options, answers: lineAnswers(() => Promise.resolve(`${LOGIN_USER}\n${LOGIN_PASSWORD}\n`)) });
    expect(loggedIn).toBe(0);
    expect(login.out).toHaveLength(1);
    expect(login.out[0]).toContain(`the login is set for ${LOGIN_USER}`);

    const started = await runHub(hubEnv, { log: (entry) => {
      logged.push(entry);
    }, hostname: '127.0.0.1', githubApi: 'http://127.0.0.1:9' });
    if (started === null) throw new Error(`the hub refused its config: ${JSON.stringify(logged)}`);
    server = started;
    const hub = started;
    expect(logged.some((entry) => entry.event === 'login.set')).toBe(false);

    // 2. Create a key; it is listed active and never used. The first list asks for the login at the prompt.
    const created = await run(['create', KEY_NAME]);
    expect(created.code).toBe(0);
    expect(created.printed.out).toHaveLength(1);
    const plain = created.printed.out[0] ?? '';
    expect(plain).toMatch(/^rafa_[A-Za-z0-9_-]{43}$/);

    const promptList = printing();
    commands.push(promptList);
    const prompted = await runKeys(['list'], { RAFA_HUB_URL: hub.url }, { ...promptList.options, answers: lineAnswers(() => Promise.resolve(`${LOGIN_USER}\n${LOGIN_PASSWORD}\n`)) });
    expect(prompted).toBe(0);
    expect(promptList.out).toHaveLength(1);
    expect(promptList.out[0]).toContain(`${KEY_NAME}\tactive\t`);
    expect(listLastUse(promptList.out, KEY_NAME)).toBe('never');
    expect(pageLastUse(pageRowOf(await keyPage(hub), KEY_NAME))).toBeNull();

    // 3. Push with the key; its last use is read back from the list and the page.
    const pushed = await push(hub, plain);
    expect(pushed.status).toBe(200);
    expect(pushed.body.data?.added).toBe(1);

    const afterPush = await run(['list']);
    expect(afterPush.code).toBe(0);
    const lastUse = listLastUse(afterPush.printed.out, KEY_NAME);
    expect(lastUse).not.toBe('never');
    expect(Number.isNaN(Date.parse(lastUse))).toBe(false);
    expect(pageLastUse(pageRowOf(await keyPage(hub), KEY_NAME))).toBe(lastUse);

    // 4. Pause it; the next push is forbidden, naming the key, and the last use stands.
    const paused = await run(['pause', KEY_NAME]);
    expect(paused.code).toBe(0);
    expect(paused.printed.out).toEqual([`rafa-hub keys pause: ${KEY_NAME} paused`]);
    const forbidden = await push(hub, plain);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.success).toBe(false);
    expect(forbidden.body.error).toContain(KEY_NAME);

    const afterPause = await run(['list']);
    expect(afterPause.printed.out).toHaveLength(1);
    expect(afterPause.printed.out[0]).toContain(`${KEY_NAME}\tpaused\t`);
    expect(listLastUse(afterPause.printed.out, KEY_NAME)).toBe(lastUse);

    // 5. Delete it; the next push is unauthenticated, naming nothing, and the list and the page say deleted.
    const deleted = await run(['delete', KEY_NAME]);
    expect(deleted.code).toBe(0);
    expect(deleted.printed.out).toEqual([`rafa-hub keys delete: ${KEY_NAME} deleted`]);
    const unauthenticated = await push(hub, plain);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.success).toBe(false);
    expect(unauthenticated.body.error ?? '').not.toContain(KEY_NAME);
    expect(unauthenticated.body.error ?? '').not.toContain(plain);

    const afterDelete = await run(['list']);
    expect(afterDelete.printed.out).toHaveLength(1);
    expect(afterDelete.printed.out[0]).toContain(`${KEY_NAME}\tdeleted\t`);
    expect(listLastUse(afterDelete.printed.out, KEY_NAME)).toBe(lastUse);
    const deletedRow = pageRowOf(await keyPage(hub), KEY_NAME);
    expect(deletedRow).toContain('<td>deleted</td>');
    expect(deletedRow).not.toContain('data-action=');

    // 6. No captured line holds the key or the password, in the clear or as the Basic header's base64.
    const everyLine = [
      ...logged.map((entry) => JSON.stringify(entry)),
      ...commands.flatMap((printed) => printed.err),
      ...commands.flatMap((printed) => printed.out.filter((line) => line !== plain)),
    ];
    const basic = basicHeader().replace('Basic ', '');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.some((entry) => entry.event === 'key.created')).toBe(true);
    for (const line of everyLine) {
      expect(line).not.toContain(plain);
      expect(line).not.toContain(LOGIN_PASSWORD);
      expect(line).not.toContain(basic);
      expect(line).not.toContain(ENV_KEY_VALUE);
    }
    expect(commands.flatMap((printed) => printed.out).filter((line) => line === plain)).toHaveLength(1);
  }, CASE_TIMEOUT_MS);
});
