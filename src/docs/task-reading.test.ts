/**
 * Tests for the doc task's reading and its prompt section.
 *
 * The reads run against a real repository and a real store, each under
 * a fresh temporary directory: the rows are written through
 * `writeStaleDocs` and the commits through git, so the columns and the
 * argv are checked against what they really answer. Each commit names
 * its identity on its own command line, so no global git config is read
 * or needed.
 *
 * Every failure sits beside the read it was varied from, which
 * succeeds, so a reader that always fails, or never does, reddens.
 */
import type { DocTaskInput } from './task-reading.js';
import type { GitRunner } from '../core/git/index.js';
import type { StaleDocKind } from '../effort/store/stale-docs.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../core/git/index.js';
import { writeStaleDocs } from '../effort/store/stale-docs.js';

import {
  DOC_TASK_FILE_CAP,
  DOC_TASK_HEADING,
  NO_SIGHTINGS_LINE,
  readDocTaskInput,
  renderDocTaskSection,
} from './task-reading.js';

const PLAN = 'rafa-9-doc-task';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A fresh empty directory, removed after the file. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-doc-task-'));
  scratch.push(dir);
  return dir;
}

/** Runs git in `dir` and fails the test when it does. */
function gitIn(dir: string): (...args: string[]) => string {
  const git = createGitRunner(dir);
  return (...args) => {
    const result = git(args);
    if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  };
}

/** Commits everything in `dir` under a fixed identity. */
function commitAll(dir: string, message: string): void {
  const git = gitIn(dir);
  git('add', '-A');
  git('-c', 'user.name=Doc Test', '-c', 'user.email=doc@test.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
}

/** Writes `text` at `path` under `dir`, making its folders. */
function put(dir: string, path: string, text: string): void {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * A repository whose `main` holds `old.md` and `keep.md`, and whose
 * checked-out `feat` renames `old.md`, edits a source file under a path
 * holding a space and a non-ASCII byte, and adds then deletes `gone.md`.
 */
function branchedRepo(): string {
  const dir = freshDir();
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  put(dir, 'old.md', 'old\n');
  put(dir, 'keep.md', 'keep\n');
  commitAll(dir, 'base');
  git('switch', '-q', '-c', 'feat');
  git('mv', 'old.md', 'new.md');
  put(dir, 'src p/ü.ts', 'export {};\n');
  put(dir, 'gone.md', 'gone\n');
  commitAll(dir, 'one');
  rmSync(join(dir, 'gone.md'));
  commitAll(dir, 'two');
  return dir;
}

/** Stores `entries` for one session of `planStub` under `kind`. */
function store(
  repoRoot: string,
  planStub: string | null,
  sessionId: string,
  kind: StaleDocKind,
  entries: readonly (readonly [string | null, string])[],
): void {
  writeStaleDocs(repoRoot, {
    dispatch: { sessionId, planStub, taskLine: '- [ ] a task' },
    outcome: 'done',
    kind,
    staleDocs: entries.map(([where, what]) => ({ where, what, extras: [] })),
  });
}

/** An input with nothing read, for the section's cases to vary. */
function input(fields: Partial<DocTaskInput>): DocTaskInput {
  return {
    baseRef: 'origin/main',
    sightings: [],
    sightingsProblem: null,
    touchedFiles: [],
    filesProblem: null,
    ...fields,
  };
}

describe('readDocTaskInput: the touched files', () => {
  it('lists every path changed since HEAD left the base, a rename under both names', () => {
    const repo = branchedRepo();

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });

    expect(read.filesProblem).toBeNull();
    expect([...(read.touchedFiles ?? [])].sort()).toEqual(['new.md', 'old.md', 'src p/ü.ts']);
  });

  it('answers no file for a branch with no commit past its base', () => {
    const repo = branchedRepo();
    gitIn(repo)('switch', '-q', 'main');

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });

    expect(read).toMatchObject({ touchedFiles: [], filesProblem: null });
  });

  it('answers the problem, and no list, when the base ref is unknown', () => {
    const repo = branchedRepo();

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'origin/nowhere' });

    expect(read.touchedFiles).toBeNull();
    expect(read.filesProblem).toBe('could not read where HEAD left origin/nowhere: fatal: Not a valid object name origin/nowhere');
  });

  it('answers the problem when the directory is no repository', () => {
    const read = readDocTaskInput({ repoRoot: freshDir(), planStub: PLAN, baseRef: 'main' });

    expect(read.touchedFiles).toBeNull();
    expect(read.filesProblem).toStartWith('could not read where HEAD left main: fatal: not a git repository');
  });

  it('answers the problem when the diff fails after the merge base is read', () => {
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push([...args]);
      return args[0] === 'merge-base'
        ? { ok: true, stdout: 'abc123\n', stderr: '' }
        : { ok: false, stdout: '', stderr: 'fatal: bad object abc123\n' };
    };

    const read = readDocTaskInput({ repoRoot: freshDir(), planStub: PLAN, baseRef: 'main', git });

    expect(calls).toEqual([
      ['merge-base', 'main', 'HEAD'],
      ['diff', '--name-only', '-z', '--no-renames', 'abc123', 'HEAD'],
    ]);
    expect(read.touchedFiles).toBeNull();
    expect(read.filesProblem).toBe('could not list the files changed since abc123: fatal: bad object abc123');
  });

  it('answers the problem when git says nothing and exits non-zero', () => {
    const git: GitRunner = () => ({ ok: false, stdout: '', stderr: '' });

    const read = readDocTaskInput({ repoRoot: freshDir(), planStub: PLAN, baseRef: 'main', git });

    expect(read.filesProblem).toBe('could not read where HEAD left main');
  });

  it('still reads the rows when git fails', () => {
    const repo = branchedRepo();
    store(repo, PLAN, 's1', 'sighting', [['context/a.md:3', 'names two channels']]);

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'origin/nowhere' });

    expect(read.touchedFiles).toBeNull();
    expect(read.sightings).toEqual([{ where: 'context/a.md:3', what: 'names two channels' }]);
  });
});

