/**
 * Tests for `rafa pr wait` (`wait.ts`): the report it renders, the poll
 * behind it, the deadline `--timeout` sets, and its refusals.
 *
 * {@link renderWait} is pure and total, so every shape of the report —
 * green, red, no checks at all, a deadline that passed, one check and
 * one poll — is driven by calling it, where provoking a provider into
 * each one would measure the provider instead.
 *
 * NO CASE SLEEPS. The clock and the wait are seams
 * ({@link PrWaitSeams}), and every dispatching case runs on
 * {@link fakeClock}: a counter `clock` reads and `sleep` advances by the
 * milliseconds it was asked to wait. So a poll that takes three rounds
 * and a deadline that passes are measured in microseconds, and the
 * sleeps are a reading of their own — a `none` verdict is held to ONE
 * poll and NO sleep, which is what "it answers at once rather than
 * waiting out the deadline" means.
 *
 * The cases that dispatch the command run it from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so the config read is the one the case
 * planted and no case reads the real home. None of them reaches GitHub
 * or spawns `gh`: the provider is the double (`pr/pull-requests-double.ts`),
 * and the branch and the `origin` probe are seams.
 *
 * Three controls carry readings that would otherwise pass while wrong:
 * the provider factory records whether it was reached, so "a refused
 * line makes no provider" is measured; the double's call log is asserted
 * member by member, so "it writes nothing" is a reading rather than a
 * sentence — the double refuses every member a case did not name and
 * records the refusal, so a `comment` or a `merge` would show; and the
 * `<n>` case asserts the log holds NO `findOpen`, so "the number on the
 * line is used instead of the branch" is measured too.
 */
import type { PrWaitReading, PrWaitSeams } from './wait.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { CheckRow, ChecksReading, PullRequests, PullRequestSummary } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { CI_POLL_INTERVAL_MS } from '../../start/pr-lifecycle.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { PR_USAGE } from './pr-context.js';
import {
  createPrWaitCommand,
  DEFAULT_WAIT_TIMEOUT_MIN,
  readTimeoutMinutes,
  renderWait,
  WAIT_EXIT_CODES,
} from './wait.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-wait-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.wait;

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** A config naming no pull request provider at all. */
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch every case's seam answers. */
const BRANCH = 'feat/rafa-63-one-command-next-step';

/** The link the planted check row carries. */
const RUN_URL = 'https://github.com/open-tomato/rafa/runs/1';

/** One check row, filled from `over`. */
function row(over: Partial<CheckRow> = {}): CheckRow {
  return { name: 'gates', state: 'SUCCESS', link: RUN_URL, outcome: 'pass', ...over };
}

/** A green reading, which a case narrows from. */
function reading(over: Partial<PrWaitReading> = {}): PrWaitReading {
  return {
    number: 41,
    verdict: 'green',
    rows: [row(), row({ name: 'types', state: 'SUCCESS', link: '' })],
    elapsedMs: 20_000,
    polls: 2,
    timeoutMs: 20 * 60_000,
    ...over,
  };
}

/** The lines of a rendered report. */
function linesOf(text: string): readonly string[] {
  return text.split('\n');
}

/** A summary as `findOpen` answers one for the branch. */
function summary(): PullRequestSummary {
  return {
    number: 41,
    title: 'rafa-63: one command, the next step',
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-21T11:00:00Z',
  };
}

/** A checks reading over `rows`, with the verdict a case wants read. */
function checksOf(rows: readonly CheckRow[], verdict: ChecksReading['verdict']): ChecksReading {
  return { rows, verdict };
}

/** A clock a case advances by sleeping, so no case waits on a real timer. */
interface FakeClock {
  /** The clock the poll measures with. */
  readonly clock: () => number;
  /** The wait between polls, which advances the clock. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Every wait asked for, in order. */
  readonly sleeps: () => readonly number[];
}

/** A clock starting at zero that only the sleeps move. */
function fakeClock(): FakeClock {
  let ms = 0;
  let waits: readonly number[] = [];
  return {
    clock: () => ms,
    sleep: (asked: number) => {
      waits = [...waits, asked];
      ms += asked;
      return Promise.resolve();
    },
    sleeps: () => [...waits],
  };
}

/** The provider a case runs on, and what it recorded. */
interface CaseProvider {
  readonly pulls: PullRequests;
  /** Each call, spelled one line each: `checks 41`. */
  readonly sent: () => readonly string[];
}

