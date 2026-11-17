/**
 * The `rafa-hub login` and `rafa-hub keys` commands, which `bin.ts`
 * routes here: {@link runLogin} sets the hub's login, and {@link runKeys}
 * drives a hub's key routes (`server-keys.ts`) over HTTP.
 *
 * ## `rafa-hub login`
 *
 * Reads the hub's config from the file `RAFA_HUB_CONFIG` names and
 * writes the login into the keys file beside `hub.storePath` (the first
 * listed project's store when `hub.projects` is set), the file a hub
 * running over that config checks on its next request; no restart is
 * needed. At a terminal it is a questionnaire: the user name, then the
 * password twice, neither password echoed, and two that differ set
 * nothing. With standard input not a terminal it reads two lines, the
 * user name and the password, so a script or a test drives it.
 *
 * It refuses, setting nothing and exiting 1, a config the reader
 * refuses, a hub whose `hub.auth.adapter` is not `api-key` (no other
 * adapter has a login), a hub whose `hub.auth.login.mode` is `oauth`
 * (its login is the provider's), input that ends before the answers,
 * and a user name holding a colon, which `Authorization: Basic` could
 * never carry.
 *
 * ## `rafa-hub keys`
 *
 *   - `rafa-hub keys list`: one line per key, deleted ones included,
 *     its name, `active`, `paused` or `deleted`, who created it and
 *     when, and its last use (`never` when it has served nothing),
 *     separated by tabs.
 *   - `rafa-hub keys create <name>`: prints the plain key, the only time
 *     anyone sees it, alone on standard output.
 *   - `rafa-hub keys pause <name>` and `rafa-hub keys delete <name>`.
 *
 * Each reaches the hub at `--hub=<url>`, or at {@link HUB_URL_VARIABLE}
 * when the flag is left out, signing in with basic credentials from
 * `RAFA_HUB_LOGIN_USER` and `RAFA_HUB_LOGIN_PASSWORD` when both hold a
 * value. Otherwise it first asks without credentials, and asks the user
 * name and password (at a terminal, or as two lines of standard input)
 * only when the hub answers the basic challenge, so a hub that refuses
 * for another reason never makes a person type a password.
 *
 * A hub whose login is `oauth` answers `401` with no basic challenge;
 * the command then prints one line pointing to `<url>/login`, where the
 * provider signs a person in, and exits 1. Any other refusal prints the
 * hub's own one-line error and exits 1. A name off `KEY_NAME` is refused
 * before anything is sent, and the refusal never repeats it, since a
 * person may have pasted a key into it.
 *
 * No line either command prints holds a password; only
 * `rafa-hub keys create` prints a key, the one it created.
 */
import type { HubConfig } from './config.js';
import type { HubKey } from './identity/key-store.js';
import type { Readable, Writable } from 'node:stream';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable as WritableStream } from 'node:stream';

import { HubConfigError, readHubConfig } from './config.js';
import { KEY_NAME, keysFileName } from './identity/key-store.js';
import { LOGIN_PASSWORD_VARIABLE, LOGIN_USER_VARIABLE, openSqliteLoginStore } from './identity/login-store.js';
import { KEYS_ROUTE } from './server-keys.js';

/** The variable `rafa-hub keys` reads the hub's URL from when `--hub` is left out. */
export const HUB_URL_VARIABLE = 'RAFA_HUB_URL';

/** The flag naming the hub `rafa-hub keys` reaches, its URL after the `=`. */
export const HUB_FLAG = '--hub=';

/** The arguments that run `rafa-hub login`. */
export const LOGIN_ARGS: readonly string[] = Object.freeze(['login']);

/** What `rafa-hub keys` does, by its first argument. */
export type KeysSubcommand = 'create' | 'list' | 'pause' | 'delete';

/** The subcommands of `rafa-hub keys`, as its usage line names them. */
export const KEYS_SUBCOMMANDS: readonly KeysSubcommand[] = Object.freeze(['create', 'list', 'pause', 'delete']);

/** What `rafa-hub keys` takes, as a refused argument list says it. */
export const KEYS_USAGE = 'rafa-hub keys <list | create <name> | pause <name> | delete <name>> [--hub=<url>]';

/** One `rafa-hub keys` run, as its arguments name it. */
export interface KeysCommand {
  readonly subcommand: KeysSubcommand;
  /** The key's name, as typed and not yet checked; null for `list`. */
  readonly name: string | null;
  /** The `--hub` flag's URL, or null when it is left out. */
  readonly hub: string | null;
}

