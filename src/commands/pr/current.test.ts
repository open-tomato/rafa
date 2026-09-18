/**
 * Tests for `rafa pr current` (`current.ts`): the rule that builds its
 * one line, the fallback to the URL alone, and what the command writes
 * in each mode.
 *
 * {@link renderCurrent} is pure and total, so the rule is measured by
 * calling it over the subsets of readable parts — that is where the
 * fallback the spec names is driven, since it is the port's guarantee
 * and no `gh` payload reaches it: `readSummary` in `src/pr/gh.ts`
 * refuses a payload whose number or state is missing, and the port types
 * a state as a closed set with no absent member. A case beside it drives
 * a provider blanking what it can and records how far down the line that
 * takes it, so the unreachability is a reading and not an assumption.
 *
 * Every other case dispatches the real command from a project of its
 * own beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. No case reaches GitHub or
 * spawns `gh`: the provider is either the adapter over the recorded fake
 * (`pr/gh-fake.ts`) or a stub answering what the case wants read, and
 * the branch and the `origin` probe are seams.
 *
 * Two controls carry readings that could otherwise pass while wrong: the
 * provider factory records whether it was reached, so "a refused line
 * makes no provider" is measured, and the recorded fake's own call log
 * is asserted, so a green line is known to have come from the two `gh`
 * commands and not from a default.
 */
import type { PrCurrentReading } from './current.js';
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { ChecksReading, PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createPrCurrentCommand, renderCurrent, SEPARATOR } from './current.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-current-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.current;

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

/** A reading with every part readable, which a case narrows from. */
const FULL: PrCurrentReading = Object.freeze({
  number: 41,
  title: 'rafa-20: pull request commands',
  state: 'open',
  checks: 'green',
  url: PULL_URL,
});

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

/** What a stub provider answers for the two members this action sends. */
interface StubAnswers {
  readonly findOpen?: () => Promise<PullRequestSummary | null>;
  readonly checks?: () => Promise<ChecksReading>;
}

/** A provider answering `findOpen` and `checks`, and refusing every other call. */
function stubPulls(answers: StubAnswers): PullRequests {
  const refuse = (): Promise<never> => Promise.reject(new Error('the stub provider models findOpen and checks alone'));
  return {
    kind: 'gh',
    findOpen: answers.findOpen ?? (() => Promise.resolve(summary())),
    list: refuse,
    get: refuse,
    checks: answers.checks ?? (() => Promise.resolve({ rows: [], verdict: 'none' })),
    browse: refuse,
    merge: refuse,
    comments: refuse,
    comment: refuse,
    editComment: refuse,
    failedLog: refuse,
  };
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

/** Dispatches `rafa pr current` over `seams` from `project`, with `words` after the action. */
async function ran(
  seams: PrSeams,
  project: PlantedProject,
  words: readonly string[] = [],
): Promise<Ran> {
  const command: RafaCommand = createPrCurrentCommand(seams);
  const run = await dispatchInProject(['pr', 'current', ...words], SUBJECTS, [command], project);
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
  it('joins the number, title, state, checks verdict and URL, in that order', () => {
    expect(renderCurrent(FULL)).toBe(
      `#41 rafa-20: pull request commands${SEPARATOR}open${SEPARATOR}checks green${SEPARATOR}${PULL_URL}`,
    );
  });

  it('drops a blank title and keeps the number beside it', () => {
    expect(renderCurrent({ ...FULL, title: null })).toBe(`#41${SEPARATOR}open${SEPARATOR}checks green${SEPARATOR}${PULL_URL}`);
  });

  it('drops the verdict when the checks could not be read, and prints "checks none" when there are none', () => {
    expect(renderCurrent({ ...FULL, checks: null })).toBe(
      `#41 rafa-20: pull request commands${SEPARATOR}open${SEPARATOR}${PULL_URL}`,
    );
    expect(renderCurrent({ ...FULL, checks: 'none' })).toContain(`${SEPARATOR}checks none${SEPARATOR}`);
  });

  it('falls back to the URL alone when the URL is all that was readable, with no stray separator', () => {
    const line = renderCurrent({ number: null, title: null, state: null, checks: null, url: PULL_URL });

    expect(line).toBe(PULL_URL);
    expect(line.includes(SEPARATOR)).toBe(false);
  });

  it('is empty when nothing at all was readable, a reading the command itself cannot produce', () => {
    expect(renderCurrent({ number: null, title: null, state: null, checks: null, url: null })).toBe('');
  });
});

