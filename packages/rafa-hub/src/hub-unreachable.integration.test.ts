/**
 * The #325 distributed-acceptance case for a hub that cannot be reached:
 * every command that contacts it still exits 0, uses the local store,
 * and prints exactly one line saying so — and once the hub comes back,
 * a row written while it was down reaches another device.
 *
 * Two ways a hub goes unreachable are told apart, since they exercise
 * different halves of `packages/rafa-sync-service/src/client.ts`:
 *
 *   - **Stopped**: the real hub this file starts (`startHubServer`, as
 *     `two-devices.integration.test.ts` starts it) is stopped with
 *     `hub.stop()`, so a device still naming its address meets a
 *     connection refused at once.
 *   - **Silent**: a second `Bun.serve`, on a port of its own, accepts
 *     every connection and answers none, so a device named at it waits
 *     out the whole `hub.timeout` before the client's own
 *     `AbortSignal.timeout` fires. Only this path proves the abort
 *     itself, which a stopped hub's instant refusal never reaches.
 *
 * `hub.timeout` is set to `1s`, the shortest `config-schema-hub.ts`
 * accepts, so the silent path's wait is short and the timing bound below
 * is cheap to prove: `src/tests/sync-contact-spawned.test.ts` covers the
 * one-line and local-store rules already, over a stand-in `service`
 * module that never makes a real connection, so it proves nothing about
 * either real wait.
 *
 * Four devices and a fifth that is never redirected or stopped at all:
 *
 *   - `stop-plain` and `silent-plain` each run `rafa status`, `rafa
 *     effort report` and `rafa effort collect --no-sessions` once while
 *     their hub is reachable (the timing bound's own baseline), then
 *     again once it is not (stopped for the first, silent for the
 *     second).
 *   - `stop-next` and `silent-next` run `rafa next --dry-run` the same
 *     way, over a project naming `pr.provider: gh`, a roadmap issue and
 *     a stand-in `gh`, since `openNextSources` refuses any other
 *     provider before the pull `rafa next` makes ever runs
 *     (`src/next/sources.ts`).
 *   - `other` never has its hub redirected or stopped; it is the device
 *     the offline row has to reach once the stopped hub returns.
 *
 * `stop-next` and `silent-next` each run `effort collect` once, while
 * their hub is still up, right after being planted and before either is
 * measured: `packages/rafa-sync-service/src/sync.ts`'s pull answers
 * `nothing-to-sync` with no network call at all when the device has no
 * store file yet, exactly as a fresh clone's would, so a `next --dry-run`
 * measured before that first collect would prove nothing about either
 * wait — this file's own first failure, caught by this very case.
 *
 * `stop-plain` commits an extra file — its offline row — right after its
 * hub stops, so its down run of `effort collect` has something new to
 * store locally and fail to push. Once the hub is started again, on the
 * same port and the same store directory so no device's config changes,
 * `stop-plain` collects once more (pushing that row), `other` collects
 * for the first time (pulling it in, among every other device's own
 * seed row), and `stop-plain` collects a third time so it pulls `other`'s
 * row back in too — the same interleaved-round shape
 * `two-devices.integration.test.ts` converges with. From there
 * `testdata/compare-merged-stores.js` reads every merged table straight
 * off each SQLite file and finds the same rows on `stop-plain`, `other`
 * and the hub.
 *
 * Every device is `bun src/rafa.ts` spawned as a real process, never
 * dispatched in-process, exactly as `two-devices.integration.test.ts`
 * spawns one and for the same reason: `Bun.spawn`, never
 * `Bun.spawnSync`, since the hub and the silent listener are both
 * `Bun.serve` in this very process, and a synchronous spawn would block
 * the event loop they need to answer — or, for the silent one, to accept
 * a connection and never answer. The same file's note on `Bun.secrets`,
 * the real `rafa-sync-service` package named by path, and the
 * `SECRETS_OK` skip applies here unchanged; the git and secret-bus
 * helpers below are its own, kept local rather than shared, since
 * neither file is the other's fixture.
 */
import type { StandInGitHub } from './identity/testdata/stand-in-github.js';
import type { HubServer } from './server.js';

