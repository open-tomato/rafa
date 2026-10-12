/**
 * Tests for the fenced-block reader.
 *
 * Every fixture is a list of lines joined here, so a span can be read
 * off the fixture by counting entries rather than trusted from the
 * module, and the span cases read the covered lines back out of the
 * text with a split of the test's own.
 *
 * Each case that reads NO block carries a near miss that reads one: the
 * same lines with only the thing the rule is keyed on changed. The
 * table of empty documents shares one, the case after it. A reader
 * answering an empty list for every document passes each refusal on
 * its own, and fails its near miss.
 *
 * The last section holds CHARACTERIZATIONS, named as such. They pin the
 * four shapes where this reader and CommonMark disagree, which the
 * module note states as measured against micromark; a change teaching
 * the reader containers reddens them and says which sentence went
 * stale.
 *
 * Thirty module mutations were driven against this file, run alone
 * once per leg, and every one reddened at least one case, with the
 * restored module byte-identical and green either side: an opening
 * fence allowed a fourth space or a tab, or refused tildes; the
 * backtick rule dropped, or applied to tildes; a closing fence taking
 * the other character, a shorter run, an info string or a fourth
 * space, or refusing trailing whitespace; an opening fence closing
 * itself; an unclosed block dropped, marked closed or spanned past the
 * end; an unknown kind dropped; either end of a span counted from zero;
 * a carriage return kept; a final newline read as a line; fences in
 * other languages left untracked; the body left indented or dedented
 * without bound; the prefix matched in any case or anywhere in the
 * word; the kind taken from the whole info string or from one left
 * untrimmed; every answer empty; the order reversed; and the kind list
 * shortened or its guard loosened.
 */
import type { LineSpan } from './blocks.js';

import { describe, expect, it } from 'bun:test';

import { isRafaBlockKind, RAFA_BLOCK_KINDS, readRafaBlocks } from './blocks.js';

/** A bare backtick fence, spelled once. */
const FENCE = '```';

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The lines a span covers, read back with a split of the test's own. */
function linesAt(text: string, span: LineSpan): string[] {
  return text.split('\n').slice(span.first - 1, span.last);
}

/** The kinds alone, for cases about which blocks were found. */
function kindsOf(text: string): string[] {
  return readRafaBlocks(text).map((block) => block.kind);
}

/** The format's own example, written at the top level as a plan writes it. */
const PLAN_LINES = [
  '# Plan: Example',
  '',
  '```rafa:plan',
  'stub: my-feature',
  'issue: OPT-123',
  '```',
  '',
  '```rafa:context',
  'Prose the loop injects into EVERY task.',
  '```',
  '',
  '# Stage: schema',
  '',
  '```rafa:stage-context',
  'Prose the loop injects only into tasks under THIS stage heading.',
  '```',
  '',
  '- [ ] Add the Zod schema for CreateJobRequest  {agent=loop-implementer effort=high}',
];

const PLAN = doc(...PLAN_LINES);

describe('a document with no block', () => {
  it.each([
    ['an empty string', ''],
    ['a lone newline', '\n'],
    ['prose naming the prefix', doc('# Title', '', 'A paragraph naming rafa:plan in passing.')],
    ['a checklist', doc('# Stage: one', '- [ ] Do the thing', '- [x] Done')],
    [
      'fences in other languages',
      doc('```ts', 'const a = 1;', '```', '~~~yaml', 'rafa: plan', '~~~'),
    ],
  ])('answers an empty list for %s', (_label, text) => {
    expect(readRafaBlocks(text)).toEqual([]);
  });

  it('answers the blocks of a plan, the near miss for every case above', () => {
    expect(kindsOf(PLAN)).toEqual(['plan', 'context', 'stage-context']);
  });
});

