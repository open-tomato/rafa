/**
 * Tests for the triage's guard reading (`./triage-guard.ts`).
 *
 * The guard's own judgement is `src/release/guard.test.ts`'s; this
 * file holds what the triage adds around it — that it reads nothing
 * where the release does not run, that it fetches nothing and answers
 * an unread reading for refs that do not resolve, and that over a real
 * repository the refs it picks give the guard's `collision` for the
 * 0.25.0 incident, with a `clean` branch beside it as the control that
 * proves the reading could have come out otherwise.
 */
import type { TriageGuardInput, TriageGuardReading } from './triage-guard.js';
import type { GitRunner } from '../../pr/index.js';
import type { MergeGuardSettings } from '../../release/guard-merge.js';
import type { GuardRead } from '../../release/guard.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/index.js';
import { RELEASE_PR_BRANCH } from '../../release/settle-pr.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { readTriageGuard, triageVerdict } from './triage-guard.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-triage-guard-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many repositories this file has made, so each gets its own directory. */
let repoCount = 0;

/** The settings every case reads under, the release on whatever the files say. */
const SETTINGS: MergeGuardSettings = {
  releaseEnabled: 'auto',
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
  prVersionCollision: 'refuse',
  dangerousAcceptVersionCollision: false,
};

/** When every read runs. */
const NOW = new Date('2026-09-29T12:00:00Z');

/** A manifest declaring `version`. */
function manifest(version: string): string {
  return `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;
}

/** A changelog holding one section per `[version, note]`, newest first. */
function changelog(...sections: readonly (readonly [string, string])[]): string {
  return ['# Changelog', '', ...sections.flatMap(([version, note]) => [`## ${version} — 2026-09-28, x`, '', note, ''])].join('\n');
}

/** A fragment's text at `level`. */
function fragment(plan: string): string {
  return `---\nplan: ${plan}\ntitle: title of ${plan}\nlevel: minor\n---\n- Loop: a fragment note\n`;
}

/** A repository at `root` with a commit helper. */
interface Repo {
  readonly root: string;
  /** Runs git in the repository, answering stdout trimmed. */
  readonly git: (args: readonly string[]) => string;
  /** Writes each path's text, commits, answering the commit. */
  readonly commit: (files: Readonly<Record<string, string>>, message: string) => string;
}

