/**
 * `rafa release settle` (`src/commands/release/settle.ts`), spawned as
 * the real `rafa` binary — `src/tests/cli-capture.ts` — racing for the
 * same push over one bare origin.
 *
 * `src/release/settle-push.test.ts` already proves the refused-push rule
 * in-process: it wraps `SettleWorktree.git` so a chosen push is preceded
 * by a commit the test lands itself, SIMULATING a race inside one call.
 * This file's own question is narrower and disjoint from that one —
 * whether the rule holds when the race is real: two separate `rafa
 * release settle` processes, spawned the way an operator's shell would,
 * genuinely competing for `origin/main`'s ref, and one settle whose base
 * moves between its own two push attempts.
 *
 * Two real processes cannot be timed to the millisecond, so the settle
 * that must lose is held at its own push by a stand-in `git` planted
 * ahead of the real one on its PATH ({@link plantPushGate}): every verb
 * but `push` execs the real git straight through; a `push` first marks
 * itself ready and then waits for the test to say go before it execs —
 * so a case can let the winner's push land first, or land a fragment on
 * the base, before the held push ever reaches git. Only the settle that
 * must be paused gets the stand-in; the other runs over the plain git
 * already on `PATH`.
 *
 * One case: two settles fold the same two fragments; the winner's spawn
 * runs to completion first, and only then is the loser's held push let
 * through, so it is refused and finds every fragment it folded already
 * gone. Another: one settle's base gains a fragment between its own
 * first push and its one retry, and gains another between the retry and
 * a third attempt that never happens — the retried push is refused too,
 * and settle exits 1 without trying a third time.
 */
import type { ScratchRepo, CapturedRun } from './cli-capture.js';
import type { Fragment } from '../release/fragment.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** The CLI entry an asynchronously spawned run executes; mirrors `cli-capture.ts`'s own. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long a spawned run may take before this file gives up waiting on it. */
const SPAWN_TIMEOUT_MS = 30_000;

/** How long a case may wait for a held push to reach its gate. */
const GATE_TIMEOUT_MS = 15_000;

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-race-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The manifest on `main` before any settle runs. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main` before any settle runs. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets, isolated from the operator's clock. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git run (landing fragments, cloning) runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A fragment's text, one note. */
function fragmentText(plan: string, level: Fragment['level'], note: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes: [`- ${note}`] });
}

/** A bare origin, and the clone that lands fragments on `main` the way a merge would. */
interface World {
  readonly origin: string;
  /** The directory every caller clone and every control directory this world makes sits under. */
  readonly dir: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes (text) or deletes (`null`) each path in the landing clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string | null>>, message: string) => void;
}

/** Builds a {@link World}: a bare origin, seeded with a manifest and a changelog on `main`. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const other = join(dir, 'other');
  mkdirSync(home, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string | null>>, message: string): void => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        git(other, ['rm', '-q', '--', path]);
        continue;
      }
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message]);
    git(other, ['push', '-q', 'origin', 'main']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'package.json'), MANIFEST);
  writeFileSync(join(other, 'CHANGELOG.md'), CHANGELOG);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  return { origin, dir, git, land };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch) on `main`. */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', 'a feature') }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', 'a fix') }, 'merge rafa-1');
}

/**
 * Clones `w`'s origin into a fresh caller repository named `name`, on
 * `feat`, configured as its own project with an identity of its own —
 * so two callers over the same origin never build byte-identical commits.
 */
function caller(w: World, name: string): ScratchRepo {
  const dir = join(w.dir, name);
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const repo = join(dir, 'repo');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  w.git(w.dir, ['clone', '-q', w.origin, repo]);
  const settings: readonly (readonly [string, string])[] = [
    ['user.name', `rafa settle ${name}`],
    ['user.email', `${name}@example.invalid`],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(w.dir, 'no-hooks')],
  ];
  for (const [key, value] of settings) w.git(repo, ['config', key, value]);
  w.git(repo, ['switch', '-q', '-c', 'feat']);
  // `.rafa/` holds the operator's own project config and state — ignored, so
  // the caller's `git status` reads clean around every command this file spawns.
  writeFileSync(join(repo, '.gitignore'), '.rafa/\n');
  w.git(repo, ['add', '-A']);
  w.git(repo, ['commit', '-q', '-m', 'ignore .rafa/']);
  plantProjectConfig(repo);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, bin, callLog: join(dir, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
}

/**
 * Writes a stand-in `git` into `scratch`'s own `bin/`, ahead of the real
 * one on its PATH: every verb but `push` execs the real git straight
 * through. A `push` first counts itself against `<control>/push-count`,
 * marks `<control>/ready-<n>` and then waits for `<control>/go-<n>`
 * before it execs — so a case can hold one settle's push, or each of a
 * settle's own retried pushes, open only when it says so.
 */
function plantPushGate(scratch: ScratchRepo, control: string): void {
  mkdirSync(control, { recursive: true });
  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const script = [
    '#!/bin/sh',
    // The scratch PATH this script itself resolved through is deliberately
    // narrow (its own `bin/` and git's directory, so `claude` resolves to
    // nothing); widened here, after that resolution, so `cat` and `sleep`
    // below resolve too.
    'PATH="/bin:/usr/bin:$PATH"',
    `CONTROL='${control}'`,
    `REAL_GIT='${gitBinary}'`,
    'if [ "$1" = "push" ]; then',
    '  n=$(( $(cat "$CONTROL/push-count" 2>/dev/null || echo 0) + 1 ))',
    '  echo "$n" > "$CONTROL/push-count"',
    '  : > "$CONTROL/ready-$n"',
    '  while [ ! -f "$CONTROL/go-$n" ]; do',
    '    sleep 0.02',
    '  done',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n');
  const git = join(scratch.bin, 'git');
  writeFileSync(git, script, 'utf8');
  chmodSync(git, 0o755);
}

/** Polls for `path` to exist, throwing past `timeoutMs`. */
async function waitForFile(path: string, timeoutMs = GATE_TIMEOUT_MS, pollMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await Bun.sleep(pollMs);
  }
}

/** The `n`-th push's ready file under `control`. */
function readyFile(control: string, n: number): string {
  return join(control, `ready-${String(n)}`);
}

/** Writes the `n`-th push's go file under `control`, letting a held push through. */
function letThrough(control: string, n: number): void {
  writeFileSync(join(control, `go-${String(n)}`), '');
}

/**
 * {@link scratchHomeEnv} with the shared test identity taken back out, so a
 * spawned settle commits under its caller's own `user.name` and
 * `user.email` (see {@link caller}): under the one identity both racing
 * settles would build the same release commit, and the losing push would
 * find nothing to refuse.
 */
function ownIdentityHomeEnv(home: string): Readonly<Record<string, string>> {
  const shared = gitIdentityEnv();
  return Object.fromEntries(Object.entries(scratchHomeEnv(home)).filter(([key]) => !(key in shared)));
}

/**
 * Spawns `bun src/rafa.ts` with `words` in `cwd`, under `scratch`'s PATH
 * and HOME, without waiting for it: the async twin of `runRafa`, needed
 * here because a case must act (let another settle finish, or land a
 * fragment) WHILE this run sits paused at its own gated push.
 */
function spawnRafaAsync(scratch: ScratchRepo, cwd: string, words: readonly string[]): Promise<CapturedRun> {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== null && resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${resolved}, not to the stand-in or to nothing`);
  }
  const proc = Bun.spawn([process.execPath, RAFA_ENTRY, ...words], {
    cwd,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...ownIdentityHomeEnv(scratch.home) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return (async (): Promise<CapturedRun> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  })();
}

