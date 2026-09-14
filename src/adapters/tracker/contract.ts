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
 *   - The cases are also answered as a list, by
 *     {@link trackerContractCases}, each a name and a function that
 *     rejects when the adapter breaks the case. {@link runTrackerContract}
 *     registers that list, and `contract.test.ts` runs it against broken
 *     adapters to hold which cases reject: the control that each case can
 *     fail. Case names hold no apostrophe, which `eslint --fix` escapes.
 */
import type { IssueDraft, IssueRef, IssueState, Tracker, TrackerKind } from '../../ports/index.js';

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
