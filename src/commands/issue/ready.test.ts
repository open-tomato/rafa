/**
 * Tests for `rafa issue ready` (`ready.ts`): the two readings it
 * prints, the order they run in, the question it puts, the one label
 * swap, the run without a terminal, and the line refusals.
 *
 * Every case drives a fake of its own — a recorded `gh` runner, a
 * scripted answer, a recording board — so no case reaches GitHub,
 * spawns `gh` or `git`, or waits on an answer. The argument lists are
 * kept, which is how the cases about a permission lookup hold that one
 * was or was not spent and the cases about the write hold that nothing
 * was written.
 *
 * ## The controls
 *
 * Five readings here could pass while wrong, and each is paired:
 *
 *  - The swap case runs one issue twice, answering the question yes and
 *    then no, and holds the write against no write. Without the pair, a
 *    run that labelled whatever was answered would look correct on the
 *    first half alone.
 *  - The trust refusal runs the same body under an outsider and under a
 *    write-holder, so "nothing was asked and nothing was written" is
 *    held against the run that asks and writes.
 *  - The ordering case gives an outsider an INCOMPLETE body and holds
 *    that the sentence is the trust one, paired with the same body
 *    under a write-holder, which is refused for its gaps. A run that
 *    checked the body first would name a heading off a body nobody
 *    trusts.
 *  - The allow-list case plants a lookup that answers a FAILURE, so a
 *    run that spent one for a listed login would be refused rather than
 *    passed; it is paired with the same login taken off the list, which
 *    does spend the lookup and is refused by it.
 *  - The dispatched no-terminal case holds that no prompter was opened
 *    and no `gh issue edit` was sent, against the dispatched case above
 *    it, which opens one and sends one over the same planted board.
 */
import type { ReadyAsk } from './ready.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { SpecIssue, SpecIssueReader } from '../../board/issue.js';
import type { BoardTrust } from '../../board/trust.js';
import type { GitRunner } from '../../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { SPEC_LABEL } from '../../board/issue.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import {
  completeLine,
  createIssueReadyCommand,
  READY_USAGE,
  readyQuestion,
  runIssueReady,
  trustPassLine,
} from './ready.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-ready-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The repository a trust sentence names, as `origin` normalises. */
const REPO = 'github.com/open-tomato/rafa';

/** The remote the `git` fake answers, which normalises to {@link REPO}. */
const ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** A body filling every template heading, so the completeness check passes. */
const COMPLETE = completeSpecBody('Issue 57');

/** A body filling none of them, so the completeness check refuses. */
const THIN = 'Make the thing work.\n';

/** One issue as a case plants it. */
interface PlantedIssue {
  readonly number?: number;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly author?: string;
}

/** A reader answering one planted issue, and the numbers it was asked for. */
function fakeReader(issue: PlantedIssue = {}): { read: SpecIssueReader; asked: () => readonly number[] } {
  const asked: number[] = [];
  const read: SpecIssueReader = (number) => {
    asked.push(number);
    const found: SpecIssue = {
      number: issue.number ?? number,
      title: `Issue ${String(number)}`,
      body: issue.body ?? COMPLETE,
      state: 'OPEN',
      labels: issue.labels ?? [SPEC_LABEL],
      author: issue.author ?? 'maintainer',
    };
    return Promise.resolve(found);
  };
  return { read, asked: () => asked };
}

/** What a case's permission lookup answers for a login. */
interface FakePermission {
  readonly permission?: string | null;
  readonly roleName?: string | null;
  /** What went wrong, when the lookup failed. */
  readonly detail?: string;
}

/** A trust over a planted permission answer, and the logins it was asked about. */
function fakeTrust(
  answer: FakePermission = { permission: 'admin' },
  trustedAuthors: readonly string[] = [],
): { trust: BoardTrust; lookups: () => readonly string[] } {
  const lookups: string[] = [];
  const trust: BoardTrust = {
    permissions: (login) => {
      lookups.push(login);
      return Promise.resolve({
        login,
        permission: answer.permission ?? null,
        roleName: answer.roleName ?? null,
        detail: answer.detail ?? '',
      });
    },
    trustedAuthors,
    repo: REPO,
  };
  return { trust, lookups: () => lookups };
}

