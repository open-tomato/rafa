/**
 * Tests for one named test run on one commit (`base-run.ts`), over both
 * seams: a git stand-in whose `worktree add` makes the folder and plants
 * the test file a commit holds, and a spawner that writes a recorded
 * JUnit report where `bun test` was asked to. No case runs git or bun.
 * The checkout is a temp folder holding a `node_modules` with a marker
 * file, so each case can read that the link reached it and that the
 * clean-up left it whole.
 */
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { SuiteSpawner, SuiteSpawnOptions } from '@open-tomato/rafa/suite/run';

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createBaseRunCache, runNamedTestAt } from './base-run.js';

/** The test file every case names, relative to the checkout. */
const FILE = 'src/a.test.ts';

/** The commit every case runs at, unless it names another. */
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** A report of {@link FILE} holding a passing, a failing and a skipped case. */
const REPORT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuites name="bun test" tests="3">',
  `  <testsuite name="${FILE}" file="${FILE}" tests="3">`,
  `    <testsuite name="outer" file="${FILE}">`,
  `      <testcase name="passes" file="${FILE}" />`,
  `      <testcase name="fails" file="${FILE}"><failure type="AssertionError" message="boom" /></testcase>`,
  '    </testsuite>',
  `    <testcase name="later" file="${FILE}"><skipped /></testcase>`,
  '  </testsuite>',
  '</testsuites>',
].join('\n');

/** One spawn the stand-in saw. */
interface SeenSpawn {
  readonly argv: readonly string[];
  readonly options: SuiteSpawnOptions;
  /** Where the worktree's `node_modules` link pointed when the spawn began, or null. */
  readonly linkTarget: string | null;
}

let scope: string;
let checkout: string;
let tempRoot: string;
let gitCalls: (readonly string[])[];
let spawns: SeenSpawn[];

/** The test files `worktree add` plants, as the commit's tree; `FILE` unless a case says otherwise. */
let committed: readonly string[];

/** What `worktree add` answers; ok unless a case says otherwise. */
let addAnswer: GitResult;

/** What `worktree remove` answers; ok unless a case says otherwise. */
let removeAnswer: GitResult;

const OK: GitResult = { ok: true, stdout: '', stderr: '' };

/** The git stand-in: records each call; `worktree add` makes the folder and plants the committed files. */
const git: GitRunner = (args) => {
  gitCalls.push(args);
  if (args[0] === 'worktree' && args[1] === 'add') {
    if (!addAnswer.ok) return addAnswer;
    const tree = args[4] ?? '';
    for (const file of committed) {
      mkdirSync(dirname(join(tree, file)), { recursive: true });
      writeFileSync(join(tree, file), 'test("x", () => {});\n');
    }
    return addAnswer;
  }
  if (args[0] === 'worktree' && args[1] === 'remove') return removeAnswer;
  return OK;
};

/** The `--reporter-outfile` path of a `bun test` argv. */
function outfileOf(argv: readonly string[]): string {
  return argv.find((arg) => arg.startsWith('--reporter-outfile='))?.slice('--reporter-outfile='.length) ?? '';
}

/** A spawner writing `report` to the JUnit path, or nothing when it is null, and exiting `exitCode`. */
function reporting(report: string | null, exitCode = 1): SuiteSpawner {
  return async (argv, options) => {
    const link = join(options.cwd, 'node_modules');
    const linkTarget = existsSync(link)
      ? readlinkSync(link)
      : null;
    spawns.push({ argv, options, linkTarget });
    if (report !== null) writeFileSync(outfileOf(argv), report);
    return { exitCode, stderr: '' };
  };
}

/** The options of one call, with the spawner `spawn`. */
function options(spawn: SuiteSpawner, cache = createBaseRunCache()) {
  return { checkout, cache, git, spawn, env: { PATH: '/bin' }, tempRoot };
}

/** The `worktree add` calls the stand-in saw. */
function adds(): (readonly string[])[] {
  return gitCalls.filter((args) => args[1] === 'add');
}

