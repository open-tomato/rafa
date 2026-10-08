/**
 * Tests for `rafa issue unblock` under `board.relationships`
 * (`unblock-native.ts` and the branch `unblock.ts` takes on it): native
 * mode prints the one line, sends no `gh` call, opens no prompter and
 * exits 0, and labels mode, set or left unset, runs the board as before.
 *
 * Every case dispatches the command in a planted project whose config
 * sets the mode, over a recorded `gh` runner answering one blocked issue
 * (#12, blocked by the closed #24) and a prompter answering yes. So a
 * run that READ the board shows up in the runner's calls, and a run that
 * WROTE shows up as the `gh issue edit` removing `spec:blocked`.
 *
 * ## The controls
 *
 *  - "Sends nothing in native mode" could pass over a runner the command
 *    never reached for any reason. The same board, the same answer and
 *    the same line in labels mode send the listing and the edit, so the
 *    runner is shown reachable.
 *  - "Labels mode unchanged" is held as the unset config against one
 *    setting `labels` explicitly: the same output and the same `gh`
 *    calls, the edit included.
 */
import type { NativeUnblockRefreshOptions } from './unblock-native.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectRefresh } from '../../board/project/refresh.js';
import type { Prompter } from '../../cli/prompt/confirm.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { NATIVE_UNBLOCK_LINE, nativeUnblockReport, refreshNativeUnblock } from './unblock-native.js';
import { createIssueUnblockCommand, UNBLOCK_USAGE } from './unblock.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-unblock-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The edit a labels-mode yes sends. */
const REMOVAL: readonly string[] = ['issue', 'edit', '12', '--remove-label', SPEC_BLOCKED_LABEL];

/** A board holding #12, labelled blocked by the closed #24, and the argument lists it was handed. */
function fakeGh(): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const ok = (value: unknown): Promise<GhResult> => {
    const stdout = typeof value === 'string'
      ? value
      : JSON.stringify(value);
    return Promise.resolve({ ok: true, stdout, stderr: '' });
  };
  const blocked = { number: 12, body: '## Spec\n\nBlocked by: #24\n' };

  const run: GhRunner = (args) => {
    calls.push(args);
    const route = args.slice(0, 2).join(' ');
    if (route === 'issue view') {
      return ok({
        ...blocked,
        title: 'Issue 12',
        state: 'OPEN',
        labels: [{ name: SPEC_BLOCKED_LABEL }],
        author: { login: 'maintainer' },
      });
    }
    if (route === 'issue edit') return ok('');
    if (args.includes('--label')) return ok([blocked]);
    if (args.includes('all')) return ok([{ number: 12, state: 'OPEN' }, { number: 24, state: 'CLOSED' }]);
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** A project whose config sets `board.relationships` to `mode`, or leaves it unset. */
function plant(mode: string | null): ReturnType<typeof plantProject> {
  const text = mode === null
    ? projectConfigText()
    : `${projectConfigText()}\nboard:\n  relationships: ${mode}\n`;
  return plantProject(mkdtempSync(join(tempBase, 'case-')), text);
}

/** What one dispatched run wrote, beside the `gh` calls and questions it made. */
interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly calls: readonly (readonly string[])[];
  readonly asked: readonly string[];
  readonly opened: number;
}

/** Dispatches `rafa issue unblock <words>` under `mode`, on a terminal answering yes. */
async function unblock(mode: string | null, words: readonly string[]): Promise<Run> {
  return unblockWith(mode, words);
}

/** {@link unblock} over a `board.relationships` value spelled as given, which may carry the board's other keys. */
async function unblockWith(mode: string | null, words: readonly string[]): Promise<Run> {
  const gh = fakeGh();
  const asked: string[] = [];
  let opened = 0;
  const prompter: Prompter = {
    say: () => undefined,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve('y');
    },
    close: () => undefined,
  };
  const command = createIssueUnblockCommand({
    openGh: () => {
      opened += 1;
      return gh.run;
    },
    isTerminal: () => true,
    openPrompter: () => prompter,
  });

  const outcome = await dispatchInProject(['issue', 'unblock', ...words], SUBJECTS, [command], plant(mode));
  return { ...outcome, calls: gh.calls(), asked, opened };
}