/** An answer to the question, recording what was asked. */
function scriptedAsk(answer: boolean): { ask: ReadyAsk; asked: () => readonly string[] } {
  const asked: string[] = [];
  const ask: ReadyAsk = (question) => {
    asked.push(question);
    return Promise.resolve(answer);
  };
  return { ask, asked: () => asked };
}

/** A board recording its swaps, which rejects them when `refuseWith` is given. */
function recordingBoard(refuseWith?: string): { board: IssueBoard; swapped: () => readonly string[] } {
  const swapped: string[] = [];
  const unreached = (): never => {
    throw new Error('the ready run reached a board member it has no business with');
  };
  const board: IssueBoard = {
    comments: unreached,
    comment: unreached,
    editComment: unreached,
    removeLabel: unreached,
    swapLabels: (issue: number, removed: string, added: string): Promise<void> => {
      if (refuseWith !== undefined) return Promise.reject(new Error(refuseWith));
      swapped.push(`#${String(issue)} -${removed} +${added}`);
      return Promise.resolve();
    },
  };
  return { board, swapped: () => swapped };
}

/** A runner that fails every command, so a case holds that none was sent. */
function unusedGh(): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

describe('the question and the two readings it follows', () => {
  it('spells the question the spec spells', () => {
    expect(readyQuestion(57)).toBe('Mark #57 spec:ready? [y/N] ');
  });

  it('names the repository for a login a lookup trusted, and the config key for a listed one', () => {
    const looked = trustPassLine(57, REPO, {
      login: 'maintainer',
      trusted: true,
      source: 'permission',
      refusal: null,
      permission: { login: 'maintainer', permission: 'admin', roleName: null, detail: '' },
    });
    const listed = trustPassLine(57, REPO, {
      login: 'dependabot[bot]',
      trusted: true,
      source: 'allow-list',
      refusal: null,
      permission: null,
    });

    expect(looked).toBe(`#57 was opened by maintainer, who has write access to ${REPO}`);
    expect(listed).toBe('#57 was opened by dependabot[bot], listed in board.trustedAuthors');
  });

  it('refuses to spell a pass for a reading that is no pass', () => {
    expect(() => trustPassLine(57, REPO, {
      login: 'outsider',
      trusted: false,
      source: null,
      refusal: 'no-write-access',
      permission: { login: 'outsider', permission: 'read', roleName: null, detail: '' },
    })).toThrow('outsider is not trusted');
  });

  it('says what a body with no gap carries', () => {
    expect(completeLine(57)).toBe('#57 fills every heading the spec template asks for, with no placeholder left');
  });
});