/** Where a command's answers come from: a person at a terminal, or lines of standard input. */
export interface PromptAnswers {
  /** Whether a person types at a terminal, so a new password is asked twice. */
  readonly terminal: boolean;
  /** Asks `question`, answering the line typed, or null once the input ended; `hidden` echoes nothing typed. */
  readonly ask: (question: string, hidden: boolean) => Promise<string | null>;
  /** Lets the input go; nothing is asked after. */
  readonly close: () => void;
}

/** How `rafa-hub keys` sends a request; `fetch` when left out. */
export type HubFetch = (request: Request) => Promise<Response>;

/** What {@link runLogin} may vary beyond the environment. */
export interface RunLoginOptions {
  /** Where the line saying the login was set goes; standard output when left out. */
  readonly out?: (line: string) => void;
  /** Where a refusal's line goes; standard error when left out. */
  readonly err?: (line: string) => void;
  /** Where the answers come from; {@link stdinAnswers} when left out. */
  readonly answers?: PromptAnswers;
  /** The clock the login's `setAt` is read from; the system clock when left out. */
  readonly now?: () => Date;
}

/** What {@link runKeys} may vary beyond the environment. */
export interface RunKeysOptions {
  /** Where the command's lines go; standard output when left out. */
  readonly out?: (line: string) => void;
  /** Where a refusal's line, and a note beside the output, goes; standard error when left out. */
  readonly err?: (line: string) => void;
  /** Where the user name and password are asked; {@link stdinAnswers} when left out. */
  readonly answers?: PromptAnswers;
  /** How a request reaches the hub; `fetch` when left out. */
  readonly fetch?: HubFetch;
}

/** A user name and password sent as `Authorization: Basic`. */
interface Credentials {
  readonly user: string;
  readonly password: string;
}

/** What a name off `KEY_NAME` is told, repeating nothing it was given. */
const INVALID_NAME = 'a key name is a lower-case letter or digit, then up to 63 of those, ".", "_" or "-"';

/** The scheme word a basic challenge opens with, in any case. */
const BASIC_SCHEME = /^\s*basic\b/i;

/** Writes `line` and a newline to `stream`. */
function lineTo(stream: NodeJS.WriteStream): (line: string) => void {
  return (line) => {
    stream.write(`${line}\n`);
  };
}

/** One thrown value's message, on one line. */
function oneLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.replace(/\s*\n\s*/g, '; ');
}

/**
 * Answers read from `read`'s text, one line per question, read once on
 * the first question; nothing is printed, since no person reads it.
 */
export function lineAnswers(read: () => Promise<string>): PromptAnswers {
  let lines: Promise<string[]> | undefined;
  let next = 0;
  const ask = async (): Promise<string | null> => {
    lines ??= read().then((text) => {
      const split = text.split(/\r?\n/);
      if (split.at(-1) === '') split.pop();
      return split;
    });
    const all = await lines;
    const line = all[next];
    next += 1;
    return line ?? null;
  };
  return { terminal: false, ask, close: () => undefined };
}

/**
 * Answers asked at the terminal `input` and `output` are, through one
 * `readline` opened on the first question: a visible question is its
 * prompt, which it redraws as the person types, and a hidden one is
 * written to `output` before its typing is echoed nowhere. `Ctrl+C` or
 * the input's end answers null.
 */
export function terminalAnswers(input: Readable, output: Writable): PromptAnswers {
  let muted = false;
  const echo = new WritableStream({
    write(chunk: Buffer | string, _encoding, done) {
      if (!muted) output.write(chunk);
      done();
    },
  });
  let line: ReturnType<typeof createInterface> | undefined;
  let closed = false;

  const open = (): ReturnType<typeof createInterface> => {
    if (line !== undefined) return line;
    const opened = createInterface({ input, output: echo, terminal: true });
    opened.on('SIGINT', () => {
      opened.close();
    });
    opened.on('close', () => {
      closed = true;
    });
    line = opened;
    return opened;
  };

  const ask = (question: string, hidden: boolean): Promise<string | null> => {
    if (closed) return Promise.resolve(null);
    const asking = open();
    return new Promise((resolve) => {
      const ended = (): void => {
        muted = false;
        if (hidden) output.write('\n');
        resolve(null);
      };
      const answered = (answer: string): void => {
        asking.off('close', ended);
        muted = false;
        if (hidden) output.write('\n');
        resolve(answer);
      };
      asking.once('close', ended);
      if (!hidden) {
        asking.question(question, answered);
        return;
      }
      // Written past readline, which redraws its own prompt, so the muted redraw cannot wipe it.
      output.write(question);
      muted = true;
      asking.question('', answered);
    });
  };

  return {
    terminal: true,
    ask,
    close: () => {
      line?.close();
    },
  };
}

