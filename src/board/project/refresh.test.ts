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
import type { FakeProjectGhOptions, FakeProjectItem } from './project-fake.js';
import type { ProjectChange } from './refresh-values.js';
import type { RefreshConfig, RefreshOptions } from './refresh.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createFakeFactsGh } from './facts-fake.js';
import { createGhProjectPort } from './gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, FAKE_RATE_LIMIT_MESSAGE, FAKE_TEMPLATE_FIELDS } from './project-fake.js';
import { notFoundWarning, rateLimitWarning, scopeWarning, skippedFieldWarning } from './refresh-warnings.js';
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

/** The router of the module note over `projectItems`, and `config`, the project fake's rate limit as `fake` sets it. */
function wire(
  projectItems: readonly FakeProjectItem[] | null,
  config: RefreshConfig = CONFIG,
  fake: Pick<FakeProjectGhOptions, 'rateLimitAfter'> = {},
): Wired {
  const project = createFakeProjectGh({
    ...fake,
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

    expect(await refreshProjectItems(wired.options, [10, 20])).toEqual({ kind: 'skipped', reason: 'no-project', warnings: [] });
    expect(wired.calls()).toEqual([]);
  });

  it('sends calls for the same issues once the number is set, the control of the case above', async () => {
    const wired = wire(items());

    expect((await refreshProjectItems(wired.options, [10, 20])).kind).toBe('refreshed');
    expect(wired.calls().length).toBeGreaterThan(0);
  });

  it('answers no-issues and sends no call for an empty list', async () => {
    const wired = wire(items());

    expect(await refreshProjectItems(wired.options, [])).toEqual({ kind: 'skipped', reason: 'no-issues', warnings: [] });
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
      warnings: [],
    });
    expect(wired.calls().some((args) => args.includes('owner={owner}') || args[0] === 'issue')).toBe(false);
  });

  it('answers not-found, reading no item, when the owner holds no project of that number', async () => {
    const wired = wire(null);

    expect(await refreshProjectItems(wired.options, [10])).toEqual({
      kind: 'not-found',
      project: { owner: OWNER, number: NUMBER },
      warnings: [notFoundWarning({ owner: OWNER, number: NUMBER })],
    });
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

describe('refreshProjectItems: the failures of "What can go wrong", answered as warning lines', () => {
  // GitHub's documented refusal, NOT a reading: both gh accounts on hand hold the project scope.
  const SCOPE_STDERR = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.\n';

  it('answers refused with the scope line, never a rejection, when the find is refused for the project scope', async () => {
    const wired = wire(items());
    wired.project.failNext(SCOPE_STDERR);

    expect(await refreshProjectItems(wired.options, [10])).toEqual({
      kind: 'refused',
      reason: 'scope',
      project: { owner: OWNER, number: NUMBER },
      warnings: [scopeWarning()],
    });
  });

  it('still rejects a refused find that names no scope, the control of the case above', async () => {
    const wired = wire(items());
    wired.project.failNext('gh: HTTP 502: Bad gateway\n');

    expect(refreshProjectItems(wired.options, [10])).rejects.toThrow('board project: gh api graphql failed: gh: HTTP 502: Bad gateway');
  });

  it('answers refused with the scope line when the writes are refused for the project scope, after the reads went through', async () => {
    const wired = wire(items());
    const gh: GhRunner = (args) => (writeCalls([args]).length > 0
      ? Promise.resolve({ ok: false, stdout: '', stderr: SCOPE_STDERR })
      : wired.options.gh(args));

    const refresh = await refreshProjectItems({ ...wired.options, gh }, [21]);

    expect(refresh.kind === 'refused' && refresh.warnings).toEqual([scopeWarning()]);
    expect(await heldValues(wired)).toEqual(Object.fromEntries([10, 20, 21, 22, 30].map((number) => [number, {}])));
  });

  it('answers the rate-limit line counting the issues not updated, and still answers what was read', async () => {
    const wired = wire(items(), CONFIG, { rateLimitAfter: 0 });

    const refresh = await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);

    expect(refresh.kind).toBe('refreshed');
    expect(refresh.kind === 'refreshed' && refresh.writes.notUpdated).toBe(5);
    expect(refresh.kind === 'refreshed' && refresh.changes).toHaveLength(12);
    expect(refresh.warnings).toEqual([rateLimitWarning(5)]);
  });

  it('answers no rate-limit line when every write lands, the control of the case above', async () => {
    const wired = wire(items(), CONFIG, { rateLimitAfter: 1 });

    const refresh = await refreshProjectItems(wired.options, [10, 20, 21, 22, 30]);

    expect(refresh.kind === 'refreshed' && refresh.writes.written).toBe(12);
    expect(refresh.warnings).toEqual([]);
  });

  it('answers the not-found line naming the number when the owner holds no project of it', async () => {
    const wired = wire(null);

    const refresh = await refreshProjectItems(wired.options, [10]);

    expect(refresh.warnings).toEqual([notFoundWarning({ owner: OWNER, number: NUMBER })]);
    expect(refresh.warnings[0]).toContain('board.project.number 6 was not found');
  });

  it('answers one line per renamed field, naming each, while the rest are written', async () => {
    const renamed: Readonly<Record<string, string>> = { 'Rank': 'Order', 'Blocked by': 'Waits on' };
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => ({ ...field, name: renamed[field.name] ?? field.name }));
    const project = createFakeProjectGh({ projects: [{ owner: OWNER, number: NUMBER, fields, items: items() }] });
    const wired = wire(items());
    const gh: GhRunner = (args) => (args[0] === 'api' && !args.includes('owner={owner}')
      ? project.gh(args)
      : wired.options.gh(args));

    const refresh = await refreshProjectItems({ ...wired.options, gh }, [21]);

    const skipped = refresh.kind === 'refreshed'
      ? refresh.skipped
      : [];
    expect(skipped.map(({ template }) => template.name)).toEqual(['Rank', 'Blocked by']);
    expect(refresh.warnings).toEqual(skipped.map(skippedFieldWarning));
    expect(refresh.kind === 'refreshed' && refresh.writes.written).toBe(1);
  });

  it('answers no warning when every field is held as the template has it, the control of the case above', async () => {
    const wired = wire(items());

    expect((await refreshProjectItems(wired.options, [21])).warnings).toEqual([]);
  });
});

