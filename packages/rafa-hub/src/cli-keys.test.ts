/**
 * `rafa-hub login` and `rafa-hub keys` (`cli-keys.ts`): the argument
 * reading, the two answer sources (lines of input, and a terminal that
 * echoes no password), {@link runLogin} over a config file under the
 * case's temporary directory, and {@link runKeys} against the real key
 * routes (`openKeyRoutes`) behind the real basic login, both over the
 * keys file the case's config names, reached through a `fetch` that
 * hands each request to the routes in process. The login's keys file is
 * placed by the install record beside the config file, a fixture the
 * case writes, or by its defaults when the case writes none.
 *
 * Every case's answers are scripted: no case reads this process's
 * standard input, and no case reaches a network.
 */
import type { HubFetch, PromptAnswers } from './cli-keys.js';
import type { HubKeyStore } from './identity/key-store.js';
import type { HubLoginStore } from './identity/login-store.js';
import type { HubKeyRoutes } from './server-keys.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HUB_VERSION } from './bin.js';
import {
  HUB_URL_VARIABLE,
  isLoginCommand,
  keyLine,
  keysCommandOf,
  KEYS_USAGE,
  lineAnswers,
  runKeys,
  runLogin,
  terminalAnswers,
} from './cli-keys.js';
import { HUB_CONFIG_ENV } from './config.js';
import { keyDigest, keysFileName, openSqliteKeyStore } from './identity/key-store.js';
import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE, openSqliteLoginStore } from './identity/login-store.js';
import { INSTALL_RECORD_FILE } from './install-record.js';
import { openBasicLogin } from './login/basic.js';
import { openOAuthLogin } from './login/oauth.js';
import { openKeyRoutes } from './server-keys.js';

const HUB = 'http://hub.test';
const USER = 'ada';
const PASSWORD = 'correct horse battery staple';
const BOOT_VARIABLE = 'RAFA_HUB_CLI_BOOT_KEY';
const OAUTH_SECRET_VARIABLE = 'RAFA_HUB_CLI_OAUTH_SECRET';
const FIXED_NOW = new Date('2026-11-17T10:00:00.000Z');
const LATER = new Date('2026-11-17T11:30:00.000Z');
const PROJECT_ID = 'c'.repeat(40);

let root = '';
let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-cli-keys-')));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Where the case's lines go. */
const lines = { out: (line: string) => out.push(line), err: (line: string) => err.push(line) };

/** Every line the case printed, on either stream. */
function printed(): string {
  return [...out, ...err].join('\n');
}

/** Writes a hub config under the case's root holding `auth` (its lines under `auth:`), and answers the env naming it. */
function configEnv(auth = `    adapter: api-key\n    apiKeys: [${BOOT_VARIABLE}]\n`): Record<string, string> {
  const path = join(root, 'hub.yaml');
  writeFileSync(path, `hub:\n  repository: open-tomato/rafa\n  storePath: store/rafa-hub.sqlite\n  auth:\n${auth}`);
  return { [HUB_CONFIG_ENV]: path };
}

/** The keys file the case's config names with no install record: in the config file's directory, the default `dataDir`. */
function keysFile(): string {
  return keysFileName(root);
}

/** The keys file's old place, beside the case's `hub.storePath`. */
function oldKeysFile(): string {
  return join(root, 'store', 'rafa-hub.keys.sqlite');
}

