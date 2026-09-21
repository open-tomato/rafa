/**
 * An integration suite over `rafa issue ready` end to end: the command
 * itself, dispatched, and the offer `plan create --issue` and
 * `plan create --next` make with the very same run
 * (`src/commands/issue/ready.ts`, `src/commands/plan/ready-offer.ts`).
 *
 * `./ready.test.ts` drives the command's own cases and `./ready-offer.test.ts`
 * drives the offer's own wiring, each over a planted `run` or a planted
 * `readIssue`; `src/board/plan-spec.test.ts` drives both `plan create`
 * routes over a planted `offerReady` that never calls `issue ready` at
 * all. None of those three reaches what this file is about: that the
 * REAL {@link runIssueReady} — its trust reading, its completeness
 * reading, its one label swap — is what answers when `plan create` asks
 * the question, over the SAME kind of `gh` a dispatched `rafa issue
 * ready` reads, and that both `plan create` routes reach it the same way.
 *
 * Five scenarios, none reaching GitHub, spawning `gh` or `git`, or
 * waiting on a real answer:
 *
 *  - `rafa issue ready`, dispatched, swaps the labels on a yes;
 *  - the trust refusal runs before the question is put, over an issue an
 *    outsider opened — the prompter would throw if it were ever opened;
 *  - the completeness refusal names every gap, asking nothing;
 *  - a run with no terminal prints both readings and writes nothing;
 *  - `plan create --issue` and `plan create --next` each offer an
 *    unlabelled issue the label through {@link createPlanReadyOffer},
 *    with its `run` seam left as `runIssueReady` itself: a yes swaps the
 *    labels and the route goes on to snapshot and plan, and a no leaves
 *    the board untouched and refuses with check 1's own sentence.
 *
 * Every case plants its own `gh` runner and answers `git remote get-url
 * origin` with one fixed `origin`, so a trust sentence names the same
 * repository everywhere.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { SpecRouteSeams } from '../commands/plan/spec-route.js';
import type { GitRunner } from '../pr/git.js';
import type { Prompter } from '../project/root-choice.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_NEEDS_WORK_LABEL } from '../board/gate.js';
import { SPEC_LABEL } from '../board/issue.js';
import { specPath } from '../board/naming.js';
import { BOARD_REFUSAL_EXIT, resolvePlanSpec } from '../board/plan-spec.js';
import { SPEC_READY_LABEL, specReadyRefusalMessage } from '../board/readiness.js';
import { CommandExit } from '../cli/command.js';
import { createIssueReadyCommand, readyQuestion } from '../commands/issue/ready.js';
import { createPlanReadyOffer } from '../commands/plan/ready-offer.js';
import { resolveCreateSpec } from '../commands/plan/spec-route.js';

import { dispatchInProject, plantProject } from './cli-capture.js';
import { sinkOutput } from './output-sinks.js';
import { completeSpecBody } from './spec-bodies.js';

/** A temporary directory of this file's own, for every project and every repo root it plants. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-ready-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched `issue ready` cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** Where `plan create`'s two board routes write a snapshot, as a project configures it. */
const SPECS_DIR = '.rafa/specs';

/** The repository every trust sentence in this file names. */
const REPO = 'github.com/open-tomato/rafa';

/** The remote a planted `git` answers, which normalises to {@link REPO}. */
const ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** A body filling every heading the spec template asks for. */
const COMPLETE = completeSpecBody('An issue ready to mark');

/** A body filling none of them, so the completeness check refuses. */
const THIN = 'Make the thing work.\n';

/** One issue as a case plants it on the shared board. */
interface PlantedIssue {
  readonly title?: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly author?: string;
}

/** What each login's permission lookup answers; a login left out gets the 404 an outsider gets. */
const PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({ octocat: 'admin', outsider: 'read' });

/**
 * A `gh` runner over `issues`, answering `issue view`, the one `issue
 * edit` a label swap sends, the permission lookup and `gh pr list`
 * (`--next`'s open-pull-request reading, always empty here). Every other
 * command is refused. Keeps every label swap it was sent, so a case
 * holds that a decline wrote nothing over the real board.
 */
