/**
 * Tests for `rafa epic move` (`move.ts`): the line, the move core's
 * reading and refusals, the lines printed, and the command dispatched
 * over one planted `gh` that keeps the issue bodies it is sent, one
 * planted `git` and a scripted prompter.
 *
 * The board: epic #40 on `epic:auth`, open, whose body lists #12 and #14
 * unticked and #13 ticked between prose lines; its members #12 and #14
 * are open and #13 is closed. Epic #50 on `epic:billing`, open, lists #51
 * under its `Specs` heading. Epic #60 on `epic:old` is closed; epic #70
 * is open and carries no `epic:` label. #61 carries no `epic:` label,
 * #62 carries two, and #63 carries `epic:orphan`, which no epic owns.
 * `git` holds `feat/rafa-12-login` locally and on the remote, and
 * `feat/rafa-14-session` of another member; the open pull requests are
 * #7 (`Closes #12`) and #8, from `feat/rafa-14-session`.
 *
 * The planted `gh` tells its calls apart by their nouns and flags: the
 * listing is `issue list` with `--state all`, the pull request listing
 * `pr list` with `--state open`, a body read `api` with no `-X`, a body
 * write `api` with `PATCH` and a comment `api` with `POST`.
 *
 * ## The controls
 *
 * - The first dispatch sends every write a move sends, so the filter the
 *   refusals assert empty is shown able to find one.
 * - The branch and pull request of #14 sit beside #12's, and the case
 *   naming #12's work asserts the exact list, so a reading naming every
 *   branch fails.
 * - The failed body write is paired with the move that lands, over the
 *   same board, so a run reporting every body `edited` fails one of them.
 *
 * The move is written through the board's relationships port; the
 * `labels` cases here hold that it sends what it sent before the port,
 * and that the json result keeps its keys in their order with no key the
 * `native` mode adds. The `native` cases are `./move-native.test.ts`'s.
 */
import type { EpicMoveResult, EpicMoveSeams } from './move.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { MembershipChange, OpenWork } from '../../board/epic-trail.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { BoardRelations, ParentChange } from '../../board/relations/port.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitResult, GitRunner } from '../../pr/git.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { blankReasonMessage, reasonQuestion, renderMoveComment, unaskedReasonMessage } from '../../board/epic-trail.js';
import { createLabelsRelations } from '../../board/relations/labels.js';
import { parseBoardListing } from '../../board/roadmap-board.js';
import { TICK_ATTEMPTS } from '../../board/roadmap-tick.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import moveCommand, { applyEpicMove, createEpicMoveCommand, moveFailure, readEpicMove, readMoveLine, renderEpicMove } from './move.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-move-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** Epic #40's body: prose around a checklist, #13 ticked. */
const BODY_40 = '## Acceptance criteria\n\n- Sign-in works.\n\n## Specs\n\n- [ ] #12 login form\n- [x] #13 old flow\n- [ ] #14 session\n\nNotes stay.\n';

/** Epic #50's body. */
const BODY_50 = '## Specs\n\n- [ ] #51 invoices\n';

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(number: number, labels: readonly string[], options: { state?: 'OPEN' | 'CLOSED'; body?: string } = {}): object {
  const state = options.state ?? 'OPEN';
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return {
    number,
    title: `issue ${String(number)}`,
    body: options.body ?? '',
    state,
    stateReason,
    labels: labels.map((name) => ({ name })),
  };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(40, ['type:epic', 'epic:auth', 'horizon:now'], { body: BODY_40 }),
  raw(12, ['epic:auth', 'type:feature']),
  raw(13, ['epic:auth'], { state: 'CLOSED' }),
  raw(14, ['epic:auth']),
  raw(50, ['type:epic', 'epic:billing', 'horizon:next'], { body: BODY_50 }),
  raw(51, ['epic:billing']),
  raw(60, ['type:epic', 'epic:old', 'horizon:later'], { state: 'CLOSED' }),
  raw(70, ['type:epic', 'horizon:later']),
  raw(61, ['type:feature']),
  raw(62, ['epic:auth', 'epic:billing']),
  raw(63, ['epic:orphan']),
];

/** The open pull requests. */
const PULLS: readonly object[] = [
  { number: 7, headRefName: 'fix-login', body: 'Closes #12' },
  { number: 8, headRefName: 'feat/rafa-14-session', body: '' },
];

