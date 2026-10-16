/**
 * Tests for the blocker states (`board/blocker-states.ts`): the state
 * listing, the one view per id a full listing did not hold, and the
 * four answers an id comes to.
 *
 * Every case drives a recorded runner of its own, answering the state
 * listing and each id's view from literal answers and failing every
 * other command, so no case reaches GitHub or spawns `gh`. The argument
 * lists are kept, which is how the cases hold which views were sent.
 *
 * ## The controls
 *
 *  - The short listing and the full listing are run over the same ids,
 *    so "no view sent" on the short one is held against the views the
 *    full one sends.
 *  - The failed listing is run beside the same ids over a listing that
 *    answered, so `problem` is held against null and "no view" against
 *    a view.
 *  - The `unchecked` sentence is held against a run of the same shape
 *    whose every id was answered, where it is null.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { KNOWN_LIST_LIMIT } from './blocked-issues.js';
import { NOT_FOUND, readBlockerStates } from './blocker-states.js';

/** The command line of the state listing, as the runner is handed it. */
const LISTING = `issue list --state all --limit ${String(KNOWN_LIST_LIMIT)} --json number,state`;

/** What a case's runner answers. */
interface FakeBoard {
  /** What the state listing answers. */
  readonly listing: GhResult;
  /** What each id's view answers; an id left out fails with `no route`. */
  readonly views?: Readonly<Record<number, GhResult>>;
}

/** A successful answer writing `stdout`. */
function ok(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A failed answer writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** A view answering `id` as `state`. */
function viewOf(id: number, state: string): GhResult {
  return ok(JSON.stringify({ number: id, state }));
}

/** A view answering `id` the way `gh` answers a number no issue holds. */
function notFound(id: number): GhResult {
  return failed(`GraphQL: ${NOT_FOUND} ${String(id)}. (repository.issue)\n`);
}

/** A state listing of `rows`. */
function listing(rows: readonly { number: number; state: string }[]): GhResult {
  return ok(JSON.stringify(rows));
}

/** A state listing answering its own limit: `KNOWN_LIST_LIMIT` closed issues numbered from `from`. */
function fullListing(from = 1000): GhResult {
  return listing(Array.from({ length: KNOWN_LIST_LIMIT }, (_unused, index) => ({
    number: from + index,
    state: 'CLOSED',
  })));
}

/** A runner over `board`, and the command lines it was handed. */
function fakeGh(board: FakeBoard): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    const line = args.join(' ');
    calls.push(line);
    if (line === LISTING) return Promise.resolve(board.listing);

    const view = /^issue view (\d+) --json number,state$/u.exec(line);
    const answer = view === null
      ? undefined
      : board.views?.[Number(view[1])];
    return Promise.resolve(answer ?? failed(`no route for ${line}`));
  };
  return { run, calls: () => calls };
}

/** The command line of one id's view. */
function viewLine(id: number): string {
  return `issue view ${String(id)} --json number,state`;
}

/** The answers of a reading, as plain pairs in the order the ids were first asked. */
function answers(states: ReadonlyMap<number, string>): readonly (readonly [number, string])[] {
  return [...states.entries()];
}

describe('the state listing', () => {
  it('answers every id off a short listing and sends no view, an id it lacks being dangling', async () => {
    const gh = fakeGh({
      listing: listing([{ number: 24, state: 'CLOSED' }, { number: 26, state: 'OPEN' }]),
      views: { 30: viewOf(30, 'CLOSED') },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 26, 30] });

    expect(answers(reading.states)).toEqual([[24, 'closed'], [26, 'open'], [30, 'dangling']]);
    expect(gh.calls()).toEqual([LISTING]);
    expect([reading.problem, reading.unchecked]).toEqual([null, null]);
  });

  it('sends one view per id a full listing did not hold, and none for an id it held', async () => {
    const gh = fakeGh({
      listing: fullListing(),
      views: { 24: viewOf(24, 'CLOSED'), 26: viewOf(26, 'OPEN'), 30: viewOf(30, 'CLOSED') },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [1000, 24, 26] });

    expect(answers(reading.states)).toEqual([[1000, 'closed'], [24, 'closed'], [26, 'open']]);
    expect(gh.calls()).toEqual([LISTING, viewLine(24), viewLine(26)]);
    expect([reading.problem, reading.unchecked]).toEqual([null, null]);
  });

  it('views an id asked about twice once', async () => {
    const gh = fakeGh({ listing: fullListing(), views: { 24: viewOf(24, 'CLOSED') } });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 24] });

    expect(answers(reading.states)).toEqual([[24, 'closed']]);
    expect(gh.calls()).toEqual([LISTING, viewLine(24)]);
  });

  it('reads a listed state it does not know as unread, sending no view, and folds the case of the two it does', async () => {
    const gh = fakeGh({
      listing: listing([{ number: 24, state: 'DRAFT' }, { number: 26, state: 'closed' }, { number: 28, state: ' open ' }]),
      views: { 24: viewOf(24, 'CLOSED') },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 26, 28] });

    expect(answers(reading.states)).toEqual([[24, 'unread'], [26, 'closed'], [28, 'open']]);
    expect(gh.calls()).toEqual([LISTING]);
  });

  it('sends nothing when no id was asked about', async () => {
    const gh = fakeGh({ listing: fullListing() });

    const reading = await readBlockerStates({ gh: gh.run, ids: [] });

    expect(reading).toEqual({ states: new Map(), problem: null, unchecked: null });
    expect(gh.calls()).toEqual([]);
  });
});

