/**
 * Tests for `rafa issue list` (`list.ts`): the query its flags make and
 * the refusal of each flag, the rows text mode writes, and the list
 * dispatched over a `local` tracker and over the recorded `gh` fake.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`), so the issues listed are
 * the ones the case filed there, through the adapter the chain lands on.
 * The line refused for its `--limit` is held to run no `gh`, beside the
 * same project taking a `--limit` the command accepts, which runs the
 * preflight and the list: the control that the fake's calls can see a
 * resolution.
 *
 * `--roadmap` runs over a `gh` planted per case (the Roadmap read, the
 * board listing, the title search and the open pull requests), a planted
 * `git` and a real plan dir in the project. Its refusals come first,
 * each held to run no `gh` beside a line the same `gh` answers, then the
 * rows: in the Roadmap's order, narrowed after the selection, with the
 * board unreachable, and in json mode. The `refs` column is read over
 * saved copies planted under the project's `specs.dir` with a verifier
 * answering by the reference's text, so no git or `gh` is asked for it.
 *
 * The epic cases plant a board holding two epics, one `now` and one
 * `next`, and an issue on a slug no epic carries: the horizon groups,
 * `--all` widening, the narrowing flags leaving the epic rows alone, the
 * json result's `epics` beside a no-epic Roadmap's result without the
 * key, and the unreachable board printing the epics `unknown`.
 */
import type { LineFlags } from './issue-tracker.js';
import type { RoadmapListResult } from './list.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Issue, IssueDraft } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';
import type { LiveReading } from '../../refs/stamp.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { changedArgs, WATERMARK_ARGS } from '../../board/board-cache.js';
import { BOARDS_LIST_ARGS } from '../../board/boards.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { ROADMAP_REFUSAL_EXIT } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { ABSENT, PRESENT, UNREADABLE } from '../../refs/stamp.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';
import { createRoadmapCommand } from '../roadmap.js';

import { createIssueListCommand, readIssueListLine, readIssueQuery, renderIssueList, renderRoadmapList } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--roadmap [--all] [--full] [--check] [--labels] [--texts] [--refresh]] [--state=<state>]'
  + ' [--type=<type>] [--module=<name>]'
  + ' [--search=<text>] [--limit=<n>]';

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** A config naming `local` first. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A config naming `github` first, then `local`. */
const GITHUB_CONFIG = 'tracker:\n  default: github\n  fallback: [local]\n';

/** The first issue filed: a bug with no priority. */
const TIMEOUT_DRAFT: IssueDraft = {
  opt: 0,
  title: 'Timeouts in plan show',
  body: 'Seen twice.',
  type: 'bug',
  module: 'cli',
  priority: null,
  project: null,
  blockedBy: [],
};

/** The second issue filed: a chore of low priority. */
const DOCS_DRAFT: IssueDraft = {
  ...TIMEOUT_DRAFT,
  title: 'Document issue move',
  body: 'Say what github holds.',
  type: 'chore',
  module: 'unassigned',
  priority: 'low',
};

/** The rows text mode writes for the two `local` issues, the second moved to done. */
const LOCAL_ROWS = [
  'Tracker: local',
  '  1  todo  bug    Timeouts in plan show',
  '  2  done  chore  Document issue move',
];

/** Each set of flags the query refuses, and the problem its refusal names. */
const QUERY_REFUSALS: readonly (readonly [LineFlags, string])[] = [
  [{ state: 'open' }, '--state is "open", expected one of: backlog, todo, in-progress, in-review, done, released, cancelled'],
  [{ type: 'feature' }, '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api, epic'],
  [{ limit: '0' }, '--limit is "0", expected a positive whole number'],
  [{ limit: '05' }, '--limit is "05", expected a positive whole number'],
  [{ limit: '2.5' }, '--limit is "2.5", expected a positive whole number'],
  [{ limit: '9007199254740993' }, '--limit is "9007199254740993", expected a positive whole number'],
  [{ search: ' ' }, '--search cannot be blank: --search=<value>'],
  [{ module: true }, '--module needs a value: --module=<value>'],
];

/** Each narrowing of the two `local` issues, and the lines it writes after the tracker. */
const NARROWED: readonly (readonly [readonly string[], readonly string[]])[] = [
  [['--type=bug'], ['  1  todo  bug  Timeouts in plan show']],
  [['--state=done'], ['  2  done  chore  Document issue move']],
  [['--module=unassigned'], ['  2  done  chore  Document issue move']],
  [['--search=TWICE'], ['  1  todo  bug  Timeouts in plan show']],
  [['--limit=1'], ['  1  todo  bug  Timeouts in plan show']],
  [['--type=spike'], ['No issues.']],
];

/** A fresh project holding `config`. */
function plantCase(config: string): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** A fresh `local` project holding the two issues, the second moved to done. */
async function plantLocalIssues(): Promise<PlantedProject> {
  const project = plantCase(LOCAL_CONFIG);
  const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
  await tracker.create(TIMEOUT_DRAFT);
  await tracker.transition(await tracker.create(DOCS_DRAFT), 'done');
  return project;
}

/** Dispatches `words` from `project` over the list command made with `seams`. */
function run(words: readonly string[], project: PlantedProject, command: RafaCommand = createIssueListCommand()) {
  return dispatchInProject(words, SUBJECTS, [command], project);
}

/** What `read` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** An issue as a tracker holds it, for the rendering cases. */
function heldIssue(id: string, fields: Partial<Issue>): Issue {
  return {
    ...TIMEOUT_DRAFT,
    ref: { opt: 0, kind: 'github', externalId: id, url: `https://github.com/open-tomato/rafa/issues/${id}` },
    state: 'todo',
    ...fields,
  };
}

describe('the query rafa issue list makes', () => {
  it('holds each flag typed, --search as text and --limit as a number, and nothing for a flag left out', () => {
    expect(readIssueQuery({})).toEqual({});
    expect(readIssueQuery({ state: 'todo', type: 'bug', module: 'cli', search: 'timeout', limit: '5' })).toEqual({
      state: 'todo',
      type: 'bug',
      module: 'cli',
      text: 'timeout',
      limit: 5,
    });
  });

  it.each(QUERY_REFUSALS)('refuses the flags %j with exit code 1', (flags, problem) => {
    expect(exitOf(() => readIssueQuery(flags))).toEqual({ exitCode: 1, message: `❌ ${problem}\nUsage: ${USAGE}` });
  });
});

