/**
 * Tests for the `BoardRelations` contract (`./contract.ts`).
 *
 * The contract runs twice over two small in-memory adapters written
 * here, one per mode, driven off {@link labelsRelationsFixture} and
 * {@link nativeRelationsFixture}: registered through
 * {@link runRelationsContract}, where every case must pass, and run
 * through {@link relationsContractCases}, where no case may reject. Each
 * adapter is then broken one behaviour at a time, and the cases that
 * reject are held to the exact list each break must redden — the same
 * control `src/adapters/tracker/contract.test.ts` runs for the Tracker
 * contract, applied here once per mode, since a `labels` break and a
 * `native` break do not always redden the same cases (`context/pull-
 * requests.md`, "Native relationships", spells the differences the port
 * note names).
 *
 * The `labels` half wraps `../epics.ts` and `../blocked.ts`, as the real
 * adapter (`./labels.ts`, run through the contract by `./labels.test.ts`)
 * does; the `native` half reads the fixture's `parent`, `blockedBy` and
 * `subIssues` fields directly.
 * Neither is the real adapter — both exist only to hold the contract
 * mechanism itself to account, exactly as `contract.test.ts`'s
 * `memoryTracker` is not the `local` or `github` Tracker.
 */
import type {
  AfterMergeRequest,
  BlockerChange,
  BoardRelations,
  EpicOfReading,
  MembersReading,
  ParentChange,
  ParentRemoval,
  RelationsReading,
  RelationWrite,
} from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { blockedFaultMessage, hasSpecBlockedLabel, readBlockedBy } from '../blocked.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf, groupByEpicLabel } from '../epics.js';
import { boardListFields } from '../roadmap-board.js';
import { parseRoadmapBody } from '../roadmap.js';

import {
  labelsRelationsFixture,
  nativeRelationsFixture,
  recordingGhFixture,
  RELATIONS_FIXTURE,
  RELATIONS_FIXTURE_REPOSITORY,
  relationsContractCases,
  runRelationsContract,
} from './contract.js';

/** Every contract case name, in the order `./contract.ts` lists them. */
const CASES = {
  mode: 'reports a mode from the two the port defines',
  listFields: 'reports the json fields its mode\'s listing asks for',
  epicOfEpicItself: 'epicOf answers no epic for an epic issue itself',
  epicOfNoMark: 'epicOf answers no epic for an issue with no epic mark',
  epicOfBelongs: 'epicOf answers the epic an issue belongs to',
  membersOrder: 'membersOf answers an epic\'s members in order',
  membersTruncation: 'membersOf reports truncation only in native mode',
  membersThrows: 'membersOf throws for a row that is not an epic',
  blockersNone: 'blockersOf answers no blocker for an issue that waits on nothing',
  blockersLocal: 'blockersOf answers an issue blocked by one open and one closed local blocker',
  blockersForeign: 'blockersOf answers a foreign blocker, its state read only in native mode',
  blockersFault: 'blockersOf answers a fault in labels mode and none in native',
  freedByFrees: 'freedBy answers the open issue a closed blocker frees, whatever it closed as',
  freedByWaits: 'freedBy answers nothing for an issue still waiting on another blocker',
  freedByEmpty: 'freedBy answers an empty list for no closed issues',
  setParentSends: 'setParent sends gh and answers a write naming the issue',
  setParentRejects: 'setParent rejects when its relationship write fails',
  removeParentSends: 'removeParent sends gh and answers a write naming the issue',
  removeParentRejects: 'removeParent rejects when its relationship write fails',
  addBlockerSends: 'addBlocker sends gh and answers a write naming the issue',
  addBlockerRejects: 'addBlocker rejects when its relationship write fails',
  removeBlockerSends: 'removeBlocker sends gh and answers a write naming the issue',
  removeBlockerRejects: 'removeBlocker rejects when its relationship write fails',
  afterMergeNeverRejects: 'afterMerge never rejects, whatever gh answers',
  afterMergeNative: 'afterMerge writes nothing in native mode',
} as const;

// ---------------------------------------------------------------------------
// A small `labels`-mode reader: wraps `../epics.ts` and `../blocked.ts`, as
// the real adapter (`./labels.ts`) does.
// ---------------------------------------------------------------------------

