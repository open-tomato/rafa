/**
 * The `BoardRelations` contract: what every relationships adapter answers
 * over one board, whichever mode it reads (`./port.ts`,
 * `.rafa/specs/rafa-340-relationships-epics-blockers-github.md`, "Updated
 * to make native relationships a mode").
 *
 * Shaped like `src/adapters/tracker/contract.ts`: an adapter's test file
 * calls {@link runRelationsContract} with a factory answering a fresh
 * adapter for a `GhRunner` it hands in, `labels.test.ts` and
 * `native.test.ts` each with their own. Until the native writes land,
 * `native.test.ts` registers the read cases from
 * {@link relationsContractCases} and each write case as a named
 * `it.todo`. The cases are also answered as a
 * list by {@link relationsContractCases}, each a name and a run that
 * rejects when the adapter breaks the case; `./contract.test.ts` drives
 * both against broken adapters to hold which cases reject: the control
 * that every case can fail, for the behaviour it names.
 *
 * This module is a test helper, not a test file: bun runs no case here
 * until a `*.test.ts` calls one of the two exports above, and
 * `check-types` reads it where it reads no test file.
 *
 * ## One board, two listings
 *
 * {@link labelsRelationsFixture} and {@link nativeRelationsFixture}
 * describe the SAME board — the same issue numbers, titles and states —
 * once with `epic:` labels, a `Blocked by:` line and a checklist body,
 * once with `parent`, `blockedBy` and `subIssues` links, so a case that
 * reads by issue number gets the same answer from both. {@link
 * RELATIONS_FIXTURE} names every issue the two describe. Between them
 * they hold: two epics, one whose checklist orders three members and one
 * whose sub-issues are truncated; an issue waiting on one open and one
 * `NOT_PLANNED`-closed local blocker; an issue waiting on a local blocker
 * and one on another repository; an issue waiting on two blockers, so
 * closing only one still leaves it waiting; and an issue labelled
 * `spec:blocked` with nothing to read — a fault in `labels`, nothing to
 * report in `native`.
 *
 * A case whose answer differs by mode BY DESIGN — truncation, a fault, a
 * foreign blocker's state, what `afterMerge` writes — reads `adapter.mode`
 * and asserts each mode's own answer, never skipping either branch: the
 * module note on `./port.ts` spells which of the four differ and why.
 *
 * ## Writes
 *
 * A write case makes its own recording `GhRunner`
 * ({@link recordingGhFixture}) answering every call `ok` or every call
 * failed, hands it to `options.create`, and reads the calls the adapter
 * sent: that a write goes through `gh` at all is asserted here, in every
 * mode; the exact argv one mode's adapter sends is the adapter's own
 * unit tests to assert, since the two modes send different commands for
 * the same change. A write whose first call fails REJECTS, as the port
 * note requires; `afterMerge` never does, whatever `gh` answers.
 */
import type { AfterMergeRequest, BoardRelations } from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { BOARD_RELATIONSHIP_MODES } from '../../config-sections.js';
import { boardListFields } from '../roadmap-board.js';

/** The fixture board's own repository. */
export const RELATIONS_FIXTURE_REPOSITORY = 'acme/board';

/** A repository other than {@link RELATIONS_FIXTURE_REPOSITORY}, for the foreign-blocker fixture. */
export const RELATIONS_FIXTURE_FOREIGN_REPOSITORY = 'acme/other';