function boardOf(issues: Readonly<Record<number, PlantedIssue>>): { gh: GhRunner; edits: () => readonly string[] } {
  const edits: string[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const gh: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      const number = Number(args[2]);
      const found = issues[number];
      if (found === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: `no planted issue ${String(number)}` });
      return ok(JSON.stringify({
        number,
        title: found.title ?? `Issue ${String(number)}`,
        body: found.body ?? '',
        state: 'OPEN',
        labels: (found.labels ?? []).map((name) => ({ name })),
        author: { login: found.author ?? 'octocat' },
      }));
    }
    if (route === 'issue edit') {
      edits.push(`#${args[2] ?? ''} -${args[4] ?? ''} +${args[6] ?? ''}`);
      return ok('');
    }
    if (args[0] === 'api') {
      const login = Object.keys(PERMISSIONS).find((name) => args[1] === `repos/{owner}/{repo}/collaborators/${name}/permission`);
      if (login === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
      return ok(JSON.stringify({ permission: PERMISSIONS[login], role_name: PERMISSIONS[login] }));
    }
    if (route === 'pr list') return ok('[]');
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { gh, edits: () => edits };
}

/** A `git` runner answering only `remote get-url origin`, which every case here reads for the trust sentence. */
const fakeGit: GitRunner = (args) => (args.join(' ') === 'remote get-url origin'
  ? { ok: true, stdout: `${ORIGIN}\n`, stderr: '' }
  : { ok: true, stdout: '', stderr: '' });

/** A prompter answering one line, recording what it was asked. */
function scriptedPrompter(answer: string): { open: () => Prompter; asked: () => readonly string[] } {
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
    asked: () => asked,
  };
}

