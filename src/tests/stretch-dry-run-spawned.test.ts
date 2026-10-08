/**
 * A spawned test of the three `rafa stretch` commands under `--dry-run`:
 * the real commands, run as `bun src/rafa.ts` in a scratch project whose
 * `origin` is a local bare repository, with `gh`, `tmux` and `claude`
 * replaced by stand-ins that log every call and change nothing (#816).
 *
 * Each of `stretch start`, `stretch item <n>` and `stretch end` run with
 * `--dry-run` must print every step it would take, in order, and change
 * nothing: the refs of the remote and the text of `.rafa/config.yaml` are
 * compared before and after, as are the files of the stretch folder, and
 * no stand-in is called with a line that writes. The refusals are read
 * too, each with exit 1, nothing run and the same two things unchanged:
 * a live stretch, a running loop, an item with `pr.base` on the default
 * branch, and an `end` with no `report.md`.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { expectExit, plantProjectConfig, plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const COMMENT = '# a comment the dry run must leave where it is';

/** A `pr.base` the item and end worlds start with. */
const STRETCH_BASE = 'stretch/7';

/** The issue the item runs name. */
const ISSUE = '812';

/** The words of a `gh` call that write to GitHub. */
const GH_WRITES = /\bpr (create|edit|merge|close|comment)\b|\bissue (create|edit|close|comment)\b/;

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-dry-run-spawned-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** A scratch project with a bare origin, and what the stand-ins logged. */
interface World {
  readonly scratch: ScratchRepo;
  readonly bare: string;
  readonly configPath: string;
  readonly ghLog: string;
  readonly tmuxLog: string;
}

/** The project config of a world: `pr.provider: gh`, `pr.base` when given, and a comment. */
function configText(prBase: string | null): string {
  return [
    COMMENT,
    'pr:',
    '  provider: gh',
    ...(prBase === null
      ? []
      : [`  base: ${prBase}`]),
    '',
  ].join('\n');
}

/** Runs git in `cwd` under the scratch HOME, so no host configuration reaches it. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
    },
  });
}

/** Writes an executable stand-in into the scratch `bin/`. */
function plantScript(scratch: ScratchRepo, name: string, lines: readonly string[]): void {
  const file = join(scratch.bin, name);
  writeFileSync(file, ['#!/bin/sh', ...lines, ''].join('\n'), 'utf8');
  chmodSync(file, 0o755);
}

/**
 * A stand-in `gh` that logs its words, signs in, answers every `pr list`
 * with no pull request, and refuses anything else with exit 1.
 */
function plantGh(scratch: ScratchRepo, log: string): void {
  plantScript(scratch, 'gh', [
    `echo "$*" >> '${log}'`,
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in"; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'echo "stand-in gh: unsupported: $*" >&2',
    'exit 1',
  ]);
}

/** A stand-in `tmux` that logs its words, reports no session open and starts none. */
function plantTmux(scratch: ScratchRepo, log: string): void {
  plantScript(scratch, 'tmux', [
    `echo "$*" >> '${log}'`,
    'exit 1',
  ]);
}

/**
 * A project on `main` with one commit pushed to a bare `origin` whose
 * `HEAD` is `main`, the stand-ins planted, and `.rafa/config.yaml` set by
 * `prBase`. `stretch/7` is pushed too when `prBase` names it.
 */