/** #12's open work on the board. */
const WORK_12: OpenWork = { branches: ['feat/rafa-12-login'], pullRequests: [7] };

/** The move of #12 from epic #40 to #50 the cases make. */
const MOVE_12: MembershipChange = { kind: 'move', issue: 12, from: 40, to: 50 };

/** How the planted `gh` answers. */
interface Planted {
  readonly failListing?: boolean;
  readonly failSwap?: boolean;
  readonly failComment?: boolean;
  /** Issues whose body writes fail. */
  readonly failWrite?: readonly number[];
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
  const bodies = new Map<number, string>([[40, BODY_40], [50, BODY_50]]);
  const calls: (readonly string[])[] = [];
  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb = ''] = args;
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
    const bodyArg = args.find((arg) => arg.startsWith('body='))?.slice('body='.length) ?? '';
    if (noun === 'api' && args.includes('POST')) {
      return planted.failComment === true
        ? failed('HTTP 502: Bad Gateway')
        : ok(JSON.stringify({ id: 1, body: bodyArg, user: { login: 'rafa-bot' } }));
    }
    const issue = issueOfPath(verb);
    if (noun === 'api' && args.includes('PATCH') && bodies.has(issue)) {
      if ((planted.failWrite ?? []).includes(issue)) return failed('HTTP 409: Conflict');
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

/** A `git` holding the branches the module note names, recording every call. */
function plantedGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const ok = (lines: readonly string[]): GitResult => ({ ok: true, stdout: lines.join('\n'), stderr: '' });
  const git: GitRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'for-each-ref') {
      return ok(['refs/heads/feat/rafa-12-login', 'refs/remotes/origin/feat/rafa-12-login', 'refs/heads/feat/rafa-14-session', 'refs/heads/main']);
    }
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
  /** Wraps the relationships made over the planted `gh`, handed in as a seam; the config's when left out. */
  readonly relations?: (made: BoardRelations) => BoardRelations;
}

/** A fresh project. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
}

/** Dispatches `rafa epic move <words>` over a planted `gh`, `git` and terminal. */
async function run(words: readonly string[], setup: CaseSetup = {}) {
  const planted = plantedGh(setup.planted);
  const git = plantedGit();
  const answers = setup.answers ?? null;
  const prompter = scriptedPrompter(answers ?? []);
  const seams: EpicMoveSeams = {
    gh: planted.gh,
    git: git.git,
    isTerminal: () => answers !== null,
    openPrompter: prompter.open,
    ...setup.relations === undefined
      ? {}
      : { relations: setup.relations(createLabelsRelations({ gh: planted.gh })) },
  };
  const commands: RafaCommand[] = [createEpicMoveCommand(seams)];
  const outcome = await dispatchInProject(['epic', 'move', ...words], [EPIC_SUBJECT], commands, plantCase());
  return {
    ...outcome,
    calls: planted.calls,
    bodies: planted.bodies,
    gitCalls: git.calls,
    asked: prompter.asked,
    closes: prompter.closed(),
  };
}

/** The calls that change something on GitHub, or would create or close an issue. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'edit' || call[1] === 'create' || call[1] === 'close'
    || call.includes('POST') || call.includes('PATCH'));
}

/** The comment a move posts on its issue. */
function commentCall(issue: number, body: string): readonly string[] {
  return ['api', `repos/{owner}/{repo}/issues/${String(issue)}/comments`, '-X', 'POST', '-f', `body=${body}`];
}

