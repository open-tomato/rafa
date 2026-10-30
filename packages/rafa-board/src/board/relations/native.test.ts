/**
 * Tests for the `native` relationships adapter (`./native.ts`).
 *
 * The contract suite (`./contract.ts`) runs first, whole, over the
 * adapter made with a recording `gh` on the fixture's repository. The
 * writes' exact argv is held in `./native-writes.test.ts`.
 *
 * The cases after it hold what the contract's one board leaves open: a
 * listing read without the native fields, a parent that names no epic,
 * members `parent` decides and `subIssues` orders, truncation on either
 * list, foreign links, and that no read sends `gh`.
 */
import type { BlockersReading, RelationsReading } from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import {
  labelsRelationsFixture,
  nativeRelationsFixture,
  recordingGhFixture,
  RELATIONS_FIXTURE_REPOSITORY,
  runRelationsContract,
} from './contract.js';
import { createNativeRelations } from './native.js';
import { isWaiting } from './port.js';

runRelationsContract({
  name: 'native',
  create: (gh) => createNativeRelations({ gh, repository: RELATIONS_FIXTURE_REPOSITORY }),
});

/** The board every case below reads. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: reads must never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The adapter on {@link BOARD} over {@link NO_GH}. */
function adapter(): ReturnType<typeof createNativeRelations> {
  return createNativeRelations({ gh: NO_GH, repository: BOARD });
}

/** Issue `number` on `repository`, as a native row's link node names it. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository };
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
    readonly state?: 'OPEN' | 'CLOSED';
    readonly parent?: BoardIssueLink | null;
    readonly blockedBy?: BoardIssueLinks;
    readonly subIssues?: BoardIssueLinks;
  } = {},
): BoardIssue {
  const type = fields.type ?? 'code';
  const subIssues = fields.subIssues ?? links([]);
  return {
    number,
    title: `Issue ${String(number)}`,
    body: '',
    state: fields.state ?? 'OPEN',
    stateReason: null,
    labels: type === 'epic'
      ? ['type:epic']
      : [],
    type,
    module: 'unassigned',
    parent: fields.parent ?? null,
    blockedBy: fields.blockedBy ?? links([]),
    blocking: links([]),
    subIssuesSummary: { total: subIssues.truncated?.total ?? subIssues.nodes.length, completed: 0, percentCompleted: 0 },
    subIssues,
  };
}

/** The four reads over `listing`, by {@link adapter}. */
function readOf(listing: readonly BoardIssue[]): RelationsReading {
  return adapter().read(listing);
}

/** `listing`'s row numbered `number`. */
function on(listing: readonly BoardIssue[], number: number): BoardIssue {
  const found = listing.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`no #${String(number)} on the case listing`);
  return found;
}

describe('native adapter made', () => {
  it('answers the native mode and its listing fields', () => {
    const relations = adapter();

    expect(relations.mode).toBe('native');
    expect(relations.listFields).toBe('number,title,body,state,stateReason,labels,parent,blockedBy,blocking,subIssuesSummary,subIssues');
  });

  it('refuses a board repository that is not owner/name', () => {
    expect(() => createNativeRelations({ gh: NO_GH, repository: 'board' })).toThrow(TypeError);
    expect(() => createNativeRelations({ gh: NO_GH, repository: 'acme/board/extra' })).toThrow(TypeError);
    expect(() => createNativeRelations({ gh: NO_GH, repository: '' })).toThrow('is not owner/name');
  });
});

