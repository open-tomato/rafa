/**
 * Tests for the native relationship fields of the board listing
 * (`src/board/roadmap-board.ts`): what `parseBoardListing` reads in the
 * `native` mode, the truncation reading it keeps, what it refuses, and
 * that the `labels` mode leaves every native key out.
 *
 * Every node is planted in the shape `gh issue list --json` answered on
 * 2026-09-30 with `gh` 2.100.0 (`id`, `number`, `state`, `title`, `url`,
 * no `repository`). Each refusal sits beside a control proving the same
 * row reads when the one field under test is well formed, so a parser
 * that refused everything would fail the control rather than pass the
 * refusal. Key sets are asserted with `Object.keys`, since `toEqual`
 * does not tell a left-out key from one set to undefined.
 */
import { describe, expect, it } from 'bun:test';

import { parseBoardListing } from './roadmap-board.js';

/** The command every refusal here names. */
const COMMAND = 'gh issue list (native)';

/** The repository the planted board lives in. */
const HOME = 'acme/board';

/** A second repository, for a foreign blocker. */
const ELSEWHERE = 'acme/other';

/** The keys a labels-mode issue has, in order. */
const LABELS_KEYS = ['number', 'title', 'body', 'state', 'stateReason', 'labels', 'type', 'module'];

/** The keys a native-mode issue has, in order. */
const NATIVE_KEYS = [...LABELS_KEYS, 'parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'];

/** A linked issue node as `gh issue list --json` answers it. */
function node(number: number, state = 'OPEN', repository = HOME): Record<string, unknown> {
  return {
    id: `I_node${number}`,
    number,
    state,
    title: `issue ${number}`,
    url: `https://github.com/${repository}/issues/${number}`,
  };
}

/** A relationship list over `nodes`, its `totalCount` their number unless named. */
function links(nodes: readonly unknown[], totalCount: number = nodes.length): Record<string, unknown> {
  return { nodes, totalCount };
}

/** A well-formed native row with no links, with `overrides` laid over it. */
function row(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'the board listing',
    body: 'body',
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:code' }],
    parent: null,
    blockedBy: links([]),
    blocking: links([]),
    subIssuesSummary: { completed: 0, percentCompleted: 0, total: 0 },
    subIssues: links([]),
    ...overrides,
  };
}

/** `rows` read in the native mode. */
function native(rows: readonly unknown[]): ReturnType<typeof parseBoardListing> {
  return parseBoardListing(JSON.stringify(rows), COMMAND, 'native');
}

/** The one issue `rows` reads as in the native mode. */
function nativeOne(overrides: Readonly<Record<string, unknown>>): NonNullable<ReturnType<typeof parseBoardListing>[number]> {
  const [issue] = native([row(overrides)]);
  if (issue === undefined) throw new Error('the planted row read as no issue');
  return issue;
}

/** `count` open nodes numbered from 100. */
function manyNodes(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => node(100 + index));
}

describe('the labels mode', () => {
  it('leaves every native key out, even when the row carries them', () => {
    const planted = JSON.stringify([row({ parent: node(3), blockedBy: links([node(4)]) })]);

    const [byDefault] = parseBoardListing(planted, COMMAND);
    const [named] = parseBoardListing(planted, COMMAND, 'labels');

    expect(Object.keys(byDefault ?? {})).toEqual(LABELS_KEYS);
    expect(Object.keys(named ?? {})).toEqual(LABELS_KEYS);
  });

  it('reads a row with no native field, which the native mode refuses', () => {
    const bare = row();
    for (const key of ['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues']) delete bare[key];

    expect(parseBoardListing(JSON.stringify([bare]), COMMAND)).toHaveLength(1);
    expect(() => native([bare])).toThrow(`board listing: ${COMMAND} answered row 0 with parent undefined`);
  });
});

describe('the native mode', () => {
  it('reads the five fields, each linked issue as number, title, state and repository', () => {
    const issue = nativeOne({
      parent: node(3),
      blockedBy: links([node(4, 'CLOSED'), node(1, 'OPEN', ELSEWHERE)]),
      blocking: links([node(9)]),
      subIssuesSummary: { completed: 1, percentCompleted: 50, total: 2 },
      subIssues: links([node(11, 'CLOSED'), node(12)]),
    });

    expect(Object.keys(issue)).toEqual(NATIVE_KEYS);
    expect(issue.parent).toEqual({ number: 3, title: 'issue 3', state: 'OPEN', repository: HOME });
    expect(issue.blockedBy).toEqual({
      nodes: [
        { number: 4, title: 'issue 4', state: 'CLOSED', repository: HOME },
        { number: 1, title: 'issue 1', state: 'OPEN', repository: ELSEWHERE },
      ],
    });
    expect(issue.blocking?.nodes.map((link) => link.number)).toEqual([9]);
    expect(issue.subIssuesSummary).toEqual({ total: 2, completed: 1, percentCompleted: 50 });
    expect(issue.subIssues?.nodes.map((link) => link.state)).toEqual(['CLOSED', 'OPEN']);
  });

  it('keeps no node key beyond the four it reads', () => {
    const issue = nativeOne({ parent: node(3) });

    expect(Object.keys(issue.parent ?? {})).toEqual(['number', 'title', 'state', 'repository']);
  });

  it('reads a null parent as null, keeping the key', () => {
    const issue = nativeOne({ parent: null });

    expect(issue.parent).toBeNull();
    expect(Object.keys(issue)).toContain('parent');
  });

  it('keeps the sub-issues in the order gh answered, not by number', () => {
    const issue = nativeOne({ subIssues: links([node(10), node(7), node(9), node(8)]) });

    expect(issue.subIssues?.nodes.map((link) => link.number)).toEqual([10, 7, 9, 8]);
  });

  it('reads a repository off a URL on another host', () => {
    const enterprise = { ...node(4), url: 'https://ghe.example.com/team/repo/issues/4' };

    const issue = nativeOne({ blockedBy: links([enterprise]) });

    expect(issue.blockedBy?.nodes[0]?.repository).toBe('team/repo');
  });
});

