/**
 * Tests for where the session logs are and which files there are
 * sessions.
 *
 * These cases moved here from `collect.test.ts` with the functions they
 * cover, unchanged. The mutations that note lists against the listing
 * and the encoding — dropping the `isFile` guard, matching every file
 * name instead of only `.jsonl`, ordering newest first, reading a
 * missing log directory as an empty list, and leaving a dot alone when
 * encoding the log directory — are the ones these cases redden.
 *
 * The folder-set cases plant a HOME of their own holding the main
 * checkout's folder, worktree folders under the encoded
 * `loop.worktreeDir`, and the folders a prefix match would wrongly take:
 * another project whose name merely extends this one's (`…-repo-other`),
 * and a plain file named like a worktree folder. Each exclusion has its
 * control, the folder set naming the worktree folders beside it, so an
 * empty answer cannot pass for a filter.
 *
 * Every case reads a temporary directory, never the real session log
 * directory.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  listProjectSessionLogs,
  listSessionLogs,
  projectLogDirName,
  projectLogDirs,
  sessionLogDir,
} from './session-log-dirs.js';

/** Temporary directories to remove once each case is done. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory that this file's afterEach will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-log-dirs-'));
  scratch.push(dir);
  return dir;
}

/** Writes one session log and answers its path. */
function writeLog(
  dir: string,
  sessionId: string,
  lines: readonly string[],
): string {
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('the project log directory', () => {
  it('replaces every slash and dot with a hyphen', () => {
    expect(projectLogDirName('/Users/dev/projects/agentic-research'))
      .toBe('-Users-dev-projects-agentic-research');
  });

  it('doubles the hyphen for a dot-directory segment', () => {
    expect(projectLogDirName('/Users/dev/repo/.claude/worktrees/x'))
      .toBe('-Users-dev-repo--claude-worktrees-x');
  });

  it('files the encoded name under the projects root', () => {
    expect(sessionLogDir('/Users/dev/repo', '/home'))
      .toBe(join('/home', '.claude', 'projects', '-Users-dev-repo'));
  });
});

describe('listSessionLogs', () => {
  it('takes the loose logs and nothing one level down', () => {
    const dir = makeScratch();
    writeLog(dir, 'aaa', ['{}']);
    writeLog(dir, 'bbb', ['{}']);
    mkdirSync(join(dir, 'aaa', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'aaa', 'subagents', 'agent-1.jsonl'), '{}\n');

    const ids = listSessionLogs(dir).map((entry) => entry.sessionId);

    expect(ids.sort()).toEqual(['aaa', 'bbb']);
  });

  it('skips a directory whose name ends in .jsonl', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    mkdirSync(join(dir, 'decoy.jsonl'));

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('skips a file that is not a session log', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    writeFileSync(join(dir, 'notes.md'), 'hello\n');
    writeFileSync(join(dir, '.DS_Store'), 'x\n');

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('carries each log size and modification time', () => {
    const dir = makeScratch();
    const body = '{"a":1}';
    writeLog(dir, 'one', [body]);

    const found = listSessionLogs(dir);

    expect(found).toHaveLength(1);
    expect(found[0]?.sizeBytes).toBe(body.length + 1);
    expect(found[0]?.modifiedAtMs).toBeGreaterThan(0);
    expect(found[0]?.path).toBe(join(dir, 'one.jsonl'));
  });

  it('orders oldest first', () => {
    const dir = makeScratch();
    const older = writeLog(dir, 'zzz', ['{}']);
    writeLog(dir, 'aaa', ['{}']);
    utimesSync(older, 1_600_000, 1_600_000);

    expect(listSessionLogs(dir).map((e) => e.sessionId))
      .toEqual(['zzz', 'aaa']);
  });

  it('throws rather than reading a missing directory as empty', () => {
    const dir = join(makeScratch(), 'not-there');

    expect(() => listSessionLogs(dir)).toThrow(/no session log directory/);
  });
});

/** The repo root the folder-set cases encode; never read from disk. */
const REPO = '/srv/dev/repo';

/** A HOME holding a `~/.claude/projects/` folder for each encoded name. */
function plantHome(names: readonly string[]): { home: string; projects: string } {
  const home = makeScratch();
  const projects = join(home, '.claude', 'projects');
  for (const name of names) mkdirSync(join(projects, name), { recursive: true });
  return { home, projects };
}

describe('projectLogDirs', () => {
  it('answers the main checkout\'s folder, then each worktree folder by name', () => {
    const { home, projects } = plantHome([
      '-srv-dev-repo',
      '-srv-dev-repo--rafa-worktrees-rafa-2-two',
      '-srv-dev-repo--rafa-worktrees-rafa-1-one',
    ]);

    expect(projectLogDirs(REPO, '.rafa/worktrees', home)).toEqual([
      { dir: join(projects, '-srv-dev-repo'), worktree: null },
      {
        dir: join(projects, '-srv-dev-repo--rafa-worktrees-rafa-1-one'),
        worktree: '/srv/dev/repo/.rafa/worktrees/rafa-1-one',
      },
      {
        dir: join(projects, '-srv-dev-repo--rafa-worktrees-rafa-2-two'),
        worktree: '/srv/dev/repo/.rafa/worktrees/rafa-2-two',
      },
    ]);
  });

  it('never takes another project whose folder name extends this one\'s', () => {
    const { home } = plantHome([
      '-srv-dev-repo',
      '-srv-dev-repo--rafa-worktrees-w',
      '-srv-dev-repo-other',
      '-srv-dev-repo-other--rafa-worktrees-w',
    ]);

    const dirs = projectLogDirs(REPO, '.rafa/worktrees', home).map(({ dir }) => dir);

    expect(dirs.map((dir) => dir.split('/').at(-1)))
      .toEqual(['-srv-dev-repo', '-srv-dev-repo--rafa-worktrees-w']);
  });

  it('takes no folder named the worktree directory itself, and no plain file', () => {
    const { home, projects } = plantHome([
      '-srv-dev-repo--rafa-worktrees',
      '-srv-dev-repo--rafa-worktrees-',
      '-srv-dev-repo--rafa-worktrees-w',
    ]);
    writeFileSync(join(projects, '-srv-dev-repo--rafa-worktrees-file'), 'x\n');

    const worktrees = projectLogDirs(REPO, '.rafa/worktrees', home).map(({ worktree }) => worktree);

    expect(worktrees).toEqual([null, '/srv/dev/repo/.rafa/worktrees/w']);
  });

  it('reads the worktree folders under the worktree directory the config names', () => {
    const { home } = plantHome([
      '-srv-dev-repo--rafa-worktrees-w',
      '-srv-dev-trees-w',
    ]);

    expect(projectLogDirs(REPO, '../trees', home).map(({ worktree }) => worktree))
      .toEqual([null, '/srv/dev/trees/w']);
    expect(projectLogDirs(REPO, '.rafa/worktrees', home).map(({ worktree }) => worktree))
      .toEqual([null, '/srv/dev/repo/.rafa/worktrees/w']);
  });

  it('never answers the main checkout\'s folder as a worktree folder', () => {
    // `..` encodes to a prefix the main folder's own name matches.
    const { home } = plantHome(['-srv-dev-repo', '-srv-dev-sibling']);

    expect(projectLogDirs(REPO, '..', home).map(({ worktree }) => worktree))
      .toEqual([null, '/srv/dev/sibling']);
  });

  it('answers the main checkout\'s folder alone when HOME has no projects root', () => {
    const home = makeScratch();

    expect(projectLogDirs(REPO, '.rafa/worktrees', home))
      .toEqual([{ dir: sessionLogDir(REPO, home), worktree: null }]);
  });
});

describe('listProjectSessionLogs', () => {
  it('stamps each log with its folder\'s worktree, oldest first across folders', () => {
    const main = makeScratch();
    const tree = makeScratch();
    const older = writeLog(tree, 'w1', ['{}']);
    writeLog(main, 'm1', ['{}']);
    utimesSync(older, 1_600_000, 1_600_000);

    const listed = listProjectSessionLogs([
      { dir: main, worktree: null },
      { dir: tree, worktree: '/srv/dev/repo/.rafa/worktrees/w' },
    ]);

    expect(listed.candidates.map(({ sessionId, worktree }) => [sessionId, worktree])).toEqual([
      ['w1', '/srv/dev/repo/.rafa/worktrees/w'],
      ['m1', null],
    ]);
    expect(listed.duplicates).toEqual([]);
  });

  it('keeps a log present in two folders once, from the first folder, and reports the other', () => {
    const main = makeScratch();
    const tree = makeScratch();
    writeLog(main, 'shared', ['{}']);
    writeLog(tree, 'shared', ['{}', '{}']);
    writeLog(tree, 'own', ['{}']);

    const listed = listProjectSessionLogs([
      { dir: main, worktree: null },
      { dir: tree, worktree: '/w' },
    ]);

    expect(listed.candidates.map(({ sessionId }) => sessionId).sort()).toEqual(['own', 'shared']);
    expect(listed.candidates.find(({ sessionId }) => sessionId === 'shared')?.path)
      .toBe(join(main, 'shared.jsonl'));
    expect(listed.duplicates.map(({ path }) => path)).toEqual([join(tree, 'shared.jsonl')]);
  });

  it('reads the worktree folders when the main checkout\'s folder is missing', () => {
    const tree = makeScratch();
    writeLog(tree, 'w1', ['{}']);

    const listed = listProjectSessionLogs([
      { dir: join(makeScratch(), 'not-there'), worktree: null },
      { dir: tree, worktree: '/w' },
    ]);

    expect(listed.candidates.map(({ sessionId }) => sessionId)).toEqual(['w1']);
  });

  it('throws when no folder of the set exists', () => {
    const missing = join(makeScratch(), 'not-there');

    expect(() => listProjectSessionLogs([{ dir: missing, worktree: null }]))
      .toThrow(/no session log directory/);
  });
});
