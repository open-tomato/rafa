/**
 * Tests for `start/claim-catch-up.ts`: whether `feat/<stub>` holds only
 * claim commits past `origin/<base>`, and how far it is behind it.
 *
 * Most cases drive the reader over a stubbed `GitRunner` answering from
 * a table keyed by the argv after `git`, recording every command it was
 * asked. A command the table has no reply for THROWS, so a reader that
 * spawns something no case planned for reddens rather than reading an
 * empty answer. Each reading sits beside the one it was varied from, so
 * a reader that answered `catch-up` for everything and one that never
 * did both redden.
 *
 * The last block reads a real repository under the temporary directory,
 * a bare remote and its clone, so the argv the table assumes is proven
 * to be argv git accepts, and the catch-up merge rule is read against
 * the merge commit git itself writes.
 */
import type { ClaimCatchUpReading } from './claim-catch-up.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';

import { readClaimCatchUp } from './claim-catch-up.js';

/** The branch every stubbed case reads. */
const BRANCH = 'feat/rafa-631-stale-claim';

/** The base every stubbed case reads against. */
const BASE = 'integration';

/** The local branch's ref. */
const BRANCH_REF = `refs/heads/${BRANCH}`;

/** The base's remote-tracking ref. */
const BASE_REF = `refs/remotes/origin/${BASE}`;

/** The tip of `origin/<base>` in the stubbed history. */
const BASE_TIP = 'b'.repeat(40);

/** The tip of the branch in the stubbed history. */
const BRANCH_TIP = 'c'.repeat(40);

/** Where the branch was cut from `origin/<base>`. */
const FORK = 'f'.repeat(40);

/** A commit `origin/<base>` holds, the side parent of a catch-up merge. */
const EARLIER_BASE = 'e'.repeat(40);

/** A commit `origin/<base>` does not hold, the side parent of a merged feature branch. */
const ELSEWHERE = 'a'.repeat(40);

const READ_BASE = `rev-parse --verify --quiet ${BASE_REF}^{commit}`;
const READ_BRANCH = `rev-parse --verify --quiet ${BRANCH_REF}^{commit}`;
const COUNT_BEHIND = `rev-list --count ${BRANCH_REF}..${BASE_REF}`;
const MERGE_BASE = `merge-base ${BRANCH_REF} ${BASE_REF}`;
const OWN_COMMITS = `log --format=%H%x09%P%x09%s ${BASE_REF}..${BRANCH_REF}`;

/** A git that exited 0 and wrote `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git that exited non-zero and wrote `stderr`. */
function failed(stderr = ''): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** One line of the `log` capture: sha, parents, subject, tab-separated. */
function line(sha: string, parents: readonly string[], subject: string): string {
  return `${sha}\t${parents.join(' ')}\t${subject}\n`;
}

/** A claim commit's sha: the digit `n` forty times. */
function sha(n: number): string {
  return String(n).repeat(40);
}

/** Two claim commits on top of the fork, newest first as `git log` writes them. */
const TWO_CLAIMS = line(BRANCH_TIP, [sha(1)], 'claim(rafa-631): take')
  + line(sha(1), [FORK], 'claim(rafa-631): claim');

type GitReplies = Readonly<Record<string, GitResult>>;

/** A claim-only branch two commits ahead of the fork and three behind `origin/<base>`. */
const CLAIM_ONLY: GitReplies = {
  [READ_BASE]: ok(`${BASE_TIP}\n`),
  [READ_BRANCH]: ok(`${BRANCH_TIP}\n`),
  [COUNT_BEHIND]: ok('3\n'),
  [MERGE_BASE]: ok(`${FORK}\n`),
  [OWN_COMMITS]: ok(TWO_CLAIMS),
};

interface World {
  readonly git: GitRunner;
  readonly ran: string[];
}

/** A stubbed git answering from `CLAIM_ONLY` with `over` laid on top. */
function world(over: GitReplies = {}): World {
  const replies: GitReplies = { ...CLAIM_ONLY, ...over };
  const ran: string[] = [];
  const git: GitRunner = (args) => {
    const key = args.join(' ');
    ran.push(key);
    const reply = replies[key];
    if (reply === undefined) throw new Error(`no stubbed reply for git ${key}`);
    return reply;
  };
  return { git, ran };
}

/** Reads the stubbed world's branch against the stubbed base. */
function read(over: GitReplies = {}): { reading: ClaimCatchUpReading; ran: readonly string[] } {
  const stub = world(over);
  return { reading: readClaimCatchUp(stub.git, BRANCH, BASE), ran: stub.ran };
}

