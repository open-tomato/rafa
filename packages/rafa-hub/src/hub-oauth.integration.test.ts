/**
 * The hub's OAuth login wired whole under `hub.auth.adapter: api-key`
 * with `hub.auth.login.mode: oauth`: {@link runHub} serves over a
 * scratch config, and the flow runs over real HTTP against a stand-in
 * provider (`login/testdata/stand-in-oauth.ts`) on a free loopback port,
 * never past the temporary directory. `login/oauth.test.ts` and
 * `server-login.test.ts` cover each half alone; this file is the seam.
 *
 *   - A stale state is refused: a callback naming a state the hub never
 *     issued, and one replayed after it was used, each answer `401`
 *     and ask the provider nothing.
 *   - A user outside `allowed` is refused `403`, the message naming the
 *     id, and gets no session cookie: the key routes still answer `401`.
 *   - An allowed user signs in, creates a key over the key routes with
 *     the session's cookie, and the key serves a pull; the session
 *     itself is refused on the pull route.
 *
 * `hub.port` refuses `0`, so the hub listens on a port the system handed
 * a probe server a moment before.
 */
import type { StandInOAuth } from './login/testdata/stand-in-oauth.js';
import type { HubLogEntry, HubServer } from './server.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { runHub } from './bin.js';
import { HUB_CONFIG_ENV } from './config.js';
import { OAUTH_SESSION_COOKIE } from './login/oauth.js';
import { startStandInOAuth } from './login/testdata/stand-in-oauth.js';
import { HUB_ROUTES } from './server.js';

const REPOSITORY = 'open-tomato/rafa';
const CLIENT_ID = 'rafa-hub-oauth-integration-client';
const CLIENT_SECRET = 'oauth-integration-client-secret-0001';
const SECRET_VARIABLE = 'RAFA_HUB_OAUTH_INTEGRATION_SECRET';
const ENV_KEY_VARIABLE = 'RAFA_HUB_OAUTH_INTEGRATION_KEY';
const ENV_KEY_VALUE = 'hub-oauth-integration-env-key-000000001';
const DEVICE = 'dddddddd-0000-4000-8000-00000000000d';
const CONTRACT_VERSION = 1;
const KEY_NAME = 'workstation';

/** The allowed user, numeric as GitHub's ids are. */
const ALLOWED = { id: 583231, login: 'ada' };

/** A user the provider knows and `allowed` does not list. */
const STRANGER = { id: 999001, login: 'mallory' };

/** How long the walk may take. */
const CASE_TIMEOUT_MS = 30_000;

let root = '';
let provider: StandInOAuth;
let server: HubServer | null = null;
let logged: HubLogEntry[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-oauth-')));
  provider = startStandInOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  logged = [];
});

afterEach(async () => {
  await server?.stop();
  server = null;
  await provider.stop();
  rmSync(root, { recursive: true, force: true });
});

/** A port the system just handed out, free again. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/**
 * Writes the scratch config under `oauth` and starts the hub over it,
 * making the store's directory, which the keys file in `dataDir` no
 * longer makes.
 */
async function startHub(): Promise<HubServer> {
  const path = join(root, 'hub.yaml');
  mkdirSync(join(root, 'store'), { recursive: true });
  writeFileSync(path, [
    'hub:',
    `  repository: ${REPOSITORY}`,
    `  port: ${String(await freePort())}`,
    '  storePath: store/rafa-hub.sqlite',
    '  auth:',
    '    adapter: api-key',
    '    apiKeys:',
    `      - ${ENV_KEY_VARIABLE}`,
    '    login:',
    '      mode: oauth',
    '      oauth:',
    `        authorizeUrl: ${provider.authorizeUrl}`,
    `        tokenUrl: ${provider.tokenUrl}`,
    `        userUrl: ${provider.userUrl}`,
    `        clientId: ${CLIENT_ID}`,
    `        clientSecretVariable: ${SECRET_VARIABLE}`,
    `        allowed: ['${String(ALLOWED.id)}']`,
    '',
  ].join('\n'));
  const env = { [HUB_CONFIG_ENV]: path, [SECRET_VARIABLE]: CLIENT_SECRET, [ENV_KEY_VARIABLE]: ENV_KEY_VALUE };
  const started = await runHub(env, { log: (entry) => {
    logged.push(entry);
  }, hostname: '127.0.0.1', githubApi: 'http://127.0.0.1:9' });
  if (started === null) throw new Error(`the hub refused its config: ${JSON.stringify(logged)}`);
  server = started;
  return started;
}

