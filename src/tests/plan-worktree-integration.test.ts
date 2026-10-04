/**
 * `rafa plan create` spawned from a linked worktree of a real git
 * repository: the integration proof that the dispatcher's project-root
 * fallback (`src/project/scope.ts`, `src/project/worktree-root.ts`) and
 * the planner's cwd fix for #171 (`src/adapters/planner/claude.ts`) work
 * together end to end, over a real `git worktree add` and a spawned
 * `bun src/rafa.ts`, rather than over either module's own seams.
 *
 * `src/project/scope-fallback.test.ts` already proves `resolveScope`
 * itself answers the main checkout from both a worktree beside the
 * repository and one nested under its `.rafa/worktrees`, running the
 * real git. What nothing else proves is the WHOLE run from either
 * worktree: that the dispatcher places the command in the main checkout
 * rather than refusing it with the `rafa init` hint, and that the plan a
 * stand-in `claude` writes under its own working directory lands under
 * the ONE `.rafa/plans` at the main checkout — never a second one the
 * nested worktree's own directory would hold, had the session been left
 * to inherit the caller's `cwd`.
 *
 * One main checkout holds both a worktree beside it and one nested under
 * `.rafa/worktrees`, as `worktree-root.test.ts` and
 * `scope-fallback.test.ts` plant them. `rafa plan create --spec=spec.md`
 * is spawned from each in turn, over a stand-in `claude` that writes the
 * plan under its OWN cwd rather than a fixed path, so a spawn left in the
 * worktree would write a plan this file could tell apart from one written
 * at the main checkout.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-worktree-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The spec every case's main checkout holds at `spec.md`. */
const SPEC = '# Spec: a worktree probe\n\nNothing to build.\n';

/** The environment `git` runs with in `scratch`'s repository and its worktrees. */
function gitEnv(scratch: ScratchRepo): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
  };
}

/** Runs `git` in `cwd` under `scratch`'s isolated environment. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, env: gitEnv(scratch), stdio: 'pipe' });
}

/** A main checkout holding `spec.md`, one commit, a worktree beside it and one under `.rafa/worktrees`. */
function plantRepository(): { scratch: ScratchRepo; beside: string; nested: string } {
  const scratch = plantScratchRepo(tempBase);
  writeFileSync(join(scratch.repo, 'spec.md'), SPEC, 'utf8');
  git(scratch, scratch.repo, ['add', 'spec.md']);
  git(scratch, scratch.repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);

  const root = dirname(scratch.repo);
  const beside = join(root, 'beside');
  git(scratch, scratch.repo, ['worktree', 'add', '-q', '-b', 'beside', beside]);

  const nested = join(scratch.repo, '.rafa', 'worktrees', 'task');
  git(scratch, scratch.repo, ['worktree', 'add', '-q', '-b', 'nested', nested]);

  return { scratch, beside, nested };
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/` that reads its
 * stdin, writes `PLAN-<stub>.md` under `.rafa/plans` relative to its OWN
 * working directory — the directory the session was spawned in, not a
 * fixed path — and exits 0. A session left in a worktree writes a plan
 * this file can tell apart from one written at the main checkout.
 */
function plantPlanningClaude(scratch: ScratchRepo, stub: string): void {
  const claude = join(scratch.bin, 'claude');
  const plan = [
    `# Plan: ${stub}`,
    '',
    '```rafa:plan',
    `stub: ${stub}`,
    '```',
    '',
    '- [ ] Do the thing',
    '',
  ].join('\n');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'mkdir -p .rafa/plans',
    `cat > .rafa/plans/PLAN-${stub}.md <<'PLAN_EOF'`,
    plan,
    'PLAN_EOF',
    `echo called >> '${scratch.callLog}'`,
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/** The plan path `PLAN-<stub>.md` is written to, under `root`'s `.rafa/plans`. */
function planPathUnder(root: string, stub: string): string {
  return join(root, '.rafa', 'plans', `PLAN-${stub}.md`);
}

describe('rafa plan create spawned from a linked worktree', () => {
  it('resolves the main checkout from a worktree beside it, and writes the plan under its .rafa/plans', () => {
    const { scratch, beside } = plantRepository();
    plantPlanningClaude(scratch, 'beside-probe');

    const run = runRafa(scratch, beside, ['plan', 'create', '--spec=spec.md', '--stub=beside-probe', '--no-progress']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('✅ Plan ready: .rafa/plans/PLAN-beside-probe.md');
    expect(existsSync(planPathUnder(scratch.repo, 'beside-probe'))).toBe(true);
    expect(existsSync(planPathUnder(beside, 'beside-probe'))).toBe(false);
  });

  it('resolves the main checkout from a worktree nested under .rafa/worktrees, planning into the one .rafa/', () => {
    const { scratch, nested } = plantRepository();
    plantPlanningClaude(scratch, 'nested-probe');

    const run = runRafa(scratch, nested, ['plan', 'create', '--spec=spec.md', '--stub=nested-probe', '--no-progress']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain('✅ Plan ready: .rafa/plans/PLAN-nested-probe.md');
    expect(existsSync(planPathUnder(scratch.repo, 'nested-probe'))).toBe(true);
    // The nested worktree gets no second `.rafa/plans` of its own: the
    // session ran at the main checkout, not left in the worktree it was
    // spawned from.
    expect(existsSync(planPathUnder(nested, 'nested-probe'))).toBe(false);
    expect(existsSync(join(nested, '.rafa', 'plans'))).toBe(false);
  });
});
