/**
 * Tests for the git ingest over the fixture repository
 * (`testdata/git-repo.fixture.ts`), made in a tmpdir with `git init`, so
 * no case reads the project's history: the first-parent walk from
 * `origin/HEAD`'s target and the `HEAD` fallback (D12), the columns of
 * `commit_facts` with the release tags peeled (D13), the stretch marks of
 * the two offline shapes, and the missing stamps of a folder git gives no
 * history for. Each reading that could pass over an empty table has a
 * fixed value beside it.
 */
import type { GitIngest, GitRunner } from './git.js';
import type { GitFixture } from './testdata/git-repo.fixture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  COMMITS_SOURCE,
  commitTypeOf,
  createGitRunner,
  ingestGit,
  MARKS_SOURCE,
  prNumberOf,
  stretchOf,
} from './git.js';
import { FIXTURE_COMMITS_PER_DAY, FIXTURE_SQUASH_PR, gitIn, writeGitFixture } from './testdata/git-repo.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-ingest-git-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const READ_AT = new Date('2026-11-06T12:00:00.000Z');

type Row = Readonly<Record<string, string | number | null>>;

/** What one ingest into a fresh replica wrote. */
interface Ingested {
  readonly ingest: GitIngest;
  readonly commits: readonly Row[];
  readonly marks: readonly Row[];
}

let built = 0;

/** Run the ingest with `runner` into a fresh replica; answers its result and the two buckets' rows. */
async function ingestWith(runner: GitRunner): Promise<Ingested> {
  built += 1;
  const replicaPath = join(scope, 'replicas', String(built), 'atlas.sqlite');
  const result = await writeReplica({ replicaPath, projectLabel: 'git-fixture' }, (build) => {
    const ingest = ingestGit(build, { runner, now: () => READ_AT });
    const all = (sql: string): Row[] => build.database.query<Row, []>(sql).all();
    return {
      ingest,
      commits: all('SELECT * FROM commit_facts ORDER BY committed_at'),
      marks: all('SELECT * FROM stretch_marks ORDER BY ended_at'),
    };
  });
  return result.value;
}

const repo = join(scope, 'repo');
let fixture: GitFixture;
let main: Ingested;

beforeAll(async () => {
  fixture = writeGitFixture(repo);
  main = await ingestWith(createGitRunner(repo));
});

/** The row of `rows` whose sha is `sha`, or a failed expectation. */
function commitRow(rows: readonly Row[], sha: string): Row {
  const row = rows.find((each) => each['sha'] === sha);
  expect(row).toBeDefined();
  return row ?? {};
}

describe('the subject readers', () => {
  it('reads the conventional prefix as the type, lower case, and NULL for any other first word', () => {
    expect(commitTypeOf('feat(atlas): add the notes')).toBe('feat');
    expect(commitTypeOf('fix!: mend the notes')).toBe('fix');
    expect(commitTypeOf('Docs: a page')).toBe('docs');
    expect(commitTypeOf('wip: not a type')).toBeNull();
    expect(commitTypeOf('rafa-805: Explicit types (#1079) (#1080)')).toBeNull();
    expect(commitTypeOf('Stretch 116 (#40)')).toBeNull();
    expect(commitTypeOf('fix the notes')).toBeNull();
  });

  it('reads the last trailing (#n), then a merge subject\'s number, and NULL with neither', () => {
    expect(prNumberOf('chore: land the atlas fixture (#7)')).toBe(7);
    expect(prNumberOf('rafa-805: Explicit types (#1079) (#1080)')).toBe(1080);
    expect(prNumberOf('Merge pull request #30 from fixture-owner/stretch/110')).toBe(30);
    expect(prNumberOf('fix: see (#12) for the cause')).toBeNull();
    expect(prNumberOf('feat: no number')).toBeNull();
  });

  it('reads a stretch from the two offline shapes only, never from an item subject', () => {
    expect(stretchOf('Stretch 116 (#1627)')).toEqual({ number: '116', prNumber: 1627 });
    expect(stretchOf('Merge pull request #12 from fixture-owner/stretch/110')).toEqual({ number: '110', prNumber: 12 });
    expect(stretchOf('rafa-805: Explicit types (#1079) (#1080)')).toBeNull();
    expect(stretchOf('Merge pull request #12 from fixture-owner/feature/110')).toBeNull();
    expect(stretchOf('Stretch notes for 116')).toBeNull();
  });
});

