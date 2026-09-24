/**
 * Tests for the `gh` pull request provider (`src/pr/gh.ts`).
 *
 * Every case drives the adapter through the strict recorded fake in
 * `./gh-fake.ts`, so each command the adapter sends is checked against a
 * modelled `gh` invocation: an unmodelled flag, an unmodelled `--json`
 * field or an unmodelled `api` path fails the case that sent it. Nothing
 * here spawns a process or reaches GitHub.
 *
 * Two readings need a runner the fake cannot make, and those cases build
 * one by hand behind the same `GhRunner` type:
 *
 *   - The control on `get`. A pull request that does not exist and an
 *     outage both exit 1, so `get` answers null on the recorded GraphQL
 *     message ALONE. A stub answering a connection failure is what keeps
 *     the null case from passing on an adapter that reads every failure
 *     as "no such pull request".
 *   - The payload refusals. The fake writes well-formed payloads by
 *     construction, and the adapter checks each field because `gh`
 *     writing an unexpected shape is a reading about `gh`. A stub
 *     answering a hand-built payload is the only way to hold those.
 *   - `ghAuthOk`. `gh auth status` is not one of the commands the fake
 *     models, it being no part of the port, so its two cases record the
 *     args through a stub runner of their own.
 *
 * Twelve mutations of `src/pr/gh.ts` were driven on 2026-09-18, one run
 * each over this file, with 48 pass before and after and the module
 * restored byte-identical (sha256) after every one. Each reddened at
 * least one case, and the failure lists are written from the runs rather
 * than from the prediction:
 *
 *   - `get` answering null on EVERY failure: the outage control alone,
 *     which is the reading that case exists for.
 *   - `checks` answering `none` on every failure: the non-no-checks
 *     failure case alone.
 *   - the `checks` verdict fixed at `green` instead of read off the
 *     rows: three cases, the red pull request and the pending and
 *     cancelled single-row readings.
 *   - `failedLog` answering the empty string on every failure: the
 *     missing-run case alone.
 *   - an unrecognised `mergeable` read as `mergeable`: the mergeability
 *     case alone.
 *   - an unrecognised `state` read as `open`: the `DRAFT` refusal alone.
 *   - the pull request number check dropped: the three number refusals,
 *     each of which also holds that nothing was sent.
 *   - `merge` throwing on a provider refusal instead of answering
 *     `merged` false: the planted-refusal case alone.
 *   - the merge method check dropped: the `ff` refusal alone, which then
 *     reaches the fake as an unmodelled flag rather than a throw.
 *   - `findOpen` sending no `--head`: both of its cases.
 *   - `list` sending no `--state open`: its one case, the merged pull
 *     request then appearing in the answer.
 *   - a comment's `updatedAt` filled from `created_at`: the edit case
 *     alone.
 *
 * Three more were driven on 2026-09-20, when `editBody` was added, one
 * run each over this file, with 59 pass before and after and the module
 * restored byte-identical (sha256) after every one:
 *
 *   - the pull request number check dropped from `editBody`: its three
 *     number refusals alone, each of which also holds that nothing was
 *     sent.
 *   - `editBody` reading no exit code, so a failed edit answers as a
 *     done one: both of its throwing cases, the missing pull request and
 *     the outage.
 *   - `editBody` sending `--title` where `--body` goes: its three cases
 *     that reach the fake, which refuses a flag the `pr edit` route
 *     models nothing for.
 */
import type { FakePrGh } from './gh-fake.js';
import type { PullRequests } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { workflowsFailure } from './gh-fake-shapes.js';
import { createFakePrGh, logFailedText } from './gh-fake.js';
import { createGhPullRequests, ghAuthOk, ghPullRequestsIn } from './gh.js';

/** The fields a summary read asks for, as the adapter spells them. */
const SUMMARY_FIELDS = 'author,baseRefName,headRefName,isCrossRepository,number,state,title,updatedAt,url';

/** The fields a detail read asks for. */
const DETAIL_FIELDS = `${SUMMARY_FIELDS},body,headRefOid,labels,mergeStateStatus,mergeable`;

