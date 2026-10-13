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
 *
 * The three `openIssues` cases arrived on 2026-10-02, each held by the
 * breaks below, and by a tracker run with `readsOpenIssues: false` that
 * still has the reading, which reddens the one case standing in for
 * them. They create their issues with `opt: 0`, as triage does, so the
 * break keying issues by opt reddens two of them too, and the
 * transition case narrowed to `todo` no longer leaves every case
 * green: the closed case moves its issues to `done` and `cancelled`
 * whatever the narrowing, and rejects for a tracker that never moves.
 *
 * The fourth `openIssues` case, the `createdAt` one, arrived on
 * 2026-10-12, held by five breaks of its own below: a null time, no
 * time, a time that is no time, a tracker dating its first issue alone,
 * which is what holds the case to every issue rather than to one, and a
 * tracker answering no open issue, which is what holds it to having read
 * an issue at all. It creates its two issues with `opt: 0` and compares
 * no count, so the break keying issues by opt leaves it green.
 *
 * The five `editable` and `edit` cases arrived on 2026-10-06, each held
 * by the breaks below. The in-memory tracker is run with
 * `editsIssues: true`, and three earlier breaks redden one of them as
 * well, as measured before their lists were widened: another kind
 * reddens the editable case, keying issues by opt the body case, whose
 * second issue replaces the first, and a tracker that never moves the
 * closed case, narrowed or not. A body written with its trailing newline
 * trimmed reddens the body case alone, which is what holds it to byte
 * for byte.
 *
 * The four priority cases arrived on 2026-10-13, each held by the breaks
 * below. The in-memory tracker is run with `editsPriority: true`, and
 * nine earlier breaks redden one or more of them as well: a missing
 * pair, a missing `edit` and a throwing preflight all four, keying
 * issues by opt the two that create two issues, a fixed priority from
 * `get` the two that read `get`, an empty body from `editable` the two
 * that read the body, every edit dropped the three that edit, and an
 * edit written onto every issue or clearing the title the first edit
 * case. A tracker run without `editsPriority` that still answers a
 * priority reddens the one case standing in for the four.
 */
import type { TrackerContractOptions } from './contract.js';
import type { EditableIssue, IssueDraft, IssueEdit, IssueRef, IssueState, Tracker } from '../../ports/index.js';

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
  openOfType: 'openIssues answers each open issue of the type with its title and body',
  openClosed: 'openIssues leaves out an issue moved to done or to cancelled',
  openNone: 'openIssues answers nothing for a type with no open issue',
  openCreatedAt: 'openIssues answers each open issue with a createdAt that parses as a time',
  editable: 'editable answers the title, body and open state of a created issue',
  editableClosed: 'editable answers an issue moved to done or to cancelled as closed',
  editBody: 'edit writes a body read back byte for byte, leaving the title and every other issue',
  editTitle: 'edit writes a title alone, leaving the body',
  editUnknown: 'editable and edit reject for an unknown ref',
  editablePriority: 'editable answers the priority of a created issue, and null before triage sets one',
  editPriority: 'edit writes a priority read back by editable and get, leaving the title, the body and every other issue',
  editPrioritySwap: 'edit swaps one priority for another',
  editPriorityTitle: 'edit writes a priority beside a title, leaving the body',
} as const;

/** The case an adapter run with `readsOpenIssues: false` gets in place of the four `openIssues` cases. */
const LEFT_OUT_CASE = 'leaves out the openIssues reading it is run without';

/** The case an adapter run without `editsIssues` gets in place of the nine `editable` and `edit` cases. */
const EDIT_LEFT_OUT_CASE = 'leaves out the editable and edit pair it is run without';

/** The case an adapter with the pair, run without `editsPriority`, gets in place of the four priority cases. */
const PRIORITY_LEFT_OUT_CASE = 'answers no priority from editable, run without the priority edit';

/** The names of the four priority cases, in contract order. */
const PRIORITY_CASES: readonly string[] = [
  CASES.editablePriority,
  CASES.editPriority,
  CASES.editPrioritySwap,
  CASES.editPriorityTitle,
];