describe('ingestGit over the fixture repository with no remote', () => {
  it('falls back to HEAD when origin/HEAD is missing, walking the first parents only', () => {
    expect(gitIn(repo, ['remote'])).toBe('');
    expect(main.ingest).toEqual(expect.objectContaining({ read: true, base: 'HEAD', fellBack: true, commits: 7 }));
    expect(main.commits.map((row) => row['sha'])).toEqual([
      fixture.feat, fixture.fix, fixture.squash, fixture.stretchA, fixture.merge1, fixture.merge2, fixture.stretchM,
    ]);
    expect(main.commits.map((row) => row['sha'])).not.toContain(fixture.branch1);
  });

  it('counts the commits per UTC day as the fixture made them', () => {
    const perDay: Record<string, number> = {};
    for (const row of main.commits) perDay[String(row['day'])] = (perDay[String(row['day'])] ?? 0) + 1;

    expect(perDay).toEqual(FIXTURE_COMMITS_PER_DAY);
  });

  it('reads type, pull request, merge and the numstat counts of each commit', () => {
    expect(commitRow(main.commits, fixture.feat)).toEqual(expect.objectContaining({
      committed_at: '2026-11-01T10:00:00.000Z', type: 'feat', pr_number: null, is_merge: 0, files_changed: 1, insertions: 3, deletions: 0,
    }));
    expect(commitRow(main.commits, fixture.fix)).toEqual(expect.objectContaining({
      type: 'fix', files_changed: 2, insertions: 1, deletions: 1,
    }));
    expect(commitRow(main.commits, fixture.squash)).toEqual(expect.objectContaining({
      type: 'chore', pr_number: FIXTURE_SQUASH_PR, is_merge: 0, plan_stub: null,
    }));
    expect(commitRow(main.commits, fixture.merge1)).toEqual(expect.objectContaining({
      type: null, pr_number: 30, is_merge: 1, files_changed: 1, insertions: 1, deletions: 0,
    }));
    expect(commitRow(main.commits, fixture.stretchM)).toEqual(expect.objectContaining({ type: null, pr_number: 40, is_merge: 0 }));
  });

  it('sets the v* tags on their commits, the annotated one peeled, and lists the one off the walk', () => {
    expect(gitIn(repo, ['cat-file', '-t', 'v0.1.0'])).toBe('tag');
    expect(gitIn(repo, ['rev-parse', 'v0.1.0'])).not.toBe(fixture.squash);
    const tagged = main.commits.filter((row) => row['release_tag'] !== null)
      .map((row) => [row['sha'], row['release_tag']]);

    expect(tagged).toEqual([[fixture.squash, 'v0.1.0'], [fixture.stretchM, 'v0.2.0']]);
    expect(main.ingest.tagged).toBe(2);
    expect(main.ingest.tagsOffWalk).toEqual(['v9.9.9']);
  });

  it('marks each stretch of the two shapes with its lane, part and pull request', () => {
    expect(main.marks).toEqual([
      { number: 9, part: 1, lane: 'A', ended_at: '2026-11-02T12:00:00.000Z', pr_number: 20 },
      { number: 110, part: 1, lane: 'M', ended_at: '2026-11-03T10:00:00.000Z', pr_number: 30 },
      { number: 110, part: 2, lane: 'M', ended_at: '2026-11-04T10:00:00.000Z', pr_number: 31 },
      { number: 116, part: 1, lane: 'M', ended_at: '2026-11-05T09:00:00.000Z', pr_number: 40 },
    ]);
    expect(main.ingest.unlanedMarks).toBe(0);
  });

  it('stamps local.commits and local.marks whole, as of their newest row', () => {
    expect(main.ingest.stamps).toEqual([
      { source: COMMITS_SOURCE, asOf: '2026-11-05T09:00:00.000Z', readAt: READ_AT.toISOString(), rows: 7, partial: false, reason: null },
      { source: MARKS_SOURCE, asOf: '2026-11-05T09:00:00.000Z', readAt: READ_AT.toISOString(), rows: 4, partial: false, reason: null },
    ]);
  });
});

