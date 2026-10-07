/**
 * Tests for the facts reader (`facts.ts`, `readIssueFacts`), each read
 * through the strict fake `gh` of `facts-fake.ts`, which answers the
 * shapes recorded off `gh` 2.100.0 on 2026-10-06.
 *
 * ## The controls
 *
 *  - Every pull request found is read beside one that is NOT: a body that
 *    mentions the issue with no keyword, a keyword naming a longer number
 *    or another repository, a pull request of another repository, and one
 *    closed without merging. A reader taking every cross-reference fails.
 *  - Every fragment found is read beside files that are not one: modified,
 *    in a subdirectory, of another name, or outside the directory.
 *  - Each `onBase` true is read beside the same fragment missing from the
 *    base, so a reader answering true for every fragment fails.
 *  - The files beyond the first page hold the only fragment, so a reader
 *    stopping at one page answers none.
 */
import type { FakeFactsIssue, FakeFactsPull, FakePullFile } from './facts-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createFakeFactsGh, FAKE_REPOSITORY } from './facts-fake.js';
import { blobsArgs, issuesArgs, PAGE_SIZE } from './facts-query.js';
import { bodyCloses, readIssueFacts, UNREAD_LEVEL } from './facts.js';
import { stageOf } from './rules.js';

/** The fragments directory every case reads but the one that sets its own. */
const FRAGMENTS = '.changes';

/** A fragment's text at `level`. */
function fragmentText(level: string): string {
  return `---\nplan: rafa-1\ntitle: One plan\nlevel: ${level}\n---\n\n- loop: a note\n`;
}

/** A pull request with the given changes, merged into `main` unless said. */
function pull(number: number, overrides: Partial<FakeFactsPull> = {}): FakeFactsPull {
  return { number, state: 'MERGED', baseRefName: 'main', headRefOid: `head${String(number)}`, body: '', files: [], ...overrides };
}

/** A file `ADDED` at `path`. */
function added(path: string): FakePullFile {
  return { path, changeType: 'ADDED' };
}

/** Reads the facts of `numbers` over a fake planted with `issues`, `pulls` and `trees`. */
async function read(
  planted: { issues: readonly FakeFactsIssue[]; pulls?: readonly FakeFactsPull[]; trees?: Record<string, Record<string, string>> },
  numbers: readonly number[],
  fragments = FRAGMENTS,
) {
  const fake = createFakeFactsGh({ issues: planted.issues, pulls: planted.pulls ?? [], trees: planted.trees ?? {} });
  const facts = await readIssueFacts({ gh: fake.gh, fragments }, numbers);
  return { facts, calls: fake.calls() };
}

describe('bodyCloses', () => {
  it('answers false for a mention with no keyword, a longer number and another repository', () => {
    expect(bodyCloses('See #821 and #8210', 821, FAKE_REPOSITORY)).toBe(false);
    expect(bodyCloses('Closes #8210', 821, FAKE_REPOSITORY)).toBe(false);
    expect(bodyCloses('Closes acme/other#821', 821, FAKE_REPOSITORY)).toBe(false);
    expect(bodyCloses('Enclosed #821', 821, FAKE_REPOSITORY)).toBe(false);
  });

  it.each([
    'Closes #821',
    'close #821',
    'CLOSED #821',
    'fix #821',
    'Fixes: #821',
    'fixed #821',
    'Resolve #821',
    'resolves #821',
    'resolved #821',
    'Closes #12\nCloses #821',
    'Closes open-tomato/rafa#821',
    'Closes Open-Tomato/Rafa#821',
  ])('answers true for %j', (body) => {
    expect(bodyCloses(body, 821, FAKE_REPOSITORY)).toBe(true);
  });
});