/** The state `GET /login/oauth/start` put on the authorize URL. */
async function startFlow(hub: HubServer): Promise<{ readonly state: string; readonly authorize: string }> {
  const response = await fetch(`${hub.url}/login/oauth/start`, { redirect: 'manual' });
  expect(response.status).toBe(303);
  const authorize = response.headers.get('location') ?? '';
  expect(authorize.startsWith(provider.authorizeUrl)).toBe(true);
  return { state: new URL(authorize).searchParams.get('state') ?? '', authorize };
}

/** What the provider's authorize step sends the person back to: the hub's callback URL. */
async function providerRedirect(authorize: string): Promise<string> {
  const response = await fetch(authorize, { redirect: 'manual' });
  expect(response.status).toBe(302);
  return response.headers.get('location') ?? '';
}

/** Runs the whole flow for the provider's signed-in user; answers the callback's response. */
async function signIn(hub: HubServer): Promise<Response> {
  const { authorize } = await startFlow(hub);
  return await fetch(await providerRedirect(authorize), { redirect: 'manual' });
}

/** The `Cookie` header value a callback's `Set-Cookie` carries. */
function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  expect(header.startsWith(`${OAUTH_SESSION_COOKIE}=`)).toBe(true);
  return header.split(';')[0] ?? '';
}

describe('the hub OAuth login, wired whole against a stand-in provider', () => {
  it('refuses a callback whose state is unknown or already used, asking the provider nothing', async () => {
    provider.signIn(ALLOWED);
    const hub = await startHub();

    const unknown = await fetch(`${hub.url}/login/oauth/callback?code=abc&state=never-issued`, { redirect: 'manual' });
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get('set-cookie')).toBeNull();

    const { authorize } = await startFlow(hub);
    const callbackUrl = await providerRedirect(authorize);
    const first = await fetch(callbackUrl, { redirect: 'manual' });
    expect(first.status).toBe(200);
    const asked = provider.asked().length;

    const replay = await fetch(callbackUrl, { redirect: 'manual' });
    expect(replay.status).toBe(401);
    expect(replay.headers.get('set-cookie')).toBeNull();
    expect(provider.asked()).toHaveLength(asked);
    expect(logged.filter((entry) => entry.event === 'login.refused')).toHaveLength(2);
  }, CASE_TIMEOUT_MS);

  it('refuses a user outside allowed, naming the id and giving no session', async () => {
    provider.signIn(STRANGER);
    const hub = await startHub();

    const refused = await signIn(hub);
    expect(refused.status).toBe(403);
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect(await refused.text()).toContain(String(STRANGER.id));

    const keys = await fetch(`${hub.url}/v1/keys`, { headers: { cookie: `${OAUTH_SESSION_COOKIE}=forged` } });
    expect(keys.status).toBe(401);
  }, CASE_TIMEOUT_MS);

  it('lets an allowed user create a key that serves a pull, which the session itself cannot', async () => {
    provider.signIn(ALLOWED);
    const hub = await startHub();

    const signedIn = await signIn(hub);
    expect(signedIn.status).toBe(200);
    const cookie = cookieOf(signedIn);
    expect(logged.some((entry) => entry.event === 'login.signed-in')).toBe(true);

    const created = await fetch(`${hub.url}/v1/keys`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: KEY_NAME }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { readonly data: { readonly plain: string } };
    const plain = body.data.plain;
    expect(plain).toMatch(/^rafa_[A-Za-z0-9_-]{43}$/);

    const pullPath = `${HUB_ROUTES.pull}?device=${DEVICE}&contractVersion=${String(CONTRACT_VERSION)}`;
    const pulled = await fetch(`${hub.url}${pullPath}`, { headers: { authorization: `Bearer ${plain}` } });
    expect(pulled.status).toBe(200);
    expect((await pulled.json() as { readonly success: boolean }).success).toBe(true);

    const withSession = await fetch(`${hub.url}${pullPath}`, { headers: { cookie } });
    expect(withSession.status).toBe(401);

    for (const entry of logged) {
      const line = JSON.stringify(entry);
      expect(line).not.toContain(plain);
      expect(line).not.toContain(CLIENT_SECRET);
    }
  }, CASE_TIMEOUT_MS);
});
