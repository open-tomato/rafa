/**
 * Tests for what `rafa pr triage` gathers (`triage-read.ts`): the run id
 * off a check link, the failing job logs through the port, and the
 * conflicting file list through git.
 *
 * The log cases drive a stub answering `failedLog` and nothing else, so
 * what is measured is which runs were ASKED FOR and which reading became
 * the evidence, not what `readFailedLog` makes of a capture — that is
 * `src/pr/triage/evidence.test.ts`.
 *
 * The conflict cases are in two halves:
 *
 *   - A LIVENESS CONTROL against the real git, in a repository of this
 *     file's own holding a constructed two-sided conflict, asserted to
 *     come back as `conflict` with the conflicting path in it. Without
 *     it, every "no conflict" reading here could be a command that
 *     silently answered nothing, since `git merge-tree` exits 1 both for
 *     a real conflict and for a ref it cannot resolve
 *     (`src/pr/triage/conflict.ts`). The clean merge in the same
 *     repository is its pair.
 *   - A recording stub, for the readings a repository cannot easily be
 *     put into: which argv were sent, and that a pair of refs that does
 *     not resolve sends NO `merge-tree` at all.
 *
 * No case reaches a network, no case fetches, and no case touches the
 * repository this file lives in.
 */
import type { CheckRow, GitResult, GitRunner } from '../../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { logFailedText } from '../../pr/gh-fake.js';
import { createGitRunner } from '../../pr/index.js';

import {
  baseCandidates,
  CONFLICT_UNREAD,
  failingRuns,
  headCandidates,
  readConflictFiles,
  readFailedLogs,
  resolvesRef,
  runIdOf,
  unlinkedChecks,
} from './triage-read.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-triage-read-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A check row as `parseChecks` answers one. */
function row(name: string, state: string, link: string): CheckRow {
  const outcome = state === 'FAILURE'
    ? 'fail'
    : 'pass';
  return { name, state, link, outcome };
}

/** A failing row pointing at Actions run `id`. */
function failing(name: string, id: string): CheckRow {
  return row(name, 'FAILURE', `https://github.com/open-tomato/rafa/actions/runs/${id}/job/${id}9`);
}

/** A stub answering `failedLog` from `logs`, recording every id asked for. */
function logReader(logs: Readonly<Record<string, string | Error>>): {
  readonly pulls: { failedLog: (id: string) => Promise<string> };
  readonly asked: () => readonly string[];
} {
  const asked: string[] = [];
  return {
    pulls: {
      failedLog: (id) => {
        asked.push(id);
        const answer = logs[id];
        if (answer instanceof Error) return Promise.reject(answer);
        return Promise.resolve(answer ?? '');
      },
    },
    asked: () => [...asked],
  };
}

/** A git runner answering `answers` by the argv joined with spaces, recording every call. */
function stubGit(answers: Readonly<Record<string, GitResult>>): {
  readonly git: GitRunner;
  readonly calls: () => readonly string[];
} {
  const calls: string[] = [];
  return {
    git: (args) => {
      const line = args.join(' ');
      calls.push(line);
      return answers[line] ?? { ok: false, stdout: '', stderr: 'stub git: nothing planted' };
    },
    calls: () => [...calls],
  };
}

/** Writes every entry, making the parent directories a path needs. */
function writeAll(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

/** A repository of this case's own, on `main`, with `seed` in one commit. */
function plantRepo(name: string, seed: Readonly<Record<string, string>>): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  const git = createGitRunner(root);
  git(['init', '--quiet', '--initial-branch=main', '.']);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  writeAll(root, seed);
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'base']);
  return root;
}

/** Commits `files` on a branch made from `main`, then leaves `main` checked out. */
function plantBranch(root: string, branch: string, files: Readonly<Record<string, string>>): void {
  const git = createGitRunner(root);
  git(['switch', '--quiet', '--create', branch, 'main']);
  writeAll(root, files);
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', branch]);
  git(['switch', '--quiet', 'main']);
}

/** The commit a ref resolves to in `root`. */
function commitOf(root: string, ref: string): string {
  return createGitRunner(root)(['rev-parse', ref]).stdout.trim();
}