describe('reading a block', () => {
  it('answers each block of a plan with its kind, body and span, in source order', () => {
    expect(readRafaBlocks(PLAN)).toEqual([
      {
        kind: 'plan',
        body: 'stub: my-feature\nissue: OPT-123',
        span: { first: 3, last: 6 },
        closed: true,
      },
      {
        kind: 'context',
        body: 'Prose the loop injects into EVERY task.',
        span: { first: 8, last: 10 },
        closed: true,
      },
      {
        kind: 'stage-context',
        body: 'Prose the loop injects only into tasks under THIS stage heading.',
        span: { first: 14, last: 16 },
        closed: true,
      },
    ]);
  });

  it('spans each block from its opening fence to its closing fence, counting from one', () => {
    const blocks = readRafaBlocks(PLAN);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      const covered = linesAt(PLAN, block.span);
      expect(covered[0]).toBe(`${FENCE}rafa:${block.kind}`);
      expect(covered.at(-1)).toBe(FENCE);
      expect(covered.slice(1, -1).join('\n')).toBe(block.body);
    }
  });

  it('answers two blocks of one kind both, in source order', () => {
    const text = doc(
      '```rafa:report',
      'status: blocked',
      '```',
      'Retried.',
      '```rafa:report',
      'status: done',
      '```',
    );
    const bodies = readRafaBlocks(text).map((block) => block.body);
    expect(bodies).toEqual(['status: blocked', 'status: done']);
  });

  it('answers a block with no line between its fences with an empty body', () => {
    expect(readRafaBlocks(doc('```rafa:context', '```'))).toEqual([
      { kind: 'context', body: '', span: { first: 1, last: 2 }, closed: true },
    ]);
  });

  it('reads a fence that interrupts a paragraph, with no blank line above it', () => {
    const text = doc('Prose runs straight into', '```rafa:context', 'body', '```');
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'context', body: 'body', span: { first: 2, last: 4 }, closed: true },
    ]);
  });

  it('reads a tilde fence as it reads a backtick one', () => {
    expect(readRafaBlocks(doc('~~~rafa:plan', 'stub: a', '~~~'))).toEqual([
      { kind: 'plan', body: 'stub: a', span: { first: 1, last: 3 }, closed: true },
    ]);
  });
});

describe('the kind', () => {
  it('is the first word of the info string, after any spaces, less its prefix', () => {
    const text = doc('```   rafa:plan with more words', 'stub: a', '```');
    expect(kindsOf(text)).toEqual(['plan']);
  });

  it('names no rafa block unless rafa: opens the first word', () => {
    expect(kindsOf(doc('```text rafa:plan', 'x', '```'))).toEqual([]);
    expect(kindsOf(doc('```xrafa:plan', 'x', '```'))).toEqual([]);
    expect(kindsOf(doc('```rafa:plan text', 'x', '```'))).toEqual(['plan']);
  });

  it('needs its prefix in lower case, and is kept as written after it', () => {
    expect(kindsOf(doc('```RAFA:plan', 'x', '```'))).toEqual([]);
    expect(kindsOf(doc('```rafa:Plan', 'x', '```'))).toEqual(['Plan']);
    expect(kindsOf(doc('```rafa:plan', 'x', '```'))).toEqual(['plan']);
  });

  it('is empty for rafa: alone, and the block is still answered', () => {
    expect(readRafaBlocks(doc('```rafa:', 'x', '```'))).toEqual([
      { kind: '', body: 'x', span: { first: 1, last: 3 }, closed: true },
    ]);
  });
});

describe('an unknown kind', () => {
  const text = doc(
    '```rafa:plan',
    'stub: a',
    '```',
    '```rafa:future-thing',
    'anything: [not yaml',
    '```',
    '```rafa:context',
    'c',
    '```',
  );

  it('is answered in place with its body and span, beside the known kinds', () => {
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'plan', body: 'stub: a', span: { first: 1, last: 3 }, closed: true },
      {
        kind: 'future-thing',
        body: 'anything: [not yaml',
        span: { first: 4, last: 6 },
        closed: true,
      },
      { kind: 'context', body: 'c', span: { first: 7, last: 9 }, closed: true },
    ]);
  });

  it('is told apart from the four kinds this phase defines', () => {
    expect(RAFA_BLOCK_KINDS).toEqual(['plan', 'context', 'stage-context', 'report']);
    for (const kind of RAFA_BLOCK_KINDS) expect(isRafaBlockKind(kind)).toBe(true);
    for (const kind of ['future-thing', '', 'Plan', 'stage_context', 'reports']) {
      expect(isRafaBlockKind(kind)).toBe(false);
    }
  });
});

