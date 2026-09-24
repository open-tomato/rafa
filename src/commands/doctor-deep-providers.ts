/**
 * The Providers reading of `rafa doctor --deep`: the configured tracker
 * and pull request provider, and — when either goes through the GitHub
 * CLI — whether `gh` answers under the environment it is handed.
 *
 * A module of its own beside `./doctor-deep-settings.ts`, as
 * `./doctor.ts` is near the 800-line cap (`context/source.md`).
 * {@link readDeepProviders} reads into data; {@link providersSection}
 * turns that data into the rows `./doctor-deep-row.ts` renders. No row
 * is a `PreflightCheck`: the REQUIRED `gh` items stay
 * `src/pr/preflight-items.ts`'s, checked by plain `doctor` under the
 * rafa process's own environment, and this reading moves no exit code.
 *
 * ## Which environment
 *
 * Every `gh` this module runs is spawned with {@link DeepProvidersSeams.env}
 * as its WHOLE environment, and found on that environment's `PATH`
 * (`createGhRunner`'s `env` option, `src/adapters/tracker/github.ts`).
 * `--deep` hands it the environment a loop session would run with
 * (`./doctor-deep-env.ts`), which is the point of the section: a `gh`
 * that is found and logged in from the shell can still be missing from
 * a session whose settings `env` replaced `PATH`, or logged out under a
 * `GH_CONFIG_DIR` the session is handed and the shell is not. Nothing
 * here reads `process.env` or `process.cwd()`.
 *
 * ## What is read, in order
 *
 *   1. **The tracker chain**: `tracker.default` then `tracker.fallback`,
 *      a kind named twice listed once, as `resolveTracker` tries them
 *      (`src/adapters/tracker/resolve.ts`). Of the core kinds `github`
 *      alone goes through `gh` ({@link GH_TRACKER_KINDS}); an add-on
 *      kind is listed and not probed, since what it needs is its own.
 *   2. **The pull request provider**: `resolvePrProvider`
 *      (`src/pr/provider.ts`), whose reading carries `origin`'s host.
 *      `pr.provider: none` reads no remote, as plain `doctor` does —
 *      unless the tracker goes through `gh`, which then needs the host.
 *   3. **When either goes through `gh`**, three probes, each run only
 *      when the one before it passed, since a later one cannot answer
 *      where an earlier one failed:
 *        - `gh` found on the environment's `PATH`;
 *        - `gh auth status --hostname <host>` exiting 0, the same
 *          command the REQUIRED auth item runs, for the host
 *          `ghHostOf` names (`origin`'s, or `github.com`);
 *        - the active login for that host, read off
 *          `gh auth status --active --hostname <host> --json hosts`,
 *          and its permission on the repository through
 *          `createGhPermissions` (`src/board/trust.ts`), judged by
 *          `readAuthorTrust` with an empty allow-list so the rule for
 *          which permissions are write access is spelled once.
 *
 * `gh auth status --json` exits 0 whatever the state of the accounts it
 * lists (`gh auth status --help`, gh 2.100.0), so it cannot stand in for
 * the exit-code probe, and the plain probe says nothing of which account
 * is active; both are run. Measured with gh 2.100.0 on 2026-09-24: for a
 * host with no account the JSON form writes `{"hosts":{}}` and exits 0,
 * while the plain form exits 1 writing
 * `You are not logged into any accounts on <host>`.
 *
 * ## The rows
 *
 * The tracker and the provider are one `ok` row each, naming what was
 * configured or inferred. A project where neither goes through `gh`
 * gets one `note` row saying `gh` was not probed. A failed `gh` probe is
 * a `warn` whose fix is the remedy sentence the REQUIRED item fails
 * with (`ghMissingMessage`, `ghUnauthenticatedMessage`), so plain
 * `doctor` and `--deep` tell a person the same thing to do. A login
 * without write access is a `warn` too: a session pushes its branch
 * and the loop opens and merges its pull request.
 */
import type { DeepRow, DeepSection } from './doctor-deep-row.js';
import type { GhResult, GhRunner, GhRunnerOptions } from '../adapters/tracker/github.js';
import type { TrustReading } from '../board/trust.js';
import type { RafaConfig } from '../config.js';
import type { PrProviderReading, ResolvePrProviderOptions } from '../pr/provider.js';
import type { SpawnEnv } from '../utils/session-env.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { createGhPermissions, readAuthorTrust } from '../board/trust.js';
import { isMapping } from '../config-sections.js';
import { ghHostOf, ghMissingMessage, ghUnauthenticatedMessage } from '../pr/preflight-items.js';
import { resolvePrProvider } from '../pr/provider.js';

/** The section's title. */
export const PROVIDERS_SECTION_TITLE = 'Providers';

/** The executable every probe runs. */
export const GH_COMMAND = 'gh';

/** The core tracker kinds that go through `gh`. */
export const GH_TRACKER_KINDS: readonly string[] = Object.freeze(['github']);

