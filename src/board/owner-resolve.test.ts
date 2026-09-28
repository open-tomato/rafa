/**
 * Tests for the owner handle resolver (`src/board/owner-resolve.ts`):
 * which `gh api` path each handle asks, the three answers, and one
 * lookup per handle for a resolver's life.
 *
 * Every case drives {@link stubGh}, a runner answering recorded results
 * and keeping the argument lists it was handed, so no case spawns a
 * process or reaches GitHub. The failures are the envelopes
 * `src/pr/gh-fake-shapes.ts` records off `gh` 2.100.0.
 *
 * ## The controls
 *
 *  - Every case asserting an answer also asserts the command sent, so a
 *    resolver asking the wrong path cannot pass on the answer alone.
 *  - The 404 case has a 403 twin with the same envelope shape, so a
 *    resolver reading every failure as `unresolved` fails the twin.
 *  - The caching cases count calls against a second handle that must
 *    send its own command, so a resolver answering everything from its
 *    first lookup fails.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { httpFailure, notFound } from '../pr/gh-fake-shapes.js';

import { createOwnerResolver, ownerLookupArgs } from './owner-resolve.js';

const USERS_DOCS = 'https://docs.github.com/rest/users/users#get-a-user';
const TEAMS_DOCS = 'https://docs.github.com/rest/teams/teams#get-a-team-by-name';

/** A command that exited 0 and wrote `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A runner answering by `answer`, keeping every call. */
function stubGh(answer: (args: readonly string[]) => GhResult): { run: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { run, calls };
}

describe('ownerLookupArgs', () => {
  it('asks the teams path for an @org/team handle', () => {
    expect(ownerLookupArgs('@open-tomato/loop')).toEqual(['api', 'orgs/open-tomato/teams/loop']);
  });

  it('asks the users path for an @login handle', () => {
    expect(ownerLookupArgs('@octocat')).toEqual(['api', 'users/octocat']);
  });

  it('answers null for text that is not one handle', () => {
    expect(ownerLookupArgs('octocat')).toBeNull();
    expect(ownerLookupArgs('@org/../repos')).toBeNull();
    expect(ownerLookupArgs('@a/b/c')).toBeNull();
  });
});

describe('createOwnerResolver', () => {
  it('answers resolved when gh exits 0', async () => {
    const stub = stubGh(() => wrote('{"login":"octocat","type":"User"}'));

    const answer = await createOwnerResolver({ gh: stub.run })('@octocat');

    expect(stub.calls).toEqual([['api', 'users/octocat']]);
    expect(answer).toEqual({ handle: '@octocat', state: 'resolved' });
  });

  it('answers unresolved on a 404', async () => {
    const stub = stubGh(() => notFound('Not Found', TEAMS_DOCS));

    const answer = await createOwnerResolver({ gh: stub.run })('@open-tomato/ghosts');

    expect(stub.calls).toEqual([['api', 'orgs/open-tomato/teams/ghosts']]);
    expect(answer).toEqual({ handle: '@open-tomato/ghosts', state: 'unresolved' });
  });

  it('answers unknown with what gh wrote on a 403', async () => {
    const stub = stubGh(() => httpFailure(403, 'API rate limit exceeded', USERS_DOCS));

    const answer = await createOwnerResolver({ gh: stub.run })('@octocat');

    expect(stub.calls).toEqual([['api', 'users/octocat']]);
    expect(answer).toEqual({
      handle: '@octocat',
      state: 'unknown',
      reason: 'gh api users/octocat failed: gh: API rate limit exceeded (HTTP 403)',
    });
  });

  it('answers unknown with a reason when gh fails and writes nothing', async () => {
    const stub = stubGh(() => ({ ok: false, stdout: '', stderr: '' }));

    const answer = await createOwnerResolver({ gh: stub.run })('@octocat');

    expect(answer).toEqual({
      handle: '@octocat',
      state: 'unknown',
      reason: 'gh api users/octocat failed and wrote nothing',
    });
  });

  it('answers unknown for a malformed handle and sends nothing', async () => {
    const stub = stubGh(() => wrote('{}'));

    const answer = await createOwnerResolver({ gh: stub.run })('@org/../repos');

    expect(stub.calls).toEqual([]);
    expect(answer.state).toBe('unknown');
    expect(answer).toHaveProperty('reason', '"@org/../repos" is not an @login or @org/team handle, so nothing was asked');
  });

  it('reads each handle once, case folded, and each distinct handle on its own', async () => {
    const stub = stubGh((args) => args[1] === 'users/octocat'
      ? wrote('{}')
      : notFound('Not Found', TEAMS_DOCS));
    const resolve = createOwnerResolver({ gh: stub.run });

    const first = await resolve('@octocat');
    const again = await resolve('@OctoCat');
    const team = await resolve('@open-tomato/ghosts');
    const teamAgain = await resolve('@open-tomato/ghosts');

    expect(stub.calls).toEqual([['api', 'users/octocat'], ['api', 'orgs/open-tomato/teams/ghosts']]);
    expect(first).toEqual({ handle: '@octocat', state: 'resolved' });
    expect(again).toEqual({ handle: '@OctoCat', state: 'resolved' });
    expect(team).toEqual({ handle: '@open-tomato/ghosts', state: 'unresolved' });
    expect(teamAgain).toEqual(team);
  });

  it('sends one command for one handle asked twice at once', async () => {
    const stub = stubGh(() => wrote('{}'));
    const resolve = createOwnerResolver({ gh: stub.run });

    const answers = await Promise.all([resolve('@octocat'), resolve('@octocat')]);

    expect(stub.calls).toEqual([['api', 'users/octocat']]);
    expect(answers.map((answer) => answer.state)).toEqual(['resolved', 'resolved']);
  });

  it('keeps no answer across two resolvers, one per command', async () => {
    const stub = stubGh(() => wrote('{}'));

    await createOwnerResolver({ gh: stub.run })('@octocat');
    await createOwnerResolver({ gh: stub.run })('@octocat');

    expect(stub.calls).toEqual([['api', 'users/octocat'], ['api', 'users/octocat']]);
  });
});
