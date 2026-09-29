/**
 * `rafa next --yes=merge,settle` over a real scratch repository: the
 * same shape `next-chain-integration.test.ts` drives from a green open
 * pull request, but the branch it merges carries a fragment, and the
 * `PullRequests` double's own `merge` answer is made real enough to
 * land it — a real `git push feat/rafa-63:main` onto the bare
 * `origin.git`, the way GitHub's own squash-merge would — so that the
 * settle step `rafa next` proposes after the merge (`../next/settle-step.ts`)
 * has something real to fold: a version bump written, a changelog
 * section receipted, and the fragment gone, all on the bare origin, not
 * on a double's own memory.
 *
 * This is therefore the first suite to walk the two commands `rafa next`
 * puts back to back around a merge that leaves a fragment — `pr merge`,
 * whose own follow-up line names `rafa release settle`, and `release
 * settle`, `rafa next`'s own workflow action for it — as ONE spawned
 * `rafa next` invocation would, over a repository real enough that the
 * merge's landing on the base, the settle's scratch worktree and its
 * push to the bare origin are all real git rather than a scripted
 * answer.
 *
 * `merge-settle.test.ts` already proves the follow-up line `pr merge`
 * prints over the same shape of world, in-process; this file's own
 * question is whether `rafa next`, spawned as a process and run with
 * `--yes=merge,settle`, carries that fragment all the way to a version
 * on the bare origin without asking. `next-chain-fixtures.ts` is shared
 * with `next-chain-integration.test.ts`: the scratch repository's git
 * helper, the roadmap `gh` stand-in and the harness that spawns a probe
 * and reads back what it logged. Neither `plan create` nor `loop start`
 * runs here: the ceiling this file names stops the chain right after
 * `settle`, at the `sync` its own push leaves behind — the local base is
 * now behind the `origin/main` settle just pushed to — one step short of
 * the plan the roadmap would propose after that, so the probe registers
 * no planner and no loop-start double.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { serializeFragment } from '../release/fragment.js';

import { plantProjectConfig } from './cli-capture.js';
import {
  BASE, CONFIG_TEXT, git, makeTempBase, NEXT_ISSUE, NEXT_TITLE, OLD_BRANCH, PR_DETAIL,
  PR_NUMBER, PR_SUMMARY, type Scratch, SRC_DIR, runProbe, writeStandInGh,
} from './next-chain-fixtures.js';

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = makeTempBase('rafa-next-merge-settle-spawned-');

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base version, before the settle folds the merged fragment in. */
const BASE_VERSION = '0.4.0';

/** The version a minor fragment folds `BASE_VERSION` into. */
const FOLDED_VERSION = '0.5.0';

/** The plan the merged branch's fragment names, and the fold's receipt names back. */
const PLAN_ID = 'rafa-63';

/** The one undone roadmap line, so the chain has one more step past `settle` to stop short of. */
const ROADMAP_BODY = `- [ ] #${NEXT_ISSUE} — ${NEXT_TITLE}\n`;

/** The manifest committed on `BASE` before any merge or settle runs. */
const MANIFEST = JSON.stringify({ name: 'demo', version: BASE_VERSION }, null, 2) + '\n';

/** The changelog committed on `BASE` before any merge or settle runs. */
const CHANGELOG = '# Changelog\n\n## 0.3.0 — 2026-08-01, older\n\n- Loop: an older line\n';

/** The fragment the merged branch carries: a shipping bump, folded into {@link FOLDED_VERSION}. */
const FRAGMENT_TEXT = serializeFragment({
  plan: PLAN_ID,
  title: 'One command, the next step',
  level: 'minor',
  notes: ['- next: a change worth a minor bump'],
});

/**
 * Writes a stand-in `claude` that fails loudly rather than run: nothing
 * this probe does should ever reach it, since the chain stops at
 * `settle`, before any plan or loop session would be asked for.
 */
