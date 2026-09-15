/**
 * Tests for the Tracker adapter contract (`src/adapters/tracker/contract.ts`).
 *
 * The contract runs over an in-memory tracker written here, twice:
 * registered through `runTrackerContract`, where every case must pass,
 * and run through `trackerContractCases`, where no case may reject.
 * That tracker is then broken one behaviour at a time, and the cases
 * that reject are held to the exact list each break must redden. That is
 * the control that every contract case can fail, and fails for the
 * behaviour it names rather than for something else: a case no break
 * reddens would hold nothing, and one case holds every case to at least
 * one break.
 *
 * A run whose `expect` fails throws out of the case's function, and a
 * failure caught here marks no case of this file failed. Measured under
 * bun 1.3.14 before this file was written, in a scratch test outside the
 * repository: a failed `toBe` and a failed `rejects.toThrow` thrown from
 * a helper and caught left the test passing.
 *
 * Two mutations of `contract.ts` were driven on 2026-09-14, with
 * `src/adapters/` at 242 pass before and after and the module restored
 * byte-identical (sha256). The limit case without its unlimited control
 * reddened one case here, the break keyed by opt, which reddens the
 * limit case only through that control. The unknown-ref rejection left
 * unawaited stayed green, because bun waits for the promise inside
 * `rejects` and throws from the call itself. Measured under bun 1.3.14
 * in a scratch test outside the repository: an unawaited
 * `rejects.toThrow` over a promise resolving 30 ms later threw at the
 * call after 32 ms, over one rejecting 30 ms later threw nothing, and
 * the call answered undefined.
 */
import type { TrackerContractOptions } from './contract.js';
import type { IssueDraft, IssueRef, IssueState, Tracker } from '../../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { draftFixture, runTrackerContract, trackerContractCases } from './contract.js';

/** Every contract case name, in the order the contract lists them. */
const CASES = {
  kind: 'reports its kind',
  projects: 'reports project support consistently with its platform',
  preflight: 'preflight resolves rather than throwing, with a reason when not ok',
  create: 'create returns a ref carrying the draft opt number, its kind and an external id',
  sharedOpt: 'create gives two drafts sharing an opt number refs of their own',
  get: 'get round-trips a created issue',
  priority: 'get round-trips the priority of a created issue',
  findModule: 'find returns a created issue when the query matches its module',
  findNoModule: 'find returns nothing for a module with no issues',
  limit: 'find respects the query limit',
  titleText: 'find matches text in the title whatever its letter case',
  bodyText: 'find matches text found only in the body',
  noText: 'find returns nothing for text neither the title nor the body holds',
  comment: 'comment is retrievable after posting',
  transition: 'transition updates the state observed by get',
  unknown: 'get rejects for an unknown ref',
} as const;

/** Faults the in-memory tracker can be made with, each breaking what it names. */
interface Faults {
  /** `create` gives an issue its draft's opt as its id, so a second draft with that opt replaces the first. */
  readonly idFromOpt?: boolean;
  /** `find` matches text against the title alone. */
  readonly textInTitleOnly?: boolean;
  /** `find` matches text without lowering its letter case. */
  readonly textCaseSensitive?: boolean;
}

/** One issue the in-memory tracker holds. */
interface HeldIssue {
  readonly draft: IssueDraft;
  readonly state: IssueState;
  readonly comments: readonly string[];
}

