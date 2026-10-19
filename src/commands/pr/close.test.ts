/**
 * Tests for `rafa pr close` (`close.ts`): each refusal that comes before
 * the close, what the command prints ahead of its question, the question
 * with `--yes` and with no terminal, the one close it sends with and
 * without `--delete-branch`, and the json result.
 *
 * Every dispatching case runs the real command from a project of its own
 * beside a home of its own under this file's temporary directory
 * (`tests/cli-capture.ts`), so no case reads the real home. No case
 * reaches GitHub or spawns `gh`: the provider is the adapter over the
 * recorded fake (`pr/gh-fake.ts`) or the port double
 * (`pr/pull-requests-double.ts`).
 *
 * Controls: "it closed nothing" is read off the fake's own call log and
 * the state the pull request is left in, beside a case under `--yes`
 * whose log holds the close; the line refusals read the provider
 * factory's log beside a valid line that does make a provider; and the
 * `--yes` case opens a prompter that throws, beside a case whose
 * prompter records the question it was asked.
 */
import type { CloseSeams, PrCloseResult } from './close.js';
import type { FakePrGh } from '../../pr/gh-fake.js';
import type { PullRequestDetail, PullRequests } from '../../pr/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { Prompter } from '@open-tomato/rafa/core/command';
import type { CliEvent } from '@open-tomato/rafa/ports';

import '../../adapter-registry.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, PR_NEEDS_GH } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { closeQuestion, createPrCloseCommand, readCloseLine, summaryLines } from './close.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-close-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** The usage line every line refusal of this action names. */
const USAGE = PR_USAGE.close;

/** A config naming the GitHub CLI, and one naming no provider. */
const GH_CONFIG = 'pr:\n  provider: gh\n';
const NONE_CONFIG = 'pr:\n  provider: none\n';

/** The pull request every case closes, and why. */
const TITLE = 'Fall back to the local tracker';
const HEAD = 'feat/rafa-940-fallback';
const REASON = 'Replaced by #52, which carries the same fix on the new base.';

/** The question the command asks about #41. */
const QUESTION = closeQuestion(41);

/** The three lines the command prints ahead of its question for #41, closing #12 and another repository's #7. */
const SUMMARY = [
  `#41 ${TITLE}`,
  `   head: ${HEAD}`,
  '   issues a merge would have closed, which stay open: open-tomato/rafa#12, ptone/scion#7',
];

/** How a case is set up beyond the defaults. */
interface CaseOptions {
  /** What the question is answered with; `y` when left out, null for an input that ended. */
  readonly answer?: string | null;
  /** False for a machine with no terminal to ask on. */
  readonly terminal?: boolean;
}

/** What a case hands the command, and what it reads back. */
interface CaseSeams {
  readonly seams: CloseSeams;
  /** Every root a provider was made for. */
  readonly made: () => readonly string[];
  /** Every question the prompter was asked. */
  readonly asked: () => readonly string[];
}

/** Seams over `pulls`, recording each provider made and each question asked. */
function caseSeams(pulls: PullRequests, options: CaseOptions = {}): CaseSeams {
  const roots: string[] = [];
  const asked: string[] = [];
  const answer = Object.hasOwn(options, 'answer')
    ? options.answer ?? null
    : 'y';
  const openPrompter = (): Prompter => ({
    say: () => undefined,
    ask: (question: string) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
    close: () => undefined,
  });
  return {
    seams: {
      pullRequests: (root) => {
        roots.push(root);
        return pulls;
      },
      readBranch: () => 'main',
      readRemote: () => 'git@github.com:open-tomato/rafa.git',
      isTerminal: () => options.terminal ?? true,
      openPrompter,
    },
    made: () => [...roots],
    asked: () => [...asked],
  };
}

/** A fake repository holding #41, open unless `state` says otherwise, closing #12 and another repository's #7. */
function fakeWith(state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN'): FakePrGh {
  const fake = createFakePrGh();
  fake.plant({
    number: 41,
    title: TITLE,
    headRefName: HEAD,
    state,
    closes: [{ number: 12 }, { number: 7, repository: 'ptone/scion' }],
  });
  return fake;
}

/** The adapter over `fake`, as the command reaches it. */
function over(fake: FakePrGh): PullRequests {
  return createGhPullRequests({ gh: fake.run });
}

/** #41 as the adapter reads it off {@link fakeWith}, for a double's `get`. */
async function detailOf(state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN'): Promise<PullRequestDetail> {
  const detail = await over(fakeWith(state)).get(41);
  if (detail === null) throw new Error('the fake holds #41, and the adapter read none');
  return detail;
}