/** `issue`'s epic, read off its `epic:` labels. */
function labelsEpicOf(issue: BoardIssue, listing: readonly BoardIssue[]): EpicOfReading {
  if (issue.type === 'epic') return { kind: 'none', issue: issue.number };
  const slugs = epicSlugsOf(issue.labels);
  if (slugs.length === 0) return { kind: 'none', issue: issue.number };
  const marks = slugs.map((slug) => ({
    mark: `${EPIC_LABEL_PREFIX}${slug}`,
    owners: listing
      .filter((row) => row.type === 'epic' && epicSlugsOf(row.labels)[0] === slug)
      .map((row) => row.number),
  }));
  return marks.length === 1 && marks[0]!.owners.length === 1
    ? { kind: 'epic', issue: issue.number, epic: marks[0]!.owners[0]!, mark: marks[0]!.mark }
    : { kind: 'unresolved', issue: issue.number, marks };
}

/** `epic`'s members, in checklist order then any group member the checklist does not name. */
function labelsMembersOf(epic: BoardIssue, listing: readonly BoardIssue[]): MembersReading {
  if (epic.type !== 'epic') throw new TypeError(`labels relations fake: #${String(epic.number)} is not typed epic`);
  const slug = epicSlugsOf(epic.labels)[0];
  const group = slug === undefined
    ? []
    : (groupByEpicLabel(listing).get(slug) ?? []);
  const byNumber = new Map(group.map((member) => [member.number, member]));
  const checklist = parseRoadmapBody(epic.body).map((line) => line.issue)
    .filter((number) => byNumber.has(number));
  const remaining = group.map((member) => member.number)
    .filter((number) => !checklist.includes(number))
    .sort((left, right) => left - right);
  const members = [...checklist, ...remaining].map((number) => byNumber.get(number)!);
  return { epic: epic.number, members };
}

/** A foreign `owner/repo#<n>` token, split into its repository and number. */
function foreignToken(token: string): { readonly repository: string; readonly number: number } {
  const match = /^(.+)#(\d+)$/.exec(token);
  return { repository: match![1]!, number: Number(match![2]) };
}

/** `issue`'s waiting reading: `readBlockedBy`, and the fault only when `spec:blocked` is carried. */
function labelsBlockersOf(issue: BoardIssue, listing: readonly BoardIssue[]): RelationsReading['blockersOf'] extends
(row: BoardIssue) => infer Reading ? Reading : never {
  const known = new Set(listing.map((row) => row.number));
  const read = readBlockedBy(issue.number, issue.body, known);
  if (read.kind === 'blocked') {
    const byNumber = new Map(listing.map((row) => [row.number, row]));
    const local = read.blockers.map((number) => ({
      number,
      repository: null,
      state: byNumber.get(number)?.state ?? null,
    }));
    const foreign = read.foreign.map((token) => {
      const parsed = foreignToken(token);
      return { number: parsed.number, repository: parsed.repository, state: null };
    });
    return { kind: 'blocked', issue: issue.number, blockers: [...local, ...foreign] };
  }
  if (!hasSpecBlockedLabel(issue.labels)) return { kind: 'none', issue: issue.number };
  return { kind: 'fault', issue: issue.number, line: read, message: blockedFaultMessage(read) };
}

// ---------------------------------------------------------------------------
// A small `native`-mode reader: reads `parent`, `blockedBy` and `subIssues`
// straight off the fixture's rows.
// ---------------------------------------------------------------------------

/** `issue`'s epic, read off its `parent` link. */
function nativeEpicOf(issue: BoardIssue, listing: readonly BoardIssue[]): EpicOfReading {
  if (issue.type === 'epic') return { kind: 'none', issue: issue.number };
  const parent = issue.parent ?? null;
  if (parent === null) return { kind: 'none', issue: issue.number };
  const local = parent.repository === RELATIONS_FIXTURE_REPOSITORY;
  const mark = local
    ? `#${String(parent.number)}`
    : `${parent.repository}#${String(parent.number)}`;
  const owner = local
    ? listing.find((row) => row.number === parent.number && row.type === 'epic')
    : undefined;
  return owner === undefined
    ? { kind: 'unresolved', issue: issue.number, marks: [{ mark, owners: [] }] }
    : { kind: 'epic', issue: issue.number, epic: owner.number, mark };
}