describe('the rows rafa issue list writes', () => {
  it('names the tracker and says so when no issue matched', () => {
    expect(renderIssueList('github', [])).toEqual(['Tracker: github', 'No issues.']);
  });

  it('pads the id to the right and the state and type to the left, each to its widest', () => {
    const issues = [
      heldIssue('9', { state: 'in-review', type: 'bug', title: 'Nine' }),
      heldIssue('10', { state: 'todo', type: 'package-api', title: 'Ten' }),
    ];

    expect(renderIssueList('github', issues)).toEqual([
      'Tracker: github',
      '   9  in-review  bug          Nine',
      '  10  todo       package-api  Ten',
    ]);
  });
});

describe('rafa issue list, dispatched', () => {
  it('lists every local issue oldest first in text mode', async () => {
    const project = await plantLocalIssues();

    expect(await run(['issue', 'list'], project)).toEqual({ exitCode: 0, stdout: `${LOCAL_ROWS.join('\n')}\n`, stderr: '' });
  });

  it.each(NARROWED)('narrows the local list by %j, padding each column to the rows it lists', async (flags, lines) => {
    const project = await plantLocalIssues();

    expect(await run(['issue', 'list', ...flags], project)).toEqual({
      exitCode: 0,
      stdout: `${['Tracker: local', ...lines].join('\n')}\n`,
      stderr: '',
    });
  });

  it('gives the tracker, the query and each issue as get reads it as the data of the one result event in json mode', async () => {
    const project = await plantLocalIssues();
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
    const [ref] = await tracker.find({ type: 'chore' });
    const outcome = await run(['issue', 'list', '--type=chore', '--output=json'], project);
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(ref?.externalId).toBe('2');
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
        query: { type: 'chore' },
        issues: [JSON.parse(JSON.stringify(await tracker.get(ref ?? { opt: 0, kind: 'local', externalId: '0', url: null }))) as unknown],
      },
    });
  });

  it('lists the issues of the gh fake newest first, each read with gh issue view', async () => {
    const fake = createFakeGh();
    const filed = createGithubTracker({ gh: fake.run });
    await filed.create(TIMEOUT_DRAFT);
    await filed.create(DOCS_DRAFT);
    const project = plantCase(GITHUB_CONFIG);
    const before = fake.calls().length;

    const outcome = await run(['issue', 'list'], project, createIssueListCommand({ gh: fake.run }));
    const views = fake.calls().slice(before)
      .filter((call) => call[0] === 'issue' && call[1] === 'view');

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: 'Tracker: github\n  2  todo  chore  Document issue move\n  1  todo  bug    Timeouts in plan show\n',
      stderr: '',
    });
    expect(views.map((call) => call[2])).toEqual(['2', '1']);
  });

  it('refuses --state on github with the reason of the adapter', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const reason = 'github tracker: find cannot narrow by state "todo": GitHub holds an issue open or closed, and todo'
      + ' shares open with backlog, in-progress, in-review, so a result would include those too. Search without a'
      + ' state, then read each issue with get.';

    expect(await run(['issue', 'list', '--state=todo'], project, createIssueListCommand({ gh: fake.run }))).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ Could not list issues on the github tracker: ${reason}\n`,
    });
  });

  it('refuses a line before resolving the tracker, running no gh, where a line it takes runs the preflight', async () => {
    const fake = createFakeGh();
    const project = plantCase(GITHUB_CONFIG);
    const command = createIssueListCommand({ gh: fake.run });

    const refused = await run(['issue', 'list', '--limit=0'], project, command);
    const refusedCalls = fake.calls().length;
    const argument = await run(['issue', 'list', 'bugs'], project, command);
    const argumentCalls = fake.calls().length;
    const taken = await run(['issue', 'list', '--limit=1'], project, command);

    expect(refused).toEqual({ exitCode: 1, stdout: '', stderr: `❌ --limit is "0", expected a positive whole number\nUsage: ${USAGE}\n` });
    expect(argument).toEqual({ exitCode: 1, stdout: '', stderr: `❌ Expected no argument, got 1: bugs\nUsage: ${USAGE}\n` });
    expect([refusedCalls, argumentCalls]).toEqual([0, 0]);
    expect(taken).toEqual({ exitCode: 0, stdout: 'Tracker: github\nNo issues.\n', stderr: '' });
    expect(fake.calls()[0]).toEqual(['auth', 'status']);
  });
});

/** The Roadmap issue every `--roadmap` case names in its config. */
const ROADMAP = 1;

/** A config naming `local` first and the Roadmap issue: `--roadmap` reads GitHub whatever the chain says. */
const ROADMAP_CONFIG = `tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`;

/** The Roadmap's body: three unticked lines around a ticked one, in an order no issue number sorts to. */
const ROADMAP_BODY = [
  '## Next, in order',
  '',
  '- [ ] #13 — blocked bug',
  '- [x] #12 — shipped chore',
  '- [ ] #11 — ready spec',
  '- [ ] #14 — planned bug',
  '',
].join('\n');

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function boardIssue(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : '';
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board: the four Roadmap issues, the two blockers of #13, and one bug the Roadmap does not name. */
const BOARD_JSON = JSON.stringify([
  boardIssue(11, 'Ready spec', completeSpecBody('Eleven'), 'OPEN', [SPEC_READY_LABEL, 'module:cli']),
  boardIssue(12, 'Shipped chore', 'Done.', 'CLOSED', ['type:chore']),
  boardIssue(13, 'Blocked bug', `${completeSpecBody('Thirteen')}\nBlocked by: #20, #21\n`, 'OPEN', ['type:bug', 'module:board']),
  boardIssue(14, 'Planned bug', 'Timeouts seen twice.', 'OPEN', ['type:bug']),
  boardIssue(20, 'Open blocker', 'Still open.', 'OPEN', []),
  boardIssue(21, 'Closed blocker', 'Closed.', 'CLOSED', []),
  boardIssue(30, 'Bug off the Roadmap', 'Never listed.', 'OPEN', ['type:bug']),
]);

/** The one open pull request: it closes #13. */
const PULLS_JSON = JSON.stringify([{ number: 40, headRefName: 'feat/rafa-13-blocked-bug', body: 'Closes #13' }]);

/** What the planted `gh` answers each read with; each left out answers as planted below. */
interface GhPlant {
  /** The Roadmap read. */
  readonly roadmap?: GhResult;
  /** The board listing. */
  readonly board?: GhResult;
  /** The title search. */
  readonly search?: GhResult;
  /** The `type:roadmap` listing; no board unless planted, so roadmap.issue and the title decide as before. */
  readonly boards?: GhResult;
}