/** Origin's `main` subject. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]);
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']);
  return listed === ''
    ? []
    : listed.split('\n');
}

describe('rafa release settle, two real spawns racing for the same push', () => {
  it(
    'the winner pushes; the loser\'s held push is then refused and it exits 0, finding every fragment it folded already gone',
    async () => {
      const w = world();
      landTwo(w);
      const winner = caller(w, 'winner');
      const loser = caller(w, 'loser');
      const control = join(w.dir, 'control');
      plantPushGate(loser, control);

      const losing = spawnRafaAsync(loser, loser.repo, ['release', 'settle']);
      // The loser has fetched, built and reached its own push, but not yet
      // run it — so it folded the base exactly as the winner is about to.
      await waitForFile(readyFile(control, 1));

      const won = runRafa(winner, winner.repo, ['release', 'settle']);

      expect(won.exitCode).toBe(0);
      expect(won.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
      expect(originSubject(w)).toBe('chore: release 0.5.0');
      expect(originFragments(w)).toEqual([]);
      const winningCommit = w.git(w.origin, ['rev-parse', 'main']);

      letThrough(control, 1);
      const lost = await losing;

      expect(lost.exitCode).toBe(0);
      expect(lost.stdout).toContain(`every fragment this settle folded is gone from origin/main: ${winningCommit.slice(0, 12)} "chore: release 0.5.0" released them first`);
      expect(lost.stdout).not.toContain('Pushed');
      // The winner's push is the only one that changed `main`.
      expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(winningCommit);
      // The loser's own checkout was never touched: settle works in a scratch worktree.
      expect(w.git(loser.repo, ['status', '--porcelain'])).toBe('');
      expect(w.git(loser.repo, ['branch', '--show-current'])).toBe('feat');
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('rafa release settle, spawned with its base moving between its own two pushes', () => {
  it(
    'retries once over the fragment that arrived, and exits 1 when the retried push is refused too',
    async () => {
      const w = world();
      landTwo(w);
      const settling = caller(w, 'settling');
      const control = join(w.dir, 'control');
      plantPushGate(settling, control);

      const running = spawnRafaAsync(settling, settling.repo, ['release', 'settle']);

      await waitForFile(readyFile(control, 1));
      w.land({ '.changes/rafa-4.md': fragmentText('rafa-4', 'patch', 'a late fix') }, 'merge rafa-4');
      letThrough(control, 1);

      // The first push was refused (rafa-4 is on `main` now, so settle is
      // rebuilding, not finding itself superseded); its one retry is about
      // to run the same way.
      await waitForFile(readyFile(control, 2));
      w.land({ '.changes/rafa-5.md': fragmentText('rafa-5', 'patch', 'a later fix') }, 'merge rafa-5');
      letThrough(control, 2);

      const settled = await running;

      expect(settled.exitCode).toBe(1);
      expect(settled.stderr).toContain('origin main moved again while settle rebuilt, and the retried push of chore: release 0.5.0 was refused too');
      expect(settled.stderr).toContain('[rejected]');
      // Settle retries once, so a third push never ran: `rafa-5` stayed the
      // merge nobody folded, and every fragment is still waiting on `main`.
      expect(originSubject(w)).toBe('merge rafa-5');
      expect(originFragments(w)).toEqual(['.changes/rafa-1.md', '.changes/rafa-4.md', '.changes/rafa-5.md', '.changes/rafa-9.md']);
    },
    SPAWN_TIMEOUT_MS,
  );
});