/** Every `gh pr close` the fake was handed. */
function closesSent(fake: FakePrGh): readonly (readonly string[])[] {
  return fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'close');
}

/** A project of this case's own, holding `config`. */
function freshProject(config: string = GH_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Dispatches `rafa pr close` over `seams`, with `words` after the action. */
async function ran(seams: CloseSeams, words: readonly string[], project = freshProject()): Promise<CapturedRun> {
  return dispatchInProject(['pr', 'close', ...words], SUBJECTS, [createPrCloseCommand(seams)], project);
}

/** The lines a run wrote to stdout, blank ones left out. */
function linesOf(run: CapturedRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

/** What `call` threw, as the dispatcher would read it. */
function exitOf(call: () => unknown): { exitCode: number; message: string } | null {
  try {
    call();
  } catch (error) {
    if (error instanceof CommandExit) return { exitCode: error.exitCode, message: error.message };
    throw error;
  }
  return null;
}

describe('reading the line', () => {
  it('reads the number, the reason as typed, and both switches off unless the line names them', () => {
    expect(readCloseLine(['41'], { reason: REASON })).toEqual({
      number: 41,
      reason: REASON,
      deleteBranch: false,
      yes: false,
    });
    expect(readCloseLine(['41'], { reason: REASON, 'delete-branch': true, yes: true })).toEqual({
      number: 41,
      reason: REASON,
      deleteBranch: true,
      yes: true,
    });
  });

  it('refuses a switch that swallowed the number ahead of the line naming no number', () => {
    expect(exitOf(() => readCloseLine([], { reason: REASON, yes: '41' }))).toEqual({
      exitCode: 1,
      message: '❌ --yes takes no value, and read "41" as one;'
        + ` type the pull request number before the flags\nUsage: ${USAGE}`,
    });
    expect(exitOf(() => readCloseLine([], { reason: REASON, 'delete-branch': '41' }))?.message)
      .toContain('--delete-branch takes no value, and read "41" as one');
  });
});

describe('the line refusals, each before a provider is made', () => {
  it('makes a provider for a valid line, the control the refusals below are read against', async () => {
    const control = caseSeams(over(fakeWith()));
    const project = freshProject();

    const run = await ran(control.seams, ['41', `--reason=${REASON}`], project);

    expect(run.exitCode).toBe(0);
    expect(control.made()).toEqual([project.root]);
  });

  it('refuses a missing number, a word that is no number, a second word and a reason left out, bare or blank', async () => {
    const fake = fakeWith();
    const seams = caseSeams(over(fake));
    const lines: readonly (readonly [readonly string[], string])[] = [
      [[`--reason=${REASON}`], 'Expected the number of the pull request to close'],
      [['x41', `--reason=${REASON}`], '"x41" is no pull request number, which is a whole number from 1'],
      [['41', '42', `--reason=${REASON}`], 'Expected at most one pull request number, got 2: 41 42'],
      [['41'], '--reason is required: --reason=<value>'],
      [['41', '--yes'], '--reason is required: --reason=<value>'],
      [['41', '--reason'], '--reason needs a value: --reason=<value>'],
      [['41', '--reason= '], '--reason cannot be blank: --reason=<value>'],
      [
        ['--yes', '41', `--reason=${REASON}`],
        '--yes takes no value, and read "41" as one; type the pull request number before the flags',
      ],
    ];

    for (const [words, problem] of lines) {
      const run = await ran(seams.seams, words);
      expect([run.exitCode, run.stderr]).toEqual([1, expect.stringContaining(`❌ ${problem}\nUsage: ${USAGE}`)]);
    }
    expect(seams.made()).toEqual([]);
    expect(fake.calls()).toEqual([]);
    expect(seams.asked()).toEqual([]);
  });

  it('refuses with exit code 2 where pr.provider is not gh, having made no provider', async () => {
    const fake = fakeWith();
    const seams = caseSeams(over(fake));

    const run = await ran(seams.seams, ['41', `--reason=${REASON}`, '--yes'], freshProject(NONE_CONFIG));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(PR_NEEDS_GH);
    expect(seams.made()).toEqual([]);
    expect(fake.calls()).toEqual([]);
  });
});

describe('what it refuses once the pull request is read, closing nothing', () => {
  it('closes an open pull request under --yes, the control the three refusals below are read against', async () => {
    const fake = fakeWith();

    const run = await ran(caseSeams(over(fake)).seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(0);
    expect(closesSent(fake)).toHaveLength(1);
    expect(fake.pull(41)?.state).toBe('CLOSED');
  });

  it('refuses a pull request the repository does not hold, naming its number', async () => {
    const fake = fakeWith();
    const seams = caseSeams(over(fake));

    const run = await ran(seams.seams, ['9', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ No pull request #9 in the repository at ');
    expect(run.stdout).toBe('');
    expect(closesSent(fake)).toEqual([]);
    expect(seams.asked()).toEqual([]);
  });

  it('refuses a pull request already merged, naming that state', async () => {
    const fake = fakeWith('MERGED');
    const seams = caseSeams(over(fake));

    const run = await ran(seams.seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Pull request #41 is already merged, so there is nothing to close.');
    expect(run.stdout).toBe('');
    expect(closesSent(fake)).toEqual([]);
    expect(fake.pull(41)?.state).toBe('MERGED');
    expect(seams.asked()).toEqual([]);
  });

  it('refuses a pull request already closed, naming that state', async () => {
    const fake = fakeWith('CLOSED');
    const seams = caseSeams(over(fake));

    const run = await ran(seams.seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Pull request #41 is already closed, so there is nothing to close.');
    expect(run.stdout).toBe('');
    expect(closesSent(fake)).toEqual([]);
    expect(seams.asked()).toEqual([]);
  });

  it('refuses with exit code 1 naming what it was doing when the read rejects, and sends nothing after it', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.reject(new Error('gh pr view failed: no network')) });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Could not read pull request #41: gh pr view failed: no network');
    expect(double.sent()).toEqual(['get 41']);
  });
});

describe('what it prints ahead of the question', () => {
  it('prints the title, the head branch and the issues that stay open, each named with its repository', async () => {
    expect(summaryLines(await detailOf())).toEqual(SUMMARY);
  });

  it('says so where the pull request closes no issue, and names the number alone where the title is blank', async () => {
    const detail: PullRequestDetail = { ...await detailOf(), title: '  ', closes: [] };

    expect(summaryLines(detail)).toEqual([
      '#41',
      `   head: ${HEAD}`,
      '   issues a merge would have closed: none',
    ]);
  });

  it('writes those lines, then the question, then what the close left, in that order', async () => {
    const seams = caseSeams(over(fakeWith()));

    const run = await ran(seams.seams, ['41', `--reason=${REASON}`]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([
      ...SUMMARY,
      `Closed #41 without merging. The branch ${HEAD} stays on the remote.`,
    ]);
    expect(seams.asked()).toEqual([QUESTION]);
  });
});

describe('the question', () => {
  it('is spelled [y/N] and names the pull request', () => {
    expect(QUESTION).toBe('Close #41 without merging? [y/N] ');
  });

  it('closes on y and on yes, however it is cased and padded', async () => {
    for (const answer of ['y', ' YES ']) {
      const fake = fakeWith();

      const run = await ran(caseSeams(over(fake), { answer }).seams, ['41', `--reason=${REASON}`]);

      expect([answer, run.exitCode, fake.pull(41)?.state]).toEqual([answer, 0, 'CLOSED']);
    }
  });

  it('closes nothing on an answer that is not yes, the empty one included, and ends 0 saying so', async () => {
    for (const answer of ['n', '', 'yep']) {
      const fake = fakeWith();
      const seams = caseSeams(over(fake), { answer });

      const run = await ran(seams.seams, ['41', `--reason=${REASON}`]);

      expect([answer, run.exitCode, run.stderr]).toEqual([answer, 0, '']);
      expect(linesOf(run)).toEqual([...SUMMARY, 'Nothing was closed.']);
      expect(seams.asked()).toEqual([QUESTION]);
      expect(closesSent(fake)).toEqual([]);
      expect(fake.pull(41)?.state).toBe('OPEN');
    }
  });

  it('closes nothing when the input ends before an answer is typed', async () => {
    const fake = fakeWith();

    const run = await ran(caseSeams(over(fake), { answer: null }).seams, ['41', `--reason=${REASON}`]);

    expect(run.exitCode).toBe(0);
    expect(linesOf(run).at(-1)).toBe('Nothing was closed.');
    expect(closesSent(fake)).toEqual([]);
  });

  it('refuses without a terminal and without --yes, naming the flag, asking nothing and closing nothing', async () => {
    const fake = fakeWith();
    const seams = caseSeams(over(fake), { terminal: false });

    const run = await ran(seams.seams, ['41', `--reason=${REASON}`]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ rafa pr close asks before closing, and standard input is no terminal.');
    expect(run.stderr).toContain(SUMMARY.map((line) => `   ${line}`).join('\n'));
    expect(run.stderr).toContain('Close it without the question with --yes.');
    expect(run.stdout).toBe('');
    expect(seams.asked()).toEqual([]);
    expect(closesSent(fake)).toEqual([]);
    expect(fake.pull(41)?.state).toBe('OPEN');
  });

  it('asks nothing under --yes, opening no prompter at all, even with no terminal', async () => {
    const fake = fakeWith();
    const seams: CloseSeams = {
      ...caseSeams(over(fake), { terminal: false }).seams,
      openPrompter: () => {
        throw new Error('--yes must open no prompter');
      },
    };

    const run = await ran(seams, ['41', `--reason=${REASON}`, '--yes']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(linesOf(run)).toEqual([
      ...SUMMARY,
      `Closed #41 without merging. The branch ${HEAD} stays on the remote.`,
    ]);
    expect(fake.pull(41)?.state).toBe('CLOSED');
  });
});

describe('the close it sends', () => {
  it('sends one gh pr close with the reason as the comment, and leaves the head branch alone', async () => {
    const fake = fakeWith();

    const run = await ran(caseSeams(over(fake)).seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(0);
    expect(closesSent(fake)).toEqual([['pr', 'close', '41', `--comment=${REASON}`]]);
    expect(fake.pull(41)?.comments.map((comment) => comment.body)).toEqual([REASON]);
    expect(fake.deletedBranches()).toEqual([]);
  });

  it('adds --delete-branch only when the line names it, and says the branch was deleted', async () => {
    const fake = fakeWith();

    const run = await ran(caseSeams(over(fake)).seams, ['41', `--reason=${REASON}`, '--delete-branch', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(closesSent(fake)).toEqual([['pr', 'close', '41', `--comment=${REASON}`, '--delete-branch']]);
    expect(fake.deletedBranches()).toEqual([HEAD]);
    expect(linesOf(run).at(-1)).toBe(`Closed #41 without merging and deleted the branch ${HEAD}.`);
  });

  it('reads the pull request once and closes it once, in that order, handing the port the reason untouched', async () => {
    const detail = await detailOf();
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detail),
      close: () => Promise.resolve(),
    });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(0);
    expect(double.calls().map((call) => [call.member, call.args])).toEqual([
      ['get', [41]],
      ['close', [41, REASON, { deleteBranch: false }]],
    ]);
  });

  it('refuses with exit code 1 naming what it was doing when the close rejects', async () => {
    const detail = await detailOf();
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detail),
      close: () => Promise.reject(new Error('gh pr close 41 failed: not permitted')),
    });

    const run = await ran(caseSeams(double.pulls).seams, ['41', `--reason=${REASON}`, '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Could not close pull request #41: gh pr close 41 failed: not permitted');
    expect(linesOf(run)).toEqual(SUMMARY);
  });
});

describe('the json result', () => {
  /** What every result of this file's pull request holds, whatever the run did with it. */
  const HELD = {
    number: 41,
    title: TITLE,
    head: HEAD,
    issues: [
      { number: 12, repository: 'open-tomato/rafa', url: 'https://github.com/open-tomato/rafa/issues/12' },
      { number: 7, repository: 'ptone/scion', url: 'https://github.com/ptone/scion/issues/7' },
    ],
  };

  it('gives the number, the title, the head, the issues left open and both outcomes for a close', async () => {
    const run = await ran(caseSeams(over(fakeWith())).seams, ['41', `--reason=${REASON}`, '--yes', '--output=json']);

    const expected: PrCloseResult = { ...HELD, closed: true, branchDeleted: false };
    expect(run.exitCode).toBe(0);
    expect(dataOf(eventsOf(run.stdout))).toEqual(expected);
  });

  it('says the branch was deleted where the line asked for it', async () => {
    const run = await ran(
      caseSeams(over(fakeWith())).seams,
      ['41', `--reason=${REASON}`, '--delete-branch', '--yes', '--output=json'],
    );

    expect(dataOf(eventsOf(run.stdout))).toEqual({ ...HELD, closed: true, branchDeleted: true });
  });

  it('says nothing was closed and no branch deleted for a declined question, --delete-branch on the line or not', async () => {
    const fake = fakeWith();

    const run = await ran(
      caseSeams(over(fake), { answer: 'n' }).seams,
      ['41', `--reason=${REASON}`, '--delete-branch', '--output=json'],
    );

    expect(run.exitCode).toBe(0);
    expect(dataOf(eventsOf(run.stdout))).toEqual({ ...HELD, closed: false, branchDeleted: false });
    expect(closesSent(fake)).toEqual([]);
  });
});
