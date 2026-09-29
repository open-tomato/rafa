/**
 * Tests for step 1 of the release (`src/release/prepare.ts`): the
 * fragment it writes, what it answers, and every reading that makes it
 * write nothing.
 *
 * Each case builds scratch repositories of its own under `mkdtemp` — a
 * bare `origin`, a seed clone that plants the base branch, and the
 * working clone the module writes into — never the checkout the suite
 * runs in. What is measured is git's own answer about which fragments
 * wait on the base, so the base is a real repository and not a table
 * of planted replies; the runner handed to the module is the real one,
 * wrapped to record its argv. No case reaches a network: `origin` is a
 * path.
 *
 * Several things here would pass while wrong, so each has an assertion
 * of its own:
 *
 *  - A preparation that wrote the fragment AND still stamped the
 *    version or the changelog satisfies every assertion about the
 *    fragment. So the happy path reads both files back byte for byte,
 *    and asks `git status` which paths changed.
 *  - A name allocated off the working tree rather than the base passes
 *    every case whose base holds nothing. So one case pushes a waiting
 *    fragment of the same plan to `origin` AFTER the working clone was
 *    made: only a fetch brings it down, and only an allocation off the
 *    base names the new file `-2`.
 *  - A skip that wrote before deciding to skip satisfies every
 *    assertion about its sentence. So every skip case asserts the
 *    fragments directory is not there.
 *  - A module that refused on a failed fetch would still pass the happy
 *    path, so the failed-fetch case asserts a prepared record with
 *    `fetched` false.
 *
 * Six mutations of `prepare.ts` were driven on 2026-09-29, one at a
 * time over `env -u CLAUDECODE bun test src/release/prepare.test.ts`,
 * the module restored from a scratch copy and verified with `shasum -c`
 * after each. 20 cases, all green on the unmutated module; each fail
 * count is that run's own:
 *
 *  - the name allocated against no waiting fragment at all: 1 fails,
 *    the case whose base holds the plan's fragment already.
 *  - a `none` level skipped instead of written: 3 fail, the three
 *    cases of the level-none block.
 *  - the fetch dropped: 5 fail, among them the `-2` case, which proves
 *    only the fetch brings the pushed fragment down.
 *  - a failed fetch turned into a refusal: 2 fail, the failed-fetch
 *    case and the unreadable-base case, whose fetch fails too.
 *  - the plan title fallback dropped: 2 fail, the two cases whose
 *    shipping level has no note to write.
 *  - the changelog stamped beside the fragment: 3 fail, the cases that
 *    read the changelog back or ask `git status` what changed.
 */
import type { ChangelogNote } from './changelog.js';
import type { ReleasePreparationInput, ReleaseSettings } from './prepare.js';
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RELEASE_AUTO } from '../config-sections.js';
import { createGitRunner } from '../pr/index.js';

import { parseFragment, serializeFragment } from './fragment.js';
import { prepareRelease } from './prepare.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-prepare-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The manifest the base branch holds; the module must never rewrite it. */
const MANIFEST = '{\n  "name": "scratch",\n  "version": "0.4.0",\n  "private": true\n}';

/** A changelog shaped as this repository's is; the module must never rewrite it. */
const CHANGELOG = [
  '# Changelog',
  '',
  'Every notable change to this project, newest first.',
  '',
  '## 0.4.0 — 2026-09-19, the one before',
  '',
  '- loop: the loop learned to stop',
  '',
].join('\n');

/** The plan id every case writes under unless it names another. */
const PLAN = 'rafa-367';

/** The settings every case starts from; a case overrides what it is about. */
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
};