describe('an issue that checks out', () => {
  it('asks the question and swaps the labels on a yes', async () => {
    const gh = unusedGh();
    const reader = fakeReader();
    const trust = fakeTrust();
    const ask = scriptedAsk(true);
    const board = recordingBoard();

    const report = await runIssueReady({
      gh: gh.run,
      issue: 57,
      trust: trust.trust,
      ask: ask.ask,
      board: board.board,
      readIssue: reader.read,
    });

    expect(ask.asked()).toEqual(['Mark #57 spec:ready? [y/N] ']);
    expect(board.swapped()).toEqual(['#57 -spec:needs-work +spec:ready']);
    expect(report).toEqual({
      issue: 57,
      status: 'marked',
      author: 'maintainer',
      trustedBy: 'permission',
      trust: `#57 was opened by maintainer, who has write access to ${REPO}`,
      checked: '#57 fills every heading the spec template asks for, with no placeholder left',
      message: 'Marked #57 spec:ready, and took spec:needs-work off it',
    });
    expect(gh.calls()).toEqual([]);
  });

  it('writes nothing when the same issue is answered no', async () => {
    const reader = fakeReader();
    const ask = scriptedAsk(false);
    const board = recordingBoard();

    const report = await runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: ask.ask,
      board: board.board,
      readIssue: reader.read,
    });

    expect(ask.asked()).toHaveLength(1);
    expect(board.swapped()).toEqual([]);
    expect(report).toMatchObject({ status: 'declined', message: '#57 was left unmarked' });
  });

  it('asks nothing and writes nothing with no terminal, naming the command to run', async () => {
    const board = recordingBoard();

    const report = await runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: null,
      board: board.board,
      readIssue: fakeReader().read,
    });

    expect(board.swapped()).toEqual([]);
    expect(report).toMatchObject({ status: 'unasked' });
    expect(report.message).toBe('#57 is ready to mark; there is no terminal to ask on, so spec:ready was not added.'
      + ' Run rafa issue ready 57 where an answer can be typed');
    expect(report.trust).toBe(`#57 was opened by maintainer, who has write access to ${REPO}`);
  });

  it('asks nothing for an issue that already carries the label', async () => {
    const reader = fakeReader({ labels: [SPEC_LABEL, SPEC_READY_LABEL] });
    const ask = scriptedAsk(true);
    const board = recordingBoard();

    const report = await runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: ask.ask,
      board: board.board,
      readIssue: reader.read,
    });

    expect([ask.asked(), board.swapped()]).toEqual([[], []]);
    expect(report).toMatchObject({ status: 'already', message: '#57 is already marked spec:ready' });
  });

  it('refuses a swap gh refused, naming what it said, and reports nothing as marked', async () => {
    const board = recordingBoard('board issue: gh issue edit 57 failed: label not found');

    const exit = await refusal(() => runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: scriptedAsk(true).ask,
      board: board.board,
      readIssue: fakeReader().read,
    }));

    expect(exit.exitCode).toBe(1);
    expect(exit.message).toBe('❌ spec:ready could not be put on #57:'
      + ' board issue: gh issue edit 57 failed: label not found');
  });
});

describe('the author check, which runs first', () => {
  it('refuses an outsider before the question, and the same issue passes for a write-holder', async () => {
    const outsider = fakeTrust({ permission: 'read' });
    const holder = fakeTrust({ permission: 'write' });
    const ask = scriptedAsk(true);
    const board = recordingBoard();
    const options = { gh: unusedGh().run, issue: 57, board: board.board, readIssue: fakeReader().read };

    const exit = await refusal(() => runIssueReady({ ...options, trust: outsider.trust, ask: ask.ask }));
    const passed = await runIssueReady({ ...options, trust: holder.trust, ask: ask.ask });

    expect(exit.exitCode).toBe(2);
    expect(exit.message).toBe(`issue #57 was opened by maintainer, who has no write access to ${REPO};`
      + ' a member must open the spec');
    expect(ask.asked()).toEqual(['Mark #57 spec:ready? [y/N] ']);
    expect(board.swapped()).toEqual(['#57 -spec:needs-work +spec:ready']);
    expect(passed.status).toBe('marked');
  });

  it('refuses a lookup that failed with its own sentence', async () => {
    const trust = fakeTrust({ detail: 'gh api repos/{owner}/{repo}/collaborators/maintainer/permission failed: 404' });

    const exit = await refusal(() => runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: trust.trust,
      ask: scriptedAsk(true).ask,
      board: recordingBoard().board,
      readIssue: fakeReader().read,
    }));

    expect(exit.exitCode).toBe(2);
    expect(exit.message).toContain('whose write access to github.com/open-tomato/rafa could not be read');
    expect(exit.message).toContain('404');
  });

  it('spends no lookup for a listed login, and spends one for the same login off the list', async () => {
    const listed = fakeTrust({ detail: 'the lookup must not be spent' }, ['dependabot[bot]']);
    const unlisted = fakeTrust({ detail: 'the lookup must not be spent' });
    const reader = fakeReader({ author: 'dependabot[bot]' });
    const options = { gh: unusedGh().run, issue: 57, ask: null, board: recordingBoard().board, readIssue: reader.read };

    const passed = await runIssueReady({ ...options, trust: listed.trust });
    const exit = await refusal(() => runIssueReady({ ...options, trust: unlisted.trust }));

    expect(listed.lookups()).toEqual([]);
    expect(passed).toMatchObject({
      status: 'unasked',
      trustedBy: 'allow-list',
      trust: '#57 was opened by dependabot[bot], listed in board.trustedAuthors',
    });
    expect(unlisted.lookups()).toEqual(['dependabot[bot]']);
    expect(exit.exitCode).toBe(2);
  });

  it('refuses an outsider for the author before the body, and the same body for its gaps', async () => {
    const reader = fakeReader({ body: THIN });
    const ask = scriptedAsk(true);
    const options = { gh: unusedGh().run, issue: 57, ask: ask.ask, board: recordingBoard().board, readIssue: reader.read };

    const untrusted = await refusal(() => runIssueReady({ ...options, trust: fakeTrust({ permission: 'read' }).trust }));
    const thin = await refusal(() => runIssueReady({ ...options, trust: fakeTrust().trust }));

    expect(untrusted.message).toContain('has no write access');
    expect(untrusted.message).not.toContain('is missing');
    expect(thin.message).toContain('issue #57 is not ready to plan from:');
    expect(thin.message).toContain('is missing');
    expect(ask.asked()).toEqual([]);
  });
});

