/**
 * Tests for the release guard as `rafa pr merge` runs it
 * (`guard-merge.ts`): the reaction table over literal readings, the two
 * fetches ahead of the reading and the order they run in, and a fetch
 * that fails over a clone that still holds both refs — the note it adds
 * without stopping the reading.
 *
 * The fetch case is paired with its control: the same clone read while
 * its remote is still there carries no fetch note, so the note the
 * broken remote adds is the fetch's and not one every reading carries.
 *
 * The head's package fragments under `release.packageFragments` are read
 * off real clones, refusals first: a fragment the branch added and one it
 * inherited from its base, both refused under `refuse`; then the same
 * tree under `allow` and a root-only tree under `refuse`, both refusing
 * nothing. The `allow` case also counts the git commands it ran, so its
 * empty answer is the setting's and not a tree that read as empty.
 */
import type { MergeGuardSettings } from './guard-merge.js';
import type { GuardRead, GuardReading, GuardVerdict } from './guard.js';
import type { SettleSettings } from './settle.js';
import type { VersionCollisionMode } from '@open-tomato/rafa/core/config/sections';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { afterAll, describe, expect, it } from 'bun:test';

import { guardReaction, mergeGuardSettings, readHeadPackageFragments, readMergeGuard } from './guard-merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-guard-merge-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The settings every reading here runs under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
  releaseMoveLock: false,
};

/** When every reading runs. */
const NOW = new Date('2026-09-29T12:00:00Z');

/** The head branch every case guards. */
const HEAD = 'feat/guarded';

/** A reading that judged `verdict`. */
function read(verdict: GuardVerdict): GuardRead {
  return {
    ok: true,
    verdict,
    branch: { ref: `origin/${HEAD}`, name: HEAD, pullRequest: 41, commit: 'b'.repeat(40) },
    base: { ref: 'origin/main', commit: 'a'.repeat(40) },
    forecast: null,
    levelReport: null,
    problems: [],
  };
}

/** The base entry every stamped verdict names. */
const BASE_ENTRY = { version: '0.25.0', section: null, commit: null };

/** One reading per guard answer, and one that could not read. */
const READINGS: Readonly<Record<string, GuardReading>> = {
  clean: read({ answer: 'clean', fragments: ['.changes/rafa-1.md'] }),
  missing: read({ answer: 'missing', outside: ['src/a.ts'] }),
  stale: read({ answer: 'stale', stamp: { version: '0.25.0', section: null }, base: BASE_ENTRY, relation: 'not-on-base' }),
  collision: read({ answer: 'collision', stamp: { version: '0.25.0', section: null }, base: BASE_ENTRY }),
  unread: { ok: false, problem: 'the base origin/main names no commit' },
};

/** The reaction to each reading under `mode`, the collision override set to `accept`. */
function reactions(mode: VersionCollisionMode, accept: boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(READINGS).map(([name, reading]) => [
    name,
    guardReaction(reading, { prVersionCollision: mode, dangerousAcceptVersionCollision: accept }),
  ]));
}

describe('the reaction', () => {
  it('meets missing and stale as pr.versionCollision says, allow reading silent', () => {
    expect(['allow', 'report', 'ask', 'refuse'].map((mode) => reactions(mode as VersionCollisionMode, false)))
      .toEqual([
        { clean: 'print', missing: 'silent', stale: 'silent', collision: 'refuse', unread: 'report' },
        { clean: 'print', missing: 'report', stale: 'report', collision: 'refuse', unread: 'report' },
        { clean: 'print', missing: 'ask', stale: 'ask', collision: 'refuse', unread: 'report' },
        { clean: 'print', missing: 'refuse', stale: 'refuse', collision: 'refuse', unread: 'report' },
      ]);
  });

  it('accepts a collision under dangerous.acceptVersionCollision alone, whatever the mode, moving nothing else', () => {
    expect(reactions('allow', true)).toEqual({
      clean: 'print',
      missing: 'silent',
      stale: 'silent',
      collision: 'accept',
      unread: 'report',
    });
    expect(reactions('refuse', true)).toEqual({
      clean: 'print',
      missing: 'refuse',
      stale: 'refuse',
      collision: 'accept',
      unread: 'report',
    });
  });
});

