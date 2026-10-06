/**
 * Tests for the refresh (`refresh.ts`, `refreshProjectItems`), each sent
 * through one `GhRunner` that routes every call to a strict fake: the
 * project's reads and writes to `project-fake.ts`, the facts reads to
 * `facts-fake.ts`, and the repository, board listing and labelled boards
 * to answers planted here off one table of issues, so the listing and the
 * facts never disagree. No case reaches GitHub.
 *
 * ## The board every case reads
 *
 * Board #1 lists #10, epic #20 and a ticked #30. Epic #20 lists #21 and
 * #22, the latter closed. #10 waits on #21; #30 closed with a merged pull
 * request whose shipping fragment is still on `main`. #40 is open and on
 * no item.
 *
 * ## The controls
 *
 *  - The case with no `board.project.number` is read beside the same
 *    refresh with the number set, which sends calls, so an empty call log
 *    proves the key and not a `gh` that was never wired.
 *  - The second refresh sends no write only after the first sent some,
 *    and the project's values read back equal what the first wrote.
 */
import type { FakeFactsIssue, FakeFactsPull } from './facts-fake.js';
import type { ProjectFieldValue, ProjectItem } from './port.js';
import type { FakeProjectItem } from './project-fake.js';
import type { RefreshConfig, RefreshOptions } from './refresh.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createFakeFactsGh } from './facts-fake.js';
import { createGhProjectPort } from './gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, FAKE_TEMPLATE_FIELDS } from './project-fake.js';
import { refreshProjectItems } from './refresh.js';

/** The owner of the repository and the project. */
const OWNER = 'open-tomato';

/** The project's number. */
const NUMBER = 6;

