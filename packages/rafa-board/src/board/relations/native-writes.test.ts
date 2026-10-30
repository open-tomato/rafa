/**
 * Tests for the `native` adapter's writes (`./native-writes.ts`), made
 * through `createNativeRelations` (`./native.ts`) over a recording `gh`:
 * the exact argv each write sends, the one call a move sends for an issue
 * already in another epic, the writes that send nothing because the row
 * already holds them, and the refusals that send nothing at all.
 *
 * The contract's write cases, which hold that each write goes through
 * `gh` and rejects when its call fails, run in `./native.test.ts`.
 */
import type { BoardRelations } from './port.js';
import type { GhResult } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { labelsRelationsFixture, recordingGhFixture } from './contract.js';
import { createNativeRelations } from './native.js';

/** The board every case writes to. */
const BOARD = 'acme/board';

/** What `gh` answers a call the board takes. */
const OK: GhResult = { ok: true, stdout: '', stderr: '' };

/** What `gh` answers a call the board refuses, as the measurement recorded one. */
const REFUSED: GhResult = { ok: false, stdout: '', stderr: 'Sub issue may only have one parent' };

/** Issue `number` on `repository`, as a native row's link node names it. */
function link(number: number, repository = BOARD): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state: 'OPEN', repository };
}

/** A relationship list over `nodes`, `truncated` kept only when `total` is above them. */
function links(nodes: readonly BoardIssueLink[], total = nodes.length): BoardIssueLinks {
  return total > nodes.length
    ? { nodes, truncated: { total } }
    : { nodes };
}