/** The answers of this process's standard input: {@link terminalAnswers} at a terminal, {@link lineAnswers} otherwise. */
export function stdinAnswers(): PromptAnswers {
  return process.stdin.isTTY
    ? terminalAnswers(process.stdin, process.stderr)
    : lineAnswers(() => Bun.stdin.text());
}

/**
 * The `rafa-hub keys` run `args` (the arguments past `keys`) name, or
 * null for any other: one subcommand, a name after each but `list`, and
 * at most one `--hub=<url>` anywhere among them.
 */
export function keysCommandOf(args: readonly string[]): KeysCommand | null {
  const flags = args.filter((arg) => arg.startsWith('--'));
  const words = args.filter((arg) => !arg.startsWith('--'));
  if (flags.length > 1) return null;
  const [flag] = flags;
  if (flag !== undefined && (!flag.startsWith(HUB_FLAG) || flag.length === HUB_FLAG.length)) return null;
  const hub = flag === undefined
    ? null
    : flag.slice(HUB_FLAG.length);

  const [word, ...rest] = words;
  const subcommand = KEYS_SUBCOMMANDS.find((known) => known === word);
  if (subcommand === undefined) return null;
  if (subcommand === 'list') {
    return rest.length === 0
      ? { subcommand, name: null, hub }
      : null;
  }
  const [name] = rest;
  return rest.length === 1 && name !== undefined
    ? { subcommand, name, hub }
    : null;
}

/** Whether `args` (the process's arguments past the script) run `rafa-hub login`. */
export function isLoginCommand(args: readonly string[]): boolean {
  return args.length === LOGIN_ARGS.length && args[0] === LOGIN_ARGS[0];
}

/** Reads the config `env` names, or answers the refusal's line. */
async function loginConfig(env: Readonly<Record<string, string | undefined>>): Promise<HubConfig | string> {
  let config: HubConfig;
  try {
    config = await readHubConfig(env);
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;

    return `the config was refused: ${error.problems.join('; ')}`;
  }
  if (config.authAdapter !== 'api-key') {
    return `the login exists only under hub.auth.adapter: api-key, and this hub's is ${config.authAdapter}`;
  }
  if (config.login?.mode === 'oauth') {
    return 'hub.auth.login.mode is oauth, so the login is the OAuth provider\'s: sign in at the hub\'s /login page';
  }
  return config;
}

/** Asks the user name and password, the password twice at a terminal; answers the pair or the refusal's line. */
async function askLogin(answers: PromptAnswers): Promise<Credentials | string> {
  const ended = 'the input ended before the user name and password; nothing was set';
  const user = await answers.ask('user: ', false);
  if (user === null) return ended;
  if (user.includes(':')) return 'a login\'s user name holds no ":", which Authorization: Basic could not carry; nothing was set';
  const password = await answers.ask('password: ', true);
  if (password === null) return ended;
  if (!answers.terminal) return { user, password };

  const again = await answers.ask('password again: ', true);
  if (again === null) return ended;
  return again === password
    ? { user, password }
    : 'the two passwords differ; nothing was set';
}

/**
 * Sets the hub's login in the keys file of the config `env` names, from
 * the answers asked; see the module note. Answers the exit code: 0 with
 * one line on `out` once the login is set, 1 with one line on `err`
 * otherwise. Never exits the process.
 */
export async function runLogin(env: Readonly<Record<string, string | undefined>>, options: RunLoginOptions = {}): Promise<number> {
  const out = options.out ?? lineTo(process.stdout);
  const err = options.err ?? lineTo(process.stderr);
  const prefix = 'rafa-hub login';
  const config = await loginConfig(env);
  if (typeof config === 'string') {
    err(`${prefix}: ${config}`);
    return 1;
  }

  const answers = options.answers ?? stdinAnswers();
  let asked: Credentials | string;
  try {
    asked = await askLogin(answers);
  } finally {
    answers.close();
  }
  if (typeof asked === 'string') {
    err(`${prefix}: ${asked}`);
    return 1;
  }

  const path = keysFileName(config.storePath);
  let store;
  try {
    mkdirSync(dirname(path), { recursive: true });
    store = openSqliteLoginStore({ path, ...options.now === undefined
      ? {}
      : { now: options.now } });
  } catch (error) {
    err(`${prefix}: the keys file at ${path} did not open: ${oneLine(error)}`);
    return 1;
  }
  try {
    const replaced = await store.hasLogin();
    const login = await store.setLogin(asked.user, asked.password);
    const done = replaced
      ? `the login is now ${login.user}, replacing the one set before`
      : `the login is set for ${login.user}`;
    out(`${prefix}: ${done}, in ${path}`);
    return 0;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;

    err(`${prefix}: ${error.message}; nothing was set`);
    return 1;
  } finally {
    store.close();
  }
}

