import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { main as runConcepts } from './concepts';
import { main as runImportGraph } from './import-graph';
import { main as runProvenance } from './provenance';
import { main as runTestIndex } from './test-index';

/**
 * End to end: the four map scripts over one scratch git repository.
 *
 * `src/alpha/` holds a clique of four files and `src/beta/` a clique of
 * three, bridged by one edge, plus `src/beta/joiner.ts` that belongs to
 * alpha's clique, so `src/beta/` splits across two clusters. One test
 * spawns a process, one `context/` page seeds a concept, and one
 * untracked file must stay out of every output.
 */

const ALPHA = ['src/alpha/a1.ts', 'src/alpha/a2.ts', 'src/alpha/a3.ts', 'src/alpha/a4.ts', 'src/beta/joiner.ts'];
const BETA = ['src/beta/b1.ts', 'src/beta/b2.ts', 'src/beta/b3.ts'];

/** The specifier from one planted file to another. */
function specifier(from: string, to: string): string {
  const parts = from.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < parts.length && parts[shared] === target[shared]) {
    shared += 1;
  }
  const up = parts.slice(shared).map(() => '..');
  const path = [...up, ...target.slice(shared)].join('/').replace(/\.ts$/, '.js');
  return path.startsWith('.')
    ? path
    : `./${path}`;
}

/** A source file importing every other member of its clique, plus `extra` targets. */
function cliqueFile(path: string, group: readonly string[], extra: readonly string[] = []): string {
  const lines = [...group.filter((member) => member !== path), ...extra].map(
    (target, index) => `import { v${index} } from '${specifier(path, target)}';\n`,
  );
  const doc = path === 'src/alpha/a1.ts'
    ? '/** The Widget Registry keeps every widget. */\n'
    : '';
  return `${lines.join('')}${doc}export const ${path.replace(/\W/g, '_')} = 1;\n`;
}

/** Every planted tracked file with its text. */
function trackedTexts(): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const path of ALPHA) {
    texts[path] = cliqueFile(path, ALPHA, path === 'src/alpha/a1.ts'
      ? ['src/beta/b1.ts']
      : []);
  }
  for (const path of BETA) {
    texts[path] = cliqueFile(path, BETA);
  }
  texts['src/beta/spawns.test.ts'] = [
    'import { expect, it } from \'bun:test\';',
    `import { x } from '${specifier('src/beta/spawns.test.ts', 'src/beta/b1.ts')}';`,
    'it(\'spawns\', () => {',
    '  expect(Bun.spawnSync([\'true\']).exitCode).toBe(0);',
    '  expect(x).toBe(1);',
    '});',
    '',
  ].join('\n');
  texts['src/beta/b1.ts'] += 'export const x = 1;\n';
  return texts;
}

/** Runs git in a scratch repository and fails on a non-zero exit. */
function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const OUTPUTS = [
  'docs/survey/import-graph.json',
  'docs/survey/import-graph.md',
  'docs/survey/concepts.json',
  'docs/survey/concepts.md',
  'docs/survey/provenance.json',
  'docs/survey/provenance.md',
  'docs/survey/test-index.json',
  'docs/survey/test-index.md',
];

/** Runs the four maps and returns the paths written. */
async function runAll(root: string): Promise<string[]> {
  return [
    ...await runImportGraph(root),
    ...await runConcepts(root),
    ...await runProvenance(root, []),
    ...await runTestIndex(root),
  ];
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('the four maps over one scratch repository', () => {
  let root = '';
  let firstRun: Record<string, string> = {};
  let trackedCount = 0;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'survey-maps-'));
    git(root, ['init', '--quiet']);
    const texts = trackedTexts();
    for (const [path, text] of Object.entries(texts)) {
      plant(root, path, text);
    }
    plant(root, 'context/widgets.md', '# Widgets\n\nThe **Widget Registry** is the one place widgets live.\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'Phase 0: import the planted files']);
    plant(root, 'src/alpha/untracked.ts', 'export const untracked = 1;\n');
    trackedCount = git(root, ['ls-files', '--', 'src', 'packages'])
      .split('\n')
      .filter((path) => path.endsWith('.ts')).length;
    expect(await runAll(root)).toEqual(OUTPUTS);
    firstRun = Object.fromEntries(OUTPUTS.map((path) => [path, read(root, path)]));
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('plants every tracked file but not the untracked one', () => {
    expect(trackedCount).toBe(Object.keys(trackedTexts()).length);
    expect(git(root, ['status', '--porcelain']).trim()).toContain('src/alpha/untracked.ts');
  });

  it('opens every summary with a coverage line equal to the git ls-files count', () => {
    const summaries = OUTPUTS.filter((path) => path.endsWith('.md'));
    expect(summaries).toHaveLength(4);
    for (const path of summaries) {
      expect(firstRun[path]).toContain(`Coverage: ${trackedCount} of ${trackedCount} tracked files read (src/ and packages/*/src/).`);
      expect(firstRun[path]).not.toContain('Not read:');
    }
  });

  it('leaves the untracked file out of every output', () => {
    for (const path of OUTPUTS) {
      expect(firstRun[path]).not.toContain('untracked.ts');
    }
  });

  it('splits src/beta/ across two clusters', () => {
    const graph = JSON.parse(firstRun['docs/survey/import-graph.json'] ?? '{}') as {
      clusters: { members: string[]; name: string }[];
    };
    const clustersOfBeta = graph.clusters.filter((cluster) => cluster.members.some((member) => member.startsWith('src/beta/')));
    expect(clustersOfBeta.length).toBeGreaterThanOrEqual(2);
    expect(graph.clusters.find((cluster) => cluster.members.includes('src/beta/joiner.ts'))?.members).toContain('src/alpha/a1.ts');
  });

  it('doubles the index of the test that spawns', () => {
    const index = firstRun['docs/survey/test-index.json'] ?? '';
    const tests = (JSON.parse(index) as { tests: Record<string, { folders: string[]; index: number; spawns: boolean }> }).tests;
    const entry = tests['src/beta/spawns.test.ts'];
    expect(entry?.spawns).toBe(true);
    expect(entry?.index).toBe((entry?.folders.length ?? 0) * 2);
  });

  it('maps the context page concept to the file whose TSDoc names it', () => {
    expect(firstRun['docs/survey/concepts.json']).toContain('Widget Registry');
    expect(firstRun['docs/survey/concepts.json']).toContain('src/alpha/a1.ts');
  });

  it('reruns every output byte-identical', async () => {
    await runAll(root);
    for (const path of OUTPUTS) {
      expect(read(root, path)).toBe(firstRun[path]!);
    }
  });
});