/** The branch the planted pull request is from. */
const BRANCH = 'feat/rafa-20';

/** A fake holding one open pull request, number 7, and the provider over it. */
function withOnePull(): { fake: FakePrGh; pr: PullRequests } {
  const fake = createFakePrGh();
  fake.plant({
    number: 7,
    title: 'rafa-20: pull request commands',
    body: 'Closes #20',
    headRefName: BRANCH,
    headRefOid: 'deadbeef',
    labels: ['type:spec'],
  });
  return { fake, pr: createGhPullRequests({ gh: fake.run }) };
}

/** A provider over a runner answering `result` to every command. */
function answering(result: GhResult): PullRequests {
  const gh: GhRunner = async () => result;
  return createGhPullRequests({ gh });
}

/** A provider over a runner writing `payload` as JSON to stdout. */
function writing(payload: unknown): PullRequests {
  return answering({ ok: true, stdout: JSON.stringify(payload), stderr: '' });
}

/** What a failure that is not about a pull request looks like. */
const OUTAGE: GhResult = {
  ok: false,
  stdout: '',
  stderr: 'error connecting to api.github.com: dial tcp: lookup api.github.com: no such host\n',
};

/** One summary row, valid, for a payload refusal to change exactly one field of. */
const ROW: Record<string, unknown> = {
  author: { id: 'MDQ6', is_bot: false, login: 'octo', name: 'Octo Cat' },
  baseRefName: 'main',
  headRefName: BRANCH,
  isCrossRepository: false,
  number: 7,
  state: 'OPEN',
  title: 'a change',
  updatedAt: '2026-09-18T11:00:00Z',
  url: 'https://github.com/open-tomato/rafa/pull/7',
};

describe('findOpen', () => {
  it('answers the open pull request of a branch, asking gh for one row of it', async () => {
    const { fake, pr } = withOnePull();

    const found = await pr.findOpen(BRANCH);

    expect(found).toEqual({
      number: 7,
      title: 'rafa-20: pull request commands',
      url: 'https://github.com/open-tomato/rafa/pull/7',
      state: 'open',
      headRefName: BRANCH,
      baseRefName: 'main',
      author: { login: 'octo', isBot: false },
      isCrossRepository: false,
      updatedAt: '2026-09-18T11:00:00Z',
    });
    expect(fake.calls()).toEqual([
      ['pr', 'list', '--state', 'open', '--head', BRANCH, '--limit', '1', '--json', SUMMARY_FIELDS],
    ]);
  });

  it('answers null for a branch with no open pull request', async () => {
    const { pr } = withOnePull();

    expect(await pr.findOpen('no-such-branch')).toBeNull();
  });

  it('refuses an empty branch, sending nothing', async () => {
    const { fake, pr } = withOnePull();

    await expect(pr.findOpen('')).rejects.toThrow(
      'gh pull requests: findOpen refused branch "", expected a non-empty string',
    );
    expect(fake.calls()).toEqual([]);
  });
});

describe('list', () => {
  it('answers every open pull request newest first, and no closed one', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 3, headRefName: 'feat/three' });
    fake.plant({ number: 9, headRefName: 'feat/nine', author: { login: 'app/dependabot', isBot: true } });
    fake.plant({ number: 5, state: 'MERGED' });
    const pr = createGhPullRequests({ gh: fake.run });

    const open = await pr.list();

    expect(open.map((row) => row.number)).toEqual([9, 3]);
    expect(open[0]?.author).toEqual({ login: 'app/dependabot', isBot: true });
    expect(fake.calls()).toEqual([
      ['pr', 'list', '--state', 'open', '--limit', '30', '--json', SUMMARY_FIELDS],
    ]);
  });

  it('throws what gh wrote when the command failed', async () => {
    const pr = createGhPullRequests({ gh: createFakePrGh({ repo: null }).run });

    await expect(pr.list()).rejects.toThrow('gh pull requests: gh pr list failed: no git remotes found');
  });
});

/** The fields a merged-list read asks for. */
const MERGED_FIELDS = 'headRefName,headRefOid,mergedAt,number';