/** An in-memory tracker, and a reader of the comments it holds. */
function memoryTracker(faults: Faults = {}): {
  tracker: Tracker;
  comments: (ref: IssueRef) => readonly string[];
} {
  const issues = new Map<string, HeldIssue>();
  let issued = 0;

  const held = (ref: IssueRef): HeldIssue => {
    const issue = issues.get(ref.externalId);
    if (issue === undefined) throw new Error(`memory tracker: no issue ${ref.externalId}`);
    return issue;
  };

  const matchesText = (issue: HeldIssue, text: string): boolean => {
    const haystack = faults.textInTitleOnly === true
      ? issue.draft.title
      : `${issue.draft.title}\n${issue.draft.body}`;
    if (faults.textCaseSensitive === true) return haystack.includes(text);
    return haystack.toLowerCase().includes(text.toLowerCase());
  };

  const tracker: Tracker = {
    kind: 'memory',
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: async () => ({ ok: true }),
    create: async (draft) => {
      issued += 1;
      const externalId = faults.idFromOpt === true
        ? String(draft.opt)
        : String(issued);
      issues.set(externalId, { draft, state: 'todo', comments: [] });
      return { opt: draft.opt, kind: 'memory', externalId, url: null };
    },
    get: async (ref) => {
      const issue = held(ref);
      return { ...issue.draft, ref, state: issue.state };
    },
    find: async (query) => {
      const matched = [...issues].filter(([, issue]) => (
        (query.module === undefined || issue.draft.module === query.module)
        && (query.type === undefined || issue.draft.type === query.type)
        && (query.state === undefined || issue.state === query.state)
        && (query.text === undefined || matchesText(issue, query.text))
      ));
      return matched
        .slice(0, query.limit ?? matched.length)
        .map(([externalId, issue]) => ({ opt: issue.draft.opt, kind: 'memory', externalId, url: null }));
    },
    comment: async (ref, body) => {
      const issue = held(ref);
      issues.set(ref.externalId, { ...issue, comments: [...issue.comments, body] });
    },
    transition: async (ref, state) => {
      issues.set(ref.externalId, { ...held(ref), state });
      return {};
    },
  };
  return { tracker, comments: (ref) => held(ref).comments };
}

/**
 * Contract options over a fresh in-memory tracker for each case, made
 * with `faults` and with any function `breakWith` answers in place of
 * its own.
 */
function contractOptions(
  faults: Faults = {},
  breakWith: (base: Tracker) => Partial<Tracker> = () => ({}),
): TrackerContractOptions {
  let comments: (ref: IssueRef) => readonly string[] = () => [];
  return {
    name: 'memory',
    expectsProjects: false,
    expectedKind: 'memory',
    create: async () => {
      const made = memoryTracker(faults);
      comments = made.comments;
      return { ...made.tracker, ...breakWith(made.tracker) };
    },
    readComments: async (ref) => comments(ref),
  };
}

/** The names of the cases that reject when run with `options`, in contract order. */
async function rejectedCases(options: TrackerContractOptions): Promise<string[]> {
  const rejected: string[] = [];
  for (const contractCase of trackerContractCases(options)) {
    try {
      await contractCase.run();
    } catch {
      rejected.push(contractCase.name);
    }
  }
  return rejected;
}

