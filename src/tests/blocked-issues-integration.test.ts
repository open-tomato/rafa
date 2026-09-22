/**
 * An integration suite over the blocked-issue seam end to end: the
 * `Blocked by:` line (`board/blocked.ts`), the removal-only label write
 * (`board/issue-board.ts`), the listings and the question
 * (`commands/issue/unblock.ts`), and the door a merge reaches the same
 * reading through (`commands/pr/merge-unblock.ts`, `commands/pr/merge.ts`).
 *
 * Every file above drives its own module against a fake board shaped for
 * that module alone, several of them passing a stub `IssueBoard` in place
 * of `board/issue-board.ts`'s real one. This file drives ONE shared
 * board — a literal table of issues, read through the SAME `gh` fake
 * builder in every case — through the two doors an operator actually
 * uses: the dispatched `rafa issue unblock` command and the dispatched
 * `rafa pr merge` command, neither handed a stub `IssueBoard` or a stub
 * `SpecIssueReader`. So the seam this exists for is the one no file
 * above reaches alone: whether the label `board/issue-board.ts` actually
 * removes is the label `board/blocked.ts` actually read off the body
 * `commands/issue/unblock.ts` actually listed, and whether the merge
 * door asks the very question `rafa issue unblock` would have asked over
 * the same board.
 *
 * One board, four scenarios:
 *
 *  - #12, blocked by #A alone: waits while #A is open and is offered for
 *    removal once #A closes — the SAME command dispatched twice, once
 *    per board, which is the pair that tells "it waited" apart from "it
 *    always waits".
 *  - #13, blocked by #A and #C: once #A closes it still carries the
 *    label, because #C stays open, and the message names #C — read over
 *    the identical closed board #12 clears against, which is the pair
 *    that tells "the run reads each blocker" apart from "the run clears
 *    everything once anything closes".
 *  - `rafa issue unblock --all`, walking #12, #13 and #14 in one run
 *    once #A has closed: removed, waiting and waiting, in the board's
 *    own order, over the same three issues the first two scenarios read
 *    one at a time.
 *  - `rafa pr merge`, over a pull request whose body closes #A: the same
 *    #12 question, asked as the last thing the run does, over a real
 *    provider double and a real git double rather than the reading
 *    called directly — and #13 read too, since its line names #A as
 *    well, reported rather than asked about because #C is still open.
 *
 * No case here reaches GitHub, git or a real terminal: `gh` is one fake
 * runner per case, built from {@link sharedBoard} every time, and the
 * question is answered by a scripted prompter recording what it was
 * asked.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { ChecksReading, GitRunner, MergeOutcome, PullRequestDetail } from '../pr/index.js';
import type { Prompter } from '../project/root-choice.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { createIssueUnblockCommand } from '../commands/issue/unblock.js';
import { createPrMergeCommand } from '../commands/pr/merge.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { dispatchInProject, plantProject } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-blocked-issues-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subjects the dispatched commands route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }, { name: 'pr', summary: 'pull requests' }];

/** #A: the issue every scenario closes, clearing #12's only blocker. */
const A = 20;

/** #C: the issue every scenario leaves open, the blocker #13 and #14 keep. */
const C = 26;

/** The roadmap issue the merge scenario configures, so its tick sends two clean calls rather than a search. */
const ROADMAP_ISSUE = 31;

/** A config naming the GitHub CLI and the roadmap issue, for the merge scenario alone. */
const ROADMAP_CONFIG = `pr:\n  provider: gh\nroadmap:\n  issue: ${String(ROADMAP_ISSUE)}\n`;

/** One issue on the shared board. */
interface BoardIssue {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly state?: 'OPEN' | 'CLOSED';
}

/**
 * The board every scenario in this file reads: #12 waits on #A alone,
 * #13 and #14 also wait on #C, and #C never closes. `aClosed` is the one
 * thing a case changes between two calls, the way a real board changes
 * the moment a merge closes #A.
 */