/** `epic`'s members, in `subIssues` order. */
function nativeMembersOf(epic: BoardIssue, listing: readonly BoardIssue[]): MembersReading {
  if (epic.type !== 'epic') throw new TypeError(`native relations fake: #${String(epic.number)} is not typed epic`);
  const subIssues = epic.subIssues ?? { nodes: [] };
  const byNumber = new Map(listing.map((row) => [row.number, row]));
  const members = subIssues.nodes.map((node) => byNumber.get(node.number)).filter((row): row is BoardIssue => row !== undefined);
  return subIssues.truncated === undefined
    ? { epic: epic.number, members }
    : { epic: epic.number, members, truncated: subIssues.truncated };
}

/** `issue`'s waiting reading, off its `blockedBy` nodes. */
function nativeBlockersOf(issue: BoardIssue): RelationsReading['blockersOf'] extends
(row: BoardIssue) => infer Reading ? Reading : never {
  const blockedBy = issue.blockedBy ?? { nodes: [] };
  if (blockedBy.nodes.length === 0) return { kind: 'none', issue: issue.number };
  const blockers = blockedBy.nodes.map((node) => ({
    number: node.number,
    repository: node.repository === RELATIONS_FIXTURE_REPOSITORY
      ? null
      : node.repository,
    state: node.state,
  }));
  return blockedBy.truncated === undefined
    ? { kind: 'blocked', issue: issue.number, blockers }
    : { kind: 'blocked', issue: issue.number, blockers, truncated: blockedBy.truncated };
}

// ---------------------------------------------------------------------------
// The one `freedBy` shared by both modes, over whichever `blockersOf` a
// mode reads with; the port note's own rule.
// ---------------------------------------------------------------------------

/** `reading`'s blockers, with any blocker numbered in `closed` read as closed. */
function pretendClosed<Reading extends { readonly kind: string }>(reading: Reading, closed: ReadonlySet<number>): Reading {
  if (reading.kind !== 'blocked') return reading;
  const blocked = reading as unknown as { readonly blockers: readonly { readonly number: number; readonly repository: string | null; readonly state: string | null }[] };
  return {
    ...reading,
    blockers: blocked.blockers.map((blocker) => (blocker.repository === null && closed.has(blocker.number)
      ? { ...blocker, state: 'CLOSED' }
      : blocker)),
  };
}

/** True when `reading` still waits, once every blocker in `closed` is pretended closed. */
function stillWaiting(reading: { readonly kind: string; readonly blockers?: readonly { readonly state: string | null }[] }): boolean {
  if (reading.kind === 'fault') return true;
  if (reading.kind !== 'blocked') return false;
  return (reading.blockers ?? []).some((blocker) => blocker.state !== 'CLOSED');
}

/** The open issues `closed` frees, over `blockersOf`; the port note's own rule. */
function freedByOf(
  listing: readonly BoardIssue[],
  closed: readonly number[],
  blockersOf: (issue: BoardIssue) => { readonly kind: string; readonly blockers?: readonly { readonly number: number; readonly repository: string | null; readonly state: string | null }[] },
): readonly number[] {
  const closedSet = new Set(closed);
  const freed = listing
    .filter((issue) => issue.state === 'OPEN')
    .filter((issue) => {
      const reading = blockersOf(issue);
      if (reading.kind !== 'blocked') return false;
      const touches = (reading.blockers ?? []).some((blocker) => blocker.repository === null && closedSet.has(blocker.number));
      return touches && !stillWaiting(pretendClosed(reading, closedSet));
    })
    .map((issue) => issue.number)
    .sort((left, right) => left - right);
  return freed;
}

// ---------------------------------------------------------------------------
// The four writes, shared by both modes: a generic write sends one call and
// answers `written`, unless `gh` fails, in which case it rejects.
// ---------------------------------------------------------------------------

/** One write naming `issue`, sent as `args`. Rejects when `gh` fails. */
async function genericWrite(gh: GhRunner, issue: number, what: string, args: readonly string[]): Promise<readonly RelationWrite[]> {
  const result = await gh(args);
  if (!result.ok) throw new Error(`${what} failed: ${result.stderr || result.stdout || 'gh failed'}`);
  return [{ issue, what, status: 'written', problem: null }];
}

/** `Closes #<n>`'s issue number, or null when `body` names none. */
function closesNumber(body: string): number | null {
  const match = /#(\d+)/.exec(body);
  return match === null
    ? null
    : Number(match[1]);
}

