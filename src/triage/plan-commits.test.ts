/**
 * Tests for the plan's commits (`plan-commits.ts`), over a temporary git
 * repository of two commits: the first is `origin/main`'s tip, the
 * second, on `HEAD` only, edits one file and adds two. Each refusal case
 * keeps a control: the same reading over the same repository answers a
 * base or a file list when the ref it asks for is there.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';

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
  put(dir, 'docs/ü.md', 'note\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'second']);
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

  it('answers the files the second commit touched, as written, and not the file it left alone', () => {
    const reading = readPlanFiles(git, first);

    expect(reading).toEqual({ ok: true, files: ['docs/ü.md', 'src/added file.ts', 'src/edited.ts'] });
  });

  it('answers no file between HEAD and itself', () => {
    expect(readPlanFiles(git, 'HEAD')).toEqual({ ok: true, files: [] });
  });
});
