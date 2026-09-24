/**
 * Tests for `--skip-checks` on `rafa pr merge` (`merge.ts`): the flag
 * as declared, the refusals it routes through `readMergeRefusal` and
 * `./merge-unchecked.ts`, the question it asks in place of
 * `Merge? [y/N]`, the comment it posts after the merge, and the
 * `unchecked` field of the result.
 *
 * `merge.test.ts` is over 800 lines, so these cases live here. Like that
 * file, every case dispatches the real command from a project of its own
 * (`tests/cli-capture.ts`) over a provider double recording every member
 * it was sent and a git runner recording every argv, so nothing reaches
 * GitHub or git. The driven cases over the gh fake and a bare remote are
 * `merge-skip-checks-driven.test.ts`'s.
 *
 * The way this passes while wrong is by merging where it should refuse,
 * or asking the ordinary question where it should ask the unchecked one.
 * So "merged nothing" is read off the double's log (no `merge` was sent),
 * "asked nothing" off the prompter's log, and every refusal has a control
 * beside it differing in one input that DOES merge.
 */
import type { MergeSeams } from './merge.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { CliEvent } from '../../ports/index.js';
import type {
  CheckRow,
  ChecksReading,
  GitResult,
  GitRunner,
  PullRequestComment,
  PullRequestDetail,
} from '../../pr/index.js';
import type { PullRequestsDouble } from '../../pr/pull-requests-double.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import {
  NO_WORKFLOW_WARNING,
  UNCHECKED_MERGE_SENTENCE,
  WORKFLOWS_EXIST_WARNING,
  workflowCountLine,
} from '../../pr/unchecked.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-skip-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI and no roadmap issue, so the tick reads nothing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** An `origin` on github.com. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The head branch of every case's pull request. */
const BRANCH = 'feat/rafa-86-skip-checks';

/** The base branch of every case's pull request. */
const BASE = 'main';

/** The pull request every case merges. */
const NUMBER = 41;

/** The URL the double answers for the posted comment. */
const COMMENT_URL = `https://github.com/open-tomato/rafa/pull/${NUMBER}#issuecomment-901`;

/** The question the unchecked merge asks, with the trailing space the prompter is handed. */
const UNCHECKED_QUESTION = `Merge #${NUMBER} with no checks? [y/N] `;

/** Typed by every case so the ending never composes the real sources. */
const NO_HINT = '--no-hint';

/** A pull request detail as the double answers one. */
function detail(): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'rafa-86: merge with no checks',
    url: `https://github.com/open-tomato/rafa/pull/${NUMBER}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-22T11:00:00Z',
    body: '',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** One passing check row named `name`. */
function passing(name: string): CheckRow {
  return { name, state: 'SUCCESS', link: `https://github.com/open-tomato/rafa/actions/runs/1/job/${name}`, outcome: 'pass' };
}

/** Zero check rows: the reading `--skip-checks` is for. */
const NO_CHECKS: ChecksReading = { rows: [], verdict: 'none' };

/** One passing check row. */
const GREEN: ChecksReading = { rows: [passing('unit-tests')], verdict: 'green' };

/** What the double answers beyond the defaults. */
interface PullAnswers {
  readonly checks?: ChecksReading;
  /** The workflow count; zero when left out. */
  readonly workflowCount?: number | null;
  /** True for a provider that will not take the comment. */
  readonly commentFails?: boolean;
}

/** The comment the double answers once posted, carrying `body`. */
function posted(body: string): PullRequestComment {
  return {
    id: '901',
    author: { login: 'rafa-bot', isBot: false },
    body,
    updatedAt: '2026-09-22T11:05:00Z',
    url: COMMENT_URL,
  };
}

