/**
 * Tests for the plan's commits (`plan-commits.ts`), over a temporary git
 * repository of two commits: the first is `origin/main`'s tip, the
 * second, on `HEAD` only, edits one file and adds two, one of them
 * holding a line that opens with `++`. Each refusal case keeps a
 * control: the same reading over the same repository answers a base, a
 * file list, the added lines or the commits when the ref it asks for is
 * there. A stub answering by argv fails the added-lines or the commits
 * call alone, beside the real repository reading both.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { readPlanBase, readPlanFiles } from './plan-commits.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-commits-')));

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes `text` to `path` under `dir`, making its folder. */
function put(dir: string, path: string, text: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

let git: GitRunner;
let first: string;
let second: string;

/** A stub answering through `git` but failing, saying `said`, each call whose argv opens with `failing`. */
function failingOn(failing: readonly string[], said: string): GitRunner {
  return (args) => failing.every((arg, at) => args[at] === arg)
    ? { ok: false, stdout: '', stderr: said }
    : git(args);
}

beforeAll(() => {
  const dir = join(scope, 'repo');
  must(createGitRunner(scope), ['init', '--quiet', '--initial-branch=main', dir]);
  git = createGitRunner(dir);
  must(git, ['config', 'user.name', 'plan-commits']);
  must(git, ['config', 'user.email', 'plan-commits@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  put(dir, 'src/kept.ts', 'export const kept = 1;\n');
  put(dir, 'src/edited.ts', 'export const edited = 1;\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'first']);
  first = must(git, ['rev-parse', 'HEAD']);
  must(git, ['update-ref', 'refs/remotes/origin/main', first]);
  put(dir, 'src/edited.ts', 'export const edited = 2;\n');
  put(dir, 'src/added file.ts', 'export const added = 1;\n');
  put(dir, 'docs/ü.md', 'note\n++ not a header\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'second']);
  second = must(git, ['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

describe('readPlanBase', () => {
  it('answers a problem naming the ref for a base origin does not hold', () => {
    const reading = readPlanBase(git, 'nope');

    expect(reading).toEqual({
      ok: false,
      base: 'nope',
      problem: 'Could not read the merge base of HEAD and origin/nope: fatal: Not a valid object name refs/remotes/origin/nope',
    });
  });

  it('answers a problem for a blank base without running git', () => {
    const calls: (readonly string[])[] = [];
    const stub: GitRunner = (args) => {
      calls.push(args);
      return { ok: true, stdout: first, stderr: '' };
    };

    const reading = readPlanBase(stub, ' ');

    expect(reading.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('answers no shared history when git fails saying nothing', () => {
    const stub: GitRunner = () => ({ ok: false, stdout: '', stderr: '' });

    expect(readPlanBase(stub, 'main')).toEqual({
      ok: false,
      base: 'main',
      problem: 'HEAD shares no history with origin/main.',
    });
  });

  it('answers no shared history for an origin ref on a root commit of its own', () => {
    const orphan = must(git, ['commit-tree', 'HEAD^{tree}', '-m', 'orphan']);
    must(git, ['update-ref', 'refs/remotes/origin/orphan', orphan]);

    expect(readPlanBase(git, 'orphan')).toEqual({
      ok: false,
      base: 'orphan',
      problem: 'HEAD shares no history with origin/orphan.',
    });
  });

  it('answers a problem when git cannot run', () => {
    const reading = readPlanBase(createGitRunner(join(scope, 'absent')), 'main');

    expect(reading.ok).toBe(false);
    expect(reading.ok
      ? ''
      : reading.problem).toContain('could not run git in');
  });

  it('answers the first commit as the merge base of HEAD and origin/main', () => {
    expect(readPlanBase(git, 'main')).toEqual({ ok: true, base: 'main', sha: first });
  });
});

describe('readPlanFiles', () => {
  it('answers a problem for a revision git does not know', () => {
    const reading = readPlanFiles(git, 'deadbeef');

    expect(reading.ok).toBe(false);
    expect(reading.ok
      ? ''
      : reading.problem).toBe('Could not list the files changed between deadbeef and HEAD: fatal: bad revision \'deadbeef\'');
  });

  it('answers a problem for a blank plan base', () => {
    expect(readPlanFiles(git, '').ok).toBe(false);
  });

  it('runs no added-lines or commits call when the files are not read', () => {
    const calls: string[] = [];
    const stub: GitRunner = (args) => {
      calls.push(args.join(' '));
      return { ok: false, stdout: '', stderr: 'fatal: bad revision \'abc\'' };
    };

    expect(readPlanFiles(stub, 'abc').ok).toBe(false);
    expect(calls).toEqual(['diff --name-only -z abc HEAD --']);
  });

  it('answers the added lines null with a sentence when their diff fails, the files and commits still read', () => {
    const reading = readPlanFiles(failingOn(['diff', '-U0'], 'fatal: out of memory'), first);

    expect(reading).toEqual({
      ok: true,
      files: ['docs/ü.md', 'src/added file.ts', 'src/edited.ts'],
      added: null,
      addedProblem: `Could not read the lines added between ${first} and HEAD: fatal: out of memory`,
      commits: [second],
      commitsProblem: null,
    });
  });

  it('answers the commits null with a sentence when rev-list fails, the files and added lines still read', () => {
    const reading = readPlanFiles(failingOn(['rev-list'], ''), first);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.files).toEqual(['docs/ü.md', 'src/added file.ts', 'src/edited.ts']);
    expect(reading.added).not.toBeNull();
    expect(reading.commits).toBeNull();
    expect(reading.commitsProblem).toBe(`Could not list the commits between ${first} and HEAD`);
  });

  it('answers the files the second commit touched, as written, its added lines and its commit', () => {
    const reading = readPlanFiles(git, first);

    expect(reading).toEqual({
      ok: true,
      files: ['docs/ü.md', 'src/added file.ts', 'src/edited.ts'],
      added: ['note', '++ not a header', 'export const added = 1;', 'export const edited = 2;'],
      addedProblem: null,
      commits: [second],
      commitsProblem: null,
    });
  });

  it('reads no header and no line the second commit removed or left alone as added', () => {
    const reading = readPlanFiles(git, first);
    const added = reading.ok
      ? reading.added ?? []
      : [];

    expect(added.some((line) => line.startsWith('++ b/') || line.startsWith('-- a/'))).toBe(false);
    expect(added).not.toContain('export const edited = 1;');
    expect(added).not.toContain('export const kept = 1;');
  });

  it('answers no file, no added line and no commit between HEAD and itself', () => {
    expect(readPlanFiles(git, 'HEAD')).toEqual({
      ok: true,
      files: [],
      added: [],
      addedProblem: null,
      commits: [],
      commitsProblem: null,
    });
  });
});