function sharedBoard(aClosed: boolean): Readonly<Record<string, BoardIssue>> {
  return {
    12: { labels: [SPEC_BLOCKED_LABEL], body: `Blocked by: #${String(A)}\n` },
    13: { labels: [SPEC_BLOCKED_LABEL], body: `Blocked by: #${String(A)} #${String(C)}\n` },
    14: { labels: [SPEC_BLOCKED_LABEL], body: `Blocked by: #${String(C)}\n` },
    [A]: { state: aClosed
      ? 'CLOSED'
      : 'OPEN' },
    [C]: { state: 'OPEN' },
  };
}

/** An issue as the board holds it, every field filled in. */
interface HeldIssue {
  readonly number: number;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly string[];
}

/** `board`, with every optional field filled in, in the board's own (ascending, numeric-key) order. */
function heldIssues(board: Readonly<Record<string, BoardIssue>>): readonly HeldIssue[] {
  return Object.entries(board).map(([number, issue]) => ({
    number: Number(number),
    body: issue.body ?? '',
    state: issue.state ?? 'OPEN',
    labels: issue.labels ?? [],
  }));
}

/**
 * A `gh` runner over `board`, answering every command the two dispatched
 * commands in this file send: `issue view` for a line naming one issue,
 * the two `issue list` readings `runUnblock` sends, `issue edit` for the
 * one removal, and the roadmap's two `gh api …/issues/<n>` calls the
 * merge scenario alone reaches. Every other command is refused. Records
 * every argument list it is handed and every removal, so a case holds
 * what actually went through `board/issue-board.ts` rather than a
 * stub's own bookkeeping.
 */
function fakeGh(board: Readonly<Record<string, BoardIssue>>): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
  removed: () => readonly string[];
} {
  const calls: (readonly string[])[] = [];
  const removed: string[] = [];
  const held = heldIssues(board);
  let roadmapBody = `- [ ] #${String(A)} the change this suite plants\n`;
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const run: GhRunner = (args) => {
    calls.push(args);
    // The roadmap tick's own path, `repos/{owner}/{repo}/issues/<n>`
    // (`board/roadmap-tick.ts`), sent with no `issue` or `--label`/`all`
    // word of its own; matched last, as `merge.test.ts`'s combined fake
    // matches it, so it never shadows the routes below.
    if (args[0]?.startsWith('repos/') === true) {
      const sent = args.find((arg) => arg.startsWith('body='));
      if (sent !== undefined) roadmapBody = sent.slice('body='.length);
      return ok(JSON.stringify({ number: ROADMAP_ISSUE, body: roadmapBody }));
    }
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      const found = held.find((issue) => String(issue.number) === args[2]);
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no issue ${args[2] ?? ''}` });
      return ok(JSON.stringify({
        number: found.number,
        title: `Issue ${String(found.number)}`,
        body: found.body,
        state: found.state,
        labels: found.labels.map((name) => ({ name })),
        author: { login: 'maintainer' },
      }));
    }
    if (route === 'issue edit') {
      removed.push(`#${args[2] ?? ''} ${args[4] ?? ''}`);
      return ok('');
    }
    if (args.includes('--label')) {
      const blocked = held.filter((issue) => issue.state === 'OPEN' && issue.labels.includes(SPEC_BLOCKED_LABEL));
      return ok(JSON.stringify(blocked.map((issue) => ({ number: issue.number, body: issue.body }))));
    }
    if (args.includes('all')) return ok(JSON.stringify(held.map((issue) => ({ number: issue.number, state: issue.state }))));
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls, removed: () => [...removed] };
}

/** A prompter answering each question with `answers` in turn, then declining, recording what it was asked. */
function scriptedPrompter(answers: readonly string[]): { open: () => Prompter; asked: () => readonly string[] } {
  const asked: string[] = [];
  const queue = [...answers];
  return {
    open: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(queue.shift() ?? 'n');
      },
      close: () => undefined,
    }),
    asked: () => [...asked],
  };
}

