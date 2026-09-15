/**
 * Tests for `rafa issue move` (`move.ts`): a `local` issue moved to any
 * state, an issue of the recorded `gh` fake closed and moved to a state
 * GitHub cannot hold, with the warning in both modes, and the refusals of
 * the line and of an id no issue holds.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`). A state refused is held
 * to run no `gh`, beside the fake cases taking a state the command
 * accepts, which run the preflight and the move.
 */
import type { IssueDraft } from '../../ports/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir, parseLocalIssue } from '../../adapters/tracker/local.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createIssueMoveCommand } from './move.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-move-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue move <id> <state>';

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The issue each case files first. */
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

/** What the adapter warns once issue 1 is moved to backlog. */
const BACKLOG_WARNING = 'issue #1 is now open, but GitHub Issues without a board holds no backlog state, so get reads it back as todo';

/** A fresh `local` project holding issue 1, and the path of its file. */
async function plantLocalIssue(): Promise<{ project: PlantedProject; file: string }> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
  await createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null }).create(DRAFT);
  return { project, file: join(localIssuesDir(project.root), '1.md') };
}

/** A fresh `github` project, and a fake holding issue 1. */
async function plantGithubIssue(): Promise<{ project: PlantedProject; fake: ReturnType<typeof createFakeGh> }> {
  const fake = createFakeGh();
  await createGithubTracker({ gh: fake.run }).create(DRAFT);
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: github\n  fallback: [local]\n');
  return { project, fake };
}

describe('rafa issue move, dispatched', () => {
  it('writes any state into a local issue, with no warning', async () => {
    const { project, file } = await plantLocalIssue();

    const outcome = await dispatchInProject(['issue', 'move', '1', 'in-review'], SUBJECTS, [createIssueMoveCommand()], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Moved local issue 1 to in-review.\n', stderr: '' });
    expect(parseLocalIssue(readFileSync(file, 'utf8'), file).state).toBe('in-review');
  });

  it('gives the tracker, the ref, the state and a null warning as the data of the one result event in json mode', async () => {
    const { project } = await plantLocalIssue();

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done', '--output=json'], SUBJECTS, [createIssueMoveCommand()], project);
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
        ref: { opt: 0, kind: 'local', externalId: '1', url: null },
        state: 'done',
        warning: null,
      },
    });
  });

  it('closes an issue of the gh fake as completed when moved to done', async () => {
    const { project, fake } = await plantGithubIssue();

    const outcome = await dispatchInProject(['issue', 'move', '1', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Moved github issue 1 to done.\n', stderr: '' });
    expect(fake.issue('1')).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED' });
  });

  it('warns after the moved line for a state github cannot hold, and still exits 0', async () => {
    const { project, fake } = await plantGithubIssue();

    const outcome = await dispatchInProject(['issue', 'move', '1', 'backlog'], SUBJECTS, [createIssueMoveCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `Moved github issue 1 to backlog.\nwarn: github issue 1: ${BACKLOG_WARNING}\n`,
      stderr: '',
    });
    expect(fake.issue('1')).toMatchObject({ state: 'OPEN' });
  });

  it('warns before the result in json mode, the warning also in its data', async () => {
    const { project, fake } = await plantGithubIssue();

    const outcome = await dispatchInProject(['issue', 'move', '1', 'backlog', '--output=json'], SUBJECTS, [createIssueMoveCommand({ gh: fake.run })], project);
    const events = eventsOf(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events[1]).toMatchObject({ level: 'warn', message: `github issue 1: ${BACKLOG_WARNING}` });
    expect(events[2]).toMatchObject({ ok: true, data: { state: 'backlog', warning: BACKLOG_WARNING } });
  });

  it.each([
    [['1', 'finished'], `❌ The state is "finished", expected one of: backlog, todo, in-progress, in-review, done, released, cancelled\nUsage: ${USAGE}\n`],
    [['1'], `❌ Expected two arguments, got 1: 1\nUsage: ${USAGE}\n`],
    [[], `❌ Expected two arguments, got none\nUsage: ${USAGE}\n`],
  ])('refuses the words %j with exit code 1, running no gh', async (words, stderr) => {
    const { project, fake } = await plantGithubIssue();
    const before = fake.calls().length;

    const outcome = await dispatchInProject(['issue', 'move', ...words], SUBJECTS, [createIssueMoveCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({ exitCode: 1, stdout: '', stderr });
    expect(fake.calls().length).toBe(before);
  });

  it('refuses an id no issue of the gh fake holds, with the message of the adapter', async () => {
    const { project, fake } = await plantGithubIssue();
    const detail = 'GraphQL: Could not resolve to an issue or pull request with the number of 9. (repository.issue)';

    expect(await dispatchInProject(['issue', 'move', '9', 'done'], SUBJECTS, [createIssueMoveCommand({ gh: fake.run })], project)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ Could not move issue 9 to done on the github tracker: github tracker: gh api PATCH repos/{owner}/{repo}/issues/9 failed: ${detail}\n`,
    });
  });
});
