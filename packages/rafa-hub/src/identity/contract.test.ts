/**
 * The identity contract suite (`contract.ts`) run against the in-memory
 * stand-in (`testdata/memory-identity.ts`), then against the stand-in
 * with one rule broken at a time, so a suite whose cases could never
 * fail would fail here instead of passing every adapter.
 *
 * Each broken run is `bun test` spawned on
 * `testdata/broken-identity.fixture.ts` with the fault named in its
 * environment, and each is held to fail the cases named for the rule it
 * breaks, read off the child's `(fail)` lines. The `none` run is the
 * control: the same harness with nothing broken exits 0 with no case
 * failed, so a fault's failure is the fault's and not the harness's.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { identityContract } from './contract.js';
import { memoryIdentitySubject } from './testdata/memory-identity.js';

identityContract('in-memory stand-in', memoryIdentitySubject);

/** The package directory, whose `tsconfig.json` maps the core subpaths. */
const PACKAGE_DIR = join(import.meta.dir, '..', '..');

/** The fixture a broken run spawns `bun test` on. */
const FIXTURE = join(import.meta.dir, 'testdata', 'broken-identity.fixture.ts');

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
    env: { ...process.env, RAFA_HUB_IDENTITY_FAULT: fault },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const prefix = `${FAIL_MARK}the identity contract: ${fault} > `;
  const failed = `${stdout}\n${stderr}`
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(/ \[[\d.]+m?s\]$/, ''));
  return { exitCode, failed };
}

/** The title of the case holding a served answer's shape. */
const SERVED_SHAPE = 'a served request > names a caller and the hub actions it may take, at least one, each once';

/** The title of the case holding refusal messages. */
const MESSAGE = 'a refused request > says why in one line naming no credential the request carried';

/** Each fault, and the cases named for the rule it breaks. */
const FAULT_CASES: readonly (readonly [string, readonly string[]])[] = [
  ['serves-anonymous', ['a refused request > refuses a request carrying no credential as unauthenticated']],
  ['forbids-unrecognised', ['a refused request > refuses a credential it does not recognise as unauthenticated']],
  ['unauthenticates-forbidden', ['a refused request > refuses a known credential lacking permission as forbidden']],
  ['echoes-credential', [MESSAGE]],
  ['splits-message', [MESSAGE]],
  ['grants-nothing', [SERVED_SHAPE]],
  ['grants-unknown', [SERVED_SHAPE]],
  ['repeats-action', [SERVED_SHAPE]],
  ['drifts', ['a served request > answers the same caller and actions each time it is asked']],
  ['route-bound', ['a served request > answers the same on every hub route and method']],
  ['remembers-caller', ['one request, one answer > answers each request from its own credential, whatever was served before']],
  ['reads-body', ['one request, one answer > leaves the request body unread, served or refused']],
];

describe('the identity contract suite against a broken stand-in', () => {
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
