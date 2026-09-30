/**
 * Tests for the `Blocked by:` line edits (`./labels-blocked-edit.ts`).
 *
 * Every case is a literal body. Each edit is read back through
 * `readBlockedBy`, the reader the edit must agree with, so a body the
 * edit wrote that the reader would read differently fails here.
 */
import { describe, expect, it } from 'bun:test';

import { readBlockedBy } from '../blocked.js';

import { addBlockerToBody, blockerToken, removeBlockerFromBody } from './labels-blocked-edit.js';

const LOCAL_24 = { number: 24, repository: null } as const;
const LOCAL_26 = { number: 26, repository: null } as const;
const FOREIGN_12 = { number: 12, repository: 'open-tomato/agentic-research' } as const;

describe('blockerToken', () => {
  it('names a local blocker #n and a foreign one owner/repo#n', () => {
    expect(blockerToken(LOCAL_24)).toBe('#24');
    expect(blockerToken(FOREIGN_12)).toBe('open-tomato/agentic-research#12');
  });
});

describe('addBlockerToBody', () => {
  it('writes the whole body as the line when the body is empty', () => {
    expect(addBlockerToBody(10, '', LOCAL_24)).toBe('Blocked by: #24\n');
  });

  it('adds the line after a blank line below the text, in the body\'s own line break', () => {
    expect(addBlockerToBody(10, '## Spec\n\nBuild it.\n\n', LOCAL_24)).toBe('## Spec\n\nBuild it.\n\nBlocked by: #24\n');
    expect(addBlockerToBody(10, 'Build it.\r\n', LOCAL_24)).toBe('Build it.\r\n\r\nBlocked by: #24\r\n');
  });

  it('appends to the line the reader finds, keeping its dressing and every other line', () => {
    const body = 'Intro.\n- **Blocked by:** #24\nOutro.\n';

    const edited = addBlockerToBody(10, body, LOCAL_26);

    expect(edited).toBe('Intro.\n- **Blocked by:** #24 #26\nOutro.\n');
    expect(readBlockedBy(10, edited).blockers).toEqual([24, 26]);
  });

  it('keeps a line\'s carriage return when it appends', () => {
    expect(addBlockerToBody(10, 'Blocked by: #24\r\nOutro.\r\n', LOCAL_26)).toBe('Blocked by: #24 #26\r\nOutro.\r\n');
  });

  it('leaves a line quoted in a fence alone and adds the field below', () => {
    const body = '```\nBlocked by: #1\n```\n';

    const edited = addBlockerToBody(10, body, LOCAL_24);

    expect(edited).toBe('```\nBlocked by: #1\n```\n\nBlocked by: #24\n');
    expect(readBlockedBy(10, edited).blockers).toEqual([24]);
  });

  it('answers the body unchanged for a blocker named already, a foreign one compared without case', () => {
    const body = 'Blocked by: #24 Open-Tomato/Agentic-Research#12\n';

    expect(addBlockerToBody(10, body, LOCAL_24)).toBe(body);
    expect(addBlockerToBody(10, body, FOREIGN_12)).toBe(body);
  });

  it('appends a foreign token the reader keeps as foreign, not as a local id', () => {
    const edited = addBlockerToBody(10, 'Blocked by: #24\n', FOREIGN_12);

    expect(readBlockedBy(10, edited)).toMatchObject({ blockers: [24], foreign: ['open-tomato/agentic-research#12'] });
  });

  it('appends to a line that names no id, turning the fault into a reading', () => {
    const edited = addBlockerToBody(10, 'Blocked by: the API work\n', LOCAL_24);

    expect(edited).toBe('Blocked by: the API work #24\n');
    expect(readBlockedBy(10, edited).kind).toBe('blocked');
  });
});

describe('removeBlockerFromBody', () => {
  it('writes the line again with what it still names, keeping its dressing', () => {
    const removal = removeBlockerFromBody(10, 'Intro.\n- **Blocked by:** #24, #26 and acme/x#3\nOutro.\n', LOCAL_24);

    expect(removal).toEqual({ body: 'Intro.\n- **Blocked by:** #26 acme/x#3\nOutro.\n', emptied: false });
  });

  it('takes a foreign token off by its repository, whatever its case, and leaves the local id of the same number', () => {
    const removal = removeBlockerFromBody(10, 'Blocked by: #12 Open-Tomato/Agentic-Research#12\n', FOREIGN_12);

    expect(removal).toEqual({ body: 'Blocked by: #12\n', emptied: false });
  });

  it('removes the line whole when it named nothing else', () => {
    expect(removeBlockerFromBody(10, 'Intro.\nBlocked by: #24\nOutro.\n', LOCAL_24))
      .toEqual({ body: 'Intro.\nOutro.\n', emptied: true });
    expect(removeBlockerFromBody(10, 'Blocked by: #24\n', LOCAL_24)).toEqual({ body: '', emptied: true });
  });

  it('keeps a line\'s carriage return when it rewrites it', () => {
    expect(removeBlockerFromBody(10, 'Blocked by: #24 #26\r\n', LOCAL_24).body).toBe('Blocked by: #26\r\n');
  });

  it('answers the body unchanged for a blocker the line does not name, and for a body with no line', () => {
    const body = 'Blocked by: #26\n';

    expect(removeBlockerFromBody(10, body, LOCAL_24)).toEqual({ body, emptied: false });
    expect(removeBlockerFromBody(10, 'Nothing here.\n', LOCAL_24)).toEqual({ body: 'Nothing here.\n', emptied: false });
  });
});