describe('readIssueFacts: an issue', () => {
  it('reads state, close reason and labels, and sends no file read when no pull request closes it', async () => {
    const { facts, calls } = await read({
      issues: [{ number: 7, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec', 'spec:ready'], issueMentions: 2 }],
    }, [7]);

    expect(facts.get(7)).toEqual({
      number: 7,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      labels: ['type:spec', 'spec:ready'],
      pullRequests: [],
    });
    expect(calls).toHaveLength(1);
  });

  it('reads an open issue with no close reason as null', async () => {
    const { facts } = await read({ issues: [{ number: 3, state: 'OPEN' }] }, [3]);

    expect(facts.get(3)?.stateReason).toBeNull();
    expect(facts.get(3)?.state).toBe('OPEN');
  });

  it('reads a number given twice once, and batches past the issue batch', async () => {
    const issues = Array.from({ length: 21 }, (_, index) => ({ number: index + 1, state: 'OPEN' as const }));
    const { facts, calls } = await read({ issues }, [...issues.map(({ number }) => number), 1]);

    expect(facts.size).toBe(21);
    expect(calls).toHaveLength(2);
  });
});

describe('readIssueFacts: the pull requests that close an issue', () => {
  it('leaves out every pull request whose mention does not close the issue, and one closed unmerged', async () => {
    const { facts } = await read({
      issues: [{
        number: 821,
        state: 'OPEN',
        closedBy: [5],
        mentions: [{ pull: 1 }, { pull: 2 }, { pull: 3 }, { pull: 4, crossRepository: true }],
        issueMentions: 1,
      }],
      pulls: [
        pull(1, { body: 'See #821' }),
        pull(2, { body: 'Closes #8210' }),
        pull(3, { body: 'Closes acme/other#821' }),
        pull(4, { body: 'Closes #821' }),
        pull(5, { state: 'CLOSED' }),
      ],
    }, [821]);

    expect(facts.get(821)?.pullRequests).toEqual([]);
  });

  it('finds a pull request merged into an integration branch by the keyword in its body', async () => {
    const { facts } = await read({
      issues: [{ number: 821, state: 'OPEN', mentions: [{ pull: 850 }, { pull: 2 }] }],
      pulls: [pull(850, { baseRefName: 'stretch/4', body: 'Closes #821\n\nCloses #782' }), pull(2, { body: 'See #821' })],
    }, [821]);

    expect(facts.get(821)?.pullRequests.map(({ number, state, baseRefName }) => ({ number, state, baseRefName }))).toEqual([
      { number: 850, state: 'MERGED', baseRefName: 'stretch/4' },
    ]);
  });

  it('takes the union of linked and mentioned pull requests, each once, by number ascending', async () => {
    const { facts } = await read({
      issues: [{ number: 9, state: 'OPEN', closedBy: [30, 10], mentions: [{ pull: 20 }, { pull: 10 }] }],
      pulls: [pull(30, { state: 'OPEN' }), pull(10), pull(20, { body: 'Fixes #9' })],
    }, [9]);

    expect(facts.get(9)?.pullRequests.map(({ number, state }) => [number, state])).toEqual([[10, 'MERGED'], [20, 'MERGED'], [30, 'OPEN']]);
  });

  it('reads the files of a pull request two issues share once', async () => {
    const { facts, calls } = await read({
      issues: [{ number: 1, state: 'CLOSED', closedBy: [5] }, { number: 2, state: 'CLOSED', closedBy: [5] }],
      pulls: [pull(5)],
    }, [1, 2]);

    expect(facts.get(1)?.pullRequests[0]?.number).toBe(5);
    expect(facts.get(2)?.pullRequests[0]?.number).toBe(5);
    expect(calls.filter((args) => args.join(' ').includes('pullRequest(number: 5)'))).toHaveLength(1);
  });
});

describe('readIssueFacts: the fragment a pull request added', () => {
  /** An issue closed by pull request 5, which changed `files`, over `trees`. */
  function closedBy(files: readonly FakePullFile[], trees: Record<string, Record<string, string>>) {
    return { issues: [{ number: 1, state: 'CLOSED' as const, stateReason: 'COMPLETED', closedBy: [5] }], pulls: [pull(5, { files })], trees };
  }

  it('finds no fragment among files modified, nested, misnamed or outside the directory', async () => {
    const text = fragmentText('patch');
    const { facts, calls } = await read(closedBy([
      { path: '.changes/old.md', changeType: 'MODIFIED' },
      added('.changes/nested/one.md'),
      added('.changes/one.txt'),
      added('.changes/has space.md'),
      added('other/one.md'),
    ], { head5: { '.changes/old.md': text, '.changes/nested/one.md': text } }), [1]);

    expect(facts.get(1)?.pullRequests[0]?.fragments).toEqual([]);
    expect(facts.get(1)?.pullRequests[0]?.fragment).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('reads a fragment still on the base as onBase, and its level from the head', async () => {
    const path = '.changes/rafa-1.md';
    const { facts } = await read(closedBy([added(path)], { head5: { [path]: fragmentText('minor') }, main: { [path]: fragmentText('minor') } }), [1]);
    const issue = facts.get(1);

    expect(issue?.pullRequests[0]?.fragment).toEqual({ path, level: 'minor', onBase: true, problem: null });
    expect(issue === undefined
      ? null
      : stageOf(issue)).toBe('In review');
  });

  it('reads a fragment the base no longer holds, folded by settle, as not on the base', async () => {
    const path = '.changes/rafa-1.md';
    const { facts } = await read(closedBy([added(path)], { head5: { [path]: fragmentText('minor') }, main: {} }), [1]);
    const issue = facts.get(1);

    expect(issue?.pullRequests[0]?.fragment).toEqual({ path, level: 'minor', onBase: false, problem: null });
    expect(issue === undefined
      ? null
      : stageOf(issue)).toBe('Done');
  });

  it('reads `level: none` as it is written', async () => {
    const path = '.changes/rafa-1.md';
    const { facts } = await read(closedBy([added(path)], { head5: { [path]: fragmentText('none') }, main: { [path]: fragmentText('none') } }), [1]);

    expect(facts.get(1)?.pullRequests[0]?.fragment?.level).toBe('none');
  });

  it('reads a fragment that does not parse, or is missing at the head, as the least shipping level with its problem', async () => {
    const { facts } = await read(closedBy(
      [added('.changes/a.md'), added('.changes/b.md')],
      { head5: { '.changes/a.md': 'no front matter' }, main: {} },
    ), [1]);
    const [broken, missing] = facts.get(1)?.pullRequests[0]?.fragments ?? [];

    expect(broken?.level).toBe(UNREAD_LEVEL);
    expect(broken?.problem).toContain('does not open with');
    expect(missing?.level).toBe(UNREAD_LEVEL);
    expect(missing?.problem).toContain('could not be read at the head');
  });

  it('holds every fragment by path, and Stage reads the first that ships and is on the base', async () => {
    const none = fragmentText('none');
    const patch = fragmentText('patch');
    const { facts } = await read(closedBy(
      [added('.changes/c.md'), added('.changes/a.md'), added('.changes/b.md')],
      { head5: { '.changes/a.md': none, '.changes/b.md': patch, '.changes/c.md': patch }, main: { '.changes/a.md': none, '.changes/c.md': patch } },
    ), [1]);
    const read5 = facts.get(1)?.pullRequests[0];

    expect(read5?.fragments.map(({ path }) => path)).toEqual(['.changes/a.md', '.changes/b.md', '.changes/c.md']);
    expect(read5?.fragment?.path).toBe('.changes/c.md');
  });

  it('reads a fragment of the directory `release.fragments` names', async () => {
    const path = 'notes/rafa-1.md';
    const { facts } = await read(
      closedBy([added(path), added('.changes/rafa-2.md')], { head5: { [path]: fragmentText('patch'), '.changes/rafa-2.md': fragmentText('patch') } }),
      [1],
      './notes/',
    );

    expect(facts.get(1)?.pullRequests[0]?.fragments.map(({ path: found }) => found)).toEqual([path]);
  });

  it('reads the files past the first page', async () => {
    const path = '.changes/rafa-1.md';
    const filler = Array.from({ length: PAGE_SIZE + 50 }, (_, index): FakePullFile => ({ path: `src/f${String(index)}.ts`, changeType: 'MODIFIED' }));
    const { facts, calls } = await read(closedBy([...filler, added(path)], { head5: { [path]: fragmentText('patch') } }), [1]);

    expect(facts.get(1)?.pullRequests[0]?.fragments.map(({ path: found }) => found)).toEqual([path]);
    expect(calls.filter((args) => args.some((arg) => arg.startsWith('c5=')))).toHaveLength(1);
  });
});

describe('readIssueFacts: the Stage edge cases, read through the fake', () => {
  it('reads a pull request merged into an integration branch, its fragment on that branch, as In review', async () => {
    const path = '.changes/rafa-821.md';
    const { facts, calls } = await read({
      issues: [{ number: 821, state: 'OPEN', mentions: [{ pull: 850 }] }],
      pulls: [pull(850, { baseRefName: 'stretch/4', body: 'Closes #821', files: [added(path)] })],
      trees: { head850: { [path]: fragmentText('minor') }, 'stretch/4': { [path]: fragmentText('minor') } },
    }, [821]);
    const issue = facts.get(821);

    expect(issue?.pullRequests).toEqual([
      expect.objectContaining({ number: 850, state: 'MERGED', baseRefName: 'stretch/4' }),
    ]);
    expect(issue?.pullRequests[0]?.fragment).toEqual({ path, level: 'minor', onBase: true, problem: null });
    expect(issue && stageOf(issue)).toBe('In review');
    expect(calls.some((args) => args.join(' ').includes('stretch/4:' + path))).toBe(true);
  });

  it('keeps an open issue In review when its integration-branch pull request added a shipping fragment, even after settle has folded it off that branch', async () => {
    const path = '.changes/rafa-821.md';
    const { facts } = await read({
      issues: [{ number: 821, state: 'OPEN', mentions: [{ pull: 850 }] }],
      pulls: [pull(850, { baseRefName: 'stretch/4', body: 'Closes #821', files: [added(path)] })],
      trees: { head850: { [path]: fragmentText('minor') }, 'stretch/4': {} },
    }, [821]);
    const issue = facts.get(821);

    expect(issue?.pullRequests[0]?.fragment).toEqual({ path, level: 'minor', onBase: false, problem: null });
    expect(issue && stageOf(issue)).toBe('In review');
  });

  it('reads a pull request whose body only mentions the issue as no close, so the issue stays Backlog', async () => {
    const path = '.changes/rafa-821.md';
    const { facts } = await read({
      issues: [{ number: 821, state: 'OPEN', mentions: [{ pull: 850 }] }],
      pulls: [pull(850, { baseRefName: 'stretch/4', body: 'Works toward #821', files: [added(path)] })],
      trees: { head850: { [path]: fragmentText('minor') }, 'stretch/4': { [path]: fragmentText('minor') } },
    }, [821]);
    const issue = facts.get(821);

    expect(issue?.pullRequests).toEqual([]);
    expect(issue && stageOf(issue)).toBe('Backlog');
  });

  it('reads an issue closed by hand with no pull request as Done, sending no file or blob read', async () => {
    const { facts, calls } = await read({
      issues: [{ number: 7, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['spec:ready'] }],
    }, [7]);
    const issue = facts.get(7);

    expect(issue?.pullRequests).toEqual([]);
    expect(issue && stageOf(issue)).toBe('Done');
    expect(calls).toHaveLength(1);
  });

  it('reads an issue closed as not planned with no pull request as Cancelled', async () => {
    const { facts } = await read({
      issues: [{ number: 8, state: 'CLOSED', stateReason: 'NOT_PLANNED' }],
    }, [8]);
    const issue = facts.get(8);

    expect(issue?.pullRequests).toEqual([]);
    expect(issue && stageOf(issue)).toBe('Cancelled');
  });
});

describe('readIssueFacts: refusals', () => {
  /** A runner answering `answer` to every call. */
  function answering(answer: GhResult): GhRunner {
    return () => Promise.resolve(answer);
  }

  it('throws naming what gh said when the call fails', async () => {
    const fake = createFakeFactsGh({ issues: [{ number: 1, state: 'OPEN' }] });
    fake.failNext('gh: Your token has not been granted the required scopes');

    await expect(readIssueFacts({ gh: fake.gh, fragments: FRAGMENTS }, [1])).rejects.toThrow('required scopes');
  });

  it('throws on an issue the repository does not hold', async () => {
    const fake = createFakeFactsGh({ issues: [] });

    await expect(readIssueFacts({ gh: fake.gh, fragments: FRAGMENTS }, [1])).rejects.toThrow('no issue #1');
  });

  it('throws on a list longer than one page, naming the issue and the key', async () => {
    const issue = {
      number: 1,
      state: 'OPEN',
      stateReason: null,
      labels: { pageInfo: { hasNextPage: true }, nodes: [] },
      closedByPullRequestsReferences: { pageInfo: { hasNextPage: false }, nodes: [] },
      timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] },
    };
    const gh = answering({ ok: true, stdout: JSON.stringify({ data: { repository: { nameWithOwner: FAKE_REPOSITORY, i1: issue } } }), stderr: '' });

    await expect(readIssueFacts({ gh, fragments: FRAGMENTS }, [1])).rejects.toThrow('issue #1.labels holds more than 100 entries');
  });

  it('throws on an answer that is not JSON', async () => {
    await expect(readIssueFacts({ gh: answering({ ok: true, stdout: 'oops', stderr: '' }), fragments: FRAGMENTS }, [1])).rejects.toThrow('not JSON');
  });
});

describe('the query argv', () => {
  it('carries a branch and a path as variables, never in the query text', () => {
    const args = blobsArgs([{ path: '.changes/a"b.md', headRefOid: 'abc', baseRefName: 'stretch/4' }]);
    const query = args.find((arg) => arg.startsWith('query=')) ?? '';

    expect(query).not.toContain('a"b');
    expect(args).toContain('h0=abc:.changes/a"b.md');
    expect(args).toContain('b0=stretch/4:.changes/a"b.md');
  });

  it('refuses a number that is not a positive whole number', () => {
    expect(() => issuesArgs([0])).toThrow(RangeError);
  });
});