describe('readClaimCatchUp over a stubbed git', () => {
  it('answers catch-up for a branch of claim commits behind origin/<base>', () => {
    const { reading, ran } = read();

    expect(reading).toEqual({
      kind: 'catch-up',
      branch: BRANCH,
      base: BASE,
      behind: 3,
      ahead: 2,
      mergeBase: FORK,
      baseTip: BASE_TIP,
    });
    expect(ran).toEqual([READ_BASE, READ_BRANCH, COUNT_BEHIND, MERGE_BASE, OWN_COMMITS]);
  });

  it('answers behind, counting the work, for the same branch holding one non-claim commit', () => {
    const { reading } = read({
      [OWN_COMMITS]: ok(line(BRANCH_TIP, [sha(1)], 'feat: start the work') + line(sha(1), [FORK], 'claim(rafa-631): claim')),
    });

    expect(reading).toEqual({
      kind: 'behind',
      branch: BRANCH,
      base: BASE,
      behind: 3,
      ahead: 2,
      workCommits: 1,
      mergeBase: FORK,
      baseTip: BASE_TIP,
    });
  });

  it('answers current for a branch at origin/<base>, reading none of its commits', () => {
    const { reading, ran } = read({ [COUNT_BEHIND]: ok('0\n') });

    expect(reading).toEqual({ kind: 'current', branch: BRANCH, base: BASE });
    expect(ran).toEqual([READ_BASE, READ_BRANCH, COUNT_BEHIND]);
  });

  it('answers current for a branch ahead with work and not behind, so nothing new is said', () => {
    const { reading } = read({
      [COUNT_BEHIND]: ok('0\n'),
      [OWN_COMMITS]: ok(line(BRANCH_TIP, [FORK], 'feat: the work')),
    });

    expect(reading.kind).toBe('current');
  });

  it('answers catch-up for a branch with no commits of its own, which a merge fast-forwards', () => {
    const { reading } = read({ [MERGE_BASE]: ok(`${BRANCH_TIP}\n`), [OWN_COMMITS]: ok('') });

    expect(reading).toMatchObject({ kind: 'catch-up', ahead: 0, behind: 3, mergeBase: BRANCH_TIP });
  });

  it.each([
    ['a claim subject with words after the action', 'claim(rafa-631): claim the plan'],
    ['a capitalised claim subject', 'Claim(rafa-631): claim'],
    ['an issue number zero', 'claim(rafa-0): claim'],
    ['a subject naming claim in passing', 'fix: claim(rafa-631): claim'],
    ['an empty subject', ''],
  ])('reads %s as work', (_name, subject) => {
    const { reading } = read({
      [OWN_COMMITS]: ok(line(BRANCH_TIP, [sha(1)], subject) + line(sha(1), [FORK], 'claim(rafa-631): claim')),
    });

    expect(reading).toMatchObject({ kind: 'behind', workCommits: 1 });
  });

  it('reads a claim subject of any issue and action word as a claim commit', () => {
    const { reading } = read({
      [OWN_COMMITS]: ok(line(BRANCH_TIP, [sha(1)], 'claim(rafa-12): hand') + line(sha(1), [FORK], 'claim(rafa-631): accept')),
    });

    expect(reading.kind).toBe('catch-up');
  });

  it('reads an earlier catch-up merge, whose side parent origin/<base> holds, as no work', () => {
    const merged = line(BRANCH_TIP, [sha(1), EARLIER_BASE], `Merge remote-tracking branch '${BASE_REF}' into ${BRANCH}`)
      + line(sha(1), [FORK], 'claim(rafa-631): claim');
    const { reading, ran } = read({
      [OWN_COMMITS]: ok(merged),
      [`merge-base ${EARLIER_BASE} ${BASE_TIP}`]: ok(`${EARLIER_BASE}\n`),
    });

    expect(reading).toMatchObject({ kind: 'catch-up', ahead: 2 });
    expect(ran.at(-1)).toBe(`merge-base ${EARLIER_BASE} ${BASE_TIP}`);
  });

  it('reads a merge whose side parent origin/<base> does not hold as work', () => {
    const merged = line(BRANCH_TIP, [sha(1), ELSEWHERE], 'Merge branch \'feat/other\'')
      + line(sha(1), [FORK], 'claim(rafa-631): claim');
    const { reading } = read({
      [OWN_COMMITS]: ok(merged),
      [`merge-base ${ELSEWHERE} ${BASE_TIP}`]: ok(`${FORK}\n`),
    });

    expect(reading).toMatchObject({ kind: 'behind', workCommits: 1 });
  });

  it('reads a merge whose side parent shares no history with origin/<base> as work', () => {
    const merged = line(BRANCH_TIP, [sha(1), ELSEWHERE], 'Merge branch \'orphan\'')
      + line(sha(1), [FORK], 'claim(rafa-631): claim');
    const { reading } = read({
      [OWN_COMMITS]: ok(merged),
      [`merge-base ${ELSEWHERE} ${BASE_TIP}`]: failed(),
    });

    expect(reading).toMatchObject({ kind: 'behind', workCommits: 1 });
  });

  it('answers unreadable naming origin/<base> when git does not know it', () => {
    const { reading, ran } = read({ [READ_BASE]: failed() });

    expect(reading).toEqual({
      kind: 'unreadable',
      branch: BRANCH,
      base: BASE,
      reason: `origin/${BASE} is not known here`,
    });
    expect(ran).toEqual([READ_BASE]);
  });

  it('answers unreadable naming the branch when git does not know it', () => {
    const { reading } = read({ [READ_BRANCH]: failed() });

    expect(reading).toMatchObject({ kind: 'unreadable', reason: `${BRANCH} is not known here` });
  });

  it('answers unreadable quoting git when the behind count fails', () => {
    const { reading } = read({ [COUNT_BEHIND]: failed('fatal: bad revision') });

    expect(reading).toMatchObject({
      kind: 'unreadable',
      reason: `could not count how far ${BRANCH} is behind origin/${BASE}: fatal: bad revision`,
    });
  });

  it('answers unreadable when the behind count is not a number', () => {
    const { reading } = read({ [COUNT_BEHIND]: ok('three\n') });

    expect(reading).toMatchObject({ kind: 'unreadable' });
  });

  it('answers unreadable when the branch shares no history with origin/<base>, so it is never merged', () => {
    const { reading } = read({ [MERGE_BASE]: failed() });

    expect(reading).toMatchObject({
      kind: 'unreadable',
      reason: `${BRANCH} shares no history with origin/${BASE}`,
    });
  });

  it('answers unreadable quoting git when the branch\'s own commits cannot be listed', () => {
    const { reading } = read({ [OWN_COMMITS]: failed('fatal: your current branch is broken') });

    expect(reading).toMatchObject({
      kind: 'unreadable',
      reason: `could not list ${BRANCH}'s commits past origin/${BASE}: fatal: your current branch is broken`,
    });
  });
});

