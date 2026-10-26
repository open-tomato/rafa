import type { BugRecord } from '@open-tomato/rafa/bugs/record';

import { describe, expect, it } from 'bun:test';

import { BUG_FIELDS, bugTitle, EMPTY_BUG_RECORD, parseBugRecord, renderBugBody } from '@open-tomato/rafa/bugs/record';
import { DEFAULT_BUG_TITLE } from '@open-tomato/rafa/bugs/title';
import { RAFA_CODES } from '@open-tomato/rafa/errors/rafa-codes';
import { causeOf } from '@open-tomato/rafa-board/bugs/cause-rule';

import { boundaryValueOf, summaryOf } from '../../../bugs/filed-values.js';

/** The summary cap the composition cuts to. */
const SUMMARY_MAX = 40;

/** What a session reports for a bug; every key may be absent. */
interface Entry {
  readonly what: string;
  readonly cause?: string | null;
  readonly module?: string | null;
  readonly action?: string | null;
}

/** A code rafa ships in the `git` family. */
const GIT_CODE = RAFA_CODES.find((entry) => entry.code.startsWith('git:'))!.code;

/** Composes the four rules into one record the way a filer does. */
function composed(entry: Entry): BugRecord {
  const cause = causeOf(entry.cause ?? null, RAFA_CODES);
  const module = boundaryValueOf('module', entry.module ?? null, []);
  const action = boundaryValueOf('action', entry.action ?? null, []);
  const summary = summaryOf(entry.what, SUMMARY_MAX, DEFAULT_BUG_TITLE, { type: 'bug', module: module.value, action: action.value });
  return {
    ...EMPTY_BUG_RECORD,
    summary,
    what: entry.what,
    cause: cause.cause,
    proposed: cause.proposed,
    suspected: cause.suspected,
    module: module.value,
    action: action.value,
  };
}

/** The headings of a body, in the order it writes them. */
function headingsOf(body: string): string[] {
  return [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
}

describe('a record composed from the rules', () => {
  it('files a four-key entry with its title, values and sections in field order', () => {
    // Arrange: a listed family, an unlisted leaf, and a module and action in need of cleaning
    const unlisted = `${GIT_CODE.slice(0, GIT_CODE.indexOf(':'))}:no-such-leaf-here`;
    const record = {
      ...composed({ what: 'resume: cannot find the worktree branch after a stop', cause: unlisted, module: ' Loop ', action: 'Start' }),
      reproduce: 'rafa loop start --continue',
    };

    // Act
    const body = renderBugBody(record);

    // Assert
    expect(record.cause).toBe(`${GIT_CODE.slice(0, GIT_CODE.indexOf(':'))}:new-context`);
    expect(record.proposed).toBe(unlisted);
    expect(record.module).toBe('loop');
    expect(record.action).toBe('start');
    expect(bugTitle(record, { template: DEFAULT_BUG_TITLE })).toBe('loop - start: resume: cannot find the worktree bran...');
    const written = BUG_FIELDS.filter((field) => field.shape !== 'unwritten' && record[field.key] !== null).map((field) => field.heading);
    expect(written).toEqual(['What', 'Reproduce', 'Cause', 'Proposed cause', 'Module', 'Action']);
    expect(headingsOf(body)).toEqual(written);
    expect(parseBugRecord(body)).toMatchObject({ what: record.what, cause: record.cause, proposed: unlisted, module: 'loop', action: 'start' });
  });

  it('files a keyless entry as unknown with every section it holds', () => {
    // Arrange
    const record = composed({ what: 'something broke' });

    // Act
    const body = renderBugBody(record);

    // Assert
    expect(record.cause).toBe('unknown:new-context');
    expect(record.proposed).toBeNull();
    expect(record.suspected).toBeNull();
    expect(record.module).toBe('unknown');
    expect(record.action).toBe('unknown');
    expect(bugTitle(record, { template: DEFAULT_BUG_TITLE })).toBe('something broke');
    expect(headingsOf(body)).toEqual(['What', 'Cause', 'Module', 'Action']);
  });

  it('keeps the session\'s own words beside an unusable cause, module and action', () => {
    // Arrange
    const record = composed({ what: 'x', cause: 'the disk was full', module: 'Not A Module!', action: 'ok' });

    // Act
    const headings = headingsOf(renderBugBody(record));

    // Assert
    expect(record.cause).toBe('unknown:new-context');
    expect(record.suspected).toBe('the disk was full');
    expect(record.module).toBe('unknown');
    expect(headings).toEqual(['What', 'Cause', 'Suspected cause', 'Module', 'Action']);
  });
});