/** Every issue number the two fixture listings describe, named for what it is. */
export const RELATIONS_FIXTURE = Object.freeze({
  /** An epic whose checklist orders three members. */
  epicAlpha: 1,
  /** An epic whose sub-issue total exceeds the nodes answered. */
  epicBeta: 2,
  /** Alpha's checklist names this member second. */
  alphaMemberFirst: 10,
  /** Alpha's checklist names this member first. */
  alphaMemberSecond: 11,
  /** Alpha's checklist names this member third. */
  alphaMemberThird: 12,
  /** Beta's checklist names this member second. */
  betaMemberFirst: 20,
  /** Beta's checklist names this member first. */
  betaMemberSecond: 21,
  /** Waits on {@link openBlocker} and {@link notPlannedBlocker}. */
  blockedLocal: 30,
  /** An open local blocker. */
  openBlocker: 31,
  /** A local blocker closed as `NOT_PLANNED`; still clears what waits on it. */
  notPlannedBlocker: 32,
  /** Waits on {@link openBlocker} and a blocker on {@link RELATIONS_FIXTURE_FOREIGN_REPOSITORY}. */
  blockedForeign: 33,
  /** Waits on {@link openBlocker} and {@link secondOpenBlocker}, so closing one still leaves it waiting. */
  waitsOnTwo: 34,
  /** An open local blocker with no waiter of its own; the write cases' target. */
  secondOpenBlocker: 35,
  /** Labelled `spec:blocked` with nothing to read: a fault in `labels`, none in `native`. */
  blockedFaultNoLine: 40,
  /** The number {@link blockedForeign}'s foreign blocker carries on the other repository. */
  foreignBlockerNumber: 7,
} as const);

/** One issue on the fixture board, before either mode's relationship fields. */
interface FixtureIssue {
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason: string | null;
  readonly type: 'epic' | 'code';
}

/** Every issue the two fixture listings describe, in ascending number. */
const FIXTURE_ISSUES: readonly FixtureIssue[] = Object.freeze([
  { number: RELATIONS_FIXTURE.epicAlpha, title: 'Epic Alpha', state: 'OPEN', stateReason: null, type: 'epic' },
  { number: RELATIONS_FIXTURE.epicBeta, title: 'Epic Beta', state: 'OPEN', stateReason: null, type: 'epic' },
  { number: RELATIONS_FIXTURE.alphaMemberFirst, title: 'First-numbered Alpha member', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.alphaMemberSecond, title: 'Second Alpha member', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.alphaMemberThird, title: 'Third Alpha member', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.betaMemberFirst, title: 'First-numbered Beta member', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.betaMemberSecond, title: 'Second Beta member', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.blockedLocal, title: 'The widget', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.openBlocker, title: 'An open blocker', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.notPlannedBlocker, title: 'A blocker dropped as not planned', state: 'CLOSED', stateReason: 'NOT_PLANNED', type: 'code' },
  { number: RELATIONS_FIXTURE.blockedForeign, title: 'Blocked across repositories', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.waitsOnTwo, title: 'Waits on two blockers', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.secondOpenBlocker, title: 'Another open blocker', state: 'OPEN', stateReason: null, type: 'code' },
  { number: RELATIONS_FIXTURE.blockedFaultNoLine, title: 'Labelled blocked with nothing to read', state: 'OPEN', stateReason: null, type: 'code' },
]);

/** `issue`'s row on {@link FIXTURE_ISSUES}; throws for a number the fixture does not describe. */
function fixtureIssue(number: number): FixtureIssue {
  const issue = FIXTURE_ISSUES.find((row) => row.number === number);
  if (issue === undefined) throw new Error(`relations contract fixture: no issue #${String(number)}`);
  return issue;
}

/** `number`'s row as `labels` mode carries no relationship fields but its own. */
function labelsRow(number: number, labels: readonly string[], body: string): BoardIssue {
  const issue = fixtureIssue(number);
  return Object.freeze({
    number: issue.number,
    title: issue.title,
    body,
    state: issue.state,
    stateReason: issue.stateReason,
    labels: Object.freeze([...labels]),
    type: issue.type,
    module: 'unassigned',
  });
}

/** Alpha's checklist orders its three members second, first-numbered, third. */
const ALPHA_BODY = [
  '## Acceptance criteria',
  '',
  '- Alpha ships some things.',
  '',
  `- [ ] #${String(RELATIONS_FIXTURE.alphaMemberSecond)} second-added member`,
  `- [ ] #${String(RELATIONS_FIXTURE.alphaMemberFirst)} first-numbered member`,
  `- [ ] #${String(RELATIONS_FIXTURE.alphaMemberThird)} third member`,
  '',
].join('\n');

