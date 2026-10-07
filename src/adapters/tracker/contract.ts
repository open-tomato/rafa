/**
 * The Tracker adapter contract: what every tracker adapter does,
 * whatever platform it projects issues onto.
 *
 * Copied from `runTrackerContract` in open-tomato's
 * `packages/shared/issue-tracker/src/testing/contract.ts` at commit
 * `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05), and ported
 * from vitest to `bun:test`. An adapter's test file calls
 * {@link runTrackerContract} with a factory answering a fresh adapter
 * for each case: the `local` adapter's over a temporary directory, a
 * remote adapter's over a recorded fake. No case touches the network.
 *
 * This module is a test helper that is not itself a test file: bun runs
 * no case until a `*.test.ts` calls it, and `check-types` reads it,
 * where it reads no test file.
 *
 * ## What the port changes
 *
 *   - Identity. rafa ports no OPT ledger, and triage passes `opt: 0` in
 *     every draft, leaving each adapter to give an issue its own
 *     `externalId`. So refs are compared by `externalId`, never by
 *     `opt`, and a case the source lacks creates two drafts sharing
 *     `opt: 0` and holds them to distinct refs that each read back their
 *     own issue. The limit case creates its two issues that way, and
 *     first holds the query to both without the limit. The create case
 *     still holds `ref.opt` to the draft's.
 *   - `find` by text: three cases the source lacks. Text found in the
 *     title in another letter case, text found only in the body, and
 *     text neither holds. The source's `local` adapter already matched
 *     so, and its GitHub fake's `issue list --search` filters the same
 *     way.
 *   - Kind. The source held the kind to its closed `TRACKER_KINDS`
 *     too; rafa's `TrackerKind` admits any name, so the kind is held to
 *     `expectedKind` alone.
 *   - Preflight. An answer that is not ok also carries a non-empty
 *     reason, which the degradation chain logs and records.
 *   - The unknown ref names `externalId: '999'` by default, where the
 *     source named `'missing'`. That is well formed for an adapter whose
 *     ids are numbers, so such an adapter rejects the ref for being
 *     absent rather than for being malformed. `unknownExternalId`
 *     overrides it.
 *   - `openIssues`: rafa's own optional reading, which the source
 *     lacks, with three cases of its own. The open issues of a type are
 *     answered with their titles and bodies, an issue moved to `done` or
 *     to `cancelled` is left out, and a type with no open issue answers
 *     none. Order is the adapter's, so ids are compared sorted. An
 *     adapter run with `readsOpenIssues: false` is held to leaving the
 *     reading out instead, by one case in place of the three.
 *   - `editable` and `edit`: rafa's own optional pair, which the source
 *     lacks, with five cases of their own. `editable` answers a created
 *     issue's title, body and open state, with labels and an author
 *     whatever the tracker holds of them, and answers an issue moved to
 *     `done` or to `cancelled` as closed. `edit` writes a body that
 *     `editable` and `get` read back byte for byte, leaving the title
 *     and every other issue as they were; writes a title alone, leaving
 *     the body; and both members reject an unknown ref. Unlike
 *     `openIssues`, the pair is held only when an adapter is run with
 *     `editsIssues: true`; one run without it is held to leaving both
 *     out instead, by one case in place of the five.
 *   - The cases are also answered as a list, by
 *     {@link trackerContractCases}, each a name and a function that
 *     rejects when the adapter breaks the case. {@link runTrackerContract}
 *     registers that list, and `contract.test.ts` runs it against broken
 *     adapters to hold which cases reject: the control that each case can
 *     fail. Case names hold no apostrophe, which `eslint --fix` escapes.
 */
import type {
  EditableIssue,
  IssueDraft,
  IssueRef,
  IssueState,
  IssueType,
  Tracker,
  TrackerKind,
} from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { ISSUE_STATES } from './issue-values.js';

/** What the contract is run with. */
export interface TrackerContractOptions {
  /** Names the suite. */
  readonly name: string;
  /** A fresh, isolated tracker for each case. */
  readonly create: () => Promise<Tracker>;
  /** Whether the adapter reports project support. */
  readonly expectsProjects: boolean;
  /** The `TrackerKind` the adapter reports. */
  readonly expectedKind: TrackerKind;
  /** Reads back the comments posted on an issue, from the adapter's own storage. */
  readonly readComments: (ref: IssueRef) => Promise<readonly string[]>;
  /**
   * The states the tracker round-trips through `transition` then `get`.
   * Every state when left out. A platform whose state model is coarser
   * than the port's narrows it.
   */
  readonly transitionableStates?: readonly IssueState[];
  /** An `externalId` no fresh tracker holds. `'999'` when left out. */
  readonly unknownExternalId?: string;
  /** Whether the adapter implements the optional `openIssues` reading. True when left out. */
  readonly readsOpenIssues?: boolean;
  /**
   * Whether the adapter implements the optional `editable` and `edit`
   * pair. False when left out, so an adapter declares the pair it edits
   * through rather than being held to one it never wrote.
   */
  readonly editsIssues?: boolean;
}