/** The hub `command` and `env` name, its origin and path with no trailing `/`, or the refusal's line. */
function hubBase(command: KeysCommand, env: Readonly<Record<string, string | undefined>>): string | { readonly refused: string } {
  const written = command.hub ?? env[HUB_URL_VARIABLE] ?? '';
  if (written === '') return { refused: `no hub to reach; pass ${HUB_FLAG}<url> or set ${HUB_URL_VARIABLE}` };
  const where = command.hub === null
    ? HUB_URL_VARIABLE
    : '--hub';
  if (!URL.canParse(written)) return { refused: `${where} is not a URL` };
  const url = new URL(written);
  const plain = url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !plain) {
    return { refused: `${where} is not an http or https URL free of a user, a password, a query and a fragment` };
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The request `command` sends to the hub at `base`, signed in with `credentials` when given. */
function keysRequest(command: KeysCommand, base: string, credentials: Credentials | null): Request {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (credentials !== null) {
    headers['authorization'] = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64')}`;
  }
  if (command.subcommand === 'list') return new Request(`${base}${KEYS_ROUTE}`, { method: 'GET', headers });

  headers['content-type'] = 'application/json';
  const name = encodeURIComponent(command.name ?? '');
  if (command.subcommand === 'create') {
    return new Request(`${base}${KEYS_ROUTE}`, { method: 'POST', headers, body: JSON.stringify({ name: command.name }) });
  }
  return command.subcommand === 'pause'
    ? new Request(`${base}${KEYS_ROUTE}/${name}/pause`, { method: 'POST', headers, body: '{}' })
    : new Request(`${base}${KEYS_ROUTE}/${name}`, { method: 'DELETE', headers, body: '{}' });
}

/** The credentials `env` holds: both login variables, each holding a value; null otherwise. */
function envCredentials(env: Readonly<Record<string, string | undefined>>): Credentials | null {
  const user = env[LOGIN_USER_VARIABLE] ?? '';
  const password = env[LOGIN_PASSWORD_VARIABLE] ?? '';
  return user === '' || password === ''
    ? null
    : { user, password };
}

/** Asks the user name and password the hub's login takes; null once the input ended. */
async function askCredentials(answers: PromptAnswers): Promise<Credentials | null> {
  const user = await answers.ask('hub login user: ', false);
  if (user === null) return null;
  const password = await answers.ask('hub login password: ', true);
  return password === null
    ? null
    : { user, password };
}

/** Whether `response` is a `401` answering the basic challenge, so credentials would help. */
function asksBasic(response: Response): boolean {
  return response.status === 401 && BASIC_SCHEME.test(response.headers.get('www-authenticate') ?? '');
}

/** The key `value` holds, read field by field; null when it is not one. */
function keyOf(value: unknown): HubKey | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, createdBy, createdAt, lastUsedAt, paused, deleted } = value as Record<string, unknown>;
  const texts = typeof name === 'string' && typeof createdBy === 'string' && typeof createdAt === 'string';
  const lastUse = lastUsedAt === null || typeof lastUsedAt === 'string';
  if (!texts || !lastUse || typeof paused !== 'boolean' || typeof deleted !== 'boolean') return null;
  return { name, createdBy, createdAt, lastUsedAt, paused, deleted };
}

/** The line `rafa-hub keys list` prints for `key`, its fields separated by tabs. */
export function keyLine(key: HubKey): string {
  const state = key.deleted
    ? 'deleted'
    : key.paused
      ? 'paused'
      : 'active';
  return [key.name, state, `created ${key.createdAt} by ${key.createdBy}`, `last used ${key.lastUsedAt ?? 'never'}`].join('\t');
}