import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteStore } from '@open-tomato/rafa/store';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from './config.js';
import { openGitHubIdentity } from './identity/github.js';
import { startStandInGitHub } from './identity/testdata/stand-in-github.js';
import { startHubServer } from './server.js';
import { openSqliteHubStore } from './store/sqlite.js';
import { expectSameMergedTables } from './testdata/compare-merged-stores.js';
import { scratchHomeEnv } from './testdata/scratch-home-env.js';

const VERSION = '0.0.0-hub-unreachable';
const REPOSITORY = 'open-tomato/rafa';
const WRITER = 'ghp_hub_unreachable_writer_00001';

/** How long a spawned command may take before it is killed: well past one `hub.timeout`. */
const RUN_TIMEOUT_MS = 15_000;

/** How long the whole case, twenty-one spawned commands and one hub restart, may take. */
const CASE_TIMEOUT_MS = 180_000;

/** Where every rafa secret lives (`packages/rafa-sync-service/src/token.ts`'s `SECRET_SERVICE`). */
const SECRET_SERVICE = 'rafa';

/** The real rafa CLI entry, spawned as a process; never imported. */
const RAFA_ENTRY = fileURLToPath(new URL('../../../src/rafa.ts', import.meta.url));

/** The real `rafa-sync-service` package, named by path in each device's `modules:`; never imported. */
const SYNC_SERVICE_PACKAGE = fileURLToPath(new URL('../../rafa-sync-service', import.meta.url));

/** The `name` the package's `package.json` carries, and `allowList:` must match. */
const SYNC_SERVICE_NAME = '@open-tomato/rafa-sync-service';

/** `hub.timeout`, kept at the shortest value the config schema accepts. */
const HUB_TIMEOUT = '1s';

/** The milliseconds {@link HUB_TIMEOUT} spells. */
const HUB_TIMEOUT_MS = 1000;

/** The slack the timing bound allows past one `hub.timeout`, in milliseconds: "plus one second". */
const TIMING_SLACK_MS = 1000;

/** The environment variables a libsecret-backed `Bun.secrets` reaches its session bus through; carried into the spawned CLI only when this process itself has them. */
const SECRET_BUS_ENV = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const;

/** The reason this suite skips, when it does. */
const SKIP_REASON = 'Bun.secrets could not store and read a credential on this machine';

/** Whether `Bun.secrets` can round-trip a credential here, probed once at load. */
async function probeSecrets(): Promise<boolean> {
  const probe = { service: SECRET_SERVICE, name: `hub-unreachable-probe-${randomUUID()}` };
  try {
    await Bun.secrets.set({ ...probe, value: 'probe' });
    await Bun.secrets.delete(probe);
    return true;
  } catch {
    return false;
  }
}

const SECRETS_OK = await probeSecrets();