/** The body write of issue `issue`. */
function patchCall(issue: number, body: string): readonly string[] {
  return ['api', `repos/{owner}/{repo}/issues/${String(issue)}`, '-X', 'PATCH', '-f', `body=${body}`];
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

/** The board as the command reads it. */
const ISSUES = parseBoardListing(JSON.stringify(LISTING), 'the planted listing');

/** A `git` and a pull request lister that fail the case when read. */
const UNREAD = {
  git: (): GitResult => {
    throw new Error('git was read');
  },
  pullRequests: (): Promise<never> => Promise.reject(new Error('the pull requests were read')),
};

describe('readMoveLine', () => {
  it('reads the issue, the target and the reason, null when left out', () => {
    expect(readMoveLine({ args: ['12'], flags: { to: '50', reason: 'why' } })).toEqual({ issue: 12, to: 50, reason: 'why' });
    expect(readMoveLine({ args: ['12'], flags: { to: '50' } })).toEqual({ issue: 12, to: 50, reason: null });
  });

  it('refuses no number, two, one that is no number, a missing --to and a --to that is no number with exit code 1', () => {
    expect(refusalOf(() => readMoveLine({ args: [], flags: { to: '50' } })).message).toContain('Expected one issue number, got none');
    expect(refusalOf(() => readMoveLine({ args: ['12', '13'], flags: { to: '50' } })).message).toContain('got 2: 12 13');
    expect(refusalOf(() => readMoveLine({ args: ['#12'], flags: { to: '50' } })).message).toContain('"#12" is no issue number');
    expect(refusalOf(() => readMoveLine({ args: ['12'], flags: {} })).message).toContain('--to is required: --to=<epic>');
    const target = refusalOf(() => readMoveLine({ args: ['12'], flags: { to: 'auth' } }));
    expect(target.exitCode).toBe(1);
    expect(target.message).toContain('"auth" is no epic number');
    expect(target.message).toContain('Usage: rafa epic move <issue> --to=<epic> [--reason="<why>"]');
    expect(refusalOf(() => readMoveLine({ args: ['12'], flags: { to: '50', reason: true } })).message).toContain('--reason needs a value');
  });
});

describe('readEpicMove', () => {
  it('reads the labels to swap, the line that moves and an open issue\'s work', async () => {
    const git = plantedGit();
    const reading = await readEpicMove({ issues: ISSUES, issue: 12, to: 50, git: git.git, pullRequests: () => Promise.resolve(PULLS as never) });

    expect(reading).toEqual({
      change: MOVE_12,
      removed: 'epic:auth',
      added: 'epic:billing',
      line: { why: 'login form', ticked: false },
      work: WORK_12,
      problems: [],
    });
  });

  it('carries a ticked line ticked, and reads no work for a closed issue', async () => {
    const reading = await readEpicMove({ issues: ISSUES, issue: 13, to: 50, ...UNREAD });

    expect(reading).toMatchObject({ line: { why: 'old flow', ticked: true } });
    expect(reading.work).toBeNull();
  });

  it('carries the title when the old body lists no line, and says what could not be read', async () => {
    const failing: GitRunner = () => ({ ok: false, stdout: '', stderr: 'not a git repository' });
    const reading = await readEpicMove({
      issues: ISSUES.map((issue) => (issue.number === 40
        ? { ...issue, body: '' }
        : issue)),
      issue: 12,
      to: 50,
      git: failing,
      pullRequests: () => Promise.reject(new Error('HTTP 502')),
    });

    expect(reading).toMatchObject({ line: { why: 'issue 12', ticked: false } });
    expect(reading.work).toEqual({ branches: [], pullRequests: [] });
    expect(reading.problems.length).toBeGreaterThan(1);
    expect(reading.problems.at(-1)).toContain('the open pull requests could not be read, so none is named: HTTP 502');
  });

  it('refuses each issue and target that cannot move with exit code 2, reading no work', async () => {
    const cases: readonly (readonly [number, number, string])[] = [
      [61, 50, '#61 carries no epic: label, so it is in no epic to move from'],
      [62, 60, '#62 carries epic:auth, epic:billing, so the epic it leaves cannot be read'],
      [99, 50, '#99 is not on the board listing'],
      [40, 50, '#40 is an epic, and an epic belongs to no epic'],
      [12, 51, '#51 is not an epic: it carries no type:epic label'],
      [12, 60, 'Epic #60 is closed, and an issue moves only to an open epic'],
      [12, 98, '#98 is not on the board listing, so it is not an open epic'],
      [12, 70, 'Epic #70 carries no epic: label'],
      [12, 40, '#12 is in epic #40 already: it carries epic:auth'],
      [63, 50, 'No epic owns epic:orphan, the label #63 carries'],
    ];
    for (const [issue, to, message] of cases) {
      let caught: unknown = null;
      try {
        await readEpicMove({ issues: ISSUES, issue, to, ...UNREAD });
      } catch (error) {
        caught = error;
      }
      expect((caught as { exitCode?: unknown } | null)?.exitCode).toBe(2);
      expect((caught as Error).message).toContain(message);
      expect((caught as Error).message).toEndWith('; nothing was changed');
    }
  });

  it('refuses a slug two epics own', async () => {
    const twice = [...ISSUES, { ...ISSUES[0]!, number: 41 }];
    await expect(readEpicMove({ issues: twice, issue: 12, to: 50, ...UNREAD })).rejects
      .toThrow('epic:auth is owned by epics #40, #41, so the epic #12 leaves cannot be read');
  });
});

describe('the lines', () => {
  const edited = { issue: 50, status: 'edited', attempts: 1, problem: '' } as const;
  const moved: EpicMoveResult = {
    status: 'moved',
    issue: 12,
    from: 40,
    to: 50,
    removedLabel: 'epic:auth',
    addedLabel: 'epic:billing',
    reason: 'belongs with billing',
    question: null,
    work: WORK_12,
    outcome: { added: edited, removed: { ...edited, issue: 40, status: 'failed', problem: 'HTTP 409' }, commentProblem: 'HTTP 502' },
    problems: ['the remote could not be read'],
  };

  it('prints the move, each line, the work, a failed comment and each problem, the failures at warn', () => {
    expect(renderEpicMove(moved)).toEqual([
      { text: 'Moved #12 from epic #40 to #50: belongs with billing', warn: false },
      { text: 'Added its line to epic #50\'s checklist.', warn: false },
      { text: 'Could not take its line off epic #40\'s checklist: HTTP 409', warn: true },
      { text: 'Its open work stays as it is: branch feat/rafa-12-login, pull request #7.', warn: false },
      { text: 'Could not comment on #12: HTTP 502', warn: true },
      { text: 'The open work named may be short: the remote could not be read', warn: true },
    ]);
    expect(moveFailure(moved)?.message).toBe('❌ #12 moved to epic #50 (its label is epic:billing), but the rest did not land;'
      + ' by hand: take its line off epic #40\'s checklist; comment the move on #12.');
  });

  it('names a body that needed no edit without failing, and prints the question or the blank warning', () => {
    const quiet: EpicMoveResult = {
      ...moved,
      work: null,
      outcome: { added: { ...edited, status: 'nothing-to-edit' }, removed: { ...edited, issue: 40, status: 'nothing-to-edit' }, commentProblem: '' },
      problems: [],
    };
    const texts = renderEpicMove(quiet).map((line) => line.text);
    expect(texts.slice(1)).toEqual([
      'Epic #50\'s checklist lists it already.',
      'Epic #40\'s checklist did not list it.',
    ]);
    expect(moveFailure(quiet)).toBeNull();

    const question = reasonQuestion(MOVE_12);
    const unasked: EpicMoveResult = { ...quiet, status: 'unasked', reason: null, question, outcome: null };
    expect(renderEpicMove(unasked)).toEqual([{ text: unaskedReasonMessage(question), warn: false }]);
    expect(moveFailure(unasked)).toBeNull();
    expect(renderEpicMove({ ...unasked, status: 'blank', question: null })).toEqual([{ text: blankReasonMessage(), warn: true }]);
  });
});

describe('rafa epic move', () => {
  it('swaps the label, moves the line keeping every other byte, and comments the move naming the open work', async () => {
    const result = await run(['12', '--to=50', '--reason=belongs with billing']);
    const bodies = {
      50: '## Specs\n\n- [ ] #51 invoices\n- [ ] #12 login form\n',
      40: BODY_40.replace('- [ ] #12 login form\n', ''),
    };

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([
      ['issue', 'edit', '12', '--remove-label', 'epic:auth', '--add-label', 'epic:billing'],
      patchCall(50, bodies[50]),
      patchCall(40, bodies[40]),
      commentCall(12, renderMoveComment(MOVE_12, 'belongs with billing', WORK_12)),
    ]);
    expect(result.bodies.get(50)).toBe(bodies[50]);
    expect(result.bodies.get(40)).toBe(bodies[40]);
    expect(result.gitCalls.map((call) => call[0])).toEqual(['for-each-ref', 'ls-remote']);
    expect(result.asked).toEqual([]);
    expect(result.stdout).toBe([
      'Moved #12 from epic #40 to #50: belongs with billing',
      'Added its line to epic #50\'s checklist.',
      'Took its line off epic #40\'s checklist.',
      'Its open work stays as it is: branch feat/rafa-12-login, pull request #7.',
      '',
    ].join('\n'));
  });

  it('moves a closed issue\'s line ticked, reading no work and naming none', async () => {
    const result = await run(['13', '--to=50', '--reason=billing did it']);
    const change: MembershipChange = { ...MOVE_12, issue: 13 };

    expect(result.exitCode).toBe(0);
    expect(result.gitCalls).toEqual([]);
    expect(result.bodies.get(50)).toBe('## Specs\n\n- [ ] #51 invoices\n- [x] #13 old flow\n');
    expect(result.bodies.get(40)).toBe(BODY_40.replace('- [x] #13 old flow\n', ''));
    expect(writesOf(result.calls).at(-1)).toEqual(commentCall(13, renderMoveComment(change, 'billing did it')));
  });

  it('asks the reason once where --reason is left out, and closes the prompter', async () => {
    const result = await run(['12', '--to=50'], { answers: ['  it  bills\nnow '] });

    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([reasonQuestion(MOVE_12)]);
    expect(result.closes).toBe(1);
    expect(writesOf(result.calls).at(-1)).toEqual(commentCall(12, renderMoveComment(MOVE_12, 'it bills now', WORK_12)));
  });

  it('with no terminal and no --reason, writes nothing and prints the question, exit 0', async () => {
    const result = await run(['12', '--to=50']);

    expect(result.exitCode).toBe(0);
    expect(writesOf(result.calls)).toEqual([]);
    expect(result.stdout).toBe(`${unaskedReasonMessage(reasonQuestion(MOVE_12))}\n`);
  });

  it('writes nothing for a blank reason, answered or passed', async () => {
    const answered = await run(['12', '--to=50'], { answers: ['   '] });
    const passed = await run(['12', '--to=50', '--reason=  ']);

    for (const result of [answered, passed]) {
      expect(result.exitCode).toBe(0);
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.stdout).toBe(`warn: ${blankReasonMessage()}\n`);
    }
    expect(passed.asked).toEqual([]);
  });

  it('refuses no epic label, a target that is no open epic and its own epic with exit code 2, asking and writing nothing', async () => {
    const noLabel = await run(['61', '--to=50', '--reason=x'], { answers: [] });
    const closed = await run(['12', '--to=60', '--reason=x'], { answers: [] });
    const notEpic = await run(['12', '--to=51', '--reason=x'], { answers: [] });
    const own = await run(['12', '--to=40'], { answers: ['x'] });

    expect(noLabel.stderr).toContain('#61 carries no epic: label');
    expect(closed.stderr).toContain('Epic #60 is closed');
    expect(notEpic.stderr).toContain('#51 is not an epic');
    expect(own.stderr).toContain('#12 is in epic #40 already');
    for (const result of [noLabel, closed, notEpic, own]) {
      expect(result.exitCode).toBe(2);
      expect(writesOf(result.calls)).toEqual([]);
      expect(result.asked).toEqual([]);
      expect(result.gitCalls).toEqual([]);
    }
  });

  it('refuses a board that cannot be read with exit code 2', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failListing: true } });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Could not read the board, so nothing was changed');
    expect(writesOf(result.calls)).toEqual([]);
  });

  it('refuses a failed swap with exit code 1, editing no body and posting no comment', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failSwap: true } });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not move #12 to epic #50');
    expect(writesOf(result.calls)).toEqual([['issue', 'edit', '12', '--remove-label', 'epic:auth', '--add-label', 'epic:billing']]);
    expect(result.bodies.get(40)).toBe(BODY_40);
  });

  it('still comments when a body write fails, then ends with exit code 1 naming what to finish by hand', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failWrite: [40] } });

    expect(result.exitCode).toBe(1);
    expect(result.bodies.get(40)).toBe(BODY_40);
    expect(result.bodies.get(50)).toContain('- [ ] #12 login form\n');
    expect(writesOf(result.calls).at(-1)).toEqual(commentCall(12, renderMoveComment(MOVE_12, 'x', WORK_12)));
    expect(result.stdout).toContain('warn: Could not take its line off epic #40\'s checklist:');
    expect(result.stderr).toContain('by hand: take its line off epic #40\'s checklist.');
  });

  it('ends with exit code 1 when the comment could not be posted, after the lines moved', async () => {
    const result = await run(['12', '--to=50', '--reason=x'], { planted: { failComment: true } });

    expect(result.exitCode).toBe(1);
    expect(result.bodies.get(40)).toBe(BODY_40.replace('- [ ] #12 login form\n', ''));
    expect(result.stderr).toContain('by hand: comment the move on #12.');
  });

  it('gives the move and what each write did as the json result', async () => {
    const result = await run(['12', '--to=50', '--reason=belongs with billing', '--output=json']);
    const data = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(data?.data).toEqual({
      status: 'moved',
      issue: 12,
      from: 40,
      to: 50,
      removedLabel: 'epic:auth',
      addedLabel: 'epic:billing',
      reason: 'belongs with billing',
      question: null,
      work: WORK_12,
      outcome: {
        added: { issue: 50, status: 'edited', attempts: 1, problem: '' },
        removed: { issue: 40, status: 'edited', attempts: 1, problem: '' },
        commentProblem: '',
      },
      problems: [],
    });
  });
});

