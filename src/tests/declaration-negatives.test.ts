/**
 * The declaration parser's negative paths, each with its own control.
 *
 * `utils/declaration.test.ts` beside the module drives the grammar it
 * ACCEPTS, and hands these six shapes here by name: an unclosed
 * brace, nested braces, a trailing code span, an unrecognised key, an
 * empty block, and a block that is not anchored at end of line. All
 * six are REFUSALS, and a refusal case is satisfied by a parser that
 * refuses everything — so every case below carries its own
 * positive control, in the same body, varied along the one axis the
 * case is named for and holding the rest fixed:
 *
 *   - the unterminated block, against the same text one closing brace
 *     later;
 *   - the nested value, against the same block with the inner braces
 *     dropped and nothing else changed;
 *   - the code span, against the same sentence with its backticks
 *     gone, which is the whole of the difference;
 *   - the unrecognised key, against the SAME VALUE under a key the
 *     grammar answers to, so the refusal is shown to be about the key
 *     rather than about what it was set to;
 *   - the empty block, against a block carrying one pair;
 *   - the unanchored block, against the same block moved to the end.
 *
 * The shapes are ones a PLAN can write rather than invented ones. A
 * task naming a routing block inside a code span, a task ending on a
 * JSON payload, a planner's forgotten brace and a planner's full stop
 * after the block are each a line this repo's own documents could
 * produce, and each would otherwise be dispatched with its text cut
 * short — which reads as the loop having lost half the task
 * rather than as a parser being wrong about a brace.
 *
 * Two claims stay with the colocated suite deliberately: a block that
 * is the WHOLE text, which is read here only as the second half of a
 * compound mutation below, and the flag-mapping matrix, which the
 * plan gives a task of its own.
 *
 * ## The mutation grid
 *
 * Ten module mutations were driven against this file and EIGHT
 * reddened at least one case. The first eight ran TWICE and named the
 * identical red set on both passes, with the module restored
 * bytes-identical and all 15 cases green either side.
 *
 * The two legs this file exists for are the two the colocated suite
 * recorded as GREEN and could not reach, every fixture it holds
 * putting its braces exactly where a well-formed block goes. Dropping
 * the end anchor (`/\{([^{}]*)\}$/` to `/\{([^{}]*)\}/`) reddens FIVE
 * cases here, and widening the body class to admit a nested brace
 * (`[^{}]*` to `[\s\S]*`) reddens FOUR. Re-driving those two is how
 * this file knows its cases reached the module at all.
 *
 * The rest split. Dropping the recognised-key rule reddens the five
 * that rest on it: both empty blocks and all three unrecognised-key
 * cases. Making BOTH braces optional reddens two, the unterminated
 * block and one nested case. Folding a key's case before matching it,
 * and dropping the `trimEnd`, redden one case each, which is what
 * says the case-split and trailing-space controls carry their own
 * claims rather than riding along.
 *
 * Every case here is in that union except ONE, and the reason is
 * worth recording rather than reading as a hole. The closing brace
 * with no opener is defended by TWO layers: with only the OPENING
 * brace made optional the leftmost match still begins at index 0, so
 * the block becomes the whole text and the whole-text rule refuses it
 * anyway. That leg reddens a different case, the whole-text leg
 * reddens none, and the COMPOUND of the two reddens this one — which
 * is the reading that ties the two layers together, where two solo
 * greens would have named nothing.
 *
 * The two legs that reddened nothing are named rather than dropped.
 * Keeping an empty token instead of discarding it changes only an
 * issue record, and a refused block reports its issues to nobody, so
 * the leg is unobservable here by construction — the empty-block
 * refusal rests on the recognised-key rule, which IS reddened.
 * Dropping the whole-text rule on its own has no fixture here to
 * bite, that claim being the colocated suite's.
 */
import type { TaskDeclaration } from '../utils/declaration.js';

import { describe, expect, it } from 'vitest';

import {
  parseTaskDeclaration,
  resolveDeclarationFlags,
  stripTaskDeclaration,
} from '../utils/declaration.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** A code span's delimiter, kept out of the template literals. */
const TICK = '`';

/**
 * Each recognised key beside a near miss of it, with the VALUE held
 * fixed so the only thing varying across a pair is the key spelling.
 */
const KEY_PAIRS = [
  { good: 'agent=doc-updater', near: 'agents=doc-updater' },
  { good: 'model=haiku', near: 'modell=haiku' },
  { good: 'effort=low', near: 'efort=low' },
  { good: 'tools=Read', near: 'tool=Read' },
];

/**
 * Asserts a text carries no declaration, in all three ways the loop
 * can ask: nothing parsed, nothing stripped, no flag resolved.
 */
function expectTaskText(taskText: string): void {
  const parsed = parseTaskDeclaration(taskText);

  expect(parsed.declaration).toBeNull();
  expect(parsed.text).toBe(taskText);
  expect(stripTaskDeclaration(taskText)).toBe(taskText);
  expect(resolveDeclarationFlags(parsed.declaration).args).toEqual([]);
}

/**
 * The positive control's other half: asserts a text DOES declare, and
 * answers what it declared so the case can name the value.
 */
function expectDeclaration(taskText: string): TaskDeclaration {
  const parsed = parseTaskDeclaration(taskText);
  if (parsed.declaration === null) {
    throw new Error(`no declaration parsed from: ${taskText}`);
  }
  expect(parsed.text.length).toBeLessThan(taskText.length);
  return parsed.declaration;
}

