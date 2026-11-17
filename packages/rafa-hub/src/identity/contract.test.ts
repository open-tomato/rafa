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
 *
 * The stand-in carries a lifecycle hook and registers with
 * `{ lifecycle: true }`, so the lifecycle cases run over it and each has
 * a fault of its own; a second control, the hook left out, holds that
 * those cases are registered only for a subject carrying it.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { identityContract } from './contract.js';
import { memoryIdentitySubject } from './testdata/memory-identity.js';

identityContract('in-memory stand-in', memoryIdentitySubject, { lifecycle: true });

/** The package directory, whose `tsconfig.json` maps the core subpaths. */
const PACKAGE_DIR = join(import.meta.dir, '..', '..');

/** The fixture a broken run spawns `bun test` on. */
const FIXTURE = join(import.meta.dir, 'testdata', 'broken-identity.fixture.ts');

/** How a spawned run marks a failed case. */
const FAIL_MARK = '(fail) ';

/** The summary line a spawned run counts its passed cases on; bun prints no `(pass)` line into a pipe. */
const PASSED = /^ *(\d+) pass$/m;

/** The cases the suite registers for a scheme with a forbidden caller, the lifecycle ones aside. */
const CASES_WITH_FORBIDDEN = 9;

/** The cases the suite adds for a subject carrying a lifecycle hook. */
const LIFECYCLE_CASES = 4;

/** What one spawned run of the fixture did. */
interface FixtureRun {
  readonly exitCode: number;
  /** Each failed case's title, less the suite prefix and the timing. */
  readonly failed: readonly string[];
  /** How many cases passed, read off the run's summary. */
  readonly passed: number;
}

/**
 * Runs the fixture with `fault` planted, registered with `{ forbids,
 * lifecycle }`; the lifecycle hook is carried whenever `forbids` is.
 */
async function runFixture(fault: string, forbids = true, lifecycle = forbids): Promise<FixtureRun> {
  const child = Bun.spawn([process.execPath, 'test', FIXTURE], {
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      RAFA_HUB_IDENTITY_FAULT: fault,
      RAFA_HUB_IDENTITY_FORBIDS: String(forbids),
      RAFA_HUB_IDENTITY_LIFECYCLE: String(lifecycle),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  const prefix = `${FAIL_MARK}the identity contract: ${fault} > `;
  const failed = output
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(/ \[[\d.]+m?s\]$/, ''));
  return { exitCode, failed, passed: Number(PASSED.exec(output)?.[1] ?? Number.NaN) };
}

/** The title of the case holding a served answer's shape. */
const SERVED_SHAPE = 'a served request > names a caller and the hub actions it may take, at least one, each once';

/** The title of the case holding a forbidden refusal. */
const FORBIDDEN = 'a refused request > refuses a known credential lacking permission as forbidden';

/** The title of the case holding refusal messages. */
const MESSAGE = 'a refused request > says why in one line naming no credential the request carried';

/** Each fault, and the cases named for the rule it breaks. */
const FAULT_CASES: readonly (readonly [string, readonly string[]])[] = [
  ['serves-anonymous', ['a refused request > refuses a request carrying no credential as unauthenticated']],
  ['forbids-unrecognised', ['a refused request > refuses a credential it does not recognise as unauthenticated']],
  ['unauthenticates-forbidden', [FORBIDDEN]],
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

/** The title of the created-then-served case. */
const CREATED = 'a credential that comes and goes > serves a credential created after the subject was opened, naming a caller and known actions';

/** The title of the paused-then-forbidden case. */
const PAUSED = 'a credential that comes and goes > refuses a paused credential as forbidden from the next request on, in one line naming it';

/** The title of the deleted case. */
const DELETED = 'a credential that comes and goes > refuses a deleted credential as unauthenticated, told what an unknown one is told';

/** The title of the unknown case. */
const UNKNOWN = 'a credential that comes and goes > refuses a credential never created as unauthenticated once others are';

/** Each lifecycle fault, and the cases named for the rule it breaks. */
const LIFECYCLE_FAULT_CASES: readonly (readonly [string, readonly string[]])[] = [
  ['misses-created', [CREATED]],
  ['ignores-pause', [PAUSED]],
  ['unnamed-pause', [PAUSED]],
  ['pauses-every-key', [PAUSED]],
  ['ignores-delete', [DELETED]],
  ['tells-deleted', [DELETED]],
  ['serves-unknown', [UNKNOWN]],
  ['drops-lifecycle', [SERVED_SHAPE, CREATED, PAUSED, DELETED, UNKNOWN]],
];

describe('the identity contract suite against a broken stand-in', () => {
  it('passes the stand-in with nothing broken, as the control', async () => {
    const run = await runFixture('none');

    expect(run).toEqual({ exitCode: 0, failed: [], passed: CASES_WITH_FORBIDDEN + LIFECYCLE_CASES });
  });

  for (const [fault, cases] of [...FAULT_CASES, ...LIFECYCLE_FAULT_CASES]) {
    it(`fails the stand-in under ${fault}`, async () => {
      const run = await runFixture(fault);

      expect(run.exitCode).toBe(1);
      expect(cases.filter((title) => !run.failed.includes(title))).toEqual([]);
    });
  }
});

describe('the identity contract suite under { forbids: false }', () => {
  it('passes the stand-in with no forbidden headers and registers every case but the forbidden one, as the control', async () => {
    const run = await runFixture('none', false);

    expect(run).toEqual({ exitCode: 0, failed: [], passed: CASES_WITH_FORBIDDEN - 1 });
  });

  for (const [fault, cases] of FAULT_CASES.filter(([name]) => name !== 'unauthenticates-forbidden')) {
    it(`fails the stand-in under ${fault}`, async () => {
      const run = await runFixture(fault, false);

      expect(run.exitCode).toBe(1);
      expect(cases.filter((title) => !run.failed.includes(title))).toEqual([]);
    });
  }
});

describe('the identity contract suite with no lifecycle hook', () => {
  it('passes the stand-in with its hook left out and registers no lifecycle case, as the control', async () => {
    const run = await runFixture('none', true, false);

    expect(run).toEqual({ exitCode: 0, failed: [], passed: CASES_WITH_FORBIDDEN });
  });

  it('refuses { lifecycle: true } under { forbids: false } before registering anything', () => {
    expect(() => identityContract('lifecycle without forbids', memoryIdentitySubject, { forbids: false, lifecycle: true }))
      .toThrow('{ lifecycle: true } needs a forbidden caller');
  });
});
