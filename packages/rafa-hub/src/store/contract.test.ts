/**
 * Both contract suites, `contract.ts` for rows and `index-contract.ts`
 * for the index, run over every entry of {@link HUB_CONNECTORS} by name,
 * the index suite twice per connector: once as configured and once with
 * the extension held off, so the vector cases run under both answers.
 * A connector's setup (the embedder, the extension held off) reaches it
 * through {@link INDEX_SETUPS}, keyed by the same names, beside the probe
 * the suite reads the store's and the index's identities with and the
 * planter of its `ref_links`; a connector added without one fails the
 * guard case here, unless it is named as having no index half yet.
 *
 * `postgres` runs behind the `POSTGRES_URL` gate
 * (`testdata/postgres-gate.ts`): closed, a skipped case names the gate;
 * open, both suites run over the connector with each case's stores in
 * schemas of their own, beside a gate case that fails when the connection
 * is refused. Its index setup (`testdata/postgres-index-setup.ts`) holds
 * the extension off by giving no embedder. Both answers of the gate are
 * held by `bun test` spawned on `testdata/postgres-gate.fixture.ts`.
 *
 * The row suite also runs against the in-memory stand-in
 * (`testdata/memory-store.ts`), which is no connector, then against the
 * stand-in with one rule broken at a time, so a suite whose cases could
 * never fail would fail here instead of passing every adapter.
 *
 * Each broken run is `bun test` spawned on
 * `testdata/broken-store.fixture.ts` with the fault named in its
 * environment, and each is held to fail the case named for the rule it
 * breaks, read off the child's `(fail)` lines. The `none` run is the
 * control: the same harness with nothing broken exits 0 with no case
 * failed, so a fault's failure is the fault's and not the harness's.
 * `recomputes-gap` is held to pass too: it rewrites only the commit gap
 * core's merge recomputes, which the suite exempts, where `edits-rows`
 * adds any other key to `row_json` and is held to fail.
 *
 * The index suite has its controls the same way, over the `sqlite`
 * connector with one rule broken (`testdata/broken-index.fixture.ts`,
 * fault named in `RAFA_HUB_INDEX_FAULT`): an index kept inside the store
 * file, a search answering row bodies, and `vector: true` answered with
 * no load. Each is held to fail its named case, in the run as configured
 * or in the run with the extension off, and the `none` run is held to pass.
 */
import type { HubIndexConnector, HubIndexLinkPlanter, HubIndexProbe } from './index-contract.js';
import type { HubServedProject, HubStore } from './port.js';

import { join } from 'node:path';

import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { afterEach, describe, expect, it } from 'bun:test';

import { HUB_CONNECTORS } from './connectors.js';
import { builders, hubStoreContract, readTemplate } from './contract.js';
import { hubIndexContract, INDEX_CONTRACT_EMBEDDER } from './index-contract.js';
import { plantSqliteRefLinks, SQLITE_INDEX_PROBE } from './sqlite-index-probe.js';
import { connectSqliteHub } from './sqlite.js';
import { openMemoryHubStore } from './testdata/memory-store.js';
import { openNoProjectionHubStore } from './testdata/no-projection-store.js';
import {
  describePostgresGate,
  isolatedPostgresStore,
  POSTGRES_GATE_CASE,
  POSTGRES_GATE_SUITE,
  POSTGRES_SKIP_LINE,
  postgresGate,
} from './testdata/postgres-gate.js';
import { postgresIndexSetup } from './testdata/postgres-index-setup.js';

/**
 * How the index suite opens one connector of {@link HUB_CONNECTORS},
 * reads its store's and index's identities, and plants its `ref_links`.
 */
interface IndexSetup {
  readonly connect: HubIndexConnector;
  readonly probe: HubIndexProbe;
  readonly plantLinks: HubIndexLinkPlanter;
}

const POSTGRES = postgresGate(process.env);

/** The `postgres` index setup; its URL is empty, and nothing of it is called, while the gate is closed. */
const POSTGRES_INDEX = postgresIndexSetup(POSTGRES.open
  ? POSTGRES.url
  : '');

/**
 * The index suite's setup per connector name. `sqlite` holds the
 * extension off the way macOS does with no library named, on a loader
 * state of its own so the process's stays unmarked, and is probed by
 * its store file's sha256 and its index file's inode
 * (`sqlite-index-probe.ts`). `postgres` is the setup of
 * `testdata/postgres-index-setup.ts`.
 */