describe('readClaimCatchUp against a real repository', () => {
  let scratch = '';
  let project = '';

  /** Runs git in `cwd` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
  const run = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  /** Commits an empty commit with `subject` on what `cwd` has checked out. */
  const commit = (cwd: string, subject: string): void => {
    run(cwd, ['commit', '-q', '--allow-empty', '-m', subject]);
  };

  /** Moves `origin/main` on by one commit, pushed from the main checkout. */
  const moveBase = (subject: string): void => {
    run(project, ['switch', '-q', 'main']);
    commit(project, subject);
    run(project, ['push', '-q', 'origin', 'main']);
  };

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-catch-up-')));
    const remote = join(scratch, 'remote.git');
    project = join(scratch, 'project');
    run(scratch, ['init', '-q', '--bare', remote]);
    run(scratch, ['init', '-q', '-b', 'main', project]);
    commit(project, 'one');
    run(project, ['remote', 'add', 'origin', remote]);
    run(project, ['push', '-q', 'origin', 'main']);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reads a claim branch cut before the base moved as catch-up, and again after one catch-up merge', () => {
    run(project, ['switch', '-q', '-c', 'feat/rafa-1-claim', 'main']);
    commit(project, 'claim(rafa-1): claim');
    moveBase('two');
    moveBase('three');
    const git = createGitRunner(project);

    expect(readClaimCatchUp(git, 'feat/rafa-1-claim', 'main')).toEqual({
      kind: 'catch-up',
      branch: 'feat/rafa-1-claim',
      base: 'main',
      behind: 2,
      ahead: 1,
      mergeBase: run(project, ['rev-parse', 'main~2']),
      baseTip: run(project, ['rev-parse', 'origin/main']),
    });

    run(project, ['switch', '-q', 'feat/rafa-1-claim']);
    run(project, ['merge', '-q', '--no-edit', 'origin/main']);
    expect(readClaimCatchUp(git, 'feat/rafa-1-claim', 'main').kind).toBe('current');

    moveBase('four');
    expect(readClaimCatchUp(git, 'feat/rafa-1-claim', 'main')).toMatchObject({ kind: 'catch-up', behind: 1, ahead: 2 });
  });

  it('reads a branch holding a work commit as behind, and the same branch caught up as current', () => {
    run(project, ['switch', '-q', '-c', 'feat/rafa-2-work', 'main']);
    commit(project, 'claim(rafa-2): claim');
    commit(project, 'feat: the work');
    moveBase('five');
    const git = createGitRunner(project);

    expect(readClaimCatchUp(git, 'feat/rafa-2-work', 'main')).toMatchObject({
      kind: 'behind',
      behind: 1,
      ahead: 2,
      workCommits: 1,
    });

    run(project, ['switch', '-q', 'feat/rafa-2-work']);
    run(project, ['merge', '-q', '--no-edit', 'origin/main']);
    expect(readClaimCatchUp(git, 'feat/rafa-2-work', 'main').kind).toBe('current');
  });

  it('reads a branch git does not have as unreadable', () => {
    const reading = readClaimCatchUp(createGitRunner(project), 'feat/rafa-3-absent', 'main');

    expect(reading).toMatchObject({ kind: 'unreadable', reason: 'feat/rafa-3-absent is not known here' });
  });
});