describe('the truncation reading', () => {
  it.each([
    ['blockedBy', 50, 73],
    ['blocking', 50, 51],
    ['subIssues', 100, 130],
  ] as const)('keeps %s truncated at the total when %d nodes answer a totalCount of %d', (field, answered, total) => {
    const issue = nativeOne({ [field]: links(manyNodes(answered), total) });

    expect(issue[field]?.nodes).toHaveLength(answered);
    expect(issue[field]?.truncated).toEqual({ total });
  });

  it.each(['blockedBy', 'blocking', 'subIssues'] as const)('leaves truncated out of %s when totalCount equals the nodes', (field) => {
    const issue = nativeOne({ [field]: links(manyNodes(50)) });

    expect(Object.keys(issue[field] ?? {})).toEqual(['nodes']);
  });

  it('refuses a totalCount below the nodes answered', () => {
    expect(() => native([row({ blockedBy: links([node(4), node(5)], 1) })]))
      .toThrow(`board listing: ${COMMAND} answered row 0 with blockedBy.totalCount 1, expected a whole number no less than the 2 nodes answered`);
  });
});

describe('what the native mode refuses', () => {
  it.each(['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'])('refuses a row lacking %s, naming the row', (field) => {
    const lacking = row({ number: 8 });
    delete lacking[field];

    expect(native([row()])).toHaveLength(1);
    expect(() => native([row(), lacking])).toThrow(`board listing: ${COMMAND} answered row 1 with ${field} undefined`);
  });

  it.each([
    ['a parent that is a list', { parent: [] }, 'parent a list, expected null or a mapping'],
    ['nodes that are not a list', { blocking: { nodes: {}, totalCount: 0 } }, 'blocking.nodes a mapping, expected a list'],
    ['a missing totalCount', { subIssues: { nodes: [] } }, 'subIssues.totalCount undefined'],
    ['a node that is not a mapping', { blockedBy: links([4]) }, 'blockedBy.nodes[0] 4, expected a mapping'],
    ['a node number that is not whole', { blockedBy: links([{ ...node(4), number: 4.5 }]) }, 'blockedBy.nodes[0].number 4.5'],
    ['a node without a title', { parent: { ...node(3), title: null } }, 'parent.title null, expected a string'],
    ['a node state gh does not answer', { subIssues: links([node(11, 'open')]) }, 'subIssues.nodes[0].state "open"'],
    ['a node without a URL', { blockedBy: links([{ ...node(4), url: undefined }]) }, 'blockedBy.nodes[0].url undefined, expected the URL of issue 4'],
    ['a URL that is not an issue', { blockedBy: links([{ ...node(4), url: 'https://github.com/acme/board/pull/4' }]) }, 'blockedBy.nodes[0].url "https://github.com/acme/board/pull/4"'],
    ['a URL naming another issue', { parent: { ...node(3), url: 'https://github.com/acme/board/issues/30' } }, 'parent.url "https://github.com/acme/board/issues/30", expected the URL of issue 3'],
    ['a summary that is a list', { subIssuesSummary: [] }, 'subIssuesSummary a list, expected a mapping'],
    ['a negative total', { subIssuesSummary: { completed: 0, percentCompleted: 0, total: -1 } }, 'subIssuesSummary.total -1'],
    ['more completed than total', { subIssuesSummary: { completed: 3, percentCompleted: 100, total: 2 } }, 'subIssuesSummary.completed 3, expected a whole number from 0 to 2'],
    ['a percentage above 100', { subIssuesSummary: { completed: 1, percentCompleted: 101, total: 1 } }, 'subIssuesSummary.percentCompleted 101'],
  ] as const)('refuses %s', (_, overrides, problem) => {
    expect(native([row()])).toHaveLength(1);
    expect(() => native([row(overrides)])).toThrow(`board listing: ${COMMAND} answered row 0 with ${problem}`);
  });

  it('checks the labels-mode fields first', () => {
    expect(() => native([row({ title: 3, parent: [] })])).toThrow(`board listing: ${COMMAND} answered row 0 with title 3, expected a string`);
  });
});
