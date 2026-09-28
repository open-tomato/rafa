/**
 * Tests for what `rafa epic defer` and `rafa epic promote` share
 * (`horizon-change.ts`): the line, the direction, the keep question, the
 * lines printed, and both commands dispatched over one planted `gh`, one
 * planted `git` and a scripted prompter.
 *
 * The board: epic #40 on `epic:auth`, `horizon:now`, with open members
 * #12 and #14 and closed member #13; epic #50 on `epic:billing`,
 * `horizon:next`, whose one open member #51 has no work, so it reads
 * `backlog`; and epic #60 on `epic:later-one`, `horizon:later`, whose
 * open member #120 has a pull request, so it reads `in-progress`. `git` holds `feat/rafa-12-login` locally and on the
 * remote, and `feat/rafa-13-old` of the closed member; the open pull
 * requests are #7 (`Closes #14`) and #8 (`Closes #120`).
 *
 * The planted `gh` tells its calls apart by their nouns and flags: the
 * listing is `issue list` with `--state all`, the pull request listing is
 * `pr list` with `--state open`. Every write it records.
 *
 * ## The controls
 *
 * - The first dispatch sends every write a defer with a no sends, so the
 *   filter the refusals assert empty is shown able to find one.
 * - The branch of the closed member and the pull request of another
 *   epic sit beside the named work, and the case naming the work asserts
 *   the exact list, so a reading naming every branch fails.
 * - The answer-yes case is paired with the answer-no case over the same
 *   board, so a keep question whose answer is ignored fails one of them.
 */
import type { EpicHorizonResult, EpicHorizonSeams } from './horizon-change.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { EpicOpenWork } from '../../board/epic-horizon.js';
import type { HorizonChange } from '../../board/epic-trail.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitResult, GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  blankReasonMessage,
  reasonQuestion,
  renderHorizonComment,
  renderParkedPullRequestComment,
  unaskedReasonMessage,
} from '../../board/epic-trail.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createEpicDeferCommand } from './defer.js';
import {
  closeFailure,
  DEFER_ACTION,
  keepWorkQuestion,
  PROMOTE_ACTION,
  readHorizonLine,
  renderEpicHorizon,
  workPhrase,
  wrongDirection,
} from './horizon-change.js';
import { createEpicPromoteCommand } from './promote.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-horizon-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the commands are dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(number: number, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title: `issue ${String(number)}`, body: '', state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(40, ['type:epic', 'epic:auth', 'horizon:now']),
  raw(12, ['epic:auth']),
  raw(13, ['epic:auth'], 'CLOSED'),
  raw(14, ['epic:auth']),
  raw(50, ['type:epic', 'epic:billing', 'horizon:next']),
  raw(51, ['epic:billing']),
  raw(60, ['type:epic', 'epic:later-one', 'horizon:later']),
  raw(120, ['epic:later-one']),
];

/** The open pull requests. */
const PULLS: readonly object[] = [
  { number: 7, headRefName: 'fix-session', body: 'Closes #14' },
  { number: 8, headRefName: 'billing-work', body: 'Closes #120' },
];

/** The work of epic #40 the board holds. */
const WORK_40: EpicOpenWork = { branches: ['feat/rafa-12-login'], pullRequests: [7] };

/** The deferral of epic #40 the cases make. */
const DEFER_40: HorizonChange = { kind: 'horizon', epic: 40, from: 'now', to: 'later' };

/** How the planted `gh` answers. */
interface Planted {
  readonly failListing?: boolean;
  readonly failSwap?: boolean;
  readonly failClose?: readonly number[];
}

/** A planted `gh` and the calls it received. */
interface PlantedGh {
  readonly gh: GhRunner;
  readonly calls: readonly (readonly string[])[];
}

