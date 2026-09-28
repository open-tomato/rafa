/**
 * Tests for `rafa epic cancel` (`cancel.ts`): the line, the epic read off
 * the listing with its dependents, the answers, the note appended below a
 * body, and the command dispatched over one planted `gh` that keeps the
 * issue bodies it is sent, one planted `git` and a scripted prompter.
 *
 * The board: epic #40 on `epic:auth`, open, whose members #12 and #14 are
 * open and #13 is closed. Outside it wait #57 (`epic:payments`,
 * `spec:blocked`, `Blocked by: #12`), #58 (`epic:billing`, `spec:blocked`,
 * a CRLF body blocked by #14 and #51, which is open) and #59 (no epic,
 * blocked by #12 and the closed #13). #62 waits on the closed #13 alone
 * and #63's line names itself and #12, so it is a problem, not a
 * dependent. Epic #50 (`epic:billing`) and #90 (`epic:payments`) are
 * open; #60 is closed as completed; #70 is closed as not planned with
 * #72 waiting on its open member #71; #75 is closed as not planned with
 * nothing waiting; #80 is open with nothing waiting.
 *
 * The planted `gh` tells its calls apart by their nouns and flags: the
 * listing is `issue list` with `--state all`, the pull request listing
 * `pr list` with `--state open`, a label write `issue edit`, a close
 * `issue close`, a body read `api` with no `-X`, a body write `api` with
 * `PATCH` and a comment `api` with `POST`.
 *
 * ## The controls
 *
 * - The case answering all three sends every kind of write a cancel
 *   sends, so the filter the no-terminal and refusal cases assert empty
 *   is shown able to find each one.
 * - #62 waits on a closed member and #63 on an open one through a faulty
 *   line, beside the three dependents, so a query listing every
 *   `Blocked by:` line fails the exact list.
 * - #57 carries `spec:blocked` and loses it on an unblock where #58 keeps
 *   it, over the same board, so a run taking the label off every
 *   unblocked issue fails one of them.
 */
import type { EpicCancelResult, EpicCancelSeams } from './cancel.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { DependentOutcome, MembershipChange } from '../../board/epic-trail.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitResult, GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { cancelMoveReason, renderCancelComment, renderDependentComment, renderMoveComment, renderUnblockNote } from '../../board/epic-trail.js';
import { parseBoardListing } from '../../board/roadmap-board.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import cancelCommand, {
  appendNote,
  CHOICE_HINT,
  createEpicCancelCommand,
  dependentQuestion,
  endedCancelMessage,
  readCancelLine,
  readChoiceWord,
  readEpicToCancel,
  targetQuestion,
  unaskedCancelMessage,
} from './cancel.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-cancel-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** The day the planted clock reads. */
const DAY = '2026-09-28';

/** Epic #50's body. */
const BODY_50 = '## Specs\n\n- [ ] #51 invoices\n';

/** Epic #90's body. */
const BODY_90 = '## Specs\n\n- [ ] #57 checkout\n';

/** #57's body. */
const BODY_57 = 'Pay at checkout.\n\nBlocked by: #12\n';