/** `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR`, carried from this process's own environment when it has them. */
function secretsEnv(): Readonly<Record<string, string>> {
  return Object.fromEntries(SECRET_BUS_ENV
    .map((name): readonly [string, string | undefined] => [name, process.env[name]])
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

/** The environment this process runs `git` fixture steps under: its own, with no `GIT_*` variable reaching it. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined));
}

/** Runs `git` in `cwd` as a fixture step, throwing what it said on the way out when it failed. */
function git(cwd: string, ...args: string[]): void {
  const ran = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${ran.stderr.toString()}`);
}

const gitBinary = Bun.which('git');
if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
const GIT_DIR = dirname(gitBinary);

/** The base branch a next-capable device works on. */
const NEXT_BASE = 'main';

/** The roadmap issue `rafa next`'s board read resolves. */
const NEXT_ROADMAP_ISSUE = 9101;

/** The one undone roadmap line's issue: a complete, ready spec. */
const NEXT_TASK_ISSUE = 9102;

/** The task issue's title. */
const NEXT_TASK_TITLE = 'Ship the hub-unreachable acceptance case';

/** The login every planted issue is authored by, trusted through the stand-in permission answer. */
const NEXT_AUTHOR_LOGIN = 'octocat';

/** Mirrors `src/board/issue.ts`'s `SPEC_LABEL`; duplicated since a package reaches core only through its two subpaths. */
const SPEC_LABEL = 'type:spec';

/** Mirrors `src/board/readiness.ts`'s `SPEC_READY_LABEL`; same reason. */
const SPEC_READY_LABEL = 'spec:ready';

/** A spec body carrying every heading `src/board/readiness.ts`'s `TEMPLATE_HEADINGS` names, each with content, so the readiness gate finds no gap; the two `LIST_HEADINGS` each carry a list item. */
const NEXT_TASK_BODY = [
  `# ${NEXT_TASK_TITLE}\n`,
  '## What you get\n\nWritten so the readiness gate finds no gap here.\n',
  '## Starting position\n\nWritten so the readiness gate finds no gap here.\n',
  '## Design\n\nWritten so the readiness gate finds no gap here.\n',
  '## What can go wrong\n\nWritten so the readiness gate finds no gap here.\n',
  '## Tasks the plan must carry\n\n- one item, so the plan has something to be written from\n',
  '## Definition of done\n\n- one item, so the plan has something to be written from\n',
].join('\n');

/** The one undone roadmap line `rafa next`'s board read proposes planning. */
const NEXT_ROADMAP_BODY = `- [ ] #${String(NEXT_TASK_ISSUE)} — ${NEXT_TASK_TITLE}\n`;

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/**
 * Writes the stand-in `gh` a next-capable device's `PATH` resolves to:
 * the roadmap issue, the task issue, the collaborator permission both
 * are trusted through, and an empty `pr list`/`issue list` for the
 * walk's other reads. Anything else fails loudly, naming what it was
 * asked; see `src/tests/next-chain-fixtures.ts`'s own, which this
 * mirrors rather than imports, crossing no package boundary.
 */
function writeStandInGh(bin: string): void {
  const roadmapIssue = {
    number: NEXT_ROADMAP_ISSUE,
    title: 'Roadmap',
    body: NEXT_ROADMAP_BODY,
    state: 'OPEN',
    labels: [],
    author: { login: NEXT_AUTHOR_LOGIN },
  };
  const taskIssue = {
    number: NEXT_TASK_ISSUE,
    title: NEXT_TASK_TITLE,
    body: NEXT_TASK_BODY,
    state: 'OPEN',
    labels: [{ name: SPEC_LABEL }, { name: SPEC_READY_LABEL }],
    author: { login: NEXT_AUTHOR_LOGIN },
  };
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(NEXT_ROADMAP_ISSUE)}" ]; then`,
    `  printf '%s' '${shellQuoted(roadmapIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(NEXT_TASK_ISSUE)}" ]; then`,
    `  printf '%s' '${shellQuoted(taskIssue)}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${NEXT_AUTHOR_LOGIN}/permission" ]; then`,
    `  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** One scratch device: its repository, a home and a `bin/` of its own, and its name. */
interface Device {
  readonly name: string;
  readonly root: string;
  readonly home: string;
  readonly bin: string;
}

/** Whether a device needs `rafa next --dry-run` to run on it (`pr.provider: gh`, a roadmap and a stand-in `gh`) or stays plain (`pr.provider: none`). */
type DeviceKind = 'plain' | 'next';

/** The config text for `kind`, naming `hubUrl` and `secretName`. */
function deviceConfig(kind: DeviceKind, hubUrl: string, secretName: string): string {
  const identity = kind === 'next'
    ? ['pr:', '  provider: gh', `  base: ${NEXT_BASE}`, 'roadmap:', `  issue: ${String(NEXT_ROADMAP_ISSUE)}`]
    : ['pr:', '  provider: none'];
  return [
    ...identity,
    'effort:',
    '  sync: service',
    'hub:',
    `  url: ${hubUrl}`,
    `  tokenSecret: ${secretName}`,
    `  timeout: ${HUB_TIMEOUT}`,
    'modules:',
    `  - path: ${SYNC_SERVICE_PACKAGE}`,
    'allowList:',
    `  - "${SYNC_SERVICE_NAME}"`,
    '',
  ].join('\n');
}

/** Rewrites `device`'s config to name `hubUrl`, as planting it does and as redirecting it later does too. */
function writeDeviceConfig(device: Device, kind: DeviceKind, hubUrl: string, secretName: string): void {
  writeFileSync(join(device.root, '.rafa', 'config.yaml'), deviceConfig(kind, hubUrl, secretName), 'utf8');
}

/**
 * A fresh git repository under `scope` named `name`, with a git identity
 * of its own and one commit over a file no other device holds, then
 * `.rafa/config.yaml` naming `hubUrl` and `secretName`. A `next` device
 * is checked out on {@link NEXT_BASE}, pushed to a bare `origin` beside
 * it so the branch scan's remote half never fails, with the stand-in
 * `gh` {@link writeStandInGh} writes on its own `bin/`.
 */
function plantDevice(scope: string, name: string, kind: DeviceKind, hubUrl: string, secretName: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const home = realpathSync(mkdtempSync(join(scope, `${name}-home-`)));
  const bin = realpathSync(mkdtempSync(join(scope, `${name}-bin-`)));

  git(root, 'init', '-q');
  if (kind === 'next') git(root, 'checkout', '-q', '-B', NEXT_BASE);
  writeFileSync(join(root, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(root, `${name}-seed.txt`), `${name}'s own row\n`, 'utf8');
  git(root, 'add', '-A');
  git(root, '-c', `user.name=${name}`, '-c', `user.email=${name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${name} seed`);

  if (kind === 'next') {
    const bare = join(dirname(root), `${name}-origin.git`);
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '-q', '--bare');
    git(root, 'remote', 'add', 'origin', bare);
    git(root, 'push', '-q', '-u', 'origin', NEXT_BASE);
    writeStandInGh(bin);
  }

  mkdirSync(join(root, '.rafa'), { recursive: true });
  const device: Device = { name, root, home, bin };
  writeDeviceConfig(device, kind, hubUrl, secretName);
  return device;
}

