/**
 * Tests for the two-`epic:`-labels reading of `rafa issue ready`
 * (`ready.ts`) per `board.relationships` mode: it refuses in `labels`
 * mode, the default, and is not made in `native` mode, where an epic is
 * the issue's one sub-issue parent.
 *
 * Every native case runs beside its labels control over the same issue,
 * the same trust and the same answer, and the control is refused, so a
 * native pass is shown to be the mode and not an issue the check would
 * have let through anyway. The dispatched cases plant a project whose
 * `.rafa/config.yaml` names the mode, so the mode is read the way the
 * command reads it, over a recorded `gh` and a `git` answering `origin`.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { SpecIssueReader } from '../../board/issue.js';
import type { BoardTrust } from '../../board/trust.js';
import type { GitRunner } from '../../pr/git.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../../board/issue.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { completeSpecBody } from '../../tests/spec-bodies.js';

import { createIssueReadyCommand, runIssueReady } from './ready.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-ready-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Two `epic:` labels on one spec, the fault the labels-mode check refuses. */
const TWO_EPICS = [SPEC_LABEL, 'epic:board', 'epic:views'];

/** What the labels-mode refusal says for {@link TWO_EPICS} on #57. */
const TWO_EPICS_SENTENCE = 'issue #57 cannot be marked spec:ready: #57 carries 2 epic labels'
  + ' (epic:board, epic:views); an issue belongs to one epic, so remove all but one';

/** A body filling every template heading, so the completeness check passes. */
const COMPLETE = completeSpecBody('Issue 57');

/** A reader answering #57 under {@link TWO_EPICS}. */
const readTwoEpics: SpecIssueReader = (number) => Promise.resolve({
  number,
  title: 'Issue 57',
  body: COMPLETE,
  state: 'OPEN',
  labels: TWO_EPICS,
  author: 'maintainer',
});

/** A trust granting the author write access. */
const TRUST: BoardTrust = {
  permissions: (login) => Promise.resolve({ login, permission: 'admin', roleName: null, detail: '' }),
  trustedAuthors: [],
  repo: 'github.com/open-tomato/rafa',
};

/** A board recording its swaps and refusing anything else. */
function recordingBoard(): { board: IssueBoard; swapped: () => readonly string[] } {
  const swapped: string[] = [];
  const unreached = (): never => {
    throw new Error('the ready run reached a board member it has no business with');
  };
  const board: IssueBoard = {
    comments: unreached,
    comment: unreached,
    editComment: unreached,
    removeLabel: unreached,
    closeIssue: unreached,
    createLabel: unreached,
    createIssue: unreached,
    closePullRequest: unreached,
    swapLabels: (issue: number, removed: string, added: string): Promise<void> => {
      swapped.push(`#${String(issue)} -${removed} +${added}`);
      return Promise.resolve();
    },
  };
  return { board, swapped: () => swapped };
}

/** A runner that fails every command. */
const unusedGh: GhRunner = (args) => Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });

/** The exit a run threw, or null when it answered. */
async function exitOf(run: () => Promise<unknown>): Promise<CommandExit | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
}

describe('the epic label check per board.relationships mode', () => {
  it('marks an issue carrying two epic labels in native mode; labels mode and the default refuse it', async () => {
    const native = recordingBoard();
    const options = { gh: unusedGh, issue: 57, trust: TRUST, ask: () => Promise.resolve(true), readIssue: readTwoEpics };

    const labels = await exitOf(() => runIssueReady({ ...options, board: recordingBoard().board, relationships: 'labels' }));
    const unset = await exitOf(() => runIssueReady({ ...options, board: recordingBoard().board }));
    const marked = await runIssueReady({ ...options, board: native.board, relationships: 'native' });

    expect([labels?.exitCode, labels?.message]).toEqual([2, TWO_EPICS_SENTENCE]);
    expect([unset?.exitCode, unset?.message]).toEqual([2, TWO_EPICS_SENTENCE]);
    expect(marked.status).toBe('marked');
    expect(native.swapped()).toEqual(['#57 -spec:needs-work +spec:ready']);
  });
});

/** A `gh` answering #57 under {@link TWO_EPICS} and the author's permission, recording each call. */
function dispatchedGh(): { run: GhRunner; routes: () => readonly string[] } {
  const calls: (readonly string[])[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    calls.push(args);
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      return ok(JSON.stringify({
        number: Number(args[2]),
        title: 'Issue 57',
        body: COMPLETE,
        state: 'OPEN',
        labels: TWO_EPICS.map((name) => ({ name })),
        author: { login: 'maintainer' },
      }));
    }
    if (route === 'issue edit') return ok('');
    if (args[0] === 'api') return ok(JSON.stringify({ permission: 'admin', role_name: 'admin' }));
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, routes: () => calls.map((args) => args.slice(0, 2).join(' ')) };
}

/** A `git` answering `origin`. */
const fakeGit: GitRunner = (args) => (args.join(' ') === 'remote get-url origin'
  ? { ok: true, stdout: 'git@github.com:open-tomato/rafa.git\n', stderr: '' }
  : { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });

/** Dispatches `rafa issue ready 57` with a yes over a project whose config names `mode`. */
async function readyIn(mode: 'labels' | 'native') {
  const gh = dispatchedGh();
  const command = createIssueReadyCommand({
    openGh: () => gh.run,
    openGit: () => fakeGit,
    isTerminal: () => true,
    openPrompter: () => ({ say: () => undefined, ask: () => Promise.resolve('y'), close: () => undefined }),
  });
  const project = plantProject(mkdtempSync(join(tempBase, `${mode}-`)), `board:\n  relationships: ${mode}\n`);
  const outcome = await dispatchInProject(
    ['issue', 'ready', '57', '--no-hint'],
    [{ name: 'issue', summary: 'issues' }],
    [command],
    project,
  );
  return { outcome, routes: gh.routes() };
}

describe('rafa issue ready reads the mode off the project config', () => {
  it('sends the swap in native mode; the labels control refuses with exit 2 and sends no edit', async () => {
    const native = await readyIn('native');
    const labels = await readyIn('labels');

    expect(native.outcome.exitCode).toBe(0);
    expect(native.outcome.stdout).toContain('Marked #57 spec:ready');
    expect(native.routes.at(-1)).toBe('issue edit');
    expect(labels.outcome).toEqual({ exitCode: 2, stdout: '', stderr: `${TWO_EPICS_SENTENCE}\n` });
    expect(labels.routes).not.toContain('issue edit');
  });
});
