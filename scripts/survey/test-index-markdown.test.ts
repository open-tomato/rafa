import type { SourceReach, TestIndex, TestIndexEntry } from './test-index';

import { describe, expect, it } from 'bun:test';

import { TOP_INDEXES, TOP_REACHED, renderTestIndexMarkdown } from './test-index-markdown';

/** An indexed test, with every list empty unless `fields` names it. */
function testEntry(test: string, fields: Partial<TestIndexEntry>): TestIndexEntry {
  return {
    folder: 'src/near',
    folders: [],
    index: 0,
    sourceFiles: 0,
    spawns: false,
    spawnsVia: [],
    support: [],
    supportFolders: [],
    test,
    ...fields,
  };
}

/** A source file and the tests that reach it, from another folder or not. */
function sourceReach(source: string, tests: readonly string[], fromOtherFolders: number): SourceReach {
  return { folder: 'src/near', source, supportOnlyTests: [], tests, testsFromOtherFolders: fromOtherFolders };
}

const LOW = 'src/near/low.test.ts';
const HIGH = 'src/near/high.test.ts';
const TIED = 'src/far/tied.test.ts';
const UNREAD = 'src/far/unread.test.ts';
const NEAR = 'src/near/near.ts';
const FAR = 'src/far/far.ts';
const ALONE = 'src/alone/alone.ts';

const index: TestIndex = {
  read: [ALONE, FAR, HIGH, LOW, NEAR, TIED],
  sources: [
    sourceReach(ALONE, [], 0),
    sourceReach(FAR, [HIGH, LOW, TIED], 2),
    sourceReach(NEAR, [HIGH, LOW], 0),
  ],
  tests: [
    testEntry(HIGH, { folders: ['src/far', 'src/near'], index: 4, spawns: true, spawnsVia: [HIGH], supportFolders: ['src/tests'] }),
    testEntry(LOW, { folders: ['src/near'], index: 1 }),
    testEntry(TIED, { folders: ['src/far'], index: 1 }),
  ],
  unindexed: [UNREAD],
  unplaced: [],
};
const tracked = [...index.read, UNREAD];

describe('the markdown of the test index', () => {
  const markdown = renderTestIndexMarkdown(index, tracked);
  const rows = markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));

  it('opens with the coverage line and the counts, and ends in a newline', () => {
    expect(markdown).toStartWith(`# Test index\n\nCoverage: 6 of 7 tracked files read (src/ and packages/*/src/). Not read: \`${UNREAD}\`.\n`);
    expect(markdown).toContain('3 test files indexed, 1 of them spawning a process; 3 source files, 1 of them reached by no test');
    expect(markdown).toEndWith(`- \`${UNREAD}\`\n`);
  });

  it('ranks the highest index first, a tie by path, with its spawning files and support-only folders', () => {
    expect(markdown).toContain(`## The ${TOP_INDEXES} highest indexes`);
    expect(rows.slice(0, 3)).toEqual([
      `| 1 | \`${HIGH}\` | 4 | 2 | \`${HIGH}\` | \`src/tests\` |`,
      `| 2 | \`${TIED}\` | 1 | 1 | - | - |`,
      `| 3 | \`${LOW}\` | 1 | 1 | - | - |`,
    ]);
  });

  it('lists only the source files a test from another folder reaches', () => {
    expect(markdown).toContain(`## The ${TOP_REACHED} source files reached by the most test files from other folders`);
    // `near.ts` is reached only from its own folder and `alone.ts` by no test: both are left out.
    expect(rows.slice(3)).toEqual([`| 1 | \`${FAR}\` | 2 | 3 | 0 |`]);
  });

  it('names the unindexed tests under their heading, and leaves the heading out when there are none', () => {
    expect(markdown).toContain('## Unindexed tests');
    const read = renderTestIndexMarkdown({ ...index, unindexed: [] }, index.read);
    expect(read).not.toContain('## Unindexed tests');
    expect(read).toContain('Coverage: 6 of 6 tracked files read (src/ and packages/*/src/).\n');
  });

  it('keeps at most the top rows of each table', () => {
    const many = Array.from({ length: TOP_INDEXES + 5 }, (_, at) => testEntry(`src/near/t${String(at).padStart(2, '0')}.test.ts`, { index: 1 }));
    const long = renderTestIndexMarkdown({ ...index, sources: [], tests: many }, []);
    expect(long.split('\n').filter((line) => /^\| \d+ \|/.test(line))).toHaveLength(TOP_INDEXES);
  });
});
