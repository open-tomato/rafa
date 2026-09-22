/**
 * What `rafa next` reads between two turns of its chain, driven over
 * two registered commands and one board they share: `next` itself and
 * the `issue ready` its readiness step runs
 * (`src/commands/next.ts`, `src/commands/issue/ready.ts`).
 *
 * ## Why this file exists
 *
 * Observed 2026-09-23 against 0.9.1, on issue #82:
 *
 * ```text
 * 📍 #82 not ready: it carries no spec:ready label.
 * 👉 check the spec of #82 and mark it ready — rafa issue ready 82
 * Marked #82 spec:ready, and took spec:needs-work off it
 * 📍 #82 not ready: it carries no spec:ready label.
 * ⏹ That last step left the project where it was, so the chain stops.
 * ```
 *
 * The step ran and the label landed, and the chain then read the labels
 * it had cached BEFORE the step: `openNextSources` built one board for
 * the whole command, and that board memoises the issue it reads
 * (`src/next/sources.ts`). Its own unit suite counted the reads and was
 * right about them; nothing read the board across a turn, so nothing
 * saw the staleness. This file does, over the real chain.
 *
 * ## What each case pins
 *
 * The first is the whole shape: the label lands, the chain reads the
 * board again and proposes the step that FOLLOWS, and the `unchanged`
 * ending never prints. The second is narrower and survives a change of
 * wording: the issue is read again after the step, which is the reading
 * the first case's behaviour rests on.
 *
 * Restoring the bug — `readNextState(sources)` in place of
 * `readNextState(sources.answer())` — reddens both.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { Prompter } from '../project/root-choice.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { createIssueReadyCommand } from '../commands/issue/ready.js';
import { createNextCommand } from '../commands/next.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { dispatchInProject, plantProject } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

/** A temporary directory of this file's own, for every project it plants. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-rereads-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subjects the two dispatched commands route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The base branch every case runs on. */
const BASE = 'main';

/** The roadmap issue, and the spec line it carries. */
const ROADMAP = 31;
const SPEC = 82;

/** The remote the trust sentence names. */
const ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The login every planted issue is opened by, and its permission. */
const AUTHOR = 'octocat';

/** A roadmap body with one line, neither done nor taken. */
const ROADMAP_BODY = ['# Roadmap', '', '## Next, in order', '', `- [ ] #${String(SPEC)} the next one`, ''].join('\n');

/** A board holding the two issues, whose labels a run may change. */
function boardOf(): {
  readonly gh: GhRunner;
  readonly labels: () => readonly string[];
  readonly reads: () => readonly string[];
} {
  let held: readonly string[] = [SPEC_LABEL];
  const reads: string[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

  const gh: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      const number = Number(args[2]);
      reads.push(`view ${String(number)}`);
      return ok(JSON.stringify({
        number,
        title: number === ROADMAP
          ? 'Roadmap'
          : 'A spec',
        body: number === ROADMAP
          ? ROADMAP_BODY
          : completeSpecBody('An issue ready to mark'),
        state: 'OPEN',
        labels: (number === ROADMAP
          ? []
          : held).map((name) => ({ name })),
        author: { login: AUTHOR },
      }));
    }
    if (route === 'issue edit') {
      // `issue ready` writes the label the next turn must see.
      const added = args.includes('--add-label')
        ? args[args.indexOf('--add-label') + 1] ?? ''
        : '';
      const removed = args.includes('--remove-label')
        ? args[args.indexOf('--remove-label') + 1] ?? ''
        : '';
      held = [...held.filter((name) => name !== removed), ...(added === ''
        ? []
        : [added])];
      reads.push(`edit ${String(Number(args[2]))}`);
      return ok('');
    }
    if (args[0] === 'api' && (args[1] ?? '').includes('/collaborators/')) {
      return ok(JSON.stringify({ permission: 'admin', role_name: 'admin' }));
    }
    if (route === 'pr list' || route === 'issue list') return ok('[]');
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };

  return { gh, labels: () => held, reads: () => reads };
}

/** git on the base branch, level with its remote, holding no plan branch. */
const fakeGit: GitRunner = (args) => {
  const line = args.join(' ');
  const said = (stdout: string): GitResult => ({ ok: true, stdout, stderr: '' });
  if (line === 'rev-parse --abbrev-ref HEAD') return said(`${BASE}\n`);
  if (line === 'remote get-url origin') return said(`${ORIGIN}\n`);
  if (line === `rev-list --left-right --count ${BASE}...origin/${BASE}`) return said('0\t0\n');
  return said('');
};

/** A prompter answering `y` to everything, recording what it was asked. */
function yesPrompter(): { readonly open: () => Prompter; readonly asked: () => readonly string[] } {
  const asked: string[] = [];
  return {
    open: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve('y');
      },
      close: () => undefined,
    }),
    asked: () => asked,
  };
}

/** The two commands over one board, and the project they run in. */
function chainOver(board: ReturnType<typeof boardOf>): {
  readonly commands: readonly ReturnType<typeof createNextCommand>[];
  readonly project: ReturnType<typeof plantProject>;
  readonly asked: () => readonly string[];
} {
  const prompter = yesPrompter();
  const next = createNextCommand({
    isTerminal: () => true,
    readRemote: () => ORIGIN,
    openGh: () => board.gh,
    openGit: () => fakeGit,
    openPrompter: prompter.open,
    // No pull request on the base, so the chain reaches the roadmap rows.
    pullRequests: () => createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
  });
  const ready = createIssueReadyCommand({
    isTerminal: () => true,
    openGh: () => board.gh,
    openGit: () => fakeGit,
    openPrompter: prompter.open,
  });
  const project = plantProject(
    mkdtempSync(join(tempBase, 'project-')),
    `pr:\n  base: ${BASE}\nroadmap:\n  issue: ${String(ROADMAP)}\n`,
  );
  return { commands: [next, ready], project, asked: prompter.asked };
}

describe('rafa next over a step that changes the board', () => {
  it('marks the issue ready and then reads the board again, proposing what follows', async () => {
    const board = boardOf();
    const { commands, project } = chainOver(board);

    const run = await dispatchInProject(['next'], SUBJECTS, commands, project);

    // The step ran: the label landed on the board.
    expect(board.labels()).toContain(SPEC_READY_LABEL);
    // And the chain moved on: the readiness step is proposed once, and
    // what follows it is the plan. (That step then ends the run, because
    // `plan create` is not registered here; the proposal is the reading.)
    const proposals = run.stdout.split('\n').filter((line) => line.startsWith('👉'));
    expect(proposals.filter((line) => line.includes('mark it ready')).length).toBe(1);
    expect(proposals.some((line) => line.includes(`create the plan for #${String(SPEC)}`))).toBe(true);
    expect(run.stdout).not.toContain('left the project where it was');
  });

  it('reads the issue again after the step, which is what the chain rests on', async () => {
    const board = boardOf();
    const { commands, project } = chainOver(board);

    await dispatchInProject(['next'], SUBJECTS, commands, project);

    const views = board.reads().filter((call) => call === `view ${String(SPEC)}`);
    const edit = board.reads().indexOf(`edit ${String(SPEC)}`);
    expect(edit).toBeGreaterThan(-1);
    // One read before the step, and at least one after it.
    expect(views.length).toBeGreaterThan(1);
    expect(board.reads().lastIndexOf(`view ${String(SPEC)}`)).toBeGreaterThan(edit);
  });
});
