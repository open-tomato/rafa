import type { ContextPage } from './concepts';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  docComments,
  main,
  mapConcepts,
  namesTerm,
  normalizeTerm,
  pageSeeds,
  renderConceptsJson,
  renderConceptsMarkdown,
  seedConcepts,
} from './concepts';

const PAGE: ContextPage = {
  path: 'context/ledger.md',
  text: [
    '## The ledger',
    '',
    'The **side record** keeps what a run learned, and **hindsight** reads it',
    'back. A **wrapped bold',
    'term** spans two lines.',
    '',
    '### Orphan heading',
    '',
    '```yaml',
    '## not a heading',
    '```',
    '',
  ].join('\n'),
};

const WRITER = 'src/ledger/write.ts';
const READER = 'src/review/read.ts';

const SOURCES: Record<string, string> = {
  [READER]: [
    '/**',
    ' * Reads the **ledger** back for a review, by way of `hindsight`.',
    ' */',
    '',
    'export const text = \'/** side record */\';',
    '',
  ].join('\n'),
  [WRITER]: [
    '/**',
    ' * Writes the ledger: one side',
    ' * record per task. See `context/ledger.md`.',
    ' */',
    '',
    '// a line comment naming hindsight is not TSDoc',
    '',
    '/** The wrapped bold term, named in TSDoc. */',
    'export function write(): void {}',
    '',
  ].join('\n'),
};

const CLUSTER_OF = new Map([[READER, 'c02-read'], [WRITER, 'c01-write']]);

function plantedMap(): ReturnType<typeof mapConcepts> {
  const comments = new Map(Object.entries(SOURCES).map(([path, text]) => [path, docComments(path, text)]));
  return mapConcepts({ clusterOf: CLUSTER_OF, comments, pages: [PAGE] });
}

describe('seeding concepts from a planted page', () => {
  it('seeds the page, its headings and its bold terms, skipping fenced code', () => {
    const seeds = pageSeeds(PAGE).map((seed) => [seed.origin, seed.key]);
    expect(seeds).toEqual([
      ['page', 'ledger'],
      ['heading', 'ledger'],
      ['heading', 'orphan heading'],
      ['bold', 'side record'],
      ['bold', 'hindsight'],
      ['bold', 'wrapped bold term'],
    ]);
  });

  it('merges equal seeds into one concept matched by the page path too', () => {
    const ledger = seedConcepts([PAGE]).find((concept) => concept.key === 'ledger');
    expect(ledger).toEqual({
      key: 'ledger',
      name: 'The ledger',
      origins: ['heading', 'page'],
      pages: ['context/ledger.md'],
      terms: ['context/ledger.md', 'ledger'],
    });
  });

  it('merges one seed across two pages', () => {
    const other: ContextPage = { path: 'context/other.md', text: '# Other\n\nThe **Side record.**\n' };
    const side = seedConcepts([other, PAGE]).find((concept) => concept.key === 'side record');
    expect(side?.pages).toEqual(['context/ledger.md', 'context/other.md']);
    expect(side?.name).toBe('side record');
  });

  it('normalizes markdown, case, whitespace and trailing punctuation', () => {
    expect(normalizeTerm('**`Pinned`**\n  Tier:')).toBe('pinned tier');
    expect(normalizeTerm('plugin:\\<name\\>')).toBe('plugin:<name>');
  });
});

describe('reading module notes and TSDoc', () => {
  it('reads every /** block, never a line comment or a string', () => {
    const writer = docComments(WRITER, SOURCES[WRITER] ?? '');
    expect(writer).toContain('one side record per task');
    expect(writer).toContain('the wrapped bold term');
    expect(writer).not.toContain('hindsight');
    expect(docComments(READER, SOURCES[READER] ?? '')).not.toContain('side record');
  });

  it('matches a term between word boundaries only', () => {
    expect(namesTerm('reads the ledger back', 'ledger')).toBe(true);
    expect(namesTerm('reads the ledgers back', 'ledger')).toBe(false);
    expect(namesTerm('see context/ledger.md.', 'context/ledger.md')).toBe(true);
  });
});

describe('the concept map over a planted page and two files', () => {
  const map = plantedMap();
  const byKey = new Map(map.concepts.map((concept) => [concept.key, concept]));

  it('maps a concept both files name to both clusters', () => {
    expect(byKey.get('ledger')?.files).toEqual([WRITER, READER]);
    expect(byKey.get('ledger')?.clusters).toEqual(['c01-write', 'c02-read']);
  });

  it('maps a concept one file names, wrapped across lines in either text, to one cluster', () => {
    expect(byKey.get('side record')?.files).toEqual([WRITER]);
    expect(byKey.get('wrapped bold term')?.clusters).toEqual(['c01-write']);
    expect(byKey.get('hindsight')?.files).toEqual([READER]);
  });

  it('keeps a concept no file names, with no files and no clusters', () => {
    expect(byKey.get('orphan heading')).toMatchObject({ clusters: [], files: [] });
  });

  it('writes the summary: coverage, concepts by file count with clusters, concepts named by no file', () => {
    const markdown = renderConceptsMarkdown(map, [READER, WRITER, 'src/dropped.ts']);
    const lines = markdown.split('\n');
    expect(lines[2]).toBe('Coverage: 2 of 3 tracked files read (src/ and packages/*/src/). Not read: `src/dropped.ts`.');
    const byCount = lines.slice(lines.indexOf('## Concepts by file count'), lines.indexOf('## Concepts named by no file'));
    expect(byCount[4]).toBe('| The ledger | 2 | 2: `c01-write`, `c02-read` | `context/ledger.md` |');
    expect(byCount.join('\n')).not.toContain('Orphan heading');
    const none = lines.slice(lines.indexOf('## Concepts named by no file'));
    expect(none).toContain('| Orphan heading | heading | `context/ledger.md` |');
    expect(none).toHaveLength(6);
  });

  it('renders equal JSON for an equal map, every list sorted', () => {
    const json = renderConceptsJson(map);
    expect(renderConceptsJson(plantedMap())).toBe(json);
    const parsed = JSON.parse(json) as { concepts: { key: string }[]; read: string[] };
    const keys = parsed.concepts.map((concept) => concept.key);
    expect(keys).toEqual([...keys].sort());
    expect(parsed.read).toEqual([WRITER, READER]);
  });
});

/** Runs git in a scratch repository and fails the test on a non-zero exit. */
function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe('main over a scratch repository', () => {
  let root = '';
  const files: Record<string, string> = { ...SOURCES, [PAGE.path]: PAGE.text };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-concepts-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(files)) {
      plant(root, path, text);
    }
    git(root, ['add', '--', ...Object.keys(files)]);
    plant(root, 'src/review/untracked.ts', '/** The orphan heading, untracked. */\nexport const u = 1;\n');
    plant(root, 'context/untracked.md', '# Untracked page\n');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('writes both outputs from tracked files only, byte-identical on a second run', async () => {
    expect(await main(root)).toEqual(['docs/survey/concepts.json', 'docs/survey/concepts.md']);
    const json = readFileSync(join(root, 'docs/survey/concepts.json'), 'utf8');
    const markdown = readFileSync(join(root, 'docs/survey/concepts.md'), 'utf8');
    expect(markdown).toContain('Coverage: 2 of 2 tracked files read (src/ and packages/*/src/).');
    expect(markdown).toContain('| Orphan heading | heading | `context/ledger.md` |');
    expect(json).not.toContain('untracked');
    await main(root);
    expect(readFileSync(join(root, 'docs/survey/concepts.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(root, 'docs/survey/concepts.md'), 'utf8')).toBe(markdown);
  });
});
