/**
 * One `GhRunner` for the sync's tests (`./sync.test.ts` and
 * `src/commands/board/sync.test.ts`) routing every call to a strict fake,
 * as `./refresh.test.ts` routes the refresh's: the project's reads and
 * writes to `./project-fake.ts`, the facts reads to `./facts-fake.ts`,
 * and the repository, the board listing and the labelled boards to
 * answers made here off one table of issues, so the listing and the facts
 * never disagree. No case that uses it reaches GitHub.
 *
 * This module is a test helper that is not itself a test file, as
 * `./project-fake.ts` is: bun runs nothing in it until a `*.test.ts`
 * calls it, and `check-types` reads it.
 *
 * ## The board it holds
 *
 * Board #1 lists #10, epic #20 and a ticked #30. Epic #20 lists #21 and
 * #22, the latter closed. #10 waits on #21; #30 closed with a merged pull
 * request whose shipping fragment is still on `main`. #40 is open. The
 * project holds an item for #10, #20, #21, #22 and #30, each holding no
 * value unless a case plants one, so the board #1 and #40 are the open
 * issues missing from it.
 *
 * {@link SyncFake.setLabels} edits an issue's labels as the web UI would,
 * outside rafa: every later read answers the new labels.
 * {@link SyncFakeOptions.repeatsCursor} plants a labels cursor that never
 * moves on the issues it names, so the facts reader refuses each of them
 * alone (`./facts-fake.ts`, `FakeFactsIssue.repeatsCursor`).
 */
import type { FakeFactsIssue } from './facts-fake.js';
import type { ProjectFieldValue, ProjectItem } from './port.js';
import type { FakeProjectGh, FakeProjectItem } from './project-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { BOARD_LABELS } from '../setup.js';

import { createFakeFactsGh } from './facts-fake.js';
import { createGhProjectPort } from './gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY } from './project-fake.js';

/** The owner of the repository and the project. */
export const SYNC_OWNER = 'open-tomato';

/** The project's number. */
export const SYNC_PROJECT_NUMBER = 6;

/** One issue of the board, as both the listing and the facts read it. */
interface SyncIssue extends FakeFactsIssue {
  readonly body?: string;
}

/** A shipping fragment's text. */
const FRAGMENT = '---\nplan: rafa-1\ntitle: One plan\nlevel: minor\n---\n\n- loop: a note\n';

