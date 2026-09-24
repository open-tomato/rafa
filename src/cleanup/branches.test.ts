/**
 * `readBranches` over a scripted git, for the parsing and the
 * never-listed set, and once over a real clone of a bare remote, so the
 * format and the track spellings the module note records are read from
 * git itself rather than from this file's script.
 */
import type { ParsedLine } from './branches.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { DEFAULT_BASE_BRANCH } from '../next/sources.js';
import { createGitRunner } from '../pr/git.js';

import { BRANCH_FORMAT, isKept, parseBranchLine, readBranches, resolveBaseBranch } from './branches.js';

const FOR_EACH_REF = ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'];
const SYMBOLIC_REF = ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'];

/** A git that answers `answers[argv joined by spaces]`, recording every call. */
function scriptedGit(answers: Record<string, GitResult>): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push([...args]);
    const answer = answers[args.join(' ')];
    if (answer === undefined) {
      throw new Error(`unscripted git call: ${args.join(' ')}`);
    }
    return answer;
  };
  return { git, calls };
}

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function line(name: string, upstream: string, track: string, unix: number, head = ' '): string {
  return [name, upstream, track, String(unix), head].join('\t');
}

const LISTING = [
  line('ahead', 'origin/ahead', 'ahead 2, behind 1', 1790228800),
  line('feature', 'origin/feature', '', 1790000000, '*'),
  line('gone', 'origin/gone', 'gone', 1790228799),
  line('local', '', '', 1790228799),
  line('main', 'origin/main', '', 1790228799),
  line('release/a/b', '', '', 1790228800),
  line('release/x', '', '', 1790228800),
  line('trunk', 'origin/trunk', '', 1790228799),
].join('\n') + '\n';

function scriptedListing(base: GitResult): ReturnType<typeof scriptedGit> {
  return scriptedGit({ [FOR_EACH_REF.join(' ')]: said(LISTING), [SYMBOLIC_REF.join(' ')]: base });
}

/** The parsed line, or a throw naming why it was refused. */
function readLine(parsed: ParsedLine | string): ParsedLine {
  if (typeof parsed === 'string') {
    throw new Error(parsed);
  }
  return parsed;
}

describe('parseBranchLine', () => {
  it('reads a branch with no upstream as neither gone nor ahead', () => {
    expect(parseBranchLine(line('local', '', '', 1790228799))).toEqual({
      current: false,
      branch: { name: 'local', upstream: null, gone: false, ahead: null, lastCommit: new Date(1790228799000) },
    });
  });

  it('reads a branch level with its upstream as zero ahead', () => {
    const parsed = parseBranchLine(line('main', 'origin/main', '', 1));
    expect(readLine(parsed).branch.ahead).toBe(0);
  });

  it('reads the ahead count out of an ahead-and-behind track', () => {
    const parsed = parseBranchLine(line('ahead', 'origin/ahead', 'ahead 12, behind 3', 1));
    expect(readLine(parsed).branch.ahead).toBe(12);
  });

  it('reads a behind-only track as zero ahead', () => {
    const parsed = parseBranchLine(line('behind', 'origin/behind', 'behind 4', 1));
    expect(readLine(parsed).branch.ahead).toBe(0);
  });

  it('reads a gone upstream as gone, keeping its name, with no ahead count', () => {
    expect(parseBranchLine(line('gone', 'origin/gone', 'gone', 5))).toEqual({
      current: false,
      branch: { name: 'gone', upstream: 'origin/gone', gone: true, ahead: null, lastCommit: new Date(5000) },
    });
  });

  it('reads the star as the current branch', () => {
    const parsed = parseBranchLine(line('feature', '', '', 1, '*'));
    expect(readLine(parsed).current).toBe(true);
  });

  it('answers why when a line has the wrong number of fields', () => {
    expect(parseBranchLine('main\torigin/main')).toBe(
      'git for-each-ref wrote a line with 2 fields, expected 5: "main\\torigin/main"',
    );
  });

  it('answers why when a line carries no commit date', () => {
    expect(parseBranchLine(line('main', '', '', Number.NaN))).toBe(
      'git for-each-ref wrote no commit date for main: "NaN"',
    );
  });
});

describe('resolveBaseBranch', () => {
  it('answers pr.base without running git', () => {
    const { git, calls } = scriptedGit({});
    expect(resolveBaseBranch(git, 'develop')).toBe('develop');
    expect(calls).toEqual([]);
  });

  it('answers the branch origin/HEAD names when pr.base is unset', () => {
    const { git } = scriptedGit({ [SYMBOLIC_REF.join(' ')]: said('origin/trunk\n') });
    expect(resolveBaseBranch(git, null)).toBe('trunk');
  });

  it('falls back to the default base when origin/HEAD is not set', () => {
    const { git } = scriptedGit({ [SYMBOLIC_REF.join(' ')]: { ok: false, stdout: '', stderr: '' } });
    expect(resolveBaseBranch(git, null)).toBe(DEFAULT_BASE_BRANCH);
  });
});

describe('isKept', () => {
  it('matches a pattern whose star stops at a slash', () => {
    expect(isKept('release/x', ['release/*'])).toBe(true);
    expect(isKept('release/a/b', ['release/*'])).toBe(false);
    expect(isKept('release/a/b', ['release/**'])).toBe(true);
  });

  it('matches an exact name and keeps nothing with no patterns', () => {
    expect(isKept('keep-me', ['keep-me'])).toBe(true);
    expect(isKept('keep-me', [])).toBe(false);
  });
});

