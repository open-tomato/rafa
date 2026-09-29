/**
 * Tests for the `create` and `editTitle` members of the `gh` provider
 * (`gh.ts`), over the recorded fake in `gh-fake.ts`.
 *
 * A file of their own because `gh.test.ts` sits near the 800-line cap.
 * The provider is the subject here, so it runs over the fake rather
 * than over the double: the fake is what holds a second open pull
 * request from one head refused, and a created pull request readable
 * back through `gh pr view`.
 */
import type { FakePrGh } from './gh-fake.js';
import type { PullRequestDraft, PullRequests } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createFakePrGh } from './gh-fake.js';
import { createGhPullRequests } from './gh.js';

/** The fields a summary read asks for, as the adapter spells them. */
const SUMMARY_FIELDS = 'author,baseRefName,headRefName,isCrossRepository,number,state,title,updatedAt,url';

/** The release pull request every case opens. */
const DRAFT: PullRequestDraft = {
  head: 'rafa/release',
  base: 'main',
  title: 'chore: release 0.5.0',
  body: 'Settles `rafa-9` and `rafa-1`.\n\n## 0.5.0 — 2026-09-01, `quoted` "words"\n',
};

/** A fake holding one open pull request, number 7, and the provider over it. */
function withOnePull(): { fake: FakePrGh; pr: PullRequests } {
  const fake = createFakePrGh();
  fake.plant({ number: 7, title: 'rafa-20: pull request commands', headRefName: 'feat/rafa-20' });
  return { fake, pr: createGhPullRequests({ gh: fake.run }) };
}

/** A provider over a runner answering `results` in turn, and the commands it was handed. */
function scripted(results: readonly GhResult[]): { pr: PullRequests; sent: () => readonly (readonly string[])[] } {
  const sent: (readonly string[])[] = [];
  const gh: GhRunner = async (args) => {
    sent.push([...args]);
    return results[sent.length - 1] ?? { ok: false, stdout: '', stderr: 'no more scripted answers' };
  };
  return { pr: createGhPullRequests({ gh }), sent: () => sent };
}

describe('create', () => {
  it('opens the pull request with all four flags and answers it as gh pr view reads it back', async () => {
    const { fake, pr } = withOnePull();

    const opened = await pr.create(DRAFT);

    expect(fake.calls()).toEqual([
      ['pr', 'create', '--head', 'rafa/release', '--base', 'main', '--title', 'chore: release 0.5.0', '--body', DRAFT.body],
      ['pr', 'view', '8', '--json', SUMMARY_FIELDS],
    ]);
    expect(opened).toMatchObject({
      number: 8,
      state: 'open',
      title: 'chore: release 0.5.0',
      headRefName: 'rafa/release',
      baseRefName: 'main',
      url: 'https://github.com/open-tomato/rafa/pull/8',
    });
    // The body travels as one argument and arrives as written.
    expect(fake.pull(8)?.body).toBe(DRAFT.body);
  });

  it('throws when a pull request from that head into that base is already open, opening no second one', async () => {
    const { fake, pr } = withOnePull();
    await pr.create(DRAFT);

    await expect(pr.create(DRAFT)).rejects.toThrow('gh pull requests: gh pr create --head rafa/release --base main failed: fake gh: a pull request for branch rafa/release into branch main already exists');
    expect(fake.pull(9)).toBeUndefined();
  });

  it('reads the number off the last URL line when gh writes other lines before it', async () => {
    const { pr, sent } = scripted([
      { ok: true, stdout: '\nCreating pull request for rafa/release into main in open-tomato/rafa\n\nhttps://github.com/open-tomato/rafa/pull/41\n', stderr: '' },
      { ok: false, stdout: '', stderr: 'planted view failure' },
    ]);

    await expect(pr.create(DRAFT)).rejects.toThrow('gh pull requests: gh pr view 41 failed: planted view failure');
    expect(sent()[1]).toEqual(['pr', 'view', '41', '--json', SUMMARY_FIELDS]);
  });

  it('refuses output whose last line is no pull request URL, reading nothing back', async () => {
    const { pr, sent } = scripted([{ ok: true, stdout: 'https://github.com/open-tomato/rafa/pull/41\nsomething else\n', stderr: '' }]);

    await expect(pr.create(DRAFT)).rejects.toThrow('gh pull requests: gh pr create --head rafa/release --base main answered no pull request URL on its last line');
    expect(sent()).toHaveLength(1);
  });

  it.each([
    ['head', { ...DRAFT, head: '' }],
    ['base', { ...DRAFT, base: '' }],
    ['title', { ...DRAFT, title: '' }],
  ])('refuses an empty %s before any command is sent', async (what, draft) => {
    const { fake, pr } = withOnePull();

    await expect(pr.create(draft)).rejects.toThrow(`gh pull requests: create refused ${what}`);
    expect(fake.calls()).toEqual([]);
  });

  it('opens one with an empty body (the control on the body check)', async () => {
    const { fake, pr } = withOnePull();

    expect((await pr.create({ ...DRAFT, body: '' })).number).toBe(8);
    expect(fake.pull(8)?.body).toBe('');
  });
});

describe('editTitle', () => {
  it('replaces the title alone, leaving the body', async () => {
    const { fake, pr } = withOnePull();
    fake.update(7, (pull) => ({ ...pull, body: 'Closes #20' }));

    await pr.editTitle(7, 'chore: release 0.6.0');

    expect(fake.calls()).toEqual([['pr', 'edit', '7', '--title', 'chore: release 0.6.0']]);
    expect(fake.pull(7)?.title).toBe('chore: release 0.6.0');
    expect(fake.pull(7)?.body).toBe('Closes #20');
  });

  it('throws for a pull request that does not exist', async () => {
    const { pr } = withOnePull();

    await expect(pr.editTitle(9, 'chore: release 0.6.0')).rejects.toThrow('gh pull requests: gh pr edit 9 --title <title> failed: GraphQL: Could not resolve to a PullRequest');
  });

  it('refuses an empty title and a bad number before any command is sent', async () => {
    const { fake, pr } = withOnePull();

    await expect(pr.editTitle(7, '')).rejects.toThrow('gh pull requests: editTitle refused title');
    await expect(pr.editTitle(0, 'chore: release 0.6.0')).rejects.toThrow('gh pull requests: editTitle refused pull request number');
    expect(fake.calls()).toEqual([]);
  });
});