describe('an unclosed brace', () => {
  it('reads an unterminated block as task text', () => {
    const opened = `Add the routing table${GAP}{agent=doc-updater`;

    expectTaskText(opened);
    expect(expectDeclaration(`${opened}}`).agent).toBe('doc-updater');
  });

  it('reads a closing brace with no opener as task text', () => {
    const text = 'Add the routing table';
    const body = 'agent=doc-updater';

    expectTaskText(`${text}${GAP}${body}}`);
    expect(expectDeclaration(`${text}${GAP}{${body}}`).agent)
      .toBe('doc-updater');
  });
});

describe('nested braces', () => {
  it('reads a brace inside a later value as task text', () => {
    const text = 'Route the migration task';

    expectTaskText(`${text}${GAP}{agent=doc-updater note={see it}}`);

    const declaration = expectDeclaration(
      `${text}${GAP}{agent=doc-updater note=see-it}`,
    );
    expect(declaration.agent).toBe('doc-updater');
    expect(declaration.extras).toEqual([{ key: 'note', value: 'see-it' }]);
  });

  it('reads a brace before a recognised key as task text', () => {
    const text = 'Refuse a settings block';

    expectTaskText(`${text}${GAP}{note={x} effort=low}`);
    expect(expectDeclaration(`${text}${GAP}{note=x effort=low}`).effort)
      .toBe('low');
  });
});

describe('a trailing code span', () => {
  it('reads a declaration inside a code span as task text', () => {
    const shown = 'Show a routing block as';
    const block = '{agent=doc-updater}';

    expectTaskText(`${shown} ${TICK}${block}${TICK}`);
    expect(expectDeclaration(`${shown} ${block}`).agent).toBe('doc-updater');
  });

  it('keeps a braced code span in the text it answers', () => {
    const payload = `${TICK}{"mode": "fast"}${TICK}`;
    const text = `Refuse a settings payload of ${payload}`;

    expectTaskText(text);

    const line = `${text}${GAP}{effort=low}`;
    expect(expectDeclaration(line).effort).toBe('low');
    expect(stripTaskDeclaration(line)).toBe(text);
  });
});

describe('an unrecognised key', () => {
  it('reads a lone unrecognised key as task text', () => {
    const text = 'Collect the session logs';

    expectTaskText(`${text}${GAP}{queue=q19}`);

    const declaration = expectDeclaration(`${text}${GAP}{effort=q19}`);
    expect(declaration.effort).toBeNull();
    expect(declaration.issues).toEqual([
      { reason: 'unusable-value', key: 'effort', text: 'effort=q19' },
    ]);
  });

  it('answers only to the lower-case spelling of a key', () => {
    const text = 'Route the doc task';

    expectTaskText(`${text}${GAP}{Agent=doc-updater}`);
    expectTaskText(`${text}${GAP}{AGENT=doc-updater}`);
    expect(expectDeclaration(`${text}${GAP}{agent=doc-updater}`).agent)
      .toBe('doc-updater');
  });

  it('reads a near miss of each of the four keys as text', () => {
    const text = 'Route the doc task';

    for (const pair of KEY_PAIRS) {
      expectTaskText(`${text}${GAP}{${pair.near}}`);
      expect(parseTaskDeclaration(`${text}${GAP}{${pair.good}}`).text)
        .toBe(text);
    }

    expect(KEY_PAIRS).toHaveLength(4);
  });
});

describe('an empty block', () => {
  it('reads an empty block as task text', () => {
    const text = 'Add the store gitignore entry';

    expectTaskText(`${text}${GAP}{}`);
    expect(expectDeclaration(`${text}${GAP}{effort=low}`).effort).toBe('low');
  });

  it('reads a whitespace-only block as task text', () => {
    const text = 'Add the store gitignore entry';

    const padded = `${text}${GAP}{ effort=low }`;

    expectTaskText(`${text}${GAP}{   }`);
    expectTaskText(`${text}${GAP}{\t}`);
    expect(expectDeclaration(padded).effort).toBe('low');
  });
});

describe('a block that is not anchored at end of line', () => {
  it('reads a block with words after it as task text', () => {
    const before = 'Run the collector';
    const block = '{effort=low}';

    const moved = `${before} and then report${GAP}${block}`;

    expectTaskText(`${before} ${block} and then report`);
    expect(expectDeclaration(moved).effort).toBe('low');
  });

  it('reads a block followed by a full stop as task text', () => {
    const before = 'Run the collector';
    const block = '{effort=low}';

    expectTaskText(`${before}${GAP}${block}.`);
    expect(expectDeclaration(`${before}${GAP}${block}`).effort).toBe('low');
  });

  it('takes the last block when a line carries two', () => {
    const before = `Run the collector${GAP}{agent=doc-updater}`;
    const parsed = parseTaskDeclaration(`${before} {effort=low}`);

    expect(parsed.declaration?.effort).toBe('low');
    expect(parsed.declaration?.agent).toBeNull();
    expect(parsed.text).toBe(before);
  });

  it('reads a block through the spaces a line trails it with', () => {
    const before = 'Run the collector';
    const line = `${before}${GAP}{effort=low}${GAP} `;

    expect(expectDeclaration(line).effort).toBe('low');
    expect(stripTaskDeclaration(line)).toBe(before);
  });
});
