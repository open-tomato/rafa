/**
 * Tests for `./past-head.ts` over a scratch repository: a `main` that
 * holds one waiting fragment and a changelog receipt naming another,
 * and one branch per case, each with a head commit a merged pull
 * request carries and the commits past it.
 */
import type { GitResult, GitRunner } from '../pr/git.js';
import type { MergedPullRequest } from '../pr/types.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { gitIdentityEnv } from '../tests/git-identity.js';

import { readPastHead } from './past-head.js';

const SETTINGS = { base: 'main', fragments: '.changes', changelog: 'CHANGELOG.md' };

const CHANGELOG = [
  '# Changelog',
  '',
  '## 1.1.0 — 2026-10-01, folded',
  '<!-- rafa:fragments folded other -->',
  '',
  '- Loop: folded',
  '',
].join('\n');

/** An absent hash: no clone has it. */
const MISSING_OID = '1234567890123456789012345678901234567890';

let root = '';
let git: GitRunner = () => ({ ok: false, stdout: '', stderr: 'not built' });
const heads: Record<string, string> = {};

/** Runs git in `cwd` without the user's or the system's configuration. */
function runnerIn(cwd: string): GitRunner {
  return (args): GitResult => {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        LC_ALL: 'C',
        ...gitIdentityEnv(),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
  };
}

/** Runs git and answers stdout, throwing when it fails. */
function must(args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Writes `path` in the repository and commits it with `subject`. */
function commitFile(path: string, text: string, subject: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  must(['add', '--', path]);
  must(['commit', '--quiet', '-m', subject]);
}

/**
 * A branch off the first commit with one head commit, recorded in
 * {@link heads}, then `extra` run on it.
 */
function branch(name: string, extra: () => void): void {
  must(['switch', '--quiet', '-c', name, 'first']);
  commitFile(`src/${name}.ts`, `export const ${name} = 1;\n`, `${name} work`);
  heads[name] = must(['rev-parse', 'HEAD']);
  extra();
  must(['switch', '--quiet', 'main']);
}

/** A merged pull request whose head is `name`'s head commit. */
function pullRequest(name: string, oid: string = heads[name] ?? ''): MergedPullRequest {
  return { number: 7, headRefName: name, headRefOid: oid, mergedAt: '2026-10-01T00:00:00Z' };
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-past-head-')));
  git = runnerIn(root);
  must(['init', '--quiet', '--initial-branch=main']);
  commitFile('src/main.ts', 'export {};\n', 'first');
  must(['tag', 'first']);

  branch('level', () => undefined);
  branch('source', () => {
    commitFile('src/more.ts', 'export {};\n', 'more source');
  });
  branch('absent', () => {
    commitFile('.changes/absent.md', 'absent\n', 'add absent fragment');
  });
  branch('present', () => {
    commitFile('.changes/waiting.md', 'waiting\n', 'add waiting fragment');
  });
  branch('folded', () => {
    commitFile('.changes/folded.md', 'folded\n', 'add folded fragment');
  });
  branch('mixed', () => {
    commitFile('.changes/waiting.md', 'waiting\n', 'add waiting fragment');
    commitFile('src/late.ts', 'export {};\n', 'late source');
  });
  branch('nested', () => {
    commitFile('.changes/deep/waiting.md', 'waiting\n', 'add nested file');
  });

  commitFile('.changes/waiting.md', 'waiting\n', 'squash waiting');
  commitFile('.changes/deep/waiting.md', 'waiting\n', 'nested on base');
  commitFile('CHANGELOG.md', CHANGELOG, 'settle 1.1.0');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readPastHead', () => {
  test('a tip equal to the head counts zero and is held', () => {
    expect(readPastHead(git, 'level', pullRequest('level'), SETTINGS)).toEqual({
      kind: 'past-head',
      pullRequest: pullRequest('level'),
      count: 0,
      commits: [],
      held: true,
    });
  });

  test('a commit touching a source file is not held', () => {
    const reading = readPastHead(git, 'source', pullRequest('source'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: false });
    expect(reading.kind === 'past-head' && reading.commits).toEqual([
      { hash: must(['rev-parse', 'refs/heads/source']), subject: 'more source', paths: ['src/more.ts'], held: false },
    ]);
  });

  test('a fragment absent from the base and its receipts is not held', () => {
    const reading = readPastHead(git, 'absent', pullRequest('absent'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: false });
    expect(reading.kind === 'past-head' && reading.commits.map((each) => each.subject)).toEqual(['add absent fragment']);
  });

  test('a fragment present on the base is held', () => {
    const reading = readPastHead(git, 'present', pullRequest('present'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: true });
    expect(reading.kind === 'past-head' && reading.commits[0]?.paths).toEqual(['.changes/waiting.md']);
  });

  test('a fragment folded into a receipt of the base changelog is held', () => {
    const reading = readPastHead(git, 'folded', pullRequest('folded'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: true });
  });

  test('control: the folded fragment is not held when the changelog the settings name is absent', () => {
    const reading = readPastHead(git, 'folded', pullRequest('folded'), { ...SETTINGS, changelog: 'NOWHERE.md' });
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: false });
  });

  test('control: the present fragment is not held when the fragments directory is another', () => {
    const reading = readPastHead(git, 'present', pullRequest('present'), { ...SETTINGS, fragments: 'elsewhere' });
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: false });
  });

  test('a file in a subdirectory of the fragments directory is no fragment, even on the base', () => {
    const reading = readPastHead(git, 'nested', pullRequest('nested'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 1, held: false });
  });

  test('one source commit among held ones makes the branch not held, and says which', () => {
    const reading = readPastHead(git, 'mixed', pullRequest('mixed'), SETTINGS);
    expect(reading).toMatchObject({ kind: 'past-head', count: 2, held: false });
    expect(reading.kind === 'past-head' && reading.commits.map((each) => [each.subject, each.held])).toEqual([
      ['add waiting fragment', true],
      ['late source', false],
    ]);
  });

  test('a head that is not an ancestor of the tip is not descended', () => {
    expect(readPastHead(git, 'source', pullRequest('absent'), SETTINGS)).toEqual({ kind: 'not-descended' });
  });

  test('a head the clone does not have is not descended', () => {
    expect(readPastHead(git, 'source', pullRequest('source', MISSING_OID), SETTINGS)).toEqual({ kind: 'not-descended' });
  });

  test('a branch git cannot read is unread, naming what git said', () => {
    const reading = readPastHead(git, 'no-such-branch', pullRequest('source'), SETTINGS);
    expect(reading.kind).toBe('unread');
    expect(reading.kind === 'unread' && reading.detail).toContain('git merge-base --is-ancestor failed: ');
  });

  test('a base git cannot read is unread', () => {
    const reading = readPastHead(git, 'source', pullRequest('source'), { ...SETTINGS, base: 'no-such-base' });
    expect(reading.kind).toBe('unread');
    expect(reading.kind === 'unread' && reading.detail).toContain('git ls-tree failed: ');
  });
});
