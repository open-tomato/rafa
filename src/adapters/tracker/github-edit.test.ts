/**
 * Tests for the `editable` and `edit` pair of the `github` Tracker
 * adapter (`src/adapters/tracker/github-edit.ts`), reached through
 * `createGithubTracker` as every caller reaches it.
 *
 * The shared contract cases for the pair run in `github.test.ts`, over
 * the recorded fake; these hold what the contract leaves to the
 * adapter: the one command each member sends, the body travelling on
 * stdin and never as an argument, the payload checks, and the refusals
 * made before anything is sent. No case spawns anything: each runs over
 * the fake (`github-fake.ts`) or a scripted runner written here.
 *
 * Each refusal sits beside a control that what it refused would
 * otherwise have been sent or read, and where a case holds that nothing
 * was sent it reads the fake's record of every command.
 *
 * Six mutations were driven on 2026-10-06, one run each over
 * `src/adapters/tracker/`, at 396 pass before, with `github-edit.ts` and
 * `github.ts` restored byte-identical (sha256) after. The body sent as
 * `--body` reddened 11 cases, and the body never handed over as stdin
 * 11; `open` answered true whatever the state 2, the author dropped 8,
 * and the pair left unwired from the tracker 28. The runner spawning
 * with stdin ignored however one is given reddened the runner's stdin
 * case in `github.test.ts` alone, since every case here runs over the
 * fake or a scripted runner.
 */
import type { GhResult, GhRunner } from './github.js';
import type { IssueEdit, IssueRef, Tracker } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { draftFixture } from './contract.js';
import { EDITABLE_FIELDS } from './github-edit.js';
import { createFakeGh } from './github-fake.js';
import { createGithubTracker } from './github.js';

/** A github ref to issue `externalId`, with any field replaced. */
function githubRef(externalId: string, overrides: Partial<IssueRef> = {}): IssueRef {
  return { opt: 0, kind: 'github', externalId, url: null, ...overrides };
}

/** A github tracker over a fresh fake holding one issue, and the fake. */
async function overOneIssue(): Promise<{ tracker: Tracker; fake: ReturnType<typeof createFakeGh> }> {
  const fake = createFakeGh();
  const tracker = createGithubTracker({ gh: fake.run });
  await tracker.create(draftFixture({ opt: 0, title: 'Replay window', body: 'Codes stay valid.\n', module: 'auth' }));
  return { tracker, fake };
}

/** The tracker's pair. Throws when it lacks either member. */
function pairOf(tracker: Tracker): { editable: NonNullable<Tracker['editable']>; edit: NonNullable<Tracker['edit']> } {
  const { editable, edit } = tracker;
  if (editable === undefined || edit === undefined) throw new Error('the github tracker has no editable and edit pair');
  return { editable, edit };
}

/** A runner answering every command with `answer`, and every command it was handed with its stdin. */
function scripted(answer: GhResult): { run: GhRunner; calls: [readonly string[], string | undefined][] } {
  const calls: [readonly string[], string | undefined][] = [];
  return {
    run: async (args, stdin) => {
      calls.push([[...args], stdin]);
      return answer;
    },
    calls,
  };
}

/** A successful answer writing `payload` as JSON. */
function wroteJson(payload: unknown): GhResult {
  return { ok: true, stdout: `${JSON.stringify(payload)}\n`, stderr: '' };
}

/** A view payload of every field `editable` asks for, with any replaced. */
function viewPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    author: { id: 'MDQ6VXNlcjk4NDgy', is_bot: false, login: 'vilmibm', name: 'Nate Smith' },
    body: 'Codes stay valid.\n',
    labels: [{ id: 'LA_1', name: 'type:spec', description: '', color: 'ededed' }],
    state: 'OPEN',
    title: 'Replay window',
    ...overrides,
  };
}

/** A body holding a flag, a non-ASCII letter, inner blank lines and a trailing newline. */
const BODY = '--web\n\n## Context\n\ncafé, two words\n\n**Updated 2026-10-06, notes:**\n\nNarrow it.\n';

