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
 * board unreachable, and in json mode.
 */
import type { LineFlags } from './issue-tracker.js';
import type { RoadmapListResult } from './list.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Issue, IssueDraft } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { ROADMAP_REFUSAL_EXIT } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import { createIssueListCommand, readIssueListLine, readIssueQuery, renderIssueList, renderRoadmapList } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--roadmap [--all]] [--state=<state>] [--type=<type>] [--module=<name>]'
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
  [{ type: 'feature' }, '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api'],
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

/** One issue as `gh issue list --json number,title,body,state,labels` writes it. */
function boardIssue(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  return { number, title, body, state, labels: labels.map((name) => ({ name })) };
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
}

/** A `gh` answering the four reads `--roadmap` makes, recording every call in `calls`. */
function plantedGh(plant: GhPlant, calls: string[][]): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const roadmap = ok(JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } }));
  return (args) => {
    calls.push([...args]);
    const [noun, verb, , value] = args;
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

/** What text mode prints for the three unticked lines, with no terminal to cut them. */
const UNTICKED_TABLE = [
  'Roadmap: #1',
  '  #  state  type  spec                      blocked by            has           labels                  title',
  '#13  open   bug   label: none, gate: ready  #20 open, #21 closed  pr #40        type:bug, module:board  Blocked bug',
  '#11  open   code  ready                     -                     -             spec:ready, module:cli  Ready spec',
  '#14  open   bug   outline                   -                     plan, branch  type:bug                Planned bug',
];

/** What text mode prints under `--all`: the ticked #12 in its place, the state and type columns wider for it. */
const ALL_TABLE = [
  'Roadmap: #1',
  '  #  state   type   spec                      blocked by            has           labels                  title',
  '#13  open    bug    label: none, gate: ready  #20 open, #21 closed  pr #40        type:bug, module:board  Blocked bug',
  '#12  closed  chore  outline                   -                     -             type:chore              Shipped chore',
  '#11  open    code   ready                     -                     -             spec:ready, module:cli  Ready spec',
  '#14  open    bug    outline                   -                     plan, branch  type:bug                Planned bug',
];

/** What text mode prints with the board unreachable: the lines' own words as titles, the plan and branch still read. */
const UNREACHABLE_TABLE = [
  'Roadmap: #1',
  '  #  state  type  spec  blocked by  has           labels  title',
  '#13  -      -     -     -           -             -       blocked bug',
  '#11  -      -     -     -           -             -       ready spec',
  '#14  -      -     -     -           plan, branch  -       planned bug',
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
  + ' gh issue list --state all --limit 1000 --json number,title,body,state,labels failed: error connecting to api.github.com';

/** The first cell of each table row `stdout` holds, every line to the header dropped. */
function listedIssues(stdout: string): readonly string[] {
  const lines = stdout.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('Roadmap: #')) + 2)
    .filter((line) => line !== '')
    .map((line) => line.trim().split(' ')[0] ?? '');
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
];

describe('the line rafa issue list --roadmap reads', () => {
  it('reads neither switch as the plain list, and --all only beside --roadmap', () => {
    expect(readIssueListLine({})).toEqual({ roadmap: false, all: false });
    expect(readIssueListLine({ roadmap: true, type: 'bug' })).toEqual({ roadmap: true, all: false });
    expect(readIssueListLine({ roadmap: true, all: true })).toEqual({ roadmap: true, all: true });
    expect(readIssueListLine({ state: 'todo' })).toEqual({ roadmap: false, all: false });
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
    [['--roadmap', '--type=feature'], '--type is "feature", expected one of: code, bug, spike, adr, chore, package-api'],
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
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue list']);
  });

  it('refuses with the roadmap exit code when the Roadmap issue cannot be read, reading no board', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();
    const failed: GhResult = { ok: false, stdout: '', stderr: 'HTTP 404: Not Found' };

    const refused = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({ roadmap: failed }, calls));

    expect(refused.exitCode).toBe(ROADMAP_REFUSAL_EXIT);
    expect(refused.stderr).toStartWith('❌ Could not read the roadmap: ');
    expect(refused.stderr).toContain('HTTP 404: Not Found');
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue view']);
  });
});

describe('rafa issue list --roadmap', () => {
  it('prints the unticked lines in the Roadmap\'s order with spec, blocked by and has, asking no tracker', async () => {
    const calls: string[][] = [];
    const project = plantRoadmapCase();

    const outcome = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, calls));

    expect(outcome).toEqual({ exitCode: 0, stdout: `${UNTICKED_TABLE.join('\n')}\n`, stderr: '' });
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue view', 'issue list', 'pr list']);
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
    expect(calls[0]?.slice(0, 4)).toEqual(['issue', 'list', '--state', 'open']);
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
    expect(calls.map((call) => call.slice(0, 2).join(' '))).toEqual(['issue view', 'issue list']);
  });

  it('matches no --type on a row the unreachable board did not answer, and searches its line\'s own words', async () => {
    const project = plantRoadmapCase();
    const command = roadmapCommand({ board: UNREACHABLE }, []);

    const typed = await run(['issue', 'list', '--roadmap', '--type=bug'], project, command);
    const searched = await run(['issue', 'list', '--roadmap', '--search=PLANNED'], project, command);

    expect([typed.exitCode, typed.stdout]).toEqual([0, `${UNREACHABLE_WARNING}\nRoadmap: #1\nNo issues.\n`]);
    expect([searched.exitCode, listedIssues(searched.stdout)]).toEqual([0, ['#14']]);
  });

  it('cuts labels toward their floor on a narrow terminal, and nothing with no terminal', async () => {
    const project = plantRoadmapCase();

    const narrow = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, [], 100));
    const uncut = await run(['issue', 'list', '--roadmap'], project, roadmapCommand({}, []));

    expect(narrow.stdout).toContain('#20 open, #21 closed  pr #40        type:bug, m…  Blocked bug\n');
    expect(uncut.stdout).toContain('type:bug, module:board  Blocked bug\n');
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
    expect(`${renderRoadmapList(data ?? { roadmap: 0, rows: [] }).join('\n')}\n`).toBe(text.stdout);
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
