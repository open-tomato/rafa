/**
 * Tests for the `labels` relationships adapter (`./labels.ts`).
 *
 * The contract suite (`./contract.ts`) runs first, over the adapter made
 * with a recording `gh`. The cases after it hold what the contract leaves
 * to each adapter:
 *
 *  - Reads answer what today's modules answer. Each parity case reads the
 *    same listing through the adapter and through `readEpics`,
 *    `groupByEpicLabel`, `epicLines`, `readBlockedBy` and
 *    `blockedFaultMessage` directly, and holds the two to one answer, so a
 *    reading that drifted from its module fails here even where the
 *    contract's fixture would not notice.
 *  - The exact `gh` argv each write sends, over a recording `gh` and an
 *    in-memory epic body store, and that a refused relationship write
 *    sends nothing after it.
 *  - `afterMerge` is today's two merge steps: its `gh` calls and printed
 *    lines, over a scripted board, are held equal to `tickEpics` and
 *    `unblockAfterMerge` run directly over a fresh copy of the same board.
 */
import type { RelationWrite } from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { RoadmapBody } from '../roadmap-tick.js';

import { describe, expect, it } from 'bun:test';

import { unblockAfterMerge } from '../../commands/pr/merge-unblock.js';
import { blockedFaultMessage, readBlockedBy } from '../blocked.js';
import { epicTickSentence, tickEpics } from '../epic-tick.js';
import { epicLines } from '../epic-walk.js';
import { groupByEpicLabel, readEpics } from '../epics.js';
import { BOARD_LIST_FIELDS } from '../roadmap-board.js';

import {
  labelsRelationsFixture,
  recordingGhFixture,
  RELATIONS_FIXTURE,
  runRelationsContract,
} from './contract.js';
import { createLabelsRelations } from './labels.js';

runRelationsContract({ name: 'labels', create: (gh) => createLabelsRelations({ gh }) });

/** A `gh` every call to which fails the case: reads must never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** A labels-mode row, with the fields a listing carries and none of the native ones. */
function row(number: number, fields: Partial<Pick<BoardIssue, 'title' | 'body' | 'state' | 'stateReason' | 'labels'>> = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: fields.title ?? `Issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: labels.includes('type:epic')
      ? 'epic'
      : 'code',
    module: 'unassigned',
  };
}

/** `listing`'s row numbered `number`. */
function on(listing: readonly BoardIssue[], number: number): BoardIssue {
  const found = listing.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`no #${String(number)} on the case listing`);
  return found;
}

/** A board with an epic owning a slug alone, two epics claiming one slug, and odd members. */
const EPICS_LISTING: readonly BoardIssue[] = [
  row(1, {
    labels: ['type:epic', 'epic:alpha'],
    body: '- [ ] #12 listed first\n- [ ] #99 carries no label\n- [x] #12 listed twice\n- [ ] #10 listed second\n',
  }),
  row(2, { labels: ['type:epic', 'epic:shared'] }),
  row(3, { labels: ['type:epic', 'epic:shared'] }),
  row(10, { labels: ['epic:alpha'] }),
  row(11, { labels: ['epic:alpha'], state: 'CLOSED' }),
  row(12, { labels: ['epic:alpha'] }),
  row(13, { labels: ['epic:alpha'] }),
  row(20, { labels: ['epic:alpha', 'epic:shared'] }),
  row(21, { labels: ['epic:shared'] }),
  row(22, { labels: ['epic:nobody'] }),
  row(99, { title: 'On the checklist, in no epic' }),
];