/** #58's body, CRLF. */
const BODY_58 = 'Invoice runs.\r\n\r\nBlocked by: #14 #51\r\n';

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(
  number: number,
  labels: readonly string[],
  options: { state?: 'OPEN' | 'CLOSED'; reason?: 'COMPLETED' | 'NOT_PLANNED'; body?: string } = {},
): object {
  const state = options.state ?? 'OPEN';
  const stateReason = state === 'CLOSED'
    ? options.reason ?? 'COMPLETED'
    : null;
  return { number, title: `issue ${String(number)}`, body: options.body ?? '', state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(40, ['type:epic', 'epic:auth', 'horizon:now']),
  raw(12, ['epic:auth']),
  raw(13, ['epic:auth'], { state: 'CLOSED' }),
  raw(14, ['epic:auth']),
  raw(50, ['type:epic', 'epic:billing', 'horizon:next'], { body: BODY_50 }),
  raw(51, ['epic:billing']),
  raw(90, ['type:epic', 'epic:payments', 'horizon:next'], { body: BODY_90 }),
  raw(57, ['epic:payments', 'spec:blocked'], { body: BODY_57 }),
  raw(58, ['epic:billing', 'spec:blocked'], { body: BODY_58 }),
  raw(59, ['type:feature'], { body: 'Blocked by: #12 #13\n' }),
  raw(62, ['type:feature'], { body: 'Blocked by: #13\n' }),
  raw(63, ['type:feature'], { body: 'Blocked by: #63 #12\n' }),
  raw(60, ['type:epic', 'epic:old', 'horizon:later'], { state: 'CLOSED' }),
  raw(70, ['type:epic', 'epic:gone', 'horizon:later'], { state: 'CLOSED', reason: 'NOT_PLANNED' }),
  raw(71, ['epic:gone']),
  raw(72, ['type:feature'], { body: 'Blocked by: #71\n' }),
  raw(75, ['type:epic', 'epic:dropped', 'horizon:later'], { state: 'CLOSED', reason: 'NOT_PLANNED' }),
  raw(80, ['type:epic', 'epic:quiet', 'horizon:later']),
  raw(81, ['epic:quiet']),
];

/** The board as the command reads it. */
const ISSUES = parseBoardListing(JSON.stringify(LISTING), 'the planted listing');

/** How the planted `gh` answers. */
interface Planted {
  readonly failListing?: boolean;
  /** Issues whose close fails. */
  readonly failClose?: readonly number[];
}

/** A planted `gh`, the calls it received and the bodies it holds. */
interface PlantedGh {
  readonly gh: GhRunner;
  readonly calls: readonly (readonly string[])[];
  readonly bodies: ReadonlyMap<number, string>;
}

/** The issue number an `api repos/{owner}/{repo}/issues/<n>` path names, or NaN. */
function issueOfPath(path: string): number {
  return Number(/^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/u.exec(path)?.[1] ?? Number.NaN);
}

/** A `gh` answering the listing, the pull requests, the bodies and every write; see the module note. */
function plantedGh(planted: Planted = {}): PlantedGh {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const bodies = new Map<number, string>(ISSUES.map((issue) => [issue.number, issue.body]));
  const calls: (readonly string[])[] = [];
  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb = '', third = ''] = args;
    const words = args.join(' ');
    if (noun === 'issue' && verb === 'list' && words.includes('--state all')) {
      return planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(LISTING));
    }
    if (noun === 'pr' && verb === 'list' && words.includes('--state open')) return ok('[]');
    if (noun === 'issue' && verb === 'edit') return ok('');
    if (noun === 'issue' && verb === 'close') {
      return (planted.failClose ?? []).includes(Number(third))
        ? failed('HTTP 403: Resource not accessible')
        : ok('');
    }
    const bodyArg = args.find((arg) => arg.startsWith('body='))?.slice('body='.length) ?? '';
    if (noun === 'api' && args.includes('POST')) return ok(JSON.stringify({ id: 1, body: bodyArg, user: { login: 'rafa-bot' } }));
    const issue = issueOfPath(verb);
    if (noun === 'api' && args.includes('PATCH') && bodies.has(issue)) {
      bodies.set(issue, bodyArg);
      return ok(JSON.stringify({ body: bodyArg }));
    }
    if (noun === 'api' && args.length === 2 && bodies.has(issue)) return ok(JSON.stringify({ body: bodies.get(issue) }));
    return failed(`unplanted: gh ${words}`);
  };
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { gh, calls, bodies };
}

/** A `git` holding no branch of any dependent, recording every call. */
function plantedGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'for-each-ref') return { ok: true, stdout: 'refs/heads/main', stderr: '' };
    if (args[0] === 'ls-remote') return { ok: true, stdout: '', stderr: '' };
    return { ok: false, stdout: '', stderr: `unplanted: git ${args.join(' ')}` } satisfies GitResult;
  };
  return { git, calls };
}