/** A prompter no case here may open: the guard held by every refusal that must ask nothing. */
function unopenedPrompter(): () => Prompter {
  return (): Prompter => {
    throw new Error('a run that must ask nothing opened a prompter');
  };
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

/** A project of the dispatched cases' own, under this file's own temporary directory. */
function freshProject(): ReturnType<typeof plantProject> {
  return plantProject(mkdtempSync(join(tempBase, 'project-')));
}

/** A repository root of the board routes' own, under this file's own temporary directory. */
function freshRoot(): string {
  return mkdtempSync(join(tempBase, 'repo-'));
}

describe('rafa issue ready, dispatched over its own board', () => {
  it('swaps the labels on a yes, over a real board', async () => {
    const board = boardOf({ 601: { body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' } });
    const prompter = scriptedPrompter('y');
    const command = createIssueReadyCommand({
      openGh: () => board.gh,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: prompter.open,
    });

    const outcome = await dispatchInProject(['issue', 'ready', '601'], SUBJECTS, [command], freshProject());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Marked #601 ${SPEC_READY_LABEL}, and took ${SPEC_NEEDS_WORK_LABEL} off it`);
    expect(prompter.asked()).toEqual([readyQuestion(601)]);
    expect(board.edits()).toEqual([`#601 -${SPEC_NEEDS_WORK_LABEL} +${SPEC_READY_LABEL}`]);
  });

  it('refuses an outsider before the question is asked, opening no prompter and writing nothing', async () => {
    const board = boardOf({ 602: { body: COMPLETE, labels: [SPEC_LABEL], author: 'outsider' } });
    const command = createIssueReadyCommand({
      openGh: () => board.gh,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: unopenedPrompter(),
    });

    const outcome = await dispatchInProject(['issue', 'ready', '602'], SUBJECTS, [command], freshProject());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toBe(`issue #602 was opened by outsider, who has no write access to ${REPO};`
      + ' a member must open the spec\n');
    expect(board.edits()).toEqual([]);
  });

  it('refuses a body with gaps, naming every one, and asks nothing', async () => {
    const board = boardOf({ 603: { body: THIN, labels: [SPEC_LABEL], author: 'octocat' } });
    const command = createIssueReadyCommand({
      openGh: () => board.gh,
      openGit: () => fakeGit,
      isTerminal: () => true,
      openPrompter: unopenedPrompter(),
    });

    const outcome = await dispatchInProject(['issue', 'ready', '603'], SUBJECTS, [command], freshProject());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('issue #603 is not ready to plan from:');
    expect(outcome.stderr).toContain('"Tasks the plan must carry" is missing');
    expect(board.edits()).toEqual([]);
  });

  it('asks nothing and writes nothing with no terminal, naming the command to run', async () => {
    const board = boardOf({ 604: { body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' } });
    const command = createIssueReadyCommand({
      openGh: () => board.gh,
      openGit: () => fakeGit,
      isTerminal: () => false,
      openPrompter: unopenedPrompter(),
    });

    const outcome = await dispatchInProject(['issue', 'ready', '604'], SUBJECTS, [command], freshProject());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('there is no terminal to ask on, so spec:ready was not added.'
      + ' Run rafa issue ready 604 where an answer can be typed');
    expect(board.edits()).toEqual([]);
  });
});

/**
 * `resolveCreateSpec`'s own seams ({@link SpecRouteSeams}), pointed at
 * `board` and `git` rather than a spawned `gh` and `git`, and at the
 * REAL offer: `createPlanReadyOffer`'s `run` seam is left out, so it is
 * `runIssueReady` itself that reads the issue's trust and completeness
 * and sends the one label swap.
 */
function offerSeams(board: ReturnType<typeof boardOf>, prompter: ReturnType<typeof scriptedPrompter>): SpecRouteSeams {
  return {
    resolve: (options) => resolvePlanSpec({ ...options, gh: board.gh, git: fakeGit, output: sinkOutput({}) }),
    makeReadyOffer: () => createPlanReadyOffer({ isTerminal: () => true, openPrompter: prompter.open }),
    makeAlternativeOffer: () => null,
  };
}

describe('the offer plan create --issue makes, through the real issue ready run', () => {
  it('marks the issue on a yes, and plans from the snapshot the route then writes', async () => {
    const title = 'Offer taken through --issue';
    const board = boardOf({ 605: { title, body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' } });
    const prompter = scriptedPrompter('y');
    const root = freshRoot();

    const resolution = await resolveCreateSpec({
      args: ['--issue=605'],
      repoRoot: root,
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, offerSeams(board, prompter));

    expect(resolution.outcome).toBe('spec');
    if (resolution.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolution.reason}`);
    expect(resolution.spec.issue).toBe(605);
    expect(prompter.asked()).toEqual([readyQuestion(605)]);
    expect(board.edits()).toEqual([`#605 -${SPEC_NEEDS_WORK_LABEL} +${SPEC_READY_LABEL}`]);
    expect(existsSync(join(root, specPath(SPECS_DIR, 605, title)))).toBe(true);
  });

  it('leaves the issue unmarked on a no, and refuses with check 1\'s own sentence', async () => {
    const title = 'Offer declined through --issue';
    const board = boardOf({ 606: { title, body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' } });
    const prompter = scriptedPrompter('n');
    const root = freshRoot();

    const exit = await refusal(() => resolveCreateSpec({
      args: ['--issue=606'],
      repoRoot: root,
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, offerSeams(board, prompter)));

    expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(exit.message).toBe(specReadyRefusalMessage(606));
    expect(prompter.asked()).toEqual([readyQuestion(606)]);
    expect(board.edits()).toEqual([]);
    expect(existsSync(join(root, specPath(SPECS_DIR, 606, title)))).toBe(false);
  });
});

describe('the offer plan create --next makes, through the real issue ready run', () => {
  /** The roadmap issue every case here configures, naming one unlabelled line. */
  const ROADMAP = 631;

  it('marks the picked line on a yes, and plans from the snapshot the route then writes', async () => {
    const title = 'Offer taken through --next';
    const board = boardOf({
      [ROADMAP]: { body: '- [ ] #607 — the offer route\n' },
      607: { title, body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' },
    });
    const prompter = scriptedPrompter('y');
    const root = freshRoot();

    const resolution = await resolveCreateSpec({
      args: ['--next'],
      repoRoot: root,
      specsDir: SPECS_DIR,
      roadmapIssue: ROADMAP,
      trustedAuthors: [],
    }, offerSeams(board, prompter));

    expect(resolution.outcome).toBe('spec');
    if (resolution.outcome !== 'spec') throw new Error(`the resolution stopped: ${resolution.reason}`);
    expect(resolution.spec).toMatchObject({ kind: 'next', issue: 607 });
    expect(prompter.asked()).toEqual([readyQuestion(607)]);
    expect(board.edits()).toEqual([`#607 -${SPEC_NEEDS_WORK_LABEL} +${SPEC_READY_LABEL}`]);
    expect(existsSync(join(root, specPath(SPECS_DIR, 607, title)))).toBe(true);
  });

  it('leaves the picked line unmarked on a no, and refuses with check 1\'s own sentence', async () => {
    const title = 'Offer declined through --next';
    const board = boardOf({
      [ROADMAP]: { body: '- [ ] #608 — the offer route\n' },
      608: { title, body: COMPLETE, labels: [SPEC_LABEL], author: 'octocat' },
    });
    const prompter = scriptedPrompter('n');
    const root = freshRoot();

    const exit = await refusal(() => resolveCreateSpec({
      args: ['--next'],
      repoRoot: root,
      specsDir: SPECS_DIR,
      roadmapIssue: ROADMAP,
      trustedAuthors: [],
    }, offerSeams(board, prompter)));

    expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(exit.message).toBe(specReadyRefusalMessage(608));
    expect(prompter.asked()).toEqual([readyQuestion(608)]);
    expect(board.edits()).toEqual([]);
    expect(existsSync(join(root, specPath(SPECS_DIR, 608, title)))).toBe(false);
  });
});
