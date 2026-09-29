/**
 * Tests for step 3 of the release (`src/release/verify.ts`): the three
 * readings over the fragment a wrap-up session left — it parses, it
 * carries the plan's level, it is the only file the release step
 * changed — and the restore of step 1's fragment text on every refusal.
 *
 * Each case builds scratch repositories of its own under `mkdtemp` — a
 * bare `origin` and the working clone — never the checkout the suite
 * runs in, and runs the REAL step 1 over it, so the record every case
 * verifies against is the one `prepareRelease` actually answers. The
 * runner handed to both modules is the real one: which files changed is
 * git's own answer, not a planted reply. No case reaches a network:
 * `origin` is a path.
 *
 * What a session did is planted by writing over files between step 1
 * and step 3, which is exactly the seam the real session sits in.
 *
 * Several things here would pass while wrong, so each has an assertion
 * of its own:
 *
 *  - A module that restored on EVERY call would satisfy every refusal
 *    case. So the rewrite case reads the fragment back and asserts the
 *    session's text is still on disk.
 *  - A module that refused every change anywhere would pass every
 *    planted-edit case. So one case leaves session work outside the
 *    release files — a tracked source edit and an untracked file — and
 *    still verifies.
 *  - A stray fragment beside the plan's own, in a directory step 1
 *    just made, is one the plan's-own-path filter could fold in. So
 *    one case plants a second fragment there, untracked with the
 *    directory as a whole.
 *  - A module that compared the working tree only, not the index,
 *    passes an edit the session staged and then reverted on disk. So
 *    one case stages a changelog edit and puts the file back.
 *  - A restore that wrote `before` instead of `after` would still put
 *    a file back. Step 1's `before` is null here — the file is new — so
 *    every refusal case compares the fragment byte for byte against
 *    step 1's `after`.
 *
 * Seven mutations of `verify.ts` were driven on 2026-09-29, one at a
 * time over `env -u CLAUDECODE bun test src/release/verify.test.ts`,
 * the module restored from a scratch copy and verified with `shasum -c`
 * after each. 17 cases, all green on the unmutated module; each fail
 * count is that run's own:
 *
 *  - `--untracked-files=all` dropped: 14 fail. Git then names the new
 *    `.changes/` directory, not the fragment in it, so every case
 *    refuses — the verified ones included — as `other-file-changed`.
 *  - the files beside the fragment ignored: 4 fail, the changelog
 *    edit, the bumped version, the stray fragment and the staged edit.
 *  - `git diff HEAD --name-only` in place of `git status`: 4 fail,
 *    among them the staged-then-put-back edit, the one case only an
 *    index-aware reading catches (the other three fail because a
 *    `--name-only` line has no status letters to slice off).
 *  - the restore dropped: 7 fail, the refusal cases that read the
 *    fragment back or ask what the restore did.
 *  - the restore writing `before` instead of `after`: 6 fail, the same
 *    cases but the restore-failure one, whose write fails either way.
 *  - the level check dropped: 2 fail, the changed level and the
 *    restore-failure case built on one.
 *  - the plan check dropped: 1 fails, the fragment naming another plan.
 */
import type { ChangelogNote } from './changelog.js';
import type { ReleasePrepared, ReleaseSettings } from './prepare.js';
import type { ReleaseVerificationContext } from './verify.js';
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RELEASE_AUTO } from '../config-sections.js';
import { createGitRunner } from '../pr/index.js';

import { prepareRelease } from './prepare.js';
import { verifyRelease } from './verify.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-verify-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The manifest the base branch holds; the release step must not change it. */
const MANIFEST = '{\n  "name": "scratch",\n  "version": "0.4.0",\n  "private": true\n}\n';

/** A changelog shaped as this repository's is; the release step must not change it. */
const CHANGELOG = [
  '# Changelog',
  '',
  '## 0.4.0 — 2026-09-19, the one before',
  '',
  '- loop: the loop learned to stop',
  '',
].join('\n');

/** The plan id every case writes under. */
const PLAN = 'rafa-367';

/** The settings every case starts from. */
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
};