const INDEX_SETUPS: Readonly<Record<string, IndexSetup>> = Object.freeze({
  sqlite: {
    connect: (context, setup) => connectSqliteHub(context, {
      embedder: setup.embedder,
      loader: setup.holdExtensionOff
        ? { library: null, platform: 'darwin', state: createLoaderState() }
        : { state: createLoaderState() },
    }),
    plantLinks: plantSqliteRefLinks,
    probe: SQLITE_INDEX_PROBE,
  },
  postgres: POSTGRES_INDEX,
});

/** The connectors whose index half is not built, so the index suite does not run over them. */
const NO_INDEX_YET: readonly string[] = Object.freeze([]);

describe('the connectors both suites run over', () => {
  it('holds an index setup for every connector with an index by name, and none other', () => {
    const indexed = Object.keys(HUB_CONNECTORS).filter((name) => !NO_INDEX_YET.includes(name));

    expect(Object.keys(INDEX_SETUPS).sort()).toEqual(indexed.sort());
  });

  it('names only connectors it knows as having no index yet', () => {
    expect(NO_INDEX_YET.filter((name) => !Object.hasOwn(HUB_CONNECTORS, name))).toEqual([]);
  });
});

describePostgresGate(POSTGRES);
// Runs after the suite's own hook has closed the case's stores. Dropped case by
// case, the schemas never pile up in the catalogue the later cases read.
afterEach(() => POSTGRES_INDEX.dropMade());

for (const [name, connector] of Object.entries(HUB_CONNECTORS)) {
  // The registry's own entry stores in the default schemas of a real hub,
  // so postgres runs the same connector under schemas of each case's own.
  const isPostgres = name === 'postgres';
  if (isPostgres && !POSTGRES.open) continue;
  hubStoreContract(name, isPostgres && POSTGRES.open
    ? isolatedPostgresStore(POSTGRES.url)
    : async (context) => (await connector(context)).store);
  const setup = INDEX_SETUPS[name];
  if (setup !== undefined) {
    const options = { embedder: INDEX_CONTRACT_EMBEDDER, plantLinks: setup.plantLinks, probe: setup.probe };
    hubIndexContract(name, setup.connect, options);
    hubIndexContract(`${name}, extension off`, setup.connect, { ...options, holdExtensionOff: true });
  }
}

hubStoreContract('in-memory stand-in', openMemoryHubStore);
hubStoreContract('no-projection fixture', openNoProjectionHubStore);

/** Two listed projects, as `hub.projects` would name them. */
const PROJECT_ONE: HubServedProject = { id: '1'.repeat(40), name: 'open-tomato/one' };
const PROJECT_TWO: HubServedProject = { id: '2'.repeat(40), name: 'open-tomato/two' };

/** A device's store origin. */
const DEVICE = 'dddddddd-0000-4000-8000-00000000000d';

/** The clock every push of the stand-in below is stamped at. */
const PUSHED_AT = '2026-11-16T10:00:00.000Z';

describe('the in-memory stand-in\'s status over two projects', () => {
  const template = readTemplate();
  const { commit, payload } = builders(() => template);

  /** The stand-in over both projects, with one row pushed to the second. */
  const openPushedToTwo = async (): Promise<HubStore> => {
    const store = openMemoryHubStore({ directory: '', now: () => new Date(PUSHED_AT), projects: [PROJECT_ONE, PROJECT_TWO] });
    await store.push({ device: DEVICE, project: PROJECT_TWO.id, payload: payload({ commits: [commit(DEVICE, 1)] }) });
    return store;
  };

  it('refuses a status naming a project not listed, with the line naming hub.projects', async () => {
    const store = await openPushedToTwo();
    const unlisted = '3'.repeat(40);

    await expect(store.status({ project: unlisted })).rejects.toThrow(`rafa-hub: project ${unlisted} is not served here; add it under hub.projects`);
  });

  it('leaves the other project\'s rows, devices and migrations unchanged by a push to one', async () => {
    const store = await openPushedToTwo();

    const one = await store.status({ project: PROJECT_ONE.id });

    expect({ rows: one.rows, devices: one.devices, migrations: one.migrations }).toEqual({ rows: {}, devices: [], migrations: [] });
  });

  it('answers the named project\'s rows, devices and migrations', async () => {
    const store = await openPushedToTwo();

    const two = await store.status({ project: PROJECT_TWO.id });

    expect({ rows: two.rows, devices: two.devices, migrations: two.migrations })
      .toEqual({ rows: { commits: 1 }, devices: [{ device: DEVICE, lastPushAt: PUSHED_AT }], migrations: template.migrations });
  });

  it('reads a status naming no project as the first listed project\'s, naming both projects', async () => {
    const store = await openPushedToTwo();

    const unnamed = await store.status();

    expect(unnamed).toEqual({ ...await store.status({ project: PROJECT_ONE.id }), projects: [PROJECT_ONE, PROJECT_TWO] });
  });
});