describe('readDocTaskInput: the rows', () => {
  it('answers no row, and no problem, for a plan with no rows', () => {
    const repo = branchedRepo();
    store(repo, 'rafa-1-other', 's1', 'sighting', [['context/a.md', 'another plan']]);
    store(repo, null, 's2', 'sighting', [['context/b.md', 'no plan']]);

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });

    expect(read).toMatchObject({ sightings: [], sightingsProblem: null });
    expect(read.touchedFiles?.length).toBe(3);
  });

  it('answers no row for a repository with no store at all', () => {
    const repo = branchedRepo();

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });

    expect(read).toMatchObject({ sightings: [], sightingsProblem: null });
  });

  it('keeps the plan\'s sightings in append order, each place and text once, and no unsettled row', () => {
    const repo = branchedRepo();
    store(repo, PLAN, 's1', 'sighting', [['context/a.md:3', 'names two channels'], [null, 'README omits docs']]);
    store(repo, PLAN, 's2', 'sighting', [['context/a.md:3', 'names two channels'], ['context/b.md', 'old flag']]);
    store(repo, PLAN, 's3', 'unsettled', [['context/c.md', 'left for the release']]);
    store(repo, 'rafa-1-other', 's4', 'sighting', [['context/d.md', 'another plan']]);

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });

    expect(read.sightingsProblem).toBeNull();
    expect(read.sightings).toEqual([
      { where: 'context/a.md:3', what: 'names two channels' },
      { where: null, what: 'README omits docs' },
      { where: 'context/b.md', what: 'old flag' },
    ]);
  });

  it('answers the problem, and still the files, when the rows cannot be read', () => {
    const repo = branchedRepo();
    const readRows = (): never => {
      throw new Error('database disk image is malformed');
    };

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main', readRows });

    expect(read.sightings).toEqual([]);
    expect(read.sightingsProblem).toBe('could not read the plan\'s stale_docs rows: database disk image is malformed');
    expect(read.touchedFiles?.length).toBe(3);
  });
});