describe('native reads refuse a listing read without the native fields', () => {
  it('refuses a labels-mode listing, naming board.relationships and the missing keys', () => {
    expect(() => adapter().read(labelsRelationsFixture)).toThrow(TypeError);
    expect(() => adapter().read(labelsRelationsFixture)).toThrow('board.relationships is native');
    expect(() => adapter().read(labelsRelationsFixture)).toThrow('without parent, blockedBy, blocking, subIssuesSummary, subIssues');
  });

  it('refuses a row missing one field, and an issue handed in without them', () => {
    const partial = Object.fromEntries(Object.entries(row(5)).filter(([key]) => key !== 'subIssuesSummary')) as unknown as BoardIssue;
    const reading = adapter().read([row(1, { type: 'epic' })]);

    expect(() => adapter().read([row(1), partial])).toThrow('#5 was read without subIssuesSummary');
    expect(() => reading.epicOf(on(labelsRelationsFixture, 10))).toThrow(TypeError);
    expect(() => reading.blockersOf(on(labelsRelationsFixture, 30))).toThrow(TypeError);
  });

  it('reads the native fixture and every row of it without sending gh', () => {
    const reading = adapter().read(nativeRelationsFixture);

    for (const issue of nativeRelationsFixture) {
      reading.epicOf(issue);
      reading.blockersOf(issue);
      if (issue.type === 'epic') reading.membersOf(issue);
    }
    expect(reading.freedBy(nativeRelationsFixture.map((issue) => issue.number)).length).toBeGreaterThan(0);
  });
});

describe('native epicOf', () => {
  const listing = [
    row(1, { type: 'epic' }),
    row(2),
    row(10, { parent: link(1) }),
    row(11, { parent: link(1, 'OPEN', 'Acme/Board') }),
    row(12, { parent: link(99) }),
    row(13, { parent: link(2) }),
    row(14, { parent: link(1, 'OPEN', 'acme/other') }),
    row(15, { type: 'epic', parent: link(1) }),
  ];
  const reading = adapter().read(listing);

  it('answers the local epic a parent names, marked #<n>, whatever case the url spells the repository in', () => {
    expect(reading.epicOf(on(listing, 10))).toEqual({ kind: 'epic', issue: 10, epic: 1, mark: '#1' });
    expect(reading.epicOf(on(listing, 11))).toEqual({ kind: 'epic', issue: 11, epic: 1, mark: '#1' });
  });

  it('answers a parent off the listing, or not typed epic, unresolved with no owner', () => {
    expect(reading.epicOf(on(listing, 12))).toEqual({ kind: 'unresolved', issue: 12, marks: [{ mark: '#99', owners: [] }] });
    expect(reading.epicOf(on(listing, 13))).toEqual({ kind: 'unresolved', issue: 13, marks: [{ mark: '#2', owners: [] }] });
  });

  it('never reads a foreign parent as this board\'s issue of the same number', () => {
    expect(reading.epicOf(on(listing, 14))).toEqual({
      kind: 'unresolved',
      issue: 14,
      marks: [{ mark: 'acme/other#1', owners: [] }],
    });
  });

  it('answers an epic row in no epic, even with a parent', () => {
    expect(reading.epicOf(on(listing, 15))).toEqual({ kind: 'none', issue: 15 });
  });
});

describe('native membersOf', () => {
  it('orders members by the epic\'s sub-issues, never by number', () => {
    const listing = [
      row(1, { type: 'epic', subIssues: links([link(30), link(10), link(20)]) }),
      row(10, { parent: link(1) }),
      row(20, { parent: link(1) }),
      row(30, { parent: link(1) }),
    ];

    const members = readOf(listing).membersOf(on(listing, 1));

    expect(members.members.map((member) => member.number)).toEqual([30, 10, 20]);
    expect(Object.keys(members)).toEqual(['epic', 'members']);
  });

  it('lets parent decide membership: a node whose row names another parent is out, a child the nodes miss is in', () => {
    const listing = [
      row(1, { type: 'epic', subIssues: links([link(40), link(10)]) }),
      row(2, { type: 'epic' }),
      row(10, { parent: link(1) }),
      row(12, { parent: link(1) }),
      row(11, { parent: link(1) }),
      row(40, { parent: link(2) }),
    ];

    const members = readOf(listing).membersOf(on(listing, 1));

    expect(members.members.map((member) => member.number)).toEqual([10, 11, 12]);
  });

  it('keeps closed members, leaves out epics, foreign sub-issues and nodes off the listing', () => {
    const listing = [
      row(1, {
        type: 'epic',
        subIssues: links([link(5, 'OPEN', 'acme/other'), link(20), link(77), link(10, 'CLOSED'), link(15)]),
      }),
      row(10, { state: 'CLOSED', parent: link(1) }),
      row(15, { type: 'epic', parent: link(1) }),
      row(20, { parent: link(1) }),
    ];

    const members = readOf(listing).membersOf(on(listing, 1));

    expect(members.members.map((member) => member.number)).toEqual([20, 10]);
  });

  it('reports a sub-issue list gh answered short', () => {
    const listing = [
      row(1, { type: 'epic', subIssues: links([link(10)], 150) }),
      row(10, { parent: link(1) }),
      row(11, { parent: link(1) }),
    ];

    const members = readOf(listing).membersOf(on(listing, 1));

    expect(members).toEqual({ epic: 1, members: [on(listing, 10), on(listing, 11)], truncated: { total: 150 } });
  });

  it('refuses a row that is not typed epic', () => {
    const listing = [row(10)];

    expect(() => readOf(listing).membersOf(on(listing, 10))).toThrow('#10, which is not typed epic');
  });
});