beforeEach(() => {
  scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-base-run-test-')));
  checkout = join(scope, 'checkout');
  tempRoot = join(scope, 'temp');
  mkdirSync(join(checkout, 'node_modules'), { recursive: true });
  writeFileSync(join(checkout, 'node_modules', 'marker'), 'keep\n');
  mkdirSync(tempRoot);
  gitCalls = [];
  spawns = [];
  committed = [FILE];
  addAnswer = OK;
  removeAnswer = OK;
});

afterEach(() => {
  rmSync(scope, { recursive: true, force: true });
});

describe('runNamedTestAt, unrunnable', () => {
  it('answers unrunnable with what git said when the worktree add fails, and runs nothing', async () => {
    addAnswer = { ok: false, stdout: '', stderr: 'fatal: invalid reference: deadbeef\n' };

    const answer = await runNamedTestAt('deadbeef', { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: 'Could not check out deadbeef in a temporary worktree: fatal: invalid reference: deadbeef' });
    expect(spawns).toEqual([]);
    expect(gitCalls.filter((args) => args[1] === 'remove')).toEqual([]);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('tries a commit git would not check out once per cache', async () => {
    addAnswer = { ok: false, stdout: '', stderr: 'fatal: invalid reference: deadbeef' };
    const cache = createBaseRunCache();

    await runNamedTestAt('deadbeef', { file: FILE, name: 'outer > passes' }, options(reporting(REPORT), cache));
    const second = await runNamedTestAt('deadbeef', { file: FILE, name: 'outer > fails' }, options(reporting(REPORT), cache));

    expect(second.answer).toBe('unrunnable');
    expect(adds()).toHaveLength(1);
  });

  it('answers unrunnable for a case the report does not hold', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > gone' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: `The run of ${FILE} at 0123456789ab held no case named outer > gone.` });
    // Control: the same report answers a case it holds.
    expect(await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)))).toEqual({ answer: 'green' });
  });

  it('answers unrunnable for a case the report holds as skipped', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'later' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: `The case later of ${FILE} was skipped at 0123456789ab.` });
  });

  it('answers unrunnable when bun test writes no report, as a file that throws while it loads does', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(null)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: `bun test wrote no readable report for ${FILE} at 0123456789ab (exit code 1).` });
    expect(spawns).toHaveLength(1);
  });

  it('answers unrunnable for a file the commit does not hold, and runs nothing', async () => {
    committed = [];

    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: `${FILE} does not exist at 0123456789ab.` });
    expect(spawns).toEqual([]);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('answers unrunnable when the checkout holds no node_modules to link', async () => {
    rmSync(join(checkout, 'node_modules'), { recursive: true });

    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'unrunnable', problem: 'The run checkout holds no node_modules to link into the worktree at 0123456789ab.' });
    expect(spawns).toEqual([]);
  });

  it('runs no file under node_modules or outside the checkout, and calls no git', async () => {
    const run = (file: string) => runNamedTestAt(COMMIT, { file, name: 'x' }, options(reporting(REPORT)));

    expect(await run('node_modules/pkg/a.test.ts')).toEqual({ answer: 'unrunnable', problem: 'node_modules/pkg/a.test.ts is under node_modules, so it is not run.' });
    expect(await run('../elsewhere/a.test.ts')).toEqual({ answer: 'unrunnable', problem: '../elsewhere/a.test.ts is outside the run checkout, so it is not run.' });
    expect(await run('/elsewhere/a.test.ts')).toEqual({ answer: 'unrunnable', problem: '/elsewhere/a.test.ts is outside the run checkout, so it is not run.' });
    expect(gitCalls).toEqual([]);
  });

  it('answers unrunnable for a blank commit or case name, and calls no git', async () => {
    expect(await runNamedTestAt(' ', { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)))).toEqual({
      answer: 'unrunnable',
      problem: 'No commit was given to run the test at.',
    });
    expect(await runNamedTestAt(COMMIT, { file: FILE, name: '' }, options(reporting(REPORT)))).toEqual({
      answer: 'unrunnable',
      problem: `No case of ${FILE} was named to read.`,
    });
    expect(gitCalls).toEqual([]);
  });

  it('answers unrunnable when the spawn throws, and still removes the worktree', async () => {
    const spawn: SuiteSpawner = async () => {
      throw new Error('Executable not found in $PATH: "bun"');
    };

    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(spawn));

    expect(answer).toEqual({ answer: 'unrunnable', problem: `Could not run ${FILE} at 0123456789ab: Executable not found in $PATH: "bun"` });
    expect(gitCalls.filter((args) => args[1] === 'remove')).toHaveLength(1);
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});