/** One contract case: its name, and a run that rejects when the adapter breaks it. */
export interface TrackerContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** A draft for a case, with any field replaced. */
export function draftFixture(overrides: Partial<IssueDraft> = {}): IssueDraft {
  return {
    opt: 260,
    title: 'Fix TOTP replay window off-by-one',
    body: '## Context\n\nCodes stay valid one step too long.\n',
    type: 'bug',
    module: 'auth',
    priority: 'urgent',
    project: 'Auth Hardening',
    blockedBy: [],
    ...overrides,
  };
}

/** The external ids of a list of refs, in order. */
function externalIds(refs: readonly IssueRef[]): string[] {
  return refs.map((ref) => ref.externalId);
}

/** The `openIssues` reading of a tracker. Throws when the tracker has none. */
function openIssuesOf(tracker: Tracker): NonNullable<Tracker['openIssues']> {
  if (tracker.openIssues === undefined) throw new Error(`the ${tracker.kind} tracker has no openIssues reading`);
  return tracker.openIssues;
}

/** An open issue as a case compares it: its external id, title and body. */
type OpenIssueRow = readonly [externalId: string, title: string, body: string];

/** `rows` sorted by external id, since the order `openIssues` answers in is the adapter's. */
function sortedRows(rows: readonly OpenIssueRow[]): OpenIssueRow[] {
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}

/** The open issues of `type` as rows, sorted by external id. */
async function openIssueRows(tracker: Tracker, type: IssueType): Promise<OpenIssueRow[]> {
  const open = await openIssuesOf(tracker)(type);
  return sortedRows(open.map((issue): OpenIssueRow => [issue.ref.externalId, issue.title, issue.body]));
}

/** The cases of the optional `openIssues` reading, or the one case holding it left out. */
function openIssuesCases(options: TrackerContractOptions): readonly TrackerContractCase[] {
  const { create } = options;
  if (options.readsOpenIssues === false) {
    return [
      {
        name: 'leaves out the openIssues reading it is run without',
        run: async () => {
          const tracker = await create();

          expect(tracker.openIssues).toBeUndefined();
        },
      },
    ];
  }

  return [
    {
      name: 'openIssues answers each open issue of the type with its title and body',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const replay = await tracker.create(draftFixture({ opt: 0, title: 'Replay window', body: 'Codes stay valid.\n' }));
        const keys = await tracker.create(draftFixture({ opt: 0, title: 'Signing keys', body: 'Keys never rotate.\n' }));
        await tracker.create(draftFixture({ opt: 0, type: 'spike', title: 'Try passkeys' }));

        const open = await openIssuesOf(tracker)('bug');

        expect(open.every((issue) => issue.ref.kind === tracker.kind)).toBe(true);
        expect(await openIssueRows(tracker, 'bug')).toEqual(sortedRows([
          [replay.externalId, 'Replay window', 'Codes stay valid.\n'],
          [keys.externalId, 'Signing keys', 'Keys never rotate.\n'],
        ]));
      },
    },
    {
      name: 'openIssues leaves out an issue moved to done or to cancelled',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const open = await tracker.create(draftFixture({ opt: 0, title: 'Still open' }));
        const done = await tracker.create(draftFixture({ opt: 0, title: 'Fixed' }));
        const cancelled = await tracker.create(draftFixture({ opt: 0, title: 'Not planned' }));

        expect(await openIssueRows(tracker, 'bug')).toHaveLength(3);
        await tracker.transition(done, 'done');
        await tracker.transition(cancelled, 'cancelled');

        expect((await openIssueRows(tracker, 'bug')).map(([id]) => id)).toEqual([open.externalId]);
      },
    },
    {
      name: 'openIssues answers nothing for a type with no open issue',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        await tracker.create(draftFixture());

        expect(await openIssuesOf(tracker)('chore')).toEqual([]);
      },
    },
  ];
}

/** The `editable` and `edit` pair of a tracker. Throws when the tracker lacks either. */
function editMembersOf(tracker: Tracker): {
  editable: NonNullable<Tracker['editable']>;
  edit: NonNullable<Tracker['edit']>;
} {
  const { editable, edit } = tracker;
  if (editable === undefined || edit === undefined) {
    throw new Error(`the ${tracker.kind} tracker has no editable and edit pair`);
  }
  return { editable, edit };
}

/** A body for the edit cases: markdown, a non-ASCII letter, an inner blank line and a trailing newline. */
const EDITED_BODY = '## Context\n\nCodes stay valid one step too long.\n\n**Updated 2026-10-06, café notes:**\n\nNarrow the window.\n';

