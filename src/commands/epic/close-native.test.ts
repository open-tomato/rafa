/**
 * Tests for `rafa epic close` (`close.ts`) in `native` mode, step 2 of
 * the gate: the listing read with the native fields, the epic's members
 * read as its sub-issues through the relationships port, a native epic
 * named by number and title with no slug, and GitHub's own count
 * (`subIssuesSummary`) guarding the sub-issues the listing does not
 * hold. The `labels` cases stay in `./close.test.ts`.
 *
 * `readEpicToClose` is read over literal native rows with the real
 * `native` adapter made over a `gh` that fails any call. The dispatched
 * cases stop at step 2 or 3, before any session, and plant a spawner
 * that fails the case if it is ever called.
 *
 * ## The controls
 *
 *  - Every native row also carries the `labels` mode's marks pointing
 *    elsewhere: epic #50 carries no `epic:` label, while #60 carries
 *    `epic:alpha`, as does the open #61 alone, which is no sub-issue.
 *    Each native answer is read beside the `labels` one over the same
 *    listing, which must differ.
 *  - The summary refusal is read beside the same epic with every
 *    sub-issue counted completed, which must pass.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardSubIssuesSummary } from '../../board/roadmap-board.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { createNativeRelations } from '../../board/relations/native.js';
import { nativeBoardListFields } from '../../board/roadmap-board.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createEpicCloseCommand, EPIC_CLOSE_REFUSAL_EXIT, readEpicToClose } from './close.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-close-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** A `gh` every call to which fails the case: the port's reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link REPOSITORY}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** Issue `number` as a link node names it. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'CLOSED'): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository: REPOSITORY };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly parent?: number;
  readonly subIssues?: readonly BoardIssueLink[];
  readonly summary?: Pick<BoardSubIssuesSummary, 'total' | 'completed'>;
}

/** A native row with every native field, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const state = fields.state ?? 'CLOSED';
  const summary = fields.summary ?? { total: 0, completed: 0 };
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined
      ? null
      : link(fields.parent, 'OPEN'),
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { ...summary, percentCompleted: 0 },
    subIssues: { nodes: fields.subIssues ?? [] },
  };
}

/** Epic `number`, open, with `subs` as its sub-issues and GitHub counting `summary`. */
function epic(number: number, labels: readonly string[], subs: readonly number[], summary?: RowFields['summary']): BoardIssue {
  return row(number, {
    state: 'OPEN',
    labels: ['type:epic', 'horizon:now', ...labels],
    subIssues: subs.map((sub) => link(sub)),
    summary: summary ?? { total: subs.length, completed: subs.length },
  });
}

/**
 * Epic #50, no `epic:` label, holds #52 and #51 closed. Epic #60 on
 * `epic:alpha` holds #62 closed and #63 open; the open #61 carries
 * `epic:alpha` and no parent. Epic #70 has no sub-issue at all.
 */
function board(extra: readonly BoardIssue[] = []): readonly BoardIssue[] {
  return [
    epic(50, [], [52, 51]),
    row(51, { parent: 50 }),
    row(52, { parent: 50 }),
    epic(60, ['epic:alpha'], [62, 63], { total: 2, completed: 1 }),
    row(61, { state: 'OPEN', labels: ['epic:alpha'] }),
    row(62, { parent: 60 }),
    row(63, { state: 'OPEN', parent: 60 }),
    epic(70, [], []),
    ...extra,
  ];
}

/** The message `read` refuses with, or null when it answers. */
function refusalOf(read: () => unknown): string | null {
  try {
    read();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    return (error as Error).message;
  }
}