function plantWorld(prBase: string | null): World {
  const scratch = plantScratchRepo(scratchBase, { project: false });
  const bare = join(scratch.repo, '..', 'origin.git');
  git(scratch, scratch.repo, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(scratch, scratch.repo, ['checkout', '-q', '-b', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  git(scratch, scratch.repo, ['add', 'README.md']);
  git(scratch, scratch.repo, ['commit', '-q', '-m', 'init']);
  git(scratch, scratch.repo, ['remote', 'add', 'origin', bare]);
  git(scratch, scratch.repo, ['push', '-q', 'origin', 'main']);
  git(scratch, scratch.repo, ['remote', 'set-head', 'origin', 'main']);
  if (prBase === STRETCH_BASE) git(scratch, scratch.repo, ['push', '-q', 'origin', `main:refs/heads/${STRETCH_BASE}`]);

  const configPath = plantProjectConfig(scratch.repo, configText(prBase));
  const ghLog = join(scratch.repo, '..', 'gh.log');
  const tmuxLog = join(scratch.repo, '..', 'tmux.log');
  plantGh(scratch, ghLog);
  plantTmux(scratch, tmuxLog);
  plantStandInClaude(scratch);
  return { scratch, bare: realpathSync(bare), configPath, ghLog, tmuxLog };
}

/** Every ref of the remote with the commit it holds. */
function remoteRefs(world: World): string {
  return git(world.scratch, world.bare, ['for-each-ref', '--format=%(refname) %(objectname)']);
}

/** The relative path of every file under `dir`, sorted, or none when it is not there. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

/** What a dry run or a refusal must leave as it found it. */
interface Snapshot {
  readonly refs: string;
  readonly config: string;
  readonly stretchFiles: string[];
  readonly runFiles: string[];
}

function snapshot(world: World): Snapshot {
  const rafa = join(world.scratch.repo, '.rafa');
  return {
    refs: remoteRefs(world),
    config: readFileSync(world.configPath, 'utf8'),
    stretchFiles: filesUnder(join(rafa, 'stretch')),
    runFiles: filesUnder(join(rafa, 'runs')),
  };
}

/** The lines the stand-in at `log` was called with, none when it was never called. */
function calls(log: string): string[] {
  return existsSync(log)
    ? readFileSync(log, 'utf8').split('\n')
      .filter((line) => line !== '')
    : [];
}

/** Where `pattern` first matches in `text`, index -1 when it does not. */
function regexMatch(text: string, pattern: RegExp): { index: number; length: number } {
  const found = pattern.exec(text);
  return found === null
    ? { index: -1, length: 0 }
    : { index: found.index, length: found[0].length };
}

/** Fails unless every fragment is in `text`, each after the one before it. */
function expectInOrder(text: string, fragments: readonly (string | RegExp)[]): void {
  let from = 0;
  for (const fragment of fragments) {
    const rest = text.slice(from);
    const match = typeof fragment === 'string'
      ? { index: rest.indexOf(fragment), length: fragment.length }
      : regexMatch(rest, fragment);
    if (match.index < 0) {
      throw new Error(`expected ${String(fragment)} after offset ${String(from)} of:\n${text}`);
    }
    from += match.index + match.length;
  }
}

/** The output of a run, both streams: info lines go to either. */
function said(run: { stdout: string; stderr: string }): string {
  return `${run.stdout}\n${run.stderr}`;
}

/** Plants the `agent.json` of a live engineer in stretch `n`: its pid is this test's, which is alive. */
function plantLiveStretch(world: World, n: number): void {
  const folder = join(world.scratch.repo, '.rafa', 'stretch', String(n));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'agent.json'), `${JSON.stringify({ sessionId: 'engineer-1', pid: process.pid, state: 'running' })}\n`, 'utf8');
}

/** Plants the session record of a loop on `stub` that runs: its pid is this test's, which is alive. */
function plantRunningLoop(world: World, stub: string): void {
  const dir = join(world.scratch.repo, '.rafa', 'runs');
  mkdirSync(dir, { recursive: true });
  const record = {
    sessionId: 'loop-1',
    planStub: stub,
    plan: `.rafa/plans/PLAN-${stub}.md`,
    branch: `rafa/${stub}`,
    pid: process.pid,
    startedAt: '2026-10-01T10:00:00.000Z',
    state: 'running',
    task: null,
  };
  writeFileSync(join(dir, 'loop-1.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** Plants a plan of the issue in `plan.dir`, so `stretch item` keeps it and reads its loop. */
function plantPlan(world: World, stub: string): string {
  const dir = join(world.scratch.repo, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `PLAN-${stub}.md`);
  writeFileSync(file, '# Plan: scratch\n', 'utf8');
  return file;
}

/** Asserts a refusal: exit 1, the words in the message, and nothing the snapshot holds changed. */
function expectRefused(world: World, before: Snapshot, run: ReturnType<typeof runRafa>, words: readonly string[]): void {
  expectExit(run, 1, world.scratch);
  for (const word of words) expect(said(run)).toContain(word);
  expect(snapshot(world)).toEqual(before);
  expect(calls(world.ghLog).filter((line) => GH_WRITES.test(line))).toEqual([]);
  expect(calls(world.tmuxLog).filter((line) => !line.startsWith('has-session'))).toEqual([]);
}

describe('rafa stretch start --dry-run, spawned', () => {
  let world: World;

  beforeEach(() => {
    world = plantWorld(null);
  });

  it('prints every step in order and changes nothing', () => {
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'start', '--dry-run']);

    expectExit(run, 0, world.scratch);
    const out = said(run);
    const folder = join(world.scratch.repo, '.rafa', 'stretch', '1');
    expectInOrder(out, [
      'stretch 1: stretch/1, dry run: each step is printed and none is run',
      'git fetch origin main',
      'git push origin origin/main:refs/heads/stretch/1',
      `record pr.base (not set) in ${join(folder, 'stretch.json')}`,
      'rafa config set pr.base=stretch/1',
      'cp -R ',
      join(folder, 'operators'),
      'operators: rafa ',
      /tmux new-session -d -s stretch-\S+-1 /,
      /tmux new-window -t '?=stretch-\S+-1:'? /,
      /tmux new-window -t '?=stretch-\S+-1:'? /,
      /tmux select-window -t '?=stretch-\S+-1:engineer'?/,
      'dry run: would start stretch 1 in tmux session',
      'nothing was run',
    ]);
    expect(out).toContain('--role=engineer --n=1');
    expect(out).toContain('--role=watchtower --n=1');
    expect(out).toContain('--role=analyst --n=1');

    expect(snapshot(world)).toEqual(before);
    expect(readFileSync(world.configPath, 'utf8')).toContain(COMMENT);
    expect(existsSync(join(world.scratch.repo, '.rafa', 'stretch'))).toBe(false);
    expect(calls(world.ghLog).filter((line) => GH_WRITES.test(line))).toEqual([]);
    expect(calls(world.tmuxLog).filter((line) => !line.startsWith('has-session'))).toEqual([]);
    expect(existsSync(world.scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);

  it('refuses while a stretch of the project is live, and changes nothing', () => {
    plantLiveStretch(world, 1);
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'start', '--dry-run']);

    expectRefused(world, before, run, ['a stretch of this project is live', 'stretch 1: agent.json reads running', 'Nothing was pushed, set or copied']);
  }, RUN_TIMEOUT);

  it('refuses while a loop of the project runs, and changes nothing', () => {
    plantRunningLoop(world, 'rafa-5-other');
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'start', '--dry-run']);

    expectRefused(world, before, run, ['loop(s) of this project run', 'loop on rafa/rafa-5-other', 'Nothing was pushed, set or copied']);
  }, RUN_TIMEOUT);
});

describe('rafa stretch item --dry-run, spawned', () => {
  let world: World;

  beforeEach(() => {
    world = plantWorld(STRETCH_BASE);
  });

  it('prints the plan and loop lines in order and changes nothing', () => {
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'item', ISSUE, '--dry-run']);

    expectExit(run, 0, world.scratch);
    const log = join(world.scratch.repo, '.rafa', 'stretch', '7', `loop-${ISSUE}.log`);
    expectInOrder(said(run), [
      `stretch item #${ISSUE}: stretch 7 (pr.base stretch/7), dry run: each step is printed and none is run`,
      `rafa plan create --issue=${ISSUE}`,
      `RAFA_OUTPUT=events rafa loop start --plan=.rafa/plans/PLAN-rafa-${ISSUE}-<slug>.md --as-worktree --no-ci-wait`,
      log,
      `dry run: would start the loop of #${ISSUE} for stretch/7; nothing was run`,
    ]);

    expect(snapshot(world)).toEqual(before);
    expect(existsSync(log)).toBe(false);
    expect(calls(world.ghLog)).toEqual([]);
    expect(existsSync(world.scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);

  it('prints the kept plan, the loop, the wait and the merge half with --wait, in order', () => {
    const stub = `rafa-${ISSUE}-fix-it`;
    plantPlan(world, stub);
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'item', ISSUE, '--wait', '--dry-run']);

    expectExit(run, 0, world.scratch);
    const items = join(world.scratch.repo, '.rafa', 'stretch', '7', 'items.ndjson');
    expectInOrder(said(run), [
      'dry run: each step is printed and none is run',
      `keep .rafa/plans/PLAN-${stub}.md, written by an earlier plan create`,
      `RAFA_OUTPUT=events rafa loop start --plan=.rafa/plans/PLAN-${stub}.md --as-worktree --no-ci-wait`,
      'rafa loop wait --session-id=<session id>',
      'rafa pr merge <pr> ',
      '--skip-checks',
      'gh run list',
      `append the item to ${items}`,
      'print the pit-stop readings of stretch/7',
      `dry run: would start the loop of #${ISSUE} for stretch/7; nothing was run`,
    ]);
    expect(said(run)).not.toContain('rafa plan create');

    expect(snapshot(world)).toEqual(before);
    expect(calls(world.ghLog)).toEqual([]);
  }, RUN_TIMEOUT);

  it('refuses a loop of the issue that runs, and changes nothing', () => {
    const stub = `rafa-${ISSUE}-fix-it`;
    plantPlan(world, stub);
    plantRunningLoop(world, stub);
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'item', ISSUE, '--dry-run']);

    expectRefused(world, before, run, [`a loop of ${stub} runs already`, 'rafa loop wait --session-id=loop-1', 'Nothing was run']);
  }, RUN_TIMEOUT);

  it('refuses a pr.base on the default branch, and changes nothing', () => {
    const onMain = plantWorld('main');
    const before = snapshot(onMain);

    const run = runRafa(onMain.scratch, onMain.scratch.repo, ['stretch', 'item', ISSUE, '--dry-run']);

    expectRefused(onMain, before, run, ['pr.base is "main"', 'expected a stretch/<n> branch', 'never the default branch', 'Nothing was run']);
  }, RUN_TIMEOUT);

  it('refuses a project with no pr.base, which opens pull requests into the default branch', () => {
    const unset = plantWorld(null);
    const before = snapshot(unset);

    const run = runRafa(unset.scratch, unset.scratch.repo, ['stretch', 'item', ISSUE, '--dry-run']);

    expectRefused(unset, before, run, ['pr.base is not set', 'expected a stretch/<n> branch']);
  }, RUN_TIMEOUT);
});