describe('native blockersOf', () => {
  it('names every node in gh\'s order, foreign repositories kept with their own state', () => {
    const issue = row(30, {
      blockedBy: links([link(7, 'CLOSED', 'acme/other'), link(31), link(32, 'CLOSED', 'ACME/board')]),
    });

    const reading = readOf([issue]).blockersOf(issue);

    expect(reading).toEqual({
      kind: 'blocked',
      issue: 30,
      blockers: [
        { number: 7, repository: 'acme/other', state: 'CLOSED' },
        { number: 31, repository: null, state: 'OPEN' },
        { number: 32, repository: null, state: 'CLOSED' },
      ],
    });
    expect(Object.keys(reading)).toEqual(['kind', 'issue', 'blockers']);
  });

  it('reports a blockedBy list gh answered short, which keeps the issue waiting', () => {
    const issue = row(30, { blockedBy: links([link(31, 'CLOSED')], 60) });

    const reading: BlockersReading = readOf([issue]).blockersOf(issue);

    expect(reading).toEqual({
      kind: 'blocked',
      issue: 30,
      blockers: [{ number: 31, repository: null, state: 'CLOSED' }],
      truncated: { total: 60 },
    });
    expect(isWaiting(reading)).toBe(true);
  });

  it('reads the blocker state off the node, not the listing row', () => {
    const issue = row(30, { blockedBy: links([link(31, 'CLOSED')]) });
    const listing = [issue, row(31, { state: 'OPEN' })];

    const reading = readOf(listing).blockersOf(issue);

    expect(reading.kind === 'blocked' && reading.blockers[0]?.state).toBe('CLOSED');
  });
});

describe('native freedBy', () => {
  const listing = [
    row(30, { blockedBy: links([link(31)]) }),
    row(31),
    row(32, { blockedBy: links([link(31), link(7, 'OPEN', 'acme/other')]) }),
    row(33, { blockedBy: links([link(31), link(7, 'CLOSED', 'acme/other')]) }),
    row(34, { blockedBy: links([link(31)], 51) }),
    row(35, { state: 'CLOSED', blockedBy: links([link(31)]) }),
    row(36, { blockedBy: links([link(31, 'OPEN', 'acme/other')]) }),
  ];

  it('frees an open issue whose last open blocker closed, and one whose foreign blocker closed already', () => {
    expect(readOf(listing).freedBy([31])).toEqual([30, 33]);
  });

  it('never frees on an open foreign blocker, a truncated list, a closed waiter, or a foreign number alike', () => {
    const freed = readOf(listing).freedBy([31]);

    expect(freed).not.toContain(32);
    expect(freed).not.toContain(34);
    expect(freed).not.toContain(35);
    expect(freed).not.toContain(36);
  });
});

describe('native afterMerge', () => {
  it('answers no writes and sends nothing, whatever the body closes', async () => {
    const { gh, calls } = recordingGhFixture({ ok: true, stdout: '{}', stderr: '' });
    const relations = createNativeRelations({ gh, repository: BOARD });
    const said: string[] = [];

    const writes = await relations.afterMerge({
      body: 'Closes #31\nFixes #10',
      ask: () => Promise.resolve(true),
      info: (message) => { said.push(message); },
      warn: (message) => { said.push(message); },
    });

    expect(writes).toEqual([]);
    expect(calls()).toEqual([]);
    expect(said).toEqual([]);
  });
});
