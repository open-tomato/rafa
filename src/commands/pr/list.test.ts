/**
 * Tests for `rafa pr list` (`list.ts`): the table it renders, the reads
 * behind it, the per-row probes that are allowed to fail, the bound on
 * how many of them run at once, and its refusals.
 *
 * {@link renderList} is pure, total and takes its clock as an argument,
 * so every shape of the table — an empty list, a blank title, a title
 * past the cap, a cell nothing could be read for, a timestamp that does
 * not parse — is driven by calling it, where provoking a provider into
 * each one would measure the provider instead.
 *
 * The cases that dispatch the command run it from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. None of them reaches GitHub
 * or spawns `gh`: the provider is either the adapter over the recorded
 * fake (`pr/gh-fake.ts`) or a stub answering what the case wants read,
 * and the `origin` probe is a seam.
 *
 * Four controls carry readings that would otherwise pass while wrong:
 * the provider factory records whether it was reached, so a refused line
 * is known to have made no provider; the branch seam throws, so "this
 * action reads no branch" is measured rather than assumed; the recorded
 * fake's own call log is asserted, so a whole table is known to have
 * come from the `gh` commands and not from a default; and the stub
 * counts how many probes are in flight at once, so the bound is a
 * reading rather than a claim in a comment.
 */
import type { PrListRow, PrListResult } from './list.js';
import type { PrSeams } from './pr-context.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { ChecksReading, PullRequestDetail, PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { SEPARATOR } from './current.js';
import {
  ageCell,
  createPrListCommand,
  mapWithLimit,
  PROBE_LIMIT,
  renderList,
  titleCell,
  TITLE_WIDTH,
  UNREADABLE,
} from './list.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.list;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch the planted pull request is from. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** When the planted pull requests last moved. */
const MOVED_AT = '2026-09-18T11:00:00Z';

/** A clock a rendering case reads: two hours after {@link MOVED_AT}. */
const NOW = Date.parse('2026-09-18T13:00:00Z');

/** A summary as a provider lists one, filled from `over`. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 41,
    title: 'rafa-20: pull request commands',
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: MOVED_AT,
    ...over,
  };
}

/** A row with everything readable, which a case narrows from. */
function row(over: Partial<PrListRow> = {}): PrListRow {
  return {
    pull: summary(),
    checks: 'green',
    checksProblem: null,
    mergeable: 'mergeable',
    mergeableProblem: null,
    ...over,
  };
}

/** The lines of a rendered table, blank ones included. */
function linesOf(text: string): readonly string[] {
  return text.split('\n');
}

/** What a stub provider answers for the three members this action sends. */
interface StubAnswers {
  readonly list?: () => Promise<readonly PullRequestSummary[]>;
  readonly checks?: (number: number) => Promise<ChecksReading>;
  readonly get?: (number: number) => Promise<PullRequestDetail | null>;
}

/** A provider answering `list`, `checks` and `get`, and refusing every other call. */
function stubPulls(answers: StubAnswers = {}): PullRequests {
  return createPullRequestsDouble({
    list: answers.list ?? (() => Promise.resolve([summary()])),
    get: answers.get ?? ((number: number) => Promise.resolve({
      ...summary({ number }),
      body: '',
      headRefOid: 'abc',
      mergeable: 'mergeable',
      mergeStateStatus: 'CLEAN',
      labels: [],
    })),
    checks: answers.checks ?? (() => Promise.resolve({ rows: [], verdict: 'none' })),
  }, { refusal: 'the stub provider models the reading members alone' }).pulls;
}