/** A write gh answer the way GitHub refuses one for the rate limit, with the message the fake sends. */
function rateLimitedAnswer(): GhResult {
  return {
    ok: false,
    stdout: JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: FAKE_RATE_LIMIT_MESSAGE }] }),
    stderr: `gh: ${FAKE_RATE_LIMIT_MESSAGE}\n`,
  };
}

/** `wired`'s runner, refusing every field write for the rate limit while `state.refusing` holds. */
function limitWritesWhile(wired: Wired, state: { refusing: boolean }): GhRunner {
  return (args) => (state.refusing && writeCalls([args]).length > 0
    ? Promise.resolve(rateLimitedAnswer())
    : wired.options.gh(args));
}

/** The issues of the five values, the names of `changes` as `issue:name` pairs, in order. */
function changedPairs(changes: readonly ProjectChange[]): readonly string[] {
  return changes.map(({ issue, name }) => `${String(issue)}:${name}`);
}

describe('refreshProjectItems: an interrupted fill resumes with only the unwritten values', () => {
  it('writes, after a refusal stopped the fill, exactly the values not yet written, then nothing on a third refresh', async () => {
    const wired = wire(items());
    const state = { refusing: false };
    const gh = limitWritesWhile(wired, state);
    const options = { ...wired.options, gh };
    // #21's two values land first: the fill that the interruption cuts short.
    const landed = await refreshProjectItems(options, [21]);
    expect(landed.kind === 'refreshed' && landed.writes.written).toBe(2);

    state.refusing = true;
    const interrupted = await refreshProjectItems(options, [10, 20, 21, 22, 30]);

    expect(interrupted.kind === 'refreshed' && interrupted.writes.rateLimited).toBe(true);
    expect(interrupted.kind === 'refreshed' && interrupted.writes.written).toBe(0);
    expect(interrupted.warnings).toEqual([rateLimitWarning(4)]);
    expect(await heldValues(wired)).toEqual(Object.fromEntries([10, 20, 21, 22, 30].map((number) => [number, number === 21
      ? EXPECTED[21]
      : {}])));

    state.refusing = false;
    const resumed = await refreshProjectItems(options, [10, 20, 21, 22, 30]);

    expect(resumed.kind === 'refreshed' && changedPairs(resumed.changes)).toEqual([
      '10:Stage', '10:Rank', '10:Blocked by', '20:Horizon', '20:Rank', '20:Progress', '22:Stage', '22:Rank', '30:Stage', '30:Rank',
    ]);
    expect(resumed.kind === 'refreshed' && resumed.writes).toEqual({ written: 10, notUpdated: 0, rateLimited: false, detail: '' });
    expect(resumed.warnings).toEqual([]);
    expect(await heldValues(wired)).toEqual(EXPECTED);

    const writesBeforeThird = writeCalls(wired.calls()).length;
    const third = await refreshProjectItems(options, [10, 20, 21, 22, 30]);

    expect(third.kind === 'refreshed' && third.changes).toEqual([]);
    expect(writeCalls(wired.calls())).toHaveLength(writesBeforeThird);
  });
});

