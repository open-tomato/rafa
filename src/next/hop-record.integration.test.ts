/**
 * The hop record (`hop-record.ts`) exercised end to end, past the seams
 * `hop-record.test.ts` mocks, the way `position.integration.test.ts`
 * exercises the position file it sits beside:
 *
 * ## The repository case
 *
 * `writeTrackingGitignore`, `writePositionFile` and `writeHopRecord` run
 * over one scratch git repository, and `git status --porcelain` is read
 * the way an operator reads it: neither `.rafa/position.json` nor
 * `.rafa/hop.json` may ever appear in it under `tracking.all`, the shape
 * `src/project/gitignore.ts`'s module note gives both files. Every git
 * here runs with its global and system config switched off and its home
 * in the temporary root, as `position.integration.test.ts` and
 * `gitignore.test.ts` run it, so no case reads the operator's own
 * ignores or repository.
 *
 * ## The racing case
 *
 * Two real child processes, not two calls in this process, each hammer
 * `writeHopRecord` at the same file with a record of its own, the way
 * `position.integration.test.ts` races `writePositionFile`. After both
 * exit, the directory holds the one file and nothing with a `.tmp`
 * suffix, and `readHopRecord` reads back one racer's whole record, never
 * a splice of both.
 *
 * ## The staleness case
 *
 * A hop record is planted by hand with a `home` no board in the fixture
 * names, then a plain, spawned `rafa switch <n>` rewrites
 * `.rafa/position.json`'s home to the board it moves to: `staleAgainst`
 * reads the record against the position `readPositionFile` reads back,
 * and it must answer true, the way the module note says a hand switch
 * leaves the record. The switch runs against a one-board fixture served
 * by a stand-in `gh`, the same shape `board-switch-status-cli.test.ts`
 * serves a real switch with, trimmed to the one board this case moves to.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeTrackingGitignore } from '../project/gitignore.js';
import { positionAt, readPositionFile, writePositionFile } from '../project/position.js';
import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { hopFilePath, readHopRecord, staleAgainst, writeHopRecord } from './hop-record.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hop-record-integration-')));
/** The home and XDG config directory every plain git here runs with; see the module note. */
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);
/** The absolute path to `hop-record.ts`, handed to each racer process. */
const HOP_RECORD_MODULE = fileURLToPath(new URL('./hop-record.ts', import.meta.url));

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

