/**
 * Tests for `rafa issue show` (`show.ts`): the lines text mode writes for
 * an issue, one issue read from a `local` tracker, from the recorded `gh`
 * fake and from `local` once `github` fails its preflight, the json
 * result, and the refusals of the line and of an id no issue holds.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`). The degraded case files
 * an issue 1 on `local` and a different issue 1 on the fake, so reading
 * the wrong tracker differs from what is held.
 */
import type { Issue, IssueDraft } from '../../ports/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createIssueShowCommand, renderIssue } from './show.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-show-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue show <id>';

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** A config naming `local` first. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A config naming `github` first, then `local`. */
const GITHUB_CONFIG = 'tracker:\n  default: github\n  fallback: [local]\n';

/** What the `github` preflight answers over a fake with no host logged in. */
const NOT_LOGGED_IN = 'gh auth status: You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** The issue each case files first: a bug with no priority. */
const DRAFT: IssueDraft = {
  opt: 0,
  title: 'Timeouts in plan show',
  body: 'Seen twice.',
  type: 'bug',
  module: 'cli',
  priority: null,
  project: null,
  blockedBy: [],
};

/** What text mode writes for the draft filed on `local` as issue 1. */
const LOCAL_TEXT = [
  'Tracker: local',
  'Issue: 1',
  'Title: Timeouts in plan show',
  'State: todo',
  'Type: bug',
  'Module: cli',
  'Priority: needs-triage',
  '',
  'Seen twice.',
];

/** A fresh project holding `config`, with the draft filed on its `local` tracker as issue 1. */
async function plantLocalIssue(config: string): Promise<PlantedProject> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), config);
  await createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null }).create(DRAFT);
  return project;
}

describe('the lines rafa issue show writes', () => {
  it('writes every field a tracker gives, then a blank line and the body line by line', () => {
    const issue: Issue = {
      ...DRAFT,
      body: 'First line.\n\nThird line.\n\n',
      priority: 'high',
      project: 'board',
      blockedBy: [4, 5],
      ref: { opt: 0, kind: 'github', externalId: '12', url: 'https://github.com/open-tomato/rafa/issues/12' },
      state: 'in-review',
    };

    expect(renderIssue('github', issue)).toEqual([
      'Tracker: github',
      'Issue: 12',
      'URL: https://github.com/open-tomato/rafa/issues/12',
      'Title: Timeouts in plan show',
      'State: in-review',
      'Type: bug',
      'Module: cli',
      'Priority: high',
      'Project: board',
      'Blocked by: 4, 5',
      '',
      'First line.',
      '',
      'Third line.',
    ]);
  });

  it('leaves out the URL, the project, the blockers and a body of whitespace, and names a missing priority needs-triage', () => {
    const issue: Issue = { ...DRAFT, body: ' \n', ref: { opt: 0, kind: 'local', externalId: '3', url: null }, state: 'todo' };

    expect(renderIssue('local', issue)).toEqual(LOCAL_TEXT.slice(0, -2).map((line) => line.replace('Issue: 1', 'Issue: 3')));
  });
});

describe('rafa issue show, dispatched', () => {
  it('prints a local issue in text mode', async () => {
    const project = await plantLocalIssue(LOCAL_CONFIG);

    expect(await dispatchInProject(['issue', 'show', '1'], SUBJECTS, [createIssueShowCommand()], project)).toEqual({
      exitCode: 0,
      stdout: `${LOCAL_TEXT.join('\n')}\n`,
      stderr: '',
    });
  });

  it('gives the tracker and the issue as get reads it as the data of the one result event in json mode', async () => {
    const project = await plantLocalIssue(LOCAL_CONFIG);
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
    const outcome = await dispatchInProject(['issue', 'show', '1', '--output=json'], SUBJECTS, [createIssueShowCommand()], project);
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
        issue: JSON.parse(JSON.stringify(await tracker.get({ opt: 0, kind: 'local', externalId: '1', url: null }))) as unknown,
      },
    });
  });

  it('prints an issue of the gh fake with its URL and the priority its label names', async () => {
    const fake = createFakeGh();
    await createGithubTracker({ gh: fake.run }).create({ ...DRAFT, priority: 'high' });
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), GITHUB_CONFIG);

    const outcome = await dispatchInProject(['issue', 'show', '1'], SUBJECTS, [createIssueShowCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [
        'Tracker: github',
        'Issue: 1',
        'URL: https://github.com/open-tomato/rafa/issues/1',
        'Title: Timeouts in plan show',
        'State: todo',
        'Type: bug',
        'Module: cli',
        'Priority: high',
        '',
        'Seen twice.',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  it('reads the id on local once github fails its preflight, after the warning, and not the github issue of that number', async () => {
    const fake = createFakeGh({ authOk: false });
    await createGithubTracker({ gh: fake.run }).create({ ...DRAFT, title: 'The github issue one' });
    const project = await plantLocalIssue(GITHUB_CONFIG);

    const outcome = await dispatchInProject(['issue', 'show', '1'], SUBJECTS, [createIssueShowCommand({ gh: fake.run })], project);

    expect(fake.issue('1')?.title).toBe('The github issue one');
    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `warn: tracker chain: github unavailable: ${NOT_LOGGED_IN}\n${LOCAL_TEXT.join('\n')}\n`,
      stderr: '',
    });
  });

  it.each([
    [[], `❌ Expected one argument, got none\nUsage: ${USAGE}`],
    [['1', '2'], `❌ Expected one argument, got 2: 1 2\nUsage: ${USAGE}`],
    [['9'], '❌ Could not read issue 9 on the local tracker: local tracker: no issue 9 under <issues>'],
    [
      ['abc'],
      '❌ Could not read issue abc on the local tracker: local tracker: externalId "abc" is not a local issue number,'
        + ' expected a positive whole number with no leading zero',
    ],
  ])('refuses the words %j with exit code 1', async (words, message) => {
    const project = await plantLocalIssue(LOCAL_CONFIG);

    expect(await dispatchInProject(['issue', 'show', ...words], SUBJECTS, [createIssueShowCommand()], project)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `${message.replace('<issues>', localIssuesDir(project.root))}\n`,
    });
  });
});
