/**
 * Runs `doc-inventory.ts` and `decision-sources.ts` over one scratch
 * repository, with a planted import graph, concept map, two `context/`
 * pages and fixture issue bodies. Every source planted must be read once,
 * and each coverage line must match what `git ls-files` lists.
 */

import type { IssueBody } from './decision-sources';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { main as collectDecisions } from './decision-sources';
import { main as inventoryDocs } from './doc-inventory';

const STORE = 'src/store/write.ts';
const STORE_BARE = 'src/store/bare.ts';
const REVIEW = 'src/review/read.ts';
const PAGE_A = 'context/alpha.md';
const PAGE_B = 'context/beta.md';
const SPEC = '.rafa/specs/local.md';
const SHARED_REJECTED = 'a lock file. A lock is gone when the process exits.';

const SOURCES: Record<string, string> = {
  [REVIEW]: '/**\n * Reads the side record back.\n */\n\nexport const read = (): string => \'\';\n',
  [STORE]: [
    '/**',
    ' * Writes the side record.',
    ' */',
    '',
    'import { read } from \'../review/read.js\';',
    '',
    '/** Writes what {@link read} reads. */',
    'export const write = (): string => read();',
    '',
  ].join('\n'),
  [STORE_BARE]: 'export const bare = 1;\n',
  [PAGE_A]: '## Alpha\n\nA page never moves without its pointer.\n',
  [PAGE_B]: '## Beta\n\nNothing is promised here.\n',
};

const ISSUES: IssueBody[] = [
  { body: 'Tenets: a helper, not a hinderer.\n', number: 598, title: 'Tenets' },
  { body: 'Tenets: never block.\n', number: 754, title: 'Never block' },
  { body: `## Design\n\n**Rejected:** ${SHARED_REJECTED}\n\n- **Rejected:** a second clone per loop.\n`, number: 900, title: 'Spec: lock' },
];

/** Plants a file, folders included. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Runs git in the scratch repository. */
function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** The tracked paths under the given pathspecs. */
function tracked(root: string, ...specs: string[]): string[] {
  return git(root, ['ls-files', '--', ...specs]).split('\n')
    .filter((path) => path !== '')
    .sort();
}

const readJson = <T>(root: string, path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

const count = (list: readonly string[], item: string): number => list.filter((entry) => entry === item).length;

describe('both survey scripts over one scratch repository', () => {
  let root = '';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'survey-sources-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(SOURCES)) {
      plant(root, path, text);
    }
    plant(root, SPEC, `**Rejected:** ${SHARED_REJECTED}\n`);
    git(root, ['add', '--', ...Object.keys(SOURCES)]);
    const nodes = [
      { cluster: 'c01-store', kind: 'source', path: STORE },
      { cluster: 'c01-store', kind: 'source', path: STORE_BARE },
      { cluster: 'c02-review', kind: 'source', path: REVIEW },
    ];
    plant(root, 'docs/survey/import-graph.json', JSON.stringify({ nodes }));
    const concepts = [{ clusters: ['c01-store'], files: [STORE], key: 'side record', name: 'Side record', terms: ['side record'] }];
    plant(root, 'docs/survey/concepts.json', JSON.stringify({ concepts }));
    await inventoryDocs(root);
    await collectDecisions(root, ISSUES);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads each planted source file of the inventory once', () => {
    const inventory = readJson<{ read: string[]; files: { path: string }[] }>(root, 'docs/survey/doc-inventory.json');
    const expected = tracked(root, 'src', 'packages');
    expect(inventory.read).toEqual(expected);
    expect(inventory.files.map((file) => file.path)).toEqual(expected);
    for (const path of [STORE, STORE_BARE, REVIEW]) {
      expect(count(inventory.read, path)).toBe(1);
    }
  });

  it('reports the planted file without a note and the link across the planted cut', () => {
    const markdown = readFileSync(join(root, 'docs/survey/doc-inventory.md'), 'utf8');
    expect(markdown).toContain(`- \`${STORE_BARE}\``);
    expect(markdown).toContain(`| \`${STORE}\` | \`c01-store\` | \`read\` | 1 | \`${REVIEW}\` | \`c02-review\` |`);
  });

  it('writes an inventory coverage line that matches git ls-files', () => {
    const markdown = readFileSync(join(root, 'docs/survey/doc-inventory.md'), 'utf8');
    const total = tracked(root, 'src', 'packages').length;
    expect(markdown.split('\n')[2]).toBe(`Coverage: ${total} of ${total} tracked files read (src/ and packages/*/src/).`);
  });

  it('reads each planted issue, page and local spec once', () => {
    const json = readJson<{
      issues: { number: number }[];
      contextPages: string[];
      localSpecs: string[];
      decisions: { sources: { ref: string; line: number }[] }[];
    }>(root, 'docs/survey/decision-sources.json');
    expect(json.issues.map((issue) => issue.number)).toEqual([598, 754, 900]);
    expect(json.contextPages).toEqual([PAGE_A, PAGE_B]);
    expect(json.localSpecs).toEqual([SPEC]);
    for (const decision of json.decisions) {
      const refs = decision.sources.map((source) => `${source.ref}:${source.line}`);
      expect(new Set(refs).size).toBe(refs.length);
    }
    const shared = json.decisions.find((decision) => (decision as { text?: string }).text === SHARED_REJECTED);
    expect(shared?.sources.map((source) => source.ref)).toEqual(['#900', SPEC]);
  });

  it('writes a decision coverage line that matches git ls-files', () => {
    const markdown = readFileSync(join(root, 'docs/survey/decision-sources.md'), 'utf8');
    const pages = tracked(root, 'context');
    expect(pages).toEqual([PAGE_A, PAGE_B]);
    expect(markdown.split('\n')[2]).toBe(`Coverage: ${pages.length} of ${pages.length} tracked files read (context/).`);
    expect(markdown).toContain('A page never moves without its pointer. (`context/alpha.md:3`)');
  });

  it('counts a page tracked later in the coverage line, still matching git ls-files (control)', async () => {
    plant(root, 'context/gamma.md', '## G\n\nNothing.\n');
    git(root, ['add', '--', 'context/gamma.md']);
    const pages = tracked(root, 'context');
    expect(pages).toHaveLength(3);
    await collectDecisions(root, ISSUES);
    const markdown = readFileSync(join(root, 'docs/survey/decision-sources.md'), 'utf8');
    expect(markdown.split('\n')[2]).toBe('Coverage: 3 of 3 tracked files read (context/).');
  });
});