describe('rafa epic move through the port in labels mode', () => {
  it('makes the move with the relationships\' setParent over the listing it read, sending the same calls', async () => {
    const asked: ParentChange[] = [];
    let listed = 0;
    const recording = (made: BoardRelations): BoardRelations => ({
      ...made,
      setParent: (listing, change) => {
        asked.push(change);
        listed = listing.length;
        return made.setParent(listing, change);
      },
    });
    const handed = await run(['12', '--to=50', '--reason=belongs with billing'], { relations: recording });
    const configured = await run(['12', '--to=50', '--reason=belongs with billing']);

    expect(asked).toEqual([{ issue: 12, parent: 50 }]);
    expect(listed).toBe(LISTING.length);
    expect(handed.exitCode).toBe(0);
    expect(handed.calls).toEqual(configured.calls);
    expect(handed.stdout).toBe(configured.stdout);
  });

  it('keeps the json result\'s keys in their order, with no relationships key and each edit\'s attempts', async () => {
    const result = await run(['12', '--to=50', '--reason=x', '--output=json']);
    const data = (eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: Record<string, unknown> } | undefined)?.data;
    const outcome = data?.['outcome'] as Record<string, unknown> | undefined;

    expect(Object.keys(data ?? {})).toEqual([
      'issue', 'from', 'to', 'removedLabel', 'addedLabel', 'work', 'problems', 'status', 'reason', 'question', 'outcome',
    ]);
    expect(Object.keys(outcome ?? {})).toEqual(['added', 'removed', 'commentProblem']);
    expect(Object.keys(outcome?.['added'] ?? {})).toEqual(['issue', 'status', 'attempts', 'problem']);
  });

  it('answers each checklist edit as editChecklist did, attempts included, for a body write that failed every one', async () => {
    const planted = plantedGh({ failWrite: [40] });
    const comments: number[] = [];
    const board = { comment: (issue: number) => {
      comments.push(issue);
      return Promise.resolve({ id: '1', body: '', login: null });
    } } as unknown as IssueBoard;
    const reading = await readEpicMove({ issues: ISSUES, issue: 13, to: 50, ...UNREAD });

    const outcome = await applyEpicMove({ board, relations: createLabelsRelations({ gh: planted.gh }), issues: ISSUES }, reading, 'x');

    expect(outcome).toEqual({
      added: { issue: 50, status: 'edited', attempts: 1, problem: '' },
      removed: { issue: 40, status: 'failed', attempts: TICK_ATTEMPTS, problem: expect.stringContaining('HTTP 409: Conflict') as unknown as string },
      commentProblem: '',
    });
    expect(comments).toEqual([13]);
  });
});

describe('the declaration', () => {
  it('is the move action of the epic subject, with <issue>, a required --to and --reason', () => {
    const command = createEpicMoveCommand();

    expect([command.name, command.subject, command.action]).toEqual(['epic move', 'epic', 'move']);
    expect(command.args?.map((arg) => [arg.name, arg.required])).toEqual([['issue', true]]);
    expect(command.flags?.map((flag) => [flag.name, flag.required === true])).toEqual([['to', true], ['reason', false]]);
    expect(command.outputs).toEqual(['text', 'json']);
  });

  it('declares no spends, and its default export is the command made with the system\'s seams', () => {
    expect(moveCommand.spends).toBeUndefined();
    expect(moveCommand.name).toBe('epic move');
    expect(Object.isFrozen(moveCommand)).toBe(true);
  });
});
