/**
 * Tests for the `close` member of the `gh` provider (`gh-close.ts`,
 * wired in `gh.ts`), and for the `pr close` the recorded fake in
 * `gh-fake.ts` models for it.
 *
 * The provider is the subject, so it runs over the fake rather than
 * over the double: the fake is what refuses an argv `gh pr close` was
 * not read to take, and what shows the pull request closed afterwards.
 * No case spawns anything or reaches GitHub.
 *
 * Controls: each argv case reads the other spelling beside it (with the
 * flag, without it), the refusals before `gh` is run are read beside a
 * call that does run it, and the fake's own refusals beside the close
 * it accepts.
 */
import type { FakePrGh } from './gh-fake.js';
import type { ClosePullRequestOptions, PullRequests } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { closeArgs, closePullRequest, DELETE_BRANCH_FLAG } from './gh-close.js';
import { createFakePrGh } from './gh-fake.js';
import { createGhPullRequests } from './gh.js';

/** The pull request every case closes. */
const NUMBER = 41;

/** Its head branch. */
const HEAD = 'fix/rafa-940';

/** A closing comment with what a shell would trip on, a line break and a leading hyphen. */
const REASON = '--superseded by #44: "the same fix"\non a new base, with `backticks`';

const KEEP: ClosePullRequestOptions = { deleteBranch: false };
const DELETE: ClosePullRequestOptions = { deleteBranch: true };

/** A fake holding the open pull request, and the provider over it. */
function withOnePull(): { fake: FakePrGh; pr: PullRequests } {
  const fake = createFakePrGh();
  fake.plant({ number: NUMBER, title: 'fix: the first attempt', headRefName: HEAD });
  return { fake, pr: createGhPullRequests({ gh: fake.run }) };
}

/** A runner answering `result` to every command, and the commands it was handed. */
function answering(result: GhResult): { gh: GhRunner; sent: () => readonly (readonly string[])[] } {
  const sent: (readonly string[])[] = [];
  const gh: GhRunner = async (args) => {
    sent.push([...args]);
    return Promise.resolve(result);
  };
  return { gh, sent: () => sent };
}