/** A project of this case's own, under this file's own temporary directory. */
function freshProject(config?: string): ReturnType<typeof plantProject> {
  const scope = mkdtempSync(join(tempBase, 'case-'));
  return config === undefined
    ? plantProject(scope)
    : plantProject(scope, config);
}

/** The question `unblockQuestion` spells for #12, blocked by #A alone. */
function twelveQuestion(): string {
  return `#12 was blocked by #${String(A)}, all closed. Remove ${SPEC_BLOCKED_LABEL}? [y/N] `;
}

/**
 * Typed by every case here, so that no case composes the real sources
 * for the ending hint and spawns `git` and `gh` in the scratch project
 * it planted. The ending itself is driven in the command's own suite.
 */
const NO_HINT = '--no-hint';

describe('a Blocked by: #A issue, unblocked once #A closes', () => {
  it('waits while #A is open, and is offered for removal once #A closes, over the real board', async () => {
    const waiting = fakeGh(sharedBoard(false));
    const waitingPrompter = scriptedPrompter([]);
    const waitingCommand = createIssueUnblockCommand({
      openGh: () => waiting.run,
      isTerminal: () => true,
      openPrompter: waitingPrompter.open,
    });

    const before = await dispatchInProject(['issue', 'unblock', '12'], SUBJECTS, [waitingCommand], freshProject());

    expect(before.exitCode).toBe(0);
    expect(before.stdout).toBe(`#12 is blocked by #${String(A)} (open), so ${SPEC_BLOCKED_LABEL} stays\n`);
    expect(waitingPrompter.asked()).toEqual([]);
    expect(waiting.removed()).toEqual([]);

    const closed = fakeGh(sharedBoard(true));
    const closedPrompter = scriptedPrompter(['y']);
    const closedCommand = createIssueUnblockCommand({
      openGh: () => closed.run,
      isTerminal: () => true,
      openPrompter: closedPrompter.open,
    });

    const after = await dispatchInProject(['issue', 'unblock', '12'], SUBJECTS, [closedCommand], freshProject());

    expect(after.exitCode).toBe(0);
    expect(after.stdout).toBe(`Removed ${SPEC_BLOCKED_LABEL} from #12\n`);
    expect(closedPrompter.asked()).toEqual([twelveQuestion()]);
    expect(closed.removed()).toEqual([`#12 ${SPEC_BLOCKED_LABEL}`]);
  });
});

describe('one also blocked by an open #C', () => {
  it('keeps its label once #A closes, naming #C, and asks nothing', async () => {
    const gh = fakeGh(sharedBoard(true));
    const prompter = scriptedPrompter(['y']);
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => true, openPrompter: prompter.open });

    const outcome = await dispatchInProject(['issue', 'unblock', '13'], SUBJECTS, [command], freshProject());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`#13 is blocked by #${String(C)} (open), so ${SPEC_BLOCKED_LABEL} stays\n`);
    expect(prompter.asked()).toEqual([]);
    expect(gh.removed()).toEqual([]);
  });
});

describe('--all, over several issues', () => {
  it('walks #12, #13 and #14 in one run, clearing the one whose only blocker has closed', async () => {
    const gh = fakeGh(sharedBoard(true));
    const prompter = scriptedPrompter(['y']);
    const command = createIssueUnblockCommand({ openGh: () => gh.run, isTerminal: () => true, openPrompter: prompter.open });

    const outcome = await dispatchInProject(['issue', 'unblock', '--all'], SUBJECTS, [command], freshProject());
    const lines = outcome.stdout.split('\n').filter((line) => line !== '');

    expect(outcome.exitCode).toBe(0);
    expect(lines).toEqual([
      `Removed ${SPEC_BLOCKED_LABEL} from #12`,
      `#13 is blocked by #${String(C)} (open), so ${SPEC_BLOCKED_LABEL} stays`,
      `#14 is blocked by #${String(C)} (open), so ${SPEC_BLOCKED_LABEL} stays`,
    ]);
    expect(prompter.asked()).toEqual([twelveQuestion()]);
    expect(gh.removed()).toEqual([`#12 ${SPEC_BLOCKED_LABEL}`]);
  });
});