/** The config every case reads but the one that unsets the number. */
const CONFIG: RefreshConfig = {
  boardProjectNumber: NUMBER,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** One issue of the board, as both the listing and the facts read it. */
interface PlantedIssue extends FakeFactsIssue {
  readonly body?: string;
}

/** A shipping fragment's text. */
const FRAGMENT = '---\nplan: rafa-1\ntitle: One plan\nlevel: minor\n---\n\n- loop: a note\n';

/** The board of the module note. */
const ISSUES: readonly PlantedIssue[] = [
  { number: 1, state: 'OPEN', labels: ['type:roadmap'], body: '- [ ] #10 first\n- [ ] #20 then\n- [x] #30 shipped\n' },
  { number: 10, state: 'OPEN', labels: ['type:spec', 'spec:blocked'], body: 'Why it waits.\n\nBlocked by: #21\n' },
  { number: 20, state: 'OPEN', labels: ['type:epic', 'epic:alpha', 'horizon:now'], body: '- [ ] #21\n- [ ] #22\n' },
  { number: 21, state: 'OPEN', labels: ['type:spec', 'epic:alpha', 'spec:ready'] },
  { number: 22, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec', 'epic:alpha'] },
  { number: 30, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec'], closedBy: [31] },
  { number: 40, state: 'OPEN', labels: ['type:spec', 'needs-triage'] },
];

/** #30's pull request, merged into `main` with a fragment `main` still holds. */
const PULLS: readonly FakeFactsPull[] = [
  { number: 31, state: 'MERGED', baseRefName: 'main', headRefOid: 'head31', files: [{ path: '.changes/rafa-1.md', changeType: 'ADDED' }] },
];

/** The trees the fragment is read in. */
const TREES = { head31: { '.changes/rafa-1.md': FRAGMENT }, main: { '.changes/rafa-1.md': FRAGMENT } };

/** The values the rules give each issue on the project, by field name. */
const EXPECTED: Readonly<Record<number, Readonly<Record<string, string | number>>>> = {
  10: { 'Stage': 'Blocked', 'Rank': 1, 'Blocked by': '#21' },
  20: { Horizon: 'Now', Rank: 2, Progress: '1 / 2' },
  21: { Stage: 'Ready', Rank: 3 },
  22: { Stage: 'Done', Rank: 4 },
  30: { Stage: 'In review', Rank: 5 },
};

/** The items every case but the not-found one holds: one per issue on the project, none for #40 or #1. */
function items(values: Readonly<Record<number, Readonly<Record<string, string | number>>>> = {}): readonly FakeProjectItem[] {
  return [10, 20, 21, 22, 30].map((number) => ({ number, values: values[number] ?? {} }));
}

/** An issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function listed(issue: PlantedIssue): Readonly<Record<string, unknown>> {
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

/** The fakes behind one router, and what each recorded. */
interface Wired {
  readonly options: RefreshOptions;
  readonly project: ReturnType<typeof createFakeProjectGh>;
  /** Every argv the router was handed, in order. */
  readonly calls: () => readonly (readonly string[])[];
}

/** The router of the module note over `projectItems`, and `config`. */
function wire(projectItems: readonly FakeProjectItem[] | null, config: RefreshConfig = CONFIG): Wired {
  const project = createFakeProjectGh({
    projects: projectItems === null
      ? []
      : [{ owner: OWNER, number: NUMBER, items: projectItems }],
    owners: [OWNER],
  });
  const facts = createFakeFactsGh({ issues: ISSUES, pulls: PULLS, trees: TREES });
  const recorded: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    recorded.push(args);
    const line = args.join(' ');
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line.startsWith('issue list --label type:roadmap --state open')) {
      return Promise.resolve(answered(ISSUES.filter(({ labels = [] }) => labels.includes('type:roadmap')).map(listed)));
    }
    if (line.startsWith('issue list --state all')) return Promise.resolve(answered(ISSUES.map(listed)));
    if (args[0] === 'api' && args.includes('owner={owner}')) return facts.gh(args);
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  return {
    options: { config, gh, sleep: () => Promise.resolve() },
    project,
    calls: () => [...recorded],
  };
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

/** The values the project holds now, by issue number, as its items read answers them, the title left out. */
async function heldValues(wired: Wired): Promise<Readonly<Record<number, Readonly<Record<string, string | number>>>>> {
  const port = createGhProjectPort(wired.project.gh);
  const found = await port.find({ owner: OWNER, number: NUMBER });
  const read = await port.items(found?.id ?? '');
  return Object.fromEntries(read.flatMap(({ content, values }) => (content.kind === 'issue'
    ? [[content.number, plantedValues(values)] as const]
    : [])));
}

/** The calls that wrote a field value. */
function writeCalls(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((args) => args.some((arg) => arg.includes('updateProjectV2ItemFieldValue(') || arg.includes('clearProjectV2ItemFieldValue(')));
}

describe('refreshProjectItems: nothing without board.project.number', () => {
  it('answers no-project and sends no call with the number unset', async () => {
    const wired = wire(items(), { ...CONFIG, boardProjectNumber: null });

    expect(await refreshProjectItems(wired.options, [10, 20])).toEqual({ kind: 'skipped', reason: 'no-project' });
    expect(wired.calls()).toEqual([]);
  });

  it('sends calls for the same issues once the number is set, the control of the case above', async () => {
    const wired = wire(items());

    expect((await refreshProjectItems(wired.options, [10, 20])).kind).toBe('refreshed');
    expect(wired.calls().length).toBeGreaterThan(0);
  });

  it('answers no-issues and sends no call for an empty list', async () => {
    const wired = wire(items());

    expect(await refreshProjectItems(wired.options, [])).toEqual({ kind: 'skipped', reason: 'no-issues' });
    expect(wired.calls()).toEqual([]);
  });

  it('refuses an entry that is no issue number before any call', async () => {
    const wired = wire(items());

    expect(refreshProjectItems(wired.options, [10, 0])).rejects.toThrow('board project refresh: 0 is not an issue number');
    expect(wired.calls()).toEqual([]);
  });
});

describe('refreshProjectItems: the values written', () => {
  it('fills every item with the five values the rules give, and writes nothing to a field whose value is empty', async () => {
    const wired = wire(items());

    const refresh = await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);

    expect(refresh.kind).toBe('refreshed');
    expect(await heldValues(wired)).toEqual(EXPECTED);
    const changes = refresh.kind === 'refreshed'
      ? refresh.changes
      : [];
    expect(changes).toHaveLength(12);
    expect(changes.every(({ write }) => write.kind === 'set')).toBe(true);
    expect(refresh.kind === 'refreshed' && refresh.writes).toEqual({ written: 12, notUpdated: 0, rateLimited: false, detail: '' });
  });

  it('writes only the values that differ from what the items hold', async () => {
    const wired = wire(items({ ...EXPECTED, 10: { ...EXPECTED[10], Stage: 'Ready' }, 22: { Stage: 'Done', Rank: 9, Progress: 'stray' } }));

    const refresh = await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);

    const changes = refresh.kind === 'refreshed'
      ? refresh.changes
      : [];
    expect(changes.map(({ issue, name, from, to }) => [issue, name, from, to])).toEqual([
      [10, 'Stage', 'Ready', 'Blocked'],
      [22, 'Rank', '9', '4'],
      [22, 'Progress', 'stray', null],
    ]);
    expect(writeCalls(wired.calls())).toHaveLength(1);
    expect(await heldValues(wired)).toEqual(EXPECTED);
  });

  it('sends no write on a second refresh over unchanged facts, after the first wrote', async () => {
    const wired = wire(items());
    await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);
    const firstWrites = writeCalls(wired.calls()).length;

    const second = await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);

    expect(firstWrites).toBeGreaterThan(0);
    expect(second.kind === 'refreshed' && second.changes).toEqual([]);
    expect(writeCalls(wired.calls())).toHaveLength(firstWrites);
  });

  it('refreshes only the issues asked for, leaving the others\' items untouched', async () => {
    const wired = wire(items());

    await refreshProjectItems(wired.options, [21]);

    const held = await heldValues(wired);
    expect(held[21]).toEqual(EXPECTED[21]);
    expect(held[10]).toEqual({});
  });
});