/** The seams a case hands the command, with what the two controls recorded. */
interface CaseSeams {
  readonly seams: PrSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** Seams over `pulls`, recording every root a provider was made for; the branch seam throws. */
function caseSeams(pulls: PullRequests): CaseSeams {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => {
        throw new Error('rafa pr list reads no branch, and this case would have let it');
      },
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

/** Dispatches `rafa pr list` over `seams` from `project`, with `words` after the action. */
async function ran(seams: PrSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrListCommand(seams);
  const run = await dispatchInProject(['pr', 'list', ...words], SUBJECTS, [command], project);
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

describe('the table', () => {
  it('writes the head line and one padded row per pull request, in the order the provider listed them', () => {
    const rows = [
      row(),
      row({
        pull: summary({ number: 7, title: 'chore(deps): bump bun', headRefName: 'dependabot/bun' }),
        checks: 'red',
        mergeable: 'conflicting',
      }),
    ];

    expect(linesOf(renderList(rows, NOW))).toEqual([
      '2 open pull requests',
      '  #41  rafa-20: pull request commands  feat/rafa-20-pr-commands  updated 2h ago  checks green  mergeable',
      '  #7   chore(deps): bump bun           dependabot/bun            updated 2h ago  checks red    conflicting',
    ]);
  });

  it('says how many there are in the singular for one', () => {
    expect(linesOf(renderList([row()], NOW))[0]).toBe('1 open pull request');
  });

  it('says there are none, rather than writing an empty table, for a repository with no open pull request', () => {
    expect(renderList([], NOW)).toBe('No open pull requests.');
  });

  it('keeps a pull request GitHub ran nothing for readable as checks none', () => {
    expect(renderList([row({ checks: 'none' })], NOW)).toContain('checks none');
  });
});

describe('a cell nothing could be read for', () => {
  it('leaves the checks cell unreadable and says what the provider reported, under the table', () => {
    const said = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const lines = linesOf(renderList([row({ checks: null, checksProblem: said })], NOW));

    expect(lines[1]).toContain(`checks ${UNREADABLE}`);
    expect(lines[1]).not.toContain('checks none');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe(`  #41 checks could not be read${SEPARATOR}${said}`);
  });

  it('leaves the mergeable cell unreadable and names the pull request in its own line', () => {
    const said = 'gh pull requests: gh pr view 41 failed: HTTP 403';
    const lines = linesOf(renderList([row({ mergeable: null, mergeableProblem: said })], NOW));

    expect(lines[1]).toEndWith(`  ${UNREADABLE}`);
    expect(lines[3]).toBe(`  #41 mergeable could not be read${SEPARATOR}${said}`);
  });

  it('writes a line for each of the two probes when both failed on one pull request', () => {
    const both = row({ checks: null, checksProblem: 'no checks', mergeable: null, mergeableProblem: 'no detail' });

    expect(linesOf(renderList([both], NOW)).slice(3)).toEqual([
      `  #41 checks could not be read${SEPARATOR}no checks`,
      `  #41 mergeable could not be read${SEPARATOR}no detail`,
    ]);
  });
});

describe('the title column', () => {
  it('trims it, and marks a blank one rather than leaving a hole in the row', () => {
    expect(titleCell('  rafa-20  ')).toBe('rafa-20');
    expect(titleCell('   ')).toBe('(no title)');
  });

  it('cuts a title past the cap, and leaves one exactly at the cap whole', () => {
    const long = 'x'.repeat(TITLE_WIDTH + 10);
    const exact = 'y'.repeat(TITLE_WIDTH);

    expect(titleCell(long)).toHaveLength(TITLE_WIDTH);
    expect(titleCell(long)).toEndWith('...');
    expect(titleCell(exact)).toBe(exact);
  });
});

describe('the age column', () => {
  it('counts in minutes, hours and days from when the pull request last moved', () => {
    const at = '2026-09-18T11:00:00Z';
    const from = Date.parse(at);

    expect(ageCell(at, from + 90 * 1000)).toBe('updated 1m ago');
    expect(ageCell(at, from + 3 * 3600 * 1000)).toBe('updated 3h ago');
    expect(ageCell(at, from + 50 * 3600 * 1000)).toBe('updated 2d ago');
  });

  it('says just now under a minute, and for a timestamp ahead of the clock rather than a negative age', () => {
    const at = '2026-09-18T11:00:00Z';
    const from = Date.parse(at);

    expect(ageCell(at, from + 5 * 1000)).toBe('updated just now');
    expect(ageCell(at, from - 3600 * 1000)).toBe('updated just now');
  });

  it('leaves it unreadable for a timestamp that does not parse, rather than inventing a duration', () => {
    expect(ageCell('the other day', NOW)).toBe(`updated ${UNREADABLE}`);
  });
});

describe('the probe bound', () => {
  it('answers in the items own order whatever order the work finished in', async () => {
    const items = [30, 20, 10, 0];
    const answered = await mapWithLimit(items, 2, async (ms) => {
      await Bun.sleep(ms);
      return ms;
    });

    expect(answered).toEqual(items);
  });

  it('keeps at most the limit in flight, where a case with no bound would reach the item count', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);
    const work = async (index: number): Promise<number> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(1);
      inFlight -= 1;
      return index;
    };
    await mapWithLimit(items, 3, work);
    const bounded = peak;
    peak = 0;
    await Promise.all(items.map(work));

    expect(bounded).toBe(3);
    expect(peak).toBe(items.length);
  });

  it('runs the whole list when the limit is wider than it, and nothing at all for an empty one', async () => {
    const reached: number[] = [];
    const answered = await mapWithLimit([1, 2], PROBE_LIMIT, (item) => {
      reached.push(item);
      return Promise.resolve(item * 2);
    });
    const none = await mapWithLimit([], PROBE_LIMIT, () => Promise.reject(new Error('reached for no item')));

    expect(answered).toEqual([2, 4]);
    expect(reached).toEqual([1, 2]);
    expect(none).toEqual([]);
  });
});