describe('the question asked at the end of a merge that closes #A', () => {
  /** The head branch of the merge scenario's pull request. */
  const BRANCH = 'feat/rafa-63-blocked-issues';

  /** The base branch of the merge scenario's pull request. */
  const BASE = 'main';

  /** An `origin` on github.com, in the spelling git writes for an SSH remote. */
  const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

  /** The pull request the merge scenario merges: green, mergeable, closing #A. */
  function pullDetail(): PullRequestDetail {
    return {
      number: 41,
      title: 'rafa-63: unblock issues waiting on #A',
      url: 'https://github.com/open-tomato/rafa/pull/41',
      state: 'open',
      headRefName: BRANCH,
      baseRefName: BASE,
      author: { login: 'octo', isBot: false },
      isCrossRepository: false,
      updatedAt: '2026-09-21T09:00:00Z',
      body: `Closes #${String(A)}`,
      headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
      mergeable: 'mergeable',
      mergeStateStatus: 'CLEAN',
      labels: [],
    };
  }

  /** A git runner answering the clean readings the pre-merge refusals need, and every clean-up step with success. */
  function fakeGit(root: string): GitRunner {
    const answers: Record<string, { ok: true; stdout: string; stderr: '' }> = {
      'status --porcelain': { ok: true, stdout: '', stderr: '' },
      'worktree list --porcelain': { ok: true, stdout: `worktree ${root}\nbranch refs/heads/${BRANCH}\n\n`, stderr: '' },
      'rev-parse --show-toplevel': { ok: true, stdout: `${root}\n`, stderr: '' },
      [`ls-remote --heads origin ${BRANCH}`]: { ok: true, stdout: `1f0c2b7\trefs/heads/${BRANCH}\n`, stderr: '' },
    };
    return (args) => answers[args.join(' ')] ?? { ok: true, stdout: '', stderr: '' };
  }

  it('asks about #12 last, once the merge has closed #A, over the same board the standalone command reads', async () => {
    const project = freshProject(ROADMAP_CONFIG);
    const gh = fakeGh(sharedBoard(true));
    const prompter = scriptedPrompter(['y']);
    const stub = createPullRequestsDouble({
      get: () => Promise.resolve(pullDetail()),
      checks: () => Promise.resolve({ rows: [], verdict: 'green' } as ChecksReading),
      merge: () => Promise.resolve({ merged: true, detail: 'Squashed and merged pull request #41' } as MergeOutcome),
    }, { refusal: 'this scenario models get, checks and merge alone' });

    const command = createPrMergeCommand({
      pullRequests: () => stub.pulls,
      readBranch: () => BRANCH,
      readRemote: () => GITHUB_ORIGIN,
      git: () => fakeGit(project.root),
      gh: () => gh.run,
      isTerminal: () => true,
      openPrompter: prompter.open,
    });

    // --yes skips the "Merge? [y/N]" question, and answers none of the
    // unblock question: this run's only question is the one about #12.
    const outcome = await dispatchInProject(['pr', 'merge', '41', '--yes', NO_HINT], SUBJECTS, [command], project);
    const lines = outcome.stdout.split('\n').filter((line) => line !== '');

    expect(outcome.exitCode).toBe(0);
    // #13 also names #A, so the merge reads it too — never guessing
    // that #12 is the only one #A's closing touches — but its own
    // blocker #C is still open, so it is reported and asks nothing.
    expect(prompter.asked()).toEqual([twelveQuestion()]);
    expect(gh.removed()).toEqual([`#12 ${SPEC_BLOCKED_LABEL}`]);
    // The unblock reading runs last (module note, `merge.ts`): its own
    // two outcome lines are the last thing the merge writes, in the
    // board's own order — the same order the `--all` scenario reads.
    expect(lines.slice(-2)).toEqual([
      `Removed ${SPEC_BLOCKED_LABEL} from #12`,
      `#13 is blocked by #${String(C)} (open), so ${SPEC_BLOCKED_LABEL} stays`,
    ]);
  });
});
