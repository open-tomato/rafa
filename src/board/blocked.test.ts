/**
 * Tests for the blocked-issue reading (`src/board/blocked.ts`): the
 * label, the ids a `Blocked by:` line names, and the four readings the
 * module refuses to guess at.
 *
 * Every case is a pure call over a literal body. Nothing here spawns
 * `gh`, opens a file or asks an issue's state, because the module does
 * none of those: whether a blocker is CLOSED is the board's answer and
 * is read by `rafa issue unblock`, not here.
 *
 * ## The controls
 *
 * Two readings could pass while wrong and so are each paired with a
 * control:
 *
 *  - The fence case plants the same `Blocked by: #24` line inside a
 *    fenced block and outside it in one body, and holds that the
 *    reading is the unfenced one. A reader that ignored fences would
 *    answer `blocked` for both, so the fenced-only body is the control
 *    that must read `no-line`.
 *  - The unknown case runs one body twice, once with a `known` set and
 *    once without, and holds `unknown-issue` against `blocked`. Without
 *    the pair, a reader that called every id unknown would look correct
 *    on the first half alone.
 *  - The foreign cases plant `owner/repo#<n>` tokens whose number is
 *    also a local id or the issue's own. The bare-`#n` control reads the
 *    same ids with no foreign token and holds the whole reading equal to
 *    what it was before foreign tokens were read, so a reader that
 *    dropped every id on a line holding a `/` fails there.
 */
import { describe, expect, it } from 'bun:test';

import {
  BLOCKED_BY_FIELD,
  blockedFaultMessage,
  hasSpecBlockedLabel,
  readBlockedBy,
  SPEC_BLOCKED_LABEL,
} from './blocked.js';

