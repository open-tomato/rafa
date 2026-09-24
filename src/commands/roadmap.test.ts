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
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { RafaCommand } from '../cli/command.js';
import type { GitRunner } from '../pr/git.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_READY_LABEL } from '../board/readiness.js';
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

/** One issue as `gh issue list --json number,title,body,state,labels` writes it. */
function boardIssue(number: number, title: string, body: string, state: 'OPEN' | 'CLOSED', labels: readonly string[]): object {
  return { number, title, body, state, labels: labels.map((name) => ({ name })) };
}

/** The board: the three Roadmap issues and the open blocker of #13. */
const BOARD_JSON = JSON.stringify([
  boardIssue(11, 'Ready spec', completeSpecBody('Eleven'), 'OPEN', [SPEC_READY_LABEL]),
  boardIssue(12, 'Shipped chore', 'Done.', 'CLOSED', ['type:chore']),
  boardIssue(13, 'Blocked bug', `${completeSpecBody('Thirteen')}\nBlocked by: #20\n`, 'OPEN', ['type:bug']),
  boardIssue(20, 'Open blocker', 'Still open.', 'OPEN', []),
]);

/** A `gh` answering the Roadmap read, the board listing and the open pull requests, recording each call. */
function plantedGh(calls: string[][]): GhRunner {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const roadmap = JSON.stringify({ number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'owner' } });
  return (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    if (noun === 'issue' && verb === 'view') return Promise.resolve(ok(roadmap));
    if (noun === 'issue' && verb === 'list') return Promise.resolve(ok(BOARD_JSON));
    if (noun === 'pr' && verb === 'list') return Promise.resolve(ok('[]'));
    return Promise.resolve({ ok: false, stdout: '', stderr: `unplanted: gh ${args.join(' ')}` });
  };
}

/** A `git` holding no branch, locally or on the remote. */
const plantedGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });

/** Both spellings over one planted `gh` and `git` and no terminal, and the `gh` calls they make. */
function plantedCommands(): { commands: readonly RafaCommand[]; calls: string[][] } {
  const calls: string[][] = [];
  const seams = { gh: plantedGh(calls), git: plantedGit, planNames: () => () => [], terminalWidth: () => undefined };
  return { commands: [createIssueListCommand(seams), createRoadmapCommand(seams)], calls };
}

/** A fresh project whose config names the Roadmap and `local` as the tracker. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n  default: local\nroadmap:\n  issue: ${String(ROADMAP)}\n`);
}

/** Dispatches `words` from a fresh project over both spellings, answering the outcome and the `gh` calls. */
async function run(words: readonly string[]) {
  const { commands, calls } = plantedCommands();
  const outcome = await dispatchInProject(words, [{ name: 'issue', summary: 'issues' }], commands, plantCase());
  return { ...outcome, calls };
}

/** The command a start event names, or null for any other event. */
function startCommand(event: ReturnType<typeof eventsOf>[number]): string | null {
  return event.type === 'start'
    ? event.command
    : null;
}

describe('the flags rafa roadmap declares', () => {
  it('are issue list\'s own flag objects, in their order, less --roadmap and --state', () => {
    expect(ROADMAP_FLAGS.map((flag) => flag.name)).toEqual(['all', 'type', 'module', 'search', 'limit']);
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
