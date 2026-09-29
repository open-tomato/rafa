/**
 * Tests for `changedFiles` and `reviews` on the `gh` pull request
 * provider (`src/pr/gh.ts`).
 *
 * Their own file because `./gh.test.ts` sits at the 800-line cap. Every
 * case drives the adapter through a stand-in runner that records the
 * args it is handed and answers one `GhResult`, rather than through the
 * recorded fake in `./gh-fake.ts`: the fake models neither `--json
 * files` nor `--json reviews`, and the payloads here are the shapes
 * `gh` 2.100.0 wrote on 2026-09-28 for `cli/cli` #12000, cut down to the
 * fields the adapter reads plus one it ignores.
 *
 * The two failures that matter are held against each other: a pull
 * request `gh` could not resolve and an outage both THROW, where an
 * adapter reading either as an empty list would tell the owner gate
 * "touches nothing" or "nobody reviewed".
 */
import type { PullRequests } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createGhPullRequests } from './gh.js';

/** A stand-in `gh`: answers `result` to every command, recording each. */
function standIn(result: GhResult): { pr: PullRequests; sent: () => readonly string[][] } {
  const log: string[][] = [];
  const gh: GhRunner = async (args) => {
    log.push([...args]);
    return result;
  };
  return { pr: createGhPullRequests({ gh }), sent: () => log };
}

/** A stand-in writing `payload` as JSON to stdout. */
function writing(payload: unknown): { pr: PullRequests; sent: () => readonly string[][] } {
  return standIn({ ok: true, stdout: `${JSON.stringify(payload)}\n`, stderr: '' });
}

/** What `gh pr view` wrote for a number `cli/cli` has no pull request of. */
const MISSING: GhResult = {
  ok: false,
  stdout: '',
  stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)\n',
};

/** What a failure that is not about a pull request looks like. */
const OUTAGE: GhResult = {
  ok: false,
  stdout: '',
  stderr: 'error connecting to api.github.com: dial tcp: lookup api.github.com: no such host\n',
};

/** One file row as `--json files` writes it. */
function file(path: string): Record<string, unknown> {
  return { path, additions: 1, deletions: 1, changeType: 'MODIFIED' };
}

/** A recorded review row, with `overrides` laid over it. */
function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'PRR_kwDODKw3uc7JuEko',
    author: { login: 'BagToad' },
    authorAssociation: 'MEMBER',
    body: 'Tested out the area where tview is used.',
    submittedAt: '2025-10-27T16:03:33Z',
    includesCreatedEdit: false,
    reactionGroups: [],
    state: 'APPROVED',
    commit: { oid: '14c939560ab7dca8e29c7728e30297dc51c6b797' },
    ...overrides,
  };
}

describe('changedFiles', () => {
  it('sends one pr view for the paths and their count, and answers the paths in order', async () => {
    const { pr, sent } = writing({ changedFiles: 2, files: [file('go.mod'), file('go.sum')] });

    expect(await pr.changedFiles(12000)).toEqual(['go.mod', 'go.sum']);
    expect(sent()).toEqual([['pr', 'view', '12000', '--json', 'changedFiles,files']]);
  });

  it('answers an empty list for a pull request that changes nothing', async () => {
    expect(await writing({ changedFiles: 0, files: [] }).pr.changedFiles(3)).toEqual([]);
  });

  it('throws on the first hundred of a longer list rather than answering part of it', async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => file(`src/f${index}.ts`));

    await expect(writing({ changedFiles: 150, files: hundred }).pr.changedFiles(14354))
      .rejects.toThrow('answered 100 paths for 150 changed files');
  });

  it('answers the same hundred when the count is a hundred, the control on the refusal above', async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => file(`src/f${index}.ts`));

    expect(await writing({ changedFiles: 100, files: hundred }).pr.changedFiles(9)).toHaveLength(100);
  });

  it('throws on a pull request gh could not resolve, never answering an empty list', async () => {
    await expect(standIn(MISSING).pr.changedFiles(999999))
      .rejects.toThrow('gh pull requests: gh pr view 999999 --json changedFiles,files failed: GraphQL: Could not resolve');
  });

  it('throws on an outage, naming what gh wrote', async () => {
    await expect(standIn(OUTAGE).pr.changedFiles(7)).rejects.toThrow('no such host');
  });

  it('refuses a row with no path, naming where', async () => {
    await expect(writing({ changedFiles: 1, files: [{ additions: 1 }] }).pr.changedFiles(7))
      .rejects.toThrow('files[0].path is undefined, expected a string');
  });

  it('refuses a payload with no count rather than trusting the list', async () => {
    await expect(writing({ files: [file('a.ts')] }).pr.changedFiles(7))
      .rejects.toThrow('changedFiles is undefined, expected a whole number of zero or more');
  });

  it('refuses a number that is not a pull request number, sending nothing', async () => {
    const { pr, sent } = writing({ changedFiles: 0, files: [] });

    await expect(pr.changedFiles(-1)).rejects.toThrow('changedFiles refused pull request number -1');
    expect(sent()).toEqual([]);
  });
});

describe('reviews', () => {
  it('sends one pr view for the reviews, and answers each one\'s login, state and submitted time', async () => {
    const { pr, sent } = writing({
      reviews: [
        review({ author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED', submittedAt: '2026-09-08T14:41:07Z' }),
        review({ author: { login: 'babakks' }, submittedAt: '2026-09-09T15:45:23Z' }),
      ],
    });

    expect(await pr.reviews(14354)).toEqual([
      { login: 'copilot-pull-request-reviewer', state: 'COMMENTED', submittedAt: '2026-09-08T14:41:07Z' },
      { login: 'babakks', state: 'APPROVED', submittedAt: '2026-09-09T15:45:23Z' },
    ]);
    expect(sent()).toEqual([['pr', 'view', '14354', '--json', 'reviews']]);
  });

  it('keeps a state it has no word for verbatim', async () => {
    const [only] = await writing({ reviews: [review({ state: 'DISMISSED' })] }).pr.reviews(7);

    expect(only?.state).toBe('DISMISSED');
  });

  it('answers an empty list for a pull request nobody has reviewed', async () => {
    expect(await writing({ reviews: [] }).pr.reviews(7)).toEqual([]);
  });

  it('throws on a pull request gh could not resolve, never answering an empty list', async () => {
    await expect(standIn(MISSING).pr.reviews(999999))
      .rejects.toThrow('gh pull requests: gh pr view 999999 --json reviews failed: GraphQL: Could not resolve');
  });

  it('throws on an outage, naming what gh wrote', async () => {
    await expect(standIn(OUTAGE).pr.reviews(7)).rejects.toThrow('no such host');
  });

  it('refuses a review with no author rather than reading it as nobody\'s', async () => {
    await expect(writing({ reviews: [review({ author: null })] }).pr.reviews(7))
      .rejects.toThrow('reviews[0].author is null, expected a mapping');
  });

  it('refuses a review with no submitted time', async () => {
    await expect(writing({ reviews: [review({ submittedAt: null })] }).pr.reviews(7))
      .rejects.toThrow('reviews[0].submittedAt is null, expected a string');
  });

  it('refuses output that is not JSON', async () => {
    await expect(standIn({ ok: true, stdout: 'nope', stderr: '' }).pr.reviews(7))
      .rejects.toThrow('gh pr view 7 --json reviews wrote output that is not JSON');
  });

  it('refuses a number that is not a pull request number, sending nothing', async () => {
    const { pr, sent } = writing({ reviews: [] });

    await expect(pr.reviews(0)).rejects.toThrow('reviews refused pull request number 0');
    expect(sent()).toEqual([]);
  });
});