/** A provider answering the five members an unchecked merge sends, and refusing every other one. */
function pullsDouble(answers: PullAnswers = {}): PullRequestsDouble {
  const count = Object.hasOwn(answers, 'workflowCount')
    ? answers.workflowCount ?? null
    : 0;
  return createPullRequestsDouble({
    get: () => Promise.resolve(detail()),
    checks: () => Promise.resolve(answers.checks ?? NO_CHECKS),
    merge: () => Promise.resolve({ merged: true, detail: `Squashed and merged pull request #${NUMBER}` }),
    workflowCount: () => Promise.resolve(count),
    comment: (_number: number, body: string) => answers.commentFails === true
      ? Promise.reject(new Error('gh: Resource not accessible by integration (HTTP 403)'))
      : Promise.resolve(posted(body)),
  });
}

/** A git answer that worked, carrying `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git runner over planted answers, and the log of every command it was handed. */
function fakeGit(root: string, over: Readonly<Record<string, GitResult>> = {}): {
  git: (root: string) => GitRunner;
  ran: () => readonly string[];
} {
  const ran: string[] = [];
  const answers: Record<string, GitResult> = {
    'status --porcelain': ok(''),
    'worktree list --porcelain': ok(`worktree ${root}\nbranch refs/heads/${BRANCH}\n\n`),
    'rev-parse --show-toplevel': ok(`${root}\n`),
    [`ls-remote --heads origin ${BRANCH}`]: ok(`1f0c2b7\trefs/heads/${BRANCH}\n`),
    ...over,
  };
  return {
    git: () => (args) => {
      const line = args.join(' ');
      ran.push(line);
      return answers[line] ?? ok('');
    },
    ran: () => [...ran],
  };
}

/** A prompter answering `answer` to every question and recording each. */
function recordingPrompter(answer: string | null): { open: () => Prompter; asked: () => readonly string[] } {
  const asked: string[] = [];
  return {
    open: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
      close: () => undefined,
    }),
    asked: () => [...asked],
  };
}

/** How a case is set up beyond the defaults. */
interface CaseOptions extends PullAnswers {
  /** What the question is answered with; `y` when left out. */
  readonly answer?: string | null;
  /** False for a machine with no terminal to ask on; a terminal when left out. */
  readonly terminal?: boolean;
  /** Git answers replacing the defaults. */
  readonly git?: Readonly<Record<string, GitResult>>;
}

/** What one run left, and the logs its controls read. */
interface Ran {
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
  readonly double: PullRequestsDouble;
  readonly asked: readonly string[];
  readonly gitRan: readonly string[];
}

/** Dispatches `rafa pr merge` with `words` over a fresh project and the doubles `options` shape. */
async function ran(words: readonly string[], options: CaseOptions = {}): Promise<Ran> {
  const project: PlantedProject = plantProject(mkdtempSync(join(tempBase, 'case-')), GH_CONFIG);
  const double = pullsDouble(options);
  const git = fakeGit(project.root, options.git ?? {});
  const prompter = recordingPrompter(Object.hasOwn(options, 'answer')
    ? options.answer ?? null
    : 'y');
  const seams: MergeSeams = {
    pullRequests: () => double.pulls,
    readBranch: () => BRANCH,
    readRemote: () => GITHUB_ORIGIN,
    git: git.git,
    gh: () => () => Promise.resolve({ ok: false, stdout: '', stderr: 'no board in this case' }),
    isTerminal: () => options.terminal ?? true,
    openPrompter: prompter.open,
  };
  const command: RafaCommand = createPrMergeCommand(seams);
  const run = await dispatchInProject(['pr', 'merge', ...words, NO_HINT], SUBJECTS, [command], project);
  return {
    run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
    double,
    asked: prompter.asked(),
    gitRan: git.ran(),
  };
}

/** The members the double was sent, without their arguments. */
function members(double: PullRequestsDouble): readonly string[] {
  return double.calls().map((call) => call.member);
}

/** The body of every comment the double was sent. */
function commentBodies(double: PullRequestsDouble): readonly string[] {
  return double.calls()
    .filter((call) => call.member === 'comment')
    .map((call) => String(call.args[1]));
}

