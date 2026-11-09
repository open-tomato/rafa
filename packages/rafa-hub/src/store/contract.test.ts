/**
 * Both contract suites, `contract.ts` for rows and `index-contract.ts`
 * for the index, run over every entry of {@link HUB_CONNECTORS} by name,
 * the index suite twice per connector: once as configured and once with
 * the extension held off, so the vector cases run under both answers.
 * A connector's setup (the embedder, the extension held off) reaches it
 * through {@link INDEX_SETUPS}, keyed by the same names; a connector
 * added without one fails the guard case here.
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
import type { HubIndexConnector, HubIndexFiles } from './index-contract.js';

import { join } from 'node:path';

import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from '../config.js';

import { HUB_CONNECTORS } from './connectors.js';
import { hubStoreContract } from './contract.js';
import { hubIndexContract, INDEX_CONTRACT_EMBEDDER } from './index-contract.js';
import { connectSqliteHub, indexFileName } from './sqlite.js';
import { openMemoryHubStore } from './testdata/memory-store.js';

/** How the index suite opens one connector of {@link HUB_CONNECTORS}, and the files it reads. */
interface IndexSetup {
  readonly connect: HubIndexConnector;
  readonly files: HubIndexFiles;
}

/**
 * The index suite's setup per connector name. `sqlite` holds the
 * extension off the way macOS does with no library named, on a loader
 * state of its own so the process's stays unmarked.
 */
const INDEX_SETUPS: Readonly<Record<string, IndexSetup>> = Object.freeze({
  sqlite: {
    connect: (context, setup) => connectSqliteHub(context, {
      embedder: setup.embedder,
      loader: setup.holdExtensionOff
        ? { library: null, platform: 'darwin', state: createLoaderState() }
        : { state: createLoaderState() },
    }),
    files: { index: indexFileName(DEFAULT_STORE_FILE), store: DEFAULT_STORE_FILE },
  },
});

describe('the connectors both suites run over', () => {
  it('holds an index setup for every connector by name, and none other', () => {
    expect(Object.keys(INDEX_SETUPS).sort()).toEqual(Object.keys(HUB_CONNECTORS).sort());
  });
});

for (const [name, connector] of Object.entries(HUB_CONNECTORS)) {
  hubStoreContract(name, async (context) => (await connector(context)).store);
  const setup = INDEX_SETUPS[name];
  if (setup !== undefined) {
    const options = { embedder: INDEX_CONTRACT_EMBEDDER, files: setup.files };
    hubIndexContract(name, setup.connect, options);
    hubIndexContract(`${name}, extension off`, setup.connect, { ...options, holdExtensionOff: true });
  }
}

hubStoreContract('in-memory stand-in', openMemoryHubStore);

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
async function spawnFixture(fixture: string, env: Readonly<Record<string, string>>): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
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
  ['edits-rows', ['pull > carries every column as pushed but the recomputed gap, with seq the hub\'s own in rising order past the cursor']],
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
    'a rebuild beside a push > leaves the store file\'s sha256 as the push left it, and swaps a new index file in',
    'a rebuild beside a push > leaves the store file\'s sha256 unchanged by a rebuild run alone',
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