/** What a rejected promise rejected with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('the promise resolved, and a rejection was expected');
}

describe('closeArgs', () => {
  it('spells gh pr close with the comment as one --comment=<text> argument, and no branch flag', () => {
    expect(closeArgs('41', REASON, false)).toEqual(['pr', 'close', '41', `--comment=${REASON}`]);
  });

  it('adds --delete-branch last when the branch is to go', () => {
    expect(closeArgs('41', REASON, true)).toEqual(['pr', 'close', '41', `--comment=${REASON}`, '--delete-branch']);
    expect(DELETE_BRANCH_FLAG).toBe('--delete-branch');
  });
});

describe('close, through the provider', () => {
  it('sends one gh pr close without --delete-branch, closing the pull request and keeping its branch', async () => {
    const { fake, pr } = withOnePull();

    const answer = await pr.close(NUMBER, REASON, KEEP);

    expect(answer).toBeUndefined();
    expect(fake.calls()).toEqual([['pr', 'close', '41', `--comment=${REASON}`]]);
    expect(fake.pull(NUMBER)?.state).toBe('CLOSED');
    expect(fake.deletedBranches()).toEqual([]);
  });

  it('sends --delete-branch when asked to, which the fake records against the head', async () => {
    const { fake, pr } = withOnePull();

    await pr.close(NUMBER, REASON, DELETE);

    expect(fake.calls()).toEqual([['pr', 'close', '41', `--comment=${REASON}`, '--delete-branch']]);
    expect(fake.pull(NUMBER)?.state).toBe('CLOSED');
    expect(fake.deletedBranches()).toEqual([HEAD]);
  });

  it('leaves the comment on the pull request as written, read back through comments', async () => {
    const { pr } = withOnePull();

    await pr.close(NUMBER, REASON, KEEP);

    expect((await pr.comments(NUMBER)).map((comment) => comment.body)).toEqual([REASON]);
    expect((await pr.get(NUMBER))?.state).toBe('closed');
  });

  it('rejects naming the command and what gh wrote, for a pull request the repository does not hold', async () => {
    const { fake, pr } = withOnePull();

    const error = await rejection(pr.close(99, REASON, KEEP));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'gh pull requests: gh pr close 99 failed:'
        + ' GraphQL: Could not resolve to a PullRequest with the number of 99. (repository.pullRequest)',
    );
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });
});

describe('closePullRequest, over a scripted runner', () => {
  it('resolves on exit 0 whatever gh wrote, reading the exit code alone', async () => {
    const { gh, sent } = answering({ ok: true, stdout: 'anything\n', stderr: '✓ Closed pull request\n' });

    await closePullRequest(gh, NUMBER, REASON, KEEP);

    expect(sent()).toEqual([['pr', 'close', '41', `--comment=${REASON}`]]);
  });

  it('rejects naming the command with its branch flag and never the comment', async () => {
    const { gh } = answering({ ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible\n' });

    const error = await rejection(closePullRequest(gh, NUMBER, REASON, DELETE));

    expect((error as Error).message)
      .toBe('gh pull requests: gh pr close 41 --delete-branch failed: HTTP 403: Resource not accessible');
    expect((error as Error).message).not.toContain('superseded');
  });

  it('rejects with a message that is never empty when a failed gh wrote nothing', async () => {
    const { gh } = answering({ ok: false, stdout: '', stderr: '' });

    const error = await rejection(closePullRequest(gh, NUMBER, REASON, KEEP));

    expect((error as Error).message)
      .toBe('gh pull requests: gh pr close 41 failed: gh pr close 41 exited non-zero and wrote nothing');
  });

  it.each([
    ['a negative number', -1, REASON, KEEP, 'close refused pull request number -1, expected a positive whole number'],
    ['a fraction', 1.5, REASON, KEEP, 'close refused pull request number 1.5, expected a positive whole number'],
    ['an empty comment', NUMBER, '', KEEP, 'close refused a comment "", expected a string that is not blank'],
    ['a blank comment', NUMBER, ' \n', KEEP, 'close refused a comment " \\n", expected a string that is not blank'],
    [
      'a deleteBranch that is no boolean',
      NUMBER,
      REASON,
      { deleteBranch: 'yes' } as unknown as ClosePullRequestOptions,
      'close refused deleteBranch "yes", expected true or false',
    ],
    [
      'no options at all',
      NUMBER,
      REASON,
      undefined as unknown as ClosePullRequestOptions,
      'close refused deleteBranch undefined, expected true or false',
    ],
  ])('refuses %s with a TypeError before gh is run', async (_what, number, comment, options, message) => {
    const { gh, sent } = answering({ ok: true, stdout: '', stderr: '' });

    const error = await rejection(closePullRequest(gh, number, comment, options));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(`gh pull requests: ${message}`);
    expect(sent()).toEqual([]);

    // The control: the same runner is reached by a call nothing refuses.
    await closePullRequest(gh, NUMBER, REASON, KEEP);
    expect(sent()).toHaveLength(1);
  });
});

describe('gh pr close, in the fake', () => {
  const failure = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });

  it('reads the comment in both spellings gh takes, writing nothing to either stream', async () => {
    const joined = withOnePull().fake;
    const apart = withOnePull().fake;

    expect(await joined.run(['pr', 'close', '41', '--comment=obsolete'])).toEqual({ ok: true, stdout: '', stderr: '' });
    expect(await apart.run(['pr', 'close', '41', '--comment', 'obsolete'])).toEqual({ ok: true, stdout: '', stderr: '' });

    expect(joined.pull(NUMBER)?.comments.map((comment) => comment.body)).toEqual(['obsolete']);
    expect(apart.pull(NUMBER)?.comments.map((comment) => comment.body)).toEqual(['obsolete']);
  });

  it('keeps an equals sign inside the comment, splitting on the first one alone', async () => {
    const { fake } = withOnePull();

    await fake.run(['pr', 'close', '41', '--comment=a=b --delete-branch']);

    expect(fake.pull(NUMBER)?.comments.map((comment) => comment.body)).toEqual(['a=b --delete-branch']);
    expect(fake.deletedBranches()).toEqual([]);
  });

  it('refuses a close with no comment or a blank one, leaving the pull request open', async () => {
    const { fake } = withOnePull();
    const stderr = 'fake gh: pr close models --comment=<text> with text that is not blank, and was handed none\n';

    expect(await fake.run(['pr', 'close', '41'])).toEqual(failure(stderr));
    expect(await fake.run(['pr', 'close', '41', '--comment=  '])).toEqual(failure(stderr));

    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });

  it('refuses a second close and the close of a merged pull request, in its own words', async () => {
    const { fake } = withOnePull();
    fake.plant({ number: 42, title: 'merged already', headRefName: 'feat/done', state: 'MERGED' });

    expect((await fake.run(['pr', 'close', '41', '--comment=once'])).ok).toBe(true);

    expect(await fake.run(['pr', 'close', '41', '--comment=twice', '--delete-branch']))
      .toEqual(failure('fake gh: pull request 41 is CLOSED, and a close is modelled for an open one alone\n'));
    expect(await fake.run(['pr', 'close', '42', '--comment=late']))
      .toEqual(failure('fake gh: pull request 42 is MERGED, and a close is modelled for an open one alone\n'));
    expect(fake.pull(NUMBER)?.comments).toHaveLength(1);
    expect(fake.deletedBranches()).toEqual([]);
  });

  it('refuses a flag gh pr close was not read to take, and another repository', async () => {
    const { fake } = withOnePull();

    expect(await fake.run(['pr', 'close', '41', '--comment=x', '--force']))
      .toEqual(failure('fake gh: pr close does not model flag --force\n'));
    expect(await fake.run(['pr', 'close', '41', '--comment=x', '--repo', 'cli/cli']))
      .toEqual(failure('fake gh: models one repository, open-tomato/rafa, and was handed --repo cli/cli\n'));
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });

  it('still refuses --delete-branch on a merge, where it is not modelled', async () => {
    const { fake } = withOnePull();

    expect(await fake.run(['pr', 'merge', '41', '--squash', '--delete-branch']))
      .toEqual(failure('fake gh: pr merge does not model flag --delete-branch\n'));
  });
});