/** The environment every plain git here runs with; see the module note. */
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
  const run = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() as Record<string, string> });
  return {
    status: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

/** A fresh git repository, initialized and otherwise empty. */
function freshRepo(): string {
  const repo = freshDir();
  const init = runGit(repo, ['init', '-q']);
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
  return repo;
}

/** A minimal, valid `dry` hop record, `targetBoard` naming the racer that wrote it. */
function dryRecord(targetBoard: number): Parameters<typeof writeHopRecord>[1] {
  return {
    kind: 'dry',
    home: { board: 1, epic: null },
    from: { board: 2, epic: null },
    blocked: null,
    target: null,
    targetEpic: 1,
    targetBoard,
    state: 'away',
    pullRequest: null,
    startedAt: '2026-09-28T00:00:00.000Z',
  };
}

describe('the hop record and the position file under tracking.all, in a real repository', () => {
  it('never appear in git status --porcelain after a write', () => {
    const root = freshRepo();
    writeTrackingGitignore(root, { trackingSpecs: false, trackingPlans: false, trackingAll: true });
    writePositionFile(root, positionAt({ board: 10, epic: 20 }));
    writeHopRecord(root, dryRecord(10));
    // A control the entry does not touch, so a status reading nothing at
    // all would pass the assertions below for the wrong reason.
    writeFileSync(join(root, 'README.md'), '# demo\n');

    const status = runGit(root, ['status', '--porcelain']);
    expect(status.status).toBe(0);
    const lines = status.stdout.split('\n').filter((line) => line !== '');

    expect(lines.some((line) => line.includes('.rafa/position.json'))).toBe(false);
    expect(lines.some((line) => line.includes('.rafa/hop.json'))).toBe(false);
    expect(lines.some((line) => line.includes('README.md'))).toBe(true);
  });
});

/** One racer's source: `iterations` writes of a dry record naming `targetBoard`, nothing else. */
function racerSource(root: string, targetBoard: number, iterations: number): string {
  return [
    `import { writeHopRecord } from ${JSON.stringify(HOP_RECORD_MODULE)};`,
    `const root = ${JSON.stringify(root)};`,
    `const targetBoard = ${String(targetBoard)};`,
    `const record = ${JSON.stringify(dryRecord(0))};`,
    'for (let i = 0; i < ' + String(iterations) + '; i += 1) {',
    '  writeHopRecord(root, { ...record, targetBoard });',
    '}',
  ].join('\n');
}

/** Runs one racer as a real child process, failing on a non-zero exit. */
async function runRacer(root: string, targetBoard: number, iterations: number): Promise<void> {
  const child = Bun.spawn(['bun', '-e', racerSource(root, targetBoard, iterations)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expectExit({ exitCode, stdout, stderr }, 0, { root });
}

describe('two writers racing over the hop record', () => {
  it('leave one whole, parsable record, never a splice of both', async () => {
    const root = freshDir();
    const racers = [10, 20];
    await Promise.all(racers.map((targetBoard) => runRacer(root, targetBoard, 200)));

    const dir = dirname(hopFilePath(root));
    expect(readdirSync(dir).filter((name) => name.startsWith('hop.json'))).toEqual(['hop.json']);

    const reading = readHopRecord(root);
    expect(reading.set).toBe(true);
    if (!reading.set) return;
    expect(racers).toContain(reading.record.targetBoard);
    expect(reading.record.kind).toBe('dry');
    expect(reading.record.blocked).toBeNull();
    expect(reading.record.target).toBeNull();

    // The file on disk parses the same way readHopRecord read it, so the
    // reader is not papering over a shape the file does not hold.
    expect(JSON.parse(readFileSync(hopFilePath(root), 'utf8'))).toEqual(reading.record);
  });
});

/** How long a spawned `rafa switch` may take: one local `gh` read, no network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The one board this suite's fixture names, with no epic on its checklist. */
const BOARD = 10;

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the one general
 * `gh issue list` call `rafa switch` reads its board listing with, and
 * nothing else. Anything unplanned fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  const boardRow = {
    number: BOARD,
    title: 'Board Alpha',
    body: '',
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:roadmap' }],
  };
  writeFileSync(join(data, 'all.json'), JSON.stringify([boardRow]), 'utf8');

  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'case "$1 $2" in',
    `  "issue list") ${printFile(join(data, 'all.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/**
 * Makes `scratch` a project with one commit on `main`, so the switch runs
 * against a real, committed repository, and plants the stand-in `gh`
 * above.
 */
function plantWorld(base: string): ScratchRepo {
  const scratch = plantScratchRepo(base, { project: false });
  plantProjectConfig(scratch.repo, 'pr:\n  provider: gh\n');
  const env = { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  git(['add', '-A']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
  writeGhStub(scratch);
  return scratch;
}

describe('a hop record against a position a plain rafa switch rewrites', () => {
  it('reads stale once switch\'s new home differs from the record\'s own', RUN_TIMEOUT, () => {
    const scratch = plantWorld(tempRoot);
    writeHopRecord(scratch.repo, {
      kind: 'dry',
      home: { board: 999, epic: null },
      from: { board: 1, epic: null },
      blocked: null,
      target: null,
      targetEpic: 1,
      targetBoard: 1,
      state: 'away',
      pullRequest: null,
      startedAt: '2026-09-28T00:00:00.000Z',
    });

    const moved = runRafa(scratch, scratch.repo, ['switch', String(BOARD)]);
    expectExit(moved, 0, scratch);

    const position = readPositionFile(scratch.repo);
    expect(position.set).toBe(true);
    if (!position.set) return;
    expect(position.position.home).toEqual({ board: BOARD, epic: null });

    const reading = readHopRecord(scratch.repo);
    expect(reading.set).toBe(true);
    if (!reading.set) return;
    expect(staleAgainst(reading.record, position.position)).toBe(true);
  });
});
