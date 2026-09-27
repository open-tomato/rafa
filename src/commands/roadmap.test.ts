/**
 * Tests for `rafa roadmap` (`roadmap.ts`): the flags it shares with
 * `issue list`, and each line dispatched beside the same line under
 * `rafa issue list --roadmap`, over one planted `gh` and `git`.
 *
 * The flag case holds the declared flags to be `ISSUE_LIST_FLAGS`'
 * own objects, in their order, less `--roadmap` and `--state`, so a flag
 * added to `issue list` shows here without a second spelling.
 *
 * The dispatched cases compare whole outcomes, exit code, stdout and
 * stderr, of the two spellings, but in json mode, where the start event
 * names the command typed and the result event alone is compared. A
 * pair that could agree by printing nothing is ruled out by the first
 * case, which holds the rows to be there. The control that `roadmap` is set on the line is `--all`: it
 * is refused by `rafa issue list` without `--roadmap` and taken here.
 *
 * The current place is a position file planted in the case's project,
 * on a second board, #2 (`type:roadmap`), naming #11 alone unticked
 * beside a ticked #12; the same line with no position file, reading
 * the Roadmap's #13 and #11, is the control.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RafaCommand } from '../cli/command.js';
import type { GitRunner } from '../pr/git.js';
import type { Place } from '../project/position.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../board/readiness.js';
import { positionAt, writePositionFile } from '../project/position.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import { createIssueListCommand, ISSUE_LIST_FLAGS } from './issue/list.js';
import { createRoadmapCommand, ROADMAP_FLAGS } from './roadmap.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue the config names. */
const ROADMAP = 1;

/** The Roadmap's body: two unticked lines around a ticked one, in an order no number sorts to. */
const ROADMAP_BODY = '- [ ] #13 — blocked bug\n- [x] #12 — shipped chore\n- [ ] #11 — ready spec\n';

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function boardIssue(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : '';
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board: the three Roadmap issues and the open blocker of #13. */
const BOARD_JSON = JSON.stringify([
  boardIssue(11, 'Ready spec', completeSpecBody('Eleven'), 'OPEN', [SPEC_READY_LABEL]),
  boardIssue(12, 'Shipped chore', 'Done.', 'CLOSED', ['type:chore']),
  boardIssue(13, 'Blocked bug', `${completeSpecBody('Thirteen')}\nBlocked by: #20\n`, 'OPEN', ['type:bug']),
  boardIssue(20, 'Open blocker', 'Still open.', 'OPEN', []),
]);

/** The second board, labelled `type:roadmap`. */
const SECOND = 2;

/** The second board's body: #12 ticked, then #11. */
const SECOND_BODY = '- [x] #12 — shipped chore\n- [ ] #11 — ready spec\n';

/** The board with the second board on it. */
const BOARD_WITH_SECOND_JSON = JSON.stringify([
  ...JSON.parse(BOARD_JSON) as object[],
  boardIssue(SECOND, 'Team board', SECOND_BODY, 'OPEN', ['type:roadmap']),
]);

/** A `gh` answering the Roadmap read, the board listing and the open pull requests, recording each call. */
function plantedGh(calls: string[][], second = false): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const roadmap = JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } });
  const team = JSON.stringify({ number: SECOND, title: 'Team board', body: SECOND_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } });
  const board = second
    ? BOARD_WITH_SECOND_JSON
    : BOARD_JSON;
  return (args) => {
    calls.push([...args]);
    const [noun, verb, number] = args;
    if (noun === 'issue' && verb === 'view') {
      return Promise.resolve(ok(number === String(SECOND)
        ? team
        : roadmap));
    }
    if (noun === 'issue' && verb === 'list') return Promise.resolve(ok(board));
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok('[]'));
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` });
  };
}

/** A `git` holding no branch, locally or on the remote. */
const plantedGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** Both spellings over one planted `gh` and `git` and no terminal, and the `gh` calls they make. */
function plantedCommands(second = false): { commands: readonly RafaCommand[]; calls: string[][] } {
  const calls: string[][] = [];
  const seams = { gh: plantedGh(calls, second), git: plantedGit, planNames: () => () => [], terminalWidth: () => undefined };
  return { commands: [createIssueListCommand(seams), createRoadmapCommand(seams)], calls };
}

/** A fresh project whose config names the Roadmap and `local` as the tracker. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`);
}

/** Dispatches `words` from a fresh project over both spellings, answering the outcome and the `gh` calls. */
async function run(words: readonly string[], position?: Place) {
  const { commands, calls } = plantedCommands(position !== undefined);
  const project = plantCase();
  if (position !== undefined) writePositionFile(project.root, positionAt(position));
  const outcome = await dispatchInProject(words, [{ name: 'issue', summary: 'issues' }], commands, project);
  return { ...outcome, calls };
}

/** The first word of each stdout line. */
function heads(stdout: string): readonly string[] {
  return stdout.split('\n').map((line) => line.split(' ')[0] ?? '');
}

/** The command a start event names, or null for any other event. */
function startCommand(event: ReturnType<typeof eventsOf>[number]): string | null {
  return event.type === 'start'
    ? event.command
    : null;
}