describe('refreshProjectItems: issues and projects that are not there', () => {
  it('names an issue with no item as missing, reading no facts or board for it', async () => {
    const wired = wire(items());

    const refresh = await refreshProjectItems(wired.options, [40]);

    expect(refresh).toEqual({
      kind: 'refreshed',
      project: { owner: OWNER, number: NUMBER },
      changes: [],
      writes: { written: 0, notUpdated: 0, rateLimited: false, detail: '' },
      missing: [40],
      skipped: [],
    });
    expect(wired.calls().some((args) => args.includes('owner={owner}') || args[0] === 'issue')).toBe(false);
  });

  it('answers not-found, reading no item, when the owner holds no project of that number', async () => {
    const wired = wire(null);

    expect(await refreshProjectItems(wired.options, [10])).toEqual({ kind: 'not-found', project: { owner: OWNER, number: NUMBER } });
    expect(wired.calls().some((args) => args.some((arg) => arg.includes('node(id: $project)')))).toBe(false);
  });

  it('names a renamed field as skipped and still writes the other fields', async () => {
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => (field.name === 'Rank'
      ? { ...field, name: 'Order' }
      : field));
    const project = createFakeProjectGh({ projects: [{ owner: OWNER, number: NUMBER, fields, items: items() }] });
    const wired = wire(items());
    const gh: GhRunner = (args) => (args[0] === 'api' && !args.includes('owner={owner}')
      ? project.gh(args)
      : wired.options.gh(args));

    const refresh = await refreshProjectItems({ ...wired.options, gh }, [21]);

    expect(refresh.kind === 'refreshed' && refresh.skipped.map(({ template, problem }) => [template.name, problem])).toEqual([['Rank', 'missing']]);
    expect(refresh.kind === 'refreshed' && refresh.changes.map(({ name, to }) => [name, to])).toEqual([['Stage', 'Ready']]);
  });
});