/** A `gh` answering the five reads `--roadmap` makes, recording every call in `calls`. */
function plantedGh(plant: GhPlant, calls: string[][]): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const roadmap = ok(JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } }));
  return (args) => {
    calls.push([...args]);
    const [noun, verb, , value] = args;
    if (noun === 'issue' && verb === 'list' && args.includes('--label')) return Promise.resolve(plant.boards ?? ok('[]'));
    if (noun === 'issue' && verb === 'view' && args[2] === String(ROADMAP)) return Promise.resolve(plant.roadmap ?? roadmap);
    if (noun === 'issue' && verb === 'list' && value === 'all') return Promise.resolve(plant.board ?? ok(BOARD_JSON));
    if (noun === 'issue' && verb === 'list' && value === 'open') return Promise.resolve(plant.search ?? ok('[]'));
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok(PULLS_JSON));
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` });
  };
}

/** A `git` whose checkout holds a branch for #14 and whose remote holds none. */
const plantedGit: GitRunner = (args) => ({
  ok: true,
  stdout: args[0] === 'ls-remote'
    ? ''
    : 'refs/heads/main\nrefs/heads/feat/rafa-14-planned-bug\n',
  stderr: '',
});

/** A fresh project holding `config` and a plan for #14 in its plan dir. */
function plantRoadmapCase(config: string = ROADMAP_CONFIG): PlantedProject {
  const project = plantCase(config);
  const plans = join(project.root, '.rafa', 'plans');
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, 'PLAN-rafa-14-planned-bug.md'), '# Plan\n');
  return project;
}

/** The list command over the planted `gh` and `git`, with no terminal unless `width` is given. */
function roadmapCommand(plant: GhPlant, calls: string[][], width?: number): RafaCommand {
  return createIssueListCommand({ gh: plantedGh(plant, calls), git: plantedGit, terminalWidth: () => width });
}

/** The legend under a table printing every readiness and blocker symbol the Roadmap's rows hold: one line per column. */
const LEGEND = [
  'spec:        ✅ ready to plan  🟡 all sections filled, not marked ready  📝 outline only',
  'blocked by:  🔴 still open  🟢 closed',
];

/** What text mode prints for the three unticked lines, with no terminal to cut them. */
const UNTICKED_TABLE = [
  'Roadmap: #1',
  '  #  state  type  spec  blocked by     has           refs  title',
  '#13  open   bug   🟡    🔴 #20 🟢 #21  pr #40        -     Blocked bug',
  '#11  open   code  ✅    -              -             -     Ready spec',
  '#14  open   bug   📝    -              plan, branch  -     Planned bug',
  ...LEGEND,
];

/** What text mode prints under `--all`: the ticked #12 in its place, the state and type columns wider for it. */
const ALL_TABLE = [
  'Roadmap: #1',
  '  #  state   type   spec  blocked by     has           refs  title',
  '#13  open    bug    🟡    🔴 #20 🟢 #21  pr #40        -     Blocked bug',
  '#12  closed  chore  📝    -              -             -     Shipped chore',
  '#11  open    code   ✅    -              -             -     Ready spec',
  '#14  open    bug    📝    -              plan, branch  -     Planned bug',
  ...LEGEND,
];

/** The line printed for the epics with the board unreachable: no line could be told an epic. */
const UNREACHABLE_UNKNOWN = 'Roadmap #1 · epics unknown: board listing: gh issue list --state all --limit 1000 --json'
  + ' number,title,body,state,stateReason,labels failed: error connecting to api.github.com';

/**
 * What text mode prints with the board unreachable: the epics unknown,
 * then the lines' own words as titles under Specs, the plan and branch
 * still read.
 */
const UNREACHABLE_TABLE = [
  UNREACHABLE_UNKNOWN,
  '',
  'Specs',
  '  #  state  type  spec  blocked by  has           refs  title',
  '#13  -      -     -     -           -             -     blocked bug',
  '#11  -      -     -     -           -             -     ready spec',
  '#14  -      -     -     -           plan, branch  -     planned bug',
];

/** A board listing that fails as a network outage does. */
const UNREACHABLE: GhResult = { ok: false, stdout: '', stderr: 'error connecting to api.github.com' };

/** Each narrowing after the Roadmap's selection, and the issues it leaves, in order. */
const ROADMAP_NARROWED: readonly (readonly [readonly string[], readonly string[]])[] = [
  [['--type=bug'], ['#13', '#14']],
  [['--module=cli'], ['#11']],
  [['--search=TIMEOUTS'], ['#14']],
  [['--limit=2'], ['#13', '#11']],
  [['--type=bug', '--limit=1'], ['#13']],
  [['--type=code'], ['#11']],
  [['--all', '--type=chore'], ['#12']],
];

/** The warn line text mode writes, ahead of the rows, for {@link UNREACHABLE}. */
const UNREACHABLE_WARNING = 'warn: the board could not be listed, so the spec and blocked by columns are empty: board listing:'
  + ' gh issue list --state all --limit 1000 --json number,title,body,state,stateReason,labels failed: error connecting to api.github.com';

/** The first cell of each table row `stdout` holds, every line to the header dropped and the legend left out. */
function listedIssues(stdout: string): readonly string[] {
  const lines = stdout.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('Roadmap: #') || line === 'Specs') + 2)
    .map((line) => line.trim().split(' ')[0] ?? '')
    .filter((first) => first.startsWith('#'));
}

/** Each line `readIssueListLine` refuses, and the problem its refusal names. */
const LINE_REFUSALS: readonly (readonly [LineFlags, string])[] = [
  [
    { roadmap: true, state: 'open' },
    '--state cannot narrow --roadmap: the Roadmap is read off the GitHub board, which holds an issue open or closed and so no state of the tracker',
  ],
  [
    { roadmap: true, state: 'todo' },
    '--state cannot narrow --roadmap: the Roadmap is read off the GitHub board, which holds an issue open or closed and so no state of the tracker',
  ],
  [{ all: true }, '--all keeps the ticked Roadmap lines, so it needs --roadmap'],
  [{ all: true, state: 'todo' }, '--all keeps the ticked Roadmap lines, so it needs --roadmap'],
  [{ all: true, roadmap: false }, '--all keeps the ticked Roadmap lines, so it needs --roadmap'],
  [{ full: true }, '--full prints the issues of each Roadmap epic, so it needs --roadmap'],
  [{ check: true }, '--check weighs the epics the board read finds, so it needs --roadmap'],
  [{ labels: true }, '--labels prints a row under each Roadmap line, so it needs --roadmap'],
  [{ texts: true }, '--texts spells the Roadmap table\'s columns in words, so it needs --roadmap'],
  [{ refresh: true }, '--refresh reads the whole board the Roadmap is listed from, so it needs --roadmap'],
];

describe('the line rafa issue list --roadmap reads', () => {
  it('reads no switch as the plain list, and --all, --full and --check only beside --roadmap', () => {
    const none = { roadmap: false, all: false, full: false, check: false, labels: false, texts: false, refresh: false };
    expect(readIssueListLine({})).toEqual(none);
    expect(readIssueListLine({ roadmap: true, type: 'bug' })).toEqual({ ...none, roadmap: true });
    expect(readIssueListLine({ roadmap: true, all: true })).toEqual({ ...none, roadmap: true, all: true });
    expect(readIssueListLine({ roadmap: true, full: true })).toEqual({ ...none, roadmap: true, full: true });
    expect(readIssueListLine({ roadmap: true, check: true })).toEqual({ ...none, roadmap: true, check: true });
    expect(readIssueListLine({ roadmap: true, labels: true, texts: true, refresh: true }))
      .toEqual({ ...none, roadmap: true, labels: true, texts: true, refresh: true });
    expect(readIssueListLine({ state: 'todo' })).toEqual(none);
  });

  it.each(LINE_REFUSALS)('refuses the flags %j with exit code 1', (flags, problem) => {
    expect(exitOf(() => readIssueListLine(flags))).toEqual({ exitCode: 1, message: `❌ ${problem}\nUsage: ${USAGE}` });
  });

  it('refuses --roadmap typed with a value', () => {
    expect(exitOf(() => readIssueListLine({ roadmap: 'bugs' }))).toEqual({
      exitCode: 1,
      message: `❌ --roadmap takes no value, and read "bugs" as one. Type it bare: ${USAGE}`,
    });
  });
});

describe('rafa issue list --roadmap, refused', () => {
  it.each([
    [['--roadmap', '--state=open'], LINE_REFUSALS[0]?.[1]],
    [['--all'], LINE_REFUSALS[2]?.[1]],
    [['--roadmap', '--type=feature'], '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api, epic'],
    [['--roadmap', '--limit=0'], '--limit is "0", expected a positive whole number'],
  ])('refuses %j with exit code 1 before running any gh', async (flags, problem) => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();

    const refused = await run(['issue', 'list', ...flags], project, roadmapCommand({}, calls));

    expect(refused).toEqual({ exitCode: 1, stdout: '', stderr: `❌ ${problem ?? ''}\nUsage: ${USAGE}\n` });
    expect(calls).toEqual([]);
  });

  it('refuses an argument beside --roadmap, where the same project and gh answer the line without it', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();
    const command = roadmapCommand({}, calls);

    const refused = await run(['issue', 'list', '--roadmap', 'bugs'], project, command);
    const refusedCalls = calls.length;
    const taken = await run(['issue', 'list', '--roadmap'], project, command);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('❌ ');
    expect(refusedCalls).toBe(0);
    expect(taken.exitCode).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('refuses with the roadmap exit code when no open issue is titled Roadmap', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase(LOCAL_CONFIG);

    const refused = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, calls));

    expect(refused.exitCode).toBe(ROADMAP_REFUSAL_EXIT);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toStartWith('❌ Could not read the roadmap: no open issue is titled Roadmap');
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'issue list']);
  });

  it('refuses with the roadmap exit code when the Roadmap issue cannot be read, reading no board', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();
    const failed: GhResult = { ok: false, stdout: '', stderr: 'HTTP 404: Not Found' };

    const refused = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({ roadmap: failed }, calls));

    expect(refused.exitCode).toBe(ROADMAP_REFUSAL_EXIT);
    expect(refused.stderr).toStartWith('❌ Could not read the roadmap: ');
    expect(refused.stderr).toContain('HTTP 404: Not Found');
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'issue view']);
  });
});

describe('rafa issue list --roadmap', () => {
  it('prints the unticked lines in the Roadmap\'s order with spec, blocked by and has, asking no tracker', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, calls));

    expect(outcome).toEqual({ exitCode: 0, stdout: `${UNTICKED_TABLE.join('\n')}\n`, stderr: '' });
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'issue view', 'issue list', 'pr list']);
    expect(calls[0]).toEqual([...BOARDS_LIST_ARGS]);
  });

  it('keeps the ticked lines in their places under --all', async () => {
    const project = plantRoadmapCase();

    expect(await run(['issue', 'list', '--roadmap', '--all'], project, roadmapCommand({}, []))).toEqual({
      exitCode: 0,
      stdout: `${ALL_TABLE.join('\n')}\n`,
      stderr: '',
    });
  });

  it('finds the Roadmap by its title when the config names none', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase(LOCAL_CONFIG);
    const search: GhResult = { ok: true, stdout: JSON.stringify([{ number: ROADMAP, title: 'Roadmap' }]), stderr: '' };

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({ search }, calls));

    expect(outcome).toEqual({ exitCode: 0, stdout: `${UNTICKED_TABLE.join('\n')}\n`, stderr: '' });
    expect(calls[1]?.slice(0, 4)).toEqual(['issue', 'list', '--state', 'open']);
  });

  it('reads the type:roadmap board over an unlabelled issue titled Roadmap when the config names none', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase(LOCAL_CONFIG);
    const labelled = { number: ROADMAP, title: 'Team board', body: '', state: 'OPEN', stateReason: null, labels: [{ name: 'type:roadmap' }] };
    const boards: GhResult = { ok: true, stdout: JSON.stringify([labelled]), stderr: '' };
    // The search names #90, which the planted gh cannot read: reading it would fail the run.
    const search: GhResult = { ok: true, stdout: JSON.stringify([{ number: 90, title: 'Roadmap' }]), stderr: '' };

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({ boards, search }, calls));

    expect(outcome).toEqual({ exitCode: 0, stdout: `${UNTICKED_TABLE.join('\n')}\n`, stderr: '' });
    expect(calls.filter((call) => call[1] === 'view').map((call) => call[2])).toEqual([String(ROADMAP)]);
  });

  it.each(ROADMAP_NARROWED)('narrows the Roadmap\'s rows by %j after its selection, keeping its order', async (flags, issues) => {
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap', ...flags], project, roadmapCommand({}, []));

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(listedIssues(outcome.stdout)).toEqual(issues);
  });

  it('says so when the narrowing leaves no row', async () => {
    const project = plantRoadmapCase();

    expect(await run(['issue', 'list', '--roadmap', '--type=spike'], project, roadmapCommand({}, []))).toEqual({
      exitCode: 0,
      stdout: 'Roadmap: #1\nNo issues.\n',
      stderr: '',
    });
  });

  it('warns once ahead of the rows and keeps every row in the Roadmap\'s order when the board is unreachable, asking no pull request', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({ board: UNREACHABLE }, calls));

    expect(outcome).toEqual({ exitCode: 0, stdout: `${[UNREACHABLE_WARNING, ...UNREACHABLE_TABLE].join('\n')}\n`, stderr: '' });
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'issue view', 'issue list']);
  });

  it('matches no --type on a row the unreachable board did not answer, and searches its line\'s own words', async () => {
    const project = plantRoadmapCase();
    const command = roadmapCommand({ board: UNREACHABLE }, []);

    const typed = await run(['issue', 'list', '--roadmap', '--type=bug'], project, command);
    const searched = await run(['issue', 'list', '--roadmap', '--search=PLANNED'], project, command);

    expect([typed.exitCode, typed.stdout]).toEqual([0, `${UNREACHABLE_WARNING}\n${UNREACHABLE_UNKNOWN}\n`]);
    expect([searched.exitCode, listedIssues(searched.stdout)]).toEqual([0, ['#14']]);
  });

  it('prints the labels only under --labels, each under its row, cut to a narrow terminal', async () => {
    const project = plantRoadmapCase();

    const plain = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, []));
    const labelled = await run(['issue', 'list', '--roadmap', '--labels'], project, roadmapCommand({}, []));
    const narrow = await run(['issue', 'list', '--roadmap', '--labels'], project, roadmapCommand({}, [], 20));

    expect(plain.stdout).not.toContain('module:board');
    expect(labelled.stdout).toContain('#13  open   bug   🟡    🔴 #20 🟢 #21  pr #40        -     Blocked bug\n     └→ type:bug, module:board\n');
    expect(labelled.stdout).toContain('#11  open   code  ✅    -              -             -     Ready spec\n     └→ spec:ready, module:cli\n');
    expect(narrow.stdout.split('\n').find((line) => line.includes('└→ type:bug'))).toBe('     └→ type:bug, m…');
  });

  it('spells the spec and blocked by columns in words under --texts, and -t, with no legend', async () => {
    const project = plantRoadmapCase();

    const texts = await run(['issue', 'list', '--roadmap', '--texts'], project, roadmapCommand({}, []));
    const short = await run(['issue', 'list', '--roadmap', '-t'], project, roadmapCommand({}, []));

    expect(texts.stdout).toBe(stdoutOf([
      'Roadmap: #1',
      '  #  state  type  spec                                   blocked by             has           refs  title',
      '#13  open   bug   all sections filled, not marked ready  open #20 · closed #21  pr #40        -     Blocked bug',
      '#11  open   code  ready to plan                          -                      -             -     Ready spec',
      '#14  open   bug   outline only                           -                      plan, branch  -     Planned bug',
    ]));
    expect(short).toEqual(texts);
  });

  it('gives the roadmap, the filter, the rows and no warning as the data of the one result event in json mode', async () => {
    const project = plantRoadmapCase();
    const command = roadmapCommand({}, []);

    const outcome = await run(['issue', 'list', '--roadmap', '--type=bug', '--output=json'], project, command);
    const text = await run(['issue', 'list', '--roadmap', '--type=bug'], project, command);
    const events = eventsOf(outcome.stdout);
    const data = (events[1] as { data: RoadmapListResult } | undefined)?.data;

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(data).toMatchObject({ roadmap: ROADMAP, all: false, filter: { type: 'bug' }, warnings: [] });
    expect(data?.rows.map((row) => [row.line.issue, row.issue?.state, row.spec?.kind, row.has])).toEqual([
      [13, 'OPEN', 'unlabelled', [{ kind: 'pr', number: 40 }]],
      [14, 'OPEN', 'outline', [{ kind: 'plan' }, { kind: 'branch', ref: 'refs/heads/feat/rafa-14-planned-bug' }]],
    ]);
    expect(data?.rows[0]?.blockers).toEqual([{ reference: '#20', state: 'open' }, { reference: '#21', state: 'closed' }]);
    expect(data?.rows.map((row) => row.refs)).toEqual([null, null]);
    expect(`${renderRoadmapList(data ?? { roadmap: 0, rows: [] }).join('\n')}\n`).toBe(text.stdout);
  });

  it('prints each saved copy\'s suspect and dangling count in refs, - with no copy, and reads no copy off the Roadmap', async () => {
    const calls: string[][] = [];
    const asked: string[] = [];
    const project = plantRoadmapCase();
    const specs = join(project.root, '.rafa', 'specs');
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(specs, 'rafa-13-blocked-bug.md'), '# Blocked bug\n\nTouches `src/here.ts`, `src/gone.ts` and `src/far.ts`.\n');
    writeFileSync(join(specs, 'rafa-11-ready-spec.md'), '# Ready spec\n\nTouches `src/here.ts`.\n');
    writeFileSync(join(specs, 'rafa-30-off-roadmap.md'), '# Off the Roadmap\n\nTouches `src/off.ts`.\n');
    const live: Readonly<Record<string, LiveReading>> = { 'src/here.ts': PRESENT, 'src/far.ts': UNREADABLE };
    const command = createIssueListCommand({
      gh: plantedGh({}, calls),
      git: plantedGit,
      terminalWidth: () => undefined,
      refsVerifier: () => async (ref) => {
        asked.push(ref.text);
        return live[ref.text] ?? ABSENT;
      },
    });

    const text = await run(['issue', 'list', '--roadmap'], project, command);
    const json = await run(['issue', 'list', '--roadmap', '--output=json'], project, command);
    const data = (eventsOf(json.stdout).at(-1) as { data: RoadmapListResult } | undefined)?.data;

    expect([text.exitCode, text.stderr]).toEqual([0, '']);
    expect(text.stdout).toBe(`${[
      'Roadmap: #1',
      '  #  state  type  spec  blocked by     has           refs  title',
      '#13  open   bug   🟡    🔴 #20 🟢 #21  pr #40        1     Blocked bug',
      '#11  open   code  ✅    -              -             0     Ready spec',
      '#14  open   bug   📝    -              plan, branch  -     Planned bug',
      ...LEGEND,
    ].join('\n')}\n`);
    expect(data?.rows.map((row) => [row.line.issue, row.refs])).toEqual([
      [13, { copies: 1, suspect: 0, dangling: 1, unknown: 1, errors: [] }],
      [11, { copies: 1, suspect: 0, dangling: 0, unknown: 0, errors: [] }],
      [14, null],
    ]);
    expect(asked).toContain('src/gone.ts');
    expect(asked).not.toContain('src/off.ts');
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual([
      'issue list', 'issue view', 'issue list', 'pr list', 'issue list', 'issue view', 'issue list', 'pr list',
    ]);
  });

  it('carries the unreachable board as a warning in json mode, a warn log event ahead of the result', async () => {
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap', '--output=json'], project, roadmapCommand({ board: UNREACHABLE }, []));
    const events = eventsOf(outcome.stdout);
    const data = (events.at(-1) as { data: RoadmapListResult } | undefined)?.data;

    expect(outcome.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events[1]).toMatchObject({ level: 'warn' });
    expect(data?.warnings).toHaveLength(1);
    expect(data?.rows.map((row) => [row.line.issue, row.issue])).toEqual([[13, null], [11, null], [14, null]]);
  });
});

/** The Roadmap naming epics: a spec, the `now` epic, the `next` epic, a spec. */
const EPIC_ROADMAP_BODY = [
  '## Next, in order',
  '',
  '- [ ] #13 — blocked bug',
  '- [ ] #60 — alpha epic',
  '- [ ] #70 — beta epic',
  '- [ ] #14 — planned bug',
  '',
].join('\n');

/** An epic issue as the listing writes it: labelled `epic:<slug>` and `horizon`, its checklist naming `lines`. */
function boardEpic(number: number, slug: string, horizon: string, lines: readonly number[]): object {
  const checklist = lines.map((line) => `- [ ] #${String(line)}`).join('\n');
  return boardIssue(number, `Epic ${slug}`, `## Acceptance criteria\n\n- it works\n\n${checklist}\n`, 'OPEN', [
    'type:epic',
    `epic:${slug}`,
    horizon,
  ]);
}