/** Two raw notes in one area, which a session would fold into one line. */
const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the loop writes a fragment itself' },
  { level: 'patch', area: 'loop', summary: 'a task reports what its diff is worth' },
];

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** A working clone with step 1 already run in it. */
interface World {
  /** The working clone's root. */
  readonly root: string;
  /** Runs git in the working clone with this world's isolated config. */
  readonly git: (args: readonly string[]) => string;
  /** The real runner the modules are handed. */
  readonly runner: GitRunner;
  /** What step 1 answered. */
  readonly prepared: ReleasePrepared;
  /** The context step 3 is handed. */
  readonly context: ReleaseVerificationContext;
}

/**
 * Plants a bare origin whose `main` holds the manifest, the changelog
 * and a source file, clones it, and runs step 1 in the clone at
 * `declared`.
 */
function world(declared: 'minor' | 'none' = 'minor'): World {
  worldCount += 1;
  const at = join(tempBase, `world-${String(worldCount)}`);
  const home = join(at, 'home');
  const origin = join(at, 'origin.git');
  const root = join(at, 'work');
  mkdirSync(home, { recursive: true });
  const env = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    LC_ALL: 'C',
  };
  const run = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    [...args],
    { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

  run(at, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  run(at, ['clone', '-q', origin, root]);
  run(root, ['checkout', '-q', '-B', 'main']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), MANIFEST);
  writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
  writeFileSync(join(root, 'src', 'loop.ts'), 'export const loop = 1;\n');
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '-m', 'seed main']);
  run(root, ['push', '-q', 'origin', 'main']);

  const runner = createGitRunner(root);
  const prepared = prepareRelease({
    repoRoot: root,
    settings: SETTINGS,
    git: runner,
    plan: PLAN,
    declared,
    notes: NOTES,
    title: 'releases settle on the base branch',
  });
  if (prepared.kind !== 'prepared') throw new Error(`step 1 wrote nothing: ${prepared.sentence}`);
  return {
    root,
    git: (args) => run(root, args),
    runner,
    prepared,
    context: { git: runner, settings: SETTINGS },
  };
}

/** `path`'s text, or null when it is not there. */
function textAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The fragment a session that did as it was told leaves: one line per area. */
function rewritten(prepared: ReleasePrepared): string {
  return prepared.file.after.replace(
    /\n- loop: [^\n]*\n- loop: [^\n]*\n$/,
    '\n- loop: the loop writes a fragment itself and reports what a diff is worth\n',
  );
}

describe('verifyRelease over a session that did as it was told', () => {
  it('verifies the notes rewritten into one line, and leaves the session\'s text on disk', () => {
    const at = world();
    const text = rewritten(at.prepared);
    expect(text).not.toBe(at.prepared.file.after);
    writeFileSync(at.prepared.file.resolved, text);

    const read = verifyRelease(at.prepared, at.context);

    expect(read).toEqual({
      kind: 'verified',
      path: '.changes/rafa-367.md',
      fragment: {
        plan: PLAN,
        title: 'releases settle on the base branch',
        level: 'minor',
        notes: ['- loop: the loop writes a fragment itself and reports what a diff is worth'],
      },
      text,
    });
    expect(textAt(at.prepared.file.resolved)).toBe(text);
  });

  it('verifies a fragment the session did not touch', () => {
    const at = world();

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('verified');
    expect(read.kind === 'verified' && read.text).toBe(at.prepared.file.after);
  });

  it('verifies a none fragment, which carries no notes', () => {
    const at = world('none');

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('verified');
    expect(read.kind === 'verified' && read.fragment.level).toBe('none');
  });

  it('lets the session reword the title, which is its to reword', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace('title: releases', 'title: Releases'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind === 'verified' && read.fragment.title).toBe('Releases settle on the base branch');
  });

  it('does not read the session\'s work outside the release files', () => {
    const at = world();
    writeFileSync(join(at.root, 'src', 'loop.ts'), 'export const loop = 2;\n');
    writeFileSync(join(at.root, 'notes.txt'), 'a leftover\n');

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('verified');
  });

  it('does not refuse a changelog change the session committed, such as a merge from the base', () => {
    const at = world();
    writeFileSync(join(at.root, 'CHANGELOG.md'), `${CHANGELOG}\n- a line from the base\n`);
    at.git(['commit', '-q', '-m', 'merge main', '--', 'CHANGELOG.md']);

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('verified');
  });
});