/** A `gh` answering the listing, the pull requests and every write; see the module note. */
function plantedGh(planted: Planted = {}): PlantedGh {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const calls: (readonly string[])[] = [];
  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb] = args;
    const words = args.join(' ');
    if (noun === 'issue' && verb === 'list' && words.includes('--state all')) {
      return planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(LISTING));
    }
    if (noun === 'pr' && verb === 'list' && words.includes('--state open')) return ok(JSON.stringify(PULLS));
    if (noun === 'issue' && verb === 'edit') {
      return planted.failSwap === true
        ? failed('HTTP 403: Resource not accessible')
        : ok('');
    }
    if (noun === 'api' && args.includes('POST')) {
      const body = args.find((arg) => arg.startsWith('body='))?.slice('body='.length) ?? '';
      return ok(JSON.stringify({ id: 1, body, user: { login: 'rafa-bot' } }));
    }
    if (noun === 'pr' && verb === 'close') {
      return (planted.failClose ?? []).includes(Number(args[2]))
        ? failed('HTTP 502: Bad Gateway')
        : ok('');
    }
    return failed(`unplanted: gh ${words}`);
  };
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { gh, calls };
}

/** A `git` holding the branches the module note names, recording every call. */
function plantedGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const ok = (lines: readonly string[]): GitResult => ({ ok: true, stdout: lines.join('\n'), stderr: '' });
  const git: GitRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'for-each-ref') return ok(['refs/heads/feat/rafa-12-login', 'refs/heads/feat/rafa-13-old', 'refs/heads/main']);
    if (args[0] === 'ls-remote') return ok(['abc123\trefs/heads/feat/rafa-12-login']);
    return { ok: false, stdout: '', stderr: `unplanted: git ${args.join(' ')}` };
  };
  return { git, calls };
}

/** A prompter answering `answers` in turn, null once they run out, recording every question. */
function scriptedPrompter(answers: readonly (string | null)[]): { open: () => Prompter; asked: string[]; closed: () => number } {
  const asked: string[] = [];
  let index = 0;
  let closes = 0;
  const prompter: Prompter = {
    say: () => undefined,
    ask: (question) => {
      asked.push(question);
      const next = answers[index] ?? null;
      index += 1;
      return Promise.resolve(next);
    },
    close: () => {
      closes += 1;
    },
  };
  return { open: () => prompter, asked, closed: () => closes };
}

/** What one case runs with. */
interface CaseSetup {
  readonly planted?: Planted;
  /** The answers typed, or null for no terminal. */
  readonly answers?: readonly (string | null)[] | null;
}

/** A fresh project. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
}

/** Dispatches `rafa epic <words>` over a planted `gh`, `git` and terminal. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const planted = plantedGh(setup.planted);
  const git = plantedGit();
  const answers = setup.answers ?? null;
  const prompter = scriptedPrompter(answers ?? []);
  const seams: EpicHorizonSeams = {
    gh: planted.gh,
    git: git.git,
    planNames: () => () => [],
    isTerminal: () => answers !== null,
    openPrompter: prompter.open,
  };
  const commands: RafaCommand[] = [createEpicDeferCommand(seams), createEpicPromoteCommand(seams)];
  const outcome = await dispatchInProject(['epic', ...words], [EPIC_SUBJECT], commands, plantCase());
  return { ...outcome, calls: planted.calls, gitCalls: git.calls, asked: prompter.asked, closes: prompter.closed() };
}

/** The calls that change something on GitHub. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'edit' || call[1] === 'close' || call.includes('POST'));
}

/** The swap and the comment a move of `change` sends, with `reason`. */
function moveWrites(change: HorizonChange, reason: string): readonly (readonly string[])[] {
  return [
    ['issue', 'edit', String(change.epic), '--remove-label', `horizon:${change.from}`, '--add-label', `horizon:${change.to}`],
    ['api', `repos/{owner}/{repo}/issues/${String(change.epic)}/comments`, '-X', 'POST', '-f', `body=${renderHorizonComment(change, reason)}`],
  ];
}