describe('the run id off a check link', () => {
  it('reads the run out of an Actions job link, which is what gh pr checks answers', () => {
    expect(runIdOf('https://github.com/open-tomato/rafa/actions/runs/9006/job/24913')).toBe('9006');
  });

  it('reads a run link with no job on it, and one carrying a query', () => {
    expect(runIdOf('https://github.com/open-tomato/rafa/actions/runs/9006')).toBe('9006');
    expect(runIdOf('https://github.com/open-tomato/rafa/actions/runs/9006?check_suite_focus=true')).toBe('9006');
  });

  it('answers null for a status context URL, so no other job is quoted as this pull request evidence', () => {
    expect(runIdOf('https://circleci.com/gh/open-tomato/rafa/9006')).toBeNull();
    expect(runIdOf('')).toBeNull();
  });
});

describe('which runs the failing rows name', () => {
  it('names each run once, in the order the failing rows came, with the checks pointing at it', () => {
    const rows = [
      row('build', 'SUCCESS', 'https://github.com/open-tomato/rafa/actions/runs/1/job/2'),
      failing('gates', '9006'),
      failing('snapshot', '9006'),
      failing('docs', '9007'),
    ];

    expect([...failingRuns(rows)]).toEqual([['9006', ['gates', 'snapshot']], ['9007', ['docs']]]);
  });

  it('names the failing checks whose link points at no Actions run', () => {
    const rows = [failing('gates', '9006'), row('ci/circle', 'FAILURE', 'https://circleci.com/gh/x/1')];

    expect(unlinkedChecks(rows)).toEqual(['ci/circle']);
    expect([...failingRuns(rows).keys()]).toEqual(['9006']);
  });
});

describe('the failing job logs', () => {
  it('asks for each distinct run once and takes the reading that named a step as the evidence', async () => {
    const reader = logReader({
      '9006': logFailedText('snapshot', ['nothing to see']),
      '9007': 'docs\tbunx tsc --noEmit\t2026-09-18T11:30:00Z ##[error]TS2345\n',
    });

    const reading = await readFailedLogs(reader.pulls, [failing('snapshot', '9006'), failing('docs', '9007')]);

    expect(reader.asked()).toEqual(['9006', '9007']);
    expect(reading.readings.map((one) => one.runId)).toEqual(['9006', '9007']);
    expect(reading.chosen?.runId).toBe('9007');
    expect(reading.chosen?.evidence.step?.name).toBe('bunx tsc --noEmit');
  });

  it('falls back on the first reading with lines in it when no capture named a step', async () => {
    const reader = logReader({ '9006': logFailedText('gates', ['boom']), '9007': '' });

    const reading = await readFailedLogs(reader.pulls, [failing('gates', '9006'), failing('docs', '9007')]);

    expect(reading.chosen?.runId).toBe('9006');
    expect(reading.chosen?.evidence.step).toBeUndefined();
  });

  it('reads a log GitHub has dropped as an ordinary empty reading, chosen by nothing', async () => {
    const reader = logReader({ '9006': '' });

    const reading = await readFailedLogs(reader.pulls, [failing('gates', '9006')]);

    expect(reading.readings[0]?.evidence.lines).toEqual([]);
    expect(reading.chosen).toBeNull();
    expect(reading.problems).toEqual([]);
  });

  it('reports a failedLog that rejected instead of throwing, and reads the runs after it', async () => {
    const reader = logReader({ '9006': new Error('HTTP 403: rate limited'), '9007': logFailedText('docs', ['boom']) });

    const reading = await readFailedLogs(reader.pulls, [failing('gates', '9006'), failing('docs', '9007')]);

    expect(reading.problems).toEqual(['the failing log of run 9006 could not be read: HTTP 403: rate limited']);
    expect(reading.chosen?.runId).toBe('9007');
  });

  it('asks for nothing at all when no row is failing', async () => {
    const reader = logReader({});

    const reading = await readFailedLogs(reader.pulls, [row('gates', 'SUCCESS', 'https://x/actions/runs/1')]);

    expect(reader.asked()).toEqual([]);
    expect(reading.chosen).toBeNull();
  });
});