/** Beta's checklist orders its two members second, first-numbered. */
const BETA_BODY = [
  '## Acceptance criteria',
  '',
  '- Beta ships some things.',
  '',
  `- [ ] #${String(RELATIONS_FIXTURE.betaMemberSecond)} second-added member`,
  `- [ ] #${String(RELATIONS_FIXTURE.betaMemberFirst)} first-numbered member`,
  '',
].join('\n');

/**
 * The fixture board read in `labels` mode: `epic:` labels, a checklist
 * body on each epic, and `Blocked by:` lines, none of the five native
 * fields on any row.
 */
export const labelsRelationsFixture: readonly BoardIssue[] = Object.freeze([
  labelsRow(RELATIONS_FIXTURE.epicAlpha, ['type:epic', 'epic:alpha'], ALPHA_BODY),
  labelsRow(RELATIONS_FIXTURE.epicBeta, ['type:epic', 'epic:beta'], BETA_BODY),
  labelsRow(RELATIONS_FIXTURE.alphaMemberFirst, ['epic:alpha'], ''),
  labelsRow(RELATIONS_FIXTURE.alphaMemberSecond, ['epic:alpha'], ''),
  labelsRow(RELATIONS_FIXTURE.alphaMemberThird, ['epic:alpha'], ''),
  labelsRow(RELATIONS_FIXTURE.betaMemberFirst, ['epic:beta'], ''),
  labelsRow(RELATIONS_FIXTURE.betaMemberSecond, ['epic:beta'], ''),
  labelsRow(
    RELATIONS_FIXTURE.blockedLocal,
    ['spec:blocked'],
    `Blocked by: #${String(RELATIONS_FIXTURE.openBlocker)} #${String(RELATIONS_FIXTURE.notPlannedBlocker)}\n`,
  ),
  labelsRow(RELATIONS_FIXTURE.openBlocker, [], ''),
  labelsRow(RELATIONS_FIXTURE.notPlannedBlocker, [], ''),
  labelsRow(
    RELATIONS_FIXTURE.blockedForeign,
    ['spec:blocked'],
    `Blocked by: #${String(RELATIONS_FIXTURE.openBlocker)} `
      + `${RELATIONS_FIXTURE_FOREIGN_REPOSITORY}#${String(RELATIONS_FIXTURE.foreignBlockerNumber)}\n`,
  ),
  labelsRow(
    RELATIONS_FIXTURE.waitsOnTwo,
    ['spec:blocked'],
    `Blocked by: #${String(RELATIONS_FIXTURE.openBlocker)} #${String(RELATIONS_FIXTURE.secondOpenBlocker)}\n`,
  ),
  labelsRow(RELATIONS_FIXTURE.secondOpenBlocker, [], ''),
  labelsRow(RELATIONS_FIXTURE.blockedFaultNoLine, ['spec:blocked'], ''),
]);

/** One linked issue on {@link RELATIONS_FIXTURE_REPOSITORY}, as a native row's link node names it. */
function link(number: number): BoardIssueLink {
  const issue = fixtureIssue(number);
  return Object.freeze({ number: issue.number, title: issue.title, state: issue.state, repository: RELATIONS_FIXTURE_REPOSITORY });
}

/** One linked issue on another repository, whose number is not this board's to look up. */
function foreignLink(number: number, repository: string, title: string, state: 'OPEN' | 'CLOSED'): BoardIssueLink {
  return Object.freeze({ number, title, state, repository });
}

/** No links: the four relationship lists a leaf row carries. */
const NO_LINKS: BoardIssueLinks = Object.freeze({ nodes: Object.freeze([]) });

/** `number`'s row with the five native fields the `native` mode always carries. */
function nativeRow(
  number: number,
  fields: {
    readonly parent?: BoardIssueLink | null;
    readonly blockedBy?: BoardIssueLinks;
    readonly subIssues?: BoardIssueLinks;
    readonly subIssuesTotal?: number;
  } = {},
): BoardIssue {
  const issue = fixtureIssue(number);
  const subIssues = fields.subIssues ?? NO_LINKS;
  return Object.freeze({
    number: issue.number,
    title: issue.title,
    body: '',
    state: issue.state,
    stateReason: issue.stateReason,
    labels: Object.freeze(issue.type === 'epic'
      ? ['type:epic']
      : []),
    type: issue.type,
    module: 'unassigned',
    parent: fields.parent ?? null,
    blockedBy: fields.blockedBy ?? NO_LINKS,
    blocking: NO_LINKS,
    subIssuesSummary: Object.freeze({
      total: fields.subIssuesTotal ?? subIssues.nodes.length,
      completed: 0,
      percentCompleted: 0,
    }),
    subIssues,
  });
}