describe('the completeness check', () => {
  it('names every gap, asks nothing and writes nothing', async () => {
    const ask = scriptedAsk(true);
    const board = recordingBoard();

    const exit = await refusal(() => runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: ask.ask,
      board: board.board,
      readIssue: fakeReader({ body: THIN }).read,
    }));

    expect(exit.exitCode).toBe(2);
    expect(exit.message).toContain('"Tasks the plan must carry" is missing');
    expect([ask.asked(), board.swapped()]).toEqual([[], []]);
  });

  it('refuses a labelled issue whose body has gaps rather than calling it already marked', async () => {
    const reader = fakeReader({ body: THIN, labels: [SPEC_LABEL, SPEC_READY_LABEL] });

    const exit = await refusal(() => runIssueReady({
      gh: unusedGh().run,
      issue: 57,
      trust: fakeTrust().trust,
      ask: null,
      board: recordingBoard().board,
      readIssue: reader.read,
    }));

    expect(exit.exitCode).toBe(2);
    expect(exit.message).toContain('is not ready to plan from');
  });
});

/** What a dispatched case's board answers. */
interface FakeBoard {
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly author?: string;
  readonly permission?: string;
  /** What `gh issue edit` answers instead. */
  readonly editResult?: GhResult;
}

/** A runner over one planted issue and one planted permission, and the commands it was handed. */
function dispatchedGh(board: FakeBoard = {}): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const run: GhRunner = (args) => {
    calls.push(args);
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      return ok(JSON.stringify({
        number: Number(args[2]),
        title: 'Issue 57',
        body: board.body ?? COMPLETE,
        state: 'OPEN',
        labels: (board.labels ?? [SPEC_LABEL]).map((name) => ({ name })),
        author: { login: board.author ?? 'maintainer' },
      }));
    }
    if (route === 'issue edit') {
      return board.editResult === undefined
        ? ok('')
        : Promise.resolve(board.editResult);
    }
    if (args[0] === 'api') {
      return ok(JSON.stringify({ permission: board.permission ?? 'admin', role_name: board.permission ?? 'admin' }));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** A `git` answering `origin`, so the repository label is {@link REPO}. */
const fakeGit: GitRunner = (args) => (args.join(' ') === 'remote get-url origin'
  ? { ok: true, stdout: `${ORIGIN}\n`, stderr: '' }
  : { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });

describe('rafa issue ready, dispatched', () => {
  /** A project of this file's own, one per case. */
  const plant = (): ReturnType<typeof plantProject> => plantProject(mkdtempSync(join(tempBase, 'case-')));

  it('asks through the prompter, sends one gh issue edit and prints the three lines', async () => {
    const gh = dispatchedGh();
    const asked: string[] = [];
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: () => ({
        say: () => undefined,
        ask: (question) => {
          asked.push(question);
          return Promise.resolve('y');
        },
        close: () => undefined,
      }),
    });

    const outcome = await dispatchInProject(['issue', 'ready', '57'], SUBJECTS, [command], plant());

    expect(asked).toEqual(['Mark #57 spec:ready? [y/N] ']);
    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `#57 was opened by maintainer, who has write access to ${REPO}\n`
        + '#57 fills every heading the spec template asks for, with no placeholder left\n'
        + 'Marked #57 spec:ready, and took spec:needs-work off it\n',
      stderr: '',
    });
    expect(gh.calls().at(-1)).toEqual([
      'issue', 'edit', '57', '--remove-label', SPEC_NEEDS_WORK_LABEL, '--add-label', SPEC_READY_LABEL,
    ]);
  });

  it('opens no prompter and sends no edit where standard input is no terminal', async () => {
    const gh = dispatchedGh();
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => false,
      openPrompter: () => {
        throw new Error('the run opened a prompter where there is no terminal');
      },
    });

    const outcome = await dispatchInProject(['issue', 'ready', '57'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('there is no terminal to ask on, so spec:ready was not added');
    expect(gh.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['issue view', 'api repos/{owner}/{repo}/collaborators/maintainer/permission']);
  });

  it('refuses an issue an outsider opened with exit 2, opening no prompter', async () => {
    const gh = dispatchedGh({ permission: 'read', author: 'outsider' });
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: () => {
        throw new Error('the run opened a prompter for an issue it refuses');
      },
    });

    const outcome = await dispatchInProject(['issue', 'ready', '57'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toBe(`issue #57 was opened by outsider, who has no write access to ${REPO};`
      + ' a member must open the spec\n');
    expect(outcome.stdout).toBe('');
  });

  it('refuses a body with gaps with exit 2, naming them and sending no edit', async () => {
    const gh = dispatchedGh({ body: THIN });
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: () => {
        throw new Error('the run opened a prompter for a body it refuses');
      },
    });

    const outcome = await dispatchInProject(['issue', 'ready', '57'], SUBJECTS, [command], plant());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('issue #57 is not ready to plan from:');
    expect(gh.calls().some((args) => args[0] === 'issue' && args[1] === 'edit')).toBe(false);
  });

  it('gives the report as the data of the one result event in json mode', async () => {
    const gh = dispatchedGh();
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: () => ({
        say: () => undefined,
        ask: () => Promise.resolve('n'),
        close: () => undefined,
      }),
    });

    const outcome = await dispatchInProject(['issue', 'ready', '57', '--output=json'], SUBJECTS, [command], plant());
    const results = eventsOf(outcome.stdout).filter((event) => event.type === 'result');

    expect(outcome.exitCode).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toMatchObject({
      issue: 57,
      status: 'declined',
      author: 'maintainer',
      trustedBy: 'permission',
    });
  });

  it('refuses a line naming no issue, a second word and a word that is no number, sending no command', async () => {
    const gh = dispatchedGh();
    const command = createIssueReadyCommand({
      openGh: () => gh.run,
      openGit: () => fakeGit,
      isTerminal: () => false,
    });
    const project = plant();

    const none = await dispatchInProject(['issue', 'ready'], SUBJECTS, [command], project);
    const two = await dispatchInProject(['issue', 'ready', '57', '58'], SUBJECTS, [command], project);
    const word = await dispatchInProject(['issue', 'ready', 'next'], SUBJECTS, [command], project);

    expect([none.exitCode, two.exitCode, word.exitCode]).toEqual([1, 1, 1]);
    expect(none.stderr).toBe(`❌ Name the issue number to mark ready\nUsage: ${READY_USAGE}\n`);
    expect(two.stderr).toContain('Expected one issue number, got 2: 57 58');
    expect(word.stderr).toContain('"next" is no issue number');
    expect(gh.calls()).toEqual([]);
  });
});