describe('readEpicToClose in native mode', () => {
  it('reads the sub-issues as members in sub-issue order, with no slug, where labels refuses the unlabelled epic', () => {
    const target = readEpicToClose(board(), 50, NATIVE);

    expect(target.slug).toBeNull();
    expect(target.members.map((member) => member.number)).toEqual([52, 51]);
    expect(refusalOf(() => readEpicToClose(board(), 50))).toContain('carries no epic: label');
  });

  it('refuses an open sub-issue by number and title, where labels names the labelled issue instead', () => {
    const native = refusalOf(() => readEpicToClose(board(), 60, NATIVE));
    const labels = refusalOf(() => readEpicToClose(board(), 60));

    expect(native).toContain('Epic #60 has 1 open member: #63 Issue 63.');
    expect(native).not.toContain('epic:');
    expect(labels).toContain('#61 Issue 61');
  });

  it('refuses an epic with no sub-issue, naming no label', () => {
    const message = refusalOf(() => readEpicToClose(board(), 70, NATIVE));

    expect(message).toContain('Epic #70 has no members: it has no sub-issue');
    expect(message).not.toContain('epic:');
  });

  it('refuses a sub-issue off the listing while GitHub counts one not completed, and passes once all are (control)', () => {
    const counted = (completed: number): readonly BoardIssue[] => [
      epic(80, [], [81], { total: 2, completed }),
      row(81, { parent: 80 }),
    ];

    expect(refusalOf(() => readEpicToClose(counted(1), 80, NATIVE))).toContain('Epic #80 has 1 sub-issue the board listing does not hold');
    expect(readEpicToClose(counted(2), 80, NATIVE).members.map((member) => member.number)).toEqual([81]);
  });

  it('passes an epic whose every sub-issue is on the listing, whatever the count says of one closed as not planned', () => {
    const listing = [
      epic(90, [], [91, 92], { total: 2, completed: 1 }),
      row(91, { parent: 90 }),
      { ...row(92, { parent: 90 }), stateReason: 'NOT_PLANNED' },
    ];

    expect(readEpicToClose(listing, 90, NATIVE).members.map((member) => member.number)).toEqual([91, 92]);
  });
});

/** One native row as `gh issue list --json <nativeBoardListFields>` writes it. */
function wire(issue: BoardIssue): object {
  const url = (number: number): string => `https://github.com/${REPOSITORY}/issues/${String(number)}`;
  const node = (each: BoardIssueLink): object => ({ number: each.number, title: each.title, state: each.state, url: url(each.number) });
  const nodes = (list: { readonly nodes: readonly BoardIssueLink[] } | undefined): object => ({
    nodes: (list?.nodes ?? []).map(node),
    totalCount: list?.nodes.length ?? 0,
  });
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    labels: issue.labels.map((name) => ({ name })),
    parent: issue.parent === null || issue.parent === undefined
      ? null
      : node(issue.parent),
    blockedBy: nodes(issue.blockedBy),
    blocking: nodes(issue.blocking),
    subIssuesSummary: issue.subIssuesSummary,
    subIssues: nodes(issue.subIssues),
  };
}

/** A spawner that fails the case: no session starts before step 3. */
const NO_SESSION: CapturingSpawner = () => {
  throw new Error('a session was started');
};

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** Dispatches `rafa epic close <n>` in native mode over `listing`, answering the outcome and the `gh` calls. */
async function runNative(epicNumber: number, listing: readonly BoardIssue[]) {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    const answer: GhResult = args[0] === 'issue' && args[1] === 'list'
      ? { ok: true, stdout: JSON.stringify(listing.map(wire)), stderr: '' }
      : { ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` };
    return Promise.resolve(answer);
  };
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')));
  const command = createEpicCloseCommand({ gh, spawn: NO_SESSION, relations: NATIVE });
  const outcome = await dispatchInProject(['epic', 'close', String(epicNumber)], [EPIC_SUBJECT], [command], project);
  return { ...outcome, calls };
}

describe('rafa epic close, dispatched in native mode', () => {
  it('lists the board once with the native fields and refuses an open sub-issue before any session', async () => {
    const outcome = await runNative(60, board());

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('#63 Issue 63');
    expect(outcome.calls).toHaveLength(1);
    expect(outcome.calls[0]).toContain(nativeBoardListFields);
  });

  it('passes step 2 for an unlabelled epic whose sub-issues are closed, and stops at its missing criteria', async () => {
    const outcome = await runNative(50, board());

    expect(outcome.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(outcome.stderr).toContain('Epic #50 has no acceptance criteria');
    expect(outcome.stderr).not.toContain('epic:');
  });
});
