import type { TextFile } from './concepts.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  parseHeadings,
  parseTerms,
  readConcepts,
  readTextFiles,
  renderConcepts,
  searchTerms,
  seedConcepts,
  surveyConcepts,
  termPattern,
} from './concepts.js';

/**
 * The concept map over in-memory pages and sources, and once over a
 * temporary git repository, never the live one. Each match sits beside a
 * near miss it must not take, so a pattern that matched everything would
 * fail.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-concepts-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes `files` under `root`, creating folders. */
function plant(root: string, files: Record<string, string | Uint8Array>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

describe('parseHeadings', () => {
  it('reads every heading level and leaves out a fenced comment line', () => {
    const page = '## Effort store\n\ntext\n### Copy detection ##\n```sh\n# WRONG: not a heading\n```\n#### Deep one\n';
    expect(parseHeadings(page)).toEqual([
      { level: 2, text: 'Effort store' },
      { level: 3, text: 'Copy detection' },
      { level: 4, text: 'Deep one' },
    ]);
  });
});

describe('parseTerms', () => {
  it('reads a bold span opening a line before is or are, and no other bold', () => {
    const page = '**The ledger** is the formal name.\n**None of the three is a brand.** No package.\n'
      + 'some **bold** is inline\n**Hops** are moves.\n';
    expect(parseTerms(page)).toEqual(['The ledger', 'Hops']);
  });
});

describe('searchTerms', () => {
  it('splits prose at punctuation and conjunctions, drops articles, and adds each code span', () => {
    expect(searchTerms('The resolver: `resolveTiers`')).toEqual(['resolver', 'resolve tiers']);
    expect(searchTerms('Collisions and the byte-identical rule')).toEqual(['collisions', 'byte identical rule']);
    expect(searchTerms('`status.notice` config key')).toEqual(['status notice config key', 'status notice']);
  });

  it('keeps no term too short or generic', () => {
    expect(searchTerms('The `pr` subject')).toEqual(['pr subject']);
    expect(searchTerms('Imports')).toEqual([]);
    expect(searchTerms('A hop')).toEqual(['hop']);
  });
});

describe('termPattern', () => {
  it('matches a term in every spelling a name takes', () => {
    const pattern = termPattern('copy detection');
    for (const text of ['copyDetection()', 'CopyDetection', 'copy-detection.ts', 'COPY_DETECTION', 'the copy detection']) {
      expect(pattern.test(text)).toBe(true);
    }
  });

  it('takes a plural and a camel-case hump, and refuses a word inside a longer one', () => {
    expect(termPattern('merge rules').test('const mergeRule = 1')).toBe(true);
    expect(termPattern('hop').test('hops = []')).toBe(true);
    expect(termPattern('hop').test('readHop()')).toBe(true);
    expect(termPattern('hop').test('shopping')).toBe(false);
    expect(termPattern('hop').test('hopper')).toBe(false);
    expect(termPattern('bus').test('bu')).toBe(false);
  });
});

describe('seedConcepts', () => {
  it('seeds headings of every page and terms of the terminology page only, merging one name over two pages', () => {
    const pages: TextFile[] = [
      { path: 'context/source.md', text: '## Imports\n### Adding a setting\n### Row origins\n**Fake** is not seeded here.\n' },
      { path: 'context/effort-store.md', text: '## Effort store\n### Row origins\n' },
      { path: 'context/terminology.md', text: '## Terminology\n**The ledger** is the store.\n' },
    ];
    const seeded = seedConcepts(pages);
    expect(seeded.concepts.map((concept) => [concept.name, concept.origin, concept.pages])).toEqual([
      ['Effort store', 'heading', ['context/effort-store.md']],
      ['Row origins', 'heading', ['context/effort-store.md', 'context/source.md']],
      ['Terminology', 'heading', ['context/terminology.md']],
      ['The ledger', 'term', ['context/terminology.md']],
    ]);
    expect(seeded.skipped).toEqual([
      { name: 'Imports', page: 'context/source.md', reason: 'no-term' },
      { name: 'Adding a setting', page: 'context/source.md', reason: 'procedure' },
    ]);
  });
});

describe('readConcepts', () => {
  const sources: TextFile[] = [
    { path: 'src/effort/store.ts', text: 'export const ledgerRows = [];' },
    { path: 'src/effort/copy-detection.ts', text: 'export {};' },
    { path: 'src/pr/merge.ts', text: '// writes to the ledger' },
    { path: 'src/cli/main.ts', text: 'run();' },
  ];
  const clusterOf = new Map([
    ['src/effort/store.ts', 'c2'],
    ['src/effort/copy-detection.ts', 'c2'],
    ['src/pr/merge.ts', 'c1'],
  ]);
  const seeded = seedConcepts([{
    path: 'context/terminology.md',
    text: '### Copy detection\n### Spends declaration\n**The ledger** is the store.\n',
  }]);

  it('counts each concept\'s files per cluster and reads its boundary and home', () => {
    const data = readConcepts(seeded, sources, clusterOf);
    expect(data.clusters).toEqual(['c1', 'c2', 'none']);
    const byName = new Map(data.concepts.map((concept) => [concept.name, concept]));
    expect(byName.get('Copy detection')).toMatchObject({
      files: ['src/effort/copy-detection.ts'],
      byCluster: { c2: 1 },
      boundary: 'within',
      home: 'c2',
      homeShare: 100,
    });
    expect(byName.get('Spends declaration')).toMatchObject({ files: [], boundary: 'absent', home: null, homeShare: 0 });
    expect(byName.get('The ledger')).toMatchObject({
      byCluster: { c1: 1, c2: 1 },
      boundary: 'crosses',
      home: 'c1',
      homeShare: 50,
    });
    expect(data.clusterConcepts).toEqual([
      { cluster: 'c1', files: 1, concepts: 1, homed: ['The ledger'] },
      { cluster: 'c2', files: 2, concepts: 2, homed: ['Copy detection'] },
      { cluster: 'none', files: 1, concepts: 0, homed: [] },
    ]);
  });

  it('renders the matrix row, the crossing concept and the counts', () => {
    const markdown = renderConcepts(readConcepts(seeded, sources, clusterOf));
    expect(markdown).toContain('| Concept | Pages | Files | c1 | c2 | none | Boundary |');
    expect(markdown).toContain('| The ledger | terminology.md | 2 | 1 | 1 | 0 | crosses |');
    expect(markdown).toContain('- The ledger: 2 clusters, home c1 with 50%');
    expect(markdown).toContain('Absent from the code: 1. Within one cluster: 1. Crossing clusters: 1.');
  });
});

describe('readTextFiles', () => {
  it('leaves out a file that is not valid UTF-8 and one that is absent', async () => {
    plant(base, { 'a.ts': 'ok', 'b.ts': new Uint8Array([0xff, 0xfe, 0x00]) });
    expect((await readTextFiles(base, ['a.ts', 'b.ts', 'c.ts'])).map((file) => file.path)).toEqual(['a.ts']);
  });
});

describe('surveyConcepts', () => {
  /** A git repository at `base` holding `files`, all added. */
  async function repository(files: Record<string, string | Uint8Array>): Promise<void> {
    plant(base, files);
    await Bun.$`git init -q`.cwd(base).quiet();
    await Bun.$`git add -A`.cwd(base).quiet();
  }

  it('writes the reading and names an unreadable source as missed', async () => {
    await repository({
      'context/terminology.md': '## Terminology\n**The ledger** is the store.\n',
      'context/effort-store.md': '## Effort store\n```\n# not a heading\n```\n',
      'src/effort/store.ts': 'export const effortStore = 1; // the ledger\n',
      'src/effort/store.test.ts': 'the ledger\n',
      'src/broken.ts': new Uint8Array([0xc3, 0x28]),
      '.rafa/survey/import-graph.json': JSON.stringify({ data: { files: [{ path: 'src/effort/store.ts', cluster: 'c1' }] } }),
    });

    const data = await surveyConcepts(base);

    expect(data.concepts.map((concept) => [concept.name, concept.files])).toEqual([
      ['Effort store', ['src/effort/store.ts']],
      ['Terminology', []],
      ['The ledger', ['src/effort/store.ts']],
    ]);
    const markdown = await Bun.file(join(base, '.rafa/survey/concepts.md')).text();
    expect(markdown.split('\n')[0]).toBe('Coverage: 4 tracked, 3 read, 1 missed: `src/broken.ts`');
    const json = (await Bun.file(join(base, '.rafa/survey/concepts.json')).json()) as { name: string };
    expect(json.name).toBe('concepts');
  });

  it('refuses a repository with no tracked context page', async () => {
    await repository({ '.rafa/survey/import-graph.json': JSON.stringify({ data: { files: [] } }), 'src/a.ts': 'x' });
    await expect(surveyConcepts(base)).rejects.toThrow(/context\/ holds no tracked page/);
  });
});