/** The warnings a text-mode run wrote, each without its `warn: ` prefix. */
function warnings(run: CapturedRun): readonly string[] {
  return run.stdout.split('\n')
    .filter((line) => line.startsWith('warn: '))
    .map((line) => line.slice('warn: '.length));
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): Record<string, unknown> {
  return (events.at(-1) as { data?: Record<string, unknown> }).data ?? {};
}

describe('the flag as declared', () => {
  const command = createPrMergeCommand();

  it('declares --skip-checks as a boolean whose description names what it is for and what refuses it', () => {
    const flag = command.flags?.find((declared) => declared.name === 'skip-checks');

    expect(flag?.type).toBe('boolean');
    expect(flag?.description).toContain('reports no checks at all');
    expect(flag?.description).toContain('Refused where the pull request reports any check');
    expect(flag?.description).toContain('`--yes` beside it is refused');
  });

  it('carries an example of it, and says so in the command description', () => {
    const example = command.examples?.find((shown) => shown.cmd.includes('--skip-checks'));

    expect(example?.cmd).toBe('rafa pr merge 41 --skip-checks');
    expect(command.description).toContain('`Merge #<n> with no checks? [y/N]`');
  });
});

describe('--skip-checks routed through readMergeRefusal', () => {
  it('refuses a pull request with no checks without the flag, naming it, and reads no workflow count', async () => {
    const { run, double, asked } = await ran([String(NUMBER), '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`run rafa pr merge ${NUMBER} --skip-checks.`);
    expect(members(double)).toEqual(['get', 'checks']);
    expect(asked).toEqual([]);
  });

  it('refuses the flag on a green pull request, naming its row, and merges nothing', async () => {
    const { run, double } = await ran([String(NUMBER), '--skip-checks'], { checks: GREEN });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--skip-checks is only for a PR that reports no checks at all');
    expect(run.stderr).toContain('unit-tests');
    expect(members(double)).toEqual(['get', 'checks']);
  });

  it('merges the same green pull request without the flag, the control on the case above', async () => {
    const { run, double } = await ran([String(NUMBER), '--yes'], { checks: GREEN });

    expect(run.exitCode).toBe(0);
    expect(members(double)).toEqual(['get', 'checks', 'merge']);
  });
});

describe('an unchecked merge where no workflow exists', () => {
  it('merges under --yes with no question, warning first and commenting once after the merge', async () => {
    const { run, double, asked } = await ran([String(NUMBER), '--skip-checks', '--yes']);

    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([]);
    expect(warnings(run)).toEqual([workflowCountLine(0), NO_WORKFLOW_WARNING]);
    expect(members(double)).toEqual(['get', 'checks', 'workflowCount', 'merge', 'comment']);
    expect(commentBodies(double)).toHaveLength(1);
    expect(commentBodies(double)[0]).toContain(UNCHECKED_MERGE_SENTENCE);
    expect(run.stdout).toContain(COMMENT_URL);
  });

  it('runs the whole clean-up after it, as an ordinary merge does', async () => {
    const { gitRan } = await ran([String(NUMBER), '--skip-checks', '--yes']);

    expect(gitRan).toContain(`switch ${BASE}`);
    expect(gitRan).toContain('fetch --prune');
  });

  it('carries the count, the case and the comment URL in the result', async () => {
    const { run, events } = await ran([String(NUMBER), '--skip-checks', '--yes', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)['unchecked']).toEqual({ workflowCount: 0, case: 'no-workflow', commentUrl: COMMENT_URL });
  });

  it('carries null in that field for a merge without the flag, the control on the case above', async () => {
    const { events } = await ran([String(NUMBER), '--yes', '--output=json'], { checks: GREEN });

    expect(dataOf(events)['merged']).toBe(true);
    expect(dataOf(events)['unchecked']).toBeNull();
  });

  it('refuses with no terminal and no --yes, writing nothing to stdout and merging nothing', async () => {
    const { run, double, asked } = await ran([String(NUMBER), '--skip-checks'], { terminal: false });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('standard input is no terminal');
    expect(run.stderr).toContain('Merge it without the question with --yes.');
    expect(members(double)).toEqual(['get', 'checks', 'workflowCount']);
    expect(asked).toEqual([]);
  });
});

describe('an unchecked merge where workflows exist', () => {
  it('refuses --yes, naming the count and the warning, and merges nothing', async () => {
    const { run, double } = await ran([String(NUMBER), '--skip-checks', '--yes'], { workflowCount: 1 });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(`refuses --yes for #${NUMBER} with no checks`);
    expect(run.stderr).toContain(WORKFLOWS_EXIST_WARNING);
    expect(members(double)).toEqual(['get', 'checks', 'workflowCount']);
  });

  it('refuses --yes where the count could not be read too', async () => {
    const { run, double } = await ran([String(NUMBER), '--skip-checks', '--yes'], { workflowCount: null });

    expect(run.exitCode).toBe(1);
    expect(members(double)).not.toContain('merge');
  });

  it('asks the unchecked question on a terminal, never Merge?, and merges on y with the count in the comment', async () => {
    const { run, double, asked } = await ran([String(NUMBER), '--skip-checks'], { workflowCount: 2, answer: 'y' });

    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([UNCHECKED_QUESTION]);
    expect(warnings(run)).toContain(WORKFLOWS_EXIST_WARNING);
    expect(members(double)).toContain('merge');
    expect(commentBodies(double)[0]).toContain('2 workflows');
  });

  it('merges nothing and posts nothing on any other answer, ending 0 with the reading in the result', async () => {
    const { run, double, events } = await ran(
      [String(NUMBER), '--skip-checks', '--output=json'],
      { workflowCount: 2, answer: '' },
    );

    expect(run.exitCode).toBe(0);
    expect(members(double)).toEqual(['get', 'checks', 'workflowCount']);
    expect(dataOf(events)['declined']).toBe(true);
    expect(dataOf(events)['unchecked']).toEqual({ workflowCount: 2, case: 'workflows-exist', commentUrl: null });
  });
});

describe('the comment after an unchecked merge', () => {
  it('is a warning carrying the body when it will not post, and the merge still ends 0', async () => {
    const { run } = await ran([String(NUMBER), '--skip-checks', '--yes'], { commentFails: true });

    expect(run.exitCode).toBe(0);
    const problem = warnings(run).find((line) => line.startsWith('the unchecked-merge comment was not posted'));
    expect(problem).toContain(`on #${NUMBER}: gh: Resource not accessible by integration (HTTP 403)`);
    expect(run.stdout).toContain(UNCHECKED_MERGE_SENTENCE);
    expect(run.stdout).toContain(`Merged #${NUMBER} into ${BASE} (squash).`);
  });

  it('leaves the comment URL null in the result when it will not post', async () => {
    const { run, events } = await ran(
      [String(NUMBER), '--skip-checks', '--yes', '--output=json'],
      { commentFails: true },
    );

    expect(run.exitCode).toBe(0);
    expect(dataOf(events)['merged']).toBe(true);
    expect(dataOf(events)['unchecked']).toEqual({ workflowCount: 0, case: 'no-workflow', commentUrl: null });
  });

  it('is posted before the clean-up, so a clean-up step that fails does not drop it', async () => {
    const { run, double } = await ran(
      [String(NUMBER), '--skip-checks', '--yes'],
      { git: { 'pull --ff-only': { ok: false, stdout: '', stderr: 'fatal: Not possible to fast-forward, aborting.' } } },
    );

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('is merged, and the merge is left alone');
    expect(commentBodies(double)).toHaveLength(1);
  });
});