/** The board with two epics: alpha `now` with one of two members closed, beta `next`, and #30 on a slug no epic carries. */
const EPIC_BOARD_JSON = JSON.stringify([
  ...(JSON.parse(BOARD_JSON) as object[]).filter((issue) => (issue as { number: number }).number !== 30),
  boardEpic(60, 'alpha', 'horizon:now', [61, 62]),
  boardIssue(61, 'Alpha one', completeSpecBody('Alpha one'), 'CLOSED', ['epic:alpha']),
  boardIssue(62, 'Alpha two', completeSpecBody('Alpha two'), 'OPEN', ['epic:alpha']),
  boardEpic(70, 'beta', 'horizon:next', [71]),
  boardIssue(71, 'Beta one', completeSpecBody('Beta one'), 'OPEN', ['epic:beta']),
  boardIssue(30, 'Bug off the Roadmap', 'Never listed.', 'OPEN', ['type:bug', 'epic:ghost']),
]);

/** The planted reads for the Roadmap naming epics, over {@link EPIC_BOARD_JSON}. */
const EPIC_PLANT: GhPlant = {
  roadmap: {
    ok: true,
    stdout: JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: EPIC_ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } }),
    stderr: '',
  },
  board: { ok: true, stdout: EPIC_BOARD_JSON, stderr: '' },
};