/** A repository whose `main` holds the manifest at 0.24.0 and a changelog for it. */
function repo(): Repo {
  repoCount += 1;
  const root = join(tempBase, `repo-${String(repoCount)}`);
  const home = join(tempBase, `home-${String(repoCount)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (args: readonly string[]): string => execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    },
  }).trim();
  const commit = (files: Readonly<Record<string, string>>, message: string): string => {
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q', '-b', 'main']);
  commit({ 'package.json': manifest('0.24.0'), 'CHANGELOG.md': changelog(['0.24.0', '- Loop: old line']) }, 'chore: start');
  return { root, git, commit };
}

/** The guard reading `reading` is, or null for no reading, an unread one or the release delivery. */
function readOf(reading: TriageGuardReading): GuardRead | null {
  return reading !== null && !('kind' in reading) && reading.ok
    ? reading
    : null;
}

/** The triage's input for a pull request whose head is `head`. */
function inputFor(root: string, git: GitRunner, head: string, number = 412, headRefName = `feat/pr-${String(number)}`): TriageGuardInput {
  return {
    git,
    settings: SETTINGS,
    root,
    pr: {
      number,
      baseRefName: 'main',
      headRefName,
      headRefOid: head,
      isCrossRepository: false,
    },
    now: NOW,
  };
}

describe('where the release does not run', () => {
  it('answers null and sends git nothing, where the files are missing under auto', () => {
    const root = join(tempBase, 'no-release');
    mkdirSync(root, { recursive: true });
    const sent: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      sent.push(args);
      return { ok: true, stdout: '', stderr: '' };
    };

    expect(readTriageGuard(inputFor(root, git, 'a'.repeat(40)))).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('refs that do not resolve', () => {
  it('names the base refs it tried, and fetches nothing', () => {
    const { root } = repo();
    const sent: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      sent.push(args);
      return { ok: false, stdout: '', stderr: 'stub git: no such ref' };
    };

    const reading = readTriageGuard(inputFor(root, git, 'a'.repeat(40)));

    expect(reading).toEqual({ ok: false, problem: 'no base ref resolved locally (tried origin/main, main)' });
    expect(sent.some((args) => args[0] === 'fetch')).toBe(false);
  });

  it('names the head refs it tried where the base resolved and the head did not', () => {
    const { root } = repo();
    const missing = 'd'.repeat(40);

    const reading = readTriageGuard(inputFor(root, createGitRunner(root), missing));

    expect(reading).toEqual({
      ok: false,
      problem: `no head ref resolved locally (tried ${missing}, origin/feat/pr-412)`,
    });
  });
});

describe('the 0.25.0 incident, read off a real repository', () => {
  it('reads collision for a head that stamped the version the base released, and clean for one carrying a fragment', () => {
    const { root, git, commit } = repo();
    const fork = git(['rev-parse', 'HEAD']);
    git(['switch', '-q', '-c', 'feat/pr-412']);
    const stampedHead = commit({
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(['0.25.0', '- Loop: the branch line'], ['0.24.0', '- Loop: old line']),
    }, 'chore: release 0.25.0');
    git(['switch', '-q', '-c', 'feat/pr-413', fork]);
    const fragmentHead = commit({ '.changes/rafa-413.md': fragment('rafa-413'), 'src/a.ts': 'export {};\n' }, 'feat: a');
    git(['switch', '-q', 'main']);
    commit({
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(['0.25.0', '- Loop: the base line'], ['0.24.0', '- Loop: old line']),
    }, 'chore: release 0.25.0');
    const runner = createGitRunner(root);

    const stamped = readTriageGuard(inputFor(root, runner, stampedHead));
    const clean = readTriageGuard(inputFor(root, runner, fragmentHead, 413));

    expect(readOf(stamped)?.verdict.answer).toBe('collision');
    expect(readOf(stamped)?.branch.commit).toBe(stampedHead);
    expect(readOf(stamped)?.base.ref).toBe('main');
    expect(readOf(clean)?.verdict.answer).toBe('clean');
  });
});

describe('settle\'s release pull request against an ordinary stamping branch (#843)', () => {
  /** What settle's release commit stamps: 0.25.0 with its section. */
  const RELEASE_COMMIT = {
    'package.json': manifest('0.25.0'),
    'CHANGELOG.md': changelog(['0.25.0', '- Loop: the settled line'], ['0.24.0', '- Loop: old line']),
  };

  it('reads the release branch as the delivery, which gives the classifier no verdict', () => {
    const { root, git, commit } = repo();
    git(['switch', '-q', '-c', RELEASE_PR_BRANCH]);
    const head = commit(RELEASE_COMMIT, 'chore: release 0.25.0');
    git(['switch', '-q', 'main']);

    const reading = readTriageGuard(inputFor(root, createGitRunner(root), head, 722, RELEASE_PR_BRANCH));

    expect(reading).toEqual({ kind: 'release-delivery', pullRequest: 722, version: '0.25.0' });
    expect(triageVerdict(reading)).toBeNull();
  });

  it('reads an ordinary branch stamping a version the base has passed as stale, with its verdict kept', () => {
    const { root, git, commit } = repo();
    const fork = git(['rev-parse', 'HEAD']);
    git(['switch', '-q', '-c', 'feat/pr-412']);
    const head = commit(RELEASE_COMMIT, 'chore: release 0.25.0');
    git(['switch', '-q', 'main']);
    expect(git(['merge-base', 'main', head])).toBe(fork);
    commit({
      'package.json': manifest('0.26.0'),
      'CHANGELOG.md': changelog(['0.26.0', '- Loop: a later line'], ['0.24.0', '- Loop: old line']),
    }, 'chore: release 0.26.0');

    const reading = readTriageGuard(inputFor(root, createGitRunner(root), head));

    const read = readOf(reading);
    expect(read?.verdict).toMatchObject({ answer: 'stale', relation: 'passed' });
    expect(triageVerdict(reading)).toBe(read?.verdict ?? 'no reading');
  });
});