describe('the pull request of the branch, over the recorded gh', () => {
  it('prints one line for a green pull request, from gh pr list --head and gh pr checks', async () => {
    const fake = createFakePrGh();
    fake.plant({
      number: 41,
      headRefName: BRANCH,
      title: 'rafa-20: pull request commands',
      checks: [{ name: 'gates', state: 'SUCCESS', link: 'https://github.com/open-tomato/rafa/runs/1' }],
    });
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run } = await ran(seams.seams, freshProject());

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.stdout.trim()).toBe(
      `#41 rafa-20: pull request commands${SEPARATOR}open${SEPARATOR}checks green${SEPARATOR}${PULL_URL}`,
    );
    expect(fake.calls().map((call) => call.slice(0, 2))).toEqual([['pr', 'list'], ['pr', 'checks']]);
  });

  it('prints "checks none" for a pull request gh reports no checks on at all', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, headRefName: BRANCH, title: 'no workflow matched' });
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe(`#41 no workflow matched${SEPARATOR}open${SEPARATOR}checks none${SEPARATOR}${PULL_URL}`);
  });

  it('gives the branch, the line and every part of it as the json result', async () => {
    const fake = createFakePrGh();
    fake.plant({
      number: 41,
      headRefName: BRANCH,
      title: 'rafa-20: pull request commands',
      checks: [{ name: 'gates', state: 'IN_PROGRESS', link: '' }],
    });
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run, events } = await ran(seams.seams, freshProject(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toEqual({
      branch: BRANCH,
      line: `#41 rafa-20: pull request commands${SEPARATOR}open${SEPARATOR}checks pending${SEPARATOR}${PULL_URL}`,
      pull: { number: 41, title: 'rafa-20: pull request commands', state: 'open', checks: 'pending', url: PULL_URL },
      checksProblem: null,
    });
  });
});

describe('a provider that could not be asked about the checks', () => {
  it('still prints the line without a verdict, and warns with what the provider said', async () => {
    const said = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const seams = caseSeams(stubPulls({ checks: () => Promise.reject(new Error(said)) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `warn: the checks could not be read: ${said}`,
      `#41 rafa-20: pull request commands${SEPARATOR}open${SEPARATOR}${PULL_URL}`,
    ]);
  });

  it('carries what it said as checksProblem in json mode, with the verdict null', async () => {
    const said = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const seams = caseSeams(stubPulls({ checks: () => Promise.reject(new Error(said)) }));
    const { events } = await ran(seams.seams, freshProject(), ['--output=json']);

    expect(dataOf(events)).toMatchObject({ checksProblem: said, pull: { checks: null } });
  });
});

describe('how far a degraded provider takes the line down', () => {
  it('drops every part the provider left blank, keeping the number, the state and the URL', async () => {
    const pulls = stubPulls({
      findOpen: () => Promise.resolve({ ...summary(), title: '   ' }),
      checks: () => Promise.reject(new Error('no checks could be read either')),
    });
    const { run, events } = await ran(caseSeams(pulls).seams, freshProject(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toMatchObject({
      line: `#41${SEPARATOR}open${SEPARATOR}${PULL_URL}`,
      pull: { title: null, checks: null },
    });
  });

  it('cannot be taken to the URL alone through the gh adapter, whose number and state are always readable', async () => {
    const pulls = stubPulls({
      findOpen: () => Promise.resolve({ ...summary(), number: 0, title: '', url: PULL_URL }),
      checks: () => Promise.reject(new Error('no checks could be read either')),
    });
    const { run, events } = await ran(caseSeams(pulls).seams, freshProject(), ['--output=json']);

    expect(dataOf(events)).toMatchObject({ line: `open${SEPARATOR}${PULL_URL}` });
    expect(run.exitCode).toBe(0);
    expect(renderCurrent({ number: null, title: null, state: null, checks: null, url: PULL_URL })).toBe(PULL_URL);
  });
});

describe('the refusals it takes from the shared context', () => {
  it('refuses any word on the line, naming the usage, and makes no provider', async () => {
    const seams = caseSeams(stubPulls({}));
    const { run } = await ran(seams.seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ Expected no arguments, got 1: 41\nUsage: ${USAGE}`);
    expect(run.stdout).toBe('');
    expect(seams.made()).toEqual([]);
  });

  it('refuses a project whose provider is not gh with exit code 2 and the shared message', async () => {
    const seams = caseSeams(stubPulls({}));
    const { run } = await ran(seams.seams, freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a branch with no open pull request, naming the branch and pointing at pr list', async () => {
    const seams = caseSeams(stubPulls({ findOpen: () => Promise.resolve(null) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`No open pull request for the branch "${BRANCH}"`);
    expect(run.stderr).toContain('Run rafa pr list to see the open pull requests.');
  });
});

describe('the command itself', () => {
  it('routes as pr current, declares both renderings, takes no argument and no flag, and is frozen', () => {
    const command = createPrCurrentCommand();

    expect([command.subject, command.action, command.name]).toEqual(['pr', 'current', 'pr current']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect([command.args, command.flags]).toEqual([[], []]);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('declares a summary, a description and examples, as the describe roster needs', () => {
    const command = createPrCurrentCommand();

    expect(command.summary.length > 0).toBe(true);
    expect(command.description.length > 0).toBe(true);
    expect(command.examples.map((example) => example.cmd)).toEqual(['rafa pr current', 'rafa pr current --output=json']);
  });
});