/** Writes an install record beside the case's config file, `fields` over a valid one this hub wrote. */
function writeRecord(fields: Readonly<Record<string, unknown>> = {}): string {
  const path = join(root, INSTALL_RECORD_FILE);
  const record = { installVersion: 1, hub: HUB_VERSION, bun: Bun.version, dataDir: root, sqliteLibrary: null, models: [], ...fields };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

/** Sets a fixture login `user` in the keys file at `path`, creating its directory. */
async function seedLogin(path: string, user: string): Promise<void> {
  mkdirSync(join(path, '..'), { recursive: true });
  const store = openSqliteLoginStore({ path });
  try {
    await store.setLogin(user, 'seeded password');
  } finally {
    store.close();
  }
}

/** Whether the keys file at `path` holds a login for `user` with {@link PASSWORD}. */
async function holdsLogin(path: string, user: string): Promise<boolean> {
  const store = openSqliteLoginStore({ path });
  try {
    return await store.verifyLogin(user, PASSWORD);
  } finally {
    store.close();
  }
}

/** Answers scripted as `answers`, at a terminal or not, counting each question asked. */
function scripted(answers: readonly string[], terminal = false): PromptAnswers & { readonly asked: string[] } {
  const asked: string[] = [];
  let next = 0;
  return {
    terminal,
    asked,
    ask: (question) => {
      asked.push(question);
      const answer = answers[next] ?? null;
      next += 1;
      return Promise.resolve(answer);
    },
    close: () => undefined,
  };
}

describe('keysCommandOf', () => {
  it.each([
    [['list'], { subcommand: 'list', name: null, hub: null }],
    [['create', 'ci'], { subcommand: 'create', name: 'ci', hub: null }],
    [['pause', 'ci', '--hub=https://hub.example.org'], { subcommand: 'pause', name: 'ci', hub: 'https://hub.example.org' }],
    [['--hub=http://127.0.0.1:7373', 'delete', 'ci'], { subcommand: 'delete', name: 'ci', hub: 'http://127.0.0.1:7373' }],
  ] as const)('reads %p', (args, command) => {
    expect(keysCommandOf(args)).toEqual(command);
  });

  it.each([
    [[]],
    [['show']],
    [['list', 'ci']],
    [['create']],
    [['create', 'ci', 'laptop']],
    [['pause', 'ci', '--hub']],
    [['pause', 'ci', '--hub=']],
    [['pause', 'ci', '--url=https://hub.example.org']],
    [['list', '--hub=https://a.example.org', '--hub=https://b.example.org']],
  ] as const)('refuses %p', (args) => {
    expect(keysCommandOf(args)).toBeNull();
  });
});

describe('isLoginCommand', () => {
  it('reads login alone, and nothing past it', () => {
    expect(isLoginCommand(['login'])).toBe(true);
    expect(isLoginCommand(['login', 'ada'])).toBe(false);
    expect(isLoginCommand(['keys'])).toBe(false);
  });
});

describe('lineAnswers', () => {
  it('answers one line per question, CRLF or LF, then null, reading its input once', async () => {
    let reads = 0;
    const answers = lineAnswers(() => {
      reads += 1;
      return Promise.resolve('ada\r\nsecret\n');
    });

    expect(answers.terminal).toBe(false);
    expect(await answers.ask('user: ', false)).toBe('ada');
    expect(await answers.ask('password: ', true)).toBe('secret');
    expect(await answers.ask('password again: ', true)).toBeNull();
    expect(reads).toBe(1);
  });

  it('keeps an empty line as an answer, so an empty password reaches the store\'s refusal', async () => {
    const answers = lineAnswers(() => Promise.resolve('ada\n\n'));
    expect(await answers.ask('user: ', false)).toBe('ada');
    expect(await answers.ask('password: ', true)).toBe('');
    expect(await answers.ask('again: ', true)).toBeNull();
  });
});

describe('terminalAnswers', () => {
  /** A terminal over two in-process streams, its output collected as text. */
  function terminal(): { readonly input: PassThrough; readonly shown: () => string; readonly answers: PromptAnswers } {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    return { input, shown: () => chunks.join(''), answers: terminalAnswers(input, output) };
  }

  /** What readline writes as it redraws its line: clear from the cursor down. */
  const CLEAR_DOWN = '\u001b[0J';

  it('echoes the user name beside its question, which a redraw keeps, and nothing of a hidden answer but the question', async () => {
    const { input, shown, answers } = terminal();

    const user = answers.ask('user: ', false);
    input.write('ada\r');
    expect(await user).toBe('ada');
    const password = answers.ask('password: ', true);
    input.write('s3cr3t-typed\r');
    expect(await password).toBe('s3cr3t-typed');
    answers.close();

    expect(answers.terminal).toBe(true);
    const typed = shown().slice(0, shown().indexOf('ada'));
    const redrawn = typed.slice(Math.max(0, typed.lastIndexOf(CLEAR_DOWN)));
    expect(redrawn).toContain('user: ');
    expect(shown()).toContain('ada');
    expect(shown()).toContain('password: ');
    expect(shown()).not.toContain('s3cr3t');
  });

  it('answers null once the input ends, and for every question after', async () => {
    const { input, answers } = terminal();

    const user = answers.ask('user: ', false);
    input.end();
    expect(await user).toBeNull();
    expect(await answers.ask('password: ', true)).toBeNull();
  });
});

describe('runLogin', () => {
  /** Opens the login store the case's config names, for reading back. */
  function loginStore(): HubLoginStore {
    return openSqliteLoginStore({ path: keysFile() });
  }

  it('sets the login from two lines of input in the keys file in the config file\'s directory when there is no install record', async () => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runLogin(configEnv(), HUB_VERSION, { ...lines, answers, now: () => FIXED_NOW });

    expect(code).toBe(0);
    expect(answers.asked).toEqual(['user: ', 'password: ']);
    expect(out).toEqual([`rafa-hub login: the login is set for ${USER}, in ${keysFile()}`]);
    expect(err).toEqual([]);
    const store = loginStore();
    try {
      expect(await store.verifyLogin(USER, PASSWORD)).toBe(true);
    } finally {
      store.close();
    }
    expect(existsSync(oldKeysFile())).toBe(false);
    expect(printed()).not.toContain(PASSWORD);
  });

  it('sets the login in the keys file in the install record\'s dataDir, creating its directory', async () => {
    const env = configEnv();
    const dataDir = join(root, 'data', 'hub');
    writeRecord({ dataDir });

    const code = await runLogin(env, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) });

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([`rafa-hub login: the login is set for ${USER}, in ${keysFileName(dataDir)}`]);
    expect(await holdsLogin(keysFileName(dataDir), USER)).toBe(true);
    expect(existsSync(keysFile())).toBe(false);
  });

  it('sets the login in a keys file found beside hub.storePath alone, with one warning line naming the new place', async () => {
    const env = configEnv();
    await seedLogin(oldKeysFile(), 'seeded');

    const code = await runLogin(env, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) });

    expect(code).toBe(0);
    expect(err).toEqual([`rafa-hub login: ${oldKeysFile()}: the keys file is found beside hub.storePath alone, so it is opened there for this release; its place is now ${keysFile()}, in the install record's dataDir: move it there before the next release`]);
    expect(out).toEqual([`rafa-hub login: the login is now ${USER}, replacing the one set before, in ${oldKeysFile()}`]);
    expect(await holdsLogin(oldKeysFile(), USER)).toBe(true);
    expect(existsSync(keysFile())).toBe(false);
  });

  it('sets the login in dataDir, with no warning, when both places hold a keys file', async () => {
    const env = configEnv();
    await seedLogin(oldKeysFile(), 'seeded');
    await seedLogin(keysFile(), 'seeded');

    const code = await runLogin(env, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) });

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(await holdsLogin(keysFile(), USER)).toBe(true);
    expect(await holdsLogin(oldKeysFile(), USER)).toBe(false);
  });

  it('refuses an install record another hub version wrote before asking anything, in one line naming run rafa-hub install', async () => {
    const env = configEnv();
    const path = writeRecord({ hub: '0.0.0-other' });
    const answers = scripted([USER, PASSWORD]);

    const code = await runLogin(env, HUB_VERSION, { ...lines, answers });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(err).toEqual([`rafa-hub login: the install record was refused: ${path}: written by hub 0.0.0-other, and this hub is ${HUB_VERSION}; run rafa-hub install`]);
    expect(existsSync(keysFile())).toBe(false);
  });

  it('asks the password twice at a terminal, and says it replaced a login set before', async () => {
    const env = configEnv();
    expect(await runLogin(env, HUB_VERSION, { ...lines, answers: scripted([USER, 'first password']) })).toBe(0);
    out = [];
    const answers = scripted(['grace', PASSWORD, PASSWORD], true);

    const code = await runLogin(env, HUB_VERSION, { ...lines, answers });

    expect(code).toBe(0);
    expect(answers.asked).toEqual(['user: ', 'password: ', 'password again: ']);
    expect(out).toEqual([`rafa-hub login: the login is now grace, replacing the one set before, in ${keysFile()}`]);
    const store = loginStore();
    try {
      expect(await store.verifyLogin('grace', PASSWORD)).toBe(true);
      expect(await store.verifyLogin(USER, 'first password')).toBe(false);
    } finally {
      store.close();
    }
  });

  it('sets nothing when the two passwords typed at a terminal differ, opening no keys file', async () => {
    const code = await runLogin(configEnv(), HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD, 'another password'], true) });

    expect(code).toBe(1);
    expect(err).toEqual(['rafa-hub login: the two passwords differ; nothing was set']);
    expect(existsSync(keysFile())).toBe(false);
    expect(printed()).not.toContain(PASSWORD);
  });

  it.each([
    ['the input ends before the password', [USER], 'the input ended before the user name and password; nothing was set'],
    ['the user name holds a colon', ['ada:lovelace', PASSWORD], 'a login\'s user name holds no ":", which Authorization: Basic could not carry; nothing was set'],
    ['the password is empty', [USER, ''], 'a login\'s password is not empty; nothing was set'],
  ] as const)('exits 1 with one line when %s', async (_why, typed, line) => {
    const code = await runLogin(configEnv(), HUB_VERSION, { ...lines, answers: scripted(typed) });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([`rafa-hub login: ${line}`]);
  });

  it.each([
    ['github', '    adapter: github\n', 'the login exists only under hub.auth.adapter: api-key, and this hub\'s is github'],
    [
      'an oauth login',
      `    adapter: api-key\n    apiKeys: [${BOOT_VARIABLE}]\n    login:\n      mode: oauth\n      oauth:\n        authorizeUrl: https://id.example.org/authorize\n        tokenUrl: https://id.example.org/token\n        userUrl: https://id.example.org/user\n        clientId: rafa-hub\n        clientSecretVariable: ${OAUTH_SECRET_VARIABLE}\n        allowed: ['583231']\n`,
      'hub.auth.login.mode is oauth, so the login is the OAuth provider\'s: sign in at the hub\'s /login page',
    ],
  ] as const)('refuses a hub under %s before asking anything', async (_why, auth, line) => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runLogin(configEnv(auth), HUB_VERSION, { ...lines, answers });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(err).toEqual([`rafa-hub login: ${line}`]);
    expect(existsSync(keysFile())).toBe(false);
  });

  it('refuses a config the reader refuses, in one line naming its problem', async () => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runLogin({ [HUB_CONFIG_ENV]: join(root, 'absent.yaml') }, HUB_VERSION, { ...lines, answers });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toStartWith('rafa-hub login: the config was refused: ');
    expect(err[0]).toContain('could not be read');
  });

  it('writes the keys file in dataDir under hub.projects, beside neither listed project\'s store', async () => {
    const path = join(root, 'hub.yaml');
    writeFileSync(path, [
      'hub:',
      '  projects:',
      `    - id: ${PROJECT_ID}`,
      '      name: first',
      '      repository: open-tomato/first',
      '      storePath: first/rafa-hub.sqlite',
      `    - id: ${'d'.repeat(40)}`,
      '      name: second',
      '      repository: open-tomato/second',
      '      storePath: second/rafa-hub.sqlite',
      '  auth:',
      '    adapter: api-key',
      `    apiKeys: [${BOOT_VARIABLE}]`,
      '',
    ].join('\n'));

    const code = await runLogin({ [HUB_CONFIG_ENV]: path }, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) });

    expect(code).toBe(0);
    expect(existsSync(keysFile())).toBe(true);
    expect(existsSync(join(root, 'first', 'rafa-hub.keys.sqlite'))).toBe(false);
    expect(existsSync(join(root, 'second', 'rafa-hub.keys.sqlite'))).toBe(false);
  });

  it('opens the old place beside the first listed project\'s store alone under hub.projects, never the second\'s', async () => {
    const path = join(root, 'hub.yaml');
    writeFileSync(path, [
      'hub:',
      '  projects:',
      `    - id: ${PROJECT_ID}`,
      '      name: first',
      '      repository: open-tomato/first',
      '      storePath: first/rafa-hub.sqlite',
      `    - id: ${'d'.repeat(40)}`,
      '      name: second',
      '      repository: open-tomato/second',
      '      storePath: second/rafa-hub.sqlite',
      '  auth:',
      '    adapter: api-key',
      `    apiKeys: [${BOOT_VARIABLE}]`,
      '',
    ].join('\n'));
    const first = join(root, 'first', 'rafa-hub.keys.sqlite');
    const second = join(root, 'second', 'rafa-hub.keys.sqlite');
    await seedLogin(second, 'seeded');

    expect(await runLogin({ [HUB_CONFIG_ENV]: path }, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) })).toBe(0);
    expect(err).toEqual([]);
    expect(await holdsLogin(keysFile(), USER)).toBe(true);

    rmSync(keysFile());
    err = [];
    await seedLogin(first, 'seeded');
    expect(await runLogin({ [HUB_CONFIG_ENV]: path }, HUB_VERSION, { ...lines, answers: scripted([USER, PASSWORD]) })).toBe(0);
    expect(err).toHaveLength(1);
    expect(err[0]).toStartWith(`rafa-hub login: ${first}: the keys file is found beside hub.storePath alone`);
    expect(await holdsLogin(first, USER)).toBe(true);
    expect(await holdsLogin(second, USER)).toBe(false);
  });
});

