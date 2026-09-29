/**
 * Tests for `readSettle` and `buildSettle` (`settle.ts`): settle's
 * reading and its release commit, read off real repositories — a bare
 * origin, a clone that lands fragments on `main` as merges would, and
 * the caller's clone on a feature branch with work in flight, which
 * builds in the scratch worktree `withSettleWorktree` makes.
 *
 * What is measured is git's own state: the commit a build made, what it
 * changed, and what it left alone. Every "nothing was written" reading
 * is paired with a case where the same probe sees a write, so a clean
 * status cannot be a probe that never looks.
 *
 * The fragments land in an order that is NOT their names' order, and
 * with committer dates of their own, so an order taken from names or a
 * date taken from the clock would fail the cases that read them.
 */
import type { Fragment } from './fragment.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleBuild, SettleSettings } from './settle.js';
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';

import { serializeFragment } from './fragment.js';
import { withSettleWorktree } from './settle-worktree.js';
import { buildSettle, readSettle, releaseCommitSubject } from './settle.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case settles under unless it names others. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The manifest on `main`: tab-indented and with no trailing newline, so a byte-unsafe write would show. */
const MANIFEST = '{\n\t"name": "demo",\n\t"version": "0.4.0",\n\t"tool": { "version": "9.9.9" }\n}';

/** The changelog on `main`: a preamble, then the last release. */
const CHANGELOG = '# Changelog\n\nEvery release.\n\n## 0.4.0 — 2026-08-01, older\n\n- Loop: old line\n';

/** The committer date every setup commit gets unless one is named. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string, date: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    LC_ALL: 'C',
  };
}

/** A fragment's text. */
function fragmentText(plan: string, level: Fragment['level'], notes: readonly string[]): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** A bare origin, a clone that lands commits on `main`, and the caller's clone. */
interface World {
  readonly caller: string;
  readonly other: string;
  readonly scratchRoot: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[], date?: string) => string;
  /** Writes each path's text in the other clone, commits at `date` and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string, date?: string) => string;
}

/** What {@link world} starts `main` with, file by file; a case may drop or replace one. */
type Seed = Readonly<Record<string, string | null>>;

/**
 * Builds a {@link World}. `main` holds the manifest and the changelog
 * (or `seed`'s replacements); the caller is on `feat` with an
 * uncommitted edit, and commits under a local identity with no signing
 * and hooks from a directory of the world's own.
 */
function world(seed: Seed = {}): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const hooks = join(dir, 'hooks');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, hooks, scratchRoot]) mkdirSync(path, { recursive: true });
  const git = (cwd: string, args: readonly string[], date = SETUP_DATE): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedEnv(home, date), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const land = (files: Readonly<Record<string, string>>, message: string, date = SETUP_DATE): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message], date);
    git(other, ['push', '-q', 'origin', 'main']);
    return git(other, ['rev-parse', 'HEAD']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  const files = { 'package.json': MANIFEST, 'CHANGELOG.md': CHANGELOG, 'README.md': 'first\n', ...seed };
  land(Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => entry[1] !== null)), 'first');

  git(dir, ['clone', '-q', origin, caller]);
  for (const [key, value] of [['user.name', 'rafa settle'], ['user.email', 'settle@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', hooks]]) {
    git(caller, ['config', key, value]);
  }
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'README.md'), 'work in flight\n');
  return { caller, other, scratchRoot, git, land };
}

/** Lands two fragments in two commits: `rafa-9` (minor) first, then `rafa-1` (patch) a day later. */
function landTwo(w: World): { readonly first: string; readonly second: string } {
  const first = w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor', ['- Walk: one hop']) }, 'merge rafa-9', '2026-09-10T12:00:00Z');
  const second = w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', ['- Loop: a fix']) }, 'merge rafa-1', '2026-09-11T23:30:00Z');
  return { first, second };
}

/** The caller's checkout and refs as a person would read them. */
function callerState(w: World): { branch: string; status: string; refs: string } {
  return {
    branch: w.git(w.caller, ['branch', '--show-current']),
    status: w.git(w.caller, ['status', '--porcelain']),
    refs: w.git(w.caller, ['for-each-ref', '--format=%(refname) %(objectname)']),
  };
}

