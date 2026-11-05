/**
 * An integration suite driving `rafa stretch end` three times over the
 * in-memory `gh` fake (`packages/rafa-pr/src/pr/gh-fake.ts`) behind the
 * real `gh` provider (`src/commands/stretch/end.ts`): the first run opens
 * the pull request from `stretch/4`; a ledger line added between the runs
 * makes the second print `body updated` with the fake recording one
 * `pr edit --body`; a third, with the ledger as it was, prints `body
 * unchanged` and the fake records no further edit.
 *
 * `report.md`, the ledger, `stretch.json`, the body file and the config
 * are real files in a planted project; only `origin/HEAD` is a git seam.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '@open-tomato/rafa-pr/pr/gh-fake';
import { createGhPullRequests } from '@open-tomato/rafa-pr/pr/index';

import { createStretchEndCommand, reportPath } from '../commands/stretch/end.js';
import { stretchRecordPath } from '../commands/stretch/start.js';
import { appendItem } from '../stretch/items.js';

import { dispatchInProject, plantProject } from './cli-capture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-end-refresh-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const CONFIG = 'version: 1\npr:\n  provider: gh\n  base: stretch/4\n';

const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** A ledger item for issue `issue`, merged as `pullRequest`. */
function ledgerItem(issue: string, pullRequest: number) {
  return {
    issue,
    plan: `rafa-${issue}-one`,
    pullRequest,
    mergeCommit: 'a'.repeat(40),
    closes: [`Closes #${issue}`],
    at: '2026-10-01T10:00:00.000Z',
  };
}

/** The `pr edit` commands the fake was handed that set a body. */
function bodyEdits(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[0] === 'pr' && call[1] === 'edit' && call.includes('--body'));
}

describe('rafa stretch end run three times over the gh fake', () => {
  it('opens, then updates the body after a new ledger line, then leaves it unchanged', async () => {
    const project = plantProject(mkdtempSync(join(scope, 'case-')), CONFIG);
    mkdirSync(dirname(reportPath(project.root, 4)), { recursive: true });
    writeFileSync(reportPath(project.root, 4), '# Stretch 4\n\nWhat merged: #901, #902.\n', 'utf8');
    mkdirSync(dirname(stretchRecordPath(project.root, 4)), { recursive: true });
    writeFileSync(stretchRecordPath(project.root, 4), `${JSON.stringify({
      stretch: 4, branch: 'stretch/4', defaultBranch: 'main', prBase: 'develop', startedAt: '2026-10-01T09:00:00.000Z',
    })}\n`, 'utf8');
    appendItem(project.root, 4, ledgerItem('812', 901));

    const fake = createFakePrGh();
    const command = createStretchEndCommand({
      pr: {
        pullRequests: () => createGhPullRequests({ gh: fake.run }),
        readBranch: () => 'main',
        readRemote: () => GITHUB_ORIGIN,
      },
      git: () => () => ({ ok: false, stdout: '', stderr: '' }),
    });
    const run = () => dispatchInProject(['stretch', 'end'], [{ name: 'stretch', summary: 'stretches' }], [command], project);

    const first = await run();
    expect(first.exitCode).toBe(0);
    expect(first.stdout).not.toContain('body updated');
    expect(first.stdout).not.toContain('body unchanged');
    expect(bodyEdits(fake.calls())).toHaveLength(0);
    expect(fake.pull(1)?.headRefName ?? fake.pull(2)?.headRefName).toBe('stretch/4');

    appendItem(project.root, 4, ledgerItem('813', 902));
    const second = await run();
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('body updated');
    expect(bodyEdits(fake.calls())).toHaveLength(1);

    const third = await run();
    expect(third.exitCode).toBe(0);
    expect(third.stdout).toContain('body unchanged');
    expect(third.stdout).not.toContain('body updated');
    expect(bodyEdits(fake.calls())).toHaveLength(1);
  });
});