/** `labels`' `afterMerge`: one call per closing keyword found, never throwing. */
async function labelsAfterMerge(gh: GhRunner, request: AfterMergeRequest): Promise<readonly RelationWrite[]> {
  const issue = closesNumber(request.body);
  if (issue === null) return [];
  const what = `unblock issues waiting on #${String(issue)}`;
  const result = await gh(['relations', 'after-merge', String(issue)]);
  if (!result.ok) {
    request.warn(`could not ${what}: ${result.stderr}`);
    return [{ issue, what, status: 'failed', problem: result.stderr || result.stdout || 'gh failed' }];
  }
  return [{ issue, what, status: 'written', problem: null }];
}

// ---------------------------------------------------------------------------
// The two correct fakes.
// ---------------------------------------------------------------------------

/** A `labels`-mode `BoardRelations` over `gh`, correct against the fixture. */
function labelsRelationsBase(gh: GhRunner): BoardRelations {
  return {
    mode: 'labels',
    listFields: boardListFields('labels'),
    read: (listing) => ({
      epicOf: (issue) => labelsEpicOf(issue, listing),
      membersOf: (epic) => labelsMembersOf(epic, listing),
      blockersOf: (issue) => labelsBlockersOf(issue, listing),
      freedBy: (closed) => freedByOf(listing, closed, (issue) => labelsBlockersOf(issue, listing)),
    }),
    setParent: (_listing, change: ParentChange) => genericWrite(
      gh,
      change.issue,
      `move #${String(change.issue)} into epic #${String(change.parent)}`,
      ['issue', 'edit', String(change.issue), '--add-label', `epic:${String(change.parent)}`],
    ),
    removeParent: (_listing, change: ParentRemoval) => genericWrite(
      gh,
      change.issue,
      `take #${String(change.issue)} out of its epic`,
      ['issue', 'edit', String(change.issue), '--remove-label'],
    ),
    addBlocker: (_listing, change: BlockerChange) => genericWrite(
      gh,
      change.issue,
      `make #${String(change.issue)} wait on #${String(change.blocker.number)}`,
      ['issue', 'edit', String(change.issue), '--body'],
    ),
    removeBlocker: (_listing, change: BlockerChange) => genericWrite(
      gh,
      change.issue,
      `stop #${String(change.issue)} waiting on #${String(change.blocker.number)}`,
      ['issue', 'edit', String(change.issue), '--body'],
    ),
    afterMerge: (request) => labelsAfterMerge(gh, request),
  };
}

/** A `native`-mode `BoardRelations` over `gh`, correct against the fixture. */
function nativeRelationsBase(gh: GhRunner): BoardRelations {
  return {
    mode: 'native',
    listFields: boardListFields('native'),
    read: (listing) => ({
      epicOf: (issue) => nativeEpicOf(issue, listing),
      membersOf: (epic) => nativeMembersOf(epic, listing),
      blockersOf: (issue) => nativeBlockersOf(issue),
      freedBy: (closed) => freedByOf(listing, closed, nativeBlockersOf),
    }),
    setParent: (_listing, change: ParentChange) => genericWrite(
      gh,
      change.issue,
      `move #${String(change.issue)} into epic #${String(change.parent)}`,
      ['api', 'graphql', '-f', 'query=addSubIssue'],
    ),
    removeParent: (_listing, change: ParentRemoval) => genericWrite(
      gh,
      change.issue,
      `take #${String(change.issue)} out of its epic`,
      ['api', 'graphql', '-f', 'query=removeSubIssue'],
    ),
    addBlocker: (_listing, change: BlockerChange) => genericWrite(
      gh,
      change.issue,
      `make #${String(change.issue)} wait on #${String(change.blocker.number)}`,
      ['api', 'graphql', '-f', 'query=addBlockedBy'],
    ),
    removeBlocker: (_listing, change: BlockerChange) => genericWrite(
      gh,
      change.issue,
      `stop #${String(change.issue)} waiting on #${String(change.blocker.number)}`,
      ['api', 'graphql', '-f', 'query=removeBlockedBy'],
    ),
    afterMerge: async () => [],
  };
}

// ---------------------------------------------------------------------------
// Options and the reddened-case reader, as `src/adapters/tracker/
// contract.test.ts` builds them for the Tracker contract.
// ---------------------------------------------------------------------------