describe('readBranches', () => {
  it('reads every branch from one for-each-ref call', () => {
    const { git, calls } = scriptedListing(said('origin/main\n'));
    readBranches(git, { base: null, keep: [] });
    expect(calls.filter((call) => call[0] === 'for-each-ref')).toEqual([FOR_EACH_REF]);
  });

  it('drops the current branch and the base origin/HEAD names', () => {
    const { git } = scriptedListing(said('origin/main\n'));
    const reading = readBranches(git, { base: null, keep: [] });
    expect(reading.ok && reading.base).toBe('main');
    expect(reading.ok && reading.branches.map((branch) => branch.name))
      .toEqual(['ahead', 'gone', 'local', 'release/a/b', 'release/x', 'trunk']);
  });

  it('drops pr.base rather than the branch origin/HEAD names', () => {
    const { git } = scriptedListing(said('origin/main\n'));
    const reading = readBranches(git, { base: 'trunk', keep: [] });
    expect(reading.ok && reading.base).toBe('trunk');
    expect(reading.ok && reading.branches.map((branch) => branch.name))
      .toEqual(['ahead', 'gone', 'local', 'main', 'release/a/b', 'release/x']);
  });

  it('drops every branch a cleanup.keep pattern matches', () => {
    const { git } = scriptedListing(said('origin/main\n'));
    const reading = readBranches(git, { base: null, keep: ['release/*', 'local'] });
    expect(reading.ok && reading.branches.map((branch) => branch.name))
      .toEqual(['ahead', 'gone', 'release/a/b', 'trunk']);
  });

  it('answers what git said when for-each-ref fails', () => {
    const { git } = scriptedGit({
      [SYMBOLIC_REF.join(' ')]: said('origin/main\n'),
      [FOR_EACH_REF.join(' ')]: { ok: false, stdout: '', stderr: 'fatal: not a git repository\n' },
    });
    expect(readBranches(git, { base: null, keep: [] }))
      .toEqual({ ok: false, detail: 'git for-each-ref failed: fatal: not a git repository' });
  });

  it('answers the unreadable line rather than a partial listing', () => {
    const { git } = scriptedGit({ [FOR_EACH_REF.join(' ')]: said(`${line('a', '', '', 1)}\nbroken\n`) });
    expect(readBranches(git, { base: 'main', keep: [] })).toEqual({
      ok: false,
      detail: 'git for-each-ref wrote a line with 1 fields, expected 5: "broken"',
    });
  });

  it('answers no branches for an empty listing', () => {
    const { git } = scriptedGit({ [FOR_EACH_REF.join(' ')]: said('') });
    expect(readBranches(git, { base: 'main', keep: [] })).toEqual({ ok: true, base: 'main', branches: [] });
  });
});

describe('readBranches over a real clone', () => {
  const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-branches-')));

  afterAll(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  function run(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        LC_ALL: 'C',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
  }

  it('reads upstream, gone, ahead and the never-listed set from git itself', () => {
    const remote = join(tempBase, 'remote.git');
    const work = join(tempBase, 'work');
    run(tempBase, 'init', '-q', '--bare', '-b', 'main', remote);
    run(tempBase, 'clone', '-q', remote, work);
    run(work, 'commit', '-q', '--allow-empty', '-m', 'first');
    run(work, 'push', '-q', '-u', 'origin', 'main');
    run(work, 'remote', 'set-head', 'origin', 'main');
    // gone: pushed, deleted remotely, pruned.
    run(work, 'switch', '-q', '-c', 'gone');
    run(work, 'push', '-q', '-u', 'origin', 'gone');
    run(work, 'push', '-q', 'origin', '--delete', 'gone');
    run(work, 'fetch', '-q', '--prune');
    // ahead: tracks a remote branch, two commits past it and one behind.
    run(work, 'switch', '-q', '-c', 'ahead', 'main');
    run(work, 'push', '-q', '-u', 'origin', 'ahead');
    run(work, 'commit', '-q', '--allow-empty', '-m', 'upstream only');
    run(work, 'push', '-q', 'origin', 'ahead');
    run(work, 'reset', '-q', '--hard', 'HEAD~1');
    run(work, 'commit', '-q', '--allow-empty', '-m', 'local one');
    run(work, 'commit', '-q', '--allow-empty', '-m', 'local two');
    run(work, 'branch', '-q', 'local', 'main');
    run(work, 'branch', '-q', 'release/x', 'main');
    run(work, 'switch', '-q', '-c', 'current', 'main');

    const reading = readBranches(createGitRunner(work), { base: null, keep: ['release/*'] });

    if (!reading.ok) {
      throw new Error(reading.detail);
    }
    expect(reading.base).toBe('main');
    expect(reading.branches.map(({ name, upstream, gone, ahead }) => ({ name, upstream, gone, ahead }))).toEqual([
      { name: 'ahead', upstream: 'origin/ahead', gone: false, ahead: 2 },
      { name: 'gone', upstream: 'origin/gone', gone: true, ahead: null },
      { name: 'local', upstream: null, gone: false, ahead: null },
    ]);
    for (const branch of reading.branches) {
      expect(Math.abs(branch.lastCommit.getTime() - Date.now())).toBeLessThan(10 * 60 * 1000);
    }
  });
});
