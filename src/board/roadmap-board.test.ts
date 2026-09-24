/**
 * Tests for the one board listing (`src/board/roadmap-board.ts`): the
 * command it sends, the rows it checks field by field, and the type and
 * module it reads off each row's labels.
 *
 * Every case plants the answer its runner gives; none spawns `gh` or
 * reaches GitHub. Each refusal case sits beside a control proving the
 * same row reads when the one field under test is well formed, so a
 * parser that refused everything would fail the control rather than
 * pass the refusal.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { ISSUE_TYPES } from '../adapters/tracker/issue-values.js';

import {
  BOARD_LIST_FIELDS,
  BOARD_LISTING_LIMIT,
  boardListingCommand,
  createGhBoardListing,
  parseBoardListing,
} from './roadmap-board.js';

/** A runner answering `result` to every command, recording each. */
function stubGh(result: GhResult): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

/** A runner answering `rows` as `gh issue list` output. */
function planted(rows: unknown): ReturnType<typeof stubGh> {
  return stubGh({ ok: true, stdout: JSON.stringify(rows), stderr: '' });
}

/** A well-formed row, with `overrides` laid over it. */
function row(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'the board listing',
    body: '## Why\n\nbody',
    state: 'OPEN',
    labels: [{ name: 'type:code' }, { name: 'module:board' }],
    ...overrides,
  };
}

/** The command every default-limit refusal names. */
const COMMAND = `gh issue list --state all --limit ${BOARD_LISTING_LIMIT} --json number,title,body,state,labels`;

describe('the command', () => {
  it('sends one gh issue list over every state with the five fields and the default limit', async () => {
    const gh = planted([]);
    await createGhBoardListing({ gh: gh.run })();
    expect(gh.calls()).toEqual([
      ['issue', 'list', '--state', 'all', '--limit', String(BOARD_LISTING_LIMIT), '--json', BOARD_LIST_FIELDS],
    ]);
    expect(boardListingCommand(BOARD_LISTING_LIMIT)).toBe(COMMAND);
  });

  it('sends the limit it was made with', async () => {
    const gh = planted([]);
    await createGhBoardListing({ gh: gh.run, limit: 5 })();
    expect(gh.calls()[0]).toContain('5');
    expect(gh.calls()[0]?.[5]).toBe('5');
  });

  it('refuses a limit that is not a positive whole number and sends nothing', () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      const gh = planted([]);
      expect(() => createGhBoardListing({ gh: gh.run, limit })).toThrow(TypeError);
      expect(gh.calls()).toEqual([]);
    }
  });

  it('rejects naming the command when gh fails', async () => {
    const gh = stubGh({ ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' });
    const listing = createGhBoardListing({ gh: gh.run });
    await expect(listing()).rejects.toThrow(`board listing: ${COMMAND} failed: HTTP 401: Bad credentials`);
  });

  it('rejects naming the command when gh fails and writes nothing', async () => {
    const gh = stubGh({ ok: false, stdout: '', stderr: '' });
    await expect(createGhBoardListing({ gh: gh.run })()).rejects.toThrow(`${COMMAND} failed and wrote nothing`);
  });
});

describe('the rows', () => {
  it('reads an empty board as no issues, not a refusal', async () => {
    const gh = planted([]);
    const issues = await createGhBoardListing({ gh: gh.run })();
    expect(issues).toEqual([]);
    expect(gh.calls()).toHaveLength(1);
  });

  it('reads every field of every row, open and closed, in the order gh answered them', async () => {
    const gh = planted([
      row(),
      row({ number: 3, title: 'closed one', body: '', state: 'CLOSED', labels: [] }),
    ]);
    const issues = await createGhBoardListing({ gh: gh.run })();
    expect(issues).toEqual([
      {
        number: 7,
        title: 'the board listing',
        body: '## Why\n\nbody',
        state: 'OPEN',
        labels: ['type:code', 'module:board'],
        type: 'code',
        module: 'board',
      },
      { number: 3, title: 'closed one', body: '', state: 'CLOSED', labels: [], type: 'code', module: 'unassigned' },
    ]);
    expect(Object.isFrozen(issues)).toBe(true);
    expect(Object.isFrozen(issues[0])).toBe(true);
  });

  it('refuses output that is not JSON, naming the command', () => {
    expect(() => parseBoardListing('not json', COMMAND)).toThrow(`board listing: ${COMMAND} wrote output that is not JSON`);
  });

  it('refuses JSON that is not a list, naming the command', () => {
    expect(() => parseBoardListing('{}', COMMAND)).toThrow(`board listing: ${COMMAND} answered a mapping, expected a list`);
  });

  it('refuses a malformed row, naming the command and the row, beside a control that reads', () => {
    expect(parseBoardListing(JSON.stringify([row(), row({ number: 8 })]), COMMAND)).toHaveLength(2);

    const cases: readonly (readonly [unknown, string])[] = [
      ['a string', '"a string", expected a mapping'],
      [row({ number: '8' }), 'number "8", expected a positive whole number'],
      [row({ number: 0 }), 'number 0, expected a positive whole number'],
      [row({ title: 3 }), 'title 3, expected a string'],
      [row({ body: null }), 'body null, expected a string'],
      [row({ state: 'open' }), 'state "open", expected "OPEN" or "CLOSED"'],
      [row({ labels: 'type:bug' }), 'labels "type:bug", expected a list of named labels'],
      [row({ labels: [{ name: 'ok' }, { color: 'red' }] }), 'labels[1] a mapping, expected a mapping with a string name'],
    ];
    for (const [bad, problem] of cases) {
      expect(() => parseBoardListing(JSON.stringify([row(), bad]), COMMAND))
        .toThrow(`board listing: ${COMMAND} answered row 1 with ${problem}`);
    }
  });

  it('refuses a row missing a field, naming the field as undefined', async () => {
    for (const field of ['number', 'title', 'body', 'state', 'labels']) {
      const missing = Object.fromEntries(Object.entries(row()).filter(([key]) => key !== field));
      const gh = planted([missing]);
      await expect(createGhBoardListing({ gh: gh.run })())
        .rejects.toThrow(`board listing: ${COMMAND} answered row 0 with ${field} undefined`);
    }
  });
});

describe('the type and module labels', () => {
  it.each([...ISSUE_TYPES])('reads type:%s as that type', (type) => {
    const [issue] = parseBoardListing(JSON.stringify([row({ labels: [{ name: `type:${type}` }] })]), COMMAND);
    expect(issue?.type).toBe(type);
  });

  it('reads a missing or foreign type label as code', () => {
    const issues = parseBoardListing(JSON.stringify([
      row({ labels: [] }),
      row({ labels: [{ name: 'type:epic' }] }),
    ]), COMMAND);
    expect(issues.map((issue) => issue.type)).toEqual(['code', 'code']);
  });

  it('reads the first type label when several are carried', () => {
    const [issue] = parseBoardListing(JSON.stringify([
      row({ labels: [{ name: 'type:bug' }, { name: 'type:spike' }] }),
    ]), COMMAND);
    expect(issue?.type).toBe('bug');
  });

  it('reads the module label, and unassigned when there is none', () => {
    const issues = parseBoardListing(JSON.stringify([
      row({ labels: [{ name: 'spec:ready' }, { name: 'module:pr' }] }),
      row({ labels: [{ name: 'spec:ready' }] }),
    ]), COMMAND);
    expect(issues.map((issue) => issue.module)).toEqual(['pr', 'unassigned']);
  });
});