/** What a case compares of an editable issue: everything but the ref, and the ref's id and kind. */
function editableRow(issue: EditableIssue): Omit<EditableIssue, 'ref'> & { readonly id: string; readonly kind: string } {
  const { ref, ...rest } = issue;
  return { ...rest, id: ref.externalId, kind: ref.kind };
}

/** The cases of the optional `editable` and `edit` pair, or the one case holding it left out. */
function editCases(options: TrackerContractOptions): readonly TrackerContractCase[] {
  const { create } = options;
  if (options.editsIssues !== true) {
    return [
      {
        name: 'leaves out the editable and edit pair it is run without',
        run: async () => {
          const tracker = await create();

          expect(tracker.editable).toBeUndefined();
          expect(tracker.edit).toBeUndefined();
        },
      },
    ];
  }

  return [
    {
      name: 'editable answers the title, body and open state of a created issue',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const ref = await tracker.create(draftFixture({ opt: 0, title: 'Replay window', body: 'Codes stay valid.\n' }));

        const row = editableRow(await editMembersOf(tracker).editable(ref));

        expect(row).toMatchObject({ id: ref.externalId, kind: tracker.kind, title: 'Replay window' });
        expect(row).toMatchObject({ body: 'Codes stay valid.\n', open: true });
        expect(typeof row.author).toBe('string');
        expect(Array.isArray(row.labels) && row.labels.every((label) => typeof label === 'string')).toBe(true);
      },
    },
    {
      name: 'editable answers an issue moved to done or to cancelled as closed',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const done = await tracker.create(draftFixture({ opt: 0, title: 'Fixed' }));
        const cancelled = await tracker.create(draftFixture({ opt: 0, title: 'Not planned' }));
        const { editable } = editMembersOf(tracker);

        expect([(await editable(done)).open, (await editable(cancelled)).open]).toEqual([true, true]);
        await tracker.transition(done, 'done');
        await tracker.transition(cancelled, 'cancelled');

        expect([(await editable(done)).open, (await editable(cancelled)).open]).toEqual([false, false]);
      },
    },
    {
      name: 'edit writes a body read back byte for byte, leaving the title and every other issue',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const edited = await tracker.create(draftFixture({ opt: 0, title: 'Replay window' }));
        const other = await tracker.create(draftFixture({ opt: 0, title: 'Signing keys', body: 'Keys never rotate.\n' }));
        const { editable, edit } = editMembersOf(tracker);

        await edit(edited, { body: EDITED_BODY });

        expect((await editable(edited)).body).toBe(EDITED_BODY);
        expect((await tracker.get(edited)).body).toBe(EDITED_BODY);
        expect((await editable(edited)).title).toBe('Replay window');
        expect(await editable(other)).toMatchObject({ title: 'Signing keys', body: 'Keys never rotate.\n' });
      },
    },
    {
      name: 'edit writes a title alone, leaving the body',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const ref = await tracker.create(draftFixture({ opt: 0, title: 'Replay window', body: 'Codes stay valid.\n' }));
        const { editable, edit } = editMembersOf(tracker);

        await edit(ref, { title: 'Narrow the replay window' });

        expect(await editable(ref)).toMatchObject({ title: 'Narrow the replay window', body: 'Codes stay valid.\n' });
        expect((await tracker.get(ref)).title).toBe('Narrow the replay window');
      },
    },
    {
      name: 'editable and edit reject for an unknown ref',
      run: async () => {
        const tracker = await create();
        const unknown: IssueRef = {
          opt: 999,
          kind: tracker.kind,
          externalId: options.unknownExternalId ?? '999',
          url: null,
        };
        const { editable, edit } = editMembersOf(tracker);

        await expect(editable(unknown)).rejects.toThrow();
        await expect(edit(unknown, { body: EDITED_BODY })).rejects.toThrow();
      },
    },
  ];
}