describe('labels reads answer what today\'s modules answer', () => {
  it('reads without sending gh', () => {
    const reading = createLabelsRelations({ gh: NO_GH }).read(EPICS_LISTING);

    for (const issue of EPICS_LISTING) {
      reading.epicOf(issue);
      reading.blockersOf(issue);
      if (issue.type === 'epic') reading.membersOf(issue);
    }
    expect(reading.freedBy([10, 11])).toEqual([]);
  });

  it('puts every issue groupByEpicLabel groups under one owned slug in that slug\'s epic', () => {
    const reading = createLabelsRelations({ gh: NO_GH }).read(labelsRelationsFixture);
    const epics = readEpics({ issues: labelsRelationsFixture, claims: new Set(), today: new Date(0) }).epics;

    for (const [slug, members] of groupByEpicLabel(labelsRelationsFixture)) {
      const owner = epics.find((epic) => epic.slug === slug);
      for (const member of members) {
        expect(reading.epicOf(member)).toEqual({ kind: 'epic', issue: member.number, epic: owner!.number, mark: `epic:${slug}` });
      }
    }
  });

  it('answers an issue with two epic labels unresolved, naming every mark and its owners', () => {
    const reading = createLabelsRelations({ gh: NO_GH }).read(EPICS_LISTING);

    expect(reading.epicOf(on(EPICS_LISTING, 20))).toEqual({
      kind: 'unresolved',
      issue: 20,
      marks: [{ mark: 'epic:alpha', owners: [1] }, { mark: 'epic:shared', owners: [2, 3] }],
    });
  });

  it('answers a slug several epics claim, and one no epic owns, unresolved', () => {
    const reading = createLabelsRelations({ gh: NO_GH }).read(EPICS_LISTING);

    expect(reading.epicOf(on(EPICS_LISTING, 21))).toEqual({
      kind: 'unresolved',
      issue: 21,
      marks: [{ mark: 'epic:shared', owners: [2, 3] }],
    });
    expect(reading.epicOf(on(EPICS_LISTING, 22))).toEqual({
      kind: 'unresolved',
      issue: 22,
      marks: [{ mark: 'epic:nobody', owners: [] }],
    });
  });

  it('orders members by epicLines\' checklist once each, then every unlisted member by number, closed ones included', () => {
    const epic = on(EPICS_LISTING, 1);
    const read = readEpics({ issues: EPICS_LISTING, claims: new Set(), today: new Date(0) }).epics.find((each) => each.number === 1)!;
    const checklist = epicLines(read, epic).checklist.map((line) => line.issue);

    const reading = createLabelsRelations({ gh: NO_GH }).read(EPICS_LISTING);
    const members = reading.membersOf(epic);

    expect(checklist).toEqual([12, 99, 12, 10]);
    expect(members.members.map((member) => member.number)).toEqual([12, 10, 11, 13, 20]);
    expect(new Set(members.members)).toEqual(new Set(read.members));
    expect(Object.keys(members)).toEqual(['epic', 'members']);
  });

  it('reads an epic row the listing does not hold against the listing it is handed', () => {
    const outside = row(5, { labels: ['type:epic', 'epic:alpha'], body: '- [ ] #13 only line\n' });
    const listing = EPICS_LISTING.filter((issue) => issue.number !== 1);

    const reading = createLabelsRelations({ gh: NO_GH }).read(listing);
    const members = reading.membersOf(outside);

    expect(members.members.map((member) => member.number)).toEqual([13, 10, 11, 12, 20]);
  });

  it('answers the fault readBlockedBy reads, in blockedFaultMessage\'s words, for each fault it reads without the listing\'s numbers', () => {
    const bodies = ['', 'Blocked by: the API work\n', 'Blocked by: #40\n', 'Blocked by: acme/other#4\n'];
    const listing = bodies.map((body) => row(40, { labels: ['spec:blocked'], body }));

    for (const issue of listing) {
      const expected = readBlockedBy(issue.number, issue.body);
      const reading = createLabelsRelations({ gh: NO_GH }).read(listing);
      expect(reading.blockersOf(issue)).toEqual({ kind: 'fault', issue: 40, line: expected, message: blockedFaultMessage(expected) });
    }
  });

  it('answers a line on an issue without spec:blocked as waiting on nothing', () => {
    const issue = row(30, { body: 'Blocked by: #31\n' });
    const reading = createLabelsRelations({ gh: NO_GH }).read([issue, row(31)]);

    expect(reading.blockersOf(issue)).toEqual({ kind: 'none', issue: 30 });
  });

  it('names local blockers then foreign ones, with no state for a blocker the listing lacks and none for a foreign one', () => {
    const issue = row(30, { labels: ['spec:blocked'], body: 'Blocked by: acme/other#4 #31 #500\n' });
    const listing = [issue, row(31, { state: 'CLOSED' })];

    const reading = createLabelsRelations({ gh: NO_GH }).read(listing)
      .blockersOf(issue);

    expect(readBlockedBy(30, issue.body).kind).toBe('blocked');
    expect(reading).toEqual({
      kind: 'blocked',
      issue: 30,
      blockers: [
        { number: 31, repository: null, state: 'CLOSED' },
        { number: 500, repository: null, state: null },
        { number: 4, repository: 'acme/other', state: null },
      ],
    });
    expect(Object.keys(reading)).toEqual(['kind', 'issue', 'blockers']);
  });

  it('frees the open issues a closed blocker clears on the fixture board, and not the one still waiting', () => {
    const reading = createLabelsRelations({ gh: NO_GH }).read(labelsRelationsFixture);

    expect(reading.freedBy([RELATIONS_FIXTURE.openBlocker])).toEqual([RELATIONS_FIXTURE.blockedLocal, RELATIONS_FIXTURE.blockedForeign]);
    expect(reading.freedBy([RELATIONS_FIXTURE.openBlocker, RELATIONS_FIXTURE.secondOpenBlocker])).toEqual([
      RELATIONS_FIXTURE.blockedLocal,
      RELATIONS_FIXTURE.blockedForeign,
      RELATIONS_FIXTURE.waitsOnTwo,
    ]);
  });

  it('reports its mode and today\'s listing fields', () => {
    const relations = createLabelsRelations({ gh: NO_GH });

    expect(relations.mode).toBe('labels');
    expect(relations.listFields).toBe(BOARD_LIST_FIELDS);
  });
});

