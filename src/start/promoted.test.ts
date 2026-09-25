/**
 * Tests for the `rafa:promoted` block parser (`src/start/promoted.ts`).
 *
 * Each rejection case is paired with an accepting one that differs from
 * it by the one thing refused, so a parser that accepted or refused
 * everything fails one of the two.
 */
import { describe, expect, it } from 'bun:test';

import { parsePromoted, PROMOTED_BLOCK_KIND } from './promoted.js';

const FENCE = '```';

/** A session output whose one `rafa:promoted` block holds `lines`. */
function output(...lines: string[]): string {
  return ['Done.', '', `${FENCE}rafa:${PROMOTED_BLOCK_KIND}`, ...lines, FENCE, ''].join('\n');
}

/** The line number of the block's first body line in {@link output}. */
const FIRST = 4;

describe('parsePromoted', () => {
  it('answers a promoted and a skipped line with their ids and lines', () => {
    const reading = parsePromoted(output(
      'bun-test-1a2b3c4d → context/verification.md',
      'lint-order-5e6f7a8b → skipped: a skill already covers it',
    ));

    expect(reading).toEqual({
      status: 'read',
      answers: [
        { kind: 'promoted', id: 'bun-test-1a2b3c4d', path: 'context/verification.md', line: FIRST },
        { kind: 'skipped', id: 'lint-order-5e6f7a8b', reason: 'a skill already covers it', line: FIRST + 1 },
      ],
      unreadable: [],
    });
  });

  it('accepts the ASCII arrow as it accepts the arrow', () => {
    const reading = parsePromoted(output('a-1 -> context/cli.md', 'b-2 ->skipped:  too narrow '));

    expect(reading.answers).toEqual([
      { kind: 'promoted', id: 'a-1', path: 'context/cli.md', line: FIRST },
      { kind: 'skipped', id: 'b-2', reason: 'too narrow', line: FIRST + 1 },
    ]);
    expect(reading.unreadable).toEqual([]);
  });

  it('reads skipped case-insensitively', () => {
    const reading = parsePromoted(output('a-1 → Skipped: covered'));

    expect(reading.answers).toEqual([{ kind: 'skipped', id: 'a-1', reason: 'covered', line: FIRST }]);
  });

  it('drops a list marker and wrapping backticks', () => {
    const reading = parsePromoted(output('- `a-1` → `context/cli.md`', '* b-2 → skipped: covered'));

    expect(reading.answers).toEqual([
      { kind: 'promoted', id: 'a-1', path: 'context/cli.md', line: FIRST },
      { kind: 'skipped', id: 'b-2', reason: 'covered', line: FIRST + 1 },
    ]);
  });

  it('skips blank lines while numbering the rest from the whole output', () => {
    const reading = parsePromoted(output('', 'a-1 → context/cli.md', '   ', 'b-2 → README.md'));

    expect(reading.answers.map((answer) => answer.line)).toEqual([FIRST + 1, FIRST + 3]);
    expect(reading.unreadable).toEqual([]);
  });

  it('reports a line with no arrow, and keeps reading the next', () => {
    const reading = parsePromoted(output('a-1 context/cli.md', 'b-2 → README.md'));

    expect(reading.unreadable).toEqual([
      { line: FIRST, text: 'a-1 context/cli.md', reason: 'it holds no `→` or `->`' },
    ]);
    expect(reading.answers).toEqual([{ kind: 'promoted', id: 'b-2', path: 'README.md', line: FIRST + 1 }]);
  });

  it('reports a missing id and an id holding whitespace', () => {
    const reading = parsePromoted(output('→ context/cli.md', 'a 1 → context/cli.md'));

    expect(reading.answers).toEqual([]);
    expect(reading.unreadable.map((entry) => entry.reason)).toEqual([
      'it names no id',
      'its id `a 1` holds whitespace',
    ]);
  });

  it('reports a missing path and a path followed by prose', () => {
    const reading = parsePromoted(output('a-1 →', 'b-2 → context/cli.md, the help section'));

    expect(reading.answers).toEqual([]);
    expect(reading.unreadable.map((entry) => entry.reason)).toEqual([
      'it names no path',
      'its path `context/cli.md, the help section` holds whitespace',
    ]);
  });

  it('reports a skip with no reason', () => {
    const reading = parsePromoted(output('a-1 → skipped:', 'b-2 → skipped:   '));

    expect(reading.answers).toEqual([]);
    expect(reading.unreadable.map((entry) => entry.reason)).toEqual([
      'it skips `a-1` without a reason',
      'it skips `b-2` without a reason',
    ]);
  });

  it('splits at the first arrow, so a reason may hold one', () => {
    const reading = parsePromoted(output('a-1 → skipped: moved -> elsewhere'));

    expect(reading.answers).toEqual([{ kind: 'skipped', id: 'a-1', reason: 'moved -> elsewhere', line: FIRST }]);
  });

  it('keeps the first answer for an id and reports the second', () => {
    const reading = parsePromoted(output('a-1 → context/cli.md', 'a-1 → skipped: changed my mind'));

    expect(reading.answers).toEqual([{ kind: 'promoted', id: 'a-1', path: 'context/cli.md', line: FIRST }]);
    expect(reading.unreadable).toEqual([{
      line: FIRST + 1,
      text: 'a-1 → skipped: changed my mind',
      reason: `\`a-1\` was already answered at line ${String(FIRST)}`,
    }]);
  });

  it('answers absent when the output holds no rafa:promoted block', () => {
    const reading = parsePromoted(`Done.\n\n${FENCE}rafa:report\nstatus: done\n${FENCE}\n`);

    expect(reading).toEqual({ status: 'absent', answers: [], unreadable: [] });
  });

  it('answers absent for a block shown inside a longer fence', () => {
    const quoted = ['````markdown', `${FENCE}rafa:promoted`, 'a-1 → context/cli.md', FENCE, '````'].join('\n');

    expect(parsePromoted(quoted).status).toBe('absent');
  });

  it('answers unclosed, reading nothing, for a block never closed', () => {
    const cut = ['Done.', `${FENCE}rafa:promoted`, 'a-1 → context/cli.md', 'b-2 → context/ve'].join('\n');

    expect(parsePromoted(cut)).toEqual({ status: 'unclosed', answers: [], unreadable: [] });
  });

  it('reads the last block when the output holds two', () => {
    const two = [
      `${FENCE}rafa:promoted`,
      'a-1 → skipped: draft',
      FENCE,
      `${FENCE}rafa:promoted`,
      'a-1 → context/cli.md',
      FENCE,
    ].join('\n');

    expect(parsePromoted(two).answers).toEqual([{ kind: 'promoted', id: 'a-1', path: 'context/cli.md', line: 5 }]);
  });

  it('answers read with nothing in it for an empty block', () => {
    expect(parsePromoted(output())).toEqual({ status: 'read', answers: [], unreadable: [] });
  });
});