/** Every contract case, in the order {@link runTrackerContract} registers them. */
export function trackerContractCases(options: TrackerContractOptions): readonly TrackerContractCase[] {
  const { create } = options;

  return [
    {
      name: 'reports its kind',
      run: async () => {
        const tracker = await create();

        expect(tracker.kind).toBe(options.expectedKind);
      },
    },
    {
      name: 'reports project support consistently with its platform',
      run: async () => {
        const tracker = await create();

        expect(tracker.capabilities().projects).toBe(options.expectsProjects);
      },
    },
    {
      name: 'preflight resolves rather than throwing, with a reason when not ok',
      run: async () => {
        const tracker = await create();

        const result = await tracker.preflight();

        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          expect(typeof result.reason).toBe('string');
          expect(result.reason.length).toBeGreaterThan(0);
        }
      },
    },
    {
      name: 'create returns a ref carrying the draft opt number, its kind and an external id',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();

        const ref = await tracker.create(draftFixture());

        expect(ref.opt).toBe(260);
        expect(ref.kind).toBe(tracker.kind);
        expect(typeof ref.externalId).toBe('string');
        expect(ref.externalId.length).toBeGreaterThan(0);
      },
    },
    {
      name: 'create gives two drafts sharing an opt number refs of their own',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();

        const first = await tracker.create(draftFixture({ opt: 0, title: 'First of two' }));
        const second = await tracker.create(draftFixture({ opt: 0, title: 'Second of two' }));

        expect(second.externalId).not.toBe(first.externalId);
        expect((await tracker.get(first)).title).toBe('First of two');
        expect((await tracker.get(second)).title).toBe('Second of two');
      },
    },
    {
      name: 'get round-trips a created issue',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();

        const ref = await tracker.create(draftFixture({ title: 'Fix a round trip' }));
        const issue = await tracker.get(ref);

        expect(issue.title).toBe('Fix a round trip');
        expect(issue.module).toBe('auth');
        expect(issue.type).toBe('bug');
      },
    },
    {
      name: 'get round-trips the priority of a created issue',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();

        // `high` rather than the fixture's `urgent`, so an adapter that
        // answers a fixed priority cannot pass by accident.
        const ref = await tracker.create(draftFixture({ priority: 'high' }));
        const issue = await tracker.get(ref);

        expect(issue.priority).toBe('high');
      },
    },
    {
      name: 'find returns a created issue when the query matches its module',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const ref = await tracker.create(draftFixture());

        const found = await tracker.find({ module: 'auth' });

        expect(externalIds(found)).toContain(ref.externalId);
      },
    },
    {
      name: 'find returns nothing for a module with no issues',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        await tracker.create(draftFixture());

        expect(await tracker.find({ module: 'billing' })).toEqual([]);
      },
    },
    {
      name: 'find respects the query limit',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        await tracker.create(draftFixture({ opt: 0 }));
        await tracker.create(draftFixture({ opt: 0 }));

        expect(await tracker.find({ module: 'auth' })).toHaveLength(2);
        expect(await tracker.find({ module: 'auth', limit: 1 })).toHaveLength(1);
      },
    },
    {
      name: 'find matches text in the title whatever its letter case',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const replay = await tracker.create(draftFixture({
          title: 'Fix TOTP replay window',
          body: 'Codes stay valid.\n',
        }));
        await tracker.create(draftFixture({ title: 'Rotate signing keys', body: 'Keys never rotate.\n' }));

        expect(externalIds(await tracker.find({ text: 'totp REPLAY' }))).toEqual([replay.externalId]);
      },
    },
    {
      name: 'find matches text found only in the body',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        await tracker.create(draftFixture({ title: 'Fix TOTP replay window', body: 'Codes stay valid.\n' }));
        const leak = await tracker.create(draftFixture({
          title: 'Rotate signing keys',
          body: 'The staging box leaks keys.\n',
        }));

        expect(externalIds(await tracker.find({ text: 'staging box' }))).toEqual([leak.externalId]);
      },
    },
    {
      name: 'find returns nothing for text neither the title nor the body holds',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        await tracker.create(draftFixture());

        expect(await tracker.find({ text: 'no such words' })).toEqual([]);
      },
    },
    {
      name: 'comment is retrievable after posting',
      run: async () => {
        const tracker = await create();
        await tracker.preflight();
        const ref = await tracker.create(draftFixture());
        const body = 'more evidence';

        await tracker.comment(ref, body);
        const comments = await options.readComments(ref);

        expect(comments.some((comment) => comment.includes(body))).toBe(true);
      },
    },
    {
      name: 'transition updates the state observed by get',
      run: async () => {
        const tracker = await create();
        const ref = await tracker.create(draftFixture());

        for (const state of options.transitionableStates ?? ISSUE_STATES) {
          await tracker.transition(ref, state);
          expect((await tracker.get(ref)).state).toBe(state);
        }
      },
    },
    {
      name: 'get rejects for an unknown ref',
      run: async () => {
        const tracker = await create();

        // bun 1.3.14 waits for the promise inside `rejects` and answers
        // undefined, so this `await` changes nothing under bun: dropping
        // it left every case green. It stays so the case does not rest on
        // that, as the source awaits the same assertion under vitest.
        await expect(tracker.get({
          opt: 999,
          kind: tracker.kind,
          externalId: options.unknownExternalId ?? '999',
          url: null,
        })).rejects.toThrow();
      },
    },
    ...openIssuesCases(options),
    ...editCases(options),
  ];
}

/** Registers every contract case under one `describe`, named for the adapter. */
export function runTrackerContract(options: TrackerContractOptions): void {
  describe(`${options.name}: Tracker contract`, () => {
    for (const contractCase of trackerContractCases(options)) {
      it(contractCase.name, contractCase.run);
    }
  });
}