describe('reading an issue to edit', () => {
  it('sends one gh issue view asking for the title, body, state, labels and author', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    const issue = await pairOf(tracker).editable(githubRef('1'));

    expect(fake.calls().slice(before)).toEqual([['issue', 'view', '1', '--json', 'title,body,state,labels,author']]);
    expect(EDITABLE_FIELDS).toBe('title,body,state,labels,author');
    expect(issue).toEqual({
      ref: githubRef('1'),
      title: 'Replay window',
      body: 'Codes stay valid.\n',
      open: true,
      labels: ['module:auth', 'type:bug', 'priority:urgent'],
      author: 'rafa-fake',
    });
  });

  it('answers the author login and labels the issue holds now, in the order gh wrote them', async () => {
    const { tracker, fake } = await overOneIssue();
    fake.update('1', (issue) => ({ ...issue, author: 'octocat', labels: ['type:spec', 'spec:ready', 'bug'] }));

    expect(await pairOf(tracker).editable(githubRef('1')))
      .toMatchObject({ author: 'octocat', labels: ['type:spec', 'spec:ready', 'bug'] });
  });

  it('reads a ref naming its repository there, refusing another repository the fake does not hold', async () => {
    const { tracker } = await overOneIssue();
    const { editable } = pairOf(tracker);

    expect((await editable(githubRef('1', { repo: 'open-tomato/rafa' }))).title).toBe('Replay window');
    await expect(editable(githubRef('1', { repo: 'open-tomato/other' })))
      .rejects.toThrow('github tracker: gh issue view 1 failed: fake gh: models one repository');
  });

  it('answers a closed issue as closed whatever its reason', async () => {
    const { tracker, fake } = await overOneIssue();
    const { editable } = pairOf(tracker);

    expect((await editable(githubRef('1'))).open).toBe(true);
    fake.update('1', (issue) => ({ ...issue, state: 'CLOSED', stateReason: 'DUPLICATE' }));

    expect((await editable(githubRef('1'))).open).toBe(false);
  });

  it.each([
    ['a merged pull request', { state: 'MERGED' }, 'state "MERGED", expected "OPEN" or "CLOSED"'],
    ['a title that is not a string', { title: null }, 'title null, expected a string'],
    ['a body that is not a string', { body: 7 }, 'body 7, expected a string'],
    ['labels with no names', { labels: [{ id: 'LA_1' }] }, 'labels that are not a list of named labels'],
    ['no author', { author: null }, 'author null, expected a mapping holding a string login'],
    ['an author with no login', { author: { id: 'x' } }, 'author a mapping, expected a mapping holding a string login'],
  ])('refuses a payload holding %s, beside the payload it reads', async (_name, overrides, problem) => {
    const refusing = createGithubTracker({ gh: scripted(wroteJson(viewPayload(overrides))).run });
    const reading = createGithubTracker({ gh: scripted(wroteJson(viewPayload())).run });

    await expect(pairOf(refusing).editable(githubRef('4'))).rejects.toThrow(`github tracker: gh issue view 4 answered ${problem}`);
    expect(await pairOf(reading).editable(githubRef('4'))).toMatchObject({ author: 'vilmibm', labels: ['type:spec'] });
  });

  it('refuses output that is not JSON, naming the command', async () => {
    const tracker = createGithubTracker({ gh: scripted({ ok: true, stdout: 'not json', stderr: '' }).run });

    await expect(pairOf(tracker).editable(githubRef('4'))).rejects.toThrow('github tracker: gh issue view 4 wrote output that is not JSON');
  });

  it('rejects an issue the repository does not hold with what gh wrote', async () => {
    const { tracker } = await overOneIssue();

    await expect(pairOf(tracker).editable(githubRef('9'))).rejects.toThrow(
      'github tracker: gh issue view 9 failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.',
    );
  });
});

