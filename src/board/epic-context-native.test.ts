/**
 * Unit tests for `./epic-context.ts` in `native` mode: the epic is the
 * spec issue's sub-issue `parent`, read through the port over the board
 * listing, and no `epic:` label and no `--label` list is read or sent.
 * The `labels` cases stay in `./epic-context.test.ts`.
 *
 * Every `gh` answer is planted; nothing spawns.
 *
 * ## The controls
 *
 *  - The spec issue carries an `epic:` label naming ANOTHER epic, and
 *    the same options read with no port must look that one up by
 *    `--label`, so a native reading that fell back to the label fails.
 *  - A listing handed in costs no `gh` call, beside the same lookup
 *    without one, which must send exactly the native board listing.
 *  - An issue with no parent is silent, beside a parent that is no epic,
 *    which must warn.
 */
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { epicContextArgs, readEpicContext } from './epic-context.js';
import { createNativeRelations } from './relations/native.js';
import { nativeBoardListFields } from './roadmap-board.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** An epic body with a criteria section. */
const EPIC_BODY = '## Acceptance criteria\n\n- The planner sees the epic.\n';

/** The criteria {@link EPIC_BODY} holds. */
const EPIC_CRITERIA = '- The planner sees the epic.';

/** The native board listing's argv, written out. */
const LISTING_ARGS = ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', nativeBoardListFields];

/** A fake gh answering `result` to every call and recording each. */
function fakeGh(result: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve(result);
  };
  return { gh, calls };
}

/** An Output keeping its warnings. */
function capture(): { warnings: string[]; output: ReturnType<typeof sinkOutput> } {
  const warnings: string[] = [];
  return {
    warnings,
    output: sinkOutput({
      warn: (message) => {
        warnings.push(message);
      },
    }),
  };
}

/** Issue `number` on `repository` as a link node names it. */
function link(number: number, repository: string = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state: 'OPEN', repository };
}

/** A native row, its type read from its labels. */
function row(number: number, labels: readonly string[], parent: BoardIssueLink | null, body = ''): BoardIssue {
  const none = { nodes: [] };
  return {
    number,
    title: `issue ${String(number)}`,
    body,
    state: 'OPEN',
    stateReason: null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent,
    blockedBy: none,
    blocking: none,
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: none,
  };
}

/** The same row as `gh issue list --json <native fields>` writes it. */
function written(issue: BoardIssue): Record<string, unknown> {
  const none = { nodes: [], totalCount: 0 };
  const parent = issue.parent ?? null;
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: '',
    labels: issue.labels.map((name) => ({ name })),
    parent: parent === null
      ? null
      : {
        number: parent.number,
        title: parent.title,
        state: parent.state,
        url: `https://github.com/${parent.repository}/issues/${String(parent.number)}`,
      },
    blockedBy: none,
    blocking: none,
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: none,
  };
}

/**
 * Epic #40 is spec #7's parent; epic #50 carries `epic:auth`, the label
 * #7 also carries, and holds no sub-issue.
 */
function board(parent: BoardIssueLink | null = link(40)): readonly BoardIssue[] {
  return [
    row(7, ['type:spec', 'epic:auth'], parent),
    row(40, ['type:epic', 'horizon:now'], null, EPIC_BODY),
    row(50, ['type:epic', 'epic:auth', 'horizon:next'], null, EPIC_BODY),
    row(60, ['type:spec'], null),
  ];
}

/** Reads #7's epic in `native` mode over `listing`, or over a listing `gh` answers `answer` for. */
async function lookUp(options: {
  readonly listing?: readonly BoardIssue[];
  readonly answer?: GhResult;
} = {}): Promise<{ context: Awaited<ReturnType<typeof readEpicContext>>; calls: (readonly string[])[]; warnings: string[] }> {
  const { gh, calls } = fakeGh(options.answer ?? { ok: true, stdout: JSON.stringify(board().map(written)), stderr: '' });
  const { output, warnings } = capture();
  const relations = createNativeRelations({ gh, repository: BOARD });
  const base = { issue: 7, labels: ['type:spec', 'epic:auth'], gh, output, relations };
  const context = await readEpicContext(options.listing === undefined
    ? base
    : { ...base, listing: options.listing });
  return { context, calls, warnings };
}

describe('readEpicContext in native mode', () => {
  it('answers the parent epic off a listing handed in, sending nothing', async () => {
    const read = await lookUp({ listing: board() });
    expect(read.context).toEqual({ number: 40, title: 'issue 40', slug: null, criteria: EPIC_CRITERIA });
    expect(read.calls).toEqual([]);
    expect(read.warnings).toEqual([]);
  });

  it('control: without a listing it sends exactly one native board listing, and no --label list', async () => {
    const read = await lookUp();
    expect(read.context?.number).toBe(40);
    expect(read.calls).toEqual([LISTING_ARGS]);
    expect(read.calls).not.toContainEqual(epicContextArgs('auth'));
  });

  it('control: the same options with no port look up the epic:auth label instead', async () => {
    const { gh, calls } = fakeGh({ ok: true, stdout: JSON.stringify([written(board()[2] as BoardIssue)]), stderr: '' });
    const { output } = capture();
    const context = await readEpicContext({ issue: 7, labels: ['type:spec', 'epic:auth'], gh, output });
    expect(context).toEqual({ number: 50, title: 'issue 50', slug: 'auth', criteria: EPIC_CRITERIA });
    expect(calls).toEqual([epicContextArgs('auth')]);
  });

  it('answers null silently for an issue with no parent', async () => {
    const read = await lookUp({ listing: board(null) });
    expect(read.context).toBeNull();
    expect(read.warnings).toEqual([]);
  });

  it('warns for a parent that is no epic on the board', async () => {
    const read = await lookUp({ listing: board(link(60)) });
    expect(read.context).toBeNull();
    expect(read.warnings).toEqual([
      'epic context: issue #7\'s parent #60 is no epic on the board; it is planned without an epic',
    ]);
  });

  it('warns for a parent in another repository', async () => {
    const read = await lookUp({ listing: board(link(40, 'acme/other')) });
    expect(read.context).toBeNull();
    expect(read.warnings).toEqual([
      'epic context: issue #7\'s parent acme/other#40 is no epic on the board; it is planned without an epic',
    ]);
  });

  it('warns when the listing holds no row for the issue', async () => {
    const read = await lookUp({ listing: board().filter((each) => each.number !== 7) });
    expect(read.context).toBeNull();
    expect(read.warnings).toEqual(['epic context: the board listing holds no issue #7; it is planned without its epic']);
  });

  it('warns with the refusal when the listing read fails', async () => {
    const read = await lookUp({ answer: { ok: false, stdout: '', stderr: 'HTTP 502' } });
    expect(read.context).toBeNull();
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain('HTTP 502');
    expect(read.warnings[0]).toEndWith('; issue #7 is planned without its epic');
  });

  it('warns rather than throws for a listing handed in without the native fields', async () => {
    const labelsRow: BoardIssue = {
      number: 7, title: 'spec', body: '', state: 'OPEN', stateReason: null,
      labels: ['type:spec'], type: 'spec', module: 'unassigned',
    };
    const read = await lookUp({ listing: [labelsRow] });
    expect(read.context).toBeNull();
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain('board.relationships is native');
  });
});
