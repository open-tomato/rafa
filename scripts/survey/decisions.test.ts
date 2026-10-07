import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  listItems,
  markdownLines,
  parseSpecBodies,
  readContextRules,
  readDecisionSources,
  readRejectedSections,
  readTenetLines,
  renderDecisionSources,
  surveyDecisions,
} from './decisions.js';

/**
 * The decision-source collector over in-memory spec bodies and pages, and
 * once over a temporary git repository with a planted board cache, never
 * the live one. Each shape it reads sits beside a near miss it must not
 * take, so a reader that took every line would fail.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-decisions-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes `files` under `root`, creating folders. */
function plant(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A board row as the cache holds it. */
function row(number: number, labels: readonly string[], body: string): Record<string, unknown> {
  return { number, title: `Spec ${number}`, body, labels: labels.map((name) => ({ name })), state: 'OPEN' };
}

describe('markdownLines', () => {
  it('skips fenced code and table rows, and carries the nearest heading', () => {
    const lines = markdownLines('intro\n## Design\ntext\n```\n## not a heading\n```\n| a | b |\nafter\n');
    expect(lines.map((line) => [line.line, line.skipped, line.section])).toEqual([
      [1, false, null],
      [2, false, 'Design'],
      [3, false, 'Design'],
      [4, true, 'Design'],
      [5, true, 'Design'],
      [6, true, 'Design'],
      [7, true, 'Design'],
      [8, false, 'Design'],
      [9, false, 'Design'],
    ]);
  });
});

describe('listItems', () => {
  it('splits at commas outside parentheses and drops the closing and', () => {
    expect(listItems(' a shortener of commands, a reminder (of steps, mostly), and a helper.')).toEqual([
      'a shortener of commands',
      'a reminder (of steps, mostly)',
      'a helper',
    ]);
  });

  it('splits a list of one comma-free item at its and, never inside parentheses', () => {
    expect(listItems('never block and always tell')).toEqual(['never block', 'always tell']);
    expect(listItems('one thing (this and that)')).toEqual(['one thing (this and that)']);
  });
});

describe('readTenetLines', () => {
  it('reads the tenets listed after a colon that follows the word', () => {
    const [tenet] = readTenetLines({ ref: '#598', text: '## Analogies\n\n- The rafa tenets we keep: a shortener of commands, '
      + 'a simplifier of tasks, a helper and not a hinderer.\n' });
    expect(tenet).toMatchObject({ ref: '#598', line: 3, section: 'Analogies' });
    expect(tenet?.items).toEqual([
      { title: null, text: 'a shortener of commands' },
      { title: null, text: 'a simplifier of tasks' },
      { title: null, text: 'a helper and not a hinderer' },
    ]);
  });

  it('reads the list below a tenet line ending in a colon, each bold lead as a title', () => {
    const body = 'These are the project\'s tenets:\n\n1. **Never block.** A copy never refuses.\n2. **Always tell.** One line.\n'
      + '   wrapped on.\n\nAfter the list.\n';
    expect(readTenetLines({ ref: '#754', text: body })[0]?.items).toEqual([
      { title: 'Never block', text: 'A copy never refuses.' },
      { title: 'Always tell', text: 'One line. wrapped on.' },
    ]);
  });

  it('keeps a line naming the word after its colon whole, with no items, and reads no fenced line', () => {
    const body = 'Decisions live in specs: tenets in #598 (a, b) and #754.\n```\ntenets: x, y\n```\nNo such word here.\n';
    const tenets = readTenetLines({ ref: '#802', text: body });
    expect(tenets).toHaveLength(1);
    expect(tenets[0]).toMatchObject({ line: 1, text: 'Decisions live in specs: tenets in #598 (a, b) and #754.', items: [] });
  });
});

describe('readRejectedSections', () => {
  it('reads a label with text after it as one entry, its wrapped lines joined', () => {
    const body = '- **Rejected:** a lock file. A lock\n  is gone on exit.\n- **Kept:** the witness.\n';
    expect(readRejectedSections({ ref: '#754', text: body })).toEqual([
      { ref: '#754', line: 1, section: null, label: 'Rejected', entries: [{ line: 1, text: 'a lock file. A lock is gone on exit.' }] },
    ]);
  });

  it('reads a bold label holding the alternative inside the bold', () => {
    const [section] = readRejectedSections({ ref: '#725', text: '**Rejected: the usage endpoint.** It is undocumented.\n' });
    expect(section?.label).toBe('Rejected');
    expect(section?.entries).toEqual([{ line: 1, text: 'the usage endpoint. It is undocumented.' }]);
  });

  it('reads a standalone label as the list below it, up to the next paragraph', () => {
    const body = '**Rejected alternatives**\n\n- *One agent file:* fastest.\n- *rafa commands first:* weeks\n  of work.\n\nUpdated later.\n';
    expect(readRejectedSections({ ref: '#598', text: body })[0]).toMatchObject({
      label: 'Rejected alternatives',
      line: 1,
      entries: [{ line: 3, text: '*One agent file:* fastest.' }, { line: 4, text: '*rafa commands first:* weeks of work.' }],
    });
  });

  it('reads the items nested below a list-item label and stops at the next sibling', () => {
    const body = '- **Rejected:**\n  - a lint rule\n  - a second place\n- **Edge cases:** none\n';
    expect(readRejectedSections({ ref: '#1', text: body })[0]?.entries).toEqual([
      { line: 2, text: 'a lint rule' },
      { line: 3, text: 'a second place' },
    ]);
  });

  it('reads a heading section up to the next heading of its level, a deeper heading inside it', () => {
    const body = '## Alternatives rejected\n\n- **Bigger prompt.** Every task pays.\n\nA paragraph\nwrapped.\n\n### Detail\n\n'
      + '- inside\n\n## Next\n\n- outside\n';
    expect(readRejectedSections({ ref: '#197', text: body })[0]).toMatchObject({
      label: 'Alternatives rejected',
      section: 'Alternatives rejected',
      entries: [
        { line: 3, text: '**Bigger prompt.** Every task pays.' },
        { line: 5, text: 'A paragraph wrapped.' },
        { line: 10, text: 'inside' },
      ],
    });
  });

  it('reads a plain label with its colon, and no prose, colonless label or fenced line', () => {
    const body = 'Rejected: an n8n pipeline (a runtime outside the stack).\n\nFuzzy matching is rejected because it drifts.\n\n'
      + 'Rejected the idea quickly.\n```\nRejected: in a fence\n```\n| Rejected: | in a table |\n';
    expect(readRejectedSections({ ref: '#802', text: body })).toEqual([
      { ref: '#802', line: 1, section: null, label: 'Rejected', entries: [{ line: 1, text: 'an n8n pipeline (a runtime outside the stack).' }] },
    ]);
  });

  it('reads the for-now and names labels as written', () => {
    const body = '**Rejected for now:** p2p first.\n\n- **Rejected names.** `scrub` reads as cleaning.\n';
    expect(readRejectedSections({ ref: '#327', text: body }).map((section) => [section.label, section.entries[0]?.text])).toEqual([
      ['Rejected for now', 'p2p first.'],
      ['Rejected names', '`scrub` reads as cleaning.'],
    ]);
  });
});

describe('readContextRules', () => {
  it('reads each sentence saying never, always or must, and none that says it only in code', () => {
    const page = '## Imports\n\nA module never imports `rafa.ts`. It dispatches. Keep `always` in code.\n\n- Each key must be listed.\n';
    expect(readContextRules({ ref: 'context/source.md', text: page })).toEqual([
      { ref: 'context/source.md', line: 3, section: 'Imports', shape: 'word', text: 'A module never imports `rafa.ts`.' },
      { ref: 'context/source.md', line: 5, section: 'Imports', shape: 'word', text: 'Each key must be listed.' },
    ]);
  });

  it('reads a long bold lead closing on a period once, and no short or open lead', () => {
    const page = '- **A library module never imports the CLI entry.** It dispatches on argv.\n- **Short lead.** Text.\n'
      + '- **A lead of many words but no period** text.\n';
    expect(readContextRules({ ref: 'context/source.md', text: page })).toEqual([
      { ref: 'context/source.md', line: 1, section: null, shape: 'lead', text: 'A library module never imports the CLI entry.' },
    ]);
  });
});

describe('parseSpecBodies', () => {
  it('keeps the type:spec rows by number, a missing body read as empty', () => {
    const board = { rows: [row(9, ['type:spec'], 'b'), row(3, ['type:bug'], 'x'), { number: 4, labels: [{ name: 'type:spec' }] }, { title: 'none' }] };
    expect(parseSpecBodies(board)).toEqual({
      rows: 4,
      specs: [{ number: 4, title: '', body: '' }, { number: 9, title: 'Spec 9', body: 'b' }],
    });
  });

  it('refuses a cache with no rows list', () => {
    expect(() => parseSpecBodies({ version: 1 })).toThrow(/holds no rows list/);
  });
});

describe('readDecisionSources and renderDecisionSources', () => {
  it('names each spec with no rejected section and counts every reading', () => {
    const data = readDecisionSources(
      { rows: 3, specs: [{ number: 1, title: 'One', body: 'Rejected: a lock.\n' }, { number: 2, title: 'Two', body: 'tenets: a, b\n' }] },
      [{ ref: 'context/b.md', text: 'You must run it.\n' }, { ref: 'context/a.md', text: 'Plain.\n' }],
    );
    expect(data.specsWithoutRejected).toEqual([2]);
    expect(data.pages).toEqual(['context/a.md', 'context/b.md']);
    expect(data.tenetLines.map((tenet) => tenet.items.length)).toEqual([2]);
    const markdown = renderDecisionSources(data);
    expect(markdown).toContain('Specs: 2 `type:spec` bodies read of 3 board rows. Context pages: 2.');
    expect(markdown).toContain('Read: 1 tenet lines, 1 rejected sections holding 1 entries, 1 context rules.');
    expect(markdown).toContain('### Rejected (`#1:1`, One)');
    expect(markdown).toContain('Specs with no rejected section: #2');
    expect(markdown).toContain('- You must run it. (line 1, word)');
  });
});

describe('surveyDecisions', () => {
  /** A git repository at `base` holding `files`, all added. */
  async function repository(files: Record<string, string>): Promise<void> {
    plant(base, files);
    await Bun.$`git init -q`.cwd(base).quiet();
    await Bun.$`git add -A`.cwd(base).quiet();
  }

  it('writes both outputs, its coverage over the tracked pages only', async () => {
    await repository({ 'context/a.md': '## A\n\nIt must hold.\n', 'context/b.md': 'Never mind.\n' });
    plant(base, { 'context/untracked.md': 'You must not read me.\n' });
    const boardPath = join(base, 'elsewhere', 'board.json');
    plant(base, { 'elsewhere/board.json': JSON.stringify({ rows: [row(5, ['type:spec'], '- **Rejected:** a flag.\n')] }) });
    const data = await surveyDecisions(base, boardPath);
    expect(data.pages).toEqual(['context/a.md', 'context/b.md']);
    expect(data.rules.map((rule) => rule.ref)).toEqual(['context/a.md', 'context/b.md']);
    const json = await Bun.file(join(base, '.rafa/survey/decision-sources.json')).json();
    expect(json.name).toBe('decision-sources');
    expect(json.data.rejected[0].entries[0].text).toBe('a flag.');
    const markdown = await Bun.file(join(base, '.rafa/survey/decision-sources.md')).text();
    expect(markdown.split('\n')[0]).toBe('Coverage: 2 tracked, 2 read, 0 missed: none');
  });

  it('reads the board cache at its default path, and names how to fill it when absent', async () => {
    await repository({ 'context/a.md': 'Plain.\n' });
    await expect(surveyDecisions(base)).rejects.toThrow(/board\.json is absent: run rafa roadmap/);
    plant(base, { '.rafa/cache/board.json': JSON.stringify({ rows: [row(1, ['type:spec'], 'x')] }) });
    expect((await surveyDecisions(base)).specs).toEqual([{ number: 1, title: 'Spec 1' }]);
  });

  it('refuses a repository with no tracked context page', async () => {
    await repository({ 'README.md': 'x\n', '.rafa/cache/board.json': JSON.stringify({ rows: [] }) });
    await expect(surveyDecisions(base)).rejects.toThrow(/context\/ holds no tracked page/);
  });
});