/**
 * The fixture board read in `native` mode: the same issue numbers,
 * titles and states as {@link labelsRelationsFixture}, carrying `parent`,
 * `blockedBy` and `subIssues` links in place of labels and a body.
 */
export const nativeRelationsFixture: readonly BoardIssue[] = Object.freeze([
  nativeRow(RELATIONS_FIXTURE.epicAlpha, {
    subIssues: Object.freeze({
      nodes: Object.freeze([
        link(RELATIONS_FIXTURE.alphaMemberSecond),
        link(RELATIONS_FIXTURE.alphaMemberFirst),
        link(RELATIONS_FIXTURE.alphaMemberThird),
      ]),
    }),
  }),
  nativeRow(RELATIONS_FIXTURE.epicBeta, {
    subIssues: Object.freeze({
      nodes: Object.freeze([link(RELATIONS_FIXTURE.betaMemberSecond), link(RELATIONS_FIXTURE.betaMemberFirst)]),
      truncated: Object.freeze({ total: 5 }),
    }),
    subIssuesTotal: 5,
  }),
  nativeRow(RELATIONS_FIXTURE.alphaMemberFirst, { parent: link(RELATIONS_FIXTURE.epicAlpha) }),
  nativeRow(RELATIONS_FIXTURE.alphaMemberSecond, { parent: link(RELATIONS_FIXTURE.epicAlpha) }),
  nativeRow(RELATIONS_FIXTURE.alphaMemberThird, { parent: link(RELATIONS_FIXTURE.epicAlpha) }),
  nativeRow(RELATIONS_FIXTURE.betaMemberFirst, { parent: link(RELATIONS_FIXTURE.epicBeta) }),
  nativeRow(RELATIONS_FIXTURE.betaMemberSecond, { parent: link(RELATIONS_FIXTURE.epicBeta) }),
  nativeRow(RELATIONS_FIXTURE.blockedLocal, {
    blockedBy: Object.freeze({
      nodes: Object.freeze([link(RELATIONS_FIXTURE.openBlocker), link(RELATIONS_FIXTURE.notPlannedBlocker)]),
    }),
  }),
  nativeRow(RELATIONS_FIXTURE.openBlocker),
  nativeRow(RELATIONS_FIXTURE.notPlannedBlocker),
  nativeRow(RELATIONS_FIXTURE.blockedForeign, {
    blockedBy: Object.freeze({
      nodes: Object.freeze([
        link(RELATIONS_FIXTURE.openBlocker),
        foreignLink(
          RELATIONS_FIXTURE.foreignBlockerNumber,
          RELATIONS_FIXTURE_FOREIGN_REPOSITORY,
          'A foreign blocker',
          'OPEN',
        ),
      ]),
    }),
  }),
  nativeRow(RELATIONS_FIXTURE.waitsOnTwo, {
    blockedBy: Object.freeze({
      nodes: Object.freeze([link(RELATIONS_FIXTURE.openBlocker), link(RELATIONS_FIXTURE.secondOpenBlocker)]),
    }),
  }),
  nativeRow(RELATIONS_FIXTURE.secondOpenBlocker),
  nativeRow(RELATIONS_FIXTURE.blockedFaultNoLine),
]);

/** `labelsRelationsFixture` or `nativeRelationsFixture`, for the mode an adapter under test reports. */
function fixtureListingFor(mode: BoardRelationshipMode): readonly BoardIssue[] {
  return mode === 'native'
    ? nativeRelationsFixture
    : labelsRelationsFixture;
}

