/**
 * The position file (`position.ts`) exercised end to end, past the seams
 * `position.test.ts` mocks: a real git repository reading a real
 * `.gitignore` under `tracking.all`, and two real OS processes writing
 * the file at once.
 *
 * ## The repository case
 *
 * `writeTrackingGitignore` (`./gitignore.ts`) and `writePositionFile` run
 * over one scratch git repository, and `git status --porcelain` is read
 * the way an operator reads it, so the case fails if the `.rafa/*`
 * re-include ever widens to catch the position file the way it catches
 * an ordinary tracked path. Every git here runs with its global and
 * system config switched off and its home in the temporary root, as
 * `gitignore.test.ts` runs it, so no case reads the operator's own
 * ignores or repository.
 *
 * ## The racing case
 *
 * Two real child processes, not two calls in this process, each hammer
 * `writePositionFile` at the same file with a place of its own. A single
 * process interleaves nothing around a synchronous `writeFileSync` and
 * `renameSync`, so a race that matters here can only show up in a second
 * OS process's write landing between this one's temporary write and its
 * rename. After both exit, the directory holds the one file and nothing
 * with a `.tmp` suffix, and the file `readPositionFile` reads back is one
 * racer's whole place, never a splice of both.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '../tests/git-identity.js';

import { writeTrackingGitignore } from './gitignore.js';
import { positionAt, positionFilePath, readPositionFile, writePositionFile } from './position.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-position-integration-')));
/** The home and XDG config directory every git here runs with; see the module note. */
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);
/** The absolute path to `position.ts`, handed to each racer process. */
const POSITION_MODULE = fileURLToPath(new URL('./position.ts', import.meta.url));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** A fresh directory under the temporary root, as a real path. */
function freshDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${String(planted)}`);
  mkdirSync(dir);
  return realpathSync(dir);
}

/** The environment every git here runs with; see the module note. */
function gitEnv(): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
}

/** Runs git in `cwd` and answers its exit code, stdout and stderr. */
function runGit(cwd: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  if (run.error !== undefined) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** A fresh git repository, initialized and otherwise empty. */
function freshRepo(): string {
  const repo = freshDir();
  const init = runGit(repo, ['init', '-q']);
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
  return repo;
}

describe('the position file under tracking.all, in a real repository', () => {
  it('never appears in git status --porcelain after a write', () => {
    const root = freshRepo();
    writeTrackingGitignore(root, { trackingSpecs: false, trackingPlans: false, trackingAll: true });
    writePositionFile(root, positionAt({ board: 10, epic: 20 }));
    // A control the entry does not touch, so a status reading nothing at
    // all would pass the assertion below for the wrong reason.
    writeFileSync(join(root, 'README.md'), '# demo\n');

    const status = runGit(root, ['status', '--porcelain']);
    expect(status.status).toBe(0);
    const lines = status.stdout.split('\n').filter((line) => line !== '');

    expect(lines.some((line) => line.includes('.rafa/position.json'))).toBe(false);
    expect(lines.some((line) => line.includes('README.md'))).toBe(true);
  });
});

/** One racer's source: `iterations` writes of `board`'s place, nothing else. */
function racerSource(root: string, board: number, iterations: number): string {
  return [
    `import { writePositionFile, positionAt } from ${JSON.stringify(POSITION_MODULE)};`,
    `const root = ${JSON.stringify(root)};`,
    `const board = ${String(board)};`,
    `for (let i = 0; i < ${String(iterations)}; i += 1) {`,
    '  writePositionFile(root, positionAt({ board, epic: null }));',
    '}',
  ].join('\n');
}

/** Runs one racer as a real child process, rejecting on a non-zero exit. */
function runRacer(root: string, board: number, iterations: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = Bun.spawn(['bun', '-e', racerSource(root, board, iterations)], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    void (async () => {
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`racer for board ${String(board)} exited ${String(code)}: ${stderr}`));
    })();
  });
}

describe('two writers racing over the position file', () => {
  it('leave one whole, parsable file, never a splice of both', async () => {
    const root = freshDir();
    const racers = [10, 20];
    await Promise.all(racers.map((board) => runRacer(root, board, 200)));

    const dir = dirname(positionFilePath(root));
    expect(readdirSync(dir)).toEqual(['position.json']);

    const reading = readPositionFile(root);
    expect(reading.set).toBe(true);
    if (!reading.set) return;
    expect(racers).toContain(reading.position.current.board);
    expect(reading.position.current.epic).toBeNull();
    expect(reading.position.current).toEqual(reading.position.home);

    // The file on disk parses the same way readPositionFile read it, so
    // the reader is not papering over a shape the file does not hold.
    expect(JSON.parse(readFileSync(positionFilePath(root), 'utf8'))).toEqual(reading.position);
  });
});
