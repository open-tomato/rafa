import { describe, expect, test } from 'bun:test';

import {
  appendedBody,
  carriesUpdateBlock,
  originalPartHolds,
  renderUpdateBlock,
  renderUpdateHeading,
  replacedBody,
} from './issue-edit-body.js';

/** 2026-10-06 in local time, late enough that a UTC reading would name the next day east of UTC. */
const DAY = new Date(2026, 9, 6, 23, 30);
const NEXT_DAY = new Date(2026, 9, 7, 9, 0);
const BODY = '## What you get\n\nThe original spec.\n';
const BLOCK = renderUpdateBlock(DAY, 'sync design', 'One workflow moves an environment.\n');

describe('renderUpdateHeading', () => {
  test('names the local calendar day and the normalised reason', () => {
    expect(renderUpdateHeading(DAY, '  sync\n design ')).toBe('**Updated 2026-10-06, sync design:**');
  });

  test('pads a single-digit month and day', () => {
    expect(renderUpdateHeading(new Date(2026, 0, 5), 'x')).toBe('**Updated 2026-01-05, x:**');
  });

  test('refuses a reason holding nothing but whitespace', () => {
    expect(() => renderUpdateHeading(DAY, ' \n\t')).toThrow('the reason holds nothing but whitespace');
  });
});

describe('renderUpdateBlock', () => {
  test('writes the heading, a blank line and the text without its trailing whitespace', () => {
    expect(BLOCK).toBe('**Updated 2026-10-06, sync design:**\n\nOne workflow moves an environment.');
  });

  test('keeps the text\'s own lines and leading indentation', () => {
    expect(renderUpdateBlock(DAY, 'r', '  - a\n\n  - b\n\n')).toBe('**Updated 2026-10-06, r:**\n\n  - a\n\n  - b');
  });

  test('refuses text holding nothing but whitespace', () => {
    expect(() => renderUpdateBlock(DAY, 'r', '\n  \n')).toThrow('the added text holds nothing but whitespace');
  });
});

describe('appendedBody', () => {
  test('keeps the body as a byte-identical prefix and adds the block after one blank line', () => {
    const body = appendedBody(BODY, BLOCK);

    expect(body.startsWith(BODY)).toBe(true);
    expect(body).toBe(`${BODY}\n${BLOCK}`);
  });

  test('adds two line breaks after a body with no closing one', () => {
    expect(appendedBody('text', BLOCK)).toBe(`text\n\n${BLOCK}`);
  });

  test('adds no line break after a body already closing on a blank line', () => {
    expect(appendedBody('text\n\n', BLOCK)).toBe(`text\n\n${BLOCK}`);
  });

  test('writes the block alone into an empty body', () => {
    expect(appendedBody('', BLOCK)).toBe(BLOCK);
  });
});

describe('replacedBody', () => {
  test('is the text without its trailing whitespace', () => {
    expect(replacedBody('## New\n\nbody\n\n')).toBe('## New\n\nbody');
  });

  test('refuses text holding nothing but whitespace', () => {
    expect(() => replacedBody('  \n')).toThrow('the replacing text holds nothing but whitespace');
  });
});

describe('carriesUpdateBlock', () => {
  test('reads the appended body as already carrying the block, a trailing newline aside', () => {
    expect(carriesUpdateBlock(`${appendedBody(BODY, BLOCK)}\n`, BLOCK)).toBe(true);
  });

  test('is false on the body before the append, the control the true reading is weighed against', () => {
    expect(carriesUpdateBlock(BODY, BLOCK)).toBe(false);
  });

  test('is false when the same block sits earlier and something follows it', () => {
    const later = renderUpdateBlock(DAY, 'later', 'more');

    expect(carriesUpdateBlock(appendedBody(appendedBody(BODY, BLOCK), later), BLOCK)).toBe(false);
  });

  test('is false for the same reason and text on another day', () => {
    const nextDay = renderUpdateBlock(NEXT_DAY, 'sync design', 'One workflow moves an environment.');

    expect(carriesUpdateBlock(appendedBody(BODY, BLOCK), nextDay)).toBe(false);
  });

  test('is false for the same day and text under another reason', () => {
    const other = renderUpdateBlock(DAY, 'another reason', 'One workflow moves an environment.');

    expect(carriesUpdateBlock(appendedBody(BODY, BLOCK), other)).toBe(false);
  });

  test('is false when the body ends with the block\'s text but not at a line start', () => {
    expect(carriesUpdateBlock(`prefix${BLOCK}`, BLOCK)).toBe(false);
  });
});

describe('originalPartHolds', () => {
  test('holds when the re-read body is exactly the appended body', () => {
    expect(originalPartHolds(BODY, appendedBody(BODY, BLOCK), BLOCK)).toBe(true);
  });

  test('holds when the board trimmed or added trailing whitespace past the block', () => {
    expect(originalPartHolds(BODY, `${appendedBody(BODY, BLOCK)}\r\n`, BLOCK)).toBe(true);
  });

  test('is a conflict when the original part changed by one byte', () => {
    const edited = appendedBody(BODY.replace('original', 'Original'), BLOCK);

    expect(originalPartHolds(BODY, edited, BLOCK)).toBe(false);
  });

  test('is a conflict when text was added between the original and the block', () => {
    const raced = appendedBody(`${BODY}\nA browser edit.\n`, BLOCK);

    expect(originalPartHolds(BODY, raced, BLOCK)).toBe(false);
  });

  test('is a conflict when the block is missing from the re-read body', () => {
    expect(originalPartHolds(BODY, BODY, BLOCK)).toBe(false);
  });

  test('is a conflict when the separator is not the one the append wrote', () => {
    expect(originalPartHolds(BODY, `${BODY}${BLOCK}`, BLOCK)).toBe(false);
  });
});