describe('the settings it carries', () => {
  it('copies the guard\'s ten settings and nothing more off a wider config', () => {
    const wider: MergeGuardSettings & { readonly planDir: string } = {
      ...SETTINGS,
      releaseEnabled: 'auto',
      prVersionCollision: 'ask',
      dangerousAcceptVersionCollision: true,
      releasePackageFragments: 'refuse',
      planDir: '.rafa/plans',
    };

    const kept = mergeGuardSettings(wider);

    expect(Object.keys(kept).sort()).toEqual([
      'dangerousAcceptVersionCollision',
      'prVersionCollision',
      'releaseChangelog',
      'releaseEnabled',
      'releaseFragments',
      'releaseHeading',
      'releaseMoveLock',
      'releasePackageFragments',
      'releaseStrategy',
      'releaseVersionFile',
    ]);
    expect(kept).toMatchObject({
      prVersionCollision: 'ask',
      dangerousAcceptVersionCollision: true,
      releasePackageFragments: 'refuse',
    });
  });
});

describe('the fetches', () => {
  it('fetches the base and then the head from origin, each on its own, before reading', () => {
    const ran: string[] = [];
    const git: GitRunner = (args): GitResult => {
      ran.push(args.join(' '));
      return args[0] === 'fetch'
        ? { ok: true, stdout: '', stderr: '' }
        : { ok: false, stdout: '', stderr: 'fatal: bad revision' };
    };

    const reading = readMergeGuard({ git, settings: SETTINGS, base: 'main', head: HEAD, pullRequest: 41, now: NOW });

    expect(ran.slice(0, 2)).toEqual(['fetch origin main', `fetch origin ${HEAD}`]);
    // Nothing named a commit, so the reading stopped at the base, fetch notes and all.
    expect(reading).toEqual({ ok: false, problem: 'the base origin/main names no commit' });
  });

  it('adds a failed fetch to a reading that could not read, after its own problem', () => {
    const git: GitRunner = (args): GitResult => ({
      ok: false,
      stdout: '',
      stderr: args[0] === 'fetch'
        ? 'fatal: could not read from remote repository'
        : 'fatal: bad revision',
    });

    const reading = readMergeGuard({ git, settings: SETTINGS, base: 'main', head: HEAD, pullRequest: 41, now: NOW });

    expect(reading.ok).toBe(false);
    expect(reading.ok
      ? ''
      : reading.problem).toBe('the base origin/main names no commit'
      + '; main could not be fetched from origin, so the guard reads whatever this clone already holds for origin/main:'
      + ' fatal: could not read from remote repository'
      + `; ${HEAD} could not be fetched from origin, so the guard reads whatever this clone already holds for origin/${HEAD}:`
      + ' fatal: could not read from remote repository');
  });
});

/** Runs git in `cwd` under a fixed identity, answering what it wrote. */
function run(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
    },
  });
}

/**
 * A bare origin and a clone whose `main` and {@link HEAD} are both
 * pushed, the head adding one source file and no fragment.
 */
function plantClone(): { readonly clone: string; readonly bare: string } {
  const root = realpathSync(mkdtempSync(join(tempBase, 'world-')));
  const bare = join(root, 'origin.git');
  const clone = join(root, 'clone');
  run(root, 'init', '-q', '--bare', '--initial-branch=main', bare);
  run(root, 'init', '-q', '--initial-branch=main', clone);
  writeFileSync(join(clone, 'package.json'), '{\n  "name": "demo",\n  "version": "0.24.0"\n}\n', 'utf8');
  writeFileSync(join(clone, 'CHANGELOG.md'), '# Changelog\n\n## 0.24.0 — 2026-09-28, first\n\n- a: one\n', 'utf8');
  run(clone, 'add', '.');
  run(clone, 'commit', '-q', '-m', 'first');
  run(clone, 'remote', 'add', 'origin', bare);
  run(clone, 'push', '-q', '-u', 'origin', 'main');
  run(clone, 'switch', '-q', '-c', HEAD);
  mkdirSync(join(clone, 'src'));
  writeFileSync(join(clone, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  run(clone, 'add', '.');
  run(clone, 'commit', '-q', '-m', 'feature');
  run(clone, 'push', '-q', '-u', 'origin', HEAD);
  return { clone, bare };
}

describe('a fetch that fails over refs the clone still holds', () => {
  it('reads anyway, and the reading carries the note ahead of its own problems; with the remote there, no note', () => {
    const { clone, bare } = plantClone();
    const input = { settings: SETTINGS, base: 'main', head: HEAD, pullRequest: 41, now: NOW };

    const reachable = readMergeGuard({ ...input, git: createGitRunner(clone) });
    rmSync(bare, { recursive: true, force: true });
    const unreachable = readMergeGuard({ ...input, git: createGitRunner(clone) });

    expect(reachable.ok && reachable.verdict.answer).toBe('missing');
    expect(reachable.ok && reachable.problems.filter((problem) => problem.includes('could not be fetched'))).toEqual([]);
    expect(unreachable.ok && unreachable.verdict.answer).toBe('missing');
    const notes = unreachable.ok
      ? unreachable.problems.slice(0, 2)
      : [];
    expect(notes.map((note) => note.slice(0, note.indexOf(':')))).toEqual([
      'main could not be fetched from origin, so the guard reads whatever this clone already holds for origin/main',
      `${HEAD} could not be fetched from origin, so the guard reads whatever this clone already holds for origin/${HEAD}`,
    ]);
  });
});

/** A fragment's text for `plan`, with a `package:` line when `packageName` is given. */
function fragmentText(plan: string, packageName?: string): string {
  const packageLine = packageName === undefined
    ? []
    : [`package: ${packageName}`];
  return ['---', `plan: ${plan}`, `title: ${plan} title`, 'level: minor', ...packageLine, '---', '', '- a: one', ''].join('\n');
}

/** Writes `files` under `dir` and commits them as `message`. */
function commitFiles(dir: string, message: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text, 'utf8');
  }
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', message);
}

