/**
 * Tests for the epic guard step of `rafa init` (`init-board.ts`) under
 * `board.relationships: native`: `--epic-guard` is refused with a line
 * naming the mode, and nothing is asked, read or written.
 *
 * Each native case has its labels-mode control over the same board and
 * the same flags, which installs the workflow, so a reading of "nothing
 * written" is shown to be one that could have found a file.
 *
 * The step cases hand in a board step result that ran, since the guard
 * reads only its status; what the board step itself does is held in
 * `init-board.test.ts`. The command cases dispatch `rafa init` over a
 * repository whose `.rafa/config.yaml` already names the mode, through
 * seams and a recorded `gh` fake, so the mode is read the way `init`
 * reads it and no case reaches GitHub.
 */
import type { BoardStepResult } from './init-board.js';
import type { InitResult, InitSeams } from './init.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../cli/prompt/confirm.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { EPIC_GUARD_PATH } from '../board/epic-guard.js';
import { dispatchCaptured, eventsOf } from '../tests/cli-capture.js';

import {
  EPIC_GUARD_NATIVE_REFUSAL,
  epicGuardChanged,
  renderEpicGuardStep,
  runEpicGuardStep,
} from './init-board.js';
import { createInitCommand, DEFAULT_INIT_SEAMS } from './init.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-board-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A board step that ran, which is all the guard step reads of it. */
const BOARD_RAN: BoardStepResult = Object.freeze({
  status: 'ran',
  asked: false,
  report: { parts: [], roadmapIssue: null, problems: [] },
  warnings: [],
});

/** A fresh directory under this file's own temporary root. */
function freshDir(label: string): string {
  return mkdtempSync(join(tempBase, `${label}-`));
}

/** A prompter nobody may open. */
function noPrompter(): Prompter {
  throw new Error('the epic guard step opened a prompter where none was expected');
}

/** True when the workflow file is under `root`. */
function guardUnder(root: string): boolean {
  return existsSync(join(root, EPIC_GUARD_PATH));
}

describe('the epic guard step under board.relationships: native', () => {
  it('refuses --epic-guard with a line naming the mode, and writes nothing; labels mode installs it', async () => {
    const nativeRoot = freshDir('native-flag');
    const labelsRoot = freshDir('labels-flag');
    const options = { wanted: true, board: BOARD_RAN, isTerminal: () => true, openPrompter: noPrompter };

    const native = await runEpicGuardStep({ ...options, relationships: 'native', root: nativeRoot });
    const labels = await runEpicGuardStep({ ...options, relationships: 'labels', root: labelsRoot });

    expect(native).toEqual({ status: 'native', asked: false, part: null, warnings: [EPIC_GUARD_NATIVE_REFUSAL] });
    expect(EPIC_GUARD_NATIVE_REFUSAL).toStartWith('board.relationships is native: ');
    expect(epicGuardChanged(native)).toBe(false);
    expect(renderEpicGuardStep(native)).toEqual([]);
    expect(guardUnder(nativeRoot)).toBe(false);
    expect([labels.status, labels.part?.outcome]).toEqual(['ran', 'created']);
    expect(guardUnder(labelsRoot)).toBe(true);
  });

  it('asks nothing on a terminal and warns nothing when no flag was said; labels mode asks', async () => {
    const nativeRoot = freshDir('native-asked');
    const labelsRoot = freshDir('labels-asked');
    const asked: string[] = [];
    const prompter: Prompter = {
      say: () => undefined,
      ask: (question) => {
        asked.push(question);
        return Promise.resolve('n');
      },
      close: () => undefined,
    };
    const options = { wanted: null, board: BOARD_RAN, isTerminal: () => true };

    const native = await runEpicGuardStep({ ...options, relationships: 'native', root: nativeRoot, openPrompter: noPrompter });
    const labels = await runEpicGuardStep({
      ...options,
      relationships: 'labels',
      root: labelsRoot,
      openPrompter: () => prompter,
    });

    expect(native).toEqual({ status: 'native', asked: false, part: null, warnings: [] });
    expect([labels.status, labels.asked]).toEqual(['declined', true]);
    expect(asked).toHaveLength(1);
  });

  it('leaves a workflow already present unreported, and --no-epic-guard warns nothing', async () => {
    const root = freshDir('native-present');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, EPIC_GUARD_PATH), 'name: an old guard\n', 'utf8');
    const options = { board: BOARD_RAN, relationships: 'native', root, isTerminal: () => true, openPrompter: noPrompter } as const;

    const present = await runEpicGuardStep({ ...options, wanted: null });
    const declined = await runEpicGuardStep({ ...options, wanted: false });

    expect(present).toEqual({ status: 'native', asked: false, part: null, warnings: [] });
    expect(declined).toEqual({ status: 'native', asked: false, part: null, warnings: [] });
  });

  it('still says the board did not run before it says the mode', async () => {
    const root = freshDir('native-no-board');
    const board: BoardStepResult = { status: 'declined', asked: false, report: null, warnings: [] };

    const result = await runEpicGuardStep({
      wanted: true,
      board,
      relationships: 'native',
      root,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result.status).toBe('not-run');
  });
});