describe('refreshProjectItems: a renamed field is skipped while the other four are written', () => {
  it('names Rank as skipped and writes Stage, Horizon, Blocked by and Progress, leaving Rank unwritten', async () => {
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => (field.name === 'Rank'
      ? { ...field, name: 'Order' }
      : field));
    const renamed = createFakeProjectGh({ projects: [{ owner: OWNER, number: NUMBER, fields, items: items() }] });
    const wired = wire(items());
    const gh: GhRunner = (args) => (args[0] === 'api' && !args.includes('owner={owner}')
      ? renamed.gh(args)
      : wired.options.gh(args));

    const refresh = await refreshProjectItems({ ...wired.options, gh }, [10, 20, 21, 22, 30]);

    expect(refresh.kind === 'refreshed' && refresh.skipped.map(({ template, problem }) => [template.name, problem])).toEqual([['Rank', 'missing']]);
    expect(refresh.kind === 'refreshed' && changedPairs(refresh.changes)).toEqual([
      '10:Stage', '10:Blocked by', '20:Horizon', '20:Progress', '21:Stage', '22:Stage', '30:Stage',
    ]);
    expect(refresh.kind === 'refreshed' && refresh.writes.written).toBe(7);
    expect(refresh.warnings).toEqual(refresh.kind === 'refreshed'
      ? refresh.skipped.map(skippedFieldWarning)
      : []);
    const withoutRank = Object.fromEntries(Object.entries(EXPECTED).map(([number, values]) => [
      number,
      Object.fromEntries(Object.entries(values).filter(([name]) => name !== 'Rank')),
    ]));
    expect(await heldValues({ ...wired, project: renamed })).toEqual(withoutRank);
  });
});

