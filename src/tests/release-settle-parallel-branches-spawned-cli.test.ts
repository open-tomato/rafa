/**
 * `rafa release settle` (`src/commands/release/settle.ts`), spawned as
 * the real `rafa` binary — `src/tests/cli-capture.ts` — over two REAL
 * git branches that diverged from the same base commit (the shape a
 * "parallel" wrap-up leaves: two devices, or two plans on one device,
 * each finishing while the other is still in flight) and are merged into
 * `main` with plain `git merge`, no rafa command run for the merge itself.
 *
 * `release-settle-spawned-cli.test.ts` already proves the settle spawn
 * itself, over fragments a helper lands on `main` as flat commits; this
 * file's own question is narrower and disjoint from that one — whether
 * two branches that really diverged and were really merged, in either
 * merge order, land without a conflict and fold into the SAME version
 * through one settle, with a receipt naming both fragments. The merge
 * order changes which commit is the first-parent add of which fragment
 * (`src/release/fragment-tree.ts`'s module note: a fast-forwarded branch's
 * own commit is the add, a later branch's is added by the merge commit
 * that brings it in), so the two cases below assert the receipt's order
 * flips with it while the version does not.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { Fragment } from '../release/fragment.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { expectExit, plantProjectConfig, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { hostToolDirs } from './stand-in-gh.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-settle-parallel-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The manifest on `main` before any branch diverges from it. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0"\n}\n';

/** The changelog on `main` before any branch diverges from it. */
const CHANGELOG = '# Changelog\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every commit this file writes gets, isolated from the operator's clock. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git run (branching, merging, cloning) runs under, isolated from the operator's config. */
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

/** A bare origin, the clone that grows and merges the two branches, and the caller's own clone. */
interface World {
  readonly origin: string;
  /** The caller's clone, the spawned `rafa release settle` runs are spawned from here. */
  readonly scratch: ScratchRepo;
  /** The clone that creates `branch-a` and `branch-b` off `main` and merges them; plays the forge's own checkout. */
  readonly hub: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout and stderr trimmed and joined. */
  readonly git: (cwd: string, args: readonly string[]) => { readonly text: string; readonly exitCode: number };
}

/** Builds a {@link World}: a bare origin seeded with a manifest and a changelog on `main`, and the hub clone at that same tip. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const origin = join(dir, 'origin.git');
  const hub = join(dir, 'hub');
  const caller = join(dir, 'caller');
  for (const path of [home, bin]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[]): { text: string; exitCode: number } => {
    const run = Bun.spawnSync(['git', ...args], { cwd, env: isolatedEnv(home), stdout: 'pipe', stderr: 'pipe' });
    const stdout = new TextDecoder().decode(run.stdout);
    const stderr = new TextDecoder().decode(run.stderr);
    return { text: `${stdout}${stderr}`.trim(), exitCode: run.exitCode ?? 1 };
  };
  const run = (cwd: string, args: readonly string[]): string => {
    const result = git(cwd, args);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${result.text}`);
    return result.text;
  };

  run(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  run(dir, ['clone', '-q', origin, hub]);
  writeFileSync(join(hub, 'package.json'), MANIFEST);
  writeFileSync(join(hub, 'CHANGELOG.md'), CHANGELOG);
  run(hub, ['add', '-A']);
  run(hub, ['commit', '-q', '-m', 'first']);
  run(hub, ['push', '-q', 'origin', 'main']);

  run(dir, ['clone', '-q', origin, caller]);
  const settings: readonly (readonly [string, string])[] = [
    ['user.name', 'rafa settle'],
    ['user.email', 'settle@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ];
  for (const [key, value] of settings) run(caller, ['config', key, value]);
  run(caller, ['switch', '-q', '-c', 'feat']);
  // `.rafa/` holds the operator's own project config and state — ignored, the
  // way a real project's own `.gitignore` keeps it, so the caller's `git
  // status` reads clean around every command this file spawns.
  writeFileSync(join(caller, '.gitignore'), '.rafa/\n');
  run(caller, ['add', '-A']);
  run(caller, ['commit', '-q', '-m', 'ignore .rafa/']);
  plantProjectConfig(caller);

  const scratch: ScratchRepo = { repo: caller, home, bin, callLog: join(dir, 'calls.log'), path: [bin, ...hostToolDirs()].join(delimiter) };
  return { origin, scratch, hub, git };
}

/** One merge order this file drives two branches through. */
type MergeOrder = 'a-then-b' | 'b-then-a';

/** What {@link mergeParallelBranches} found about each merge it ran. */
interface MergeOutcome {
  /** Whether either merge's own output named a conflict. */
  readonly conflicted: boolean;
  /** `git status --porcelain` in the hub right after both merges landed. */
  readonly statusAfterMerge: string;
}

/**
 * In `w.hub`, branches `branch-a` and `branch-b` off `main`'s current tip
 * — so both start from the SAME commit, the shape two parallel wrap-ups
 * leave — each adding one fragment of its own name on one commit, then
 * merges both into `main` in `order` with `git merge --no-edit` (plain
 * git, no rafa command) and pushes `main`. Asserts neither merge's own
 * text named a conflict before answering, so a case that slips one gets a
 * loud, local failure rather than a silent gap in the outcome it returns.
 */