describe('a listing that failed', () => {
  it('carries what gh said as the problem, sends no view, and answers every id unread', async () => {
    const broken = fakeGh({
      listing: failed('gh: API rate limit exceeded'),
      views: { 24: viewOf(24, 'CLOSED') },
    });
    const answered = fakeGh({ listing: fullListing(), views: { 24: viewOf(24, 'CLOSED') } });

    const reading = await readBlockerStates({ gh: broken.run, ids: [24, 26] });
    const control = await readBlockerStates({ gh: answered.run, ids: [24] });

    expect(reading.problem).toBe(`board unblock: gh ${LISTING} failed: gh: API rate limit exceeded`);
    expect(answers(reading.states)).toEqual([[24, 'unread'], [26, 'unread']]);
    expect(reading.unchecked).toBeNull();
    expect(broken.calls()).toEqual([LISTING]);
    expect([control.problem, answered.calls()]).toEqual([null, [LISTING, viewLine(24)]]);
  });

  it('carries a listing that answered something other than a list as the problem', async () => {
    const gh = fakeGh({ listing: ok('{"number":24}') });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24] });

    expect(reading.problem).toBe(`board unblock: gh ${LISTING} answered a mapping, expected a list of issues`);
    expect(gh.calls()).toEqual([LISTING]);
  });
});

describe('the four answers of a view', () => {
  it('answers open, closed, dangling and unread, and names only the unread id in the unchecked sentence', async () => {
    const gh = fakeGh({
      listing: fullListing(),
      views: {
        24: viewOf(24, 'OPEN'),
        26: viewOf(26, 'CLOSED'),
        28: notFound(28),
        30: failed('gh: API rate limit exceeded'),
      },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 26, 28, 30] });

    expect(answers(reading.states)).toEqual([[24, 'open'], [26, 'closed'], [28, 'dangling'], [30, 'unread']]);
    expect(reading.unchecked).toBe('the state of #30 could not be read off the board, so none of them counts as closed');
    expect(reading.problem).toBeNull();
  });

  it('leaves unchecked null when every id was answered, dangling included', async () => {
    const gh = fakeGh({ listing: fullListing(), views: { 24: viewOf(24, 'OPEN'), 28: notFound(28) } });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 28] });

    expect(answers(reading.states)).toEqual([[24, 'open'], [28, 'dangling']]);
    expect(reading.unchecked).toBeNull();
  });

  it('answers unread for a state that is neither word, output that is not JSON, and another issue\'s answer', async () => {
    const gh = fakeGh({
      listing: fullListing(),
      views: { 24: viewOf(24, 'MERGED'), 26: ok('not json'), 28: viewOf(29, 'CLOSED') },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [24, 26, 28] });

    expect(answers(reading.states)).toEqual([[24, 'unread'], [26, 'unread'], [28, 'unread']]);
    expect(reading.unchecked).toBe('the state of #24 #26 #28 could not be read off the board,'
      + ' so none of them counts as closed');
  });

  it('reads a failure carrying only part of the not-found phrase as unread, not dangling', async () => {
    const gh = fakeGh({
      listing: fullListing(),
      views: { 28: failed('GraphQL: Could not resolve to a Repository with the name owner/repo.') },
    });

    const reading = await readBlockerStates({ gh: gh.run, ids: [28] });

    expect(answers(reading.states)).toEqual([[28, 'unread']]);
  });
});
