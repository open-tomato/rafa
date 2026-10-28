/**
 * Tests for the `editable` and `edit` pair of the `github` Tracker
 * adapter (`packages/rafa-board/src/adapters/tracker/github-edit.ts`), reached through
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
 *
 * The priority cases arrived on 2026-10-13: the reading held equal to
 * `get`'s, and the swap held to its commands in order, the read, the
 * label made and the one `gh issue edit`. Ten mutations of
 * `github-edit.ts` were driven that day, one run each over
 * `src/adapters/tracker/`, at 500 pass before and after, the module
 * restored byte-identical (sha256) after each, and every one reddened a
 * case here. The triage label never removed reddened 2 and no contract
 * case, since `get` reads a priority past a triage label; a label added
 * though held 2; an empty edit still sent, the comma refusal dropped and
 * the label made without `--repo` 1 each; the priority check dropped its
 * 2 refusal rows. Other priority labels never removed, the label never
 * made, labels removed whether held or not and a null priority answered
 * always reddened contract cases over the fake as well, which refuses a
 * label the repository lacks, one the issue holds, and a removal of one
 * it lacks.
 */
import type { GhResult, GhRunner } from './github.js';
import type { IssueEdit, IssueRef, Tracker } from '@open-tomato/rafa/ports';

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
      priority: 'urgent',
    });
  });

  it.each([
    ['the first of two priority labels', ['priority:low', 'priority:high'], 'low'],
    ['null for a first priority label the port does not name', ['priority:p0', 'priority:high'], null],
    ['null for an issue in triage', ['type:bug', 'needs-triage'], null],
    ['null for an issue holding no label', [], null],
    ['a priority beside the triage label', ['needs-triage', 'priority:medium'], 'medium'],
  ] as const)('answers %s as the priority, as get answers it', async (_name, labels, priority) => {
    const { tracker, fake } = await overOneIssue();
    fake.update('1', (issue) => ({ ...issue, labels: [...labels] }));

    expect((await pairOf(tracker).editable(githubRef('1'))).priority).toBe(priority);
    expect((await tracker.get(githubRef('1'))).priority).toBe(priority);
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
    ['naming no body, no title and no priority', {}, 'the change names no body, no title and no priority'],
    ['holding a priority the port does not name', { priority: 'p0' }, 'priority is "p0", expected one of: urgent, high, medium, low'],
    ['holding a null priority', { priority: null, title: 't' }, 'priority is null, expected one of: urgent, high, medium, low'],
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

  it('reads back a body edited through the adapter byte-identical, CRLF, emoji and trailing spaces included', async () => {
    const { tracker, fake } = await overOneIssue();
    const { edit, editable } = pairOf(tracker);
    const tricky = 'line one  \r\n\r\nemoji 🍅 and café\r\n\ttabbed\n\n';

    await edit(githubRef('1'), { body: tricky });

    expect(fake.inputs().at(-1)).toBe(tricky);
    expect((await editable(githubRef('1'))).body).toBe(tricky);
    expect(fake.issue('1')?.body).toBe(tricky);
  });

  it('surfaces a refused gh issue edit over the fake as a rejected promise, leaving the stored body as it was', async () => {
    const { tracker, fake } = await overOneIssue();
    const { edit, editable } = pairOf(tracker);

    const refused = edit(githubRef('9'), { body: BODY });

    expect(refused).toBeInstanceOf(Promise);
    await expect(refused).rejects.toThrow('github tracker: gh issue edit 9 failed');
    expect((await editable(githubRef('1'))).body).toBe('Codes stay valid.\n');
    expect(fake.issue('1')?.body).toBe('Codes stay valid.\n');
  });

  it('rejects an edit of an issue the repository does not hold, changing no other issue', async () => {
    const { tracker, fake } = await overOneIssue();

    await expect(pairOf(tracker).edit(githubRef('9'), { body: BODY })).rejects.toThrow(
      'github tracker: gh issue edit 9 failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.',
    );
    expect(fake.issue('1')?.body).toBe('Codes stay valid.\n');
  });
});