describe('ingestGit over a clone, where origin/HEAD names the base', () => {
  const clone = join(scope, 'clone');
  let local: string;

  beforeAll(() => {
    gitIn(scope, ['clone', '--quiet', repo, clone]);
    gitIn(clone, ['commit', '--quiet', '--allow-empty', '-m', 'feat: a local commit not pushed'], '2026-11-06T09:00:00Z');
    local = gitIn(clone, ['rev-parse', 'HEAD']);
  });

  it('walks origin/HEAD\'s target, leaving out the commit only HEAD holds', async () => {
    expect(gitIn(clone, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).toBe('refs/remotes/origin/main');
    const read = await ingestWith(createGitRunner(clone));

    expect(read.ingest).toEqual(expect.objectContaining({ base: 'refs/remotes/origin/main', fellBack: false, commits: 7 }));
    expect(read.commits.map((row) => row['sha'])).not.toContain(local);
  });

  it('control: falls back to HEAD and reads the local commit once origin/HEAD is removed', async () => {
    gitIn(clone, ['remote', 'set-head', 'origin', '--delete']);
    const read = await ingestWith(createGitRunner(clone));

    expect(read.ingest).toEqual(expect.objectContaining({ base: 'HEAD', fellBack: true, commits: 8 }));
    expect(read.commits.map((row) => row['sha'])).toContain(local);
  });
});

describe('ingestGit where git gives no history', () => {
  it('stamps both sources missing, with no rows and git\'s answer, in a folder that is no repository', async () => {
    const empty = join(scope, 'not-a-repo');
    mkdirSync(empty, { recursive: true });
    const read = await ingestWith(createGitRunner(empty));

    expect(read.ingest).toEqual(expect.objectContaining({ read: false, base: null, commits: 0, marks: 0 }));
    expect(read.commits).toEqual([]);
    expect(read.marks).toEqual([]);
    expect(read.ingest.stamps.map((stamp) => [stamp.source, stamp.rows, stamp.partial])).toEqual([
      [COMMITS_SOURCE, 0, true], [MARKS_SOURCE, 0, true],
    ]);
    expect(read.ingest.stamps[0]?.reason).toContain('not a git repository');
  });

  it('stamps both missing in a repository with no commit, naming the empty walk', async () => {
    const fresh = join(scope, 'fresh');
    mkdirSync(fresh, { recursive: true });
    gitIn(fresh, ['init', '--quiet', '-b', 'main']);
    const read = await ingestWith(createGitRunner(fresh));

    expect(read.ingest.read).toBe(false);
    expect(read.ingest.stamps[0]?.reason).toBe('no git history read: neither origin/HEAD nor HEAD names a commit');
  });

  it('reads no repository around the root: a folder inside the fixture repository reads none', async () => {
    const inside = join(repo, 'nested');
    mkdirSync(inside, { recursive: true });
    expect(gitIn(inside, ['rev-parse', '--show-toplevel'])).toBe(repo);
    const read = await ingestWith(createGitRunner(inside));

    expect(read.ingest.read).toBe(false);
    expect(read.ingest.stamps[0]?.reason).toContain('not a git repository');
  });

  it('drops a calling hook\'s GIT_DIR, reading the root and not the repository it names', async () => {
    const empty = join(scope, 'hooked');
    mkdirSync(empty, { recursive: true });
    const env = { ...process.env, GIT_DIR: join(repo, '.git') };
    const hooked = await ingestWith(createGitRunner(empty, env));
    const control = Bun.spawnSync(['git', 'rev-parse', '--verify', 'HEAD'], { cwd: empty, env, stdout: 'pipe' });

    expect(control.exitCode).toBe(0);
    expect(hooked.ingest.read).toBe(false);
  });

  it('answers ok: false with the spawn\'s message when the root does not exist', () => {
    const answered = createGitRunner(join(scope, 'no-such-folder'))(['status']);

    expect(answered.ok).toBe(false);
    expect(answered.stderr).not.toBe('');
  });
});
