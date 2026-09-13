/**
 * End-to-end tests for the store's schema-version guard: a store past
 * this rafa's version refuses an ORDINARY caller, not only the store
 * suite's own direct calls into `append`, `writeFindings` or
 * `writeTriage`.
 *
 * Two callers, both already covered at the unit level in
 * `sqlite.test.ts`, `findings.test.ts` and `triage.test.ts`:
 *
 *   - `rafa effort collect`, run as a real subprocess in a scratch git
 *     repository, over a store it already collected once. A second,
 *     ordinary run has nothing new to collect and is the control: it
 *     exits 0 at this rafa's own schema version. Planting a future
 *     version on that same store and running the command again is the
 *     guarded case: the run exits nonzero, the version refusal reaches
 *     its stderr, and the store's bytes are exactly as they were before
 *     the refused run, because nothing it does opens the store for a
 *     write.
 *   - `recordTaskReport`, called directly, over a report that PARSES
 *     but whose three lists are all empty. `writeFindings` runs first
 *     and, with nothing to insert, still opens a store that exists for
 *     its schema check, so the same refusal is thrown before
 *     `writeTriage` ever runs.
 *
 * The command has no seam for its repo root or its session log
 * directory: both are resolved from git and from the home directory
 * respectively, so the case runs it as a subprocess under a HOME of its
 * own, holding an EMPTY session log directory for the scratch repo, the
 * way `collect.test.ts`'s two command cases already do. The scratch
 * repo root is resolved with `realpathSync` before that directory is
 * derived: `getRepoRoot` answers `git rev-parse --show-toplevel`, which
 * resolves `/var`'s symlink to `/private/var` on macOS, so a directory
 * keyed on the unresolved path would sit beside the one the command
 * actually looks under, and the session half would throw on a missing
 * directory instead of reading an empty one.
 *
 * With no session logs at all, the run's ONLY row comes from the one
 * commit `makeRepo` seeds, so "nothing new to collect" holds from the
 * second run onward without needing a planted log tree. The version
 * refusal in the guarded run is reached through `keys('sessions')`,
 * read before either half's `append`, which is a call the SQLite
 * backend has always opened a store for; the empty-append path
 * `sqlite.ts`, `findings.ts` and `triage.ts` were rewired through is
 * exercised in-process below, and unit-level in each module's own
 * suite.
 */
import type { TaskReportInput } from '../report/record.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { sessionLogDir } from '../effort/collect.js';
import { sqliteStorePath, SQLITE_SCHEMA_VERSION } from '../effort/store/sqlite.js';
import { recordTaskReport } from '../report/record.js';

/** The command every black-boxed run executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** One version past this rafa's own, and the wording it refuses with. */
const NEWER_VERSION = SQLITE_SCHEMA_VERSION + 1;
const VERSION_REFUSAL = `is at schema version ${NEWER_VERSION}, past the`
  + ` ${SQLITE_SCHEMA_VERSION} this rafa knows`;

/** Temporary directories removed after every case. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory this file's afterEach will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-version-guard-'));
  scratch.push(dir);
  return dir;
}

/**
 * Runs git in a scratch repository. The `-c` settings keep this
 * machine's own git config (a signing key, a hook directory) out of a
 * commit nothing here inspects.
 */
function git(dir: string, ...args: string[]): void {
  const run = Bun.spawnSync([
    'git',
    '-c',
    'user.name=rafa',
    '-c',
    'user.email=rafa@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    ...args,
  ], { cwd: dir });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  }
}

/** A scratch repo, one commit deep, and the HOME `effort collect` reads under. */
interface Repo {
  readonly root: string;
  readonly home: string;
}

/**
 * A scratch repository holding one commit, beside a HOME of its own
 * whose session log directory for that repo exists and is empty. See
 * the module note on why `root` is resolved with `realpathSync` first.
 */
function makeRepo(): Repo {
  const root = realpathSync(makeScratch());
  const home = makeScratch();
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  mkdirSync(sessionLogDir(root, home), { recursive: true });
  return { root, home };
}

/** What one run of the command did. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `effort collect` inside a repository, as the dispatcher would. */
function runCollect(repo: Repo): CommandRun {
  const run = Bun.spawnSync(
    [process.execPath, RAFA_ENTRY, 'effort', 'collect'],
    { cwd: repo.root, env: { ...process.env, HOME: repo.home } },
  );
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

/** The store file's bytes for one repo. */
function storeBytes(repo: Repo): Buffer {
  return readFileSync(sqliteStorePath(repo.root));
}

/** Plants a schema version one past this rafa's on an existing store file. */
function plantFutureVersion(path: string): void {
  const db = new Database(path);
  db.run(`PRAGMA user_version = ${NEWER_VERSION}`);
  db.close();
}

describe('a nothing-new effort collect run over a future-version store', () => {
  it('exits 0 at the current schema version, and refuses once the store is a version ahead', () => {
    const repo = makeRepo();

    const first = runCollect(repo);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('+1 rows');

    const control = runCollect(repo);
    expect(control.exitCode).toBe(0);
    expect(control.stdout).toContain('+0 rows');
    const beforeGuard = storeBytes(repo);

    plantFutureVersion(sqliteStorePath(repo.root));
    const planted = storeBytes(repo);
    // The plant itself changes the header, so the two are expected to
    // differ; what the guarded run must not do is move it further.
    expect(planted).not.toEqual(beforeGuard);

    const guarded = runCollect(repo);

    expect(guarded.exitCode).not.toBe(0);
    expect(guarded.stdout).toBe('');
    expect(guarded.stderr).toContain(VERSION_REFUSAL);
    expect(storeBytes(repo)).toEqual(planted);
  });
});

describe('recordTaskReport over a future-version store', () => {
  /** A `rafa:report` block holding `lines`. */
  function reportBlock(...lines: string[]): string {
    return ['```rafa:report', ...lines, '```'].join('\n');
  }

  /** A session output: a line of prose, then the block given. */
  function outputOf(block: string): string {
    return ['Work finished.', '', block, ''].join('\n');
  }

  /** A report whose findings list is not empty, to establish the store. */
  const FULL_REPORT = reportBlock(
    'status: done',
    'findings:',
    '  - trigger: "a trigger"',
    '    kind: gotcha',
    '    what: "a what"',
    '    artifact: "an artifact"',
    '    signal: loud',
  );

  /** A report that parses, with findings, blockers and bugs all empty. */
  const EMPTY_REPORT = reportBlock('status: done');

  /** The dispatch every call in this block records under, id aside. */
  const DISPATCH = {
    planStub: 'phase-0b',
    taskLine: 'Guard the store schema version',
  };

  /** One input over `output`, under this block's dispatch. */
  function inputOf(output: string, sessionId: string): TaskReportInput {
    return { dispatch: { ...DISPATCH, sessionId }, outcome: 'done', output };
  }

  it('throws the same version refusal for a report whose lists are all empty', () => {
    const root = makeScratch();
    const record = recordTaskReport(root, inputOf(outputOf(FULL_REPORT), 'aaaa-1111'));
    if (!record.present) throw new Error('the fixture report read as absent');

    const path = sqliteStorePath(root);
    const before = readFileSync(path);
    plantFutureVersion(path);
    const planted = readFileSync(path);
    expect(planted).not.toEqual(before);

    expect(() => recordTaskReport(root, inputOf(outputOf(EMPTY_REPORT), 'bbbb-2222')))
      .toThrow(VERSION_REFUSAL);
    expect(readFileSync(path)).toEqual(planted);
  });
});
