/**
 * Tests for `rafa pr retarget` (`retarget.ts`): a pull request moved onto
 * another base over the recorded `gh`, one already on the base left
 * alone with exit 0, the refusals of the line, and what the command
 * writes in each mode.
 *
 * Every dispatching case runs the real command from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so no case reads the real home. No case
 * reaches GitHub or spawns `gh`: the provider is the adapter over the
 * recorded fake (`pr/gh-fake.ts`) or the port double
 * (`pr/pull-requests-double.ts`).
 *
 * Controls: the no-op case reads the double's call log beside a
 * retarget whose log shows the `editBase` the no-op skips, and the
 * refusals read the provider factory's log beside a valid line that does
 * make a provider.
 */
import type { PrSeams } from './pr-context.js';
import type { CliEvent } from '../../ports/index.js';
import type { PullRequestDetail, PullRequests } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { retargetedLine } from '../../start/pr-retarget.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { PR_USAGE } from './pr-context.js';
import { createPrRetargetCommand } from './retarget.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-retarget-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.retarget;

/** A config naming the GitHub CLI, and one naming no provider. */
const GH_CONFIG = 'pr:\n  provider: gh\n';
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** The base a pull request starts on, and the one each case moves it to. */
const FROM = 'main';
const TO = 'stretch/9';

/** Seams over `pulls`, recording every root a provider was made for. */
function caseSeams(pulls: PullRequests): { seams: PrSeams; made: () => readonly string[] } {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => 'main',
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
    },
    made: () => [...roots],
  };
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `rafa pr retarget` over `seams`, with `words` after the action. */
async function ran(seams: PrSeams, words: readonly string[], project = freshProject()): Promise<CapturedRun> {
  return dispatchInProject(['pr', 'retarget', ...words], SUBJECTS, [createPrRetargetCommand(seams)], project);
}

/** A pull request #41 as the double's `get` answers it, on `base`. */
function detailOn(base: string): PullRequestDetail {
  const fake = createFakePrGh();
  fake.plant({ number: 41, baseRefName: base });
  return fake.pull(41) as unknown as PullRequestDetail;
}

/** The lines a run wrote to stdout, blank ones left out. */
function linesOf(run: CapturedRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

describe('retargeting over the recorded gh', () => {
  it('moves the pull request onto the base and prints the line retargetedLine builds', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, baseRefName: FROM });
    const { seams } = caseSeams(createGhPullRequests({ gh: fake.run }));

    const run = await ran(seams, ['41', `--base=${TO}`]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([retargetedLine(41, FROM, TO)]);
    expect(fake.pull(41)?.baseRefName).toBe(TO);
    expect(fake.calls().filter((call) => call[1] === 'edit')).toEqual([['pr', 'edit', '41', '--base', TO]]);
  });

  it('edits once over two runs: the second finds it on the base and exits 0', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, baseRefName: FROM });
    const { seams } = caseSeams(createGhPullRequests({ gh: fake.run }));

    const first = await ran(seams, ['41', `--base=${TO}`]);
    const second = await ran(seams, ['41', `--base=${TO}`]);

    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
    expect(fake.calls().filter((call) => call[1] === 'edit')).toHaveLength(1);
    expect(linesOf(second)).toEqual([`✅ Pull request #41 is already on ${TO}, so nothing was sent.`]);
  });
});

describe('the double, as a control on what the command sends', () => {
  it('sends get then editBase for a pull request on another base', async () => {
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detailOn(FROM)),
      editBase: () => Promise.resolve(),
    });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--base=${TO}`]);

    expect(run.exitCode).toBe(0);
    expect(double.sent()).toEqual(['get 41', `editBase 41 ${TO}`]);
  });

  it('sends get alone for a pull request already on the base, a no-op exit 0', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(detailOn(TO)) });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--base=${TO}`]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(double.sent()).toEqual(['get 41']);
  });

  it('gives the number, whether it was retargeted and both bases as the json result', async () => {
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detailOn(FROM)),
      editBase: () => Promise.resolve(),
    });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--base=${TO}`, '--output=json']);

    expect(dataOf(eventsOf(run.stdout))).toEqual({ number: 41, retargeted: true, from: FROM, to: TO });
  });

  it('refuses with exit code 1 naming what it was doing when editBase rejects', async () => {
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detailOn(FROM)),
      editBase: () => Promise.reject(new Error('gh pr edit failed: base not found')),
    });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--base=${TO}`]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ Could not retarget pull request #41 from "${FROM}" to "${TO}": gh pr edit failed: base not found`);
  });

  it('refuses with exit code 1 a pull request the repository does not hold', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(null) });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--base=${TO}`]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ No pull request #41 in the repository at ');
    expect(double.sent()).toEqual(['get 41']);
  });
});

describe('the refusals, each before a provider is made', () => {
  it('makes a provider for a valid line, the control the refusals below are read against', async () => {
    const control = caseSeams(createPullRequestsDouble({ get: () => Promise.resolve(detailOn(TO)) }).pulls);
    const project = freshProject();

    const run = await ran(control.seams, ['41', `--base=${TO}`], project);

    expect(run.exitCode).toBe(0);
    expect(control.made()).toEqual([project.root]);
  });

  it('refuses a missing number, a word that is no number, a second word and a base left out or blank', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);
    const lines: readonly (readonly [readonly string[], string])[] = [
      [[`--base=${TO}`], 'Expected the number of the pull request to retarget'],
      [['x41', `--base=${TO}`], '"x41" is no pull request number, which is a whole number from 1'],
      [['41', '42', `--base=${TO}`], 'Expected at most one pull request number, got 2: 41 42'],
      [['41'], '--base is required: --base=<value>'],
      [['41', '--base= '], '--base cannot be blank: --base=<value>'],
    ];

    for (const [words, problem] of lines) {
      const run = await ran(seams.seams, words);
      expect([run.exitCode, run.stderr]).toEqual([1, expect.stringContaining(`❌ ${problem}\nUsage: ${USAGE}`)]);
    }
    expect(seams.made()).toEqual([]);
  });

  it('refuses with exit code 2 where pr.provider is not gh', async () => {
    const seams = caseSeams(createPullRequestsDouble().pulls);

    const run = await ran(seams.seams, ['41', `--base=${TO}`], freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });
});