describe('rafa issue unblock in native mode', () => {
  it('prints that the tracker clears a blocker, sends no gh call, asks nothing and exits 0', async () => {
    const run = await unblock('native', ['12']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(`${NATIVE_UNBLOCK_LINE}\n`);
    expect(run.stderr).toBe('');
    expect([run.calls, run.asked, run.opened]).toEqual([[], [], 0]);
  });

  it('names the mode and says there is nothing to write', () => {
    expect(NATIVE_UNBLOCK_LINE.startsWith('board.relationships is native: ')).toBe(true);
    expect(NATIVE_UNBLOCK_LINE).toContain('clears a blocker by itself when the blocking issue closes');
    expect(NATIVE_UNBLOCK_LINE).toContain('nothing to write');
  });

  it('answers --all the same way, reading no blocked listing', async () => {
    const run = await unblock('native', ['--all']);

    expect([run.exitCode, run.stdout, run.stderr]).toEqual([0, `${NATIVE_UNBLOCK_LINE}\n`, '']);
    expect(run.calls).toEqual([]);
  });

  it('control: the same board and line in labels mode reads the board and writes the removal', async () => {
    const run = await unblock('labels', ['12']);

    expect([run.exitCode, run.stdout]).toEqual([0, 'Removed spec:blocked from #12\n']);
    expect(run.calls.map((args) => args.slice(0, 2).join(' '))).toEqual(['issue view', 'issue list', 'issue edit']);
    expect(run.calls.at(-1)).toEqual(REMOVAL);
  });

  it('gives the native report as the data of the one result event in json mode', async () => {
    const run = await unblock('native', ['12', '--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr, run.calls]).toEqual([0, '', []]);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({ ok: true, data: nativeUnblockReport() });
    expect(Object.keys(nativeUnblockReport())).toEqual(['relationships', 'issues', 'problem', 'unchecked', 'message']);
  });

  it('still refuses a line it cannot read, with exit code 1 and no gh call', async () => {
    const run = await unblock('native', []);

    expect([run.exitCode, run.stdout, run.calls]).toEqual([1, '', []]);
    expect(run.stderr).toContain(`Usage: ${UNBLOCK_USAGE}`);
    expect(run.stderr).not.toContain(NATIVE_UNBLOCK_LINE);
  });
});

describe('rafa issue unblock with board.relationships unset', () => {
  it('writes and sends what an explicit labels setting does, byte for byte', async () => {
    const unset = await unblock(null, ['12']);
    const labels = await unblock('labels', ['12']);

    expect({ ...unset }).toEqual({ ...labels });
    expect(unset.calls.at(-1)).toEqual(REMOVAL);
    expect(unset.stdout).not.toContain('board.relationships');
  });
});

describe('rafa issue unblock with a config it cannot use', () => {
  it('refuses with exit code 1 naming the key, before any gh call', async () => {
    const run = await unblock('threads', ['12']);

    expect([run.exitCode, run.stdout, run.calls, run.opened]).toEqual([1, '', [], 0]);
    expect(run.stderr).toContain('❌ The config cannot be used:');
    expect(run.stderr).toContain('board.relationships');
  });
});

/** A refresh config with `board.project.number` set to `number`. */
function refreshConfig(number: number | null): NativeUnblockRefreshOptions['config'] {
  return {
    boardProjectNumber: number,
    boardProjectRetries: false,
    boardProjectRetryWaitSeconds: 1,
    boardProjectWriteBatchSize: 5,
    boardProjectWritePauseMs: 0,
    boardRelationships: 'native',
    roadmapIssue: null,
    releaseFragments: '.changes',
  } as unknown as NativeUnblockRefreshOptions['config'];
}

/** What one {@link refreshNativeUnblock} call sent and warned. */
async function refreshRun(
  issues: readonly number[] | null,
  number: number | null,
  answer: () => Promise<ProjectRefresh>,
): Promise<{ asked: readonly (readonly number[])[]; opened: number; warned: readonly string[] }> {
  const asked: (readonly number[])[] = [];
  const warned: string[] = [];
  let opened = 0;
  await refreshNativeUnblock(issues, {
    config: refreshConfig(number),
    openGh: () => {
      opened += 1;
      return fakeGh().run;
    },
    warn: (line) => {
      warned.push(line);
    },
    refresh: (_options, refreshed) => {
      asked.push(refreshed);
      return answer();
    },
    failedLine: (issue, error) => `The project was not updated for #${String(issue)}: ${(error as Error).message}. Run rafa board sync.`,
  });
  return { asked, opened, warned };
}

/** A refresh answering `warnings`. */
function answering(warnings: readonly string[]): () => Promise<ProjectRefresh> {
  return () => Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings });
}

describe('the native-mode project refresh', () => {
  it('opens no runner and refreshes nothing with board.project.number unset', async () => {
    const run = await refreshRun([12], null, answering([]));

    expect([run.asked, run.opened, run.warned]).toEqual([[], 0, []]);
  });

  it('refreshes nothing under --all, which names no issue', async () => {
    const run = await refreshRun(null, 6, answering([]));

    expect([run.asked, run.opened]).toEqual([[], 0]);
  });

  it('control: refreshes the named issue with the number set, handing each line to warn', async () => {
    const run = await refreshRun([12], 6, answering(['the project was not updated']));

    expect([run.asked, run.opened, run.warned]).toEqual([[[12]], 1, ['the project was not updated']]);
  });

  it('answers a refresh that rejects with the failed line, never rejecting', async () => {
    const run = await refreshRun([12], 6, () => Promise.reject(new Error('repo view refused')));

    expect(run.warned).toHaveLength(1);
    expect(run.warned[0]).toContain('The project was not updated for #12: repo view refused.');
    expect(run.warned[0]).toContain('rafa board sync');
  });

  it('runs from the command: with the number set, the line printed, then a refresh warning, exit 0', async () => {
    const run = await unblockWith('native\n  project:\n    number: 6', ['12']);

    const lines = run.stdout.split('\n');

    expect([run.exitCode, run.asked, run.opened]).toEqual([0, [], 1]);
    expect(lines[0]).toBe(NATIVE_UNBLOCK_LINE);
    expect(lines[1]).toStartWith('warn: The project was not updated for #12');
    expect(run.calls[0]?.slice(0, 2)).toEqual(['repo', 'view']);
    expect(run.calls.some((args) => args[1] === 'edit')).toBe(false);
  });
});
