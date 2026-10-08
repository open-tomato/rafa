import type { IssueRecord, LogCommit, ProvenanceMap } from './provenance';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  classifyCommit,
  fileHistories,
  IMPORT_SUBJECT,
  main,
  parseGitLog,
  parseIssueList,
  readCommit,
  readGitLog,
  renderProvenanceJson,
  renderProvenanceMarkdown,
  subjectRefs,
  surveyProvenance,
} from './provenance';

const ISSUES: readonly IssueRecord[] = [
  { labels: ['spec:ready', 'type:spec'], number: 10, title: 'Plan from a spec' },
  { labels: ['type:spike'], number: 20, title: 'Try a stretch reader' },
  { labels: ['type:spec'], number: 30, title: 'Bug sweep 1: helpers that drifted' },
  { labels: ['type:bug'], number: 40, title: 'The guard reads the wrong flag' },
  { labels: ['type:roadmap'], number: 50, title: 'Roadmap' },
];

const ISSUE_MAP = new Map(ISSUES.map((issue) => [issue.number, issue]));
const CONTEXT = { importSubject: IMPORT_SUBJECT, issues: ISSUE_MAP };

/** The rule a bare subject meets, read as a non-root commit. */
function ruleOf(subject: string, parents: readonly string[] = ['p']): string | undefined {
  const commit: LogCommit = { changes: [], parents, sha: 's', subject };
  return classifyCommit(readCommit(commit, ISSUE_MAP), CONTEXT)?.id;
}

describe('reading commit subjects', () => {
  it('reads rafa-<n>: and (#<n>) links, each number once', () => {
    expect(subjectRefs('rafa-20: pull request commands (#20) (#40)')).toEqual([20, 40]);
    expect(subjectRefs('fix: probe (#140) (#158)')).toEqual([140, 158]);
    expect(subjectRefs('docs: see #12 and rafa-3 without a colon')).toEqual([]);
  });

  it('counts a number as an issue only when the issue list holds it', () => {
    const read = readCommit({ changes: [], parents: ['p'], sha: 's', subject: 'rafa-10: designed (#11)' }, ISSUE_MAP);
    expect(read.issues).toEqual([10]);
    expect(read.otherRefs).toEqual([11]);
  });

  it('reads each class by the first rule a commit meets', () => {
    expect(ruleOf('anything', [])).toBe('root-commit');
    expect(ruleOf('Phase 0 — package, parity, cutover (#1)')).toBe('import-subject');
    expect(ruleOf('Phase 0b — cutover readiness (#2)')).toBeUndefined();
    expect(ruleOf('rafa-20: a reader (#21)')).toBe('spike-label');
    expect(ruleOf('feat: prototype the board')).toBe('spike-subject');
    expect(ruleOf('rafa-40: read the right flag (#41)')).toBe('bug-label');
    expect(ruleOf('rafa-30: Bug sweep 1 (#31)')).toBe('sweep-title');
    expect(ruleOf('fix(pr): skip the local delete')).toBe('fix-subject');
    expect(ruleOf('rafa-10: plan from a spec (#11)')).toBe('spec-label');
    expect(ruleOf('rafa-50: the roadmap (#51)')).toBeUndefined();
    expect(ruleOf('feat: a helper')).toBeUndefined();
  });
});