describe('runNamedTestAt, green and red', () => {
  it('answers red for a case the report holds as failed', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > fails' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'red' });
  });

  it('answers green for a case the report holds as passed', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT, 0)));

    expect(answer).toEqual({ answer: 'green' });
  });

  it('runs the one file in a detached worktree at the commit, with the checkout\'s node_modules linked in', async () => {
    await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    const [add] = adds();
    const tree = add?.[4] ?? '';
    expect(add).toEqual(['worktree', 'add', '--detach', '--quiet', tree, COMMIT]);
    expect(tree.startsWith(join(tempRoot, 'rafa-base-run-'))).toBe(true);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.options.cwd).toBe(tree);
    expect(spawns[0]?.argv.slice(0, 3)).toEqual(['bun', 'test', `./${FILE}`]);
    expect(spawns[0]?.linkTarget).toBe(join(checkout, 'node_modules'));
    expect(spawns[0]?.options.env).toEqual({ PATH: '/bin' });
  });

  it('reads an absolute path inside the checkout as the path relative to it', async () => {
    const answer = await runNamedTestAt(COMMIT, { file: join(checkout, FILE), name: 'outer > fails' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'red' });
    expect(spawns[0]?.argv[2]).toBe(`./${FILE}`);
  });
});

describe('runNamedTestAt, the clean-up', () => {
  it('removes the worktree and its folder after the run', async () => {
    await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    const tree = adds()[0]?.[4] ?? '';
    expect(gitCalls.filter((args) => args[1] === 'remove')).toEqual([['worktree', 'remove', '--force', tree]]);
    expect(gitCalls.some((args) => args[1] === 'prune')).toBe(false);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('prunes when the remove fails, and leaves the linked node_modules whole', async () => {
    removeAnswer = { ok: false, stdout: '', stderr: 'fatal: not a working tree' };

    const answer = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    expect(answer).toEqual({ answer: 'green' });
    expect(gitCalls.at(-1)).toEqual(['worktree', 'prune']);
    expect(readdirSync(tempRoot)).toEqual([]);
    // Control: the link was there for the run, so the folder removal met it.
    expect(spawns[0]?.linkTarget).toBe(join(checkout, 'node_modules'));
    expect(lstatSync(join(checkout, 'node_modules')).isDirectory()).toBe(true);
    expect(readFileSync(join(checkout, 'node_modules', 'marker'), 'utf8')).toBe('keep\n');
  });
});

describe('runNamedTestAt, the cache', () => {
  it('runs a file once per commit, answering each case from the one report', async () => {
    const cache = createBaseRunCache();

    const green = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT), cache));
    const red = await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > fails' }, options(reporting(REPORT), cache));

    expect([green, red]).toEqual([{ answer: 'green' }, { answer: 'red' }]);
    expect(adds()).toHaveLength(1);
    expect(spawns).toHaveLength(1);
  });

  it('shares one run between two calls made before it ends', async () => {
    const cache = createBaseRunCache();

    const answers = await Promise.all([
      runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT), cache)),
      runNamedTestAt(COMMIT, { file: FILE, name: 'outer > fails' }, options(reporting(REPORT), cache)),
    ]);

    expect(answers).toEqual([{ answer: 'green' }, { answer: 'red' }]);
    expect(spawns).toHaveLength(1);
  });

  it('runs again at another commit, or with another cache', async () => {
    const cache = createBaseRunCache();

    await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT), cache));
    await runNamedTestAt('fedcba9876543210', { file: FILE, name: 'outer > passes' }, options(reporting(REPORT), cache));
    await runNamedTestAt(COMMIT, { file: FILE, name: 'outer > passes' }, options(reporting(REPORT)));

    expect(adds().map((args) => args[5])).toEqual([COMMIT, 'fedcba9876543210', COMMIT]);
    expect(spawns).toHaveLength(3);
  });
});
