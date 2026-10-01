/**
 * Spawned proof that the zsh prompt reads a run's phase: a real `zsh -f`
 * sources `extras/zsh/rafa-prompt/rafa-prompt.plugin.zsh` over run records
 * and trackers planted in a scratch project, and prints what
 * `_rafa_prompt_live_entry` sets for each live loop. In phase `task` the
 * entry is `#<n> <task>/<total>`, never past the total; in any other phase
 * it is `#<n> <phase>`. The tomato theme, which puts its 🍅 before the
 * entries, is sourced once to read the whole header.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

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
    env: { PATH: process.env.PATH ?? '', HOME: scratch, ROOT: root },
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

  test('caps the count at the total when every task is ticked', async () => {
    const root = await plantProject({ state: 'running', phase: 'task' }, 5, 5);
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

describe.skipIf(zshMissing)('the tomato header', () => {
  test('reads 🍅 #<n> wrap-up for a loop in its wrap-up', async () => {
    const root = await plantProject({ state: 'running', phase: 'wrap-up' }, 5, 5);
    const script = [
      `source ${JSON.stringify(THEME)}`,
      `typeset -gA rafa_git; rafa_git=(top $ROOT main $ROOT branch ${BRANCH})`,
      '_rafa_prompt_live_runs $ROOT',
      'local right=\'\'',
      '_tomato_right',
      'local zero=\'%([BSUbfksu]|([FK]|){*})\'',
      'print -r -- "${(S)right//$~zero/}"',
    ].join('\n');
    expect(await runZsh(script, root)).toBe('│ 🍅 #579 wrap-up');
  });
});