/** An in-memory epic body store, and the bodies it holds after the case. */
function memoryBodies(listing: readonly BoardIssue[]): { readonly bodies: RoadmapBody; readonly held: () => ReadonlyMap<number, string> } {
  const held = new Map(listing.map((issue) => [issue.number, issue.body]));
  const bodies: RoadmapBody = {
    read: (issue) => Promise.resolve(held.get(issue) ?? ''),
    write: (issue, body) => {
      held.set(issue, body);
      return Promise.resolve(body);
    },
  };
  return { bodies, held: () => held };
}

/** The adapter over a recording `gh` answering `result`, and an in-memory body store over `listing`. */
function writer(listing: readonly BoardIssue[], result: GhResult = { ok: true, stdout: '', stderr: '' }) {
  const recording = recordingGhFixture(result);
  const store = memoryBodies(listing);
  return { relations: createLabelsRelations({ gh: recording.gh, bodies: store.bodies }), calls: recording.calls, held: store.held };
}

/** Every write's issue and status, in order. */
function statuses(writes: readonly RelationWrite[]): readonly string[] {
  return writes.map((write) => `#${String(write.issue)} ${write.status}`);
}

const REFUSED: GhResult = { ok: false, stdout: '', stderr: 'HTTP 403: refused' };

describe('labels setParent and removeParent', () => {
  it('swaps the epic label in one call, then moves the checklist line with its why', async () => {
    const { relations, calls, held } = writer(labelsRelationsFixture);

    const writes = await relations.setParent(labelsRelationsFixture, { issue: RELATIONS_FIXTURE.alphaMemberFirst, parent: RELATIONS_FIXTURE.epicBeta });

    expect(calls()).toEqual([['issue', 'edit', '10', '--remove-label', 'epic:alpha', '--add-label', 'epic:beta']]);
    expect(statuses(writes)).toEqual(['#10 written', '#2 written', '#1 written']);
    expect(held().get(RELATIONS_FIXTURE.epicBeta)).toContain('- [ ] #10 first-numbered member\n');
    expect(held().get(RELATIONS_FIXTURE.epicAlpha)).not.toContain('#10');
  });

  it('carries each checklist edit\'s attempts, and leaves the key out of the label write', async () => {
    const { relations } = writer(labelsRelationsFixture);

    const writes = await relations.setParent(labelsRelationsFixture, { issue: RELATIONS_FIXTURE.alphaMemberFirst, parent: RELATIONS_FIXTURE.epicBeta });

    expect(writes.map((write) => Object.keys(write))).toEqual([
      ['issue', 'what', 'status', 'problem'],
      ['issue', 'what', 'status', 'problem', 'attempts'],
      ['issue', 'what', 'status', 'problem', 'attempts'],
    ]);
    expect(writes.map((write) => write.attempts)).toEqual([undefined, 1, 1]);
  });

  it('puts the label on an issue in no epic without taking any off, and appends its title as the why', async () => {
    const { relations, calls, held } = writer(labelsRelationsFixture);

    await relations.setParent(labelsRelationsFixture, { issue: RELATIONS_FIXTURE.secondOpenBlocker, parent: RELATIONS_FIXTURE.epicAlpha });

    expect(calls()).toEqual([['issue', 'edit', '35', '--add-label', 'epic:alpha']]);
    expect(held().get(RELATIONS_FIXTURE.epicAlpha)).toContain('- [ ] #35 Another open blocker\n');
  });

  it('sends nothing for an issue already in the target epic alone', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    const writes = await relations.setParent(labelsRelationsFixture, { issue: RELATIONS_FIXTURE.alphaMemberFirst, parent: RELATIONS_FIXTURE.epicAlpha });

    expect(calls()).toEqual([]);
    expect(statuses(writes)).toEqual(['#10 unchanged']);
  });

  it('refuses, sending nothing, a target that is no epic, an issue that is one, and an issue off the listing', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    await expect(relations.setParent(labelsRelationsFixture, { issue: 35, parent: 31 })).rejects.toThrow('is not an epic carrying');
    await expect(relations.setParent(labelsRelationsFixture, { issue: 1, parent: 2 })).rejects.toThrow('an epic belongs to no epic');
    await expect(relations.setParent(labelsRelationsFixture, { issue: 700, parent: 1 })).rejects.toThrow('not on the board listing');
    expect(calls()).toEqual([]);
  });

  it('rejects when the swap is refused and edits no checklist', async () => {
    const { relations, calls, held } = writer(labelsRelationsFixture, REFUSED);

    await expect(relations.setParent(labelsRelationsFixture, { issue: 10, parent: 2 })).rejects.toThrow('HTTP 403: refused');
    expect(calls()).toHaveLength(1);
    expect(held().get(RELATIONS_FIXTURE.epicAlpha)).toBe(on(labelsRelationsFixture, 1).body);
  });

  it('answers a checklist edit that fails as a failed write after the label moved, never a rejection', async () => {
    const recording = recordingGhFixture({ ok: true, stdout: '', stderr: '' });
    const failing: RoadmapBody = { read: () => Promise.reject(new Error('body read failed')), write: (_issue, body) => Promise.resolve(body) };
    const relations = createLabelsRelations({ gh: recording.gh, bodies: failing });

    const writes = await relations.setParent(labelsRelationsFixture, { issue: 10, parent: 2 });

    expect(statuses(writes)).toEqual(['#10 written', '#2 failed', '#1 failed']);
    expect(writes[1]?.problem).toBe('body read failed');
  });

  it('takes every epic label off in one call, then the line off the epic it left', async () => {
    const { relations, calls, held } = writer(labelsRelationsFixture);

    const writes = await relations.removeParent(labelsRelationsFixture, { issue: RELATIONS_FIXTURE.alphaMemberSecond });

    expect(calls()).toEqual([['issue', 'edit', '11', '--remove-label', 'epic:alpha']]);
    expect(statuses(writes)).toEqual(['#11 written', '#1 written']);
    expect(held().get(RELATIONS_FIXTURE.epicAlpha)).not.toContain('#11');
  });

  it('sends nothing to take an issue in no epic out of one', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    expect(statuses(await relations.removeParent(labelsRelationsFixture, { issue: 35 }))).toEqual(['#35 unchanged']);
    expect(calls()).toEqual([]);
  });
});