/** One merged row, valid, as `gh pr list --state merged` writes it. */
const MERGED_ROW: Record<string, unknown> = {
  headRefName: BRANCH,
  headRefOid: '411f004d93d61f3292286b1a7f3a84339020417f',
  mergedAt: '2026-09-23T16:38:29Z',
  number: 7,
};

describe('listMerged', () => {
  it('answers merged pull requests alone, in gh\'s order, asking for a fixed hundred of them', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 3, headRefName: 'feat/three', headRefOid: 'aaa', state: 'MERGED', updatedAt: '2026-09-23T21:00:00Z' });
    fake.plant({ number: 9, headRefName: 'feat/nine', headRefOid: 'bbb', state: 'MERGED', updatedAt: '2026-09-22T10:00:00Z' });
    fake.plant({ number: 5, headRefName: 'feat/five' });
    fake.plant({ number: 4, state: 'CLOSED' });
    const pr = createGhPullRequests({ gh: fake.run });

    const merged = await pr.listMerged();

    // Newest created first, which is NOT newest merged: #9 merged a day
    // before #3 and is still listed ahead of it, as recorded off cli/cli.
    expect(merged).toEqual([
      { number: 9, headRefName: 'feat/nine', headRefOid: 'bbb', mergedAt: '2026-09-22T10:00:00Z' },
      { number: 3, headRefName: 'feat/three', headRefOid: 'aaa', mergedAt: '2026-09-23T21:00:00Z' },
    ]);
    expect(fake.calls()).toEqual([
      ['pr', 'list', '--state', 'merged', '--limit', '100', '--json', MERGED_FIELDS],
    ]);
  });

  it('answers a pull request the fake merged, at the fake\'s clock', async () => {
    const fake = createFakePrGh({ now: () => '2026-09-24T10:00:00Z' });
    fake.plant({ number: 7, headRefName: BRANCH, headRefOid: 'deadbeef' });
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.listMerged()).toEqual([]);
    await pr.merge(7, 'squash');

    expect(await pr.listMerged())
      .toEqual([{ number: 7, headRefName: BRANCH, headRefOid: 'deadbeef', mergedAt: '2026-09-24T10:00:00Z' }]);
  });

  it('throws what gh wrote when the command failed, so an outage never reads as no merges', async () => {
    await expect(answering(OUTAGE).listMerged()).rejects.toThrow(
      'gh pull requests: gh pr list --state merged failed: error connecting to api.github.com',
    );
    await expect(createGhPullRequests({ gh: createFakePrGh({ repo: null }).run }).listMerged())
      .rejects.toThrow('gh pull requests: gh pr list --state merged failed: no git remotes found');
  });

  it('reads a well-formed row, the control on the refusals below', async () => {
    expect(await writing([MERGED_ROW]).listMerged()).toEqual([{
      number: 7,
      headRefName: BRANCH,
      headRefOid: '411f004d93d61f3292286b1a7f3a84339020417f',
      mergedAt: '2026-09-23T16:38:29Z',
    }]);
  });

  it.each([
    ['a null mergedAt, which only a pull request not merged answers', { mergedAt: null }, 'row 0.mergedAt is null, expected a string'],
    ['no headRefOid', { headRefOid: undefined }, 'row 0.headRefOid is undefined, expected a string'],
    ['a number written as a string', { number: '7' }, 'row 0.number is "7", expected a positive whole number'],
    ['a numeric headRefName', { headRefName: 7 }, 'row 0.headRefName is 7, expected a string'],
  ])('refuses a row carrying %s, naming the field', async (_label, change, problem) => {
    await expect(writing([{ ...MERGED_ROW, ...change }]).listMerged())
      .rejects.toThrow(`gh pull requests: gh pr list --state merged answered ${problem}`);
  });

  it('refuses a payload that is not a list', async () => {
    await expect(writing(MERGED_ROW).listMerged()).rejects.toThrow(
      'gh pull requests: gh pr list --state merged answered its output is a mapping, expected a list',
    );
  });
});