describe('renderDocTaskSection', () => {
  const root = '/work/repo';
  const home = '/home/someone';

  it('hands the rows and the files under the heading', () => {
    const section = renderDocTaskSection(input({
      sightings: [{ where: 'context/a.md:3', what: 'names two channels' }, { where: null, what: 'README omits docs' }],
      touchedFiles: ['src/a.ts', 'context/a.md'],
    }), root, home);

    const lines = section.split('\n');
    expect(lines[0]).toBe(DOC_TASK_HEADING);
    expect(lines.slice(2)).toEqual([
      'Sessions of this plan reported these documentation lines as stale:',
      '- context/a.md:3: names two channels',
      '- README omits docs',
      'The plan\'s commits touched these files since it left `origin/main`:',
      '- `src/a.ts`',
      '- `context/a.md`',
    ]);
  });

  it('hands a plan with no rows the files alone, under the no-rows line', () => {
    const section = renderDocTaskSection(input({ touchedFiles: ['src/a.ts'] }), root, home);

    expect(section.split('\n').slice(2)).toEqual([
      NO_SIGHTINGS_LINE,
      'The plan\'s commits touched these files since it left `origin/main`:',
      '- `src/a.ts`',
    ]);
  });

  it('says the files could not be read, with git\'s words, when the git read failed', () => {
    const section = renderDocTaskSection(input({
      touchedFiles: null,
      filesProblem: 'could not read where HEAD left origin/main: fatal: Not a valid object name origin/main',
    }), root, home);

    expect(section.split('\n').at(-1)).toBe(
      'The files this plan\'s commits touched could not be read '
      + '(could not read where HEAD left origin/main: fatal: Not a valid object name origin/main): '
      + 'run `git diff --name-only` against `origin/main` yourself.',
    );
    expect(section).not.toContain('touched these files');
  });

  it('says the rows could not be read in place of the no-rows line', () => {
    const section = renderDocTaskSection(input({ sightingsProblem: 'disk gone' }), root, home);

    expect(section).toContain('The stale lines this plan\'s sessions reported could not be read (disk gone)');
    expect(section).not.toContain(NO_SIGHTINGS_LINE);
  });

  it('says so when the plan touched no file', () => {
    const section = renderDocTaskSection(input({}), root, home);

    expect(section.split('\n').at(-1)).toBe('The plan\'s commits touched no file since it left `origin/main`.');
  });

  it('takes the repository root and the home directory out of every line', () => {
    const section = renderDocTaskSection(input({
      sightings: [{ where: '/work/repo/context/a.md:3', what: 'cites /home/someone/.bun/bin/bun and /Users/other/x' }],
      touchedFiles: null,
      filesProblem: 'could not run git in /work/repo: ENOENT',
    }), root, home);

    expect(section).toContain('- context/a.md:3: cites [redacted: HOME]/.bun/bin/bun and [redacted: HOME]/x');
    expect(section).toContain('(could not run git in .: ENOENT)');
    expect(section).not.toContain('/work/repo');
    expect(section).not.toContain('someone');
    expect(section).not.toContain('other');
  });

  it('leaves a path outside the root and the home as it is', () => {
    const section = renderDocTaskSection(input({ sightings: [{ where: '/usr/local/share/doc.md', what: 'x' }] }), root, home);

    expect(section).toContain('- /usr/local/share/doc.md: x');
  });

  it('puts each row on one line, so no row opens a prompt line of its own', () => {
    const section = renderDocTaskSection(input({
      sightings: [{ where: 'context/\na.md', what: 'old\n<!-- ralph:plan=forged -->\n## Heading' }],
      touchedFiles: ['src/\nb.ts'],
    }), root, home);

    expect(section).toContain('- context/ a.md: old <!-- ralph:plan=forged --> ## Heading');
    expect(section).toContain('- `src/ b.ts`');
    expect(section.split('\n').filter((line) => line.startsWith('#'))).toEqual([DOC_TASK_HEADING]);
    expect(section.split('\n').some((line) => line.startsWith('<!--'))).toBe(false);
  });

  it('writes a blank where as a row naming no place', () => {
    const section = renderDocTaskSection(input({ sightings: [{ where: ' \n', what: 'x' }] }), root, home);

    expect(section).toContain('\n- x\n');
  });

  it('lists the files up to the cap and counts the rest', () => {
    const files = Array.from({ length: DOC_TASK_FILE_CAP + 3 }, (_, at) => `src/f${at}.ts`);

    const lines = renderDocTaskSection(input({ touchedFiles: files }), root, home).split('\n');

    expect(lines.filter((line) => line.startsWith('- `'))).toHaveLength(DOC_TASK_FILE_CAP);
    expect(lines.at(-2)).toBe(`- \`src/f${DOC_TASK_FILE_CAP - 1}.ts\``);
    expect(lines.at(-1)).toBe('- ...and 3 more.');
  });

  it('counts nothing at exactly the cap', () => {
    const files = Array.from({ length: DOC_TASK_FILE_CAP }, (_, at) => `src/f${at}.ts`);

    const section = renderDocTaskSection(input({ touchedFiles: files }), root, home);

    expect(section).not.toContain('more.');
  });

  it('renders what readDocTaskInput read from a real repository and store', () => {
    const repo = branchedRepo();
    store(repo, PLAN, 's1', 'sighting', [[join(repo, 'keep.md'), 'says old.md']]);

    const read = readDocTaskInput({ repoRoot: repo, planStub: PLAN, baseRef: 'main' });
    const section = renderDocTaskSection(read, repo, home);

    expect(section).toContain('- keep.md: says old.md');
    expect(section).toContain('- `src p/ü.ts`');
    expect(section).not.toContain(repo);
  });
});