describe('labels addBlocker and removeBlocker', () => {
  it('writes the line and puts spec:blocked on in one call for an issue that waits on nothing', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    const writes = await relations.addBlocker(labelsRelationsFixture, { issue: 35, blocker: { number: 31, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '35', '--add-label', 'spec:blocked', '--body=Blocked by: #31\n']]);
    expect(statuses(writes)).toEqual(['#35 written']);
  });

  it('appends to the line of an issue already labelled, a foreign blocker as owner/repo#n', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    await relations.addBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 9, repository: 'acme/other' } });

    expect(calls()).toEqual([['issue', 'edit', '30', '--body=Blocked by: #31 #32 acme/other#9\n']]);
  });

  it('sends nothing for a blocker the line names already, and refuses an issue waiting on itself', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    expect(statuses(await relations.addBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 32, repository: null } })))
      .toEqual(['#30 unchanged']);
    await expect(relations.addBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 30, repository: null } }))
      .rejects.toThrow('wait on itself');
    expect(calls()).toEqual([]);
  });

  it('writes the line without the blocker, keeping the label while others remain', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    await relations.removeBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 31, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '30', '--body=Blocked by: #32\n']]);
  });

  it('removes the line and the label together when the last blocker goes', async () => {
    const listing = [row(30, { labels: ['Spec:Blocked'], body: 'Text.\nBlocked by: #31\n' }), row(31)];
    const { relations, calls } = writer(listing);

    await relations.removeBlocker(listing, { issue: 30, blocker: { number: 31, repository: null } });

    expect(calls()).toEqual([['issue', 'edit', '30', '--remove-label', 'Spec:Blocked', '--body=Text.\n']]);
  });

  it('sends nothing for a blocker the line does not name', async () => {
    const { relations, calls } = writer(labelsRelationsFixture);

    expect(statuses(await relations.removeBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 35, repository: null } })))
      .toEqual(['#30 unchanged']);
    expect(calls()).toEqual([]);
  });

  it('rejects when gh refuses the edit', async () => {
    const { relations } = writer(labelsRelationsFixture, REFUSED);

    await expect(relations.removeBlocker(labelsRelationsFixture, { issue: 30, blocker: { number: 31, repository: null } }))
      .rejects.toThrow('nothing was changed: HTTP 403: refused');
  });
});