/** The warn line for #30's orphan label, written ahead of the rows. */
const GHOST_WARNING = 'warn: #30 carries epic:ghost, which no type:epic issue carries; fix the slug or open the epic';

/** The `now` group: alpha, one of its two members closed. */
const NOW_GROUP = [
  'Roadmap #1 · now',
  '  #  state        done/total  blocked  date  title',
  '#60  in-progress  1/2         -        -     Epic alpha',
];

/** The one line naming #13 and #14, the Roadmap's lines that name no epic. */
const LOOSE_LINE = 'Roadmap #1 · 2 lines name no epic: #13 #14; --full lists them';

/** #13 and #14 under `--full`, as the issue table under their heading. */
const LOOSE_GROUP = [
  'Roadmap #1 · no epic',
  '  #  state  type  spec  blocked by     has           refs  title',
  '#13  open   bug   🟡    🔴 #20 🟢 #21  pr #40        -     Blocked bug',
  '#14  open   bug   📝    -              plan, branch  -     Planned bug',
  'spec:        🟡 all sections filled, not marked ready  📝 outline only',
  'blocked by:  🔴 still open  🟢 closed',
];

/** `lines` as stdout holds them. */
function stdoutOf(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('rafa issue list --roadmap, with epics', () => {
  it('prints the now epics, the count a horizon hides and one line naming the lines in no epic, warning each label problem', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand(EPIC_PLANT, calls));

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: stdoutOf([
        GHOST_WARNING,
        ...NOW_GROUP,
        '',
        'Roadmap #1 · 1 epic not in now; --all shows every horizon',
        '',
        LOOSE_LINE,
      ]),
      stderr: '',
    });
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list', 'issue view', 'issue list', 'pr list']);
  });

  it('widens to every horizon under --all, hiding no epic', async () => {
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap', '--all'], project, roadmapCommand(EPIC_PLANT, []));

    expect(outcome.stdout).toBe(stdoutOf([
      GHOST_WARNING,
      ...NOW_GROUP,
      '',
      'Roadmap #1 · next',
      '  #  state    done/total  blocked  date  title',
      '#70  backlog  0/1         -        -     Epic beta',
      '',
      LOOSE_LINE,
    ]));
  });

  it('narrows the spec rows only, the epic rows chosen by horizon alone', async () => {
    const project = plantRoadmapCase();
    const command = roadmapCommand(EPIC_PLANT, []);

    const board = await run(['issue', 'list', '--roadmap', '--module=board'], project, command);
    const epics = await run(['issue', 'list', '--roadmap', '--type=epic'], project, command);

    expect(board.stdout).toBe(stdoutOf([
      GHOST_WARNING,
      ...NOW_GROUP,
      '',
      'Roadmap #1 · 1 epic not in now; --all shows every horizon',
      '',
      'Roadmap #1 · 1 line names no epic: #13; --full lists them',
    ]));
    expect(epics.stdout).toBe(stdoutOf([GHOST_WARNING, ...NOW_GROUP, '', 'Roadmap #1 · 1 epic not in now; --all shows every horizon']));
  });

  it('prints each now epic\'s members under its row under --full, then the lines in no epic as a table, and the same bytes under rafa roadmap', async () => {
    const project = plantRoadmapCase();
    const listed = await run(['issue', 'list', '--roadmap', '--full'], project, roadmapCommand(EPIC_PLANT, []));
    const shortcut = await dispatchInProject(
      ['roadmap', '--full'],
      [],
      [createRoadmapCommand({ gh: plantedGh(EPIC_PLANT, []), git: plantedGit, terminalWidth: () => undefined })],
      project,
    );

    expect(listed.stdout).toBe(stdoutOf([
      GHOST_WARNING,
      ...NOW_GROUP,
      '     #61  closed  Alpha one',
      '     #62  open    Alpha two',
      '',
      'Roadmap #1 · 1 epic not in now; --all shows every horizon',
      '',
      ...LOOSE_GROUP,
    ]));
    expect(shortcut).toEqual(listed);
  });

  it('prints today\'s bytes under --full for a Roadmap naming no epic', async () => {
    const project = plantRoadmapCase();
    const plain = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, []));
    const full = await run(['issue', 'list', '--roadmap', '--full'], project, roadmapCommand({}, []));

    expect(plain.stdout).toContain('Roadmap: #1');
    expect(full).toEqual(plain);
  });

  it('prints the same bytes under rafa roadmap', async () => {
    const project = plantRoadmapCase();
    const listed = await run(['issue', 'list', '--roadmap', '--all'], project, roadmapCommand(EPIC_PLANT, []));
    const shortcut = await dispatchInProject(
      ['roadmap', '--all'],
      [],
      [createRoadmapCommand({ gh: plantedGh(EPIC_PLANT, []), git: plantedGit, terminalWidth: () => undefined })],
      project,
    );

    expect(shortcut).toEqual(listed);
    expect(shortcut.stdout).toContain('Roadmap #1 · next');
  });

  it('carries the epics, the spec rows and each label problem in json mode, the problem a warn log event', async () => {
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap', '--output=json'], project, roadmapCommand(EPIC_PLANT, []));
    const events = eventsOf(outcome.stdout);
    const data = (events.at(-1) as { data: RoadmapListResult } | undefined)?.data;

    expect(outcome.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events[1]).toMatchObject({ level: 'warn', message: GHOST_WARNING.slice('warn: '.length) });
    expect(data?.rows.map((row) => row.line.issue)).toEqual([13, 14]);
    expect(data?.epics?.hidden).toBe(1);
    expect(data?.epics?.unknown).toBeNull();
    expect(data?.epics?.problems).toEqual([{ kind: 'orphan-label', issue: 30, slug: 'ghost' }]);
    expect(data?.epics?.groups.map((group) => [
      group.horizon,
      group.rows.map((row) => [row.epic.number, row.epic.state, row.epic.progress.done, row.epic.progress.total]),
    ])).toEqual([['now', [[60, 'in-progress', 1, 2]]]]);
    expect(data?.warnings).toEqual([GHOST_WARNING.slice('warn: '.length)]);
  });

  it('carries no epics key for a Roadmap naming no epic, where the one naming epics carries it', async () => {
    const project = plantRoadmapCase();
    const plain = await run(['issue', 'list', '--roadmap', '--output=json'], project, roadmapCommand({}, []));
    const withEpics = await run(['issue', 'list', '--roadmap', '--output=json'], project, roadmapCommand(EPIC_PLANT, []));
    const dataOf = (stdout: string): object => (eventsOf(stdout).at(-1) as { data: object } | undefined)?.data ?? {};

    expect(Object.keys(dataOf(plain.stdout))).toEqual(['roadmap', 'all', 'filter', 'rows', 'warnings']);
    expect(Object.keys(dataOf(withEpics.stdout))).toEqual(['roadmap', 'all', 'filter', 'rows', 'warnings', 'epics']);
  });

  it('prints the epics unknown with the listing\'s reason when the board is unreachable, every line a spec row', async () => {
    const project = plantRoadmapCase();
    const plant: GhPlant = { ...EPIC_PLANT, board: UNREACHABLE };

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand(plant, []));

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(outcome.stdout.split('\n').slice(0, 4)).toEqual([UNREACHABLE_WARNING, UNREACHABLE_UNKNOWN, '', 'Specs']);
    expect(outcome.stdout.split('\n').slice(5, -1)
      .map((line) => line.split(' ')[0])).toEqual(['#13', '#60', '#70', '#14']);
  });
});