/** What {@link readDeepProviders} reads through. */
export interface DeepProvidersSeams {
  /** The environment every `gh` is found and spawned under; see the module note. */
  readonly env: Readonly<SpawnEnv>;
  /** The directory `gh` runs in, whose repository and `origin` it reads: the project root. */
  readonly cwd: string;
  /** The three config keys that decide what is probed. */
  readonly config: Pick<RafaConfig, 'trackerDefault' | 'trackerFallback' | 'prProvider'>;
  /** The `origin` probe the provider is read through. `gitRemoteUrl` when left out. */
  readonly readRemote?: ResolvePrProviderOptions['readRemote'];
  /** Opens the runner every probe after the lookup goes through. `createGhRunner` when left out. */
  readonly openGh?: (options: GhRunnerOptions) => GhRunner;
}

/** A probe's verdict: passed, or failed with the first line it wrote. */
export interface ProbeVerdict {
  readonly ok: boolean;
  /** The first non-blank line the probe wrote, stderr first; empty when it wrote none. */
  readonly detail: string;
}

/** The active login for the host, or why none was read. */
export interface LoginReading {
  /** The active account's login, or null when none was read. */
  readonly login: string | null;
  /** Why no login was read; empty when one was. */
  readonly detail: string;
}

/** The `gh` probes, each null where an earlier one failed; see the module note. */
export interface GhProbes {
  /** The host asked about: `origin`'s, or `github.com`. */
  readonly host: string;
  /** Where `gh` was found on the environment's `PATH`, or null when it was not. */
  readonly found: string | null;
  /** `gh auth status --hostname <host>`; null when `gh` was not found. */
  readonly auth: ProbeVerdict | null;
  /** The active login; null when the auth probe did not pass. */
  readonly login: LoginReading | null;
  /** The login's permission, judged; null when no login was read. */
  readonly permission: TrustReading | null;
}

/** What {@link readDeepProviders} answers. */
export interface DeepProvidersReading {
  /** The tracker kinds in the order the chain tries them, each once. */
  readonly trackerChain: readonly string[];
  /** The kinds of the chain that go through `gh`, in chain order. */
  readonly ghTrackers: readonly string[];
  /** The pull request provider and the remote it was read with. */
  readonly pr: PrProviderReading;
  /** The `gh` probes, or null when neither the tracker nor the provider goes through `gh`. */
  readonly gh: GhProbes | null;
}

/** The reading `pr.provider: none` answers without reading a remote. */
const UNREAD_NONE: PrProviderReading = Object.freeze({ provider: 'none', source: 'config', remote: null, host: null });

/** The tracker kinds in the order `resolveTracker` tries them, each at its first place. */
export function trackerChain(config: DeepProvidersSeams['config']): readonly string[] {
  return [...new Set([config.trackerDefault, ...config.trackerFallback])];
}

/** The first non-blank line of what `result` wrote, stderr first. */
function firstLine(result: GhResult): string {
  const lines = `${result.stderr}\n${result.stdout}`.split('\n');
  return lines.map((line) => line.trim()).find((line) => line !== '') ?? '';
}

/**
 * The active login `gh auth status --json hosts` names for `host`, or
 * why none was read. `stdout` is the JSON the command wrote.
 */
export function activeLoginOf(stdout: string, host: string): LoginReading {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch {
    return { login: null, detail: 'gh auth status --json hosts wrote output that is not JSON' };
  }
  const hosts = isMapping(payload)
    ? payload['hosts']
    : undefined;
  const accounts = isMapping(hosts)
    ? hosts[host]
    : undefined;
  const active = Array.isArray(accounts)
    ? accounts.find((account: unknown) => isMapping(account) && account['active'] === true)
    : undefined;
  const login = isMapping(active)
    ? active['login']
    : undefined;
  return typeof login === 'string' && login !== ''
    ? { login, detail: '' }
    : { login: null, detail: `gh auth status --json hosts names no active account for ${host}` };
}

/** The login and its judged permission, or the login reading alone when it read none. */
async function readLoginAndPermission(
  gh: GhRunner,
  host: string,
): Promise<Pick<GhProbes, 'login' | 'permission'>> {
  const status = await gh(['auth', 'status', '--active', '--hostname', host, '--json', 'hosts']);
  const login = status.ok
    ? activeLoginOf(status.stdout, host)
    : { login: null, detail: `gh auth status --json hosts failed: ${firstLine(status) || 'it wrote nothing'}` };
  if (login.login === null) return { login, permission: null };

  const permission = await readAuthorTrust({
    login: login.login,
    permissions: createGhPermissions({ gh }),
    trustedAuthors: [],
  });
  return { login, permission };
}

