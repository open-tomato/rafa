/**
 * Tests for the triage-comment reader (`last-triage.ts`): which comment
 * is the last triage, what its `rafa:triage` block reads as, and what a
 * block that cannot be read answers.
 *
 * Everything here is pure — a list of comments in, a reading out — so
 * every case is a direct call and none of them touches a provider, a
 * process or GitHub.
 *
 * Two readings carry their own control, because each could pass while
 * wrong:
 *
 *   - The unquoted-scalar case asserts that `head: 0e12345` is refused
 *     AND that the quoted spelling of the same sha reads, so the refusal
 *     is known to be about the quoting and not about the reader
 *     rejecting every head.
 *   - The illustration case asserts that a comment QUOTING the block
 *     format inside a longer fence contributes no reading, beside a case
 *     where the same body's real block does, so "the plan fence reader
 *     is used" is measured rather than assumed.
 */
import type { PullRequestComment } from '../../pr/index.js';

import { describe, expect, it } from 'bun:test';

import { readLastTriage, TRIAGE_MARKER } from './last-triage.js';

/** The fence a triage block opens with, spelled in parts so this file carries no block of its own. */
const FENCE = '```';

/** The body of a triage comment carrying `block` as its `rafa:triage` block. */
function triageBody(block: string, heading = '**rafa triage**: `conflict-lockfile`, simple'): string {
  return [TRIAGE_MARKER, heading, `${FENCE}rafa:triage`, block, FENCE, ''].join('\n');
}

/** The block a clean triage comment carries, every field written as the spec spells it. */
const FULL_BLOCK = [
  'head: "0badc0ffee1234567890"',
  'at: "2026-09-18T12:00:00Z"',
  'class: "conflict-lockfile"',
  'simple: true',
  'attempts: 1',
  'files: ["bun.lock"]',
].join('\n');

/** A comment as the provider answers one, filled from `over`. */
function comment(over: Partial<PullRequestComment> = {}): PullRequestComment {
  return {
    id: '5000000001',
    author: { login: 'rafa-bot', isBot: false },
    body: 'nothing to do with a triage',
    updatedAt: '2026-09-18T12:00:00Z',
    url: 'https://github.com/open-tomato/rafa/pull/41#issuecomment-5000000001',
    ...over,
  };
}

/** The reading of one comment carrying `block` as its triage block. */
function readBlock(block: string): ReturnType<typeof readLastTriage> {
  return readLastTriage([comment({ body: triageBody(block) })]);
}

describe('which comment is read', () => {
  it('answers null when no comment carries the marker, one naming a triage included', () => {
    const comments = [
      comment({ body: 'I ran rafa pr triage on this and it said conflict-lockfile' }),
      comment({ body: 'still red' }),
    ];

    expect(readLastTriage(comments)).toBeNull();
  });

  it('answers null for a pull request with no comments at all', () => {
    expect(readLastTriage([])).toBeNull();
  });

  it('takes the last marker comment, with later ordinary comments after it', () => {
    const comments = [
      comment({ id: '1', body: triageBody('class: "ci-test"') }),
      comment({ id: '2', body: triageBody('class: "conflict-lockfile"') }),
      comment({ id: '3', body: 'thanks' }),
    ];

    const last = readLastTriage(comments);

    expect([last?.id, last?.block?.class]).toEqual(['2', 'conflict-lockfile']);
  });

  it('carries the comment itself: its id, author, URL and when it last moved', () => {
    const last = readLastTriage([comment({ body: triageBody(FULL_BLOCK) })]);

    expect(last).toMatchObject({
      id: '5000000001',
      author: 'rafa-bot',
      url: 'https://github.com/open-tomato/rafa/pull/41#issuecomment-5000000001',
      updatedAt: '2026-09-18T12:00:00Z',
      problems: [],
    });
  });
});

describe('the block', () => {
  it('reads every field the spec writes', () => {
    expect(readBlock(FULL_BLOCK)?.block).toEqual({
      head: '0badc0ffee1234567890',
      at: '2026-09-18T12:00:00Z',
      class: 'conflict-lockfile',
      simple: true,
      attempts: 1,
      files: ['bun.lock'],
    });
  });

  it('leaves a field the block does not write null, with nothing to say about it', () => {
    const last = readBlock('class: "pending"');

    expect(last?.block).toEqual({ head: null, at: null, class: 'pending', simple: null, attempts: null, files: null });
    expect(last?.problems).toEqual([]);
  });

  it('reports a block with no field in it, which parses as null rather than as a mapping', () => {
    const last = readBlock('');

    expect(last?.block).toBeNull();
    expect(last?.problems).toEqual(['its rafa:triage block holds null, not a mapping of fields']);
  });
});

