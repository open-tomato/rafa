/**
 * Spawned proof that the zsh prompt reads a run's phase: a real `zsh -f`
 * sources `extras/zsh/rafa-prompt/rafa-prompt.plugin.zsh` over run records
 * and trackers planted in a scratch project, and prints what
 * `_rafa_prompt_live_entry` sets for each live loop. In phase `task` the
 * entry is `#<n> <task>/<total>`, never past the total; in any other phase
 * it is `#<n> <phase>`, and a running loop whose tracker has every task
 * ticked reads `#<n> wrap-up` when its phase reads `task` or is absent.
 * `_rafa_prompt_task_segment` reads the same phase through
 * `_rafa_prompt_read`, and the tomato theme, which puts its 🍅 before the
 * entries, is sourced to read the whole header.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { scratchHomeEnv } from './scratch-home-env.js';

const EXTRAS = join(import.meta.dir, '..', '..', 'extras', 'zsh');
const PLUGIN = join(EXTRAS, 'rafa-prompt', 'rafa-prompt.plugin.zsh');
const THEME = join(EXTRAS, 'tomato', 'tomato.zsh-theme');

const STUB = 'rafa-579-loop-run-ends-delivered';
const BRANCH = `feat/${STUB}`;
const PLAN_DIR = join('.rafa', 'plans');

/** What a planted run record says beyond its branch and plan. */
interface PlantedRun {
  readonly state: 'running' | 'paused';
  /** Left out of the record when `undefined`, as an older rafa wrote it. */
  readonly phase?: string;
}

let scratch = '';
let counter = 0;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rafa-prompt-phase-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A tracker body with `done` ticked tasks and `open` unticked ones. */
function trackerBody(done: number, open: number): string {
  const ticked = Array.from({ length: done }, (_, index) => `- [x] Task ${index + 1}`);
  const unticked = Array.from({ length: open }, (_, index) => `- [ ] Task ${done + index + 1}`);
  return ['# Plan: Loop run ends delivered', '', ...ticked, ...unticked, ''].join('\n');
}

/**
 * Plants a project root holding one run record for {@link BRANCH}, alive
 * under this test's own pid, and a tracker with `done` of `total` ticked.
 * The record is written as `src/loop/sessions.ts` writes one, two-space
 * JSON, since the plugin reads it with regexes over that text.
 */