describe('verifyRelease over a planted edit outside the fragment', () => {
  it('refuses an edit to the changelog, restores the fragment, and leaves the changelog as the session left it', () => {
    const at = world();
    const planted = CHANGELOG.replace('learned to stop', 'learned to stop and start');
    writeFileSync(join(at.root, 'CHANGELOG.md'), planted);
    writeFileSync(at.prepared.file.resolved, rewritten(at.prepared));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('other-file-changed');
    expect(read.sentence).toBe(
      'no release commit: the release step may change .changes/rafa-367.md alone, yet CHANGELOG.md was changed too'
      + ' and was left as the wrap-up session left it, out of any release commit,'
      + ' and .changes/rafa-367.md was restored to the text the loop wrote',
    );
    expect(read.restore).toEqual({ path: '.changes/rafa-367.md', restored: true, problem: null });
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
    expect(textAt(join(at.root, 'CHANGELOG.md'))).toBe(planted);
  });

  it('refuses a version the session bumped, naming every file beside the fragment', () => {
    const at = world();
    writeFileSync(join(at.root, 'package.json'), MANIFEST.replace('0.4.0', '0.5.0'));
    rmSync(join(at.root, 'CHANGELOG.md'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('other-file-changed');
    expect(read.sentence).toContain('yet CHANGELOG.md and package.json were changed too and were left as the wrap-up session left them');
  });

  it('refuses a second fragment inside the directory step 1 just made', () => {
    const at = world();
    const stray = join(at.root, '.changes', 'rafa-999.md');
    writeFileSync(stray, at.prepared.file.after.replace(`plan: ${PLAN}`, 'plan: rafa-999'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('other-file-changed');
    expect(read.sentence).toContain('yet .changes/rafa-999.md was changed too');
    expect(textAt(stray)).not.toBeNull();
  });

  it('refuses a changelog edit the session staged and then put back on disk', () => {
    const at = world();
    writeFileSync(join(at.root, 'CHANGELOG.md'), `${CHANGELOG}- staged\n`);
    at.git(['add', 'CHANGELOG.md']);
    writeFileSync(join(at.root, 'CHANGELOG.md'), CHANGELOG);

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind === 'refused' && read.reason).toBe('other-file-changed');
  });

  it('refuses when git cannot say what changed, and still restores the fragment', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, rewritten(at.prepared));
    const failing: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });

    const read = verifyRelease(at.prepared, { ...at.context, git: failing });

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('status-unreadable');
    expect(read.sentence).toContain('git status could not say which of package.json, CHANGELOG.md and .changes changed: fatal: not a git repository');
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
  });
});

describe('verifyRelease over a fragment the session broke', () => {
  it('refuses a fragment that no longer parses, and writes step 1\'s text back', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace(/^---\n/, ''));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('fragment-unparsable');
    expect(read.sentence).toContain('.changes/rafa-367.md no longer parses as a fragment: The fragment does not open with a --- line.');
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
  });

  it('refuses a shipping fragment whose notes the session removed', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace(/\n\n- [\s\S]*$/, '\n'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind === 'refused' && read.reason).toBe('fragment-unparsable');
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
  });

  it('refuses a fragment whose level is not the plan\'s', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace('level: minor', 'level: major'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('level-changed');
    expect(read.sentence).toContain('.changes/rafa-367.md carries the level major, not the plan\'s minor');
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
  });

  it('refuses a fragment that names another plan', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace(`plan: ${PLAN}`, 'plan: rafa-1'));

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('plan-changed');
    expect(read.sentence).toContain('names the plan rafa-1, not the rafa-367 the loop wrote');
  });

  it('refuses a fragment the session deleted, and writes it back', () => {
    const at = world();
    rmSync(at.prepared.file.resolved);

    const read = verifyRelease(at.prepared, at.context);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('fragment-unreadable');
    expect(read.sentence).toContain('.changes/rafa-367.md could not be read back after the wrap-up session');
    expect(textAt(at.prepared.file.resolved)).toBe(at.prepared.file.after);
  });

  it('says the fragment could not be restored when the restore itself fails', () => {
    const at = world();
    writeFileSync(at.prepared.file.resolved, at.prepared.file.after.replace('level: minor', 'level: patch'));
    chmodSync(at.prepared.file.resolved, 0o444);

    const read = verifyRelease(at.prepared, at.context);
    chmodSync(at.prepared.file.resolved, 0o644);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('level-changed');
    expect(read.restore.restored).toBe(false);
    expect(read.sentence).toContain('and .changes/rafa-367.md could not be restored to the text the loop wrote:');
    expect(textAt(at.prepared.file.resolved)).toContain('level: patch');
  });
});