describe('the refs a conflict is read between', () => {
  const refs = {
    baseRefName: 'main',
    headRefName: 'feat/thing',
    headRefOid: '0badc0ffee',
    isCrossRepository: false,
  };

  it('tries the remote-tracking base first, since that is what GitHub merged into', () => {
    expect(baseCandidates(refs)).toEqual(['origin/main', 'main']);
  });

  it('tries the pinned head commit first, then the remote-tracking head branch', () => {
    expect(headCandidates(refs)).toEqual(['0badc0ffee', 'origin/feat/thing']);
  });

  it('tries the pinned commit alone for a fork, which has no tracking ref here', () => {
    expect(headCandidates({ ...refs, isCrossRepository: true })).toEqual(['0badc0ffee']);
  });
});

describe('the conflicting file list', () => {
  it('reads a constructed two-sided conflict as a conflict, with the path in it', () => {
    const root = plantRepo('live-conflict', { 'conflicted.txt': 'first\nsecond\nthird\n' });
    plantBranch(root, 'left', { 'conflicted.txt': 'first\nLEFT\nthird\n' });
    plantBranch(root, 'right', { 'conflicted.txt': 'first\nRIGHT\nthird\n' });

    const reading = readConflictFiles(createGitRunner(root), {
      baseRefName: 'left',
      headRefName: 'right',
      headRefOid: commitOf(root, 'right'),
      isCrossRepository: true,
    });

    expect(reading.kind).toBe('conflict');
    expect(reading.files).toEqual(['conflicted.txt']);
    expect(reading.base).toBe('left');
  });

  it('reads a head that merges into the base as clean, with no files, in the same repository shape', () => {
    const root = plantRepo('live-clean', { 'a.txt': 'one\n' });
    plantBranch(root, 'left', { 'b.txt': 'two\n' });

    const reading = readConflictFiles(createGitRunner(root), {
      baseRefName: 'main',
      headRefName: 'left',
      headRefOid: commitOf(root, 'left'),
      isCrossRepository: true,
    });

    expect(reading.kind).toBe('clean');
    expect(reading.files).toEqual([]);
  });

  it('answers unread, and sends no merge-tree, when no candidate ref resolves', () => {
    const stub = stubGit({});

    const reading = readConflictFiles(stub.git, {
      baseRefName: 'main',
      headRefName: 'feat/thing',
      headRefOid: '0badc0ffee',
      isCrossRepository: false,
    });

    expect(reading.kind).toBe(CONFLICT_UNREAD);
    expect(reading.files).toEqual([]);
    expect(reading.base).toBeNull();
    expect(reading.tried).toEqual(['origin/main', 'main', '0badc0ffee', 'origin/feat/thing']);
    expect(stub.calls().filter((call) => call.startsWith('merge-tree'))).toEqual([]);
  });

  it('falls back on the plain base branch when the remote-tracking one does not resolve', () => {
    const ok = { ok: true, stdout: '', stderr: '' };
    const stub = stubGit({
      'rev-parse --verify --quiet main^{commit}': ok,
      'rev-parse --verify --quiet 0badc0ffee^{commit}': ok,
      'merge-tree --write-tree --name-only -z main 0badc0ffee': { ok: true, stdout: '', stderr: '' },
    });

    const reading = readConflictFiles(stub.git, {
      baseRefName: 'main',
      headRefName: 'feat/thing',
      headRefOid: '0badc0ffee',
      isCrossRepository: false,
    });

    expect(reading.base).toBe('main');
    expect(reading.head).toBe('0badc0ffee');
    expect(stub.calls().at(-1)).toBe('merge-tree --write-tree --name-only -z main 0badc0ffee');
  });

  it('resolves a ref only when git verifies it as a commit', () => {
    const root = plantRepo('resolve', { 'a.txt': 'one\n' });

    expect(resolvesRef(createGitRunner(root), 'main')).toBe(true);
    expect(resolvesRef(createGitRunner(root), 'origin/main')).toBe(false);
  });

  it('plants every repository under its own temporary directory', () => {
    expect(tempBase.startsWith(realpathSync(tmpdir()))).toBe(true);
  });
});