describe('refreshProjectItems: widened by an epic\'s members and the items whose Rank shifted', () => {
  /** Every change as `issue, field, from, to`. */
  function changeRows(refresh: Awaited<ReturnType<typeof refreshProjectItems>>): readonly (readonly unknown[])[] {
    return refresh.kind === 'refreshed'
      ? refresh.changes.map(({ issue, name, from, to }) => [issue, name, from, to])
      : [];
  }

  it('refreshes the epic\'s members as the board reads them beside the epic asked for', async () => {
    const wired = wire(items());

    await refreshProjectItems(wired.options, [20], { membersOf: [20] });

    const held = await heldValues(wired);
    expect([held[20], held[21], held[22]]).toEqual([EXPECTED[20], EXPECTED[21], EXPECTED[22]]);
    expect(held[10]).toEqual({});
  });

  it('leaves the members untouched for the same epic asked for with no widening, the control of the case above', async () => {
    const wired = wire(items());

    await refreshProjectItems(wired.options, [20]);

    const held = await heldValues(wired);
    expect(held[20]).toEqual(EXPECTED[20]);
    expect([held[21], held[22]]).toEqual([{}, {}]);
  });

  it('adds every item whose Rank is not the board\'s, lowest first, and writes only their Ranks', async () => {
    const wired = wire(items({ ...EXPECTED, 30: { ...EXPECTED[30], Rank: 9 }, 22: { ...EXPECTED[22], Rank: 7 } }));

    const refresh = await refreshProjectItems(wired.options, [], { shiftedRanks: true });

    expect(refresh.kind).toBe('refreshed');
    expect(changeRows(refresh)).toEqual([[22, 'Rank', '7', '4'], [30, 'Rank', '9', '5']]);
    expect(await heldValues(wired)).toEqual(EXPECTED);
  });

  it('writes nothing for the same drifted Ranks without shiftedRanks, the control of the case above', async () => {
    const wired = wire(items({ ...EXPECTED, 30: { ...EXPECTED[30], Rank: 9 }, 22: { ...EXPECTED[22], Rank: 7 } }));

    const refresh = await refreshProjectItems(wired.options, [10]);

    expect(refresh.kind).toBe('refreshed');
    expect(changeRows(refresh)).toEqual([]);
    expect(writeCalls(wired.calls())).toEqual([]);
  });

  it('counts an item holding no Rank as shifted, and clears the Rank of an item on no line', async () => {
    const planted = [...items({ ...EXPECTED, 21: { Stage: 'Ready' } }), { number: 40, values: { Rank: 6 } }];
    const wired = wire(planted);

    const refresh = await refreshProjectItems(wired.options, [], { shiftedRanks: true });

    expect(changeRows(refresh)).toEqual([[21, 'Rank', null, '3'], [40, 'Stage', null, 'Triage'], [40, 'Rank', '6', null]]);
  });

  it('adds no item while the project holds no Rank field as the template has it', async () => {
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => (field.name === 'Rank'
      ? { ...field, name: 'Order' }
      : field));
    const renamed = createFakeProjectGh({ projects: [{ owner: OWNER, number: NUMBER, fields, items: items({ 30: { Order: 9 } }) }] });
    const wired = wire(items());
    const gh: GhRunner = (args) => (args[0] === 'api' && !args.includes('owner={owner}')
      ? renamed.gh(args)
      : wired.options.gh(args));

    const refresh = await refreshProjectItems({ ...wired.options, gh }, [], { shiftedRanks: true });

    expect(refresh.kind === 'refreshed' && refresh.skipped.map(({ template }) => template.name)).toEqual(['Rank']);
    expect(changeRows(refresh)).toEqual([]);
  });

  it('reads the board listing once though it widens before the facts', async () => {
    const wired = wire(items());

    await refreshProjectItems(wired.options, [10], { membersOf: [20], shiftedRanks: true });

    expect(wired.calls().filter((args) => args.join(' ').startsWith('issue list --state all'))).toHaveLength(1);
  });

  it('names a member with no item as missing, after the issues asked for', async () => {
    const wired = wire(items().filter(({ number }) => number !== 22));

    const refresh = await refreshProjectItems(wired.options, [40], { membersOf: [20] });

    expect(refresh.kind === 'refreshed' && refresh.missing).toEqual([40, 22]);
  });

  it('refuses a membersOf entry that is no issue number before any call', async () => {
    const wired = wire(items());

    expect(refreshProjectItems(wired.options, [10], { membersOf: [-2] })).rejects.toThrow('board project refresh: -2 is not an issue number');
    expect(wired.calls()).toEqual([]);
  });

  it('answers no-issues and sends no call for an empty list with nothing to widen it', async () => {
    const wired = wire(items());

    expect(await refreshProjectItems(wired.options, [], { membersOf: [], shiftedRanks: false })).toEqual({ kind: 'skipped', reason: 'no-issues', warnings: [] });
    expect(wired.calls()).toEqual([]);
  });
});