describe('parsing the log and the issue list', () => {
  it('parses headers, parents and name-status lines with renames', () => {
    const text = '\x1eaaa\x1f\x1finitial\n\nA\tsrc/a.ts\n'
      + '\x1ebbb\x1faaa\x1frefactor: move\n\nR100\tsrc/a.ts\tsrc/b.ts\nM\tsrc/c.ts\n'
      + '\x1eccc\x1fbbb ddd\x1fMerge\n';
    expect(parseGitLog(text)).toEqual([
      { changes: [{ path: 'src/a.ts', status: 'A' }], parents: [], sha: 'aaa', subject: 'initial' },
      {
        changes: [{ from: 'src/a.ts', path: 'src/b.ts', status: 'R100' }, { path: 'src/c.ts', status: 'M' }],
        parents: ['aaa'],
        sha: 'bbb',
        subject: 'refactor: move',
      },
      { changes: [], parents: ['bbb', 'ddd'], sha: 'ccc', subject: 'Merge' },
    ]);
  });

  it('reads label names off the gh JSON, sorted, and refuses a malformed entry', () => {
    const json = JSON.stringify([{ labels: [{ name: 'type:spec' }, { name: 'spec:ready' }], number: 7, title: 'T' }]);
    expect(parseIssueList(json)).toEqual([{ labels: ['spec:ready', 'type:spec'], number: 7, title: 'T' }]);
    expect(() => parseIssueList('{}')).toThrow('did not return a JSON list');
    expect(() => parseIssueList('[{"number":1}]')).toThrow('without number, title and labels');
  });

  it('follows a rename and starts a new history for a path deleted and added again', () => {
    const log: LogCommit[] = [
      { changes: [{ path: 'a', status: 'A' }, { path: 'x', status: 'A' }], parents: [], sha: '1', subject: '' },
      { changes: [{ from: 'a', path: 'b', status: 'R090' }, { path: 'x', status: 'D' }], parents: ['1'], sha: '2', subject: '' },
      { changes: [{ path: 'x', status: 'A' }, { path: 'b', status: 'M' }], parents: ['2'], sha: '3', subject: '' },
    ];
    expect(Object.fromEntries(fileHistories(log))).toEqual({ b: ['1', '2', '3'], x: ['3'] });
  });
});