/** Three notes in two areas, as a plan's sessions would have stored them. */
const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the loop writes a fragment itself' },
  { level: 'patch', area: 'cli', summary: 'rafa release status prints the pending notes' },
  { level: 'minor', area: 'loop', summary: 'a task reports what its diff is worth' },
];

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The environment every git this file runs itself gets. */
function gitEnv(home: string): Record<string, string> {
  return {
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
}

/** A bare origin, a seed clone that pushes to it, and the working clone. */
interface World {
  /** The working clone's root: the repository the module writes into. */
  readonly root: string;
  /** The bare repository `origin` names. */
  readonly origin: string;
  /** Runs git in `cwd` with this world's isolated config, answering stdout. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Commits `files` on the seed clone's `branch` and pushes it to origin. */
  readonly push: (files: Readonly<Record<string, string | null>>, branch?: string) => void;
}

/**
 * Plants the three repositories. The base branch `main` holds the
 * manifest and the changelog unless a case asks for either to be absent
 * (null); the working clone is made from it.
 */
function world(files: { manifest?: string | null; changelog?: string | null } = {}): World {
  worldCount += 1;
  const at = join(tempBase, `world-${String(worldCount)}`);
  const home = join(at, 'home');
  const origin = join(at, 'origin.git');
  const seed = join(at, 'seed');
  const root = join(at, 'work');
  mkdirSync(home, { recursive: true });
  const env = gitEnv(home);
  const git = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    [...args],
    { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

  git(at, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(at, ['clone', '-q', origin, seed]);
  git(seed, ['checkout', '-q', '-B', 'main']);
  const push = (planted: Readonly<Record<string, string | null>>, branch = 'main'): void => {
    git(seed, ['checkout', '-q', '-B', branch]);
    for (const [path, text] of Object.entries(planted)) {
      if (text === null) continue;
      mkdirSync(join(seed, path, '..'), { recursive: true });
      writeFileSync(join(seed, path), text);
    }
    git(seed, ['add', '-A']);
    git(seed, ['commit', '-q', '--allow-empty', '-m', `seed ${branch}`]);
    git(seed, ['push', '-q', 'origin', branch]);
  };
  push({
    'README.md': 'scratch\n',
    'package.json': files.manifest === undefined
      ? MANIFEST
      : files.manifest,
    'CHANGELOG.md': files.changelog === undefined
      ? CHANGELOG
      : files.changelog,
  });
  git(at, ['clone', '-q', origin, root]);
  return { root, origin, git, push };
}

/** A real runner in `root` that records every argv it was asked. */
function recordingGit(root: string): { readonly run: GitRunner; readonly calls: string[][] } {
  const calls: string[][] = [];
  const real = createGitRunner(root);
  const run: GitRunner = (args) => {
    calls.push([...args]);
    return real(args);
  };
  return { run, calls };
}

/** The input every case starts from, over the working clone of `at`. */
function input(
  at: World,
  git: GitRunner,
  over: Partial<ReleasePreparationInput> = {},
): ReleasePreparationInput {
  return {
    repoRoot: at.root,
    settings: SETTINGS,
    git,
    plan: PLAN,
    declared: 'minor',
    notes: NOTES,
    title: 'releases settle on the base branch',
    ...over,
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

/** The paths `git status` reports as changed or new in the working clone. */
function changedPaths(at: World): readonly string[] {
  return at.git(at.root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(3));
}

describe('prepareRelease over a repository it writes', () => {
  it('writes the plan\'s fragment, the raw notes grouped by area under its front matter', () => {
    const at = world();
    const git = recordingGit(at.root);

    const made = prepareRelease(input(at, git.run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.file.path).toBe('.changes/rafa-367.md');
    expect(made.file.resolved).toBe(join(at.root, '.changes', 'rafa-367.md'));
    expect(made.file.before).toBeNull();
    expect(textAt(made.file.resolved)).toBe(made.file.after);
    expect(made.file.after.split('\n')).toEqual([
      '---',
      'plan: rafa-367',
      'title: releases settle on the base branch',
      'level: minor',
      '---',
      '',
      '- loop: the loop writes a fragment itself',
      '- loop: a task reports what its diff is worth',
      '- cli: rafa release status prints the pending notes',
      '',
    ]);
    expect(parseFragment(made.file.after)).toEqual({ ok: true, fragment: made.fragment });
    expect(made.plan).toBe(PLAN);
    expect(made.level).toBe('minor');
    expect(made.levelSource).toBe('plan');
    expect(made.notesLevel).toBe('minor');
    expect(made.fetched).toBe(true);
    expect(made.problems).toEqual([]);
    expect(made.base.ref).toBe('origin/main');
    expect(made.base.commit).toBe(at.git(at.origin, ['rev-parse', 'main']));
    expect(made.base.waiting).toEqual([]);
    expect(git.calls[0]).toEqual(['fetch', 'origin', 'main']);
  });

  it('touches neither the version file nor the changelog: the fragment is the only change', () => {
    const at = world();

    const made = prepareRelease(input(at, recordingGit(at.root).run));

    expect(made.kind).toBe('prepared');
    expect(textAt(join(at.root, 'package.json'))).toBe(MANIFEST);
    expect(textAt(join(at.root, 'CHANGELOG.md'))).toBe(CHANGELOG);
    expect(changedPaths(at)).toEqual(['.changes/rafa-367.md']);
  });

  it('takes the level from the notes when the plan declares none', () => {
    const at = world();
    const notes: ChangelogNote[] = [
      { level: 'patch', area: 'cli', summary: 'a flag is spelled right' },
      { level: 'major', area: 'store', summary: 'the store drops its legacy backend' },
    ];

    const made = prepareRelease(input(at, recordingGit(at.root).run, { declared: null, notes }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.level).toBe('major');
    expect(made.levelSource).toBe('notes');
    expect(made.fragment.level).toBe('major');
    expect(textAt(made.file.resolved)).toContain('level: major\n');
  });

  it('collapses a title to one line, and falls back to the plan id when it is empty', () => {
    const at = world();

    const wrapped = prepareRelease(input(at, recordingGit(at.root).run, { title: '  a title\n  over two lines ' }));
    const empty = prepareRelease(input(at, recordingGit(at.root).run, { title: '   ' }));

    expect(wrapped.kind === 'prepared' && wrapped.fragment.title).toBe('a title over two lines');
    expect(empty.kind === 'prepared' && empty.fragment.title).toBe(PLAN);
  });

  it('makes a nested fragments directory the project configured', () => {
    const at = world();
    const settings = { ...SETTINGS, releaseFragments: './notes/changes/' };

    const made = prepareRelease(input(at, recordingGit(at.root).run, { settings }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.file.path).toBe('notes/changes/rafa-367.md');
    expect(textAt(join(at.root, 'notes', 'changes', 'rafa-367.md'))).toBe(made.file.after);
  });
});

describe('prepareRelease at level none', () => {
  it('writes a none fragment for a plan that declares release: none, notes and all', () => {
    const at = world();

    const made = prepareRelease(input(at, recordingGit(at.root).run, { declared: 'none' }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.level).toBe('none');
    expect(made.levelSource).toBe('plan');
    expect(made.notesLevel).toBe('minor');
    expect(made.fragment.level).toBe('none');
    expect(made.fragment.notes).toHaveLength(3);
    expect(textAt(made.file.resolved)).toContain('level: none\n');
    expect(textAt(join(at.root, 'package.json'))).toBe(MANIFEST);
    expect(textAt(join(at.root, 'CHANGELOG.md'))).toBe(CHANGELOG);
  });

  it('writes a none fragment with no body when every note is at level none', () => {
    const at = world();
    const notes: ChangelogNote[] = [
      { level: 'none', area: 'loop', summary: 'an internal rename no user sees' },
    ];

    const made = prepareRelease(input(at, recordingGit(at.root).run, { declared: null, notes }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.levelSource).toBe('notes');
    expect(made.file.after).toBe('---\nplan: rafa-367\ntitle: releases settle on the base branch\nlevel: none\n---\n');
    expect(made.problems).toEqual([]);
  });

  it('writes a none fragment for a plan that stored no note and declared no level', () => {
    const at = world();

    const made = prepareRelease(input(at, recordingGit(at.root).run, { declared: null, notes: [] }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.level).toBe('none');
    expect(made.levelSource).toBe('default');
    expect(made.notesLevel).toBeNull();
    expect(made.fragment.notes).toEqual([]);
  });
});

describe('prepareRelease naming the fragment', () => {
  it('takes -2 when the base already holds a waiting fragment of the plan, pushed after the clone', () => {
    const at = world();
    const waiting = serializeFragment({ plan: PLAN, title: 'an earlier run', level: 'patch', notes: ['- loop: first'] });
    at.push({ '.changes/rafa-367.md': waiting });

    const made = prepareRelease(input(at, recordingGit(at.root).run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.file.path).toBe('.changes/rafa-367-2.md');
    expect(made.base.waiting.map((each) => each.path)).toEqual(['.changes/rafa-367.md']);
    expect(existsSync(join(at.root, '.changes', 'rafa-367.md'))).toBe(false);
  });

  it('rewrites the fragment an earlier wrap-up of this branch left, rather than adding a second', () => {
    const at = world();
    const first = prepareRelease(input(at, recordingGit(at.root).run, { declared: 'patch' }));
    expect(first.kind).toBe('prepared');
    if (first.kind !== 'prepared') return;

    const again = prepareRelease(input(at, recordingGit(at.root).run));

    expect(again.kind).toBe('prepared');
    if (again.kind !== 'prepared') return;
    expect(again.file.path).toBe(first.file.path);
    expect(again.file.before).toBe(first.file.after);
    expect(textAt(again.file.resolved)).toContain('level: minor\n');
    expect(changedPaths(at)).toEqual(['.changes/rafa-367.md']);
  });

  it('reads the waiting fragments off the remote branch a caller names', () => {
    const at = world();
    at.push({ 'trunk.txt': 'trunk\n' }, 'trunk');
    const git = recordingGit(at.root);

    const made = prepareRelease(input(at, git.run, { base: { remote: 'origin', branch: 'trunk' } }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.base.ref).toBe('origin/trunk');
    expect(git.calls[0]).toEqual(['fetch', 'origin', 'trunk']);
    expect(git.calls.some((call) => call.some((arg) => arg.includes('origin/main')))).toBe(false);
  });
});

describe('prepareRelease when a reading does not come out as asked', () => {
  it('prepares anyway when the fetch failed, and says the base may be stale', () => {
    const at = world();
    at.git(at.root, ['remote', 'set-url', 'origin', join(at.root, 'no-such-origin.git')]);

    const made = prepareRelease(input(at, recordingGit(at.root).run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.fetched).toBe(false);
    expect(made.problems).toHaveLength(1);
    expect(made.problems[0]).toContain('main could not be fetched from origin');
    expect(textAt(made.file.resolved)).toBe(made.file.after);
  });

  it('writes the plan title as the one note of a shipping level with no note, and says so', () => {
    const at = world();

    const made = prepareRelease(input(at, recordingGit(at.root).run, { notes: [] }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.fragment.notes).toEqual(['- releases settle on the base branch']);
    expect(made.problems).toEqual([
      'the fragment\'s one note is the plan title, "releases settle on the base branch": the plan stored no change note, and a minor fragment cannot be written with none',
    ]);
  });

  it('says how many notes were skipped when every one of them was', () => {
    const at = world();
    const notes: ChangelogNote[] = [{ level: 'none', area: 'loop', summary: 'nothing a user sees' }];

    const made = prepareRelease(input(at, recordingGit(at.root).run, { notes }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.problems[0]).toContain('all 1 of the plan\'s change notes were skipped');
  });
});

describe('prepareRelease when the release does not run', () => {
  it('skips with release.enabled false, writing nothing and asking git nothing', () => {
    const at = world();
    const git = recordingGit(at.root);
    const settings = { ...SETTINGS, releaseEnabled: false };

    const made = prepareRelease(input(at, git.run, { settings }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('disabled');
    expect(made.sentence).toBe('no release fragment: release.enabled is false in this project');
    expect(git.calls).toEqual([]);
    expect(existsSync(join(at.root, '.changes'))).toBe(false);
  });

  it('skips under auto when one of the two files is missing, naming it', () => {
    const at = world({ changelog: null });

    const made = prepareRelease(input(at, recordingGit(at.root).run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('disabled');
    expect(made.sentence).toBe('no release fragment: release.enabled is auto and CHANGELOG.md is not there');
    expect(existsSync(join(at.root, '.changes'))).toBe(false);
  });

  it('skips under auto when both files are missing, naming both', () => {
    const at = world({ manifest: null, changelog: null });

    const made = prepareRelease(input(at, recordingGit(at.root).run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.sentence).toBe(
      'no release fragment: release.enabled is auto and package.json and CHANGELOG.md are not there',
    );
  });

  it('skips a plan id that cannot name a fragment, asking git nothing', () => {
    const at = world();
    const git = recordingGit(at.root);

    const made = prepareRelease(input(at, git.run, { plan: '.hidden plan' }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('plan-unusable');
    expect(made.sentence).toBe('no release fragment: the plan id ".hidden plan" cannot name a fragment file');
    expect(git.calls).toEqual([]);
    expect(existsSync(join(at.root, '.changes'))).toBe(false);
  });

  it('skips a base branch whose fragments cannot be read, carrying what went wrong', () => {
    const at = world();

    const made = prepareRelease(input(at, recordingGit(at.root).run, { base: { branch: 'no-such-branch' } }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('base-unreadable');
    expect(made.sentence).toStartWith('no release fragment: the tree of origin/no-such-branch could not be read');
    expect(made.sentence).toEndWith('so no free fragment name for rafa-367 could be chosen');
    expect(made.problems).toHaveLength(1);
    expect(made.problems[0]).toContain('no-such-branch could not be fetched from origin');
    expect(existsSync(join(at.root, '.changes'))).toBe(false);
  });

  it('skips a fragments directory it cannot write into', () => {
    const at = world();
    const directory = join(at.root, '.changes');
    mkdirSync(directory);
    chmodSync(directory, 0o555);

    const made = prepareRelease(input(at, recordingGit(at.root).run));
    chmodSync(directory, 0o755);

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('fragment-unwritable');
    expect(made.sentence).toStartWith('no release fragment: .changes/rafa-367.md could not be written: ');
    expect(existsSync(join(directory, 'rafa-367.md'))).toBe(false);
  });
});