/**
 * A bare origin and a clone whose `main` commits `base` and whose
 * {@link HEAD}, forked after it, commits `branch`; both pushed.
 */
function plantFragments(base: Readonly<Record<string, string>>, branch: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tempBase, 'fragments-')));
  const bare = join(root, 'origin.git');
  const clone = join(root, 'clone');
  run(root, 'init', '-q', '--bare', '--initial-branch=main', bare);
  run(root, 'init', '-q', '--initial-branch=main', clone);
  commitFiles(clone, 'first', { 'package.json': '{\n  "name": "demo",\n  "version": "0.24.0"\n}\n', ...base });
  run(clone, 'remote', 'add', 'origin', bare);
  run(clone, 'push', '-q', '-u', 'origin', 'main');
  run(clone, 'switch', '-q', '-c', HEAD);
  commitFiles(clone, 'feature', { 'src/a.ts': 'export const a = 1;\n', ...branch });
  run(clone, 'push', '-q', '-u', 'origin', HEAD);
  return clone;
}

/** The sentence the shared reading names a refused `path` releasing `@scope/x` with. */
function refusedSentence(path: string): string {
  return `${path} names package @scope/x, and release.packageFragments is refuse: this project takes no package fragments`;
}

describe('the head\'s package fragments', () => {
  /** The settings under `mode`. */
  const under = (mode: 'allow' | 'refuse') => ({ releaseFragments: '.changes', releasePackageFragments: mode });

  it('refuses a package fragment the branch added under refuse, naming its path', () => {
    const clone = plantFragments({}, { '.changes/rafa-2.md': fragmentText('rafa-2', '@scope/x') });

    const refused = readHeadPackageFragments({ git: createGitRunner(clone), settings: under('refuse'), head: HEAD });

    expect(refused).toEqual([{
      path: '.changes/rafa-2.md',
      package: '@scope/x',
      sentence: refusedSentence('.changes/rafa-2.md'),
    }]);
  });

  it('refuses a package fragment the branch inherited from its base, beside the root one it added', () => {
    const clone = plantFragments(
      { '.changes/rafa-1.md': fragmentText('rafa-1', '@scope/x') },
      { '.changes/rafa-2.md': fragmentText('rafa-2') },
    );

    const refused = readHeadPackageFragments({ git: createGitRunner(clone), settings: under('refuse'), head: HEAD });

    expect(refused.map(({ path, sentence }) => [path, sentence])).toEqual([
      ['.changes/rafa-1.md', refusedSentence('.changes/rafa-1.md')],
    ]);
  });

  it('refuses nothing under allow over the same tree, and reads no git for it', () => {
    const clone = plantFragments(
      { '.changes/rafa-1.md': fragmentText('rafa-1', '@scope/x') },
      { '.changes/rafa-2.md': fragmentText('rafa-2', '@scope/x') },
    );
    const ran: string[] = [];
    const real = createGitRunner(clone);
    const git: GitRunner = (args) => {
      ran.push(args.join(' '));
      return real(args);
    };

    expect(readHeadPackageFragments({ git, settings: under('allow'), head: HEAD })).toEqual([]);
    expect(ran).toEqual([]);
    // The control: the same tree and runner under refuse reads git and refuses both.
    expect(readHeadPackageFragments({ git, settings: under('refuse'), head: HEAD }).map(({ path }) => path))
      .toEqual(['.changes/rafa-1.md', '.changes/rafa-2.md']);
    expect(ran.length).toBeGreaterThan(0);
  });

  it('refuses nothing under refuse over a tree of root fragments alone', () => {
    const clone = plantFragments(
      { '.changes/rafa-1.md': fragmentText('rafa-1') },
      { '.changes/rafa-2.md': fragmentText('rafa-2') },
    );

    expect(readHeadPackageFragments({ git: createGitRunner(clone), settings: under('refuse'), head: HEAD })).toEqual([]);
  });
});