/** Runs git in a scratch repository and fails the test on a non-zero exit. */
function git(root: string, args: readonly string[]): void {
  const identity = ['-c', 'user.name=Survey', '-c', 'user.email=survey@example.invalid', '-c', 'commit.gpgsign=false'];
  const result = Bun.spawnSync(['git', ...identity, ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Plants files and commits them under one subject. */
function commit(root: string, subject: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    plant(root, path, text);
  }
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--no-verify', '-m', subject]);
}

const IMPORTED = 'src/core/imported.ts';
const RENAMED = 'src/core/renamed.ts';
const DESIGNED = 'src/plan/designed.ts';
const SPIKE = 'src/plan/spike.ts';
const PATCHED = 'src/core/patched.ts';
const PLAIN = 'src/core/plain.ts';
const FIXED_LATER = 'src/core/fixed-later.ts';
const STAGED = 'src/core/staged.ts';

describe('a scratch repository with one commit of each class', () => {
  let root = '';
  let map: ProvenanceMap;
  const byPath = (): Map<string, ProvenanceMap['files'][number]> => new Map(map.files.map((file) => [file.path, file]));

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-provenance-'));
    git(root, ['init', '--quiet']);
    commit(root, 'initial commit', { 'README.md': '# scratch\n' });
    commit(root, 'Phase 0 — import the loop (#1)', {
      [IMPORTED]: 'export const imported = 1;\n',
      'src/core/old-name.ts': 'export const renamed = \'a file long enough for rename detection to follow\';\n',
    });
    commit(root, 'rafa-10: plan from a spec (#11)', { [DESIGNED]: 'export const designed = 1;\n' });
    commit(root, 'rafa-20: a stretch reader (#21)', { [SPIKE]: 'export const spike = 1;\n' });
    commit(root, 'rafa-30: Bug sweep 1 — helpers say what they do (#31)', {
      [DESIGNED]: 'export const designed = 2;\n',
      [PATCHED]: 'export const patched = 1;\n',
    });
    commit(root, 'feat: a helper with no issue', {
      [FIXED_LATER]: 'export const later = 1;\n',
      [PLAIN]: 'export const plain = 1;\n',
    });
    git(root, ['mv', 'src/core/old-name.ts', RENAMED]);
    git(root, ['commit', '--quiet', '--no-verify', '-m', 'refactor: rename a module (#98)']);
    commit(root, 'fix: guard the helper', { [FIXED_LATER]: 'export const later = 2;\n' });
    plant(root, STAGED, 'export const staged = 1;\n');
    git(root, ['add', '--', STAGED]);
    plant(root, 'src/core/untracked.ts', 'export const untracked = 1;\n');
    const files = [IMPORTED, RENAMED, DESIGNED, SPIKE, PATCHED, PLAIN, FIXED_LATER, STAGED];
    const clusterOf = new Map(files.map((path) => [path, path.startsWith('src/plan/')
      ? 'c02-designed'
      : 'c01-imported']));
    map = surveyProvenance({ clusterOf, files, issues: ISSUES, log: readGitLog(root) });
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads each file by the commit that added it, renames followed', () => {
    const files = byPath();
    expect(files.get(IMPORTED)).toMatchObject({ by: { rule: 'import-subject' }, class: 'imported', readFrom: 'added' });
    expect(files.get(RENAMED)).toMatchObject({ by: { rule: 'import-subject' }, class: 'imported', commits: 2 });
    expect(files.get(DESIGNED)).toMatchObject({ by: { rule: 'spec-label' }, class: 'spec', issues: [10, 30] });
    expect(files.get(DESIGNED)?.touches).toEqual({ 'bug-sweep': 1, imported: 0, 'proof-of-concept': 0, spec: 1 });
    expect(files.get(SPIKE)).toMatchObject({ by: { rule: 'spike-label' }, class: 'proof-of-concept' });
    expect(files.get(PATCHED)).toMatchObject({ by: { rule: 'sweep-title' }, class: 'bug-sweep' });
  });

  it('leaves a file whose history names no issue unclassified, and reads a later fix when the add has no class', () => {
    const files = byPath();
    expect(files.get(PLAIN)).toMatchObject({ by: null, class: 'unclassified', commits: 1, issues: [], readFrom: null });
    expect(files.get(FIXED_LATER)).toMatchObject({ by: { rule: 'fix-subject' }, class: 'bug-sweep', readFrom: 'later' });
  });

  it('counts classes per cluster and the rule each class was read by', () => {
    expect(map.clusters).toEqual([
      { classes: { 'bug-sweep': 2, imported: 2, 'proof-of-concept': 0, spec: 0, unclassified: 1 }, files: 5, name: 'c01-imported' },
      { classes: { 'bug-sweep': 0, imported: 0, 'proof-of-concept': 1, spec: 1, unclassified: 0 }, files: 2, name: 'c02-designed' },
    ]);
    const rules = Object.fromEntries(map.rules.map((rule) => [rule.id, [rule.commits, rule.files]]));
    expect(rules).toMatchObject({ 'fix-subject': [1, 1], 'import-subject': [1, 2], 'root-commit': [1, 0], 'spec-label': [1, 1] });
    expect(map.issues.map((issue) => issue.number)).toEqual([10, 20, 30]);
  });

  it('writes the summary: coverage naming the file with no history, rules, classes per cluster', () => {
    const tracked = [...map.read, STAGED];
    const markdown = renderProvenanceMarkdown(map, tracked);
    const lines = markdown.split('\n');
    expect(lines[2]).toBe(`Coverage: 7 of 8 tracked files read (src/ and packages/*/src/). Not read: \`${STAGED}\`.`);
    expect(markdown).toContain('| Bug-sweep patch | `sweep-title` | a linked issue titled `Bug sweep …` or `Sweep …` | 1 | 1 |');
    expect(markdown).toContain('| `c02-designed` | 2 | 1 | 0 | 1 | 0 | 0 |');
    expect(markdown).toContain(`| \`${PLAIN}\` | \`c01-imported\` | 1 | none |`);
    expect(markdown).toContain('1 of the 1 unclassified files have a history that names no issue.');
  });

  it('writes both outputs from main, byte-identical on a second run', async () => {
    expect(await main(root, ISSUES)).toEqual(['docs/survey/provenance.json', 'docs/survey/provenance.md']);
    const json = readFileSync(join(root, 'docs/survey/provenance.json'), 'utf8');
    const markdown = readFileSync(join(root, 'docs/survey/provenance.md'), 'utf8');
    expect(markdown).toContain(`Coverage: 7 of 8 tracked files read (src/ and packages/*/src/). Not read: \`${STAGED}\`.`);
    expect(json).not.toContain('untracked');
    expect(json).toBe(renderProvenanceJson(JSON.parse(json) as ProvenanceMap));
    await main(root, ISSUES);
    expect(readFileSync(join(root, 'docs/survey/provenance.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(root, 'docs/survey/provenance.md'), 'utf8')).toBe(markdown);
  });
});