/** A provider answering `findOpen` and `checks`, one reading per poll, refusing every other member. */
function pollingPulls(polls: readonly ChecksReading[], found: PullRequestSummary | null = summary()): CaseProvider {
  let asked = 0;
  const double = createPullRequestsDouble({
    findOpen: () => Promise.resolve(found),
    checks: () => {
      const answer = polls[Math.min(asked, polls.length - 1)];
      asked += 1;
      return answer === undefined
        ? Promise.reject(new Error('the case planted no poll'))
        : Promise.resolve(answer);
    },
  });
  return { pulls: double.pulls, sent: double.sent };
}

/** The seams a case hands the command, with what the provider control recorded. */
interface CaseSeams {
  readonly seams: PrWaitSeams;
  /** Each root a provider was made for, in order. */
  readonly made: () => readonly string[];
}

/** Seams over `pulls` and `clock`, recording every root a provider was made for. */
function caseSeams(pulls: PullRequests, clock: FakeClock, branch: string = BRANCH): CaseSeams {
  const roots: string[] = [];
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => branch,
      readRemote: () => GITHUB_ORIGIN,
      clock: clock.clock,
      sleep: clock.sleep,
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

/** Dispatches `rafa pr wait` over `seams` from `project`, with `words` after the action. */
async function ran(seams: PrWaitSeams, project: PlantedProject, words: readonly string[] = []): Promise<Ran> {
  const command: RafaCommand = createPrWaitCommand(seams);
  const run = await dispatchInProject(['pr', 'wait', ...words], SUBJECTS, [command], project);
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

describe('the report', () => {
  it('names the verdict, the checks, the polls and the time, then every check', () => {
    expect(linesOf(renderWait(reading()))).toEqual([
      'checks green on #41 — 2 checks — 2 polls in 20s',
      `   pass    gates — SUCCESS (${RUN_URL})`,
      '   pass    types — SUCCESS',
    ]);
  });

  it('counts one check and one poll in the singular', () => {
    const once = reading({ rows: [row()], polls: 1, elapsedMs: 0 });

    expect(linesOf(renderWait(once))[0]).toBe('checks green on #41 — 1 check — 1 poll in 0s');
  });

  it('names the failing checks and points at pr triage when the verdict is red', () => {
    const red = reading({
      verdict: 'red',
      rows: [row({ state: 'FAILURE', outcome: 'fail' }), row({ name: 'types', outcome: 'pass', link: '' })],
    });
    const lines = linesOf(renderWait(red));

    expect(lines[0]).toBe('checks red on #41 — 2 checks — 2 polls in 20s');
    expect(lines.at(-1)).toBe('Failing: gates — run rafa pr triage 41 to assess it.');
  });

  it('says a pull request with no checks at all may be one that does not merge', () => {
    const none = reading({ verdict: 'none', rows: [], polls: 1, elapsedMs: 0 });

    expect(linesOf(renderWait(none))).toEqual([
      'checks none on #41 — nothing reported — 1 poll in 0s',
      '   (no checks reported)',
      'A pull request that does not merge cleanly schedules no run at all;'
        + ' run rafa pr show 41 to see whether it merges.',
    ]);
  });

  it('calls a deadline that passed checks still running, and names the minutes it waited', () => {
    const late = reading({
      verdict: 'timeout',
      rows: [row({ name: 'e2e', state: 'IN_PROGRESS', outcome: 'pending', link: '' })],
      polls: 3,
      elapsedMs: 40_000,
      timeoutMs: 60_000,
    });
    const lines = linesOf(renderWait(late));

    expect(lines[0]).toBe('checks still running on #41 — 1 check — 3 polls in 40s');
    expect(lines.at(-1)).toBe('Waited the 1 min this run was given; run rafa pr wait 41 again to keep waiting.');
  });
});

describe('the exit code each verdict carries', () => {
  it('exits 0 green, 1 red and on no checks at all, and 3 on checks that have not settled', () => {
    expect(WAIT_EXIT_CODES).toEqual({ green: 0, red: 1, none: 1, pending: 3, timeout: 3 });
    expect(Object.isFrozen(WAIT_EXIT_CODES)).toBe(true);
  });
});

describe('the deadline the line asks for', () => {
  it('waits the loop own CI deadline when no timeout is typed', () => {
    expect(readTimeoutMinutes({}, USAGE)).toBe(DEFAULT_WAIT_TIMEOUT_MIN);
    expect(DEFAULT_WAIT_TIMEOUT_MIN).toBe(20);
  });

  it('reads the minutes a value names', () => {
    expect(readTimeoutMinutes({ timeout: '5' }, USAGE)).toBe(5);
  });

  it('refuses a value that is no whole number of minutes from 1, naming the order that works', () => {
    const refusals = [{ timeout: '0' }, { timeout: 'five' }, { timeout: '1.5' }, { timeout: true }]
      .map((flags) => {
        try {
          readTimeoutMinutes(flags, USAGE);
          return 'read it';
        } catch (error) {
          return (error as Error).message;
        }
      });

    expect(refusals).toEqual([
      '❌ "0" is no timeout, which is a whole number of minutes from 1;'
        + ` type the pull request number before the flags\nUsage: ${USAGE}`,
      '❌ "five" is no timeout, which is a whole number of minutes from 1;'
        + ` type the pull request number before the flags\nUsage: ${USAGE}`,
      '❌ "1.5" is no timeout, which is a whole number of minutes from 1;'
        + ` type the pull request number before the flags\nUsage: ${USAGE}`,
      '❌ --timeout with no value is no timeout, which is a whole number of minutes from 1;'
        + ` type the pull request number before the flags\nUsage: ${USAGE}`,
    ]);
  });
});

describe('the poll, over an injected clock', () => {
  it('waits out a pending poll, reports green, exits 0 and writes nothing to the provider', async () => {
    const clock = fakeClock();
    const pending = checksOf([row({ name: 'e2e', state: 'IN_PROGRESS', outcome: 'pending', link: '' })], 'pending');
    const green = checksOf([row()], 'green');
    const provider = pollingPulls([pending, green]);
    const { run } = await ran(caseSeams(provider.pulls, clock).seams, freshProject());

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run.stdout.trimEnd())).toEqual([
      'Waiting for the checks of #41, up to 20 min.',
      '   [0s] pending — 1 check(s)',
      '   [20s] green — 1 check(s)',
      'checks green on #41 — 1 check — 2 polls in 20s',
      `   pass    gates — SUCCESS (${RUN_URL})`,
    ]);
    expect(clock.sleeps()).toEqual([CI_POLL_INTERVAL_MS]);
    expect(provider.sent()).toEqual([`findOpen ${BRANCH}`, 'checks 41', 'checks 41']);
  });

  it('answers a pull request with no checks at once, asking once and sleeping never', async () => {
    const clock = fakeClock();
    const provider = pollingPulls([checksOf([], 'none')]);
    const { run } = await ran(caseSeams(provider.pulls, clock).seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('checks none on #41 — nothing reported — 1 poll in 0s');
    expect(clock.sleeps()).toEqual([]);
    expect(provider.sent()).toEqual([`findOpen ${BRANCH}`, 'checks 41']);
  });

  it('reports a red pull request on stderr and exits 1, having asked once', async () => {
    const clock = fakeClock();
    const red = checksOf([row({ state: 'FAILURE', outcome: 'fail' })], 'red');
    const provider = pollingPulls([red]);
    const { run } = await ran(caseSeams(provider.pulls, clock).seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('checks red on #41 — 1 check — 1 poll in 0s');
    expect(run.stderr).toContain('Failing: gates — run rafa pr triage 41 to assess it.');
    expect(run.stdout).not.toContain('checks red');
    expect(provider.sent()).toEqual(['checks 41']);
  });

  it('gives up at the deadline the line asked for, exits 3, and says how long it waited', async () => {
    const clock = fakeClock();
    const pending = checksOf([row({ name: 'e2e', state: 'IN_PROGRESS', outcome: 'pending', link: '' })], 'pending');
    const provider = pollingPulls([pending]);
    const { run } = await ran(caseSeams(provider.pulls, clock).seams, freshProject(), ['41', '--timeout=1']);

    expect(run.exitCode).toBe(3);
    expect(run.stdout).toContain('Waiting for the checks of #41, up to 1 min.');
    expect(run.stderr).toContain('checks still running on #41 — 1 check — 3 polls in 40s');
    expect(run.stderr).toContain('Waited the 1 min this run was given; run rafa pr wait 41 again to keep waiting.');
    expect(clock.sleeps()).toEqual([CI_POLL_INTERVAL_MS, CI_POLL_INTERVAL_MS]);
  });

  it('gives the verdict, the checks, the polls and the text as the json result', async () => {
    const clock = fakeClock();
    const provider = pollingPulls([checksOf([row()], 'green')]);
    const { run, events } = await ran(caseSeams(provider.pulls, clock).seams, freshProject(), ['41', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)).toMatchObject({
      number: 41,
      verdict: 'green',
      rows: [{ name: 'gates', state: 'SUCCESS', outcome: 'pass' }],
      elapsedMs: 0,
      polls: 1,
      timeoutMs: DEFAULT_WAIT_TIMEOUT_MIN * 60_000,
      exitCode: 0,
    });
    expect((dataOf(events) as { text: string }).text).toContain('checks green on #41');
  });

  it('carries the report as the terminal error in json mode, where the dispatcher drops the payload', async () => {
    const clock = fakeClock();
    const provider = pollingPulls([checksOf([row({ state: 'FAILURE', outcome: 'fail' })], 'red')]);
    const { run, events } = await ran(caseSeams(provider.pulls, clock).seams, freshProject(), ['41', '--output=json']);
    const ending = events.at(-1) as { ok?: boolean; data?: unknown; error?: { message?: string } };

    expect(run.exitCode).toBe(1);
    expect([ending.ok, ending.data]).toEqual([false, undefined]);
    expect(ending.error?.message).toContain('checks red on #41 — 1 check — 1 poll in 0s');
  });
});

describe('the refusals', () => {
  it('refuses a word that is no pull request number, naming the usage, and makes no provider', async () => {
    const seams = caseSeams(pollingPulls([checksOf([], 'none')]).pulls, fakeClock());
    const { run } = await ran(seams.seams, freshProject(), ['forty-one']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ "forty-one" is no pull request number, which is a whole number from 1\nUsage: ${USAGE}`);
    expect(run.stdout).toBe('');
    expect(seams.made()).toEqual([]);
  });

  it('refuses a timeout value that is no minute count, before it makes a provider', async () => {
    const seams = caseSeams(pollingPulls([checksOf([], 'none')]).pulls, fakeClock());
    const { run } = await ran(seams.seams, freshProject(), ['--timeout', 'forty']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ "forty" is no timeout, which is a whole number of minutes from 1');
    expect(run.stderr).toContain('type the pull request number before the flags');
    expect(seams.made()).toEqual([]);
  });

  it('reads a bare --timeout as swallowing the number, which nothing can tell from minutes', async () => {
    const clock = fakeClock();
    const provider = pollingPulls([checksOf([row()], 'green')]);
    const { run } = await ran(caseSeams(provider.pulls, clock).seams, freshProject(), ['--timeout', '7']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Waiting for the checks of #41, up to 7 min.');
    expect(provider.sent()).toEqual([`findOpen ${BRANCH}`, 'checks 41']);
  });

  it('refuses a project whose provider is not gh with exit code 2 and the shared message', async () => {
    const seams = caseSeams(pollingPulls([checksOf([], 'none')]).pulls, fakeClock());
    const { run } = await ran(seams.seams, freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
  });

  it('refuses a branch with no open pull request, naming the branch and pointing at pr list', async () => {
    const provider = pollingPulls([checksOf([], 'none')], null);
    const { run } = await ran(caseSeams(provider.pulls, fakeClock()).seams, freshProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`No open pull request for the branch "${BRANCH}"`);
    expect(run.stderr).toContain('Run rafa pr list to see the open pull requests.');
    expect(provider.sent()).toEqual([`findOpen ${BRANCH}`]);
  });

  it('refuses with what the provider said when the checks could not be read', async () => {
    const double = createPullRequestsDouble({
      checks: () => Promise.reject(new Error('gh pull requests: gh pr checks 41 failed: could not connect')),
    });
    const { run } = await ran(caseSeams(double.pulls, fakeClock()).seams, freshProject(), ['41']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      '❌ Could not read the checks of pull request #41:'
        + ' gh pull requests: gh pr checks 41 failed: could not connect',
    );
  });
});

describe('the command itself', () => {
  it('routes as pr wait, declares both renderings, one optional argument and one flag, and is frozen', () => {
    const command = createPrWaitCommand();

    expect([command.subject, command.action, command.name]).toEqual(['pr', 'wait', 'pr wait']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.args?.map((arg) => [arg.name, arg.required ?? false])).toEqual([['n', false]]);
    expect(command.flags?.map((flag) => flag.name)).toEqual(['timeout']);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('names the usage line pr-context carries for it, flags after the number', () => {
    expect(USAGE).toBe('rafa pr wait [<n>] [--timeout=<minutes>]');
  });
});