/** What a refusal thrown by `read` carries. */
function refusalOf(read: () => unknown): { exitCode: unknown; message: string } {
  try {
    read();
  } catch (error) {
    return { exitCode: (error as { exitCode?: unknown }).exitCode, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

describe('readHorizonLine', () => {
  it('reads the epic, the target and the reason, null when left out', () => {
    expect(readHorizonLine({ args: ['40'], flags: { to: 'later', reason: 'why' } }, DEFER_ACTION)).toEqual({ epic: 40, to: 'later', reason: 'why' });
    expect(readHorizonLine({ args: ['40'], flags: { to: 'now' } }, PROMOTE_ACTION)).toEqual({ epic: 40, to: 'now', reason: null });
  });

  it('refuses no number, two, one that is no number, a missing --to and a --to outside the action with exit code 1', () => {
    expect(refusalOf(() => readHorizonLine({ args: [], flags: { to: 'later' } }, DEFER_ACTION)).message).toContain('Expected one epic number, got none');
    expect(refusalOf(() => readHorizonLine({ args: ['40', '41'], flags: { to: 'later' } }, DEFER_ACTION)).message).toContain('got 2: 40 41');
    expect(refusalOf(() => readHorizonLine({ args: ['#40'], flags: { to: 'later' } }, DEFER_ACTION)).message).toContain('"#40" is no epic number');
    expect(refusalOf(() => readHorizonLine({ args: ['40'], flags: {} }, DEFER_ACTION)).message).toContain('--to is required');
    const outside = refusalOf(() => readHorizonLine({ args: ['40'], flags: { to: 'now' } }, DEFER_ACTION));
    expect(outside.exitCode).toBe(1);
    expect(outside.message).toContain('--to is "now", expected one of: next, later');
    expect(refusalOf(() => readHorizonLine({ args: ['40'], flags: { to: 'later' } }, PROMOTE_ACTION)).message)
      .toContain('expected one of: now, next');
  });
});

describe('wrongDirection', () => {
  it('lets a defer move later and a promote move earlier', () => {
    expect(wrongDirection(DEFER_ACTION, DEFER_40)).toBeNull();
    expect(wrongDirection(PROMOTE_ACTION, { ...DEFER_40, from: 'later', to: 'next' })).toBeNull();
  });

  it('refuses the other way with exit code 2, naming the command that would do it', () => {
    const refused = wrongDirection(DEFER_ACTION, { ...DEFER_40, from: 'later', to: 'next' });
    expect(refused?.exitCode).toBe(2);
    expect(refused?.message).toBe('❌ Epic #40 stands on later, so later → next is a promotion;'
      + ' run rafa epic promote 40 --to=next. Nothing was changed');
    expect(wrongDirection(PROMOTE_ACTION, { ...DEFER_40, from: 'now', to: 'next' })?.message)
      .toContain('now → next is a deferral; run rafa epic defer 40 --to=next');
  });
});

describe('the keep question and the lines', () => {
  it('names the work and spells [Y/n]', () => {
    expect(workPhrase(WORK_40)).toBe('branch feat/rafa-12-login, pull request #7');
    expect(keepWorkQuestion(40, WORK_40)).toBe('Epic #40 has open work: branch feat/rafa-12-login, pull request #7. Keep it?'
      + ' A no closes each pull request with a comment and deletes no branch. [Y/n] ');
  });

  const moved: EpicHorizonResult = {
    action: 'defer',
    status: 'moved',
    epic: 40,
    from: 'now',
    to: 'later',
    reason: 'waiting on #118',
    question: null,
    state: 'in-progress',
    work: WORK_40,
    decision: 'closed',
    closed: [{ number: 7, status: 'closed', problem: '' }, { number: 9, status: 'failed', problem: 'HTTP 502' }],
    problems: ['the remote could not be read'],
  };

  it('prints the move, each close, the kept branches and each problem, the failures at warn', () => {
    expect(renderEpicHorizon(moved)).toEqual([
      { text: 'Moved epic #40 now → later: waiting on #118', warn: false },
      { text: 'Closed pull request #7 with a comment.', warn: false },
      { text: 'Could not close pull request #9: HTTP 502', warn: true },
      { text: 'No branch was deleted: feat/rafa-12-login.', warn: false },
      { text: 'The open work named may be short: the remote could not be read', warn: true },
    ]);
    expect(closeFailure(moved)?.message).toBe('❌ Epic #40 moved now → later, but #9 could not be closed and stay open;'
      + ' close them by hand, deleting no branch.');
    expect(closeFailure({ ...moved, closed: [] })).toBeNull();
  });

  it('prints the question with no terminal and the blank refusal, naming the work of a defer', () => {
    const question = reasonQuestion(DEFER_40);
    const unasked = renderEpicHorizon({ ...moved, status: 'unasked', reason: null, question, decision: 'none', closed: [], problems: [] });
    expect(unasked).toEqual([
      { text: unaskedReasonMessage(question), warn: false },
      { text: 'Its open work: branch feat/rafa-12-login, pull request #7.', warn: false },
    ]);
    const blank = renderEpicHorizon({ ...moved, action: 'promote', status: 'blank', reason: null, decision: 'none', closed: [], problems: [] });
    expect(blank).toEqual([{ text: blankReasonMessage(), warn: true }]);
  });
});

describe('rafa epic defer', () => {
  it('on a no, swaps the label, comments the reason and closes each pull request with a comment, deleting no branch', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=waiting on #118'], { answers: ['n'] });

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([keepWorkQuestion(40, WORK_40)]);
    expect(writesOf(result.calls)).toEqual([
      ...moveWrites(DEFER_40, 'waiting on #118'),
      ['pr', 'close', '7', `--comment=${renderParkedPullRequestComment(DEFER_40, 'waiting on #118')}`],
    ]);
    expect(result.calls.some((call) => call.includes('--delete-branch'))).toBe(false);
    expect(result.gitCalls.map((call) => call[0])).toEqual(['for-each-ref', 'ls-remote']);
    expect(result.stdout).toBe([
      'Moved epic #40 now → later: waiting on #118',
      'Closed pull request #7 with a comment.',
      'No branch was deleted: feat/rafa-12-login.',
      '',
    ].join('\n'));
    expect(result.closes).toBeGreaterThan(0);
  });

  it('on a yes or an empty answer, keeps the work and closes nothing', async () => {
    for (const answer of ['y', '', null]) {
      const result = await run(['defer', '40', '--to=later', '--reason=waiting on #118'], { answers: [answer] });

      expect(result.exitCode).toBe(0);
      expect(writesOf(result.calls)).toEqual(moveWrites(DEFER_40, 'waiting on #118'));
      expect(result.stdout).toContain('Its open work is kept: branch feat/rafa-12-login, pull request #7.\n');
    }
  });

  it('with no terminal and a reason, moves the epic and keeps and names the work', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=waiting on #118']);

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([]);
    expect(writesOf(result.calls)).toEqual(moveWrites(DEFER_40, 'waiting on #118'));
    expect(result.stdout).toBe([
      'Moved epic #40 now → later: waiting on #118',
      'No terminal to ask on, so its open work is kept: branch feat/rafa-12-login, pull request #7.',
      '',
    ].join('\n'));
  });

  it('asks the reason once where --reason is left out, then the keep question', async () => {
    const result = await run(['defer', '40', '--to=next'], { answers: ['  the  customer\nasked ', 'y'] });
    const change: HorizonChange = { ...DEFER_40, to: 'next' };

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([reasonQuestion(change), keepWorkQuestion(40, WORK_40)]);
    expect(writesOf(result.calls)).toEqual(moveWrites(change, 'the customer asked'));
  });

  it('with no terminal and no --reason, writes nothing and prints the question and the work, exit 0', async () => {
    const result = await run(['defer', '40', '--to=later']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.stdout).toBe([
      unaskedReasonMessage(reasonQuestion(DEFER_40)),
      'Its open work: branch feat/rafa-12-login, pull request #7.',
      '',
    ].join('\n'));
  });

  it('writes nothing for a blank reason, answered or passed', async () => {
    const answered = await run(['defer', '40', '--to=later'], { answers: ['   '] });
    const passed = await run(['defer', '40', '--to=later', '--reason=  ']);

    for (const result of [answered, passed]) {
      expect(result.exitCode).toBe(0);
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.stdout).toBe(`warn: ${blankReasonMessage()}\nIts open work: branch feat/rafa-12-login, pull request #7.\n`);
    }
    expect(answered.asked).toEqual([reasonQuestion(DEFER_40)]);
  });

  it('asks nothing about an epic that is not in progress', async () => {
    const result = await run(['defer', '50', '--to=later', '--reason=later'], { answers: [] });
    const change: HorizonChange = { kind: 'horizon', epic: 50, from: 'next', to: 'later' };

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([]);
    expect(writesOf(result.calls)).toEqual(moveWrites(change, 'later'));
    expect(result.stdout).toBe('Moved epic #50 next → later: later\n');
  });

  it('refuses a move the other way, an issue that is no epic and its own horizon with exit code 2, asking and writing nothing', async () => {
    const wrongWay = await run(['defer', '60', '--to=next', '--reason=x'], { answers: [] });
    const notEpic = await run(['defer', '12', '--to=later', '--reason=x'], { answers: [] });
    const same = await run(['defer', '60', '--to=later', '--reason=x'], { answers: [] });

    expect(wrongWay.exitCode).toBe(2);
    expect(wrongWay.stderr).toContain('later → next is a promotion; run rafa epic promote 60 --to=next');
    expect(notEpic.exitCode).toBe(2);
    expect(notEpic.stderr).toContain('#12 is not an epic');
    expect(same.exitCode).toBe(2);
    expect(same.stderr).toContain('Epic #60 is already horizon:later');
    for (const result of [wrongWay, notEpic, same]) {
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.asked).toEqual([]);
    }
  });

  it('refuses a board that cannot be read with exit code 2', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=x'], { planted: { failListing: true } });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Could not read the board, so nothing was changed');
    expect(writesOf(result.calls)).toEqual([]);
  });

  it('refuses a failed swap with exit code 1, posting no comment and closing nothing', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=x'], { planted: { failSwap: true }, answers: ['n'] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not move epic #40 now → later');
    expect(writesOf(result.calls)).toEqual(moveWrites(DEFER_40, 'x').slice(0, 1));
  });

  it('ends with exit code 1 naming a pull request that could not be closed, after the move', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=x'], { planted: { failClose: [7] }, answers: ['no'] });

    expect(result.exitCode).toBe(1);
    expect(writesOf(result.calls)).toHaveLength(3);
    expect(result.stdout).toContain('warn: Could not close pull request #7: board issue: gh pr close 7 failed: HTTP 502: Bad Gateway\n');
    expect(result.stderr).toContain('#7 could not be closed and stay open');
  });

  it('gives the move, the work and what became of it as the json result', async () => {
    const result = await run(['defer', '40', '--to=later', '--reason=waiting on #118', '--output=json']);
    const data = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(data?.data).toEqual({
      action: 'defer',
      status: 'moved',
      epic: 40,
      from: 'now',
      to: 'later',
      reason: 'waiting on #118',
      question: null,
      state: 'in-progress',
      work: WORK_40,
      decision: 'unasked',
      closed: [],
      problems: [],
    });
  });
});

describe('rafa epic promote', () => {
  it('swaps the label and comments the reason, asking no keep question', async () => {
    const result = await run(['promote', '50', '--to=now', '--reason=the customer asked'], { answers: [] });
    const change: HorizonChange = { kind: 'horizon', epic: 50, from: 'next', to: 'now' };

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([]);
    expect(writesOf(result.calls)).toEqual(moveWrites(change, 'the customer asked'));
    expect(result.stdout).toBe('Moved epic #50 next → now: the customer asked\n');
  });

  it('asks no keep question for an in-progress epic, and closes no pull request', async () => {
    const result = await run(['promote', '60', '--to=next', '--reason=back on'], { answers: ['n'] });
    const change: HorizonChange = { kind: 'horizon', epic: 60, from: 'later', to: 'next' };

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([]);
    expect(writesOf(result.calls)).toEqual(moveWrites(change, 'back on'));
    expect(result.stdout).toBe('Moved epic #60 later → next: back on\n');
  });

  it('refuses a move later with exit code 2, naming the defer', async () => {
    const result = await run(['promote', '40', '--to=next', '--reason=x']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('now → next is a deferral; run rafa epic defer 40 --to=next');
    expect(writesOf(result.calls)).toEqual([]);
  });
});