/** A native row carrying all five native fields. */
function row(
  number: number,
  fields: {
    readonly type?: 'epic' | 'code';
    readonly parent?: BoardIssueLink | null;
    readonly blockedBy?: BoardIssueLinks;
  } = {},
): BoardIssue {
  const type = fields.type ?? 'code';
  return {
    number,
    title: `Issue ${String(number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    type,
    module: 'unassigned',
    parent: fields.parent ?? null,
    blockedBy: fields.blockedBy ?? links([]),
    blocking: links([]),
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: links([]),
  };
}

/** The case board: epics #1 and #2, #10 in #1, #11 in none, #12 waiting on #13 and acme/other#7, #14 waiting on a truncated list. */
const LISTING: readonly BoardIssue[] = [
  row(1, { type: 'epic' }),
  row(2, { type: 'epic' }),
  row(10, { parent: link(1) }),
  row(11),
  row(12, { blockedBy: links([link(13), link(7, 'acme/other')]) }),
  row(13),
  row(14, { blockedBy: links([link(13)], 60) }),
  row(15, { parent: link(1, 'acme/other') }),
];

/** The adapter over a recording `gh` answering `result`, and the argv it was sent. */
function recorded(result: GhResult = OK): { readonly relations: BoardRelations; readonly calls: () => readonly (readonly string[])[] } {
  const { gh, calls } = recordingGhFixture(result);
  return { relations: createNativeRelations({ gh, repository: BOARD }), calls };
}

describe('native setParent', () => {
  it('sends one --parent edit for an issue in no epic', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.setParent(LISTING, { issue: 11, parent: 2 });

    expect(calls()).toEqual([['issue', 'edit', '11', '--parent', '2']]);
    expect(writes).toEqual([{ issue: 11, what: 'move #11 into epic #2', status: 'written', problem: null }]);
  });

  it('moves an issue already in another epic in one call, never removing the old parent first', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.setParent(LISTING, { issue: 10, parent: 2 });

    expect(calls()).toEqual([['issue', 'edit', '10', '--parent', '2']]);
    expect(calls().flat()).not.toContain('--remove-parent');
    expect(writes.map((write) => write.status)).toEqual(['written']);
  });

  it('sends nothing for an issue already in that epic', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.setParent(LISTING, { issue: 10, parent: 1 });

    expect(calls()).toEqual([]);
    expect(writes).toEqual([{ issue: 10, what: 'move #10 into epic #1', status: 'unchanged', problem: null }]);
  });

  it('sends the edit for an issue whose parent is the same number on another repository', async () => {
    const { relations, calls } = recorded();

    await relations.setParent(LISTING, { issue: 15, parent: 1 });

    expect(calls()).toEqual([['issue', 'edit', '15', '--parent', '1']]);
  });

  it('rejects naming the move and what gh said when gh refuses it', async () => {
    const { relations } = recorded(REFUSED);

    await expect(relations.setParent(LISTING, { issue: 11, parent: 2 }))
      .rejects.toThrow('move #11 into epic #2 was refused, so nothing was changed: Sub issue may only have one parent');
  });

  it('refuses, sending nothing, an issue off the listing, an epic, a target that is no epic, and a bad number', async () => {
    const { relations, calls } = recorded();

    await expect(relations.setParent(LISTING, { issue: 99, parent: 1 })).rejects.toThrow('not on the board listing');
    await expect(relations.setParent(LISTING, { issue: 2, parent: 1 })).rejects.toThrow('which is an epic');
    await expect(relations.setParent(LISTING, { issue: 11, parent: 13 })).rejects.toThrow('not an issue typed epic');
    await expect(relations.setParent(LISTING, { issue: 11, parent: 99 })).rejects.toThrow('not an issue typed epic');
    await expect(relations.setParent(LISTING, { issue: 0, parent: 1 })).rejects.toThrow(TypeError);
    expect(calls()).toEqual([]);
  });

  it('refuses a row read without the native fields, sending nothing', async () => {
    const { relations, calls } = recorded();

    await expect(relations.setParent(labelsRelationsFixture, { issue: 10, parent: 1 })).rejects.toThrow('board.relationships is native');
    expect(calls()).toEqual([]);
  });
});

describe('native removeParent', () => {
  it('sends one --remove-parent edit for an issue in an epic', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.removeParent(LISTING, { issue: 10 });

    expect(calls()).toEqual([['issue', 'edit', '10', '--remove-parent']]);
    expect(writes).toEqual([{ issue: 10, what: 'take #10 out of its epic', status: 'written', problem: null }]);
  });

  it('sends nothing for an issue in no epic', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.removeParent(LISTING, { issue: 11 });

    expect(calls()).toEqual([]);
    expect(writes.map((write) => write.status)).toEqual(['unchanged']);
  });

  it('rejects when gh refuses it, and refuses an epic sending nothing', async () => {
    await expect(recorded(REFUSED).relations.removeParent(LISTING, { issue: 10 })).rejects.toThrow('take #10 out of its epic was refused');

    const { relations, calls } = recorded();
    await expect(relations.removeParent(LISTING, { issue: 1 })).rejects.toThrow('which is an epic');
    expect(calls()).toEqual([]);
  });
});

describe('native addBlocker', () => {
  it('sends a local blocker by number', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.addBlocker(LISTING, { issue: 11, blocker: { number: 13, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '11', '--add-blocked-by', '13']]);
    expect(writes).toEqual([{ issue: 11, what: 'make #11 wait on #13', status: 'written', problem: null }]);
  });

  it('sends a foreign blocker by its issue URL', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.addBlocker(LISTING, { issue: 11, blocker: { number: 7, repository: 'acme/other' } });

    expect(calls()).toEqual([['issue', 'edit', '11', '--add-blocked-by', 'https://github.com/acme/other/issues/7']]);
    expect(writes.map((write) => write.what)).toEqual(['make #11 wait on acme/other#7']);
  });

  it('writes a blocker named on the board\'s own repository, in any case, as a local one', async () => {
    const { relations, calls } = recorded();

    await relations.addBlocker(LISTING, { issue: 11, blocker: { number: 13, repository: 'Acme/Board' } });

    expect(calls()).toEqual([['issue', 'edit', '11', '--add-blocked-by', '13']]);
  });

  it('sends nothing for a blocker the issue already waits on, local or foreign', async () => {
    const { relations, calls } = recorded();

    const local = await relations.addBlocker(LISTING, { issue: 12, blocker: { number: 13, repository: null } });
    const foreign = await relations.addBlocker(LISTING, { issue: 12, blocker: { number: 7, repository: 'ACME/other' } });

    expect(calls()).toEqual([]);
    expect([...local, ...foreign].map((write) => write.status)).toEqual(['unchanged', 'unchanged']);
  });

  it('tells a local #7 from the foreign #7 the issue waits on', async () => {
    const { relations, calls } = recorded();

    await relations.addBlocker(LISTING, { issue: 12, blocker: { number: 7, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '12', '--add-blocked-by', '7']]);
  });

  it('sends the edit on a truncated list, whose nodes cannot prove the blocker there', async () => {
    const { relations, calls } = recorded();

    await relations.addBlocker(LISTING, { issue: 14, blocker: { number: 13, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '14', '--add-blocked-by', '13']]);
  });

  it('refuses, sending nothing, an issue waiting on itself, a malformed repository, and an issue off the listing', async () => {
    const { relations, calls } = recorded();

    await expect(relations.addBlocker(LISTING, { issue: 11, blocker: { number: 11, repository: null } })).rejects.toThrow('wait on itself');
    await expect(relations.addBlocker(LISTING, { issue: 11, blocker: { number: 7, repository: 'other' } })).rejects.toThrow(TypeError);
    await expect(relations.addBlocker(LISTING, { issue: 99, blocker: { number: 13, repository: null } })).rejects.toThrow('not on the board listing');
    expect(calls()).toEqual([]);
  });

  it('rejects when gh refuses it', async () => {
    await expect(recorded(REFUSED).relations.addBlocker(LISTING, { issue: 11, blocker: { number: 13, repository: null } }))
      .rejects.toThrow('make #11 wait on #13 was refused, so nothing was changed');
  });
});

describe('native removeBlocker', () => {
  it('sends a local blocker by number and a foreign one by URL', async () => {
    const { relations, calls } = recorded();

    const local = await relations.removeBlocker(LISTING, { issue: 12, blocker: { number: 13, repository: null } });
    const foreign = await relations.removeBlocker(LISTING, { issue: 12, blocker: { number: 7, repository: 'acme/other' } });

    expect(calls()).toEqual([
      ['issue', 'edit', '12', '--remove-blocked-by', '13'],
      ['issue', 'edit', '12', '--remove-blocked-by', 'https://github.com/acme/other/issues/7'],
    ]);
    expect([...local, ...foreign]).toEqual([
      { issue: 12, what: 'stop #12 waiting on #13', status: 'written', problem: null },
      { issue: 12, what: 'stop #12 waiting on acme/other#7', status: 'written', problem: null },
    ]);
  });

  it('sends nothing for a blocker the issue does not wait on', async () => {
    const { relations, calls } = recorded();

    const writes = await relations.removeBlocker(LISTING, { issue: 11, blocker: { number: 13, repository: null } });

    expect(calls()).toEqual([]);
    expect(writes.map((write) => write.status)).toEqual(['unchanged']);
  });

  it('sends the edit on a truncated list even when its nodes do not name the blocker', async () => {
    const { relations, calls } = recorded();

    await relations.removeBlocker(LISTING, { issue: 14, blocker: { number: 11, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '14', '--remove-blocked-by', '11']]);
  });

  it('rejects when gh refuses it', async () => {
    await expect(recorded(REFUSED).relations.removeBlocker(LISTING, { issue: 12, blocker: { number: 13, repository: null } }))
      .rejects.toThrow('stop #12 waiting on #13 was refused');
  });
});