/** The names of the nine `editable` and `edit` cases, the four priority ones last, in contract order. */
const EDIT_CASES: readonly string[] = [
  CASES.editable,
  CASES.editableClosed,
  CASES.editBody,
  CASES.editTitle,
  CASES.editUnknown,
  ...PRIORITY_CASES,
];

/** Faults the in-memory tracker can be made with, each breaking what it names. */
interface Faults {
  /** `create` gives an issue its draft's opt as its id, so a second draft with that opt replaces the first. */
  readonly idFromOpt?: boolean;
  /** `find` matches text against the title alone. */
  readonly textInTitleOnly?: boolean;
  /** `find` matches text without lowering its letter case. */
  readonly textCaseSensitive?: boolean;
  /** `openIssues` answers closed issues too. */
  readonly closedAsOpen?: boolean;
  /** `openIssues` answers open issues of every type. */
  readonly anyType?: boolean;
  /** `openIssues` answers the first issue created with its time, and every later one with none. */
  readonly datesFirstOnly?: boolean;
  /** `edit` writes its change onto every issue held, not the one its ref names. */
  readonly editsEveryIssue?: boolean;
  /** `edit` given no title clears the one held. */
  readonly bodyEditClearsTitle?: boolean;
  /** `edit` writes a priority onto an issue triage has set none for, and never over one already set. */
  readonly neverSwapsPriority?: boolean;
}

/** The states the in-memory tracker holds closed, as the port's `openIssues` note names them. */
const CLOSED: ReadonlySet<IssueState> = new Set(['done', 'released', 'cancelled']);

/** One issue the in-memory tracker holds. */
interface HeldIssue {
  readonly draft: IssueDraft;
  readonly state: IssueState;
  readonly comments: readonly string[];
  /** When `create` made it, or null for one the tracker holds no time for. */
  readonly createdAt: string | null;
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
      const createdAt = faults.datesFirstOnly === true && issued > 1
        ? null
        : new Date().toISOString();
      issues.set(externalId, { draft, state: 'todo', comments: [], createdAt });
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
    openIssues: async (type) => [...issues]
      .filter(([, issue]) => (faults.anyType === true || issue.draft.type === type)
        && (faults.closedAsOpen === true || !CLOSED.has(issue.state)))
      .map(([externalId, issue]) => ({
        ref: { opt: issue.draft.opt, kind: 'memory', externalId, url: null },
        title: issue.draft.title,
        body: issue.draft.body,
        createdAt: issue.createdAt,
      })),
    editable: async (ref) => {
      const issue = held(ref);
      return {
        ref,
        title: issue.draft.title,
        body: issue.draft.body,
        open: !CLOSED.has(issue.state),
        labels: [],
        author: '',
        priority: issue.draft.priority,
      };
    },
    edit: async (ref, change) => {
      held(ref);
      const targets = faults.editsEveryIssue === true
        ? [...issues.keys()]
        : [ref.externalId];
      for (const externalId of targets) {
        const issue = held({ ...ref, externalId });
        const title = faults.bodyEditClearsTitle === true && change.title === undefined
          ? ''
          : change.title ?? issue.draft.title;
        const priority = faults.neverSwapsPriority === true && issue.draft.priority !== null
          ? issue.draft.priority
          : change.priority ?? issue.draft.priority;
        const draft = { ...issue.draft, title, body: change.body ?? issue.draft.body, priority };
        issues.set(externalId, { ...issue, draft });
      }
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
    editsIssues: true,
    editsPriority: true,
    create: async () => {
      const made = memoryTracker(faults);
      comments = made.comments;
      return { ...made.tracker, ...breakWith(made.tracker) };
    },
    readComments: async (ref) => comments(ref),
  };
}

/** The `editable` member of a tracker, which every tracker here has. */
function editableOf(tracker: Tracker): NonNullable<Tracker['editable']> {
  if (tracker.editable === undefined) throw new Error('memory tracker: no editable member');
  return tracker.editable;
}

