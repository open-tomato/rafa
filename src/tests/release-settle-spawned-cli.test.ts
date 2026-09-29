/**
 * `rafa release settle [--dry-run]` (`src/commands/release/settle.ts`)
 * spawned as the real `rafa` binary — `runRafa`, `src/tests/cli-capture.ts`
 * — over a bare origin and two clones: one landing fragments on `main` the
 * way a merge would, the other the caller's own checkout, on a feature
 * branch, that every `rafa release settle` in this file runs from.
 *
 * `src/commands/release/settle.test.ts` and `src/release/settle-push.test.ts`
 * already drive the same shape in-process, over `dispatchInProject` and
 * `withSettleWorktree` directly; this file's own question is narrower and
 * disjoint from both — whether the REGISTERED command, spawned as a
 * separate process the way an operator's shell would run it, reaches the
 * real git binary, a real scratch worktree and a real push the same way.
 * One case: a dry run that leaves the caller's checkout clean, a settle
 * that writes one version and one receipted changelog section and pushes
 * it to the bare origin, and a second settle over the now-empty batch
 * that exits 0 and writes nothing more.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { Fragment } from '../release/fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { plantProjectConfig, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-spawned-')));

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
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: SETUP_DATE,
    GIT_COMMITTER_DATE: SETUP_DATE,
    LC_ALL: 'C',
  };
}

/** A fragment's text, one note. */
function fragmentText(plan: string, level: Fragment['level'], note: string): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes: [`- ${note}`] });
}

/** A bare origin, a clone that lands fragments on `main`, and the caller's own clone. */
interface World {
  readonly origin: string;
  /** The caller's clone, spawned `rafa` runs are spawned from here. */
  readonly scratch: ScratchRepo;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes each path in the landing clone, commits and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string) => void;
}

/** Builds a {@link World}: the caller's clone is on `feat`, with no work in flight, so its `git status` reads clean. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string>>, message: string): void => {
    git(other, ['pull', '-q', '--ff-only', 'origin', 'main']);
    for (const [path, text] of Object.entries(files)) {
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

  git(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [
    ['user.name', 'rafa settle'],
    ['user.email', 'settle@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ];
  for (const [key, value] of settings) git(caller, ['config', key, value]);
  git(caller, ['switch', '-q', '-c', 'feat']);
  // `.rafa/` holds the operator's own project config and state — ignored, the
  // way a real project's own `.gitignore` keeps it, so the caller's `git
  // status` reads clean around every command this file spawns.
  writeFileSync(join(caller, '.gitignore'), '.rafa/\n');
  git(caller, ['add', '-A']);
  git(caller, ['commit', '-q', '-m', 'ignore .rafa/']);
  plantProjectConfig(caller);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const scratch: ScratchRepo = { repo: caller, home, bin, callLog: join(dir, 'calls.log'), path: [bin, dirname(gitBinary)].join(delimiter) };
  return { origin, scratch, git, land };
}

/** Lands `rafa-9` (minor) and then `rafa-1` (patch) on `main`. */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', 'a feature') }, 'merge rafa-9');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', 'a fix') }, 'merge rafa-1');
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

describe('rafa release settle, spawned over a bare origin and two clones', () => {
  it(
    '--dry-run leaves the caller\'s git status clean; a settle writes one version and one receipted section, pushed to main; a second settle exits 0 writing nothing',
    () => {
      const w = world();
      landTwo(w);
      const before = w.git(w.origin, ['rev-parse', 'main']);

      const dry = runRafa(w.scratch, w.scratch.repo, ['release', 'settle', '--dry-run']);

      expect(dry.exitCode).toBe(0);
      expect(dry.stdout).toContain('Strategy: semver-by-level');
      expect(dry.stdout).toContain('Version: 0.4.0 → 0.5.0');
      expect(dry.stdout).toContain('Dry run: settle would commit "chore: release 0.5.0" on main; nothing was written.');
      expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(before);
      expect(w.git(w.scratch.repo, ['status', '--porcelain'])).toBe('');
      expect(w.git(w.scratch.repo, ['branch', '--show-current'])).toBe('feat');

      const settled = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

      expect(settled.exitCode).toBe(0);
      expect(settled.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
      expect(originSubject(w)).toBe('chore: release 0.5.0');
      expect(originFragments(w)).toEqual([]);
      expect(w.git(w.origin, ['show', 'main:package.json'])).toContain('0.5.0');
      const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']);
      expect(changelog).toContain('## 0.5.0');
      expect(changelog).toContain('<!-- rafa:fragments rafa-9 rafa-1 -->');
      const released = w.git(w.origin, ['rev-parse', 'main']);
      expect(released).not.toBe(before);
      // The caller's own checkout stayed exactly as it was: settle works in a scratch worktree.
      expect(w.git(w.scratch.repo, ['status', '--porcelain'])).toBe('');
      expect(w.git(w.scratch.repo, ['branch', '--show-current'])).toBe('feat');

      const second = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain('Nothing to settle');
      expect(second.stdout).not.toContain('Pushed');
      expect(w.git(w.origin, ['rev-parse', 'main'])).toBe(released);
    },
  );
});
