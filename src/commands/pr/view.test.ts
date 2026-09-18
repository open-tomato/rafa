/**
 * Tests for `rafa pr view` (`view.ts`): which pull request it opens,
 * what it hands the provider, the line it writes in each mode, and the
 * refusals.
 *
 * Every case dispatches the real command from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. No case reaches GitHub,
 * spawns `gh` or opens a browser: the provider is either the adapter
 * over the recorded fake (`pr/gh-fake.ts`), whose `browse` opens
 * nothing and records the command, or a stub, and the branch and the
 * `origin` probe are seams.
 *
 * Two controls carry readings that would otherwise pass while wrong:
 * the stub records every member it was sent, so "it browses and reads
 * nothing else" is measured rather than assumed, and the provider
 * factory records whether it was reached, so a refused line is known to
 * have made no provider.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { SEPARATOR } from './current.js';
import { PR_USAGE } from './pr-context.js';
import { createPrViewCommand, renderView } from './view.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-view-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.view;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch every case's seam answers. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** The URL the recorded fake gives pull request 41 of its own repository. */
const PULL_URL = 'https://github.com/open-tomato/rafa/pull/41';

/** A summary as a stub provider answers one, filled from `over`. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 41,
    title: 'rafa-20: pull request commands',
    url: PULL_URL,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    ...over,
  };
}

/** What a stub provider answers for the two members this action can send. */
interface StubAnswers {
  readonly findOpen?: () => Promise<PullRequestSummary | null>;
  readonly browse?: () => Promise<void>;
}

/** A stub provider, and the log of every member it was sent. */
interface StubPulls {
  readonly pulls: PullRequests;
  /** Each member reached, in order, a browse written `browse 41`. */
  readonly sent: () => readonly string[];
}

/** A provider answering `findOpen` and `browse`, refusing every other call and recording each. */
function stubPulls(answers: StubAnswers = {}): StubPulls {
  const sent: string[] = [];
  const refuse = (name: string) => (): Promise<never> => {
    sent.push(name);
    return Promise.reject(new Error('the stub provider models findOpen and browse alone'));
  };
  const pulls: PullRequests = {
    kind: 'gh',
    findOpen: () => {
      sent.push('findOpen');
      return answers.findOpen === undefined
        ? Promise.resolve(summary())
        : answers.findOpen();
    },
    list: refuse('list'),
    get: refuse('get'),
    checks: refuse('checks'),
    browse: (number: number) => {
      sent.push(`browse ${number}`);
      return answers.browse === undefined
        ? Promise.resolve()
        : answers.browse();
    },
    merge: refuse('merge'),
    comments: refuse('comments'),
    comment: refuse('comment'),
    editComment: refuse('editComment'),
    failedLog: refuse('failedLog'),
  };
  return { pulls, sent: () => [...sent] };
}

/** The seams a case hands the command, with what the provider control recorded. */
interface CaseSeams {
  readonly seams: PrSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** Seams over `pulls`, recording every root a provider was made for. */
function caseSeams(pulls: PullRequests, branch: string = BRANCH): CaseSeams {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => branch,
      readRemote: () => GITHUB_ORIGIN,
    },
    made: () => [...roots],
  };
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** What one run left: what it wrote, and its events when it wrote NDJSON. */
interface Ran {
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
}