/** Contract options over a fresh base for each case, with any method `breakWith` answers in place of the base's own. */
function contractOptions(
  name: string,
  base: (gh: GhRunner) => BoardRelations,
  breakWith: (base: BoardRelations, gh: GhRunner) => Partial<BoardRelations> = () => ({}),
): { readonly name: string; readonly create: (gh: GhRunner) => BoardRelations } {
  return {
    name,
    create: (gh) => {
      const made = base(gh);
      return { ...made, ...breakWith(made, gh) };
    },
  };
}

/** The names of the cases that reject when run with `options`, in contract order. */
async function rejectedCases(options: { readonly name: string; readonly create: (gh: GhRunner) => BoardRelations }): Promise<string[]> {
  const rejected: string[] = [];
  for (const contractCase of relationsContractCases(options)) {
    try {
      await contractCase.run();
    } catch {
      rejected.push(contractCase.name);
    }
  }
  return rejected;
}

runRelationsContract(contractOptions('labels', labelsRelationsBase));
runRelationsContract(contractOptions('native', nativeRelationsBase));

describe('the BoardRelations contract cases', () => {
  it('names every case this file breaks, in contract order', () => {
    const names = relationsContractCases(contractOptions('labels', labelsRelationsBase)).map((contractCase) => contractCase.name);
    expect(names).toEqual(Object.values(CASES));
  });

  it('rejects no case for the labels fake', async () => {
    expect(await rejectedCases(contractOptions('labels', labelsRelationsBase))).toEqual([]);
  });

  it('rejects no case for the native fake', async () => {
    expect(await rejectedCases(contractOptions('native', nativeRelationsBase))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The eight write breaks, shared by both modes since a write's contract
// does not depend on which mode sends it.
// ---------------------------------------------------------------------------

/** A write override answering `written` without ever calling `gh`. */
function neverCalls<Change extends { readonly issue: number }>(): (listing: readonly BoardIssue[], change: Change) => Promise<readonly RelationWrite[]> {
  return async (_listing, change) => [{ issue: change.issue, what: 'noop', status: 'unchanged', problem: null }];
}

/** A write override that calls `gh` but answers `failed` rather than rejecting when it fails. */
function swallowsFailure<Change extends { readonly issue: number }>(
  gh: GhRunner,
): (listing: readonly BoardIssue[], change: Change) => Promise<readonly RelationWrite[]> {
  return async (_listing, change) => {
    const result = await gh(['relations', 'swallowed']);
    return [{
      issue: change.issue,
      what: 'x',
      status: result.ok
        ? 'written'
        : 'failed',
      problem: result.ok
        ? null
        : 'boom',
    }];
  };
}

/** One break: what the adapter does, and the cases it must redden. */
type Break = readonly [string, (base: BoardRelations, gh: GhRunner) => Partial<BoardRelations>, readonly string[]];

/** The write breaks: four "never calls gh" and four "swallows a failed write", shared by both modes. */
const WRITE_BREAKS: readonly Break[] = [
  ['never sends setParent to gh', () => ({ setParent: neverCalls() }), [CASES.setParentSends, CASES.setParentRejects]],
  ['swallows a failed setParent', (_base, gh) => ({ setParent: swallowsFailure(gh) }), [CASES.setParentRejects]],
  ['never sends removeParent to gh', () => ({ removeParent: neverCalls() }), [CASES.removeParentSends, CASES.removeParentRejects]],
  ['swallows a failed removeParent', (_base, gh) => ({ removeParent: swallowsFailure(gh) }), [CASES.removeParentRejects]],
  ['never sends addBlocker to gh', () => ({ addBlocker: neverCalls() }), [CASES.addBlockerSends, CASES.addBlockerRejects]],
  ['swallows a failed addBlocker', (_base, gh) => ({ addBlocker: swallowsFailure(gh) }), [CASES.addBlockerRejects]],
  ['never sends removeBlocker to gh', () => ({ removeBlocker: neverCalls() }), [CASES.removeBlockerSends, CASES.removeBlockerRejects]],
  ['swallows a failed removeBlocker', (_base, gh) => ({ removeBlocker: swallowsFailure(gh) }), [CASES.removeBlockerRejects]],
  [
    'always rejects from afterMerge',
    () => ({ afterMerge: async () => { throw new Error('boom'); } }),
    [CASES.afterMergeNeverRejects, CASES.afterMergeNative],
  ],
];

// ---------------------------------------------------------------------------
// The read breaks that behave alike in both modes: an override built from
// the base's own reading, applied identically either side.
// ---------------------------------------------------------------------------

/** An override sending every issue's `epicOf` to epic Alpha, `mark` and all, everything else from `base`. */
function everyIssueInAlpha(base: BoardRelations, mark: string): Partial<BoardRelations> {
  return {
    read: (listing) => ({
      ...base.read(listing),
      epicOf: (issue) => ({ kind: 'epic', issue: issue.number, epic: RELATIONS_FIXTURE.epicAlpha, mark }),
    }),
  };
}

/**
 * An override reporting `mode: 'both'`, naming neither mode the port
 * defines, with every read and write still made over `correctListing`
 * regardless of what a case fooled by the lie hands in: `fixtureListingFor`
 * (`./contract.ts`) picks the listing off `adapter.mode`, so a lying
 * `mode` alone would otherwise feed the wrong fixture into a real
 * adapter's reads — and a case also passes a row it read off that wrong
 * fixture (`rowOf`, `./contract.ts`), so a row handed to `epicOf`,
 * `membersOf` or `blockersOf` is re-resolved by number against
 * `correctListing` before it reaches `base`'s reading. Isolates the lie
 * to the two cases that read `mode` directly and the handful that branch
 * on it.
 */
function reportsUnknownMode(base: BoardRelations, correctListing: readonly BoardIssue[]): Partial<BoardRelations> {
  const correctRow = (row: BoardIssue): BoardIssue => correctListing.find((candidate) => candidate.number === row.number) ?? row;
  return {
    mode: 'both' as BoardRelations['mode'],
    read: () => {
      const reading = base.read(correctListing);
      return {
        epicOf: (issue) => reading.epicOf(correctRow(issue)),
        membersOf: (epic) => reading.membersOf(correctRow(epic)),
        blockersOf: (issue) => reading.blockersOf(correctRow(issue)),
        freedBy: (closed) => reading.freedBy(closed),
      };
    },
    setParent: (_listing, change: ParentChange) => base.setParent(correctListing, change),
    removeParent: (_listing, change: ParentRemoval) => base.removeParent(correctListing, change),
    addBlocker: (_listing, change: BlockerChange) => base.addBlocker(correctListing, change),
    removeBlocker: (_listing, change: BlockerChange) => base.removeBlocker(correctListing, change),
  };
}

/** An override answering no epic for every issue. */
function noEpicForAnyIssue(base: BoardRelations): Partial<BoardRelations> {
  return {
    read: (listing) => ({
      ...base.read(listing),
      epicOf: (issue) => ({ kind: 'none', issue: issue.number }),
    }),
  };
}

/** An override that sorts `membersOf` ascending and drops `truncated`. */
function membersSortedAscending(base: BoardRelations): Partial<BoardRelations> {
  return {
    read: (listing) => {
      const reading = base.read(listing);
      return {
        ...reading,
        membersOf: (epic) => {
          const answer = reading.membersOf(epic);
          return { epic: answer.epic, members: [...answer.members].sort((left, right) => left.number - right.number) };
        },
      };
    },
  };
}

/** An override that never throws for a non-epic row, answering empty members instead. */
function membersNeverThrows(base: BoardRelations): Partial<BoardRelations> {
  return {
    read: (listing) => {
      const reading = base.read(listing);
      return {
        ...reading,
        membersOf: (epic) => {
          try {
            return reading.membersOf(epic);
          } catch {
            return { epic: epic.number, members: [] };
          }
        },
      };
    },
  };
}

/** An override that adds a bogus `truncated` to every `membersOf` answer. */
function membersAlwaysTruncated(base: BoardRelations): Partial<BoardRelations> {
  return {
    read: (listing) => {
      const reading = base.read(listing);
      return {
        ...reading,
        membersOf: (epic) => ({ ...reading.membersOf(epic), truncated: { total: 999 } }),
      };
    },
  };
}

/**
 * An override answering `patch(row)` in place of `reading.blockersOf(row)`,
 * with `freedBy` recomputed over the patched `blockersOf` too: `freedBy`
 * reads through whichever `blockersOf` its reading carries, exactly as a
 * real adapter's would, so a break here reddens a `freedBy` case that
 * touches the patched issue rather than one bound to the original.
 */
function patchBlockersOf(
  base: BoardRelations,
  patch: (row: BoardIssue, fallback: ReturnType<RelationsReading['blockersOf']>) => ReturnType<RelationsReading['blockersOf']>,
): Partial<BoardRelations> {
  return {
    read: (listing) => {
      const reading = base.read(listing);
      const blockersOf = (row: BoardIssue) => patch(row, reading.blockersOf(row));
      return { ...reading, blockersOf, freedBy: (closed) => freedByOf(listing, closed, blockersOf) };
    },
  };
}

/** An override answering no blocker for `issue`, everything else from `base`. */
function blockersNoneFor(base: BoardRelations, issue: number): Partial<BoardRelations> {
  return patchBlockersOf(base, (row, fallback) => (row.number === issue
    ? { kind: 'none', issue: row.number }
    : fallback));
}

/** An override answering `#31` blocked for `issue`, everything else from `base`. */
function blockersBlockedFor(base: BoardRelations, issue: number): Partial<BoardRelations> {
  return patchBlockersOf(base, (row, fallback) => (row.number === issue
    ? { kind: 'blocked', issue: row.number, blockers: [{ number: RELATIONS_FIXTURE.openBlocker, repository: null, state: 'OPEN' }] }
    : fallback));
}

/** An override sending `freedBy` the issue waiting on two blockers, whatever it is asked. */
function freedByAlwaysIncludesWaitsOnTwo(base: BoardRelations): Partial<BoardRelations> {
  return {
    read: (listing) => {
      const reading = base.read(listing);
      return {
        ...reading,
        freedBy: (closed) => {
          const answer = reading.freedBy(closed);
          return answer.includes(RELATIONS_FIXTURE.waitsOnTwo)
            ? answer
            : [...answer, RELATIONS_FIXTURE.waitsOnTwo].sort((left, right) => left - right);
        },
      };
    },
  };
}

const SHARED_READ_BREAKS: readonly Break[] = [
  ['answers no epic for every issue', (base) => noEpicForAnyIssue(base), [CASES.epicOfBelongs]],
  ['orders members ascending instead of the mode order', (base) => membersSortedAscending(base), [CASES.membersOrder]],
  ['never throws for a row that is not an epic', (base) => membersNeverThrows(base), [CASES.membersThrows]],
  [
    'drops the widget\'s blockers',
    (base) => blockersNoneFor(base, RELATIONS_FIXTURE.blockedLocal),
    [CASES.blockersLocal, CASES.freedByFrees],
  ],
  [
    'drops the cross-repository issue\'s blockers',
    (base) => blockersNoneFor(base, RELATIONS_FIXTURE.blockedForeign),
    [CASES.blockersForeign],
  ],
  [
    'answers a blocker for the issue that waits on nothing',
    (base) => blockersBlockedFor(base, RELATIONS_FIXTURE.secondOpenBlocker),
    [CASES.blockersNone],
  ],
  [
    'always frees the issue waiting on two blockers',
    (base) => freedByAlwaysIncludesWaitsOnTwo(base),
    [CASES.freedByWaits, CASES.freedByEmpty],
  ],
];

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

const LABELS_BREAKS: readonly Break[] = [
  ['reports an unknown mode', (base) => reportsUnknownMode(base, labelsRelationsFixture), [CASES.mode]],
  ['reports the wrong json fields', () => ({ listFields: 'number,title' }), [CASES.listFields]],
  [
    'treats every issue as a member of epic Alpha',
    (base) => everyIssueInAlpha(base, 'epic:alpha'),
    [CASES.epicOfEpicItself, CASES.epicOfNoMark],
  ],
  ...SHARED_READ_BREAKS,
  [
    'answers a truncated members reading even where none is due',
    (base) => membersAlwaysTruncated(base),
    [CASES.membersTruncation],
  ],
  [
    'never reports the fault on the unreadable issue',
    (base) => blockersNoneFor(base, RELATIONS_FIXTURE.blockedFaultNoLine),
    [CASES.blockersFault],
  ],
  ...WRITE_BREAKS,
  ['never sends afterMerge to gh in labels mode', () => ({ afterMerge: async () => [] }), [CASES.afterMergeNative]],
];

describe('labels: BoardRelations contract cases', () => {
  it.each(LABELS_BREAKS)('reddens exactly the cases a labels adapter breaks when it %s', async (_label, breakWith, reddens) => {
    const options = contractOptions('labels', labelsRelationsBase, breakWith);
    expect(await rejectedCases(options)).toEqual([...reddens]);
  });

  it('holds every case to at least one break that reddens it', () => {
    const reddened = new Set(LABELS_BREAKS.flatMap(([, , reddens]) => reddens));
    expect(Object.values(CASES).filter((name) => !reddened.has(name))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// native
// ---------------------------------------------------------------------------

const NATIVE_UNKNOWN_MODE_REDDENS: readonly string[] = [
  CASES.mode,
  CASES.listFields,
  CASES.epicOfBelongs,
  CASES.membersTruncation,
  CASES.blockersForeign,
  CASES.blockersFault,
  CASES.afterMergeNative,
];

const NATIVE_BREAKS: readonly Break[] = [
  ['reports an unknown mode', (base) => reportsUnknownMode(base, nativeRelationsFixture), NATIVE_UNKNOWN_MODE_REDDENS],
  ['reports the wrong json fields', () => ({ listFields: 'number,title' }), [CASES.listFields]],
  [
    'treats every issue as a member of epic Alpha',
    (base) => everyIssueInAlpha(base, `#${String(RELATIONS_FIXTURE.epicAlpha)}`),
    [CASES.epicOfEpicItself, CASES.epicOfNoMark],
  ],
  ...SHARED_READ_BREAKS.map(([label, breakWith, reddens]): Break => (
    label === 'orders members ascending instead of the mode order'
      ? [label, breakWith, [CASES.membersOrder, CASES.membersTruncation]]
      : [label, breakWith, reddens]
  )),
  [
    'answers a fault-shaped blocked reading for the unreadable issue',
    (base) => blockersBlockedFor(base, RELATIONS_FIXTURE.blockedFaultNoLine),
    [CASES.blockersFault],
  ],
  ...WRITE_BREAKS,
  [
    'sends afterMerge to gh even though native writes nothing',
    (_base, gh) => ({
      afterMerge: async () => {
        await gh(['relations', 'after-merge']);
        return [{ issue: RELATIONS_FIXTURE.openBlocker, what: 'x', status: 'written' as const, problem: null }];
      },
    }),
    [CASES.afterMergeNative],
  ],
];

describe('native: BoardRelations contract cases', () => {
  it.each(NATIVE_BREAKS)('reddens exactly the cases a native adapter breaks when it %s', async (_label, breakWith, reddens) => {
    const options = contractOptions('native', nativeRelationsBase, breakWith);
    expect(await rejectedCases(options)).toEqual([...reddens]);
  });

  it('holds every case to at least one break that reddens it', () => {
    const reddened = new Set(NATIVE_BREAKS.flatMap(([, , reddens]) => reddens));
    expect(Object.values(CASES).filter((name) => !reddened.has(name))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two fixtures describe the same board.
// ---------------------------------------------------------------------------

describe('the paired fixture listings', () => {
  it('name the same issues, in the same states, in both modes', () => {
    const numbers = (listing: readonly BoardIssue[]) => listing.map((issue) => issue.number).sort((left, right) => left - right);
    expect(numbers(labelsRelationsFixture)).toEqual(numbers(nativeRelationsFixture));

    const states = new Map(labelsRelationsFixture.map((issue) => [issue.number, issue.state]));
    for (const issue of nativeRelationsFixture) expect(issue.state).toBe(states.get(issue.number));
  });

  it('carry no native field in labels mode', () => {
    for (const issue of labelsRelationsFixture) {
      expect(Object.keys(issue)).not.toContain('parent');
      expect(Object.keys(issue)).not.toContain('blockedBy');
      expect(Object.keys(issue)).not.toContain('subIssues');
    }
  });

  it('carry every native field in native mode', () => {
    for (const issue of nativeRelationsFixture) {
      expect(Object.keys(issue)).toContain('parent');
      expect(Object.keys(issue)).toContain('blockedBy');
      expect(Object.keys(issue)).toContain('blocking');
      expect(Object.keys(issue)).toContain('subIssuesSummary');
      expect(Object.keys(issue)).toContain('subIssues');
    }
  });
});

describe('recordingGhFixture', () => {
  it('answers the same result to every call, and keeps every argv it was sent', async () => {
    const result: GhResult = { ok: true, stdout: 'x', stderr: '' };
    const { gh, calls } = recordingGhFixture(result);

    expect(await gh(['a', 'b'])).toEqual(result);
    expect(await gh(['c'])).toEqual(result);
    expect(calls()).toEqual([['a', 'b'], ['c']]);
  });
});
