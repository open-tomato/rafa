/**
 * Tests for the Providers reading of `rafa doctor --deep`.
 *
 * Two kinds of `gh` stand in for the real one:
 *
 *   - A scripted runner, handed over through `openGh`, that answers the
 *     two `gh auth status` forms as each case scripts them and passes
 *     every `gh api` to the recorded fake in `src/pr/gh-fake.ts`, where
 *     a case plants the permission the collaborators endpoint answers.
 *     `gh` is still found by `Bun.which` on the case's `PATH`, so each
 *     of these cases plants an executable `gh` in a temporary `bin` it
 *     never runs.
 *   - A planted shell script run through the real `createGhRunner`, for
 *     the cases that prove the environment handed over is the one `gh`
 *     answers under: it passes `auth status` only when that environment
 *     carries `RAFA_GH_STATE=in`, and the case asks twice, once each
 *     way, so a pass cannot come from an answer that ignores the
 *     environment.
 *
 * No case reads the real `PATH`, the real home or the real `origin`.
 */
import type { DeepProvidersReading, DeepProvidersSeams } from './doctor-deep-providers.js';
import type { GhResult, GhRunner, GhRunnerOptions } from '../adapters/tracker/github.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../pr/gh-fake.js';
import { DEFAULT_GH_HOST, ghMissingMessage, ghUnauthenticatedMessage } from '../pr/preflight-items.js';

import {
  activeLoginOf,
  providersSection,
  PROVIDERS_SECTION_TITLE,
  readDeepProviders,
  trackerChain,
} from './doctor-deep-providers.js';
import { renderDeepSection } from './doctor-deep-row.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-providers-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A `bin` holding an executable `gh` the scripted cases find and never run. */
const unusedBin = join(base, 'unused-bin');
/** A `bin` holding the environment-reading stand-in. */
const standInBin = join(base, 'stand-in-bin');
/** A directory holding nothing, for a `PATH` that finds no `gh`. */
const emptyBin = join(base, 'empty-bin');
const project = join(base, 'project');

for (const dir of [unusedBin, standInBin, emptyBin, project]) mkdirSync(dir, { recursive: true });

writeFileSync(join(unusedBin, 'gh'), '#!/bin/sh\nexit 97\n');
chmodSync(join(unusedBin, 'gh'), 0o755);

/** A login the scripted cases read as the active account. */
const LOGIN = 'octocat';

/** `gh auth status --json hosts` naming `login` active on `host`, beside an inactive account. */
function hostsJson(host: string, login: string): string {
  return JSON.stringify({
    hosts: {
      [host]: [
        { state: 'success', active: false, host, login: 'someone-else' },
        { state: 'success', active: true, host, login },
      ],
    },
  });
}

// Shell builtins alone: the stand-in runs under a PATH holding only its own directory.
writeFileSync(join(standInBin, 'gh'), [
  '#!/bin/sh',
  'case "$*" in',
  '  "auth status --hostname github.com")',
  '    if [ "$RAFA_GH_STATE" = in ]; then printf "Logged in to github.com\\n"; exit 0; fi',
  '    printf "You are not logged into any GitHub hosts. To log in, run: gh auth login\\n" >&2; exit 1;;',
  '  "auth status --active --hostname github.com --json hosts")',
  `    printf '%s\\n' '${hostsJson('github.com', LOGIN)}';;`,
  `  "api repos/{owner}/{repo}/collaborators/${LOGIN}/permission")`,
  '    printf \'{"permission":"admin","role_name":"admin"}\\n\';;',
  '  *) printf "stand-in: unhandled %s\\n" "$*" >&2; exit 2;;',
  'esac',
  '',
].join('\n'));
chmodSync(join(standInBin, 'gh'), 0o755);

const GITHUB_REMOTE = 'git@github.com:open-tomato/rafa.git';

/** What a scripted runner answers for the two auth forms. */
interface Script {
  readonly auth?: GhResult;
  readonly hosts?: GhResult;
  /** Logins and the permission the collaborators endpoint answers for each. */
  readonly permissions?: Readonly<Record<string, string>>;
}

/** A scripted `openGh`, what it was opened with, and every command it was handed. */
interface Scripted {
  readonly openGh: (options: GhRunnerOptions) => GhRunner;
  readonly opened: () => readonly GhRunnerOptions[];
  readonly calls: () => readonly (readonly string[])[];
}

const passed = (stdout = ''): GhResult => ({ ok: true, stdout, stderr: '' });
const failedWith = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });

