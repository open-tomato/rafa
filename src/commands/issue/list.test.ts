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
 */
import type { LineFlags } from './issue-tracker.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Issue, IssueDraft } from '../../ports/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createIssueListCommand, readIssueQuery, renderIssueList } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue list [--state=<state>] [--type=<type>] [--module=<name>] [--search=<text>] [--limit=<n>]';

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