describe('rafa issue list --roadmap, reading less', () => {
  /** A list command over {@link EPIC_PLANT} whose refs verifier records every reference it is asked about. */
  function recordingCommand(asked: string[], plant: GhPlant = EPIC_PLANT): RafaCommand {
    return createIssueListCommand({
      gh: plantedGh(plant, []),
      git: plantedGit,
      terminalWidth: () => undefined,
      refsVerifier: () => async (ref) => {
        asked.push(ref.text);
        return ABSENT;
      },
    });
  }

  /** A project whose loose line #13 has a saved copy naming one path. */
  function withCopy(): PlantedProject {
    const project = plantRoadmapCase();
    const specs = join(project.root, '.rafa', 'specs');
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(specs, 'rafa-13-blocked-bug.md'), '# Blocked bug\n\nTouches `src/here.ts`.\n');
    return project;
  }

  it('reads no saved copy in text mode when the Roadmap names epics, since no refs column is printed', async () => {
    const asked: string[] = [];
    const outcome = await run(['issue', 'list', '--roadmap'], withCopy(), recordingCommand(asked));

    expect(outcome.exitCode).toBe(0);
    expect(asked).toEqual([]);
  });

  it('still reads them under --full, which prints the lines naming no epic with their refs column', async () => {
    const asked: string[] = [];
    await run(['issue', 'list', '--roadmap', '--full'], withCopy(), recordingCommand(asked));

    expect(asked).toContain('src/here.ts');
  });

  it('still reads the saved copies in json mode, whose rows carry the refs', async () => {
    const asked: string[] = [];
    await run(['issue', 'list', '--roadmap', '--output=json'], withCopy(), recordingCommand(asked));

    expect(asked).toContain('src/here.ts');
  });

  it('still reads them in text mode for a Roadmap naming no epic, which prints the refs column', async () => {
    const asked: string[] = [];
    await run(['issue', 'list', '--roadmap'], withCopy(), recordingCommand(asked, {}));

    expect(asked).toContain('src/here.ts');
  });

  it('keeps the board listing with boardCache, and reads only what changed since on the next run', async () => {
    const calls: string[][] = [];
    const planted = plantedGh({}, calls);
    const gh: GhRunner = (args) => {
      if (args.join(' ') === WATERMARK_ARGS.join(' ')) {
        calls.push([...args]);
        return Promise.resolve({ ok: true, stdout: '2026-09-28T10:00:00Z\n', stderr: '' });
      }
      if (args.join(' ') === changedArgs('2026-09-28T10:00:00Z').join(' ')) {
        calls.push([...args]);
        return Promise.resolve({ ok: true, stdout: '', stderr: '' });
      }
      return planted(args);
    };
    const command = createIssueListCommand({ gh, git: plantedGit, terminalWidth: () => undefined, boardCache: true });
    const project = plantRoadmapCase();

    const first = await run(['issue', 'list', '--roadmap'], project, command);
    const firstCalls = calls.splice(0).map((call) => call.join(' '));
    const second = await run(['issue', 'list', '--roadmap'], project, command);
    const secondCalls = calls.splice(0).map((call) => call.join(' '));

    expect(second.stdout).toBe(first.stdout);
    expect(firstCalls).toContain(WATERMARK_ARGS.join(' '));
    expect(firstCalls.some((call) => call.startsWith('issue list --state all'))).toBe(true);
    expect(secondCalls).toContain(changedArgs('2026-09-28T10:00:00Z').join(' '));
    expect(secondCalls.some((call) => call.startsWith('issue list --state all'))).toBe(false);
  });

  it('reads the whole board again under --refresh, whatever was kept', async () => {
    const calls: string[][] = [];
    const planted = plantedGh({}, calls);
    const gh: GhRunner = (args) => args.join(' ') === WATERMARK_ARGS.join(' ')
      ? Promise.resolve({ ok: true, stdout: '2026-09-28T10:00:00Z\n', stderr: '' })
      : planted(args);
    const command = createIssueListCommand({ gh, git: plantedGit, terminalWidth: () => undefined, boardCache: true });
    const project = plantRoadmapCase();

    await run(['issue', 'list', '--roadmap'], project, command);
    calls.splice(0);
    await run(['issue', 'list', '--roadmap', '--refresh'], project, command);

    expect(calls.some((call) => call.join(' ').startsWith('issue list --state all'))).toBe(true);
    expect(calls.some((call) => call[0] === 'api' && call[1] === '--paginate')).toBe(false);
  });
});