describe('the open pull requests', () => {
  it('reads them through gh pr list, and each row through gh pr checks and gh pr view', async () => {
    const fake = createFakePrGh();
    fake.plant({ number: 41, headRefName: BRANCH, title: 'rafa-20: pull request commands', updatedAt: MOVED_AT });
    fake.plant({
      number: 7,
      headRefName: 'dependabot/bun',
      title: 'chore(deps): bump bun',
      updatedAt: MOVED_AT,
      mergeable: 'CONFLICTING',
      checks: [{ name: 'gates', state: 'FAILURE', link: 'https://github.com/open-tomato/rafa/runs/1' }],
    });
    const seams = caseSeams(createGhPullRequests({ gh: fake.run }));
    const { run } = await ran(seams.seams, freshProject());
    const sent = fake.calls().map((call) => call.slice(0, 3).join(' '));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('2 open pull requests');
    // The fake lists newest first, which is the number descending.
    expect(run.stdout).toMatch(/#41 {2}rafa-20: pull request commands {2}feat\/rafa-20-pr-commands {2}updated \d/);
    expect(run.stdout).toContain('checks none  mergeable');
    expect(run.stdout).toContain('checks red   conflicting');
    expect(sent[0]).toBe('pr list --state');
    expect(sent.filter((call) => call.startsWith('pr checks'))).toEqual(['pr checks 41', 'pr checks 7']);
    expect(sent.filter((call) => call.startsWith('pr view'))).toEqual(['pr view 41', 'pr view 7']);
  });

  it('makes the provider for the project root, and reads no branch to do it', async () => {
    const project = freshProject();
    const seams = caseSeams(stubPulls());
    const { run } = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(seams.made()).toEqual([project.root]);
  });

  it('says there are none for a repository whose list is empty', async () => {
    const seams = caseSeams(stubPulls({ list: () => Promise.resolve([]) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('No open pull requests.');
  });

  it('keeps the row when a probe failed, and names what the provider said under the table', async () => {
    const said = 'gh pull requests: gh pr checks 41 failed: could not connect';
    const seams = caseSeams(stubPulls({ checks: () => Promise.reject(new Error(said)) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('1 open pull request');
    expect(run.stdout).toContain(`checks ${UNREADABLE}`);
    expect(run.stdout).toContain(`#41 checks could not be read${SEPARATOR}${said}`);
  });

  it('says so for a pull request the repository no longer holds, which is no provider failure', async () => {
    const seams = caseSeams(stubPulls({ get: () => Promise.resolve(null) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('#41 mergeable could not be read');
    expect(run.stdout).toContain('the repository holds no pull request #41');
  });
});

describe('json mode', () => {
  it('gives every row and the rendered table as the terminal result data', async () => {
    const seams = caseSeams(stubPulls());
    const { run, events } = await ran(seams.seams, freshProject(), ['--output=json']);
    const data = dataOf(events) as PrListResult;

    expect(run.exitCode).toBe(0);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.pull.number).toBe(41);
    expect(data.rows[0]?.mergeable).toBe('mergeable');
    expect(data.rows[0]?.checks).toBe('none');
    expect(data.text).toContain('1 open pull request');
  });
});

describe('the refusals', () => {
  it('refuses a stray word naming the usage line, and makes no provider for it', async () => {
    const seams = caseSeams(stubPulls());
    const { run } = await ran(seams.seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Expected no arguments, got 1: 41');
    expect(run.stderr).toContain(`Usage: ${USAGE}`);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a provider that is not gh with exit code 2 and the one shared message', async () => {
    const seams = caseSeams(stubPulls());
    const { run } = await ran(seams.seams, freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });

  it('refuses with exit code 1 when the list itself could not be read, naming what the provider said', async () => {
    const said = 'gh pull requests: gh pr list failed: could not connect';
    const seams = caseSeams(stubPulls({ list: () => Promise.reject(new Error(said)) }));
    const { run } = await ran(seams.seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Could not list the open pull requests');
    expect(run.stderr).toContain(said);
  });
});