function writeStandInClaude(bin: string): void {
  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'echo "the stand-in claude ran" >&2', 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * The probe: one program composing `rafa next`, a real `pr merge` and a
 * real `release settle`, over a `PullRequests` double whose `merge`
 * lands the branch for real and a git seam that pushes every real call
 * onto the shared `events` log before running it. Every ending — a
 * clean run or a throw — writes `{ events, outcome }` to `recordPath`,
 * its first command-line argument; the rest is `rafa next`'s own words.
 */
function buildProbe(): string {
  return [
    'import { writeFileSync } from "node:fs";',
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createNextCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'next.ts'))};`,
    `import { createPrMergeCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'pr', 'merge.ts'))};`,
    `import { createReleaseSettleCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'release', 'settle.ts'))};`,
    `import { createGitRunner } from ${JSON.stringify(join(SRC_DIR, 'pr', 'index.ts'))};`,
    `import { createPullRequestsDouble } from ${JSON.stringify(join(SRC_DIR, 'pr', 'pull-requests-double.ts'))};`,
    '',
    'const [recordPath, ...nextArgv] = process.argv.slice(2);',
    'const events = [];',
    '',
    `const BASE = ${JSON.stringify(BASE)};`,
    `const OLD_BRANCH = ${JSON.stringify(OLD_BRANCH)};`,
    '',
    '/** The real git runner, wrapped to push every call onto the shared log before running it. */',
    'function wrapGit(root) {',
    '  const real = createGitRunner(root);',
    '  return (args) => {',
    '    events.push("git " + args.join(" "));',
    '    return real(args);',
    '  };',
    '}',
    '',
    `const summary = ${JSON.stringify(PR_SUMMARY)};`,
    `const detail = ${JSON.stringify(PR_DETAIL)};`,
    '',
    '/**',
    ' * The provider double: `merge` pushes the head branch onto the base as a',
    ' * fast-forward, exactly as `merge-settle.test.ts` makes its own stub',
    ' * real enough to land the branch, so the clean-up\'s own `git pull`',
    ' * brings the fragment onto `origin/main` the way a real GitHub merge',
    ' * would, before it ever reaches settle.',
    ' */',
    'const prDouble = createPullRequestsDouble({',
    '  findOpen: (branch) => Promise.resolve(branch === OLD_BRANCH ? summary : null),',
    '  get: () => Promise.resolve(detail),',
    '  checks: () => Promise.resolve({ rows: [], verdict: "green" }),',
    '  merge: () => {',
    '    events.push("merge");',
    '    const pushed = wrapGit(process.cwd())(["push", "-q", "origin", OLD_BRANCH + ":" + BASE]);',
    '    if (!pushed.ok) throw new Error("the double could not land the branch: " + pushed.stdout);',
    '    return Promise.resolve({ merged: true, detail: "Squashed and merged pull request" });',
    '  },',
    '});',
    '',
    'const nextCommand = createNextCommand({',
    '  isTerminal: () => false,',
    '  openGit: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  openPrompter: () => {',
    '    throw new Error("rafa next opened a prompter: this probe always passes a --yes wide enough to skip it");',
    '  },',
    '});',
    '',
    'const mergeCommand = createPrMergeCommand({',
    '  git: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  isTerminal: () => true,',
    '  openPrompter: () => {',
    '    throw new Error("pr merge should not ask: rafa next always passes --yes");',
    '  },',
    '});',
    '',
    'const settleCommand = createReleaseSettleCommand({ git: wrapGit });',
    '',
    'const commands = createCommandRegistry({',
    '  subjects: [',
    '    { name: "pr", summary: "pull requests" },',
    '    { name: "release", summary: "releases" },',
    '  ],',
    '  commands: [nextCommand, mergeCommand, settleCommand],',
    '});',
    '',
    'let outcome = { ok: false };',
    'try {',
    '  const result = await dispatch(["next", ...nextArgv], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode, result: result.result };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/**
 * Plants a work tree on {@link BASE} with a manifest, a changelog and a
 * `.gitignore`, pushed to a bare `origin.git` beside it, then
 * {@link OLD_BRANCH} off it adding one source file and a fragment that
 * ships a minor bump, pushed too and left checked out — the same shape
 * `merge-settle.test.ts` plants, over `next-chain-integration.test.ts`'s
 * own scratch harness.
 */
function plantScratch(): Scratch {
  const root = mkdtempSync(join(tempBase, 'repo-'));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  expect(git(root, home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare).ok).toBe(true);
  expect(git(root, home, 'init', '-q', `--initial-branch=${BASE}`, work).ok).toBe(true);
  // `.rafa/` is ignored from the first commit, so planting the project's
  // config after never dirties the tree.
  writeFileSync(join(work, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(work, 'package.json'), MANIFEST, 'utf8');
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG, 'utf8');
  expect(git(work, home, 'add', '.gitignore', 'package.json', 'CHANGELOG.md').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'first').ok).toBe(true);
  expect(git(work, home, 'remote', 'add', 'origin', bare).ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BASE).ok).toBe(true);
  expect(git(work, home, 'switch', '-q', '-c', OLD_BRANCH).ok).toBe(true);
  mkdirSync(join(work, '.changes'), { recursive: true });
  writeFileSync(join(work, 'feature.txt'), 'a feature\n', 'utf8');
  writeFileSync(join(work, '.changes', `${PLAN_ID}.md`), FRAGMENT_TEXT, 'utf8');
  expect(git(work, home, 'add', 'feature.txt', '.changes').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'feature').ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', OLD_BRANCH).ok).toBe(true);
  plantProjectConfig(work, CONFIG_TEXT);

  writeStandInGh(bin, ROADMAP_BODY);
  writeStandInClaude(bin);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, buildProbe(), 'utf8');

  return { root, work, home, probe, path };
}

describe('rafa next --yes=merge,settle, over a real repository from a fragment-carrying pull request to a settled version', () => {
  it('merges the pull request over the double, landing the fragment on the base, then settles it into one version on the bare origin', () => {
    const scratch = plantScratch();
    const bare = join(scratch.root, 'origin.git');

    const { record, stdout } = runProbe(scratch, ['--yes=merge,settle']);

    if (!record.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(record.outcome)}\nstdout:\n${stdout}`);
    }

    // The merge ran over the double, then the clean-up's own checkout and
    // pull, before the settle's own fetch and push — all in that order.
    const mergedAt = record.events.indexOf('merge');
    const switchedAt = record.events.indexOf(`git switch ${BASE}`);
    const pulledAt = record.events.indexOf('git pull --ff-only');
    expect(mergedAt).toBeGreaterThanOrEqual(0);
    expect(switchedAt).toBeGreaterThan(mergedAt);
    expect(pulledAt).toBeGreaterThan(switchedAt);

    // The two proposals `rafa next` reads, both printed before either runs.
    expect(stdout).toContain(`👉 merge #${PR_NUMBER} into \`${BASE}\``);
    expect(stdout).toContain(`📍 1 fragment waits on \`${BASE}\` and folds into ${FOLDED_VERSION}.`);
    expect(stdout).toContain(`👉 settle the fragments on \`${BASE}\` into ${FOLDED_VERSION} — rafa release settle`);
    expect(stdout).toContain(`✅ Pushed "chore: release ${FOLDED_VERSION}"`);

    // Read off the bare origin itself, not the log: the version is
    // bumped, the changelog carries the new section and its receipt, the
    // fragment is gone, and the release commit is the base's own HEAD.
    expect(git(bare, scratch.home, 'log', '-1', '--format=%s', BASE).stdout).toBe(`chore: release ${FOLDED_VERSION}`);
    expect(git(bare, scratch.home, 'show', `${BASE}:package.json`).stdout).toContain(FOLDED_VERSION);
    const changelog = git(bare, scratch.home, 'show', `${BASE}:CHANGELOG.md`).stdout;
    expect(changelog).toContain(`## ${FOLDED_VERSION}`);
    expect(changelog).toContain(`<!-- rafa:fragments ${PLAN_ID} -->`);
    expect(git(bare, scratch.home, 'ls-tree', '--name-only', BASE, '.changes/').stdout).toBe('');

    // The chain reads once more after the settle it just ran, finds the
    // local base behind the `origin/main` settle just pushed to, and
    // stops there unasked: this ceiling names `merge` and `settle` alone,
    // so the fast-forward, and the roadmap's next line behind it, never run.
    expect(stdout).toContain(`👉 fast-forward \`${BASE}\` to \`origin/${BASE}\``);
    expect(stdout).toContain('allows merge, settle, and this step is sync, so nothing ran');
    expect(record.events.includes('plan create')).toBe(false);
    expect(stdout).not.toContain(`#${NEXT_ISSUE} is next on the roadmap`);
  }, 30_000);
});