/** {@link EPIC_PLANT} with `closed` closed as completed on the board. */
function closingPlant(closed: readonly number[]): GhPlant {
  const board = (JSON.parse(EPIC_BOARD_JSON) as { number: number; state: string; stateReason: string | null }[])
    .map((issue) => closed.includes(issue.number)
      ? { ...issue, state: 'CLOSED', stateReason: 'COMPLETED' }
      : issue);
  return { ...EPIC_PLANT, board: { ok: true, stdout: JSON.stringify(board), stderr: '' } };
}

/** What `--check` ends with when alpha, #60, is open with both its members closed. */
const ALPHA_DONE_FAILURE = '❌ 1 epic\'s stored state disagrees with its computed one:\n  done, but epic #60 is still open';

describe('rafa issue list --roadmap --check', () => {
  it('passes the board whose epics agree, printing the bytes the line prints without it', async () => {
    const project = plantRoadmapCase();
    const plain = await run(['issue', 'list', '--roadmap'], project, roadmapCommand(EPIC_PLANT, []));
    const checked = await run(['issue', 'list', '--roadmap', '--check'], project, roadmapCommand(EPIC_PLANT, []));

    expect(checked).toEqual(plain);
    expect(checked.exitCode).toBe(0);
  });

  it('exits 1 on an open epic whose members are all closed, the table still printed, where the line without it exits 0', async () => {
    const project = plantRoadmapCase();
    const plant = closingPlant([62]);
    const plain = await run(['issue', 'list', '--roadmap'], project, roadmapCommand(plant, []));
    const checked = await run(['issue', 'list', '--roadmap', '--check'], project, roadmapCommand(plant, []));
    const shortcut = await dispatchInProject(
      ['roadmap', '--check'],
      [],
      [createRoadmapCommand({ gh: plantedGh(plant, []), git: plantedGit, terminalWidth: () => undefined })],
      project,
    );

    expect([plain.exitCode, plain.stderr]).toEqual([0, '']);
    expect(plain.stdout).toContain('done, but epic #60 is still open');
    expect(checked).toEqual({ exitCode: 1, stdout: plain.stdout, stderr: `${ALPHA_DONE_FAILURE}\n` });
    expect(shortcut).toEqual(checked);
  });

  it('weighs an epic a horizon hides too, naming it', async () => {
    const project = plantRoadmapCase();

    const checked = await run(['issue', 'list', '--roadmap', '--check'], project, roadmapCommand(closingPlant([71]), []));

    expect(checked.stdout).not.toContain('#70');
    expect([checked.exitCode, checked.stderr]).toEqual([
      1,
      '❌ 1 epic\'s stored state disagrees with its computed one:\n  done, but epic #70 is still open\n',
    ]);
  });

  it('ends with the failure as the terminal error\'s message and no data in json mode', async () => {
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap', '--check', '--output=json'], project, roadmapCommand(closingPlant([62]), []));
    const events = eventsOf(outcome.stdout);

    expect(outcome.exitCode).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events.at(-1)).toEqual({
      type: 'result',
      ok: false,
      error: { code: 'command_exit', message: ALPHA_DONE_FAILURE },
      ts: expect.any(String),
    });
  });

  it('exits 1 with the listing\'s reason when the board is unreachable, where the line without it exits 0', async () => {
    const project = plantRoadmapCase();
    const plant: GhPlant = { ...EPIC_PLANT, board: UNREACHABLE };
    const plain = await run(['issue', 'list', '--roadmap'], project, roadmapCommand(plant, []));

    const checked = await run(['issue', 'list', '--roadmap', '--check'], project, roadmapCommand(plant, []));

    expect(plain.exitCode).toBe(0);
    expect(checked.exitCode).toBe(1);
    expect(checked.stdout).toBe(plain.stdout);
    expect(checked.stderr).toStartWith('❌ Could not check the epics: board listing: gh issue list');
  });
});