/** A `gh` runner answering what the board step sends, recording each route. */
function fakeGh(): { run: GhRunner; routes: () => readonly string[] } {
  const routes: string[] = [];
  const labels: string[] = [];
  const run: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    routes.push(route);
    const ok = (stdout: string) => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'label list') return ok(JSON.stringify(labels.map((name) => ({ name }))));
    if (route === 'label create') {
      labels.push(args[2] ?? '');
      return ok('');
    }
    if (route === 'issue list') return ok('[]');
    if (route === 'issue create') return ok('https://github.com/acme/widgets/issues/7\n');
    if (route === 'issue pin') return ok('');
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${route}` });
  };
  return { run, routes: () => [...routes] };
}

/** A repository whose `.rafa/config.yaml` names `mode`, and a home beside it. */
function plantProject(label: string, mode: 'labels' | 'native'): { repo: string; home: string } {
  const base = freshDir(label);
  const repo = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(join(repo, '.rafa'), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(repo, '.rafa', 'config.yaml'), `board:\n  relationships: ${mode}\n`, 'utf8');
  return { repo, home };
}

/** The seams of a project on GitHub, with no terminal and a recorded `gh`. */
function seamsOn(project: { repo: string; home: string }, gh: GhRunner): InitSeams {
  return {
    ...DEFAULT_INIT_SEAMS,
    cwd: () => project.repo,
    home: () => project.home,
    entry: () => join(project.home, 'dist', 'cli.js'),
    isTerminal: () => false,
    openPrompter: noPrompter,
    gitToplevel: (dir) => dir === project.repo
      ? project.repo
      : null,
    readRemote: () => 'https://github.com/acme/widgets.git',
    gh: () => gh,
  };
}

/** Runs `rafa init --board --epic-guard` in json mode over a project naming `mode`. */
async function initGuarded(label: string, mode: 'labels' | 'native') {
  const project = plantProject(label, mode);
  const gh = fakeGh();
  const words = ['init', `--root=${project.repo}`, '--board', '--epic-guard', '--output=json'];
  const run = await dispatchCaptured(words, [], [createInitCommand(seamsOn(project, gh.run))], {
    PATH: join(project.home, '.rafa', 'bin'),
  });
  const result = eventsOf(run.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;
  return { project, gh, run, result: result?.data as InitResult };
}

describe('rafa init --board --epic-guard reads the mode off the project config', () => {
  it('refuses the guard in native mode with the line naming the mode; the labels control installs it', async () => {
    const native = await initGuarded('init-native', 'native');
    const labels = await initGuarded('init-labels', 'labels');

    expect(native.run.exitCode).toBe(0);
    expect(native.result.epicGuard).toEqual({ status: 'native', asked: false, part: null, warnings: [EPIC_GUARD_NATIVE_REFUSAL] });
    expect(JSON.stringify(eventsOf(native.run.stdout))).toContain('board.relationships is native');
    expect(guardUnder(native.project.repo)).toBe(false);
    expect(native.result.board.status).toBe('ran');
    expect(labels.run.exitCode).toBe(0);
    expect(labels.result.epicGuard.status).toBe('ran');
    expect(guardUnder(labels.project.repo)).toBe(true);
    expect(native.gh.routes()).toEqual(labels.gh.routes());
  });
});
