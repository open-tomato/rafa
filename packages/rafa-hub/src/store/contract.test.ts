/**
 * The hub store contract suite (`contract.ts`) run against the
 * in-memory stand-in (`testdata/memory-store.ts`), then against the
 * stand-in with one rule broken at a time, so a suite whose cases could
 * never fail would fail here instead of passing every adapter.
 *
 * Each broken run is `bun test` spawned on
 * `testdata/broken-store.fixture.ts` with the fault named in its
 * environment, and each is held to fail the case named for the rule it
 * breaks, read off the child's `(fail)` lines. The `none` run is the
 * control: the same harness with nothing broken exits 0 with no case
 * failed, so a fault's failure is the fault's and not the harness's.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { hubStoreContract } from './contract.js';
import { openMemoryHubStore } from './testdata/memory-store.js';

hubStoreContract('in-memory stand-in', openMemoryHubStore);

/** The package directory, whose `tsconfig.json` maps the core subpaths. */
const PACKAGE_DIR = join(import.meta.dir, '..', '..');

/** The fixture a broken run spawns `bun test` on. */
const FIXTURE = join(import.meta.dir, 'testdata', 'broken-store.fixture.ts');

/** How a spawned run marks a failed case. */
const FAIL_MARK = '(fail) ';

/** What one spawned run of the fixture did. */
interface FixtureRun {
  readonly exitCode: number;
  /** Each failed case's title, less the suite prefix and the timing. */
  readonly failed: readonly string[];
}

/** Runs the fixture with `fault` planted. */
async function runFixture(fault: string): Promise<FixtureRun> {
  const child = Bun.spawn([process.execPath, 'test', FIXTURE], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, RAFA_HUB_STORE_FAULT: fault },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const prefix = `${FAIL_MARK}the hub store contract: ${fault} > `;
  const failed = `${stdout}\n${stderr}`
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(/ \[[\d.]+m?s\]$/, ''));
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
];

describe('the contract suite against a broken stand-in', () => {
  it('passes the stand-in with nothing broken, as the control', async () => {
    const run = await runFixture('none');

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