/** A prompter answering `answers` in turn, null once they run out, recording every question and line said. */
function scriptedPrompter(answers: readonly (string | null)[]): { open: () => Prompter; asked: string[]; said: string[]; closed: () => number } {
  const asked: string[] = [];
  const said: string[] = [];
  let closes = 0;
  const prompter: Prompter = {
    say: (text) => {
      said.push(text);
    },
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answers[asked.length - 1] ?? null);
    },
    close: () => {
      closes += 1;
    },
  };
  return { open: () => prompter, asked, said, closed: () => closes };
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

/** Dispatches `rafa epic cancel <words>` over a planted `gh`, `git`, clock and terminal. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const planted = plantedGh(setup.planted);
  const git = plantedGit();
  const answers = setup.answers ?? null;
  const prompter = scriptedPrompter(answers ?? []);
  const seams: EpicCancelSeams = {
    gh: planted.gh,
    git: git.git,
    isTerminal: () => answers !== null,
    openPrompter: prompter.open,
    now: () => new Date(2026, 8, 28, 12),
  };
  const commands: RafaCommand[] = [createEpicCancelCommand(seams)];
  const outcome = await dispatchInProject(['epic', 'cancel', ...words], [EPIC_SUBJECT], commands, plantCase());
  return {
    ...outcome,
    calls: planted.calls,
    bodies: planted.bodies,
    gitCalls: git.calls,
    asked: prompter.asked,
    said: prompter.said,
    closes: prompter.closed(),
  };
}

/** The calls that change something on GitHub. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'edit' || call[1] === 'create' || call[1] === 'close'
    || call.includes('POST') || call.includes('PATCH'));
}

/** A comment posted on issue `issue`. */
function commentCall(issue: number, body: string): readonly string[] {
  return ['api', `repos/{owner}/{repo}/issues/${String(issue)}/comments`, '-X', 'POST', '-f', `body=${body}`];
}

/** The body write of issue `issue`. */
function patchCall(issue: number, body: string): readonly string[] {
  return ['api', `repos/{owner}/{repo}/issues/${String(issue)}`, '-X', 'PATCH', '-f', `body=${body}`];
}