/** The `edit` member of a tracker, which every tracker here has. */
function editOf(tracker: Tracker): NonNullable<Tracker['edit']> {
  if (tracker.edit === undefined) throw new Error('memory tracker: no edit member');
  return tracker.edit;
}

/** `issue` as a tracker whose pair reads no priority answers it. */
function withoutPriority(issue: EditableIssue): EditableIssue {
  return Object.fromEntries(Object.entries(issue).filter(([key]) => key !== 'priority')) as unknown as EditableIssue;
}

/**
 * `change` with its priority left out. Cast: a change naming a priority
 * alone becomes one naming nothing, which the port's type rules out and
 * the in-memory tracker writes as no change.
 */
function withoutChangedPriority(change: IssueEdit): IssueEdit {
  return Object.fromEntries(Object.entries(change).filter(([key]) => key !== 'priority')) as unknown as IssueEdit;
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
  ['reports another kind', contractOptions({}, () => ({ kind: 'github' })), [CASES.kind, CASES.create, CASES.openOfType, CASES.editable]],
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
      CASES.openOfType,
      CASES.openClosed,
      CASES.openNone,
      CASES.openCreatedAt,
      CASES.editable,
      CASES.editableClosed,
      CASES.editBody,
      CASES.editTitle,
      ...PRIORITY_CASES,
    ],
  ],
  [
    'answers a ref without the draft opt',
    contractOptions({}, (base) => ({ create: async (draft) => ({ ...(await base.create(draft)), opt: 0 }) })),
    [CASES.create],
  ],
  [
    'keys issues by their opt',
    contractOptions({ idFromOpt: true }),
    [
      CASES.sharedOpt,
      CASES.limit,
      CASES.titleText,
      CASES.openOfType,
      CASES.openClosed,
      CASES.editBody,
      CASES.editablePriority,
      CASES.editPriority,
    ],
  ],
  [
    'answers a fixed module',
    contractOptions({}, (base) => ({ get: async (ref) => ({ ...(await base.get(ref)), module: 'billing' }) })),
    [CASES.get],
  ],
  [
    'answers a fixed priority',
    contractOptions({}, (base) => ({ get: async (ref) => ({ ...(await base.get(ref)), priority: 'urgent' }) })),
    [CASES.priority, CASES.editPriority, CASES.editPrioritySwap],
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
  ['never transitions', contractOptions({}, () => ({ transition: async () => ({}) })), [CASES.transition, CASES.openClosed, CASES.editableClosed]],
  [
    'answers an unknown ref',
    contractOptions({}, (base) => ({
      get: async (ref) => base.get(ref).catch(() => ({ ...draftFixture(), ref, state: 'todo' as const })),
    })),
    [CASES.unknown],
  ],
  [
    'has no openIssues reading',
    contractOptions({}, () => ({ openIssues: undefined })),
    [CASES.openOfType, CASES.openClosed, CASES.openNone, CASES.openCreatedAt],
  ],
  ['answers closed issues from openIssues', contractOptions({ closedAsOpen: true }), [CASES.openClosed]],
  ['ignores the type in openIssues', contractOptions({ anyType: true }), [CASES.openOfType, CASES.openNone]],
  [
    'answers open issues without their bodies',
    contractOptions({}, (base) => ({
      openIssues: async (type) => ((await base.openIssues?.(type)) ?? []).map((issue) => ({ ...issue, body: '' })),
    })),
    [CASES.openOfType],
  ],
  [
    'answers open issues under another kind',
    contractOptions({}, (base) => ({
      openIssues: async (type) => ((await base.openIssues?.(type)) ?? [])
        .map((issue) => ({ ...issue, ref: { ...issue.ref, kind: 'github' } })),
    })),
    [CASES.openOfType],
  ],
  [
    'answers open issues with a null createdAt',
    contractOptions({}, (base) => ({
      openIssues: async (type) => ((await base.openIssues?.(type)) ?? []).map((issue) => ({ ...issue, createdAt: null })),
    })),
    [CASES.openCreatedAt],
  ],
  [
    'answers open issues with no createdAt',
    contractOptions({}, (base) => ({
      openIssues: async (type) => ((await base.openIssues?.(type)) ?? [])
        .map((issue) => ({ ...issue, createdAt: undefined as unknown as string })),
    })),
    [CASES.openCreatedAt],
  ],
  [
    'answers open issues with a createdAt that is no time',
    contractOptions({}, (base) => ({
      openIssues: async (type) => ((await base.openIssues?.(type)) ?? []).map((issue) => ({ ...issue, createdAt: 'yesterday' })),
    })),
    [CASES.openCreatedAt],
  ],
  ['dates the first open issue alone', contractOptions({ datesFirstOnly: true }), [CASES.openCreatedAt]],
  [
    'answers no open issue at all',
    contractOptions({}, () => ({ openIssues: async () => [] })),
    [CASES.openOfType, CASES.openClosed, CASES.openCreatedAt],
  ],
  ['has no editable and edit pair', contractOptions({}, () => ({ editable: undefined, edit: undefined })), EDIT_CASES],
  ['has editable without edit', contractOptions({}, () => ({ edit: undefined })), EDIT_CASES],
  [
    'answers editable under another kind',
    contractOptions({}, (base) => ({
      editable: async (ref) => ({ ...(await editableOf(base)(ref)), ref: { ...ref, kind: 'github' } }),
    })),
    [CASES.editable],
  ],
  [
    'answers editable without an author',
    contractOptions({}, (base) => ({
      editable: async (ref) => ({ ...(await editableOf(base)(ref)), author: undefined as unknown as string }),
    })),
    [CASES.editable],
  ],
  [
    'answers every issue open from editable',
    contractOptions({}, (base) => ({ editable: async (ref) => ({ ...(await editableOf(base)(ref)), open: true }) })),
    [CASES.editableClosed],
  ],
  [
    'answers editable with an empty body',
    contractOptions({}, (base) => ({ editable: async (ref) => ({ ...(await editableOf(base)(ref)), body: '' }) })),
    [CASES.editable, CASES.editBody, CASES.editTitle, CASES.editPriority, CASES.editPriorityTitle],
  ],
  [
    'answers an unknown ref from editable',
    contractOptions({}, (base) => ({
      editable: async (ref) => editableOf(base)(ref).catch(() => ({
        ref,
        title: '',
        body: '',
        open: true,
        labels: [],
        author: '',
      })),
    })),
    [CASES.editUnknown],
  ],
  [
    'drops every edit',
    contractOptions({}, () => ({ edit: async () => {} })),
    [CASES.editBody, CASES.editTitle, CASES.editUnknown, CASES.editPriority, CASES.editPrioritySwap, CASES.editPriorityTitle],
  ],
  [
    'writes the body with its trailing newline trimmed',
    contractOptions({}, (base) => ({
      edit: async (ref, change) => editOf(base)(ref, change.body === undefined
        ? change
        : { ...change, body: change.body.trimEnd() }),
    })),
    [CASES.editBody],
  ],
  ['writes the edit onto every issue', contractOptions({ editsEveryIssue: true }), [CASES.editBody, CASES.editPriority]],
  ['clears the title on an edit naming none', contractOptions({ bodyEditClearsTitle: true }), [CASES.editBody, CASES.editPriority]],
  [
    'answers editable without a priority',
    contractOptions({}, (base) => ({ editable: async (ref) => withoutPriority(await editableOf(base)(ref)) })),
    PRIORITY_CASES,
  ],
  [
    'answers a priority from editable for an issue triage has set none for',
    contractOptions({}, (base) => ({
      editable: async (ref) => {
        const issue = await editableOf(base)(ref);
        return { ...issue, priority: issue.priority ?? 'low' };
      },
    })),
    [CASES.editablePriority],
  ],
  [
    'drops the priority of an edit',
    contractOptions({}, (base) => ({ edit: async (ref, change) => editOf(base)(ref, withoutChangedPriority(change)) })),
    [CASES.editPriority, CASES.editPrioritySwap, CASES.editPriorityTitle],
  ],
  [
    'drops the priority of an edit that names a title',
    contractOptions({}, (base) => ({
      edit: async (ref, change) => editOf(base)(ref, change.title === undefined
        ? change
        : withoutChangedPriority(change)),
    })),
    [CASES.editPriorityTitle],
  ],
  ['never writes a priority over one already set', contractOptions({ neverSwapsPriority: true }), [CASES.editPrioritySwap]],
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

    // The openIssues and editable closed cases move their issues to done
    // and cancelled whatever states the transition case is narrowed to,
    // so they still reject.
    expect(await rejectedCases({ ...neverTransitions, transitionableStates: ['todo'] }))
      .toEqual([CASES.openClosed, CASES.editableClosed]);
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

  it('swaps the four openIssues cases for one holding the reading left out, when run without it', () => {
    const without = { ...contractOptions(), readsOpenIssues: false };

    expect(trackerContractCases(without).map((contractCase) => contractCase.name)).toEqual([
      ...Object.values(CASES).filter((name) => !name.startsWith('openIssues ') && !EDIT_CASES.includes(name)),
      LEFT_OUT_CASE,
      ...EDIT_CASES,
    ]);
  });

  it('holds a tracker run without openIssues to having none, beside one that has none', async () => {
    const withReading = { ...contractOptions(), readsOpenIssues: false };
    const withoutReading = { ...contractOptions({}, () => ({ openIssues: undefined })), readsOpenIssues: false };

    expect(await rejectedCases(withReading)).toEqual([LEFT_OUT_CASE]);
    expect(await rejectedCases(withoutReading)).toEqual([]);
  });
});