/** A runner answering the auth forms as `script` says, and `gh api` through the recorded fake. */
function scripted(script: Script = {}, host = DEFAULT_GH_HOST): Scripted {
  const fake = createFakePrGh();
  for (const [login, permission] of Object.entries(script.permissions ?? { [LOGIN]: 'admin' })) {
    fake.plantPermission(login, permission);
  }
  let opened: readonly GhRunnerOptions[] = [];
  let calls: readonly (readonly string[])[] = [];
  const run: GhRunner = async (args) => {
    calls = [...calls, args];
    if (args.join(' ') === `auth status --hostname ${host}`) return script.auth ?? passed('Logged in\n');
    if (args.join(' ') === `auth status --active --hostname ${host} --json hosts`) {
      return script.hosts ?? passed(hostsJson(host, LOGIN));
    }
    return args[0] === 'api'
      ? fake.run(args)
      : failedWith(`scripted gh: unhandled ${args.join(' ')}\n`);
  };
  return {
    openGh: (options) => {
      opened = [...opened, options];
      return run;
    },
    opened: () => opened,
    calls: () => calls,
  };
}

/** The config the cases start from: the defaults, `github` then `local`, provider unset. */
const DEFAULT_CONFIG: DeepProvidersSeams['config'] = {
  trackerDefault: 'github',
  trackerFallback: ['local'],
  prProvider: null,
};

/** Seams over `project`, a `PATH` finding the unused `gh`, and a GitHub `origin`. */
function seamsOf(overrides: Partial<DeepProvidersSeams> = {}): DeepProvidersSeams {
  return {
    env: { PATH: unusedBin, HOME: join(base, 'home') },
    cwd: project,
    config: DEFAULT_CONFIG,
    readRemote: () => GITHUB_REMOTE,
    ...overrides,
  };
}

/** The rows' `status name` pairs, for a case about which rows appear. */
function rowKeys(reading: DeepProvidersReading): readonly string[] {
  return providersSection(reading).rows.map((row) => `${row.status} ${row.name}`);
}

describe('the tracker chain', () => {
  it('lists the default then each fallback, a kind named twice at its first place', () => {
    expect(trackerChain({ trackerDefault: 'github', trackerFallback: ['local'], prProvider: null })).toEqual(['github', 'local']);
    expect(trackerChain({ trackerDefault: 'local', trackerFallback: ['local'], prProvider: null })).toEqual(['local']);
    expect(trackerChain({ trackerDefault: 'linear', trackerFallback: ['github', 'linear', 'local'], prProvider: null }))
      .toEqual(['linear', 'github', 'local']);
  });
});

describe('what is probed', () => {
  it('probes nothing and reads no remote when neither the tracker nor the provider goes through gh', async () => {
    let remoteReads = 0;
    const gh = scripted();
    const config = { trackerDefault: 'local', trackerFallback: ['local'], prProvider: 'none' as const };

    const reading = await readDeepProviders(seamsOf({
      config,
      openGh: gh.openGh,
      readRemote: () => {
        remoteReads += 1;
        return GITHUB_REMOTE;
      },
    }));

    expect(remoteReads).toBe(0);
    expect(reading.gh).toBeNull();
    expect(gh.opened()).toEqual([]);
    expect(reading.pr).toEqual({ provider: 'none', source: 'config', remote: null, host: null });
    expect(rowKeys(reading)).toEqual(['ok tracker', 'ok pull request provider', 'note gh']);
  });

  it('probes gh for a local tracker once the provider is read off a GitHub origin', async () => {
    const gh = scripted();
    const config = { trackerDefault: 'local', trackerFallback: ['local'], prProvider: null };

    const reading = await readDeepProviders(seamsOf({ config, openGh: gh.openGh }));

    expect(reading.pr).toEqual({ provider: 'gh', source: 'remote', remote: GITHUB_REMOTE, host: 'github.com' });
    expect(reading.ghTrackers).toEqual([]);
    expect(reading.gh?.auth).toEqual({ ok: true, detail: 'Logged in' });
  });

  it('reads the remote and probes gh for a github tracker under pr.provider none', async () => {
    const gh = scripted({}, 'github.example.com');
    const config = { ...DEFAULT_CONFIG, prProvider: 'none' as const };

    const reading = await readDeepProviders(seamsOf({
      config,
      openGh: gh.openGh,
      readRemote: () => 'https://github.example.com/o/r.git',
    }));

    expect(reading.pr).toEqual({
      provider: 'none',
      source: 'config',
      remote: 'https://github.example.com/o/r.git',
      host: 'github.example.com',
    });
    expect(reading.ghTrackers).toEqual(['github']);
    expect(reading.gh?.host).toBe('github.example.com');
    expect(gh.calls()[0]).toEqual(['auth', 'status', '--hostname', 'github.example.com']);
    expect(reading.gh?.permission?.trusted).toBe(true);
  });

  it('asks about github.com when the checkout has no origin', async () => {
    const gh = scripted();
    const config = { ...DEFAULT_CONFIG, prProvider: 'gh' as const };

    const reading = await readDeepProviders(seamsOf({ config, openGh: gh.openGh, readRemote: () => null }));

    expect(reading.gh?.host).toBe(DEFAULT_GH_HOST);
    expect(gh.calls()[0]).toEqual(['auth', 'status', '--hostname', DEFAULT_GH_HOST]);
  });
});

