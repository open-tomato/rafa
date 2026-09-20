/**
 * Tests for the pull request double (`src/pr/pull-requests-double.ts`).
 *
 * The double has one job a case relies on and cannot see: a member the
 * case did not name must REFUSE rather than answer something invented.
 * A double that quietly answered `undefined` would leave every case
 * built on it green while the command under test read a provider nobody
 * had planned, so the refusal is held here member by member, over every
 * function-valued member the double carries and not over a list this
 * file writes out — a list would go stale exactly when the port grows.
 *
 * Every refusal reading is paired with the same call against a double
 * that DOES name the member, which is what proves a refusal could have
 * come out as an answer. The recorded log is read the same way: the
 * answered call recorded `refused: false` is the control on the refused
 * one recording `true`.
 *
 * Nothing here reaches `gh`, git or a network. The double answers
 * whatever a case hands it, so the fixtures below are the smallest
 * values the port's types allow rather than realistic pull requests;
 * what a REAL provider answers is `gh-fake.test.ts` and `gh.test.ts`.
 */
import type { PullRequestsAnswers } from './pull-requests-double.js';
import type { PullRequests } from './types.js';

import { describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from './pull-requests-double.js';

/** A member of the double, as this file calls one without naming its signature. */
type Sendable = (...args: readonly unknown[]) => Promise<unknown>;

/** Every function-valued member the double carries, read off the double itself. */
function membersOf(pulls: PullRequests): readonly string[] {
  return Object.keys(pulls).filter((key) => key !== 'kind');
}

/** Sends `member` to `pulls` with `args`, whatever its declared signature is. */
function send(pulls: PullRequests, member: string, ...args: readonly unknown[]): Promise<unknown> {
  const sendable = (pulls as unknown as Record<string, Sendable>)[member];
  if (sendable === undefined) throw new Error(`the double carries no member ${member}`);
  return sendable(...args);
}

/** An answer for every member of `pulls`, each resolving to the member name. */
function everyMember(pulls: PullRequests): PullRequestsAnswers {
  const named = membersOf(pulls).map((member) => [member, () => Promise.resolve(member)]);
  return Object.fromEntries(named) as PullRequestsAnswers;
}

describe('the pull request double', () => {
  it('names itself a gh provider, as the port allows no other kind', () => {
    expect(createPullRequestsDouble().pulls.kind).toBe('gh');
  });

  it('refuses every member when the case named none', async () => {
    const double = createPullRequestsDouble();
    const members = membersOf(double.pulls);

    // The list is read off the double so a member added to the port is
    // covered here without an edit; that it is not empty is the control
    // on the loop itself.
    expect(members.length).toBeGreaterThan(10);
    for (const member of members) {
      await expect(send(double.pulls, member)).rejects.toThrow(`was sent ${member}`);
    }
  });

  it('answers every member the case named, which is what the refusal above could have done', async () => {
    const double = createPullRequestsDouble(everyMember(createPullRequestsDouble().pulls));
    const members = membersOf(double.pulls);

    expect(members.length).toBeGreaterThan(10);
    for (const member of members) {
      expect(await send(double.pulls, member)).toBe(member);
    }
  });

  it('hands a named member the arguments the caller passed', async () => {
    const seen: unknown[][] = [];
    const double = createPullRequestsDouble({
      merge: (number, method) => {
        seen.push([number, method]);
        return Promise.resolve({ merged: true, detail: 'Squashed and merged' });
      },
    });

    const outcome = await double.pulls.merge(41, 'squash');

    expect(outcome).toEqual({ merged: true, detail: 'Squashed and merged' });
    expect(seen).toEqual([[41, 'squash']]);
  });

  it('refuses a member the case did not name while answering one it did', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(null) });

    expect(await double.pulls.get(41)).toBeNull();
    await expect(double.pulls.comments(41)).rejects.toThrow('was sent comments');
  });

  it('names in the refusal the members the case did name', async () => {
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(null),
      checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
      merge: () => Promise.resolve({ merged: true, detail: 'Squashed' }),
    });

    await expect(double.pulls.browse(41))
      .rejects.toThrow('the pull request double was sent browse, which this case did not name: it answers get, checks and merge alone');
  });

  it('says it answers no member at all when the case named none', async () => {
    await expect(createPullRequestsDouble().pulls.list())
      .rejects.toThrow('the pull request double was sent list, which this case did not name: it answers no member');
  });

  it('carries the refusal wording the case gave it, in place of the one it composes', async () => {
    const own = createPullRequestsDouble(
      { get: () => Promise.resolve(null) },
      { refusal: 'the stub provider models get alone' },
    );
    const composed = createPullRequestsDouble({ get: () => Promise.resolve(null) });

    await expect(own.pulls.list()).rejects.toThrow('the stub provider models get alone');
    // Control: the same call without the option carries the double's own
    // wording, so the case above measured the option and not a default.
    await expect(composed.pulls.list()).rejects.toThrow('which this case did not name');
  });

  it('records every call it was handed, the refused ones included and in order', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(null) });

    await double.pulls.get(41);
    await double.pulls.comment(41, 'a body').catch(() => undefined);
    await double.pulls.get(7);

    expect(double.calls()).toEqual([
      { member: 'get', args: [41], refused: false },
      { member: 'comment', args: [41, 'a body'], refused: true },
      { member: 'get', args: [7], refused: false },
    ]);
  });

  it('spells each call as its member and arguments for sent', async () => {
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(null),
      merge: () => Promise.resolve({ merged: true, detail: 'Squashed' }),
    });

    await double.pulls.get(41);
    await double.pulls.merge(41, 'squash');
    await double.pulls.browse(41).catch(() => undefined);

    expect(double.sent()).toEqual(['get 41', 'merge 41 squash', 'browse 41']);
  });

  it('answers a log a later call does not reach back into', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(null) });

    await double.pulls.get(41);
    const taken = double.calls();
    await double.pulls.get(7);

    expect(taken).toHaveLength(1);
    expect(double.calls()).toHaveLength(2);
  });

  it('refuses by rejecting rather than by throwing where no await can catch it', () => {
    const double = createPullRequestsDouble();

    // A synchronous throw here would fail this case rather than the
    // rejection the port's promise-returning members owe their callers.
    const refusal = double.pulls.list();

    expect(refusal).toBeInstanceOf(Promise);
    return expect(refusal).rejects.toThrow('was sent list');
  });

  it('reads the answers once, so an edit of the object afterwards changes nothing', async () => {
    const answers: PullRequestsAnswers = { get: () => Promise.resolve(null) };
    const double = createPullRequestsDouble(answers);

    (answers as Record<string, unknown>).list = () => Promise.resolve([]);

    expect(await double.pulls.get(41)).toBeNull();
    await expect(double.pulls.list()).rejects.toThrow('was sent list');
  });
});