describe('rafa stretch end --dry-run, spawned', () => {
  let world: World;

  beforeEach(() => {
    world = plantWorld(STRETCH_BASE);
  });

  /** Writes the stretch report, the body of the pull request into the default branch. */
  function plantReport(): string {
    const folder = join(world.scratch.repo, '.rafa', 'stretch', '7');
    mkdirSync(folder, { recursive: true });
    const report = join(folder, 'report.md');
    writeFileSync(report, '# Stretch 7\n\nThree fixes.\n', 'utf8');
    return report;
  }

  it('prints the body file and the pr open line in order and changes nothing', () => {
    plantReport();
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'end', '--dry-run']);

    expectExit(run, 0, world.scratch);
    const folder = join(world.scratch.repo, '.rafa', 'stretch', '7');
    expectInOrder(said(run), [
      'stretch end: stretch 7 (stretch/7 into main), 0 Closes line(s) from the ledger, dry run: each step is printed and none is run',
      `write ${join(folder, 'pr-body.md')}: report.md with the ledger's Closes lines`,
      `rafa pr open --head=stretch/7 --base=main '--title=Stretch 7' --body-file=${join(folder, 'pr-body.md')}`,
      'dry run: would open stretch/7 into main, or print the pull request already open from it; nothing was run',
    ]);

    expect(snapshot(world)).toEqual(before);
    expect(existsSync(join(folder, 'pr-body.md'))).toBe(false);
    expect(readFileSync(world.configPath, 'utf8')).toContain(COMMENT);
    // The one thing it reads from GitHub is the list of merged pull requests.
    expect(calls(world.ghLog).filter((line) => GH_WRITES.test(line))).toEqual([]);
    expect(calls(world.ghLog).some((line) => line.startsWith('pr list --state merged'))).toBe(true);
  }, RUN_TIMEOUT);

  it('refuses with no report.md, and changes nothing', () => {
    const before = snapshot(world);

    const run = runRafa(world.scratch, world.scratch.repo, ['stretch', 'end', '--dry-run']);

    expectRefused(world, before, run, ['there is no ', 'report.md', 'write the stretch report first', 'Nothing was run']);
    expect(calls(world.ghLog)).toEqual([]);
  }, RUN_TIMEOUT);
});