/** What a build answered, with the worktree's state read before it was removed. */
interface Built {
  readonly build: SettleBuild;
  /** The worktree's HEAD before the build. */
  readonly before: string;
  /** The worktree's HEAD after the build. */
  readonly head: string;
  /** `git status --porcelain` in the worktree after the build. */
  readonly status: string;
  /** Files read from the worktree after the build, by path. */
  readonly files: Readonly<Record<string, string>>;
}

/** Runs `buildSettle` in a settle worktree of the caller's `origin/main`, reading its state after. */
async function buildIn(
  w: World,
  settings: SettleSettings = SETTINGS,
  prepare: (worktree: SettleWorktree) => SettleWorktree = (worktree) => worktree,
): Promise<Built> {
  const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (made) => {
    const worktree = prepare(made);
    const before = worktree.git(['rev-parse', 'HEAD']).stdout.trim();
    const build = buildSettle(worktree, settings);
    const read = (path: string): string => {
      try {
        return readFileSync(join(worktree.path, path), 'utf8');
      } catch {
        return '<absent>';
      }
    };
    return {
      build,
      before,
      head: worktree.git(['rev-parse', 'HEAD']).stdout.trim(),
      status: worktree.git(['status', '--porcelain']).stdout.trim(),
      files: Object.fromEntries(['package.json', 'CHANGELOG.md', '.changes/rafa-1.md', '.changes/rafa-9.md'].map((path) => [path, read(path)])),
    };
  });
  if (!outcome.ok) throw new Error(outcome.problem);
  return outcome.value;
}

