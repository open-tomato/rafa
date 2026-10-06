import type { BoardIssue, CommitRecord } from './provenance.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  boardArgument,
  classifyCommit,
  issueNumbers,
  loadBoard,
  originsOf,
  parseBoard,
  parseGitLog,
  readProvenance,
  renderProvenance,
  surveyProvenance,
} from './provenance.js';

/**
 * The provenance reading over in-memory commits and boards, and once over
 * a temporary git repository, never the live one. Each rule's case sits
 * beside one where the rule does not hold, so a rule that fired on
 * everything would fail it.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-provenance-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A commit with one parent unless `parents` says otherwise. */
function commit(subject: string, overrides: Partial<CommitRecord> = {}): CommitRecord {
  return { hash: `${subject.length}abcdef0123`, parents: ['p'], subject, body: '', changes: [], ...overrides };
}

/** A board holding `issues`, each `[number, ...labels]`. */
function board(...issues: (readonly [number, ...string[]])[]): Map<number, BoardIssue> {
  return new Map(issues.map(([number, ...labels]) => [number, { number, title: `issue ${number}`, labels }]));
}

const BOARD = board([20, 'type:spec'], [140, 'type:bug'], [141, 'type:bug'], [476, 'type:spike']);

/** Writes `files` under `root`, creating folders. */
function plant(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('issueNumbers', () => {
  it('reads #<n> and rafa-<n>, each once, and no bare number', () => {
    expect(issueNumbers('rafa-20: pull requests (#20) (#40), 2026 and v0.3')).toEqual([20, 40]);
    expect(issueNumbers('Phase 1 — 3 ports')).toEqual([]);
  });
});

describe('parseGitLog', () => {
  it('reads each record\'s fields, its adds and its renames, and skips other statuses', () => {
    const output = '\x1eaaa\x1f\x1finitial commit\x1f\x1f\n\nA\tsrc/a.ts\nM\tsrc/b.ts\n'
      + '\x1ebbb\x1faaa\x1frafa-20: move\x1fbody line (#140)\n\x1f\n\nR087\tsrc/a.ts\tsrc/c.ts\nD\tsrc/d.ts\n';
    const commits = parseGitLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: 'aaa',
      parents: [],
      subject: 'initial commit',
      body: '',
      changes: [{ kind: 'add', path: 'src/a.ts' }],
    });
    expect(commits[1]?.parents).toEqual(['aaa']);
    expect(commits[1]?.body).toBe('body line (#140)');
    expect(commits[1]?.changes).toEqual([{ kind: 'rename', from: 'src/a.ts', path: 'src/c.ts' }]);
  });
});

describe('originsOf', () => {
  it('carries a renamed file\'s origin and lets a later add replace an earlier one', () => {
    const first = commit('first', { hash: 'h1', changes: [{ kind: 'add', path: 'a.ts' }, { kind: 'add', path: 'b.ts' }] });
    const second = commit('second', { hash: 'h2', changes: [{ kind: 'rename', from: 'a.ts', path: 'c.ts' }] });
    const third = commit('third', { hash: 'h3', changes: [{ kind: 'add', path: 'b.ts' }] });
    const origins = originsOf([first, second, third]);
    expect(origins.get('c.ts')?.hash).toBe('h1');
    expect(origins.has('a.ts')).toBe(false);
    expect(origins.get('b.ts')?.hash).toBe('h3');
  });

  it('gives a rename of a file it never saw added the renaming commit', () => {
    const rename = commit('r', { hash: 'h9', changes: [{ kind: 'rename', from: 'x.ts', path: 'y.ts' }] });
    expect(originsOf([rename]).get('y.ts')?.hash).toBe('h9');
  });
});

describe('classifyCommit', () => {
  it('reads a root commit and a subject naming the import as imported, and an ordinary subject as not', () => {
    expect(classifyCommit(commit('initial commit', { parents: [] }), BOARD).provenance).toBe('imported');
    expect(classifyCommit(commit('Phase 0 — package, parity, cutover (#1)'), BOARD).rule)
      .toBe('subject names the import');
    expect(classifyCommit(commit('Phase 1 — installable (#4)'), BOARD).provenance).toBe('poc');
  });

  it('reads a spec issue as spec and a bug issue as bug-sweep, with the evidence', () => {
    expect(classifyCommit(commit('rafa-20: pull requests (#40)'), BOARD)).toEqual({
      provenance: 'spec',
      rule: 'spec issue #20',
      issues: [20],
      unresolved: [40],
    });
    expect(classifyCommit(commit('fix: take the probe from the span (#140) (#158)'), BOARD)).toEqual({
      provenance: 'bug-sweep',
      rule: 'bug issue #140',
      issues: [140],
      unresolved: [158],
    });
  });

  it('reads the body only when the subject resolves no issue, and lets the majority of its issues decide', () => {
    const stretch = commit('Stretch 3 (#813)', { body: '* fix: one (#140)\n* fix: two (#141)\n* see rafa-20' });
    expect(classifyCommit(stretch, BOARD).provenance).toBe('bug-sweep');
    expect(classifyCommit(stretch, BOARD).issues).toEqual([20, 140, 141]);
    const specSubject = commit('rafa-20: spec run', { body: '* fix: one (#140)\n* fix: two (#141)' });
    expect(classifyCommit(specSubject, BOARD).provenance).toBe('spec');
    expect(classifyCommit(specSubject, BOARD).issues).toEqual([20]);
  });

  it('lets spec win a tie with bugs', () => {
    expect(classifyCommit(commit('Stretch (#1)', { body: 'rafa-20 and #140' }), BOARD).provenance).toBe('spec');
  });

  it('reads a spike as poc, a fix subject no issue decided as bug-sweep, and anything else as poc', () => {
    expect(classifyCommit(commit('spike run (#476)'), BOARD).rule).toBe('spike issue #476');
    expect(classifyCommit(commit('fix(release): print the line (#452)'), BOARD).rule)
      .toBe('fix subject, no deciding issue');
    expect(classifyCommit(commit('feat(extras): tomato theme (#388)'), BOARD)).toEqual({
      provenance: 'poc',
      rule: 'no spec issue',
      issues: [],
      unresolved: [388],
    });
    expect(classifyCommit(commit('docs: a prefix fix: inside'), BOARD).provenance).toBe('poc');
  });
});