describe('editing an issue', () => {
  it('hands the body to gh on stdin through --body-file -, never as an argument', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    await pairOf(tracker).edit(githubRef('1'), { body: BODY });

    expect(fake.calls().slice(before)).toEqual([['issue', 'edit', '1', '--body-file', '-']]);
    expect(fake.inputs().slice(before)).toEqual([BODY]);
    expect(fake.issue('1')).toMatchObject({ title: 'Replay window', body: BODY });
  });

  it('sends a title alone as --title, handing gh no stdin and leaving the body', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    await pairOf(tracker).edit(githubRef('1'), { title: '--help' });

    expect(fake.calls().slice(before)).toEqual([['issue', 'edit', '1', '--title', '--help']]);
    expect(fake.inputs().slice(before)).toEqual([undefined]);
    expect(fake.issue('1')).toMatchObject({ title: '--help', body: 'Codes stay valid.\n' });
  });

  it('sends a title and a body together in one command, with --repo when the ref names one', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    await pairOf(tracker).edit(githubRef('1', { repo: 'open-tomato/rafa' }), { title: 'Narrowed', body: BODY });

    expect(fake.calls().slice(before))
      .toEqual([['issue', 'edit', '1', '--repo', 'open-tomato/rafa', '--title', 'Narrowed', '--body-file', '-']]);
    expect(fake.inputs().slice(before)).toEqual([BODY]);
    expect(fake.issue('1')).toMatchObject({ title: 'Narrowed', body: BODY });
  });

  it('writes an empty body as an empty stdin, which the fake tells from none', async () => {
    const { tracker, fake } = await overOneIssue();

    await pairOf(tracker).edit(githubRef('1'), { body: '' });

    expect(fake.inputs().at(-1)).toBe('');
    expect(fake.issue('1')?.body).toBe('');
  });

  it.each([
    ['naming neither a body nor a title', {}, 'the change names neither a body nor a title'],
    ['holding a body that is not a string', { body: 7 }, 'body is 7, expected a string'],
    ['holding a title that is not a string', { title: null, body: 'b' }, 'title is null, expected a string'],
    ['that is not a mapping', 'body', 'the change is "body", expected a mapping'],
  ])('refuses a change %s, sending nothing, beside the body it sends', async (_name, change, problem) => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;
    const { edit } = pairOf(tracker);

    // Cast: each change is one the port's type rules out, as an untyped caller could still hand over.
    await expect(edit(githubRef('1'), change as unknown as IssueEdit))
      .rejects.toThrow(`github tracker: refused an edit of issue #1: ${problem}`);
    expect(fake.calls()).toHaveLength(before);
    await edit(githubRef('1'), { body: 'sent' });
    expect(fake.calls()).toHaveLength(before + 1);
  });

  it('refuses a ref of another kind, sending nothing, beside the same number as a github ref', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;
    const { edit, editable } = pairOf(tracker);

    await expect(edit(githubRef('1', { kind: 'local' }), { body: BODY })).rejects.toThrow('refused a ref of kind "local"');
    await expect(editable(githubRef('1', { kind: 'local' }))).rejects.toThrow('refused a ref of kind "local"');
    expect(fake.calls()).toHaveLength(before);
    await edit(githubRef('1'), { body: BODY });
    expect(fake.issue('1')?.body).toBe(BODY);
  });

  it('rejects a refused gh issue edit with the command and what gh wrote', async () => {
    const runner = scripted({ ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration\n' });
    const tracker = createGithubTracker({ gh: runner.run });

    await expect(pairOf(tracker).edit(githubRef('4'), { body: BODY }))
      .rejects.toThrow('github tracker: gh issue edit 4 failed: HTTP 403: Resource not accessible by integration');
    expect(runner.calls).toEqual([[['issue', 'edit', '4', '--body-file', '-'], BODY]]);
  });

  it('rejects an edit of an issue the repository does not hold, changing no other issue', async () => {
    const { tracker, fake } = await overOneIssue();

    await expect(pairOf(tracker).edit(githubRef('9'), { body: BODY })).rejects.toThrow(
      'github tracker: gh issue edit 9 failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.',
    );
    expect(fake.issue('1')?.body).toBe('Codes stay valid.\n');
  });
});