describe('get', () => {
  it('answers one pull request in full, narrowing its state and mergeability', async () => {
    const { fake, pr } = withOnePull();
    fake.update(7, (pull) => ({ ...pull, mergeStateStatus: 'BLOCKED' }));

    const detail = await pr.get(7);

    expect(detail).toMatchObject({
      number: 7,
      body: 'Closes #20',
      headRefOid: 'deadbeef',
      state: 'open',
      mergeable: 'mergeable',
      mergeStateStatus: 'BLOCKED',
      labels: ['type:spec'],
    });
    expect(fake.calls()).toEqual([['pr', 'view', '7', '--json', DETAIL_FIELDS]]);
  });

  it('answers merged for a merged pull request, whose merge fields read UNKNOWN', async () => {
    const { fake, pr } = withOnePull();
    await fake.run(['pr', 'merge', '7', '--squash']);

    expect(await pr.get(7)).toMatchObject({ state: 'merged', mergeable: 'unknown', mergeStateStatus: 'UNKNOWN' });
  });

  it('answers null for a pull request the repository has none of', async () => {
    const { pr } = withOnePull();

    expect(await pr.get(9)).toBeNull();
  });

  it('throws on a failure that is not the missing pull request, so an outage is never an empty repository', async () => {
    await expect(answering(OUTAGE).get(9)).rejects.toThrow(
      'gh pull requests: gh pr view 9 failed: error connecting to api.github.com',
    );
  });

  it.each([0, -1, 1.5])('refuses the pull request number %p before any command is sent', async (number) => {
    const { fake, pr } = withOnePull();

    await expect(pr.get(number)).rejects.toThrow('gh pull requests: get refused pull request number');
    expect(fake.calls()).toEqual([]);
  });
});

describe('checks', () => {
  it('reads the verdict off the rows of a red pull request, which --json exits 0 on', async () => {
    const fake = createFakePrGh();
    fake.plant({
      number: 7,
      checks: [
        { name: 'gates', state: 'FAILURE', link: 'https://example.test/gates' },
        { name: 'types', state: 'SUCCESS', link: 'https://example.test/types' },
      ],
    });
    const pr = createGhPullRequests({ gh: fake.run });

    const reading = await pr.checks(7);

    expect(reading.verdict).toBe('red');
    expect(reading.rows).toEqual([
      { name: 'gates', state: 'FAILURE', link: 'https://example.test/gates', outcome: 'fail' },
      { name: 'types', state: 'SUCCESS', link: 'https://example.test/types', outcome: 'pass' },
    ]);
    expect(fake.calls()).toEqual([['pr', 'checks', '7', '--json', 'name,state,link']]);
  });

  it.each([
    ['SUCCESS', 'green'],
    ['IN_PROGRESS', 'pending'],
    ['CANCELLED', 'red'],
  ])('reads a single %p check as %p', async (state, verdict) => {
    const fake = createFakePrGh();
    fake.plant({ number: 7, checks: [{ name: 'gates', state, link: '' }] });
    const pr = createGhPullRequests({ gh: fake.run });

    expect((await pr.checks(7)).verdict).toBe(verdict);
  });

  it('answers none for a pull request with no checks at all, which gh reports by failing', async () => {
    const { pr } = withOnePull();

    expect(await pr.checks(7)).toEqual({ rows: [], verdict: 'none' });
  });

  it('throws on a failure that is not the no-checks report', async () => {
    await expect(answering(OUTAGE).checks(7)).rejects.toThrow('gh pull requests: gh pr checks 7 failed:');
  });
});

describe('browse', () => {
  it('sends the web view and answers nothing', async () => {
    const { fake, pr } = withOnePull();

    expect(await pr.browse(7)).toBeUndefined();
    expect(fake.calls()).toEqual([['pr', 'view', '7', '--web']]);
  });

  it('throws for a pull request that does not exist, where get answers null', async () => {
    const { pr } = withOnePull();

    await expect(pr.browse(9)).rejects.toThrow('gh pull requests: gh pr view 9 --web failed: GraphQL:');
  });
});