describe('parseBoard', () => {
  it('reads each row\'s number, title and label names, skipping a row with no number', () => {
    const parsed = parseBoard({ rows: [
      { number: 7, title: 'seven', labels: [{ name: 'type:bug' }, { color: 'red' }] },
      { title: 'no number' },
    ] });
    expect([...parsed.values()]).toEqual([{ number: 7, title: 'seven', labels: ['type:bug'] }]);
  });

  it('refuses a file holding no rows list', () => {
    expect(() => parseBoard({ version: 1 })).toThrow(/no rows list/);
  });

  it('names how to fill the cache when the file is absent', async () => {
    await expect(loadBoard(join(base, 'board.json'))).rejects.toThrow(/run rafa roadmap/);
  });
});

describe('boardArgument', () => {
  it('reads the path after --board, none without it, and refuses a missing path', () => {
    expect(boardArgument(['--board', '/tmp/b.json'])).toBe('/tmp/b.json');
    expect(boardArgument([])).toBeNull();
    expect(() => boardArgument(['--board'])).toThrow(/needs a path/);
  });
});

describe('readProvenance', () => {
  it('groups files by cluster with counts and origin commits, and leaves out a file with no origin', () => {
    const spec = commit('rafa-20: spec', { hash: 'spec0000aa' });
    const fix = commit('fix: a bug', { hash: 'fix00000bb' });
    const origins = new Map([['src/a.ts', spec], ['src/b.ts', spec], ['src/c.ts', fix]]);
    const clusterOf = new Map([['src/a.ts', 'c1'], ['src/b.ts', 'c1'], ['src/c.ts', 'c2']]);
    const data = readProvenance(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], origins, BOARD, clusterOf);
    expect(data.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(data.clusters.map((cluster) => [cluster.cluster, cluster.files])).toEqual([['c1', 2], ['c2', 1]]);
    expect(data.clusters[0]?.origins).toEqual([{ commit: 'spec000', subject: 'rafa-20: spec', provenance: 'spec', files: 2 }]);
    expect(data.overall).toEqual({ spec: 2, imported: 0, poc: 0, 'bug-sweep': 1 });
    expect(renderProvenance(data)).toContain('| all | 3 | 2 | 0 | 0 | 1 |');
  });
});

describe('surveyProvenance', () => {
  it('classifies every committed source of a git repository and names the uncommitted one as missed', async () => {
    plant(base, {
      'src/a/import.ts': 'export const a = 1;\n',
      'src/a/import.test.ts': 'test\n',
      '.rafa/survey/import-graph.json': JSON.stringify({ data: { files: [
        { path: 'src/a/import.ts', cluster: 'c1' },
        { path: 'src/b/moved.ts', cluster: 'c1' },
      ] } }),
    });
    const git = (args: string[]) => Bun.$`git -c user.name=survey -c user.email=survey@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null ${args}`
      .cwd(base)
      .quiet();
    await Bun.$`git init -q`.cwd(base).quiet();
    await git(['add', 'src']);
    await git(['commit', '-q', '-m', 'initial commit']);
    plant(base, { 'src/b/spec.ts': 'export const b = 2;\nexport const c = 3;\nexport const d = 4;\n' });
    await git(['add', 'src']);
    await git(['commit', '-q', '-m', 'rafa-20: the spec (#21)']);
    await git(['mv', 'src/b/spec.ts', 'src/b/moved.ts']);
    await git(['commit', '-q', '-m', 'fix: move it (#140)']);
    plant(base, { 'src/c/staged.ts': 'export const e = 5;\n' });
    await git(['add', 'src/c/staged.ts']);
    const boardPath = join(base, 'elsewhere', 'board.json');
    plant(base, { 'elsewhere/board.json': JSON.stringify({ rows: [
      { number: 20, title: 'spec', labels: [{ name: 'type:spec' }] },
      { number: 140, title: 'bug', labels: [{ name: 'type:bug' }] },
    ] }) });

    const data = await surveyProvenance(base, boardPath);

    expect(data.files.map((file) => [file.path, file.provenance, file.cluster])).toEqual([
      ['src/a/import.ts', 'imported', 'c1'],
      ['src/b/moved.ts', 'spec', 'c1'],
    ]);
    expect(data.unresolved).toEqual([21]);
    const markdown = await Bun.file(join(base, '.rafa/survey/provenance.md')).text();
    expect(markdown.split('\n')[0]).toBe('Coverage: 3 tracked, 2 read, 1 missed: `src/c/staged.ts`');
    const json = (await Bun.file(join(base, '.rafa/survey/provenance.json')).json()) as { name: string };
    expect(json.name).toBe('provenance');
  });

  it('refuses a repository with no board cache, naming the default path', async () => {
    plant(base, { '.rafa/survey/import-graph.json': JSON.stringify({ data: { files: [] } }) });
    await Bun.$`git init -q`.cwd(base).quiet();
    await expect(surveyProvenance(base)).rejects.toThrow(/\.rafa\/cache\/board\.json is absent/);
  });
});