describe('readSettle, the dry run', () => {
  it('folds the fragments on origin/main in the order main received them, naming the strategy', () => {
    const w = world();
    const { first, second } = landTwo(w);
    const git = createGitRunner(w.caller);
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(git, 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('folded');
    if (reading.outcome !== 'folded') return;
    expect(reading.strategy).toBe('semver-by-level');
    expect(reading.commit).toBe(second);
    expect(reading.baseVersion).toBe('0.4.0');
    expect(reading.version).toBe('0.5.0');
    expect(reading.fragments.map((each) => [each.id, each.path, each.commit, each.addedOn])).toEqual([
      ['rafa-9', '.changes/rafa-9.md', first, '2026-09-10'],
      ['rafa-1', '.changes/rafa-1.md', second, '2026-09-11'],
    ]);
    expect(reading.section).toBe([
      '## 0.5.0 — 2026-09-11, title of rafa-9; title of rafa-1',
      '<!-- rafa:fragments rafa-9 rafa-1 -->',
      '',
      '- Walk: one hop',
      '- Loop: a fix',
    ].join('\n'));
  });

  it('writes nothing: the caller\'s status, branch and every ref read the same after', () => {
    const w = world();
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);
    const before = callerState(w);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('folded');
    expect(callerState(w)).toEqual(before);
    // The control: the same probe sees the caller's own work in flight.
    expect(before.status).toBe('M README.md');
  });

  it('answers nothing for a base with no fragments directory, listing none', () => {
    const w = world();
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('nothing');
    if (reading.outcome !== 'nothing') return;
    expect(reading.fragments).toEqual([]);
    expect(reading.strategy).toBe('semver-by-level');
  });

  it('answers nothing for only none fragments, listing them', () => {
    const w = world();
    w.land({ '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'merge rafa-3');
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('nothing');
    if (reading.outcome !== 'nothing') return;
    expect(reading.fragments.map((each) => each.id)).toEqual(['rafa-3']);
  });

  it('answers the strategy\'s throw as one line naming it, when the base version is no semver', () => {
    const w = world({ 'package.json': '{ "version": "not-a-version" }\n' });
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('failed');
    if (reading.outcome !== 'failed') return;
    expect(reading.strategy).toBe('semver-by-level');
    expect(reading.line).toBe('release strategy semver-by-level failed: the base version "not-a-version" is no semantic version to bump');
    expect(reading.fragments.map((each) => each.id)).toEqual(['rafa-9', 'rafa-1']);
  });

  it('refuses the whole batch when one fragment does not parse, naming its path', () => {
    const w = world();
    landTwo(w);
    w.land({ '.changes/rafa-5.md': '---\nplan: rafa-5\ntitle: t\nlevel: huge\n---\n\n- x\n' }, 'merge rafa-5');
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('malformed');
    if (reading.outcome !== 'malformed') return;
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toStartWith('.changes/rafa-5.md does not parse: ');
    expect(reading.strategy).toBe('semver-by-level');
  });

  it('answers unread for a tree git cannot resolve', () => {
    const w = world();

    const reading = readSettle(createGitRunner(w.caller), 'origin/no-such-branch', SETTINGS);

    expect(reading.outcome).toBe('unread');
    if (reading.outcome !== 'unread') return;
    expect(reading.problem).toStartWith('the tree of origin/no-such-branch could not be read');
  });

  it('answers unread for a base with no version file, before folding anything', () => {
    const w = world({ 'package.json': null });
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);

    const reading = readSettle(createGitRunner(w.caller), 'origin/main', SETTINGS);

    expect(reading.outcome).toBe('unread');
    if (reading.outcome !== 'unread') return;
    expect(reading.problem).toMatch(/^[0-9a-f]{40}:package\.json could not be read: /);
  });
});

describe('buildSettle, the release commit', () => {
  it('commits the version, the section and the deletions on the base commit, and pushes nothing', async () => {
    const w = world();
    const { second } = landTwo(w);
    const originBefore = w.git(w.other, ['ls-remote', 'origin', 'main']);
    // The worktree's own fetch moves origin/main; fetch first so the snapshot reads what settle could write.
    w.git(w.caller, ['fetch', '-q', 'origin', 'main']);
    const callerBefore = callerState(w);

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('built');
    if (built.build.outcome !== 'built') return;
    expect(built.build.version).toBe('0.5.0');
    expect(built.build.strategy).toBe('semver-by-level');
    expect(built.build.release).toBe(built.head);
    expect(built.before).toBe(second);
    expect(built.build.commit).toBe(second);
    expect(built.build.deleted).toEqual(['.changes/rafa-9.md', '.changes/rafa-1.md']);
    expect(built.build.insertPoint).toBe('before-next-heading');
    expect(built.status).toBe('');

    expect(w.git(w.caller, ['log', '-1', '--format=%s%n%P', built.head])).toBe(`${releaseCommitSubject('0.5.0')}\n${second}`);
    expect(w.git(w.caller, ['diff', '--name-status', second, built.head]).split('\n')).toEqual([
      'D\t.changes/rafa-1.md',
      'D\t.changes/rafa-9.md',
      'M\tCHANGELOG.md',
      'M\tpackage.json',
    ]);
    expect(w.git(w.other, ['ls-remote', 'origin', 'main'])).toBe(originBefore);
    expect(callerState(w)).toEqual(callerBefore);
  });

  it('writes the version byte-safely and the section at the changelog\'s insert point', async () => {
    const w = world();
    landTwo(w);

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('built');
    if (built.build.outcome !== 'built') return;
    expect(built.files['package.json']).toBe(MANIFEST.replace('"version": "0.4.0"', '"version": "0.5.0"'));
    expect(built.files['CHANGELOG.md']).toBe([
      '# Changelog',
      '',
      'Every release.',
      '',
      built.build.section,
      '',
      '## 0.4.0 — 2026-08-01, older',
      '',
      '- Loop: old line',
      '',
    ].join('\n'));
    expect(built.files['.changes/rafa-1.md']).toBe('<absent>');
    expect(built.files['.changes/rafa-9.md']).toBe('<absent>');
  });

  it('deletes none fragments with the batch that ships, and names them in the receipt', async () => {
    const w = world();
    w.land({ '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'merge rafa-3');
    w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch', ['- Loop: a fix']) }, 'merge rafa-1');

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('built');
    if (built.build.outcome !== 'built') return;
    expect(built.build.version).toBe('0.4.1');
    expect(built.build.deleted).toEqual(['.changes/rafa-3.md', '.changes/rafa-1.md']);
    expect(built.build.section).toContain('<!-- rafa:fragments rafa-3 rafa-1 -->');
  });

  it('commits nothing when there is nothing to settle, leaving none fragments waiting', async () => {
    const w = world();
    w.land({ '.changes/rafa-3.md': fragmentText('rafa-3', 'none', []) }, 'merge rafa-3');

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('nothing');
    expect(built.head).toBe(built.before);
    expect(built.status).toBe('');
    expect(built.files['package.json']).toBe(MANIFEST);
    expect(built.files['CHANGELOG.md']).toBe(CHANGELOG);
  });

  it('writes nothing when the strategy throws', async () => {
    const manifest = '{ "version": "not-a-version" }\n';
    const w = world({ 'package.json': manifest });
    landTwo(w);

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('failed');
    expect(built.head).toBe(built.before);
    expect(built.status).toBe('');
    expect(built.files['package.json']).toBe(manifest);
    expect(built.files['CHANGELOG.md']).toBe(CHANGELOG);
  });

  it('writes nothing when a fragment does not parse', async () => {
    const w = world();
    landTwo(w);
    w.land({ '.changes/rafa-5.md': '---\nplan: rafa-5\n---\n' }, 'merge rafa-5');

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('malformed');
    expect(built.head).toBe(built.before);
    expect(built.status).toBe('');
  });

  it('answers unbuilt, committing nothing, when the changelog is missing', async () => {
    const w = world({ 'CHANGELOG.md': null });
    landTwo(w);

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('unbuilt');
    if (built.build.outcome !== 'unbuilt') return;
    expect(built.build.problem).toStartWith('CHANGELOG.md could not be read: ');
    expect(built.build.version).toBe('0.5.0');
    expect(built.head).toBe(built.before);
  });

  it('refuses a worktree whose version file is not the base commit\'s', async () => {
    const w = world();
    landTwo(w);

    const built = await buildIn(w, SETTINGS, (worktree) => {
      writeFileSync(join(worktree.path, 'package.json'), MANIFEST.replace('0.4.0', '0.4.7'));
      return worktree;
    });

    expect(built.build.outcome).toBe('unbuilt');
    if (built.build.outcome !== 'unbuilt') return;
    expect(built.build.problem).toBe('package.json declared 0.4.7 in the worktree, where the base commit declares 0.4.0');
    expect(built.head).toBe(built.before);
  });

  it('runs the repository\'s pre-commit hook, and answers its refusal as unbuilt', async () => {
    const w = world();
    landTwo(w);
    const hooks = w.git(w.caller, ['config', '--get', 'core.hooksPath']);
    const hook = join(hooks, 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "planted hook refusal" >&2\nexit 1\n');
    chmodSync(hook, 0o755);

    const built = await buildIn(w);

    expect(built.build.outcome).toBe('unbuilt');
    if (built.build.outcome !== 'unbuilt') return;
    expect(built.build.problem).toStartWith('chore: release 0.5.0 could not be committed: ');
    expect(built.build.problem).toContain('planted hook refusal');
    expect(built.head).toBe(built.before);
  });

  it('answers unbuilt when the fragments cannot be deleted', async () => {
    const w = world();
    landTwo(w);
    const failRm = (worktree: SettleWorktree): SettleWorktree => {
      const git: GitRunner = (args) => args[0] === 'rm'
        ? { ok: false, stdout: '', stderr: 'planted failure of git rm' }
        : worktree.git(args);
      return { ...worktree, git };
    };

    const built = await buildIn(w, SETTINGS, failRm);

    expect(built.build.outcome).toBe('unbuilt');
    if (built.build.outcome !== 'unbuilt') return;
    expect(built.build.problem).toBe('the folded fragments could not be deleted: planted failure of git rm');
    expect(built.head).toBe(built.before);
  });
});