describe('merge', () => {
  it.each(['squash', 'merge', 'rebase'] as const)('merges with --%s, reporting an outcome gh wrote nothing for', async (method) => {
    const { fake, pr } = withOnePull();

    const outcome = await pr.merge(7, method);

    expect(outcome).toEqual({ merged: true, detail: `gh pr merge 7 --${method} exited 0 and wrote nothing` });
    expect(fake.pull(7)).toMatchObject({ state: 'MERGED' });
    expect(fake.calls()).toEqual([['pr', 'merge', '7', `--${method}`]]);
  });

  it('answers merged false with what the provider said, rather than throwing', async () => {
    const { fake, pr } = withOnePull();
    fake.refuseMerge(7, 'Pull request is not mergeable: the base branch policy prohibits the merge.\n');

    const outcome = await pr.merge(7, 'squash');

    expect(outcome).toEqual({
      merged: false,
      detail: 'Pull request is not mergeable: the base branch policy prohibits the merge.',
    });
    expect(fake.pull(7)).toMatchObject({ state: 'OPEN' });
  });

  it('refuses a method that is not one of the three, sending no flag gh never modelled', async () => {
    const { fake, pr } = withOnePull();

    await expect(pr.merge(7, 'ff' as 'squash')).rejects.toThrow(
      'gh pull requests: merge refused method "ff", expected one of: squash, merge, rebase',
    );
    expect(fake.calls()).toEqual([]);
  });
});

describe('editBody', () => {
  /** A body with the shapes a release note carries: blank lines, a list, backticks. */
  const BODY = 'Closes #20\n\n## Changelog\n\n- release: `patch`\n';

  it('sends the body as one argument and answers nothing, the read after it seeing it', async () => {
    const { fake, pr } = withOnePull();

    expect(await pr.editBody(7, BODY)).toBeUndefined();

    expect(fake.calls()[0]).toEqual(['pr', 'edit', '7', '--body', BODY]);
    expect((await pr.get(7))?.body).toBe(BODY);
  });

  it('writes an empty body, which clears the description', async () => {
    const { fake, pr } = withOnePull();

    await pr.editBody(7, '');

    expect(fake.calls()[0]).toEqual(['pr', 'edit', '7', '--body', '']);
    expect(fake.pull(7)?.body).toBe('');
  });

  it('throws for a pull request that does not exist, where get answers null', async () => {
    const { fake, pr } = withOnePull();

    await expect(pr.editBody(9, BODY)).rejects.toThrow(
      'gh pull requests: gh pr edit 9 --body <body> failed: GraphQL: Could not resolve to a PullRequest',
    );
    // The control on the throw: `get` reads the same absence as null,
    // and the body of the pull request that does exist is untouched.
    expect(await pr.get(9)).toBeNull();
    expect(fake.pull(7)?.body).toBe('Closes #20');
  });

  it('throws what gh wrote on a failure that is not about the pull request', async () => {
    await expect(answering(OUTAGE).editBody(7, BODY)).rejects.toThrow(
      'gh pull requests: gh pr edit 7 --body <body> failed: error connecting to api.github.com',
    );
  });

  it.each([0, -1, 1.5])('refuses the pull request number %p before any command is sent', async (number) => {
    const { fake, pr } = withOnePull();

    await expect(pr.editBody(number, BODY)).rejects.toThrow('gh pull requests: editBody refused pull request number');
    expect(fake.calls()).toEqual([]);
  });

  it('refuses a body that is not a string, sending nothing', async () => {
    const { fake, pr } = withOnePull();

    await expect(pr.editBody(7, null as unknown as string)).rejects.toThrow(
      'gh pull requests: editBody refused a body null, expected a string',
    );
    expect(fake.calls()).toEqual([]);
  });
});

