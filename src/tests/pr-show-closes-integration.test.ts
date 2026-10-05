/**
 * An integration suite over `rafa pr show` on a fixture pull request that
 * closes #7 by a body keyword and #9 from the Development panel
 * (`src/commands/pr/show.ts`), dispatched in-process over the real `gh`
 * pull-request adapter and the recorded `gh` fake: `--output=json` answers
 * both issues in `detail.closes`, with the body reading naming #7 alone, and
 * the text marks #9 as not named by the body.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPrShowCommand, NOT_IN_BODY } from '../commands/pr/show.js';
import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests } from '../pr/index.js';

import { dispatchInProject, eventsOf, plantProject } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-show-closes-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];
const BRANCH = 'feat/rafa-30-closes';
const HEAD_OID = '0badc0ffee1234567890abcdef1234567890abcd';

/** Dispatches `rafa pr show 41 <flags>` over a fake repository holding the fixture pull request. */
async function showFixture(...flags: string[]) {
  const fake = createFakePrGh();
  fake.plant({
    number: 41,
    headRefName: BRANCH,
    headRefOid: HEAD_OID,
    title: 'Close two issues',
    body: 'Closes #7\n\nThe rest of the description.',
    closes: [{ number: 7 }, { number: 9 }],
  });
  const command = createPrShowCommand({
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    readBranch: () => BRANCH,
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
  });
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'pr:\n  provider: gh\n');
  return dispatchInProject(['pr', 'show', '41', ...flags], SUBJECTS, [command], project);
}

describe('rafa pr show over a pull request closing #7 by keyword and #9 from the Development panel', () => {
  it('answers both issues in closes under --output=json, the body naming #7 alone', async () => {
    const run = await showFixture('--output=json');
    const data = (eventsOf(run.stdout).at(-1) as { data?: unknown }).data as {
      detail: { closes: { number: number }[] };
      bodyCloses: number[];
    };

    expect(run.exitCode).toBe(0);
    expect(data.detail.closes.map((issue) => issue.number)).toEqual([7, 9]);
    expect(data.bodyCloses).toEqual([7]);
  });

  it('marks #9 as not named by the body in the text, and #7 plainly', async () => {
    const run = await showFixture();
    const lines = run.stdout.split('\n');

    expect(run.exitCode).toBe(0);
    expect(lines).toContain(`closes #7, #9 (${NOT_IN_BODY})`);
  });
});