describe('the flags rafa roadmap declares', () => {
  it('are issue list\'s own flag objects, in their order, less --roadmap and --state', () => {
    expect(ROADMAP_FLAGS.map((flag) => flag.name)).toEqual(['all', 'full', 'check', 'type', 'module', 'search', 'limit']);
    expect(ROADMAP_FLAGS).toEqual(ISSUE_LIST_FLAGS.filter((flag) => flag.name !== 'roadmap' && flag.name !== 'state'));
    expect(ROADMAP_FLAGS.every((flag) => ISSUE_LIST_FLAGS.includes(flag))).toBe(true);
    expect(createRoadmapCommand().flags).toEqual([...ROADMAP_FLAGS]);
  });

  it('is a top-level command declaring no spends', () => {
    const command = createRoadmapCommand();

    expect([command.subject, command.action, command.spends, command.aliases]).toEqual(['roadmap', 'roadmap', undefined, undefined]);
  });
});

describe('rafa roadmap, beside rafa issue list --roadmap', () => {
  it('prints the same rows, in the Roadmap\'s order, as the same bytes', async () => {
    const shortcut = await run(['roadmap']);
    const long = await run(['issue', 'list', '--roadmap']);

    expect(shortcut).toEqual(long);
    expect(shortcut.exitCode).toBe(0);
    expect(shortcut.stderr).toBe('');
    expect(shortcut.stdout.split('\n').map((line) => line.split(' ')[0])).toEqual(['Roadmap:', '', '#13', '#11', '']);
  });

  it.each([
    [['--all', '--type=bug']],
    [['--search=READY']],
    [['--limit=1']],
  ])('agrees with it on %j', async (flags) => {
    const shortcut = await run(['roadmap', ...flags]);

    expect(shortcut).toEqual(await run(['issue', 'list', '--roadmap', ...flags]));
    expect(shortcut.exitCode).toBe(0);
  });

  it('gives the result event issue list --roadmap gives in json mode, the start event naming the command typed', async () => {
    const shortcut = eventsOf((await run(['roadmap', '--output=json'])).stdout);
    const long = eventsOf((await run(['issue', 'list', '--roadmap', '--output=json'])).stdout);
    const result = shortcut.find((event) => event.type === 'result') as { data?: { roadmap: number; rows: unknown[] } } | undefined;

    expect(shortcut.map((event) => event.type)).toEqual(['start', 'result']);
    expect(shortcut.map(startCommand)).toEqual(['roadmap', null]);
    expect(long.map(startCommand)).toEqual(['issue list', null]);
    expect(shortcut[1]).toEqual(long[1]);
    expect(result?.data?.roadmap).toBe(ROADMAP);
    expect(result?.data?.rows).toHaveLength(2);
  });

  it('refuses --state as issue list --roadmap refuses it, running no gh', async () => {
    const shortcut = await run(['roadmap', '--state=open']);

    expect(shortcut).toEqual(await run(['issue', 'list', '--roadmap', '--state=open']));
    expect(shortcut.exitCode).toBe(1);
    expect(shortcut.stderr).toStartWith('❌ --state cannot narrow --roadmap');
    expect(shortcut.calls).toEqual([]);
  });

  it('takes --all, which issue list refuses without --roadmap, the control that roadmap is set', async () => {
    const shortcut = await run(['roadmap', '--all']);
    const bare = await run(['issue', 'list', '--all']);

    expect(bare.exitCode).toBe(1);
    expect(bare.stderr).toStartWith('❌ --all keeps the ticked Roadmap lines, so it needs --roadmap');
    expect(shortcut.exitCode).toBe(0);
    expect(shortcut.stdout.split('\n').map((line) => line.split(' ')[0])).toEqual(['Roadmap:', '', '#13', '#12', '#11', '']);
  });
});

describe('rafa roadmap on the current place', () => {
  it('prints the current place\'s board in both spellings, the control being the Roadmap with no position file', async () => {
    const shortcut = await run(['roadmap'], { board: SECOND, epic: null });
    const long = await run(['issue', 'list', '--roadmap'], { board: SECOND, epic: null });
    const control = await run(['roadmap']);

    expect(shortcut).toEqual(long);
    expect(shortcut.exitCode).toBe(0);
    expect(shortcut.stderr).toBe('');
    expect(shortcut.stdout.split('\n')[0]).toBe(`Roadmap: #${String(SECOND)}`);
    expect(heads(shortcut.stdout)).toEqual(['Roadmap:', '', '#11', '']);
    expect(shortcut.calls.filter((call) => call[1] === 'view').map((call) => call[2])).toEqual([String(SECOND)]);
    expect(heads(control.stdout)).toEqual(['Roadmap:', '', '#13', '#11', '']);
  });

  it('keeps --all as it is, the ticked line of the current place\'s board included', async () => {
    const outcome = await run(['roadmap', '--all'], { board: SECOND, epic: null });

    expect(heads(outcome.stdout)).toEqual(['Roadmap:', '', '#12', '#11', '']);
  });
});