describe('comments', () => {
  it('answers no comment for a pull request with none, through the REST path', async () => {
    const { fake, pr } = withOnePull();

    expect(await pr.comments(7)).toEqual([]);
    expect(fake.calls()).toEqual([['api', 'repos/{owner}/{repo}/issues/7/comments']]);
  });

  it('answers the REST id as a string and reads a bot author off the user type', async () => {
    const fake = createFakePrGh();
    fake.plant({
      number: 7,
      comments: [{
        id: 5000000042,
        author: { login: 'app/dependabot', isBot: true },
        body: 'bumped',
        createdAt: '2026-09-17T09:00:00Z',
        updatedAt: '2026-09-17T09:00:00Z',
      }],
    });
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.comments(7)).toEqual([{
      id: '5000000042',
      author: { login: 'app/dependabot', isBot: true },
      body: 'bumped',
      updatedAt: '2026-09-17T09:00:00Z',
      url: 'https://github.com/open-tomato/rafa/pull/7#issuecomment-5000000042',
    }]);
  });

  it('throws for a pull request the repository has none of', async () => {
    const { pr } = withOnePull();

    await expect(pr.comments(9)).rejects.toThrow(
      'gh pull requests: gh api repos/{owner}/{repo}/issues/9/comments failed: gh: Not Found (HTTP 404)',
    );
  });
});

describe('comment and editComment', () => {
  it('posts a comment, answers it, and reads it back off the list', async () => {
    const { fake, pr } = withOnePull();

    const posted = await pr.comment(7, 'first pass');

    expect(posted).toMatchObject({ id: '5000000001', body: 'first pass', author: { login: 'rafa-fake', isBot: false } });
    expect(await pr.comments(7)).toEqual([posted]);
    expect(fake.calls()[0]).toEqual([
      'api',
      'repos/{owner}/{repo}/issues/7/comments',
      '-X',
      'POST',
      '-f',
      'body=first pass',
    ]);
  });

  it('edits one comment through its REST id, moving what the comment was last written at', async () => {
    const stamps = ['2026-09-18T12:00:00Z', '2026-09-18T13:00:00Z'];
    let reads = 0;
    const fake = createFakePrGh({
      now: () => {
        const at = stamps[Math.min(reads, stamps.length - 1)] ?? '';
        reads += 1;
        return at;
      },
    });
    fake.plant({ number: 7 });
    const pr = createGhPullRequests({ gh: fake.run });

    const posted = await pr.comment(7, 'first pass');
    const edited = await pr.editComment(posted.id, 'second pass');

    expect(posted.updatedAt).toBe('2026-09-18T12:00:00Z');
    expect(edited).toMatchObject({ id: posted.id, body: 'second pass', updatedAt: '2026-09-18T13:00:00Z' });
    expect(fake.calls()[1]).toEqual([
      'api',
      'repos/{owner}/{repo}/issues/comments/5000000001',
      '-X',
      'PATCH',
      '-f',
      'body=second pass',
    ]);
  });

  it.each(['', 'IC_kwDOfake', '0', '-1'])('refuses the comment id %p before any command is sent', async (id) => {
    const { fake, pr } = withOnePull();

    await expect(pr.editComment(id, 'body')).rejects.toThrow('gh pull requests: editComment refused comment id');
    expect(fake.calls()).toEqual([]);
  });
});

describe('failedLog', () => {
  it('answers the log of a failed run verbatim', async () => {
    const fake = createFakePrGh();
    fake.plantRun('34978884017', logFailedText('gates', ['error: 1 test failed']));
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.failedLog('34978884017')).toBe('gates\tUNKNOWN STEP\t2026-09-18T11:30:00Z error: 1 test failed\n');
    expect(fake.calls()).toEqual([['run', 'view', '34978884017', '--log-failed']]);
  });

  it('answers nothing for a run whose log has been dropped', async () => {
    const fake = createFakePrGh();
    fake.expireRun('34856988782');
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.failedLog('34856988782')).toBe('');
  });

  it('throws for a run that does not exist, so a wrong run id is never an empty log', async () => {
    const pr = createGhPullRequests({ gh: createFakePrGh().run });

    await expect(pr.failedLog('42')).rejects.toThrow(
      'gh pull requests: gh run view 42 --log-failed failed: failed to get run: HTTP 404: Not Found',
    );
  });
});