describe('a line that opens no fence', () => {
  it('reads no block from a fence that does not open its line, and one once it does', () => {
    const quoted = doc('A block opens with ```rafa:plan', 'stub: a', '```');
    const opened = doc('A block opens with', '```rafa:plan', 'stub: a', '```');
    expect(kindsOf(quoted)).toEqual([]);
    expect(kindsOf(opened)).toEqual(['plan']);
  });

  it('reads no block from an inline code span, and one without its closing backticks', () => {
    expect(kindsOf(doc('```rafa:plan``` opens a block', 'stub: a'))).toEqual([]);
    expect(kindsOf(doc('```rafa:plan opens a block', 'stub: a'))).toEqual(['plan']);
  });

  it('lets a tilde fence carry a backtick in its info string', () => {
    expect(kindsOf(doc('~~~rafa:plan `quoted`', 'stub: a', '~~~'))).toEqual(['plan']);
  });

  it('reads a fence indented three spaces and none indented four', () => {
    expect(kindsOf(doc('   ```rafa:plan', 'stub: a', '   ```'))).toEqual(['plan']);
    expect(kindsOf(doc('    ```rafa:plan', 'stub: a', '    ```'))).toEqual([]);
  });

  it('reads no fence behind a tab, whatever spaces precede it, and one behind a space', () => {
    expect(kindsOf(doc('\t```rafa:plan', 'stub: a', '```'))).toEqual([]);
    expect(kindsOf(doc(' \t```rafa:plan', 'stub: a', '```'))).toEqual([]);
    expect(kindsOf(doc(' ```rafa:plan', 'stub: a', '```'))).toEqual(['plan']);
  });
});

describe('a fence inside another fence', () => {
  it('is body of an illustration opened with a longer fence, and a block outside it', () => {
    const example = ['```rafa:plan', 'stub: example', '```'];
    expect(kindsOf(doc('````markdown', ...example, '````'))).toEqual([]);
    expect(kindsOf(doc(...example))).toEqual(['plan']);
  });

  it('is body of a tilde fence, and a block outside it', () => {
    const example = ['```rafa:context', 'x', '```'];
    expect(kindsOf(doc('~~~text', ...example, '~~~'))).toEqual([]);
    expect(kindsOf(doc(...example))).toEqual(['context']);
  });

  it('is body of a bare fence, which its own line does not close', () => {
    const example = ['```rafa:plan', 'stub: a', '```'];
    expect(kindsOf(doc(FENCE, ...example))).toEqual([]);
    expect(kindsOf(doc(...example))).toEqual(['plan']);
  });

  it('is body of an earlier fence never closed, and a block once that one closes', () => {
    const unclosed = doc('```ts', 'const a = 1;', '```rafa:plan', 'stub: a');
    const closedFirst = doc('```ts', 'const a = 1;', '```', '```rafa:plan', 'stub: a');
    expect(kindsOf(unclosed)).toEqual([]);
    expect(kindsOf(closedFirst)).toEqual(['plan']);
  });

  it('is body of a longer rafa fence, which alone is answered', () => {
    const text = doc('````rafa:context', '```rafa:plan', 'stub: inner', '```', '````');
    expect(readRafaBlocks(text)).toEqual([
      {
        kind: 'context',
        body: '```rafa:plan\nstub: inner\n```',
        span: { first: 1, last: 5 },
        closed: true,
      },
    ]);
  });
});