describe('a head written unquoted', () => {
  it('is refused with the spelling that works, where the same sha quoted reads', () => {
    const refused = readBlock('head: 0e12345');
    const control = readBlock('head: "0e12345"');

    expect(refused?.block?.head).toBeNull();
    expect(refused?.problems).toEqual(['head is 0, not text; write it quoted, as head: "..."']);
    expect(control?.block?.head).toBe('0e12345');
    expect(control?.problems).toEqual([]);
  });

  it('is refused the same way for a sha of digits alone, which reads as an integer', () => {
    expect(readBlock('head: 1234567')?.problems).toEqual(['head is 1234567, not text; write it quoted, as head: "..."']);
  });
});

describe('a field of the wrong type', () => {
  it('refuses a simple that is not true or false', () => {
    const last = readBlock('simple: "yes"');

    expect(last?.block?.simple).toBeNull();
    expect(last?.problems).toEqual(['simple is "yes", not true or false']);
  });

  it('refuses an attempts that is negative or fractional', () => {
    expect(readBlock('attempts: -1')?.problems).toEqual(['attempts is -1, not a whole number from 0']);
    expect(readBlock('attempts: 1.5')?.problems).toEqual(['attempts is 1.5, not a whole number from 0']);
  });

  it('refuses a files that is one path rather than a list, and a list holding anything but paths', () => {
    expect(readBlock('files: "bun.lock"')?.problems).toEqual(['files is "bun.lock", not a list of quoted paths']);
    expect(readBlock('files: ["bun.lock", 7]')?.problems).toEqual(['files is a list, not a list of quoted paths']);
  });

  it('refuses a class written blank, and names every unusable field at once', () => {
    const last = readBlock(['class: ""', 'simple: 1'].join('\n'));

    expect(last?.problems).toEqual([
      'class is "", not text with something in it',
      'simple is 1, not true or false',
    ]);
  });
});

describe('a comment the block cannot be read out of', () => {
  it('reports a marker comment carrying no block at all, and still answers the comment', () => {
    const last = readLastTriage([comment({ body: `${TRIAGE_MARKER}\n**rafa triage**: it went badly\n` })]);

    expect(last?.block).toBeNull();
    expect(last?.problems).toEqual([`it carries the ${TRIAGE_MARKER} marker and no rafa:triage block`]);
    expect(last?.id).toBe('5000000001');
  });

  it('reports a block the comment was cut off inside', () => {
    const cut = [TRIAGE_MARKER, `${FENCE}rafa:triage`, 'class: "ci-test"'].join('\n');

    expect(readLastTriage([comment({ body: cut })])?.problems).toEqual(['its rafa:triage block was never closed']);
  });

  it('reports a block that is not valid YAML, quoting what the parser said', () => {
    const problems = readBlock('class: "ci-test\nfiles: [')?.problems ?? [];

    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith('its rafa:triage block is not valid YAML (');
  });

  it('reports a block holding a list rather than a mapping of fields', () => {
    expect(readBlock('- conflict-lockfile')?.problems).toEqual([
      'its rafa:triage block holds a list, not a mapping of fields',
    ]);
  });
});

describe('a comment quoting the format', () => {
  it('reads no block out of an illustration fenced longer than the block it shows', () => {
    const quoted = [
      TRIAGE_MARKER,
      'This is what a triage comment looks like:',
      `${FENCE}${FENCE}markdown`,
      `${FENCE}rafa:triage`,
      'class: "conflict-lockfile"',
      FENCE,
      `${FENCE}${FENCE}`,
      '',
    ].join('\n');

    const last = readLastTriage([comment({ body: quoted })]);

    expect(last?.block).toBeNull();
    expect(last?.problems).toEqual([`it carries the ${TRIAGE_MARKER} marker and no rafa:triage block`]);
  });

  it('reads the real block of a comment that also quotes one, which is the control for that', () => {
    const both = [
      TRIAGE_MARKER,
      `${FENCE}${FENCE}markdown`,
      `${FENCE}rafa:triage`,
      'class: "quoted"',
      FENCE,
      `${FENCE}${FENCE}`,
      `${FENCE}rafa:triage`,
      'class: "conflict-lockfile"',
      FENCE,
      '',
    ].join('\n');

    expect(readLastTriage([comment({ body: both })])?.block?.class).toBe('conflict-lockfile');
  });
});