describe('finding gh', () => {
  it('opens the runner on the gh found on the handed PATH, with the handed environment whole', async () => {
    const gh = scripted();
    const seams = seamsOf({ openGh: gh.openGh });

    const reading = await readDeepProviders(seams);

    expect(reading.gh?.found).toBe(join(unusedBin, 'gh'));
    expect(gh.opened()).toEqual([{ cwd: project, command: join(unusedBin, 'gh'), env: seams.env }]);
  });

  it('warns with the missing-gh remedy, and runs nothing, when the handed PATH holds no gh', async () => {
    const gh = scripted();

    const reading = await readDeepProviders(seamsOf({ env: { PATH: emptyBin }, openGh: gh.openGh }));

    expect(reading.gh).toEqual({ host: 'github.com', found: null, auth: null, login: null, permission: null });
    expect(gh.opened()).toEqual([]);
    expect(providersSection(reading).rows.at(-1)).toEqual({
      status: 'warn',
      name: 'gh',
      detail: 'not found on the session\'s PATH',
      fix: ghMissingMessage('github.com'),
    });
  });

  it('finds no gh under an environment with no PATH', async () => {
    const reading = await readDeepProviders(seamsOf({ env: { HOME: base }, openGh: scripted().openGh }));
    // Control: the same seams find it once the environment names a PATH holding one.
    const control = await readDeepProviders(seamsOf({ env: { HOME: base, PATH: unusedBin }, openGh: scripted().openGh }));

    expect(reading.gh?.found).toBeNull();
    expect(control.gh?.found).toBe(join(unusedBin, 'gh'));
  });
});

describe('gh auth status', () => {
  it('warns with the unauthenticated remedy and stops there when it exits nonzero', async () => {
    const refusal = 'You are not logged into any accounts on github.com\n';
    const gh = scripted({ auth: failedWith(`\n${refusal}`) });

    const reading = await readDeepProviders(seamsOf({ openGh: gh.openGh }));

    expect(reading.gh?.auth).toEqual({ ok: false, detail: refusal.trim() });
    expect(reading.gh?.login).toBeNull();
    expect(gh.calls()).toEqual([['auth', 'status', '--hostname', 'github.com']]);
    expect(providersSection(reading).rows.at(-1)).toEqual({
      status: 'warn',
      name: 'gh auth status --hostname github.com',
      detail: `exited nonzero: ${refusal.trim()}`,
      fix: ghUnauthenticatedMessage('github.com'),
    });
  });

  it('says so when a failing auth status wrote nothing', async () => {
    const reading = await readDeepProviders(seamsOf({ openGh: scripted({ auth: failedWith('') }).openGh }));

    expect(providersSection(reading).rows.at(-1)?.detail).toBe('exited nonzero');
  });
});

describe('the active login', () => {
  it('names the active account of the host, not the first one listed', () => {
    expect(activeLoginOf(hostsJson('github.com', LOGIN), 'github.com')).toEqual({ login: LOGIN, detail: '' });
  });

  it('reads no login from output that is not JSON, a host with no account, or no active account', () => {
    const noActive = JSON.stringify({ hosts: { 'github.com': [{ active: false, login: LOGIN }] } });

    expect(activeLoginOf('Logged in', 'github.com'))
      .toEqual({ login: null, detail: 'gh auth status --json hosts wrote output that is not JSON' });
    expect(activeLoginOf('{"hosts":{}}', 'github.com'))
      .toEqual({ login: null, detail: 'gh auth status --json hosts names no active account for github.com' });
    expect(activeLoginOf(noActive, 'github.com').login).toBeNull();
    expect(activeLoginOf(hostsJson('github.com', LOGIN), 'github.example.com').login).toBeNull();
  });

  it('warns and asks no permission when no active login is read', async () => {
    const gh = scripted({ hosts: passed('{"hosts":{}}') });

    const reading = await readDeepProviders(seamsOf({ openGh: gh.openGh }));

    expect(reading.gh?.permission).toBeNull();
    expect(gh.calls().some((args) => args[0] === 'api')).toBe(false);
    expect(providersSection(reading).rows.at(-1)).toEqual({
      status: 'warn',
      name: 'gh login',
      detail: 'gh auth status --json hosts names no active account for github.com',
    });
  });

  it('warns with what the JSON form wrote when it fails', async () => {
    const reading = await readDeepProviders(seamsOf({ openGh: scripted({ hosts: failedWith('boom\n') }).openGh }));

    expect(reading.gh?.login).toEqual({ login: null, detail: 'gh auth status --json hosts failed: boom' });
  });
});