describe('closing a block', () => {
  it('takes no fence carrying an info string', () => {
    const text = doc('```rafa:context', '```ts', 'after', '```');
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'context', body: '```ts\nafter', span: { first: 1, last: 4 }, closed: true },
    ]);
  });

  it('takes no fence shorter than the opening one', () => {
    const text = doc('````rafa:context', '```', 'after', '````');
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'context', body: '```\nafter', span: { first: 1, last: 4 }, closed: true },
    ]);
  });

  it('takes no fence of the other character', () => {
    const text = doc('```rafa:context', '~~~', 'after', '```');
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'context', body: '~~~\nafter', span: { first: 1, last: 4 }, closed: true },
    ]);
  });

  it('takes a fence indented three spaces and none indented four', () => {
    expect(readRafaBlocks(doc('```rafa:context', 'x', '   ```', 'after'))).toEqual([
      { kind: 'context', body: 'x', span: { first: 1, last: 3 }, closed: true },
    ]);
    expect(readRafaBlocks(doc('```rafa:context', 'x', '    ```', 'after'))).toEqual([
      {
        kind: 'context',
        body: 'x\n    ```\nafter',
        span: { first: 1, last: 4 },
        closed: false,
      },
    ]);
  });

  it('takes a longer fence, and one trailed by spaces and tabs', () => {
    expect(readRafaBlocks(doc('```rafa:context', 'x', '`````', 'after'))).toEqual([
      { kind: 'context', body: 'x', span: { first: 1, last: 3 }, closed: true },
    ]);
    expect(readRafaBlocks(doc('```rafa:context', 'x', '``` \t ', 'after'))).toEqual([
      { kind: 'context', body: 'x', span: { first: 1, last: 3 }, closed: true },
    ]);
  });
});

describe('a block never closed', () => {
  it('runs to the end of the document, and says so', () => {
    const text = doc('Final message.', '```rafa:report', 'status: done', 'feedback: |');
    expect(readRafaBlocks(text)).toEqual([
      {
        kind: 'report',
        body: 'status: done\nfeedback: |',
        span: { first: 2, last: 4 },
        closed: false,
      },
    ]);
  });

  it('reads the same whether or not the document ends in a newline', () => {
    const text = doc('Final message.', '```rafa:report', 'status: done');
    expect(readRafaBlocks(text)[0]?.span).toEqual({ first: 2, last: 3 });
    expect(readRafaBlocks(text.slice(0, -1))).toEqual(readRafaBlocks(text));
  });

  it('keeps a blank line before the end of the document as body', () => {
    expect(readRafaBlocks('```rafa:report\nstatus: done\n\n')).toEqual([
      { kind: 'report', body: 'status: done\n', span: { first: 1, last: 3 }, closed: false },
    ]);
  });

  it('answers a lone opening fence with an empty body on one line', () => {
    expect(readRafaBlocks('```rafa:report')).toEqual([
      { kind: 'report', body: '', span: { first: 1, last: 1 }, closed: false },
    ]);
  });
});

describe('the body', () => {
  it('loses up to the opening fence indentation from each line', () => {
    const text = doc('  ```rafa:context', '    deeper', ' one', 'none', '  ```');
    expect(readRafaBlocks(text)).toEqual([
      { kind: 'context', body: '  deeper\none\nnone', span: { first: 1, last: 5 }, closed: true },
    ]);
  });

  it('reads a CRLF document exactly as its LF twin', () => {
    const crlf = PLAN.replaceAll('\n', '\r\n');
    expect(crlf).toContain('rafa:plan\r\n');
    expect(readRafaBlocks(PLAN)).toHaveLength(3);
    expect(readRafaBlocks(crlf)).toEqual(readRafaBlocks(PLAN));
  });
});

describe('characterizations: where CommonMark reads otherwise', () => {
  it('reads no fence inside a block quote, and one once the quote marks go', () => {
    expect(kindsOf(doc('> ```rafa:context', '> x', '> ```'))).toEqual([]);
    expect(kindsOf(doc('```rafa:context', 'x', '```'))).toEqual(['context']);
  });

  it('reads no fence inside a list item indented four columns, and one indented two', () => {
    const deep = doc('1.  Item', '', '    ```rafa:context', '    x', '    ```');
    const shallow = doc('- Item', '  ```rafa:context', '  x', '  ```');
    expect(kindsOf(deep)).toEqual([]);
    expect(kindsOf(shallow)).toEqual(['context']);
  });

  it('reads a fence inside a multi-line HTML comment as a block', () => {
    const text = doc('<!--', '```rafa:context', 'x', '```', '-->');
    expect(kindsOf(text)).toEqual(['context']);
  });

  it('breaks no line on a lone carriage return', () => {
    expect(readRafaBlocks('~~~rafa:context\rx\r~~~')).toEqual([
      { kind: 'context', body: '', span: { first: 1, last: 1 }, closed: false },
    ]);
  });
});