/** One issue on the scripted board `afterMerge` runs over. */
interface ScriptedIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly string[];
}

/** The board: epic #1 lists #31, just closed by the merge; #30 waits on #31. */
const SCRIPTED_BOARD: readonly ScriptedIssue[] = [
  { number: 1, title: 'Epic Alpha', body: '- [ ] #31 the blocker\n- [ ] #10 a member\n', state: 'OPEN', labels: ['type:epic', 'epic:alpha'] },
  { number: 10, title: 'A member', body: '', state: 'OPEN', labels: ['epic:alpha'] },
  { number: 30, title: 'Waits', body: 'Blocked by: #31\n', state: 'OPEN', labels: ['spec:blocked'] },
  { number: 31, title: 'The blocker', body: '', state: 'CLOSED', labels: ['epic:alpha'] },
];

/** A `gh` over a fresh copy of {@link SCRIPTED_BOARD}, answering the listings, the body reads and writes, and label edits. */
function scriptedGh(): { readonly gh: GhRunner; readonly calls: () => readonly string[] } {
  const bodies = new Map(SCRIPTED_BOARD.map((issue) => [issue.number, issue.body]));
  const calls: string[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const gh: GhRunner = (args) => {
    calls.push(args.join(' '));
    const path = /issues\/(\d+)$/u.exec(args[1] ?? '');
    if (args[0] === 'api' && path !== null) {
      const number = Number(path[1]);
      const at = args.indexOf('-f');
      if (at !== -1) bodies.set(number, (args[at + 1] ?? '').replace(/^body=/u, ''));
      return ok(JSON.stringify({ body: bodies.get(number) ?? '' }));
    }
    if (args[0] === 'issue' && args[1] === 'edit') return ok('');
    if (args.includes('--label')) {
      const blocked = SCRIPTED_BOARD.filter((issue) => issue.state === 'OPEN' && issue.labels.includes('spec:blocked'));
      return ok(JSON.stringify(blocked.map((issue) => ({ number: issue.number, body: issue.body }))));
    }
    if (args.includes('number,state')) return ok(JSON.stringify(SCRIPTED_BOARD.map(({ number, state }) => ({ number, state }))));
    if (args[0] === 'issue' && args[1] === 'list') {
      return ok(JSON.stringify(SCRIPTED_BOARD.map((issue) => ({
        ...issue,
        body: bodies.get(issue.number) ?? '',
        stateReason: issue.state === 'CLOSED'
          ? 'COMPLETED'
          : '',
        labels: issue.labels.map((name) => ({ name })),
      }))));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { gh, calls: () => calls };
}

/** Where the lines land, each tagged with its level, in order. */
function lines(): { readonly info: (message: string) => void; readonly warn: (message: string) => void; readonly all: () => readonly string[] } {
  const all: string[] = [];
  return {
    info: (message) => void all.push(`info ${message}`),
    warn: (message) => void all.push(`warn ${message}`),
    all: () => all,
  };
}

describe('labels afterMerge', () => {
  it('answers nothing and sends nothing for a pull request that closes no issue', async () => {
    const { gh, calls } = recordingGhFixture({ ok: true, stdout: '[]', stderr: '' });
    const sink = lines();

    const writes = await createLabelsRelations({ gh }).afterMerge({ body: 'Refs #31', ask: null, ...sink });

    expect(writes).toEqual([]);
    expect(calls()).toEqual([]);
    expect(sink.all()).toEqual([]);
  });

  it('sends the calls and prints the lines of tickEpics then unblockAfterMerge, run directly', async () => {
    const body = 'Closes #31';
    const ask = () => Promise.resolve(true);
    const viaAdapter = scriptedGh();
    const adapterLines = lines();
    const writes = await createLabelsRelations({ gh: viaAdapter.gh }).afterMerge({ body, ask, ...adapterLines });

    const direct = scriptedGh();
    const directLines = lines();
    await tickEpics({
      gh: direct.gh,
      warn: directLines.warn,
      epicTicked: (result) => {
        if (result.status === 'failed') directLines.warn(epicTickSentence(result));
        else directLines.info(epicTickSentence(result));
      },
    }, [31]);
    await unblockAfterMerge({ body, gh: direct.gh, ask, info: directLines.info, warn: directLines.warn });

    expect(viaAdapter.calls()).toEqual(direct.calls());
    expect(adapterLines.all()).toEqual(directLines.all());
    expect(adapterLines.all()[0]).toBe('info Ticked #31 on epic #1.');
    expect(statuses(writes)).toEqual(['#1 written', '#30 written']);
  });

  it('never rejects, warning of each step, when every gh call fails', async () => {
    const { gh } = recordingGhFixture(REFUSED);
    const sink = lines();

    const writes = await createLabelsRelations({ gh }).afterMerge({ body: 'Fixes #31', ask: null, ...sink });

    expect(writes).toEqual([]);
    expect(sink.all().map((line) => line.split(':')[0])).toEqual([
      'warn the epic checklists were not ticked',
      'warn the blocked-issue reading did not run',
    ]);
  });
});