/** The package directory, whose `tsconfig.json` maps the core subpaths. */
const PACKAGE_DIR = join(import.meta.dir, '..', '..');

/** The fixture a broken store run spawns `bun test` on. */
const FIXTURE = join(import.meta.dir, 'testdata', 'broken-store.fixture.ts');

/** The fixture a broken index run spawns `bun test` on. */
const INDEX_FIXTURE = join(import.meta.dir, 'testdata', 'broken-index.fixture.ts');

/** How a spawned run marks a failed case. */
const FAIL_MARK = '(fail) ';

/** What one spawned run of a fixture did. */
interface FixtureRun {
  readonly exitCode: number;
  /** Each failed case's title, less the suite prefix and the timing. */
  readonly failed: readonly string[];
}

/** The title of one `(fail)` line, less the timing: the line after `prefix`, or `null` for a line that is not one. */
function titleOf(line: string, prefix: string): string | null {
  return line.startsWith(prefix)
    ? line.slice(prefix.length).replace(/ \[[\d.]+m?s\]$/, '')
    : null;
}

/** Spawns `bun test` on `fixture` with `env` set, answering the exit code and the lines the child printed. */
async function spawnFixture(fixture: string, env: Readonly<Record<string, string | undefined>>): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
  const child = Bun.spawn([process.execPath, 'test', fixture], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, lines: `${stdout}\n${stderr}`.split('\n') };
}

/** Runs the store fixture with `fault` planted. */
async function runFixture(fault: string): Promise<FixtureRun> {
  const { exitCode, lines } = await spawnFixture(FIXTURE, { RAFA_HUB_STORE_FAULT: fault });
  const prefix = `${FAIL_MARK}the hub store contract: ${fault} > `;
  const failed = lines.flatMap((line) => titleOf(line, prefix) ?? []);
  return { exitCode, failed };
}

/** The mark a failed case of the extension-off run carries in {@link runIndexFixture}'s titles. */
const EXTENSION_OFF_MARK = 'extension off: ';

/**
 * Runs the index fixture with `fault` planted. A case of the run as
 * configured is titled by its path; one of the run with the extension
 * off is titled by its path after {@link EXTENSION_OFF_MARK}.
 */
async function runIndexFixture(fault: string): Promise<FixtureRun> {
  const { exitCode, lines } = await spawnFixture(INDEX_FIXTURE, { RAFA_HUB_INDEX_FAULT: fault });
  const prefix = `${FAIL_MARK}the hub index contract: ${fault}`;
  const failed = lines.flatMap((line) => {
    const title = titleOf(line, prefix);
    if (title === null) return [];
    if (title.startsWith(' > ')) return [title.slice(' > '.length)];
    const off = ', extension off > ';
    return title.startsWith(off)
      ? [`${EXTENSION_OFF_MARK}${title.slice(off.length)}`]
      : [];
  });
  return { exitCode, failed };
}

/** Each fault, and the cases named for the rule it breaks. */
const FAULT_CASES: readonly (readonly [string, readonly string[]])[] = [
  ['keeps-own-origin', ['pull > answers the rows other devices pushed and never the caller\'s own']],
  ['ignores-cursor', ['pull > answers only the rows pushed past the cursor it answered']],
  ['stamps-pusher', ['pull > excludes by the row\'s origin, not by the device that pushed it']],
  ['repeats-rows', [
    'a repeated push > adds nothing when the same payload is pushed again',
    'a repeated push > adds only the rows an overlapping push had not sent before',
    'a repeated push > keeps a row another device relays once, under its origin pair',
  ]],
  ['forgets-last-push', ['last push per device > records each device\'s latest push at the clock\'s time, in device order']],
  ['miscounts', ['push > counts the rows it holds per table']],
  ['shares-projects', [
    'projects > refuses a push, a pull and a status naming a project not listed, with the line naming hub.projects, and adds nothing',
    'projects > answers a pull from one project none of the other project\'s rows',
    'projects > leaves the other project\'s row counts and devices unchanged by a push to one',
  ]],
  ['edits-rows', ['pull > carries every column as pushed but the recomputed gap, with seq the hub\'s own in rising order past the cursor']],
  ['ignores-limit', [
    'a paged pull > answers at most the limit\'s rows across every table, the caller\'s own counting none',
    'a paged pull > reaches every row once over pages pulled with the cursor each answered, each page but the last full',
  ]],
  ['skips-past-page', ['a paged pull > reaches every row once over pages pulled with the cursor each answered, each page but the last full']],
];