/** Commits `device`'s offline row: the file it writes while its hub cannot be reached. */
function commitOfflineRow(device: Device): void {
  writeFileSync(join(device.root, `${device.name}-offline.txt`), `${device.name}'s offline row\n`, 'utf8');
  git(device.root, 'add', '-A');
  git(device.root, '-c', `user.name=${device.name}`, '-c', `user.email=${device.name}@example.invalid`, 'commit', '-q', '--no-verify', '-m', `${device.name} offline`);
}

/** What one command run answered: its exit code, standard output and error together, and how long it took. */
interface CommandRun {
  readonly exitCode: number | null;
  readonly output: string;
  readonly ms: number;
}

/**
 * Spawns the real `rafa` for `device` with `words`, timing the whole
 * call. `Bun.spawn`, never `Bun.spawnSync`; see the module note.
 */
async function runCommand(device: Device, words: readonly string[]): Promise<CommandRun> {
  const started = performance.now();
  const child = Bun.spawn([process.execPath, RAFA_ENTRY, ...words], {
    cwd: device.root,
    env: {
      RAFA_TEST: '1',
      TMPDIR: tmpdir(),
      PATH: [device.bin, GIT_DIR].join(delimiter),
      ...scratchHomeEnv(device.home),
      ...secretsEnv(),
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: RUN_TIMEOUT_MS,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}`, ms: performance.now() - started };
}

/** What every line a contact writes opens with (`src/effort/sync/contact.ts`'s `OPENING`). */
const SYNC_OPENING = 'effort sync:';

/** The text output's warning prefix, naming `hubUrl`, up to the reason a contact gives in parentheses. */
function unreachablePrefix(hubUrl: string): string {
  return `warn: ${SYNC_OPENING} the hub at ${hubUrl} is unreachable (`;
}

/** What every unreachable line ends with, past the reason (`src/effort/sync/contact.ts`'s `hubUnreachableLine`). */
const UNREACHABLE_SUFFIX = '); this command used the local store, and its rows sync on the next contact';

/** How many of `output`'s lines are the hub-unreachable line naming `hubUrl`, whatever its reason. */
function unreachableLineCount(output: string, hubUrl: string): number {
  const prefix = unreachablePrefix(hubUrl);
  return output.split('\n').filter((line) => line.startsWith(prefix) && line.endsWith(UNREACHABLE_SUFFIX)).length;
}

/** How many of `output`'s lines open as a contact's lines do. */
function syncLineCount(output: string): number {
  return output.split('\n').filter((line) => line.includes(SYNC_OPENING)).length;
}

/** `rafa status`. */
const STATUS: readonly string[] = ['status'];

/** `rafa effort report`. */
const EFFORT_REPORT: readonly string[] = ['effort', 'report'];

/** `rafa effort collect --no-sessions`. */
const EFFORT_COLLECT: readonly string[] = ['effort', 'collect', '--no-sessions'];

/** `rafa next --dry-run`. */
const NEXT_DRY_RUN: readonly string[] = ['next', '--dry-run'];

/**
 * Runs `words` on `device` while its hub is reachable: the timing
 * bound's own baseline. Asserts a clean exit with no sync line at all,
 * and answers how long it took, in milliseconds.
 */
async function baselineRun(device: Device, words: readonly string[]): Promise<number> {
  const run = await runCommand(device, words);
  expect(run.exitCode).toBe(0);
  expect(run.output).not.toContain(SYNC_OPENING);
  return run.ms;
}

/** What a down run may be asked to check beyond the three rules every one holds to. */
interface DownRunExpectations {
  /** A line the run's output must contain, such as `+1 rows` for a collect that stored an offline row. */
  readonly contains?: string;
}

/**
 * Runs `words` on `device` while its hub cannot be reached, named by
 * `hubUrl`: asserts exit 0, exactly one hub-unreachable line naming
 * `hubUrl` and no other sync line, and a duration no more than one
 * `hub.timeout` and one second past `baselineMs`, the same command's
 * reading while the hub was reachable.
 */
async function unreachableRun(
  device: Device,
  words: readonly string[],
  hubUrl: string,
  baselineMs: number,
  expectations: DownRunExpectations = {},
): Promise<CommandRun> {
  const run = await runCommand(device, words);
  expect(run.exitCode).toBe(0);
  expect(unreachableLineCount(run.output, hubUrl)).toBe(1);
  expect(syncLineCount(run.output)).toBe(1);
  expect(run.ms).toBeLessThanOrEqual(baselineMs + HUB_TIMEOUT_MS + TIMING_SLACK_MS);
  if (expectations.contains !== undefined) expect(run.output).toContain(expectations.contains);
  return run;
}

/** A listener that accepts every connection and answers none, so a caller waits out its own timeout. */
interface SilentListener {
  readonly url: string;
  readonly stop: () => Promise<void>;
}

/** Starts {@link SilentListener} on a free port of its own. */
function startSilentListener(): SilentListener {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (): Promise<Response> => new Promise<Response>(() => {
      // Never settles: the caller's own `AbortSignal.timeout` is what ends the wait.
    }),
  });
  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}

/** Starts the hub on `port`, over `githubUrl` and the store at `directory`; used both to start it and to start it again once it has stopped. */
function startHub(port: number, githubUrl: string, directory: string): HubServer {
  return startHubServer({
    port,
    hostname: '127.0.0.1',
    version: VERSION,
    identity: openGitHubIdentity({ repository: REPOSITORY, cacheForMs: null, apiBase: githubUrl }),
    openStore: () => openSqliteHubStore({ directory, now: () => new Date() }),
  });
}

describe.skipIf(!SECRETS_OK)(`every command survives the hub being unreachable (skipped when: ${SKIP_REASON})`, () => {
  let scope = '';
  let hubDir = '';
  let hubPort = 0;
  let github: StandInGitHub;
  let hub: HubServer;
  let silent: SilentListener;
  let secretName = '';

  beforeEach(async () => {
    scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-unreachable-')));
    hubDir = realpathSync(mkdtempSync(join(scope, 'hub-')));
    github = startStandInGitHub({ [WRITER]: { login: 'writer', roles: { [REPOSITORY]: 'write' } } });
    hub = startHub(0, github.url, hubDir);
    hubPort = Number(new URL(hub.url).port);
    silent = startSilentListener();
    secretName = `hub-token-${randomUUID()}`;
    await Bun.secrets.set({ service: SECRET_SERVICE, name: secretName, value: WRITER });
  });

  afterEach(async () => {
    await Bun.secrets.delete({ service: SECRET_SERVICE, name: secretName });
    await silent.stop();
    await hub.stop();
    await github.stop();
    rmSync(scope, { recursive: true, force: true });
  });

  it(
    'exits 0, prints one hub-unreachable line and finishes within hub.timeout of hub-running time for status, next --dry-run, effort collect and effort report, and offline rows reach the other device once the hub returns',
    async () => {
      const stopPlain = plantDevice(scope, 'stop-plain', 'plain', hub.url, secretName);
      const silentPlain = plantDevice(scope, 'silent-plain', 'plain', hub.url, secretName);
      const stopNext = plantDevice(scope, 'stop-next', 'next', hub.url, secretName);
      const silentNext = plantDevice(scope, 'silent-next', 'next', hub.url, secretName);
      const other = plantDevice(scope, 'other', 'plain', hub.url, secretName);

      // A next-capable device needs a store to pull into before its pull contacts the hub
      // at all: a pull with no store file yet answers `nothing-to-sync` locally
      // (`packages/rafa-sync-service/src/sync.ts`), exactly as a fresh clone's would.
      for (const device of [stopNext, silentNext]) {
        const primed = await runCommand(device, EFFORT_COLLECT);
        expect(primed.exitCode).toBe(0);
      }

      // Baselines: every device's hub is reachable, and each run writes no sync line.
      const stopPlainCollectBaseline = await baselineRun(stopPlain, EFFORT_COLLECT);
      const stopPlainStatusBaseline = await baselineRun(stopPlain, STATUS);
      const stopPlainReportBaseline = await baselineRun(stopPlain, EFFORT_REPORT);
      const silentPlainCollectBaseline = await baselineRun(silentPlain, EFFORT_COLLECT);
      const silentPlainStatusBaseline = await baselineRun(silentPlain, STATUS);
      const silentPlainReportBaseline = await baselineRun(silentPlain, EFFORT_REPORT);
      const stopNextBaseline = await baselineRun(stopNext, NEXT_DRY_RUN);
      const silentNextBaseline = await baselineRun(silentNext, NEXT_DRY_RUN);

      // Go offline: the two "silent" devices are redirected to a listener that never answers,
      // and the shared hub is stopped — the two ways a hub goes unreachable; see the module note.
      writeDeviceConfig(silentPlain, 'plain', silent.url, secretName);
      writeDeviceConfig(silentNext, 'next', silent.url, secretName);
      await hub.stop();

      // The row stop-plain writes while its hub cannot be reached.
      commitOfflineRow(stopPlain);

      await unreachableRun(stopPlain, EFFORT_COLLECT, hub.url, stopPlainCollectBaseline, { contains: '+1 rows' });
      await unreachableRun(stopPlain, STATUS, hub.url, stopPlainStatusBaseline);
      await unreachableRun(stopPlain, EFFORT_REPORT, hub.url, stopPlainReportBaseline);

      await unreachableRun(silentPlain, EFFORT_COLLECT, silent.url, silentPlainCollectBaseline);
      await unreachableRun(silentPlain, STATUS, silent.url, silentPlainStatusBaseline);
      await unreachableRun(silentPlain, EFFORT_REPORT, silent.url, silentPlainReportBaseline);

      await unreachableRun(stopNext, NEXT_DRY_RUN, hub.url, stopNextBaseline);
      await unreachableRun(silentNext, NEXT_DRY_RUN, silent.url, silentNextBaseline);

      // The hub returns, on the same address every device still names.
      hub = startHub(hubPort, github.url, hubDir);

      const reconnected = await runCommand(stopPlain, EFFORT_COLLECT);
      expect(reconnected.exitCode).toBe(0);
      expect(reconnected.output).not.toContain(SYNC_OPENING);
      expect(reconnected.output).toContain('+0 rows');

      const otherRun = await runCommand(other, EFFORT_COLLECT);
      expect(otherRun.exitCode).toBe(0);
      expect(otherRun.output).not.toContain(SYNC_OPENING);
      expect(otherRun.output).toContain('+1 rows');

      // A second round for stop-plain, so it pulls other's row in too, exactly as
      // `two-devices.integration.test.ts`'s own interleaved rounds converge both sides.
      const converged = await runCommand(stopPlain, EFFORT_COLLECT);
      expect(converged.exitCode).toBe(0);
      expect(converged.output).not.toContain(SYNC_OPENING);
      expect(converged.output).toContain('+0 rows');

      const stopPlainPath = openSqliteStore(stopPlain.root).path('commits');
      const otherPath = openSqliteStore(other.root).path('commits');
      const hubPath = join(hubDir, DEFAULT_STORE_FILE);
      expectSameMergedTables([stopPlainPath, otherPath, hubPath]);
    },
    CASE_TIMEOUT_MS,
  );
});