describe('the repository permission', () => {
  it('reads the login through the collaborators endpoint and passes write access', async () => {
    const gh = scripted({ permissions: { [LOGIN]: 'write' } });

    const reading = await readDeepProviders(seamsOf({ openGh: gh.openGh }));

    expect(gh.calls().at(-1)).toEqual(['api', `repos/{owner}/{repo}/collaborators/${LOGIN}/permission`]);
    expect(reading.gh?.permission).toMatchObject({ login: LOGIN, trusted: true, source: 'permission' });
    expect(providersSection(reading).rows.at(-1)).toEqual({
      status: 'ok',
      name: 'repository permission',
      detail: `${LOGIN} holds write`,
    });
  });

  it('warns, naming the fix, for a login holding read alone', async () => {
    const reading = await readDeepProviders(seamsOf({ openGh: scripted({ permissions: { [LOGIN]: 'read' } }).openGh }));

    expect(providersSection(reading).rows.at(-1)).toEqual({
      status: 'warn',
      name: 'repository permission',
      detail: `${LOGIN} holds read, not write access: a session cannot push its branch, nor the loop merge`,
      fix: `ask a repository admin for write access for ${LOGIN}, or run gh auth switch --hostname github.com`,
    });
  });

  it('warns with the lookup\'s own failure when the endpoint does not answer', async () => {
    const reading = await readDeepProviders(seamsOf({ openGh: scripted({ permissions: {} }).openGh }));
    const row = providersSection(reading).rows.at(-1);

    expect(reading.gh?.permission?.refusal).toBe('lookup-failed');
    expect(row?.status).toBe('warn');
    expect(row?.detail).toStartWith(`could not be read for ${LOGIN}: gh api repos/{owner}/{repo}/collaborators/${LOGIN}/permission failed: `);
    expect(row?.fix).toBeUndefined();
  });
});

describe('under the handed environment, through the real runner', () => {
  it('passes auth status where the environment says logged in and fails it where it does not', async () => {
    const shell = await readDeepProviders(seamsOf({ env: { PATH: standInBin, RAFA_GH_STATE: 'in' } }));
    const session = await readDeepProviders(seamsOf({ env: { PATH: standInBin } }));

    // Control: the same stand-in, found at the same path, under both.
    expect(shell.gh?.found).toBe(join(standInBin, 'gh'));
    expect(session.gh?.found).toBe(join(standInBin, 'gh'));
    expect(shell.gh?.auth).toEqual({ ok: true, detail: 'Logged in to github.com' });
    expect(shell.gh?.permission).toMatchObject({ login: LOGIN, trusted: true });
    expect(session.gh?.auth).toEqual({
      ok: false,
      detail: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
    });
    expect(session.gh?.login).toBeNull();
  });
});

describe('the section', () => {
  it('renders a reading where every probe passed', async () => {
    const reading = await readDeepProviders(seamsOf({ openGh: scripted().openGh }));

    expect(renderDeepSection(providersSection(reading))).toEqual([
      `${PROVIDERS_SECTION_TITLE}:`,
      '  ok    tracker: github, then local; github goes through gh',
      '  ok    pull request provider: gh, read off origin (github.com)',
      `  ok    gh: ${join(unusedBin, 'gh')}, found on the session's PATH`,
      '  ok    gh auth status --hostname github.com: authenticated for github.com',
      `  ok    repository permission: ${LOGIN} holds admin`,
    ]);
  });

  it('says the provider was set by the config, and that a checkout has no origin', async () => {
    const config = { trackerDefault: 'local', trackerFallback: [], prProvider: 'gh' as const };
    const reading = await readDeepProviders(seamsOf({ config, readRemote: () => null, env: { PATH: emptyBin } }));
    const inferred = await readDeepProviders(seamsOf({
      config: { ...config, prProvider: null },
      readRemote: () => null,
      env: { PATH: emptyBin },
    }));

    expect(providersSection(reading).rows.slice(0, 2).map((row) => row.detail)).toEqual([
      'local; none of them goes through gh',
      'gh, set by pr.provider',
    ]);
    expect(providersSection(inferred).rows[1]?.detail).toBe('none, read off origin, which this checkout does not have');
  });
});