/** Each break: what the tracker does, its options, and the cases it must redden. */
const BREAKS: readonly (readonly [string, TrackerContractOptions, readonly string[]])[] = [
  ['reports another kind', contractOptions({}, () => ({ kind: 'github' })), [CASES.kind, CASES.create]],
  [
    'claims project support',
    contractOptions({}, (base) => ({ capabilities: () => ({ ...base.capabilities(), projects: true }) })),
    [CASES.projects],
  ],
  [
    'answers not ok with an empty reason',
    contractOptions({}, () => ({ preflight: async () => ({ ok: false, reason: '' }) })),
    [CASES.preflight],
  ],
  [
    'throws from preflight',
    contractOptions({}, () => ({
      preflight: async () => {
        throw new Error('offline');
      },
    })),
    [
      CASES.preflight,
      CASES.create,
      CASES.sharedOpt,
      CASES.get,
      CASES.priority,
      CASES.findModule,
      CASES.findNoModule,
      CASES.limit,
      CASES.titleText,
      CASES.bodyText,
      CASES.noText,
      CASES.comment,
    ],
  ],
  [
    'answers a ref without the draft opt',
    contractOptions({}, (base) => ({ create: async (draft) => ({ ...(await base.create(draft)), opt: 0 }) })),
    [CASES.create],
  ],
  ['keys issues by their opt', contractOptions({ idFromOpt: true }), [CASES.sharedOpt, CASES.limit, CASES.titleText]],
  [
    'answers a fixed module',
    contractOptions({}, (base) => ({ get: async (ref) => ({ ...(await base.get(ref)), module: 'billing' }) })),
    [CASES.get],
  ],
  [
    'answers a fixed priority',
    contractOptions({}, (base) => ({ get: async (ref) => ({ ...(await base.get(ref)), priority: 'urgent' }) })),
    [CASES.priority],
  ],
  [
    'ignores the module in find',
    contractOptions({}, (base) => ({ find: async (query) => base.find({ ...query, module: undefined }) })),
    [CASES.findNoModule],
  ],
  [
    'ignores the limit in find',
    contractOptions({}, (base) => ({ find: async (query) => base.find({ ...query, limit: undefined }) })),
    [CASES.limit],
  ],
  [
    'ignores the text in find',
    contractOptions({}, (base) => ({ find: async (query) => base.find({ ...query, text: undefined }) })),
    [CASES.titleText, CASES.bodyText, CASES.noText],
  ],
  ['matches text in the title alone', contractOptions({ textInTitleOnly: true }), [CASES.bodyText]],
  ['matches text in one letter case', contractOptions({ textCaseSensitive: true }), [CASES.titleText]],
  [
    'finds nothing',
    contractOptions({}, () => ({ find: async () => [] })),
    [CASES.findModule, CASES.limit, CASES.titleText, CASES.bodyText],
  ],
  ['drops every comment', contractOptions({}, () => ({ comment: async () => {} })), [CASES.comment]],
  ['never transitions', contractOptions({}, () => ({ transition: async () => ({}) })), [CASES.transition]],
  [
    'answers an unknown ref',
    contractOptions({}, (base) => ({
      get: async (ref) => base.get(ref).catch(() => ({ ...draftFixture(), ref, state: 'todo' as const })),
    })),
    [CASES.unknown],
  ],
];

runTrackerContract(contractOptions());

describe('the Tracker contract cases', () => {
  it('names every case this file breaks, in contract order', () => {
    expect(trackerContractCases(contractOptions()).map((contractCase) => contractCase.name))
      .toEqual(Object.values(CASES));
  });

  it('rejects no case for the in-memory tracker', async () => {
    expect(await rejectedCases(contractOptions())).toEqual([]);
  });

  it.each(BREAKS)('reddens exactly the cases a tracker breaks when it %s', async (_label, options, reddens) => {
    expect(await rejectedCases(options)).toEqual([...reddens]);
  });

  it('holds every case to at least one break that reddens it', () => {
    const reddened = new Set(BREAKS.flatMap(([, , reddens]) => reddens));

    expect(Object.values(CASES).filter((name) => !reddened.has(name))).toEqual([]);
  });

  it('narrows the transition case to the states it is handed', async () => {
    const neverTransitions = contractOptions({}, () => ({ transition: async () => ({}) }));

    expect(await rejectedCases({ ...neverTransitions, transitionableStates: ['todo'] })).toEqual([]);
  });

  it('asks for the unknown external id it is handed', async () => {
    const answers999 = contractOptions({}, (base) => ({
      get: async (ref) => {
        if (ref.externalId !== '999') return base.get(ref);
        return { ...draftFixture(), ref, state: 'todo' };
      },
    }));

    expect(await rejectedCases(answers999)).toEqual([CASES.unknown]);
    expect(await rejectedCases({ ...answers999, unknownExternalId: 'missing' })).toEqual([]);
  });
});

describe('draftFixture', () => {
  it('answers the source fixture with any field replaced', () => {
    expect(draftFixture({ opt: 0, priority: null })).toEqual({
      opt: 0,
      title: 'Fix TOTP replay window off-by-one',
      body: '## Context\n\nCodes stay valid one step too long.\n',
      type: 'bug',
      module: 'auth',
      priority: null,
      project: 'Auth Hardening',
      blockedBy: [],
    });
  });
});