/** `listing`'s row numbered `number`; throws for a number the listing does not carry. */
function rowOf(listing: readonly BoardIssue[], number: number): BoardIssue {
  const row = listing.find((issue) => issue.number === number);
  if (row === undefined) throw new Error(`relations contract: listing carries no issue #${String(number)}`);
  return row;
}

/** A `GhRunner` answering `result` to every call, and the argv of every call it was sent, in order. */
export function recordingGhFixture(result: GhResult): { readonly gh: GhRunner; readonly calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(result);
  };
  return { gh, calls: () => calls };
}

/** A call every write case's success half answers `ok` to. */
const GH_OK: GhResult = { ok: true, stdout: '{}', stderr: '' };

/** A call every write case's failure half answers not `ok` to. */
const GH_FAILED: GhResult = { ok: false, stdout: '', stderr: 'the fixture gh call failed' };

/** What {@link relationsContractCases} is run with. */
export interface RelationsContractOptions {
  /** Names the suite. */
  readonly name: string;
  /** A fresh adapter over `gh`, for a fresh recording fake each case makes its own. */
  readonly create: (gh: GhRunner) => BoardRelations;
}

/** One contract case: its name, and a run that rejects when the adapter breaks it. */
export interface RelationsContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** Every contract case, in the order {@link runRelationsContract} registers them. */
export function relationsContractCases(options: RelationsContractOptions): readonly RelationsContractCase[] {
  const { create } = options;

  return [
    {
      name: 'reports a mode from the two the port defines',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);

        expect(BOARD_RELATIONSHIP_MODES).toContain(adapter.mode);
      },
    },
    {
      name: 'reports the json fields its mode\'s listing asks for',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);

        expect(adapter.listFields).toBe(boardListFields(adapter.mode));
      },
    },
    {
      name: 'epicOf answers no epic for an epic issue itself',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        expect(adapter.read(listing).epicOf(rowOf(listing, RELATIONS_FIXTURE.epicAlpha)).kind).toBe('none');
      },
    },
    {
      name: 'epicOf answers no epic for an issue with no epic mark',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        expect(adapter.read(listing).epicOf(rowOf(listing, RELATIONS_FIXTURE.blockedLocal)).kind).toBe('none');
      },
    },
    {
      name: 'epicOf answers the epic an issue belongs to',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).epicOf(rowOf(listing, RELATIONS_FIXTURE.alphaMemberFirst));
        if (reading.kind !== 'epic') throw new Error(`expected an epic reading, got ${reading.kind}`);
        expect(reading.epic).toBe(RELATIONS_FIXTURE.epicAlpha);
        expect(reading.mark).toBe(adapter.mode === 'native'
          ? `#${String(RELATIONS_FIXTURE.epicAlpha)}`
          : 'epic:alpha');
      },
    },
    {
      name: 'membersOf answers an epic\'s members in order',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const alpha = adapter.read(listing).membersOf(rowOf(listing, RELATIONS_FIXTURE.epicAlpha));
        expect(alpha.members.map((member) => member.number)).toEqual([
          RELATIONS_FIXTURE.alphaMemberSecond,
          RELATIONS_FIXTURE.alphaMemberFirst,
          RELATIONS_FIXTURE.alphaMemberThird,
        ]);

        const beta = adapter.read(listing).membersOf(rowOf(listing, RELATIONS_FIXTURE.epicBeta));
        expect(beta.members.map((member) => member.number)).toEqual([
          RELATIONS_FIXTURE.betaMemberSecond,
          RELATIONS_FIXTURE.betaMemberFirst,
        ]);
      },
    },
    {
      name: 'membersOf reports truncation only in native mode',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).membersOf(rowOf(listing, RELATIONS_FIXTURE.epicBeta));
        if (adapter.mode === 'native') {
          expect(reading.truncated).toEqual({ total: 5 });
        } else {
          expect(Object.keys(reading)).not.toContain('truncated');
        }
      },
    },
    {
      name: 'membersOf throws for a row that is not an epic',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);
        const reading = adapter.read(listing);
        const notAnEpic = rowOf(listing, RELATIONS_FIXTURE.alphaMemberFirst);

        expect(() => reading.membersOf(notAnEpic)).toThrow(TypeError);
      },
    },
    {
      name: 'blockersOf answers no blocker for an issue that waits on nothing',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).blockersOf(rowOf(listing, RELATIONS_FIXTURE.secondOpenBlocker));
        expect(reading.kind).toBe('none');
      },
    },
    {
      name: 'blockersOf answers an issue blocked by one open and one closed local blocker',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).blockersOf(rowOf(listing, RELATIONS_FIXTURE.blockedLocal));
        if (reading.kind !== 'blocked') throw new Error(`expected a blocked reading, got ${reading.kind}`);
        const blockers = [...reading.blockers].sort((left, right) => left.number - right.number);
        expect(blockers).toEqual([
          { number: RELATIONS_FIXTURE.openBlocker, repository: null, state: 'OPEN' },
          { number: RELATIONS_FIXTURE.notPlannedBlocker, repository: null, state: 'CLOSED' },
        ]);
      },
    },
    {
      name: 'blockersOf answers a foreign blocker, its state read only in native mode',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).blockersOf(rowOf(listing, RELATIONS_FIXTURE.blockedForeign));
        if (reading.kind !== 'blocked') throw new Error(`expected a blocked reading, got ${reading.kind}`);
        const local = reading.blockers.find((blocker) => blocker.repository === null);
        const foreign = reading.blockers.find((blocker) => blocker.repository !== null);
        expect(local).toEqual({ number: RELATIONS_FIXTURE.openBlocker, repository: null, state: 'OPEN' });
        expect(foreign).toEqual({
          number: RELATIONS_FIXTURE.foreignBlockerNumber,
          repository: RELATIONS_FIXTURE_FOREIGN_REPOSITORY,
          state: adapter.mode === 'native'
            ? 'OPEN'
            : null,
        });
      },
    },
    {
      name: 'blockersOf answers a fault in labels mode and none in native',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const reading = adapter.read(listing).blockersOf(rowOf(listing, RELATIONS_FIXTURE.blockedFaultNoLine));
        expect(reading.kind).toBe(adapter.mode === 'native'
          ? 'none'
          : 'fault');
      },
    },
    {
      name: 'freedBy answers the open issue a closed blocker frees, whatever it closed as',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const freed = adapter.read(listing).freedBy([RELATIONS_FIXTURE.openBlocker]);
        expect(freed).toContain(RELATIONS_FIXTURE.blockedLocal);
      },
    },
    {
      name: 'freedBy answers nothing for an issue still waiting on another blocker',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        const freed = adapter.read(listing).freedBy([RELATIONS_FIXTURE.openBlocker]);
        expect(freed).not.toContain(RELATIONS_FIXTURE.waitsOnTwo);
      },
    },
    {
      name: 'freedBy answers an empty list for no closed issues',
      run: async () => {
        const adapter = create(recordingGhFixture(GH_OK).gh);
        const listing = fixtureListingFor(adapter.mode);

        expect(adapter.read(listing).freedBy([])).toEqual([]);
      },
    },
    {
      name: 'setParent sends gh and answers a write naming the issue',
      run: async () => {
        const { gh, calls } = recordingGhFixture(GH_OK);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        const writes = await adapter.setParent(listing, {
          issue: RELATIONS_FIXTURE.secondOpenBlocker,
          parent: RELATIONS_FIXTURE.epicAlpha,
        });
        expect(calls().length).toBeGreaterThan(0);
        expect(writes.some((write) => write.issue === RELATIONS_FIXTURE.secondOpenBlocker)).toBe(true);
      },
    },
    {
      name: 'setParent rejects when its relationship write fails',
      run: async () => {
        const { gh } = recordingGhFixture(GH_FAILED);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        await expect(adapter.setParent(listing, {
          issue: RELATIONS_FIXTURE.secondOpenBlocker,
          parent: RELATIONS_FIXTURE.epicAlpha,
        })).rejects.toThrow();
      },
    },
    {
      name: 'removeParent sends gh and answers a write naming the issue',
      run: async () => {
        const { gh, calls } = recordingGhFixture(GH_OK);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        const writes = await adapter.removeParent(listing, { issue: RELATIONS_FIXTURE.alphaMemberFirst });
        expect(calls().length).toBeGreaterThan(0);
        expect(writes.some((write) => write.issue === RELATIONS_FIXTURE.alphaMemberFirst)).toBe(true);
      },
    },
    {
      name: 'removeParent rejects when its relationship write fails',
      run: async () => {
        const { gh } = recordingGhFixture(GH_FAILED);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        await expect(adapter.removeParent(listing, { issue: RELATIONS_FIXTURE.alphaMemberFirst })).rejects.toThrow();
      },
    },
    {
      name: 'addBlocker sends gh and answers a write naming the issue',
      run: async () => {
        const { gh, calls } = recordingGhFixture(GH_OK);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        const writes = await adapter.addBlocker(listing, {
          issue: RELATIONS_FIXTURE.secondOpenBlocker,
          blocker: { number: RELATIONS_FIXTURE.openBlocker, repository: null },
        });
        expect(calls().length).toBeGreaterThan(0);
        expect(writes.some((write) => write.issue === RELATIONS_FIXTURE.secondOpenBlocker)).toBe(true);
      },
    },
    {
      name: 'addBlocker rejects when its relationship write fails',
      run: async () => {
        const { gh } = recordingGhFixture(GH_FAILED);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        await expect(adapter.addBlocker(listing, {
          issue: RELATIONS_FIXTURE.secondOpenBlocker,
          blocker: { number: RELATIONS_FIXTURE.openBlocker, repository: null },
        })).rejects.toThrow();
      },
    },
    {
      name: 'removeBlocker sends gh and answers a write naming the issue',
      run: async () => {
        const { gh, calls } = recordingGhFixture(GH_OK);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        const writes = await adapter.removeBlocker(listing, {
          issue: RELATIONS_FIXTURE.blockedLocal,
          blocker: { number: RELATIONS_FIXTURE.openBlocker, repository: null },
        });
        expect(calls().length).toBeGreaterThan(0);
        expect(writes.some((write) => write.issue === RELATIONS_FIXTURE.blockedLocal)).toBe(true);
      },
    },
    {
      name: 'removeBlocker rejects when its relationship write fails',
      run: async () => {
        const { gh } = recordingGhFixture(GH_FAILED);
        const adapter = create(gh);
        const listing = fixtureListingFor(adapter.mode);

        await expect(adapter.removeBlocker(listing, {
          issue: RELATIONS_FIXTURE.blockedLocal,
          blocker: { number: RELATIONS_FIXTURE.openBlocker, repository: null },
        })).rejects.toThrow();
      },
    },
    {
      name: 'afterMerge never rejects, whatever gh answers',
      run: async () => {
        const { gh } = recordingGhFixture(GH_FAILED);
        const adapter = create(gh);
        const request: AfterMergeRequest = {
          body: `Closes #${String(RELATIONS_FIXTURE.openBlocker)}`,
          ask: null,
          info: () => {},
          warn: () => {},
        };

        const writes = await adapter.afterMerge(request);
        expect(Array.isArray(writes)).toBe(true);
      },
    },
    {
      name: 'afterMerge writes nothing in native mode',
      run: async () => {
        const { gh, calls } = recordingGhFixture(GH_OK);
        const adapter = create(gh);
        const request: AfterMergeRequest = {
          body: `Closes #${String(RELATIONS_FIXTURE.openBlocker)}`,
          ask: null,
          info: () => {},
          warn: () => {},
        };

        const writes = await adapter.afterMerge(request);
        if (adapter.mode === 'native') {
          expect(writes).toEqual([]);
          expect(calls().length).toBe(0);
        } else {
          expect(calls().length).toBeGreaterThan(0);
        }
      },
    },
  ];
}

/** Registers every contract case under one `describe`, named for the adapter. */
export function runRelationsContract(options: RelationsContractOptions): void {
  describe(`${options.name}: BoardRelations contract`, () => {
    for (const contractCase of relationsContractCases(options)) {
      it(contractCase.name, contractCase.run);
    }
  });
}