async function plantProject(run: PlantedRun, done: number, total: number): Promise<string> {
  counter += 1;
  const root = join(scratch, `project-${counter}`);
  await mkdir(join(root, '.rafa', 'runs'), { recursive: true });
  await mkdir(join(root, PLAN_DIR), { recursive: true });
  const body = trackerBody(done, total - done);
  await Bun.write(join(root, PLAN_DIR, `PLAN-${STUB}.md`), body);
  await Bun.write(join(root, PLAN_DIR, `PLAN_TRACKER-${STUB}.md`), body);
  const record = {
    sessionId: `session-${counter}`,
    pid: process.pid,
    branch: BRANCH,
    planStub: STUB,
    plan: join(PLAN_DIR, `PLAN-${STUB}.md`),
    state: run.state,
    task: null,
    ...run.phase === undefined
      ? {}
      : { phase: run.phase },
  };
  await Bun.write(join(root, '.rafa', 'runs', `session-${counter}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return root;
}

/** Runs `script` in `zsh -f` with ROOT set, and returns its trimmed stdout. */
async function runZsh(script: string, root: string): Promise<string> {
  const child = Bun.spawn(['zsh', '-f', '-c', script], {
    env: { TMPDIR: tmpdir(), PATH: process.env.PATH ?? '', ...scratchHomeEnv(scratch), ROOT: root },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  return stdout.trim();
}

/** Every live entry the plugin reads under `root`, one per line. */
async function liveEntries(root: string): Promise<string> {
  const script = [
    `source ${JSON.stringify(PLUGIN)}`,
    '_rafa_prompt_live_runs $ROOT',
    'for entry in $rafa_live_runs; do _rafa_prompt_live_entry "$entry"; print -r -- "$REPLY"; done',
  ].join('\n');
  return runZsh(script, root);
}

/** The plugin's own task segment for {@link BRANCH} under `root`, colors stripped. */
async function taskSegment(root: string): Promise<string> {
  const script = [
    `source ${JSON.stringify(PLUGIN)}`,
    `typeset -gA rafa_git; rafa_git=(top $ROOT main $ROOT branch ${BRANCH})`,
    '_rafa_prompt_read reuse',
    '_rafa_prompt_task_segment',
    'local zero=\'%([BSUbfksu]|([FK]|){*})\'',
    'print -r -- "${(S)REPLY//$~zero/}"',
  ].join('\n');
  return runZsh(script, root);
}

/** The tomato theme's whole top right for {@link BRANCH} under `root`, colors stripped. */
async function tomatoHeader(root: string): Promise<string> {
  const script = [
    `source ${JSON.stringify(THEME)}`,
    `typeset -gA rafa_git; rafa_git=(top $ROOT main $ROOT branch ${BRANCH})`,
    '_rafa_prompt_live_runs $ROOT',
    'local right=\'\'',
    '_tomato_right',
    'local zero=\'%([BSUbfksu]|([FK]|){*})\'',
    'print -r -- "${(S)right//$~zero/}"',
  ].join('\n');
  return runZsh(script, root);
}

/** The phases a fully ticked tracker is read under: absent, `task` and `wrap-up`. */
const FULLY_TICKED: readonly { readonly name: string; readonly phase?: string }[] = [
  { name: 'no phase' },
  { name: 'phase task', phase: 'task' },
  { name: 'phase wrap-up', phase: 'wrap-up' },
];

const zshMissing = Bun.which('zsh') === null;

describe.skipIf(zshMissing)('_rafa_prompt_live_entry', () => {
  test('shows the task in progress in phase task', async () => {
    const root = await plantProject({ state: 'running', phase: 'task' }, 2, 5);
    expect(await liveEntries(root)).toBe('#579 3/5');
  });

  test('shows the tasks done for a paused loop in phase task', async () => {
    const root = await plantProject({ state: 'paused', phase: 'task' }, 2, 5);
    expect(await liveEntries(root)).toBe('#579 2/5');
  });

  for (const { name, phase } of FULLY_TICKED) {
    test(`shows wrap-up for a running loop with every task ticked and ${name}`, async () => {
      const root = await plantProject({ state: 'running', phase }, 5, 5);
      expect(await liveEntries(root)).toBe('#579 wrap-up');
    });
  }

  test('keeps the tasks done for a paused loop with every task ticked in phase task', async () => {
    const root = await plantProject({ state: 'paused', phase: 'task' }, 5, 5);
    expect(await liveEntries(root)).toBe('#579 5/5');
  });

  test('reads a record with no phase, from an older rafa, as task', async () => {
    const root = await plantProject({ state: 'running' }, 2, 5);
    expect(await liveEntries(root)).toBe('#579 3/5');
  });

  test('reads a phase it does not know as task', async () => {
    const root = await plantProject({ state: 'running', phase: 'party%F{red}' }, 2, 5);
    expect(await liveEntries(root)).toBe('#579 3/5');
  });

  for (const phase of ['wrap-up', 'pull-request', 'ci', 'repair']) {
    test(`shows the phase ${phase} instead of a count`, async () => {
      const root = await plantProject({ state: 'running', phase }, 5, 5);
      expect(await liveEntries(root)).toBe(`#579 ${phase}`);
    });
  }

  test('shows the phase for a paused loop outside phase task', async () => {
    const root = await plantProject({ state: 'paused', phase: 'ci' }, 5, 5);
    expect(await liveEntries(root)).toBe('#579 ci');
  });
});

describe.skipIf(zshMissing)('_rafa_prompt_task_segment', () => {
  test('shows the task in progress for a running loop in phase task', async () => {
    const root = await plantProject({ state: 'running', phase: 'task' }, 2, 5);
    expect(await taskSegment(root)).toBe('🍅 #579 3/5');
  });

  test('never counts past the total, even with no task at all', async () => {
    const root = await plantProject({ state: 'running', phase: 'task' }, 0, 0);
    expect(await taskSegment(root)).toBe('🍅 #579 0/0');
  });

  for (const { name, phase } of FULLY_TICKED) {
    test(`shows wrap-up for a running loop with every task ticked and ${name}`, async () => {
      const root = await plantProject({ state: 'running', phase }, 5, 5);
      expect(await taskSegment(root)).toBe('🍅 #579 wrap-up');
    });
  }

  test('shows the record\'s phase other than task', async () => {
    const root = await plantProject({ state: 'running', phase: 'ci' }, 5, 5);
    expect(await taskSegment(root)).toBe('🍅 #579 ci');
  });

  test('keeps the paused reading with every task ticked', async () => {
    const root = await plantProject({ state: 'paused', phase: 'task' }, 5, 5);
    expect(await taskSegment(root)).toBe('⏸ #579 paused 5/5');
  });
});

describe.skipIf(zshMissing)('the tomato header', () => {
  for (const { name, phase } of FULLY_TICKED) {
    test(`reads 🍅 #<n> wrap-up for a running loop with every task ticked and ${name}`, async () => {
      const root = await plantProject({ state: 'running', phase }, 5, 5);
      expect(await tomatoHeader(root)).toBe('│ 🍅 #579 wrap-up');
    });
  }

  test('reads the task in progress while tasks are open', async () => {
    const root = await plantProject({ state: 'running', phase: 'task' }, 2, 5);
    expect(await tomatoHeader(root)).toBe('│ 🍅 #579 3/5');
  });
});
