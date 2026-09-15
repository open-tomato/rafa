/**
 * Tests for `rafa issue comment` (`comment.ts`): a comment posted on a
 * `local` issue and on an issue of the recorded `gh` fake, the json
 * result, and the refusals of the line and of an id no issue holds.
 *
 * Every dispatched case runs from a project of its own under this file's
 * temporary directory (`tests/cli-capture.ts`). A line refused for its
 * words is held to leave the issue file byte for byte and to run no `gh`,
 * beside the same project taking a line the command accepts, which
 * changes the file.
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

import { createIssueCommentCommand } from './comment.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-comment-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line a refusal names. */
const USAGE = 'rafa issue comment <id> --body=<text>';

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

/** A fresh `local` project holding issue 1, and the path of its file. */
async function plantLocalIssue(): Promise<{ project: PlantedProject; file: string }> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
  await createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null }).create(DRAFT);
  return { project, file: join(localIssuesDir(project.root), '1.md') };
}

describe('rafa issue comment, dispatched', () => {
  it('appends the body to a local issue, stamped with the time', async () => {
    const { project, file } = await plantLocalIssue();

    const outcome = await dispatchInProject(
      ['issue', 'comment', '1', '--body=Seen again after the retry change.'],
      SUBJECTS,
      [createIssueCommentCommand()],
      project,
    );
    const { comments } = parseLocalIssue(readFileSync(file, 'utf8'), file);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Commented on local issue 1.\n', stderr: '' });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z: Seen again after the retry change\.$/);
  });

  it('gives the tracker and the ref as the data of the one result event in json mode', async () => {
    const { project } = await plantLocalIssue();

    const outcome = await dispatchInProject(['issue', 'comment', '1', '--body=Reproduced', '--output=json'], SUBJECTS, [createIssueCommentCommand()], project);
    const events = eventsOf(outcome.stdout);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      ok: true,
      data: {
        tracker: { kind: 'local', degraded: false, fallbackReason: null },
        ref: { opt: 0, kind: 'local', externalId: '1', url: null },
      },
    });
  });

  it('posts the body on an issue of the gh fake', async () => {
    const fake = createFakeGh();
    await createGithubTracker({ gh: fake.run }).create(DRAFT);
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: github\n  fallback: [local]\n');

    const outcome = await dispatchInProject(['issue', 'comment', '1', '--body=Reproduced'], SUBJECTS, [createIssueCommentCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Commented on github issue 1.\n', stderr: '' });
    expect(fake.issue('1')?.comments).toEqual(['Reproduced']);
  });

  it.each([
    [['1'], `❌ --body is required: --body=<value>\nUsage: ${USAGE}\n`],
    [['1', '--body= '], `❌ --body cannot be blank: --body=<value>\nUsage: ${USAGE}\n`],
    [['1', '--body'], `❌ --body needs a value: --body=<value>\nUsage: ${USAGE}\n`],
    [['--body=Reproduced'], `❌ Expected one argument, got none\nUsage: ${USAGE}\n`],
    [['1', '2', '--body=Reproduced'], `❌ Expected one argument, got 2: 1 2\nUsage: ${USAGE}\n`],
  ])('refuses the words %j with exit code 1, leaving the issue as it was and running no gh', async (words, stderr) => {
    const { project, file } = await plantLocalIssue();
    const fake = createFakeGh();
    const before = readFileSync(file, 'utf8');

    const outcome = await dispatchInProject(['issue', 'comment', ...words], SUBJECTS, [createIssueCommentCommand({ gh: fake.run })], project);

    expect(outcome).toEqual({ exitCode: 1, stdout: '', stderr });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(fake.calls()).toEqual([]);
  });

  it('refuses an id no local issue holds, naming the directory read', async () => {
    const { project } = await plantLocalIssue();

    expect(await dispatchInProject(['issue', 'comment', '9', '--body=Reproduced'], SUBJECTS, [createIssueCommentCommand()], project)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ Could not comment on issue 9 on the local tracker: local tracker: no issue 9 under ${localIssuesDir(project.root)}\n`,
    });
  });
});