describe('the Tracker contract cases run without editsIssues', () => {
  it('swaps the nine editable and edit cases for one holding the pair left out', () => {
    const without = { ...contractOptions(), editsIssues: undefined };

    expect(trackerContractCases(without).map((contractCase) => contractCase.name)).toEqual([
      ...Object.values(CASES).filter((name) => !EDIT_CASES.includes(name)),
      EDIT_LEFT_OUT_CASE,
    ]);
  });

  it('holds a tracker run without editsIssues to having neither member, beside one that has neither', async () => {
    const withPair = { ...contractOptions(), editsIssues: false };
    const withEditOnly = { ...contractOptions({}, () => ({ editable: undefined })), editsIssues: false };
    const withoutPair = {
      ...contractOptions({}, () => ({ editable: undefined, edit: undefined })),
      editsIssues: false,
    };

    expect(await rejectedCases(withPair)).toEqual([EDIT_LEFT_OUT_CASE]);
    expect(await rejectedCases(withEditOnly)).toEqual([EDIT_LEFT_OUT_CASE]);
    expect(await rejectedCases(withoutPair)).toEqual([]);
  });
});

describe('the Tracker contract cases run without editsPriority', () => {
  it('swaps the four priority cases for one holding editable to answering none', () => {
    const without = { ...contractOptions(), editsPriority: undefined };

    expect(trackerContractCases(without).map((contractCase) => contractCase.name)).toEqual([
      ...Object.values(CASES).filter((name) => !PRIORITY_CASES.includes(name)),
      PRIORITY_LEFT_OUT_CASE,
    ]);
  });

  it('holds a tracker run without editsPriority to answering no priority, beside one that answers none', async () => {
    const answersOne = { ...contractOptions(), editsPriority: false };
    const answersNone = {
      ...contractOptions({}, (base) => ({ editable: async (ref) => withoutPriority(await editableOf(base)(ref)) })),
      editsPriority: false,
    };

    expect(await rejectedCases(answersOne)).toEqual([PRIORITY_LEFT_OUT_CASE]);
    expect(await rejectedCases(answersNone)).toEqual([]);
  });

  it('reads editsPriority beside editsIssues alone, adding no priority case to a tracker run without the pair', () => {
    const without = { ...contractOptions(), editsIssues: false, editsPriority: true };

    expect(trackerContractCases(without).map((contractCase) => contractCase.name)).toEqual([
      ...Object.values(CASES).filter((name) => !EDIT_CASES.includes(name)),
      EDIT_LEFT_OUT_CASE,
    ]);
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