describe('the contract suite against a broken stand-in', () => {
  it('passes the stand-in with nothing broken, as the control', async () => {
    const run = await runFixture('none');

    expect(run).toEqual({ exitCode: 0, failed: [] });
  });

  it('passes the stand-in whose pull rewrites only the gap the merge recomputes', async () => {
    const run = await runFixture('recomputes-gap');

    expect(run).toEqual({ exitCode: 0, failed: [] });
  });

  for (const [fault, cases] of FAULT_CASES) {
    it(`fails the stand-in under ${fault}`, async () => {
      const run = await runFixture(fault);

      expect(run.exitCode).toBe(1);
      expect(cases.filter((title) => !run.failed.includes(title))).toEqual([]);
    });
  }
});

/**
 * The timeout of one index fixture case. Each case spawns the whole index
 * suite in a child `bun test`, measured at 3.7 to 3.8 s on a development
 * machine and past bun's 5 s default on the CI runner (#1581).
 */
const INDEX_FIXTURE_CASE_TIMEOUT_MS = 60_000;

/** Each index fault, and the cases named for the rule it breaks. */
const INDEX_FAULT_CASES: readonly (readonly [string, readonly string[]])[] = [
  ['index-in-store', [
    'a rebuild beside a push > leaves the store\'s identity as the push left it, and swaps a new index in',
    'a rebuild beside a push > leaves the store\'s identity unchanged by a rebuild run alone',
  ]],
  ['answers-bodies', [
    'what a search answers > holds only a table, an origin pair and a score per hit, in frozen records, for fts',
    'what a search answers > holds no row body: no sha, subject or topic text is in the answer',
  ]],
  ['vector-without-load', [
    'vector search on > answers a vector search with every row, nearest first, a score of at most one',
    `${EXTENSION_OFF_MARK}vector search off > answers vector false though an embedder was given`,
  ]],
];

describe('the index contract suite against a broken connector', () => {
  it('passes the connector with nothing broken, as the control', async () => {
    const run = await runIndexFixture('none');

    expect(run).toEqual({ exitCode: 0, failed: [] });
  }, INDEX_FIXTURE_CASE_TIMEOUT_MS);

  for (const [fault, cases] of INDEX_FAULT_CASES) {
    it(`fails the connector under ${fault}`, async () => {
      const run = await runIndexFixture(fault);

      expect(run.exitCode).toBe(1);
      expect(cases.filter((title) => !run.failed.includes(title))).toEqual([]);
    }, INDEX_FIXTURE_CASE_TIMEOUT_MS);
  }
});

/** The fixture a postgres gate run spawns `bun test` on. */
const GATE_FIXTURE = join(import.meta.dir, 'testdata', 'postgres-gate.fixture.ts');

/** A URL whose port refuses every connection. */
const REFUSED_URL = 'postgres://hub:gate-password@127.0.0.1:1/hub';

/** The variables under which bun prints no line for a skipped case, left out of a gate run. */
const QUIET_VARIABLES = Object.freeze({ AGENT: undefined, CLAUDECODE: undefined, REPL_ID: undefined });

/** Runs the gate fixture with `POSTGRES_URL` set to `url`, empty closing the gate. */
function runGate(url: string): ReturnType<typeof spawnFixture> {
  return spawnFixture(GATE_FIXTURE, { ...QUIET_VARIABLES, POSTGRES_URL: url });
}

describe('the postgres gate, spawned', () => {
  it('prints a skip line naming the gate, and fails nothing, when it is closed', async () => {
    const { exitCode, lines } = await runGate('');

    expect(exitCode).toBe(0);
    expect(lines.filter((line) => line.startsWith('(skip) '))).toEqual([`(skip) ${POSTGRES_GATE_SUITE} > ${POSTGRES_SKIP_LINE}`]);
    expect(POSTGRES_SKIP_LINE).toContain('POSTGRES_URL');
  });

  it('fails the gate case when it is open and the connection is refused, repeating no password', async () => {
    const { exitCode, lines } = await runGate(REFUSED_URL);
    const failed = lines.flatMap((line) => titleOf(line, FAIL_MARK) ?? []);

    expect(exitCode).toBe(1);
    expect(failed).toEqual([`${POSTGRES_GATE_SUITE} > ${POSTGRES_GATE_CASE}`]);
    expect(lines.join('\n')).toContain('POSTGRES_URL is set and the connection failed');
    expect(lines.join('\n')).not.toContain('gate-password');
  });

  it('repeats no password of a URL that cannot be parsed', async () => {
    const { exitCode, lines } = await runGate('postgres://hub:gate-password@[unparsed');

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).not.toContain('gate-password');
  });
});