/** Dispatches `rafa pr view` over `seams` from `project`, with `words` after the action. */
async function ran(seams: PrSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrViewCommand(seams);
  const run = await dispatchInProject(['pr', 'view', ...words], SUBJECTS, [command], project);
  return {
    run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

describe('the line', () => {
  it('names the pull request and its URL when one is in hand', () => {
    expect(renderView(41, PULL_URL)).toBe(`Opened #41 in the browser${SEPARATOR}${PULL_URL}`);
  });

  it('names the pull request alone when no URL was read, with no stray separator', () => {
    const line = renderView(41, null);

    expect(line).toBe('Opened #41 in the browser');
    expect(line.includes(SEPARATOR)).toBe(false);
  });
});

describe('the pull request of the branch', () => {
  it('opens it through gh pr view --web, and names it with the URL the lookup already read', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, headRefName: BRANCH, title: 'rafa-20: pull request commands' });
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run } = await ran(seams.seams, freshProject());

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.stdout.trim()).toBe(`Opened #41 in the browser${SEPARATOR}${PULL_URL}`);
    expect(fake.calls().map((call) => call.slice(0, 2))).toEqual([['pr', 'list'], ['pr', 'view']]);
    expect(fake.calls().at(-1)).toEqual(['pr', 'view', '41', '--web']);
  });

  it('gives the number, its source, the branch, the URL and the line as the json result', async () => {
    const stub = stubPulls();
    const { run, events } = await ran(caseSeams(stub.pulls).seams, freshProject(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toEqual({
      number: 41,
      source: 'branch',
      branch: BRANCH,
      url: PULL_URL,
      line: `Opened #41 in the browser${SEPARATOR}${PULL_URL}`,
    });
  });

  it('names the pull request alone when the lookup answered a blank URL', async () => {
    const stub = stubPulls({ findOpen: () => Promise.resolve({ ...summary(), url: '   ' }) });
    const { run, events } = await ran(caseSeams(stub.pulls).seams, freshProject(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toMatchObject({ url: null, line: 'Opened #41 in the browser' });
  });
});

describe('a number on the line', () => {
  it('opens that pull request, reads nothing else about it, and names no URL', async () => {
    const stub = stubPulls();
    const { run, events } = await ran(caseSeams(stub.pulls).seams, freshProject(), ['7', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(stub.sent()).toEqual(['browse 7']);
    expect(dataOf(events)).toEqual({
      number: 7,
      source: 'argument',
      branch: null,
      url: null,
      line: 'Opened #7 in the browser',
    });
  });

  it('opens it whatever branch is checked out, and asks git for no branch at all', async () => {
    const stub = stubPulls();
    const seams: PrSeams = {
      ...caseSeams(stub.pulls).seams,
      readBranch: () => {
        throw new Error('the branch must not be read when the line names a number');
      },
    };
    const { run } = await ran(seams, freshProject(), ['7']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.stdout.trim()).toBe('Opened #7 in the browser');
  });
});

describe('a provider that would not open it', () => {
  it('refuses with exit code 1, naming what was being done and what the provider said', async () => {
    const said = 'gh pull requests: gh pr view 41 --web failed: no pull request found';
    const stub = stubPulls({ browse: () => Promise.reject(new Error(said)) });
    const { run } = await ran(caseSeams(stub.pulls).seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ Could not open pull request #41 in the browser: ${said}`);
    expect(run.stdout).toBe('');
  });
});

describe('the refusals it takes from the shared context', () => {
  it('refuses a second word on the line, naming the usage, and makes no provider', async () => {
    const seams = caseSeams(stubPulls().pulls);
    const { run } = await ran(seams.seams, freshProject(), ['41', '42']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Expected at most one pull request number, got 2: 41 42\nUsage: ${USAGE}`);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a word that is no whole number from 1', async () => {
    const seams = caseSeams(stubPulls().pulls);
    const { run } = await ran(seams.seams, freshProject(), ['0']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('"0" is no pull request number, which is a whole number from 1');
    expect(seams.made()).toEqual([]);
  });

  it('refuses a project whose provider is not gh with exit code 2 and the shared message', async () => {
    const seams = caseSeams(stubPulls().pulls);
    const { run } = await ran(seams.seams, freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a branch with no open pull request, naming the branch and pointing at pr list', async () => {
    const stub = stubPulls({ findOpen: () => Promise.resolve(null) });
    const { run } = await ran(caseSeams(stub.pulls).seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`No open pull request for the branch "${BRANCH}"`);
    expect(stub.sent()).toEqual(['findOpen']);
  });

  it('refuses a detached HEAD by name, and opens nothing', async () => {
    const stub = stubPulls();
    const { run } = await ran(caseSeams(stub.pulls, 'HEAD').seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('is on no branch, and a detached HEAD names no pull request');
    expect(stub.sent()).toEqual([]);
  });
});

describe('the command itself', () => {
  it('routes as pr view, declares both renderings, takes one optional number, and is frozen', () => {
    const command = createPrViewCommand();

    expect([command.subject, command.action, command.name]).toEqual(['pr', 'view', 'pr view']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.args.map((arg) => [arg.name, arg.required ?? false])).toEqual([['n', false]]);
    expect([command.flags, Object.isFrozen(command)]).toEqual([[], true]);
  });

  it('declares a summary, a description and examples, as the describe roster needs', () => {
    const command = createPrViewCommand();

    expect(command.summary.length > 0).toBe(true);
    expect(command.description.length > 0).toBe(true);
    expect(command.examples.map((example) => example.cmd)).toEqual([
      'rafa pr view',
      'rafa pr view 41',
      'rafa pr view 41 --output=json',
    ]);
  });
});