describe('runKeys', () => {
  let keys: HubKeyStore;
  let login: HubLoginStore;
  let sent: Request[];
  let clock: Date;

  beforeEach(async () => {
    clock = FIXED_NOW;
    mkdirSync(join(root, 'store'));
    keys = openSqliteKeyStore({ path: keysFile(), now: () => clock, reservedNames: [BOOT_VARIABLE.toLowerCase()] });
    login = openSqliteLoginStore({ path: keysFile() });
    await login.setLogin(USER, PASSWORD);
    sent = [];
  });

  afterEach(() => {
    keys.close();
    login.close();
  });

  /** A `fetch` handing each request to `routes`, keeping each for its method, URL and headers (its body is the routes'). */
  function through(routes: HubKeyRoutes): HubFetch {
    return async (request) => {
      sent.push(request);
      return (await routes.serve(request)).response;
    };
  }

  /** The key routes behind the basic login over the case's keys file. */
  function basicHub(): HubFetch {
    return through(openKeyRoutes({ login: openBasicLogin({ store: login }), store: keys, log: () => undefined }));
  }

  /** The env reaching {@link HUB} signed in as the login. */
  const signedIn = { [HUB_URL_VARIABLE]: HUB, [LOGIN_USER_VARIABLE]: USER, [LOGIN_PASSWORD_VARIABLE]: PASSWORD };

  it('creates a key, printing its plain key alone on standard output, the one the store serves by digest', async () => {
    const code = await runKeys(['create', 'ci'], signedIn, { ...lines, fetch: basicHub() });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const [plain = ''] = out;
    expect(plain).toMatch(/^rafa_[A-Za-z0-9_-]{43}$/);
    expect(await keys.findByDigest(keyDigest(plain))).toMatchObject({ name: 'ci', createdBy: USER });
    expect(err).toEqual(['rafa-hub keys create: ci created; its key is printed above this once, and the hub keeps only its digest']);
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([`POST ${HUB}/v1/keys`]);
    expect(printed()).not.toContain(PASSWORD);
  });

  it('lists every key with its state and last use, read back from a stamped request', async () => {
    await keys.create('ci', USER);
    await keys.create('laptop', USER);
    await keys.create('old', USER);
    clock = LATER;
    await keys.stampUse('ci');
    const hub = basicHub();
    expect(await runKeys(['pause', 'laptop'], signedIn, { ...lines, fetch: hub })).toBe(0);
    expect(await runKeys(['delete', 'old'], signedIn, { ...lines, fetch: hub })).toBe(0);
    expect(out).toEqual(['rafa-hub keys pause: laptop paused', 'rafa-hub keys delete: old deleted']);
    out = [];

    const code = await runKeys(['list'], signedIn, { ...lines, fetch: hub });

    expect(code).toBe(0);
    const created = `created ${FIXED_NOW.toISOString()} by ${USER}`;
    expect(out).toEqual([
      `ci\tactive\t${created}\tlast used ${LATER.toISOString()}`,
      `laptop\tpaused\t${created}\tlast used never`,
      `old\tdeleted\t${created}\tlast used never`,
    ]);
    expect(err).toEqual([]);
  });

  it('prints no line on standard output for a hub with no key, saying so on standard error', async () => {
    expect(await runKeys(['list'], signedIn, { ...lines, fetch: basicHub() })).toBe(0);
    expect(out).toEqual([]);
    expect(err).toEqual(['rafa-hub keys list: the hub holds no key']);
  });

  it('asks the user name and password only once the hub answers the basic challenge, then sends them', async () => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runKeys(['list', `--hub=${HUB}`], {}, { ...lines, answers, fetch: basicHub() });

    expect(code).toBe(0);
    expect(answers.asked).toEqual(['hub login user: ', 'hub login password: ']);
    expect(sent.map((request) => request.headers.has('authorization'))).toEqual([false, true]);
  });

  it('prints the hub\'s refusal for wrong credentials from the environment, asking nothing', async () => {
    const answers = scripted([USER, PASSWORD]);
    const env = { ...signedIn, [LOGIN_PASSWORD_VARIABLE]: 'wrong password' };

    const code = await runKeys(['create', 'ci'], env, { ...lines, answers, fetch: basicHub() });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(err).toEqual(['rafa-hub keys create: the hub answered 401: Sign in with the hub\'s login user name and password, as Authorization: Basic.']);
    expect(await keys.list()).toEqual([]);
    expect(printed()).not.toContain('wrong password');
  });

  it('exits 1 when the input ends before the asked credentials, sending nothing more', async () => {
    const code = await runKeys(['list'], { [HUB_URL_VARIABLE]: HUB }, { ...lines, answers: scripted([USER]), fetch: basicHub() });

    expect(code).toBe(1);
    expect(sent).toHaveLength(1);
    expect(err).toEqual(['rafa-hub keys list: the input ended before the hub login\'s user name and password']);
  });

  /** The key routes behind an OAuth login, which never answers the basic challenge. */
  function oauthHub(): HubFetch {
    const oauth = openOAuthLogin({
      config: {
        authorizeUrl: 'https://id.example.org/authorize',
        tokenUrl: 'https://id.example.org/token',
        userUrl: 'https://id.example.org/user',
        clientId: 'rafa-hub',
        clientSecretVariable: OAUTH_SECRET_VARIABLE,
        scope: null,
        callbackUrl: null,
        allowed: ['583231'],
      },
      env: { [OAUTH_SECRET_VARIABLE]: 'oauth-client-secret' },
    });
    return through(openKeyRoutes({ login: oauth, store: keys, log: () => undefined }));
  }

  it('points to the hub\'s /login page in one line under an OAuth login, asking nothing', async () => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runKeys(['create', 'ci', `--hub=${HUB}/`], signedIn, { ...lines, answers, fetch: oauthHub() });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(out).toEqual([]);
    expect(err).toEqual([`rafa-hub keys create: this hub signs in through OAuth, which the CLI does not; manage its keys at ${HUB}/login`]);
    expect(await keys.list()).toEqual([]);
  });

  it('asks no password of a person when the hub\'s login is OAuth and the environment holds none', async () => {
    const answers = scripted([USER, PASSWORD]);

    const code = await runKeys(['list'], { [HUB_URL_VARIABLE]: HUB }, { ...lines, answers, fetch: oauthHub() });

    expect(code).toBe(1);
    expect(answers.asked).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(err).toEqual([`rafa-hub keys list: this hub signs in through OAuth, which the CLI does not; manage its keys at ${HUB}/login`]);
  });

  it('prints the store\'s refusal for a key the hub does not hold', async () => {
    expect(await runKeys(['pause', 'absent'], signedIn, { ...lines, fetch: basicHub() })).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toStartWith('rafa-hub keys pause: the hub answered 404: ');
    expect(err[0]).toContain('absent');
  });

  it('refuses a name off KEY_NAME before sending anything, never repeating it', async () => {
    const pasted = 'rafa_PastedKeyValue0000000000000000000000000';

    const code = await runKeys(['create', pasted], signedIn, { ...lines, fetch: basicHub() });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(err).toEqual(['rafa-hub keys create: a key name is a lower-case letter or digit, then up to 63 of those, ".", "_" or "-"; nothing was sent']);
    expect(printed()).not.toContain(pasted);
  });

  it('reaches --hub over RAFA_HUB_URL, keeping a path prefix and dropping a trailing slash', async () => {
    const env = { ...signedIn, [HUB_URL_VARIABLE]: 'http://elsewhere.test' };
    const hub: HubFetch = (request) => {
      sent.push(request);
      return Promise.resolve(Response.json({ success: true, data: { keys: [] } }));
    };

    expect(await runKeys(['list', `--hub=${HUB}/rafa/`], env, { ...lines, fetch: hub })).toBe(0);
    expect(await runKeys(['list'], env, { ...lines, fetch: hub })).toBe(0);

    expect(sent.map((request) => request.url)).toEqual([`${HUB}/rafa/v1/keys`, 'http://elsewhere.test/v1/keys']);
  });

  it.each([
    ['no hub is named', {}, [], 'no hub to reach; pass --hub=<url> or set RAFA_HUB_URL'],
    ['RAFA_HUB_URL is not a URL', { [HUB_URL_VARIABLE]: 'hub.test' }, [], 'RAFA_HUB_URL is not a URL'],
    ['--hub holds a password', {}, ['--hub=https://ada:hunter2@hub.test'], '--hub is not an http or https URL free of a user, a password, a query and a fragment'],
    ['--hub is not http', {}, ['--hub=ftp://hub.test'], '--hub is not an http or https URL free of a user, a password, a query and a fragment'],
  ] as const)('exits 1 sending nothing when %s', async (_why, env, flags, line) => {
    const code = await runKeys(['list', ...flags], env, { ...lines, fetch: basicHub() });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(err).toEqual([`rafa-hub keys list: ${line}`]);
    expect(printed()).not.toContain('hunter2');
  });

  it('names the hub that did not answer', async () => {
    const down: HubFetch = () => Promise.reject(new TypeError('Unable to connect.\nIs the computer able to access the url?'));

    expect(await runKeys(['list'], signedIn, { ...lines, fetch: down })).toBe(1);
    expect(err).toEqual([`rafa-hub keys list: the hub at ${HUB} did not answer: Unable to connect.; Is the computer able to access the url?`]);
  });

  it('says the key routes exist only under api-key when the hub serves none', async () => {
    const github: HubFetch = () => Promise.resolve(Response.json({ success: false, error: 'No route serves /v1/keys.' }, { status: 404 }));

    expect(await runKeys(['list'], signedIn, { ...lines, fetch: github })).toBe(1);
    expect(err).toEqual(['rafa-hub keys list: the hub answered 404: No route serves /v1/keys. (the key routes exist only under hub.auth.adapter: api-key)']);
  });

  it('refuses an answer that is not the key routes\' JSON', async () => {
    const page: HubFetch = () => Promise.resolve(new Response('<html></html>', { status: 200 }));
    const shapeless: HubFetch = () => Promise.resolve(Response.json({ success: true, data: { keys: [{ name: 'ci' }] } }));

    expect(await runKeys(['list'], signedIn, { ...lines, fetch: page })).toBe(1);
    expect(await runKeys(['list'], signedIn, { ...lines, fetch: shapeless })).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      `rafa-hub keys list: the hub at ${HUB} answered 200, not with the key routes' JSON`,
      'rafa-hub keys list: the hub\'s answer is not the key routes\' answer; nothing was printed',
    ]);
  });

  it('refuses arguments naming no keys subcommand with its usage', async () => {
    expect(await runKeys(['show'], signedIn, { ...lines, fetch: basicHub() })).toBe(1);
    expect(sent).toEqual([]);
    expect(err).toEqual([`rafa-hub keys: usage: ${KEYS_USAGE}`]);
  });
});

describe('keyLine', () => {
  it('reads a deleted key as deleted even when it was paused first', () => {
    const key = { name: 'ci', createdBy: USER, createdAt: FIXED_NOW.toISOString(), lastUsedAt: null, paused: true, deleted: true };
    expect(keyLine(key).split('\t')[1]).toBe('deleted');
  });
});