/** Issue `issue` closed as not planned with `comment`. */
function closeCall(issue: number, comment: string): readonly string[] {
  return ['issue', 'close', String(issue), '--reason=not planned', `--comment=${comment}`];
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

/** Epic #40's dependents, as the questions name them. */
function dependentOf(number: number) {
  const found = readEpicToCancel(ISSUES, 40).dependents.find((dependent) => dependent.issue.number === number);
  if (found === undefined) throw new Error(`#${String(number)} is no dependent of #40`);
  return found;
}

/** The move of #57 to epic #50 the full case makes. */
const MOVE_57: MembershipChange = { kind: 'move', issue: 57, from: 90, to: 50 };

/** The list the command prints for epic #40. */
const LIST_40 = [
  'Epic #40: 3 issues outside it wait on its open members:',
  '- #57 issue 57, waiting on #12',
  '- #58 issue 58, waiting on #14',
  '- #59 issue 59, waiting on #12',
];

/** The problem line for #63. */
const PROBLEM_63 = 'warn: Not asked about: #63 has a "Blocked by:" line on line 1 naming itself;'
  + ' name them as "Blocked by: #24 #26", or take the spec:blocked label off';

describe('readCancelLine', () => {
  it('reads the epic and the reason, null when left out', () => {
    expect(readCancelLine({ args: ['40'], flags: { reason: 'moved on' } })).toEqual({ epic: 40, reason: 'moved on' });
    expect(readCancelLine({ args: ['40'], flags: {} })).toEqual({ epic: 40, reason: null });
  });

  it('refuses no number, two, one that is no number and a --reason given no value with exit code 1', () => {
    expect(refusalOf(() => readCancelLine({ args: [], flags: {} })).message).toContain('Expected one epic number, got none');
    expect(refusalOf(() => readCancelLine({ args: ['40', '41'], flags: {} })).message).toContain('got 2: 40 41');
    const word = refusalOf(() => readCancelLine({ args: ['#40'], flags: {} }));
    expect(word.exitCode).toBe(1);
    expect(word.message).toContain('"#40" is no epic number');
    expect(word.message).toContain('Usage: rafa epic cancel <n> [--reason="<why>"]');
    expect(refusalOf(() => readCancelLine({ args: ['40'], flags: { reason: true } })).message).toContain('--reason needs a value');
  });
});

describe('readEpicToCancel', () => {
  it('reads the dependents in ascending number, and each unreadable line naming an open member as a problem', () => {
    const target = readEpicToCancel(ISSUES, 40);

    expect(target.closedAlready).toBe(false);
    expect(target.dependents.map(({ issue, waitsOn }) => [issue.number, waitsOn])).toEqual([[57, [12]], [58, [14]], [59, [12]]]);
    expect(target.problems).toEqual([PROBLEM_63.slice('warn: '.length)]);
  });

  it('reads an epic closed as not planned as closed already, with its dependents', () => {
    const target = readEpicToCancel(ISSUES, 70);

    expect(target.closedAlready).toBe(true);
    expect(target.dependents.map(({ issue }) => issue.number)).toEqual([72]);
  });

  it('refuses an issue not on the listing, one that is no epic and an epic closed as completed with exit code 2', () => {
    const absent = refusalOf(() => readEpicToCancel(ISSUES, 99));
    const member = refusalOf(() => readEpicToCancel(ISSUES, 12));
    const done = refusalOf(() => readEpicToCancel(ISSUES, 60));

    expect(absent.message).toContain('#99 is not on the board listing');
    expect(member.message).toContain('#12 is not an epic');
    expect(done.message).toContain('Epic #60 is closed as completed');
    for (const refused of [absent, member, done]) {
      expect(refused.exitCode).toBe(2);
      expect(refused.message).toEndWith('; nothing was changed');
    }
  });
});

describe('readChoiceWord', () => {
  it('reads m, u and c and the words, any case and trimmed, and nothing else', () => {
    expect(['m', ' Move ', 'u', 'UNBLOCK', 'c', 'cancel'].map(readChoiceWord)).toEqual(['move', 'move', 'unblock', 'unblock', 'cancel', 'cancel']);
    expect(['', 'x', 'mv', 'close', 'y'].map(readChoiceWord)).toEqual([null, null, null, null, null]);
  });
});

describe('appendNote', () => {
  it('appends after a blank line in the body\'s own break, keeping every other byte', () => {
    expect(appendNote('Text.\n', 'NOTE')).toBe('Text.\n\nNOTE\n');
    expect(appendNote('Text.', 'NOTE')).toBe('Text.\n\nNOTE');
    expect(appendNote('A.\r\n\r\nB.\r\n', 'NOTE')).toBe('A.\r\n\r\nB.\r\n\r\nNOTE\r\n');
    expect(appendNote('', 'NOTE')).toBe('NOTE');
  });

  it('answers a body carrying the note as it is, so a re-read confirms the edit', () => {
    const once = appendNote('Text.\r\n', 'NOTE');
    expect(appendNote(once, 'NOTE')).toBe(once);
  });
});

describe('rafa epic cancel', () => {
  it('asks about each dependent and applies a move, an unblock and a cancel, then closes the epic', async () => {
    const result = await run(['40', '--reason=sign-in moved to the platform team'], {
      answers: ['maybe', 'm', '40', 'move', '#51', 'M', '#50', 'u', 'c'],
    });
    const note58 = renderUnblockNote(DAY, 40, [14], ['#51']);
    const outcomes: DependentOutcome[] = [
      { issue: 57, answer: { kind: 'moved', to: 50 } },
      { issue: 58, answer: { kind: 'unblocked' } },
      { issue: 59, answer: { kind: 'cancelled' } },
    ];

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([
      dependentQuestion(40, dependentOf(57)),
      dependentQuestion(40, dependentOf(57)),
      targetQuestion(57),
      dependentQuestion(40, dependentOf(57)),
      targetQuestion(57),
      dependentQuestion(40, dependentOf(57)),
      targetQuestion(57),
      dependentQuestion(40, dependentOf(58)),
      dependentQuestion(40, dependentOf(59)),
    ]);
    expect(result.said[0]).toBe(CHOICE_HINT);
    expect(result.said[1]).toBe('Epic #40 is the epic being cancelled; name another.');
    expect(result.said[2]).toStartWith('Cannot move #57 to epic #51: #51 is not an epic');
    expect(result.closes).toBe(1);
    expect(writesOf(result.calls)).toEqual([
      ['issue', 'edit', '57', '--remove-label', 'epic:payments', '--add-label', 'epic:billing'],
      patchCall(50, `${BODY_50}- [ ] #57 checkout\n`),
      patchCall(90, '## Specs\n\n'),
      commentCall(57, renderMoveComment(MOVE_57, cancelMoveReason(40), { branches: [], pullRequests: [] })),
      patchCall(58, `${BODY_58}\r\n${note58}\r\n`),
      commentCall(58, renderDependentComment('unblocked', 40, [14])),
      closeCall(59, renderDependentComment('cancelled', 40, [12])),
      closeCall(40, renderCancelComment('sign-in moved to the platform team', outcomes)),
    ]);
    expect(result.bodies.get(58)).toBe(`${BODY_58}\r\n${note58}\r\n`);
    expect(result.stdout).toBe([
      ...LIST_40,
      PROBLEM_63,
      'Moved #57 from epic #90 to #50.',
      'Unblocked #58: noted below its body that #14 no longer blocks it.',
      '#58 keeps spec:blocked: its line still names #51, not known to be closed.',
      'Closed #59 as not planned.',
      'Closed epic #40 as not planned.',
      '',
    ].join('\n'));
  });

  it('takes spec:blocked off an unblocked dependent whose line names nothing else open', async () => {
    const result = await run(['40'], { answers: ['u', 'u', 'u'] });
    const note57 = renderUnblockNote(DAY, 40, [12], []);
    const note59 = renderUnblockNote(DAY, 40, [12], ['#13']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls).slice(0, 3)).toEqual([
      patchCall(57, `${BODY_57}\n${note57}\n`),
      ['issue', 'edit', '57', '--remove-label', 'spec:blocked'],
      commentCall(57, renderDependentComment('unblocked', 40, [12])),
    ]);
    expect(result.bodies.get(59)).toBe(`Blocked by: #12 #13\n\n${note59}\n`);
    expect(writesOf(result.calls).filter((call) => call.includes('--remove-label') && call[2] !== '57')).toEqual([]);
    expect(result.gitCalls).toEqual([]);
  });

  it('with no terminal and a dependent, prints the list and the questions it would ask and writes nothing, exit 0', async () => {
    const result = await run(['40']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.asked).toEqual([]);
    expect(result.closes).toBe(0);
    expect(result.gitCalls).toEqual([]);
    expect(result.stdout).toBe([...LIST_40, PROBLEM_63, unaskedCancelMessage(40), ''].join('\n'));
  });

  it('writes nothing when the input ends before every dependent is answered', async () => {
    const result = await run(['40'], { answers: ['c', 'u'] });

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.asked).toHaveLength(3);
    expect(result.closes).toBe(1);
    expect(result.stdout).toEndWith(`warn: ${endedCancelMessage(40)}\n`);
  });

  it('closes an epic nothing waits on, with or without a terminal', async () => {
    for (const answers of [null, []]) {
      const result = await run(['80', '--reason=nobody wants it'], { answers });

      expect(result.exitCode).toBe(0);
      expect(result.asked).toEqual([]);
      expect(writesOf(result.calls)).toEqual([closeCall(80, renderCancelComment('nobody wants it', []))]);
      expect(result.stdout).toBe('No issue outside epic #80 waits on its open members.\nClosed epic #80 as not planned.\n');
    }
  });

  it('on an epic closed as not planned already, skips the close and comments what became of each dependent', async () => {
    const result = await run(['70'], { answers: ['c'] });

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([
      closeCall(72, renderDependentComment('cancelled', 70, [71])),
      commentCall(70, renderCancelComment(null, [{ issue: 72, answer: { kind: 'cancelled' } }])),
    ]);
    expect(result.stdout).toEndWith('Epic #70 was closed as not planned already; commented what became of each issue.\n');
  });

  it('writes nothing on an epic closed as not planned already that nothing waits on', async () => {
    const result = await run(['75']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.stdout).toEndWith('Epic #75 was closed as not planned already, so nothing was written on it.\n');
  });

  it('refuses an issue that is no epic, one closed as completed and a board that cannot be read with exit code 2', async () => {
    const member = await run(['12'], { answers: [] });
    const done = await run(['60'], { answers: [] });
    const unread = await run(['40'], { answers: [], planted: { failListing: true } });

    expect(member.stderr).toContain('#12 is not an epic');
    expect(done.stderr).toContain('Epic #60 is closed as completed');
    expect(unread.stderr).toContain('Could not read the board, so nothing was changed');
    for (const result of [member, done, unread]) {
      expect(result.exitCode).toBe(2);
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.asked).toEqual([]);
    }
  });

  it('still closes the epic when a dependent\'s close fails, leaves it out of the comment, and ends with exit code 1', async () => {
    const result = await run(['40'], { answers: ['c', 'c', 'c'], planted: { failClose: [58] } });
    const landed: DependentOutcome[] = [
      { issue: 57, answer: { kind: 'cancelled' } },
      { issue: 59, answer: { kind: 'cancelled' } },
    ];

    expect(result.exitCode).toBe(1);
    expect(writesOf(result.calls).at(-1)).toEqual(closeCall(40, renderCancelComment(null, landed)));
    expect(result.stdout).toContain('warn: Could not close #58 as not planned:');
    expect(result.stderr).toContain('Epic #40 is closed as not planned, but not every write landed; by hand: close #58 as not planned.');
  });

  it('ends with exit code 1 saying the epic is still open when its close fails', async () => {
    const result = await run(['80'], { planted: { failClose: [80] } });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Epic #80 is still open, but not every write landed; by hand: close epic #80 as not planned.');
  });

  it('gives what each write did as the json result', async () => {
    const result = await run(['40', '--output=json'], { answers: ['c', 'c', 'c'] });
    const data = (eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: EpicCancelResult } | undefined)?.data;

    expect(result.exitCode).toBe(0);
    expect(data?.status).toBe('cancelled');
    expect(data?.closedAlready).toBe(false);
    expect(data?.dependents).toEqual([{ issue: 57, waitsOn: [12] }, { issue: 58, waitsOn: [14] }, { issue: 59, waitsOn: [12] }]);
    expect(data?.applied.map(({ issue, answer, landed }) => [issue, answer.kind, landed])).toEqual([
      [57, 'cancelled', true],
      [58, 'cancelled', true],
      [59, 'cancelled', true],
    ]);
    expect(data?.epicWrite).toBe('closed');
    expect(data?.left).toEqual([]);
  });
});

describe('the declaration', () => {
  it('is the cancel action of the epic subject, with <n> and --reason', () => {
    const command = createEpicCancelCommand();

    expect([command.name, command.subject, command.action]).toEqual(['epic cancel', 'epic', 'cancel']);
    expect(command.args?.map((arg) => [arg.name, arg.required])).toEqual([['n', true]]);
    expect(command.flags?.map((flag) => [flag.name, flag.required === true])).toEqual([['reason', false]]);
    expect(command.outputs).toEqual(['text', 'json']);
  });

  it('declares no spends, and its default export is the command made with the system\'s seams', () => {
    expect(cancelCommand.spends).toBeUndefined();
    expect(cancelCommand.name).toBe('epic cancel');
    expect(Object.isFrozen(cancelCommand)).toBe(true);
  });
});