/** The three `gh` probes under `seams.env`, each run only when the one before it passed. */
async function probeGh(seams: DeepProvidersSeams, host: string): Promise<GhProbes> {
  const { env, cwd } = seams;
  const found = Bun.which(GH_COMMAND, { PATH: env.PATH ?? '', cwd });
  if (found === null) return { host, found, auth: null, login: null, permission: null };

  const openGh = seams.openGh ?? createGhRunner;
  const gh = openGh({ cwd, command: found, env });
  const status = await gh(['auth', 'status', '--hostname', host]);
  const auth = { ok: status.ok, detail: firstLine(status) };
  if (!auth.ok) return { host, found, auth, login: null, permission: null };

  return { host, found, auth, ...(await readLoginAndPermission(gh, host)) };
}

/**
 * The configured tracker and pull request provider and, when either
 * goes through `gh`, what `gh` answers under `seams.env`. Never throws;
 * see the module note.
 */
export async function readDeepProviders(seams: DeepProvidersSeams): Promise<DeepProvidersReading> {
  const chain = trackerChain(seams.config);
  const ghTrackers = chain.filter((kind) => GH_TRACKER_KINDS.includes(kind));
  const configured = seams.config.prProvider;
  const pr = configured === 'none' && ghTrackers.length === 0
    ? UNREAD_NONE
    : resolvePrProvider({ configured, dir: seams.cwd, readRemote: seams.readRemote });
  const gh = ghTrackers.length > 0 || pr.provider === 'gh'
    ? await probeGh(seams, ghHostOf(pr))
    : null;

  return Object.freeze({
    trackerChain: Object.freeze(chain),
    ghTrackers: Object.freeze(ghTrackers),
    pr,
    gh,
  });
}

/** The tracker row: the chain in order, and which of its kinds go through `gh`. */
function trackerRow(reading: DeepProvidersReading): DeepRow {
  const through = reading.ghTrackers.length === 0
    ? 'none of them goes through gh'
    : `${reading.ghTrackers.join(', ')} goes through gh`;
  return { status: 'ok', name: 'tracker', detail: `${reading.trackerChain.join(', then ')}; ${through}` };
}

/** The pull request provider row: the provider, and whether it was configured or read off `origin`. */
function providerRow(pr: PrProviderReading): DeepRow {
  const from = pr.source === 'config'
    ? 'set by pr.provider'
    : `read off origin${pr.remote === null
      ? ', which this checkout does not have'
      : ''}`;
  const host = pr.host === null
    ? ''
    : ` (${pr.host})`;
  return { status: 'ok', name: 'pull request provider', detail: `${pr.provider}, ${from}${host}` };
}

/** The permission row of a judged login. */
function permissionRow(host: string, reading: TrustReading): DeepRow {
  const name = 'repository permission';
  const held = reading.permission?.roleName ?? reading.permission?.permission ?? 'nothing';
  if (reading.trusted) return { status: 'ok', name, detail: `${reading.login} holds ${held}` };
  if (reading.refusal === 'no-write-access') {
    return {
      status: 'warn',
      name,
      detail: `${reading.login} holds ${held}, not write access: a session cannot push its branch, nor the loop merge`,
      fix: `ask a repository admin for write access for ${reading.login}, or run gh auth switch --hostname ${host}`,
    };
  }
  return { status: 'warn', name, detail: `could not be read for ${reading.login}: ${reading.permission?.detail ?? ''}` };
}

/** The rows of the `gh` probes, stopping at the first that did not pass. */
function ghRows(probes: GhProbes): readonly DeepRow[] {
  const { host } = probes;
  if (probes.found === null) {
    return [{ status: 'warn', name: GH_COMMAND, detail: 'not found on the session\'s PATH', fix: ghMissingMessage(host) }];
  }
  const rows: DeepRow[] = [{ status: 'ok', name: GH_COMMAND, detail: `${probes.found}, found on the session's PATH` }];
  const authName = `gh auth status --hostname ${host}`;
  if (probes.auth === null || !probes.auth.ok) {
    const said = probes.auth?.detail ?? '';
    const detail = said === ''
      ? 'exited nonzero'
      : `exited nonzero: ${said}`;
    return [...rows, { status: 'warn', name: authName, detail, fix: ghUnauthenticatedMessage(host) }];
  }
  rows.push({ status: 'ok', name: authName, detail: `authenticated for ${host}` });
  if (probes.login === null) return rows;
  if (probes.login.login === null) {
    return [...rows, { status: 'warn', name: 'gh login', detail: probes.login.detail }];
  }
  return probes.permission === null
    ? rows
    : [...rows, permissionRow(host, probes.permission)];
}

/** The Providers section of a reading: the tracker, the provider, then the `gh` probes. */
export function providersSection(reading: DeepProvidersReading): DeepSection {
  const gh: readonly DeepRow[] = reading.gh === null
    ? [{ status: 'note', name: GH_COMMAND, detail: 'not probed: neither the tracker nor the pull request provider goes through gh' }]
    : ghRows(reading.gh);
  return { title: PROVIDERS_SECTION_TITLE, rows: [trackerRow(reading), providerRow(reading.pr), ...gh] };
}