describe('workflowCount', () => {
  // Stub runners, not the fake: these hold what the adapter sends and
  // how it reads each answer. The fake-driven reading over the recorded
  // repositories is its own case.

  /** A runner answering `result` to every command, recording what it was sent. */
  function recording(result: GhResult): { pr: PullRequests; sent: string[][] } {
    const sent: string[][] = [];
    const gh: GhRunner = async (args) => {
      sent.push([...args]);
      return result;
    };
    return { pr: createGhPullRequests({ gh }), sent };
  }

  /** A successful read writing `payload` as JSON. */
  const wrote = (payload: unknown): GhResult => ({ ok: true, stdout: JSON.stringify(payload), stderr: '' });

  it('sends the workflows path alone, and answers zero as zero and not as null', async () => {
    const runner = recording(wrote({ total_count: 0, workflows: [] }));

    expect(await runner.pr.workflowCount()).toBe(0);
    expect(runner.sent).toEqual([['api', 'repos/{owner}/{repo}/actions/workflows']]);
  });

  it('answers total_count rather than the length of the first page it came with', async () => {
    const page = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `w${index}` }));

    expect(await recording(wrote({ total_count: 119, workflows: page })).pr.workflowCount()).toBe(119);
  });

  it.each([
    ['the recorded 403', workflowsFailure(403)],
    ['the recorded 404', workflowsFailure(404)],
    ['an outage', OUTAGE],
  ])('answers null on %s, where every other read throws', async (_label, result) => {
    expect(await recording(result).pr.workflowCount()).toBeNull();
  });

  it('answers null on a failure whose stdout carries a count, reading the exit code first', async () => {
    // The control on reading the exit code: this payload would answer 3
    // on the success path, which the case above it cannot tell apart.
    const failed: GhResult = { ...wrote({ total_count: 3 }), ok: false };

    expect(await recording(failed).pr.workflowCount()).toBeNull();
    expect(await recording(wrote({ total_count: 3 })).pr.workflowCount()).toBe(3);
  });

  it.each([
    ['output that is not JSON', { ok: true, stdout: 'not json', stderr: '' }],
    ['no total_count', wrote({ workflows: [] })],
    ['a total_count written as a string', wrote({ total_count: '3' })],
    ['a negative total_count', wrote({ total_count: -1 })],
    ['a fractional total_count', wrote({ total_count: 1.5 })],
    ['a list rather than a mapping', wrote([{ total_count: 3 }])],
    ['null', wrote(null)],
  ])('answers null on a successful read with %s, never a guessed count', async (_label, result) => {
    expect(await recording(result).pr.workflowCount()).toBeNull();
  });
});

describe('workflowCount over the gh fake', () => {
  // The stub cases above hold what the adapter sends and how it reads
  // each shape; this is the reading driven through the recorded
  // repository the fake models, as the note above promised.

  it('answers zero for a repository with no workflow, the fake\'s own starting state', async () => {
    const fake = createFakePrGh();
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.workflowCount()).toBe(0);
    expect(fake.calls()).toEqual([['api', 'repos/{owner}/{repo}/actions/workflows']]);
  });

  it('answers the count of a repository holding three workflows', async () => {
    const fake = createFakePrGh();
    fake.plantWorkflows([{ name: 'Lint' }, { name: 'Tests' }, { name: 'Release' }]);
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.workflowCount()).toBe(3);
  });

  it('answers null for a repository whose workflows path answers 403, never the count it held before', async () => {
    const fake = createFakePrGh();
    fake.plantWorkflows([{ name: 'Lint' }, { name: 'Tests' }, { name: 'Release' }]);
    fake.refuseWorkflows(403);
    const pr = createGhPullRequests({ gh: fake.run });

    expect(await pr.workflowCount()).toBeNull();
  });
});