/** The hub's envelope `response` holds, or null when its body is not one. */
async function envelopeOf(response: Response): Promise<{ readonly success: boolean; readonly data?: unknown; readonly error?: unknown } | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || typeof (body as { success?: unknown }).success !== 'boolean') return null;
    return body as { success: boolean; data?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

/** Sends `command` to the hub at `base`, asking credentials when the hub challenges and `env` holds none. */
async function sendKeys(
  command: KeysCommand,
  base: string,
  env: Readonly<Record<string, string | undefined>>,
  options: RunKeysOptions,
): Promise<Response | string> {
  const send = options.fetch ?? ((request: Request) => fetch(request));
  const fromEnv = envCredentials(env);
  const first = await send(keysRequest(command, base, fromEnv));
  if (fromEnv !== null || !asksBasic(first)) return first;

  const answers = options.answers ?? stdinAnswers();
  let asked: Credentials | null;
  try {
    asked = await askCredentials(answers);
  } finally {
    answers.close();
  }
  if (asked === null) return 'the input ended before the hub login\'s user name and password';
  return send(keysRequest(command, base, asked));
}

/** Prints what the hub's answer `data` to `command` holds; answers the exit code. */
function printAnswer(command: KeysCommand, data: unknown, out: (line: string) => void, err: (line: string) => void): number {
  const prefix = `rafa-hub keys ${command.subcommand}`;
  const not = (): number => {
    err(`${prefix}: the hub's answer is not the key routes' answer; nothing was printed`);
    return 1;
  };
  const fields = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : {};
  if (command.subcommand === 'list') {
    if (!Array.isArray(fields['keys'])) return not();
    const keys = (fields['keys'] as unknown[]).map(keyOf);
    if (keys.some((key) => key === null)) return not();
    if (keys.length === 0) err(`${prefix}: the hub holds no key`);
    for (const key of keys) if (key !== null) out(keyLine(key));
    return 0;
  }
  const key = keyOf(fields['key']);
  if (key === null) return not();
  if (command.subcommand === 'create') {
    const { plain } = fields;
    if (typeof plain !== 'string') return not();
    out(plain);
    err(`${prefix}: ${key.name} created; its key is printed above this once, and the hub keeps only its digest`);
    return 0;
  }
  const done = command.subcommand === 'pause'
    ? 'paused'
    : 'deleted';
  out(`${prefix}: ${key.name} ${done}`);
  return 0;
}

/**
 * Runs `rafa-hub keys` with `args`, the arguments past `keys`, against
 * the hub they or `env` name; see the module note. Answers the exit
 * code: 0 once the hub answered the request, its lines on `out`, or 1
 * with one line on `err`. Never exits the process.
 */
export async function runKeys(args: readonly string[], env: Readonly<Record<string, string | undefined>>, options: RunKeysOptions = {}): Promise<number> {
  const out = options.out ?? lineTo(process.stdout);
  const err = options.err ?? lineTo(process.stderr);
  const command = keysCommandOf(args);
  if (command === null) {
    err(`rafa-hub keys: usage: ${KEYS_USAGE}`);
    return 1;
  }
  const prefix = `rafa-hub keys ${command.subcommand}`;
  const refuse = (line: string): number => {
    err(`${prefix}: ${line}`);
    return 1;
  };
  const base = hubBase(command, env);
  if (typeof base !== 'string') return refuse(base.refused);
  if (command.name !== null && !KEY_NAME.test(command.name)) return refuse(`${INVALID_NAME}; nothing was sent`);

  let response: Response | string;
  try {
    response = await sendKeys(command, base, env, options);
  } catch (error) {
    return refuse(`the hub at ${base} did not answer: ${oneLine(error)}`);
  }
  if (typeof response === 'string') return refuse(response);
  if (response.status === 401 && !asksBasic(response)) {
    return refuse(`this hub signs in through OAuth, which the CLI does not; manage its keys at ${base}/login`);
  }

  const envelope = await envelopeOf(response);
  if (envelope === null) return refuse(`the hub at ${base} answered ${String(response.status)}, not with the key routes' JSON`);
  if (!response.ok || !envelope.success) {
    const error = typeof envelope.error === 'string'
      ? envelope.error
      : 'no error given';
    const routes = response.status === 404 && (command.subcommand === 'list' || command.subcommand === 'create')
      ? ' (the key routes exist only under hub.auth.adapter: api-key)'
      : '';
    return refuse(`the hub answered ${String(response.status)}: ${error}${routes}`);
  }
  return printAnswer(command, envelope.data, out, err);
}