/** A body holding `lines`, each on its own line. */
function body(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The ordinary blocked spec: a title, some prose, the field, a section. */
const BLOCKED_BODY = body(
  '## What you get',
  '',
  'The state reader, once the board can answer it.',
  '',
  'Blocked by: #24 #26',
  '',
  '## Design',
);

describe('the spec:blocked label', () => {
  it('is the name the board and the doctor rows spell', () => {
    expect(SPEC_BLOCKED_LABEL).toBe('spec:blocked');
  });

  it('is found in a label list whatever its case and spacing', () => {
    expect(hasSpecBlockedLabel(['type:spec', ' Spec:Blocked '])).toBe(true);
  });

  it('is not found in a list that carries only the readiness labels', () => {
    expect(hasSpecBlockedLabel(['type:spec', 'spec:ready', 'spec:needs-work'])).toBe(false);
  });
});

describe('the ids a Blocked by line names', () => {
  it('are read off the line in body order, with the line it sits on', () => {
    const read = readBlockedBy(57, BLOCKED_BODY);

    expect(read.kind).toBe('blocked');
    expect(read.blockers).toEqual([24, 26]);
    expect(read.unknown).toEqual([]);
    expect(read.line).toBe(5);
    expect(read.text).toBe('#24 #26');
  });

  it('survive the punctuation and dress a person writes the field in', () => {
    const read = readBlockedBy(57, body('- **Blocked by:** #24, #26 and #3'));

    expect(read.kind).toBe('blocked');
    expect(read.blockers).toEqual([24, 26, 3]);
  });

  it('are read case-insensitively, since an author may not match the template', () => {
    expect(readBlockedBy(57, body('blocked BY: #24')).blockers).toEqual([24]);
  });

  it('are read once each, in the order the line first names them', () => {
    expect(readBlockedBy(57, body('Blocked by: #24 #26 #24')).blockers).toEqual([24, 26]);
  });

  it('leave out a bare number, which names no issue', () => {
    const read = readBlockedBy(57, body('Blocked by: #24 and the 2 specs under it'));

    expect(read.kind).toBe('blocked');
    expect(read.blockers).toEqual([24]);
  });

  it('come from the first field line, leaving a second one alone', () => {
    const read = readBlockedBy(57, body('Blocked by: #24', '', 'Blocked by: #26'));

    expect(read.blockers).toEqual([24]);
    expect(read.line).toBe(1);
  });
});

describe('a Blocked by line inside a fence', () => {
  it('is not the field, so a spec quoting the line reads as unblocked', () => {
    const quoted = body(
      'The field is one line in the body:',
      '',
      '```text',
      'Blocked by: #24',
      '```',
    );

    expect(readBlockedBy(57, quoted).kind).toBe('no-line');
  });

  it('is passed over for the real line further down', () => {
    const both = body(
      '```text',
      'Blocked by: #24',
      '```',
      '',
      'Blocked by: #26',
    );
    const read = readBlockedBy(57, both);

    expect(read.kind).toBe('blocked');
    expect(read.blockers).toEqual([26]);
    expect(read.line).toBe(5);
  });
});

describe('the readings it refuses to guess at', () => {
  it('reports a body with no field line, naming the label that asked for one', () => {
    const read = readBlockedBy(57, body('## What you get', '', 'Nothing about waiting.'));

    expect(read.kind).toBe('no-line');
    expect(read.line).toBe(null);
    expect(read.text).toBe(null);
    expect(read.blockers).toEqual([]);
    expect(blockedFaultMessage(read)).toBe(
      '#57 is labelled spec:blocked and its body carries no "Blocked by:" line; '
      + 'name them as "Blocked by: #24 #26", or take the spec:blocked label off',
    );
  });

  it('reports a line that parses to nothing, quoting what it said', () => {
    const read = readBlockedBy(57, body('Blocked by: the API work'));

    expect(read.kind).toBe('no-ids');
    expect(read.line).toBe(1);
    expect(read.blockers).toEqual([]);
    expect(blockedFaultMessage(read)).toContain(
      'has a "Blocked by:" line on line 1 naming no issue: "the API work"',
    );
  });

  it('reports a line naming the issue it sits in, and names no blocker to act on', () => {
    const read = readBlockedBy(57, body('Blocked by: #24 #57'));

    expect(read.kind).toBe('self-reference');
    expect(read.blockers).toEqual([24, 57]);
    expect(blockedFaultMessage(read)).toContain('line on line 1 naming itself');
  });

  it('reports a self-reference ahead of an unknown id on the same line', () => {
    const read = readBlockedBy(57, body('Blocked by: #57 #999'), new Set([24, 26, 57]));

    expect(read.kind).toBe('self-reference');
    expect(read.unknown).toEqual([999]);
  });

  it('reports an id the board has no issue for, against the same body read without a board', () => {
    const named = body('Blocked by: #24 #999');
    const read = readBlockedBy(57, named, new Set([24, 26, 57]));
    const unasked = readBlockedBy(57, named);

    expect(read.kind).toBe('unknown-issue');
    expect(read.unknown).toEqual([999]);
    expect(blockedFaultMessage(read)).toContain(
      'line on line 1 naming #999, which the board has no issue for',
    );
    expect(unasked.kind).toBe('blocked');
    expect(unasked.unknown).toEqual([]);
  });

  it('lets a line through whose every id the board holds', () => {
    const read = readBlockedBy(57, BLOCKED_BODY, new Set([24, 26, 57]));

    expect(read.kind).toBe('blocked');
    expect(read.unknown).toEqual([]);
  });
});

describe('the fault sentence', () => {
  it('names the field the way the module exports it', () => {
    expect(BLOCKED_BY_FIELD).toBe('Blocked by');
    expect(blockedFaultMessage(readBlockedBy(57, body('Blocked by: none'))))
      .toContain(`"${BLOCKED_BY_FIELD}:"`);
  });

  it('throws for a reading that carries no fault, since there is nothing to report', () => {
    const read = readBlockedBy(57, BLOCKED_BODY);

    expect(() => blockedFaultMessage(read)).toThrow(/#57 names #24 #26 and has no fault to report/u);
  });
});

describe('a blocker on another repository', () => {
  it('is kept as written and not read as a local id when it stands alone', () => {
    const read = readBlockedBy(57, body('Blocked by: open-tomato/agentic-research#57'));

    expect(read.kind).toBe('no-ids');
    expect(read.blockers).toEqual([]);
    expect(read.foreign).toEqual(['open-tomato/agentic-research#57']);
    expect(read.unknown).toEqual([]);
    expect(blockedFaultMessage(read)).toBe(
      '#57 has a "Blocked by:" line on line 1 naming only issues on other repositories: '
      + 'open-tomato/agentic-research#57; '
      + 'name them as "Blocked by: #24 #26", or take the spec:blocked label off',
    );
  });

  it('sits beside local ids without adding its number to them or to the unknown', () => {
    const line = 'Blocked by: #24, Some-Org/my_repo.js#26 and #3 some-org/my_repo.js#26';
    const read = readBlockedBy(57, body(line), new Set([3, 24, 57]));

    expect(read.kind).toBe('blocked');
    expect(read.blockers).toEqual([24, 3]);
    expect(read.foreign).toEqual(['Some-Org/my_repo.js#26', 'some-org/my_repo.js#26']);
    expect(read.unknown).toEqual([]);
  });

  it('is read once when the line repeats it', () => {
    const read = readBlockedBy(57, body('Blocked by: #24 acme/api#9 acme/api#9'));

    expect(read.foreign).toEqual(['acme/api#9']);
  });

  it('is absent from a bare #n line, which reads exactly as before', () => {
    const read = readBlockedBy(57, body('Blocked by: #24, #26 and #24'), new Set([24, 26, 57]));

    expect(read).toEqual({
      kind: 'blocked',
      issue: 57,
      line: 1,
      text: '#24, #26 and #24',
      blockers: [24, 26],
      foreign: [],
      unknown: [],
    });
    expect(readBlockedBy(57, body('Blocked by: #57')).kind).toBe('self-reference');
    expect(blockedFaultMessage(readBlockedBy(57, body('Blocked by: the API work')))).toContain(
      'naming no issue: "the API work"',
    );
  });
});