function mergeParallelBranches(w: World, order: MergeOrder): MergeOutcome {
  const run = (args: readonly string[]): string => {
    const result = w.git(w.hub, args);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${w.hub} failed: ${result.text}`);
    return result.text;
  };

  // Git prunes `.changes/` back out of the working tree on every `switch`
  // away from the branch that alone tracks it, so it is made fresh on each
  // branch rather than once up front.
  const changesDir = join(w.hub, '.changes');

  run(['switch', '-q', 'main']);
  run(['switch', '-q', '-c', 'branch-a']);
  mkdirSync(changesDir, { recursive: true });
  writeFileSync(join(changesDir, 'rafa-a.md'), fragmentText('rafa-a', 'minor', 'a feature'));
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'wrap-up rafa-a']);

  run(['switch', '-q', 'main']);
  run(['switch', '-q', '-c', 'branch-b']);
  mkdirSync(changesDir, { recursive: true });
  writeFileSync(join(changesDir, 'rafa-b.md'), fragmentText('rafa-b', 'patch', 'a fix'));
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'wrap-up rafa-b']);

  run(['switch', '-q', 'main']);
  const branches: readonly ['branch-a' | 'branch-b', 'branch-a' | 'branch-b'] = order === 'a-then-b'
    ? ['branch-a', 'branch-b']
    : ['branch-b', 'branch-a'];
  const merges = branches.map((branch) => w.git(w.hub, ['merge', '--no-edit', branch]));
  for (const merge of merges) {
    if (merge.exitCode !== 0) throw new Error(`git merge in ${w.hub} failed: ${merge.text}`);
  }
  const conflicted = merges.some((merge) => /conflict/i.test(merge.text));
  const statusAfterMerge = run(['status', '--porcelain']);
  run(['push', '-q', 'origin', 'main']);
  return { conflicted, statusAfterMerge };
}

/** Origin's `main` subject. */
function originSubject(w: World, ref = 'main'): string {
  return w.git(w.origin, ['log', '-1', '--format=%s', ref]).text;
}

/** The files origin's `main` holds under `.changes/`. */
function originFragments(w: World): string[] {
  const listed = w.git(w.origin, ['ls-tree', '--name-only', 'main', '.changes/']).text;
  return listed === ''
    ? []
    : listed.split('\n');
}

describe('rafa release settle, two branches wrapped up in parallel and merged into main by plain git', () => {
  it('branch-a merged first, then branch-b: no conflict, one version, receipt names rafa-a then rafa-b', () => {
    const w = world();
    const before = w.git(w.origin, ['rev-parse', 'main']).text;

    const outcome = mergeParallelBranches(w, 'a-then-b');

    expect(outcome.conflicted).toBe(false);
    expect(outcome.statusAfterMerge).toBe('');
    expect(originFragments(w)).toEqual(['.changes/rafa-a.md', '.changes/rafa-b.md']);
    expect(w.git(w.origin, ['rev-parse', 'main']).text).not.toBe(before);

    const settled = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    expectExit(settled, 0, w.scratch);
    expect(settled.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:package.json']).text).toContain('0.5.0');
    const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']).text;
    expect(changelog).toContain('## 0.5.0');
    expect(changelog).toContain('<!-- rafa:fragments rafa-a rafa-b -->');
    // The caller's own checkout stayed exactly as it was: settle works in a scratch worktree.
    expect(w.git(w.scratch.repo, ['status', '--porcelain']).text).toBe('');
    expect(w.git(w.scratch.repo, ['branch', '--show-current']).text).toBe('feat');
  });

  it('branch-b merged first, then branch-a: no conflict, the SAME version, receipt names rafa-b then rafa-a', () => {
    const w = world();
    const before = w.git(w.origin, ['rev-parse', 'main']).text;

    const outcome = mergeParallelBranches(w, 'b-then-a');

    expect(outcome.conflicted).toBe(false);
    expect(outcome.statusAfterMerge).toBe('');
    expect(originFragments(w)).toEqual(['.changes/rafa-a.md', '.changes/rafa-b.md']);
    expect(w.git(w.origin, ['rev-parse', 'main']).text).not.toBe(before);

    const settled = runRafa(w.scratch, w.scratch.repo, ['release', 'settle']);

    expectExit(settled, 0, w.scratch);
    expect(settled.stdout).toContain('✅ Pushed "chore: release 0.5.0"');
    expect(originSubject(w)).toBe('chore: release 0.5.0');
    expect(originFragments(w)).toEqual([]);
    expect(w.git(w.origin, ['show', 'main:package.json']).text).toContain('0.5.0');
    const changelog = w.git(w.origin, ['show', 'main:CHANGELOG.md']).text;
    expect(changelog).toContain('## 0.5.0');
    expect(changelog).toContain('<!-- rafa:fragments rafa-b rafa-a -->');
    // The caller's own checkout stayed exactly as it was: settle works in a scratch worktree.
    expect(w.git(w.scratch.repo, ['status', '--porcelain']).text).toBe('');
    expect(w.git(w.scratch.repo, ['branch', '--show-current']).text).toBe('feat');
  });
});