describe('what the adapter refuses in a payload', () => {
  it('refuses a row that is not a mapping, and a payload that is not a list', async () => {
    await expect(writing([null]).list()).rejects.toThrow(
      'gh pull requests: gh pr list answered row 0 is null, expected a mapping',
    );
    await expect(writing({ number: 7 }).list()).rejects.toThrow(
      'gh pull requests: gh pr list answered its output is a mapping, expected a list',
    );
  });

  it.each([
    ['an author with no login', { author: { is_bot: false } }, 'row 0.author.login is undefined, expected a string'],
    ['an author with no is_bot', { author: { login: 'octo' } }, 'row 0.author.is_bot is undefined, expected a boolean'],
    ['a number written as a string', { number: '7' }, 'row 0.number is "7", expected a positive whole number'],
    ['a fork flag written as a string', { isCrossRepository: 'false' }, 'row 0.isCrossRepository is "false", expected a boolean'],
    ['a null title', { title: null }, 'row 0.title is null, expected a string'],
  ])('refuses a row carrying %s, naming the field', async (_label, change, problem) => {
    await expect(writing([{ ...ROW, ...change }]).list())
      .rejects.toThrow(`gh pull requests: gh pr list answered ${problem}`);
  });

  it('refuses a state it does not recognise, there being no safe reading of one', async () => {
    await expect(writing([{ ...ROW, state: 'DRAFT' }]).list()).rejects.toThrow(
      'gh pull requests: gh pr list answered row 0.state is "DRAFT", expected one of: OPEN, CLOSED, MERGED',
    );
  });

  it('reads a mergeability it does not recognise as unknown, keeping the raw merge state beside it', async () => {
    const detail = await writing({
      ...ROW,
      body: '',
      headRefOid: 'deadbeef',
      labels: [{ name: 'type:spec' }],
      mergeStateStatus: 'DIRTY',
      mergeable: 'COMPUTING',
    }).get(7);

    expect(detail).toMatchObject({ mergeable: 'unknown', mergeStateStatus: 'DIRTY', labels: ['type:spec'] });
  });

  it('refuses a label that carries no name', async () => {
    const pr = writing({ ...ROW, body: '', headRefOid: 'x', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', labels: ['type:spec'] });

    await expect(pr.get(7)).rejects.toThrow(
      'gh pull requests: gh pr view 7 answered the pull request.labels[0] is "type:spec", expected a mapping',
    );
  });

  it('refuses output that is not JSON, naming the command that wrote it', async () => {
    const pr = answering({ ok: true, stdout: 'not json at all', stderr: '' });

    await expect(pr.list()).rejects.toThrow('gh pull requests: gh pr list wrote output that is not JSON:');
  });

  it('refuses a comment whose id is not a REST id', async () => {
    const pr = writing([{
      body: 'hi',
      html_url: 'https://github.com/open-tomato/rafa/pull/7#issuecomment-1',
      id: 'IC_kwDOfake',
      updated_at: '2026-09-18T12:00:00Z',
      user: { login: 'octo', type: 'User' },
    }]);

    await expect(pr.comments(7)).rejects.toThrow(
      'answered comment 0.id is "IC_kwDOfake", expected a positive whole number',
    );
  });
});

describe('ghAuthOk', () => {
  /** A runner answering `ok` to every command, recording what it was sent. */
  function recording(ok: boolean): { gh: GhRunner; sent: string[][] } {
    const sent: string[][] = [];
    const gh: GhRunner = async (args) => {
      sent.push([...args]);
      return { ok, stdout: '', stderr: '' };
    };
    return { gh, sent };
  }

  it('answers true when gh auth status exits 0, asking exactly that', async () => {
    const runner = recording(true);

    expect(await ghAuthOk(runner.gh)).toBe(true);
    expect(runner.sent).toEqual([['auth', 'status']]);
  });

  it('answers false when the runner reports a failure', async () => {
    // The control on the case above: a runner that answers `ok` false is
    // both an unauthenticated `gh` and a `gh` that is not installed,
    // which `createGhRunner` reports the same way.
    const runner = recording(false);

    expect(await ghAuthOk(runner.gh)).toBe(false);
    expect(runner.sent).toEqual([['auth', 'status']]);
  });
});

describe('ghPullRequestsIn', () => {
  it('answers a gh provider without running anything', () => {
    // Nothing is called on it: every member here would spawn the real
    // `gh` in the directory given. What the wiring itself does is held
    // by the cases above, which drive the same adapter over the fake.
    const pr = ghPullRequestsIn('/tmp/nowhere');

    expect(pr.kind).toBe('gh');
    expect(typeof pr.findOpen).toBe('function');
  });
});