describe('editing an issue\'s priority', () => {
  /** The view `edit` reads the held labels with, for issue 1. */
  const VIEW = ['issue', 'view', '1', '--json', EDITABLE_FIELDS];

  it('swaps a priority in one gh issue edit, after reading the labels and making the new one', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    await pairOf(tracker).edit(githubRef('1'), { priority: 'low' });

    expect(fake.calls().slice(before)).toEqual([
      VIEW,
      ['label', 'create', 'priority:low', '--force'],
      ['issue', 'edit', '1', '--add-label', 'priority:low', '--remove-label', 'priority:urgent'],
    ]);
    expect(fake.inputs().slice(before)).toEqual([undefined, undefined, undefined]);
    expect(fake.issue('1')).toMatchObject({ title: 'Replay window', body: 'Codes stay valid.\n' });
    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'priority:low']);
  });

  it('takes an issue out of triage in the same edit, removing needs-triage', async () => {
    const fake = createFakeGh();
    const tracker = createGithubTracker({ gh: fake.run });
    await tracker.create(draftFixture({ opt: 0, module: 'auth', priority: null }));
    const before = fake.calls().length;

    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'needs-triage']);
    await pairOf(tracker).edit(githubRef('1'), { priority: 'high' });

    const sent = fake.calls().slice(before);
    expect(sent.at(-1)).toEqual(['issue', 'edit', '1', '--add-label', 'priority:high', '--remove-label', 'needs-triage']);
    expect(sent.filter(([, verb]) => verb === 'edit')).toHaveLength(1);
    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'priority:high']);
  });

  it('removes every other priority label and needs-triage, of those held, adding no label held already', async () => {
    const { tracker, fake } = await overOneIssue();
    fake.update('1', (issue) => ({ ...issue, labels: ['priority:low', 'type:bug', 'needs-triage', 'priority:p0', 'priority:high'] }));
    const before = fake.calls().length;

    await pairOf(tracker).edit(githubRef('1'), { priority: 'high' });

    expect(fake.calls().slice(before)).toEqual([
      VIEW,
      ['issue', 'edit', '1', '--remove-label', 'priority:low', '--remove-label', 'needs-triage', '--remove-label', 'priority:p0'],
    ]);
    expect(fake.issue('1')?.labels).toEqual(['type:bug', 'priority:high']);
  });

  it('sends no gh issue edit for a priority held already, alone and out of triage, beside a title it still sends', async () => {
    const { tracker, fake } = await overOneIssue();
    const { edit } = pairOf(tracker);
    const before = fake.calls().length;

    await edit(githubRef('1'), { priority: 'urgent' });

    expect(fake.calls().slice(before)).toEqual([VIEW]);
    await edit(githubRef('1'), { priority: 'urgent', title: 'Narrowed' });

    expect(fake.calls().slice(before + 1)).toEqual([VIEW, ['issue', 'edit', '1', '--title', 'Narrowed']]);
    expect(fake.issue('1')).toMatchObject({ title: 'Narrowed', labels: ['module:auth', 'type:bug', 'priority:urgent'] });
  });

  it('sends a priority beside a title and a body in one command, with --repo on the read, the label and the edit', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;
    const repo = ['--repo', 'open-tomato/rafa'];

    await pairOf(tracker).edit(githubRef('1', { repo: 'open-tomato/rafa' }), { title: 'Narrowed', body: BODY, priority: 'medium' });

    expect(fake.calls().slice(before)).toEqual([
      ['issue', 'view', '1', ...repo, '--json', EDITABLE_FIELDS],
      ['label', 'create', 'priority:medium', ...repo, '--force'],
      [
        'issue',
        'edit',
        '1',
        ...repo,
        '--title',
        'Narrowed',
        '--body-file',
        '-',
        '--add-label',
        'priority:medium',
        '--remove-label',
        'priority:urgent',
      ],
    ]);
    expect(fake.inputs().slice(before)).toEqual([undefined, undefined, BODY]);
    expect(fake.issue('1')).toMatchObject({ title: 'Narrowed', body: BODY, labels: ['module:auth', 'type:bug', 'priority:medium'] });
  });

  it('refuses a swap naming a held label that holds a comma, sending nothing after the read, beside one it sends', async () => {
    const { tracker, fake } = await overOneIssue();
    const { edit } = pairOf(tracker);
    fake.update('1', (issue) => ({ ...issue, labels: ['priority:low,bug', 'bug'] }));
    const before = fake.calls().length;

    await expect(edit(githubRef('1'), { priority: 'high' })).rejects.toThrow(
      'github tracker: refused an edit of issue #1: it holds the label "priority:low,bug",'
      + ' and a label holding a comma cannot be named to gh issue edit',
    );
    expect(fake.calls().slice(before)).toEqual([VIEW]);
    expect(fake.issue('1')?.labels).toEqual(['priority:low,bug', 'bug']);
    fake.update('1', (issue) => ({ ...issue, labels: ['priority:low', 'bug'] }));
    await edit(githubRef('1'), { priority: 'high' });

    expect(fake.issue('1')?.labels).toEqual(['bug', 'priority:high']);
  });

  it('rejects with nothing edited when the label cannot be made, beside the edit sent once it can', async () => {
    const { fake } = await overOneIssue();
    let refusesLabels = true;
    const gh: GhRunner = async (args, stdin) => (refusesLabels && args[0] === 'label'
      ? { ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration\n' }
      : fake.run(args, stdin));
    const { edit } = pairOf(createGithubTracker({ gh }));
    const before = fake.calls().length;

    await expect(edit(githubRef('1'), { priority: 'low' }))
      .rejects.toThrow('github tracker: gh label create "priority:low" failed: HTTP 403: Resource not accessible by integration');
    expect(fake.calls().slice(before)).toEqual([VIEW]);
    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'priority:urgent']);
    refusesLabels = false;
    await edit(githubRef('1'), { priority: 'low' });

    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'priority:low']);
  });

  it('rejects a priority edit of an issue the repository does not hold at its read, sending no edit', async () => {
    const { tracker, fake } = await overOneIssue();
    const before = fake.calls().length;

    await expect(pairOf(tracker).edit(githubRef('9'), { priority: 'low' })).rejects.toThrow(
      'github tracker: gh issue view 9 failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.',
    );
    expect(fake.calls().slice(before)).toEqual([['issue', 'view', '9', '--json', EDITABLE_FIELDS]]);
    expect(fake.issue('1')?.labels).toEqual(['module:auth', 'type:bug', 'priority:urgent']);
  });
});