/** The board of the module note. */
const ISSUES: readonly SyncIssue[] = [
  { number: 1, state: 'OPEN', labels: ['type:roadmap'], body: '- [ ] #10 first\n- [ ] #20 then\n- [x] #30 shipped\n' },
  { number: 10, state: 'OPEN', labels: ['type:spec', 'spec:blocked'], body: 'Why it waits.\n\nBlocked by: #21\n' },
  { number: 20, state: 'OPEN', labels: ['type:epic', 'epic:alpha', 'horizon:now'], body: '- [ ] #21\n- [ ] #22\n' },
  { number: 21, state: 'OPEN', labels: ['type:spec', 'epic:alpha', 'spec:ready'] },
  { number: 22, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec', 'epic:alpha'] },
  { number: 30, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec'], closedBy: [31] },
  { number: 40, state: 'OPEN', labels: ['type:spec', 'needs-triage'] },
];

/** `gh auth status --active --json hosts` for one account logged in with the `project` scope. */
const AUTH_WITH_PROJECT_SCOPE = {
  hosts: {
    'github.com': [{ state: 'success', active: true, host: 'github.com', login: 'test', tokenSource: 'keyring', scopes: 'project, repo', gitProtocol: 'ssh' }],
  },
};

/** The issues the project holds an item for. */
export const SYNC_ITEM_ISSUES: readonly number[] = Object.freeze([10, 20, 21, 22, 30]);

/** The values the rules give each issue with an item, by field name. */
export const SYNC_EXPECTED: Readonly<Record<number, Readonly<Record<string, string | number>>>> = Object.freeze({
  10: { 'Stage': 'Blocked', 'Rank': 1, 'Blocked by': '#21' },
  20: { Horizon: 'Now', Rank: 2, Progress: '1 / 2' },
  21: { Stage: 'Ready', Rank: 3 },
  22: { Stage: 'Done', Rank: 4 },
  30: { Stage: 'In review', Rank: 5 },
});

/** What {@link createSyncFake} is made with. */
export interface SyncFakeOptions {
  /** Each item's planted values by issue number; none when left out. Null for an owner holding no project. */
  readonly values?: Readonly<Record<number, Readonly<Record<string, string | number>>>> | null;
  /** How many field-write requests the project answers before refusing every later one as rate-limited. */
  readonly rateLimitAfter?: number;
  /** The issues the project holds an item for; {@link SYNC_ITEM_ISSUES} when left out. */
  readonly itemIssues?: readonly number[];
  /** The issues whose labels cursor never moves, each refused by the facts reader; none when left out. */
  readonly repeatsCursor?: readonly number[];
}

/** The router, the project fake behind it, and what was recorded. */
export interface SyncFake {
  readonly gh: GhRunner;
  readonly project: FakeProjectGh;
  /** Every argv the router was handed, in order. */
  calls(): readonly (readonly string[])[];
  /** Replaces issue `number`'s labels, as an edit in the web UI would. */
  setLabels(number: number, labels: readonly string[]): void;
  /** The values the project holds now, by issue number, the title left out. */
  heldValues(): Promise<Readonly<Record<number, Readonly<Record<string, string | number>>>>>;
}

/** An issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function listed(issue: SyncIssue): Readonly<Record<string, unknown>> {
  return {
    number: issue.number,
    title: `#${String(issue.number)}`,
    body: issue.body ?? '',
    state: issue.state,
    stateReason: issue.stateReason ?? '',
    labels: (issue.labels ?? []).map((name) => ({ name })),
  };
}

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** `value` as the fake's items are planted: an option by its name, a number, a text. */
function planted(value: ProjectFieldValue): string | number {
  if (value.kind === 'option') return value.name;
  return value.kind === 'number'
    ? value.number
    : value.text;
}

/** An item's values by field name, as planted, the title left out. */
function plantedValues(values: ProjectItem['values']): Readonly<Record<string, string | number>> {
  return Object.fromEntries([...values]
    .filter(([name]) => name !== 'Title')
    .map(([name, value]) => [name, planted(value)]));
}

/** Makes the router of the module note; see there. */
export function createSyncFake(options: SyncFakeOptions = {}): SyncFake {
  const values = options.values === undefined
    ? {}
    : options.values;
  const itemIssues = options.itemIssues ?? SYNC_ITEM_ISSUES;
  const items: readonly FakeProjectItem[] = itemIssues.map((number) => ({ number, values: values?.[number] ?? {} }));
  const project = createFakeProjectGh({
    ...options.rateLimitAfter === undefined
      ? {}
      : { rateLimitAfter: options.rateLimitAfter },
    projects: values === null
      ? []
      : [{ owner: SYNC_OWNER, number: SYNC_PROJECT_NUMBER, items }],
    owners: [SYNC_OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: ISSUES.map(({ number }) => number) }],
  });
  const repeating = new Set(options.repeatsCursor ?? []);
  let issues: readonly SyncIssue[] = ISSUES.map((issue) => (repeating.has(issue.number)
    ? { ...issue, repeatsCursor: 'labels' }
    : issue));
  const recorded: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    recorded.push(args);
    const line = args.join(' ');
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line === 'auth status --active --json hosts') return Promise.resolve(answered(AUTH_WITH_PROJECT_SCOPE));
    if (line.startsWith('label list ')) return Promise.resolve(answered(BOARD_LABELS.map(({ name }) => ({ name }))));
    if (line.startsWith('issue list --label type:roadmap --state open')) {
      return Promise.resolve(answered(issues.filter(({ labels = [] }) => labels.includes('type:roadmap')).map(listed)));
    }
    if (line.startsWith('issue list --state all')) return Promise.resolve(answered(issues.map(listed)));
    if (args[0] === 'api' && args.includes('owner={owner}')) {
      const facts = createFakeFactsGh({
        issues,
        pulls: [{ number: 31, state: 'MERGED', baseRefName: 'main', headRefOid: 'head31', files: [{ path: '.changes/rafa-1.md', changeType: 'ADDED' }] }],
        trees: { head31: { '.changes/rafa-1.md': FRAGMENT }, main: { '.changes/rafa-1.md': FRAGMENT } },
      });
      return facts.gh(args);
    }
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  return {
    gh,
    project,
    calls: () => [...recorded],
    setLabels: (number, labels) => {
      issues = issues.map((issue) => (issue.number === number
        ? { ...issue, labels }
        : issue));
    },
    heldValues: async () => {
      const port = createGhProjectPort(project.gh);
      const found = await port.find({ owner: SYNC_OWNER, number: SYNC_PROJECT_NUMBER });
      const read = await port.items(found?.id ?? '');
      return Object.fromEntries(read.flatMap(({ content, values: held }) => (content.kind === 'issue'
        ? [[content.number, plantedValues(held)] as const]
        : [])));
    },
  };
}

/** The calls of `calls` that wrote a field value. */
export function syncWriteCalls(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((args) => args.some((arg) => arg.includes('updateProjectV2ItemFieldValue(') || arg.includes('clearProjectV2ItemFieldValue(')));
}

/** The calls of `calls` that added an item. */
export function syncAddCalls(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((args) => args.some((arg) => arg.includes('addProjectV2ItemById(')));
}
