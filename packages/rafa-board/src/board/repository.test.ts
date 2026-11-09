/**
 * Tests for `packages/rafa-board/src/board/repository.ts`: the one
 * `gh repo view` call each reader sends, its refusals, and what
 * `readBoardRepositoryVisibility` answers for each visibility.
 *
 * The `gh` runner is a fake answering one canned result. The answer
 * `{"nameWithOwner":"open-tomato/rafa","visibility":"PUBLIC"}` is what
 * `gh repo view --json nameWithOwner,visibility` wrote in this
 * repository on 2026-11-09.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, test } from 'bun:test';

import { readBoardRepository, readBoardRepositoryVisibility } from './repository.js';

/** The repository the fake answers. */
const REPOSITORY = 'open-tomato/rafa';

/** A `gh` answering `result` to every call, recording each call into `calls`. */
function fakeGh(calls: string[], result: GhResult): GhRunner {
  return (args) => {
    calls.push(args.join(' '));
    return Promise.resolve(result);
  };
}

/** A successful `gh` call that wrote `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

describe('readBoardRepositoryVisibility refuses', () => {
  test('a failed call, naming the command and gh\'s stderr', async () => {
    const gh = fakeGh([], { ok: false, stdout: '', stderr: 'no git remotes found\n' });
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('gh repo view --json nameWithOwner,visibility failed: no git remotes found');
  });

  test('a failed call that wrote nothing', async () => {
    const gh = fakeGh([], { ok: false, stdout: '', stderr: '' });
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('gh repo view --json nameWithOwner,visibility failed: it wrote nothing');
  });

  test('output that is not JSON', async () => {
    const gh = fakeGh([], wrote('nope'));
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('gh repo view --json nameWithOwner,visibility wrote output that is not JSON: "nope"');
  });

  test('a name that is not owner/name', async () => {
    const gh = fakeGh([], wrote(JSON.stringify({ nameWithOwner: 'rafa', visibility: 'PUBLIC' })));
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('gh repo view --json nameWithOwner,visibility answered nameWithOwner "rafa", expected owner/name');
  });

  test('a missing name', async () => {
    const gh = fakeGh([], wrote(JSON.stringify({ visibility: 'PUBLIC' })));
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('answered nameWithOwner undefined, expected owner/name');
  });

  test('an answer that is not a mapping', async () => {
    const gh = fakeGh([], wrote('[]'));
    await expect(readBoardRepositoryVisibility(gh)).rejects.toThrow('answered nameWithOwner undefined, expected owner/name');
  });
});

describe('readBoardRepositoryVisibility answers UNKNOWN', () => {
  for (const [label, visibility] of [
    ['for a missing visibility', undefined],
    ['for an empty visibility', ''],
    ['for a visibility gh does not name', 'SECRET'],
    ['for a lower-case visibility', 'public'],
    ['for a visibility that is not a string', 1],
  ] as const) {
    test(label, async () => {
      const gh = fakeGh([], wrote(JSON.stringify({ nameWithOwner: REPOSITORY, visibility })));
      expect(await readBoardRepositoryVisibility(gh)).toEqual({ repository: REPOSITORY, visibility: 'UNKNOWN' });
    });
  }
});

describe('readBoardRepositoryVisibility reads', () => {
  test('the name and visibility in one gh repo view call', async () => {
    const calls: string[] = [];
    const gh = fakeGh(calls, wrote(`${JSON.stringify({ nameWithOwner: REPOSITORY, visibility: 'PUBLIC' })}\n`));
    expect(await readBoardRepositoryVisibility(gh)).toEqual({ repository: REPOSITORY, visibility: 'PUBLIC' });
    expect(calls).toEqual(['repo view --json nameWithOwner,visibility']);
  });

  for (const visibility of ['PRIVATE', 'INTERNAL'] as const) {
    test(`a ${visibility} visibility`, async () => {
      const gh = fakeGh([], wrote(JSON.stringify({ nameWithOwner: REPOSITORY, visibility })));
      expect(await readBoardRepositoryVisibility(gh)).toEqual({ repository: REPOSITORY, visibility });
    });
  }
});

describe('readBoardRepository', () => {
  test('refuses a failed call as before, naming its own command', async () => {
    const gh = fakeGh([], { ok: false, stdout: '', stderr: 'no git remotes found\n' });
    await expect(readBoardRepository(gh)).rejects.toThrow('gh repo view --json nameWithOwner failed: no git remotes found');
  });

  test('refuses a bad name as before', async () => {
    const gh = fakeGh([], wrote(JSON.stringify({ nameWithOwner: 'a/b/c' })));
    await expect(readBoardRepository(gh)).rejects.toThrow('gh repo view --json nameWithOwner answered nameWithOwner "a/b/c", expected owner/name');
  });

  test('still answers the name alone, from one call asking only for it', async () => {
    const calls: string[] = [];
    const gh = fakeGh(calls, wrote(JSON.stringify({ nameWithOwner: REPOSITORY })));
    expect(await readBoardRepository(gh)).toBe(REPOSITORY);
    expect(calls).toEqual(['repo view --json nameWithOwner']);
  });
});
