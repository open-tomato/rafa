/**
 * Tests for the forecast of a branch's verified fragment and the body
 * block it is written in (`src/release/branch-forecast.ts`).
 *
 * The git runner is scripted and records its argv, so a case pins that
 * the base version is read at the COMMIT step 1 read the waiting
 * fragments at, not at the ref, which could have moved. A second,
 * path-answering runner plants a workspace at that commit, so a package
 * slot is pinned to fold from its member's manifest while the root slot
 * on the same tree folds from `release.versionFile`. The fold is the
 * real `semver-by-level` strategy, so a forecast here is the answer
 * settle would give over the same tree.
 */
import type { BranchForecast } from './branch-forecast.js';
import type { TreeFragment } from './fragment-tree.js';
import type { ReleasePrepared } from './prepare.js';
import type { ReleaseVerified } from './verify.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { Fragment } from '@open-tomato/rafa/release/fragment';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { parseFragment, serializeFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import {
  bodyWithRelease,
  forecastLine,
  readBranchForecast,
  RELEASE_BLOCK_CLOSE,
  releaseBodyBlock,
  releaseBodyLines,
} from './branch-forecast.js';
import { readFragmentTree } from './fragment-tree.js';
import { readGuard } from './guard.js';

const COMMIT = 'c'.repeat(40);
const SETTINGS = {
  releaseVersionFile: './package.json',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
} as const;

/** The branch's fragment, as step 3 verified it. */
const OURS: Fragment = { plan: 'rafa-21', title: 'the branch', level: 'patch', package: null, notes: ['- loop: a fix'] };

/** A fragment waiting on the base, parsed as the tree reader parses one. */
function waiting(id: string, fragment: Fragment, addedOn = '2026-09-18'): TreeFragment {
  return {
    id,
    path: `.changes/${id}.md`,
    commit: 'a'.repeat(40),
    addedOn,
    reading: parseFragment(serializeFragment(fragment)),
  };
}

/** A waiting fragment whose text does not parse. */
const BROKEN: TreeFragment = {
  id: 'rafa-9',
  path: '.changes/rafa-9.md',
  commit: 'a'.repeat(40),
  addedOn: '2026-09-17',
  reading: parseFragment('no front matter here\n'),
};

function preparedOver(queue: readonly TreeFragment[]): ReleasePrepared {
  return {
    kind: 'prepared',
    level: 'patch',
    levelSource: 'plan',
    notesLevel: 'patch',
    plan: 'rafa-21',
    fragment: OURS,
    file: { path: '.changes/rafa-21.md', resolved: '/repo/.changes/rafa-21.md', before: null, after: serializeFragment(OURS) },
    base: { ref: 'origin/main', commit: COMMIT, waiting: queue },
    fetched: true,
    problems: [],
  };
}

function verified(fragment: Fragment = OURS, path = '.changes/rafa-21.md'): ReleaseVerified {
  return { kind: 'verified', path, fragment, text: serializeFragment(fragment) };
}

/** A git runner answering `answer` to every call, recording the argv. */
function gitAnswering(answer: GitResult): { readonly run: (args: readonly string[]) => GitResult; readonly argv: string[] } {
  const argv: string[] = [];
  return {
    argv,
    run: (args) => {
      argv.push(args.join(' '));
      return answer;
    },
  };
}

const MANIFEST: GitResult = { ok: true, stdout: '{"name":"x","version":"0.25.0"}\n', stderr: '' };
const NOW = new Date('2026-09-20T23:30:00Z');

/** A planted base: a root manifest at 0.25.0 with one member, `@scope/plugin`, at 3.1.0. */
const PLANTED: Readonly<Record<string, string>> = {
  'package.json': '{"name":"x","version":"0.25.0","workspaces":["packages/*"]}\n',
  'packages/plugin/package.json': '{"name":"@scope/plugin","version":"3.1.0"}\n',
};

/** A runner answering `git show` and `git ls-tree` over `files` at {@link COMMIT}, recording the argv. */
function gitOver(files: Readonly<Record<string, string>>): { readonly run: GitRunner; readonly argv: string[] } {
  const argv: string[] = [];
  const run: GitRunner = (args) => {
    argv.push(args.join(' '));
    if (args[0] === 'show') {
      const text = files[(args[1] ?? '').slice(`${COMMIT}:`.length)];
      return text === undefined || !(args[1] ?? '').startsWith(`${COMMIT}:`)
        ? { ok: false, stdout: '', stderr: `fatal: invalid object name '${args[1] ?? ''}'.` }
        : { ok: true, stdout: text, stderr: '' };
    }
    if (args[0] === 'ls-tree' && args.at(-1) === COMMIT) {
      return { ok: true, stdout: `${Object.keys(files).join('\0')}\0`, stderr: '' };
    }
    return { ok: false, stdout: '', stderr: `fatal: unscripted git ${args.join(' ')}` };
  };
  return { run, argv };
}

describe('readBranchForecast', () => {
  it('reads the base version at step 1 commit, without a leading ./', () => {
    const git = gitAnswering(MANIFEST);

    readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(), now: NOW });

    expect(git.argv).toEqual([`show ${COMMIT}:package.json`]);
  });

  it('folds the waiting fragments then the branch, and ships the batch level', () => {
    const git = gitAnswering(MANIFEST);
    const queue = [waiting('rafa-19', { plan: 'rafa-19', title: 'waiting minor', level: 'minor', package: null, notes: ['- cli: new'] })];

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver(queue), verified: verified(), now: NOW });

    if (!read.ok || read.forecast.kind !== 'ships') throw new Error(`expected a shipping forecast, got ${JSON.stringify(read)}`);
    expect(read.baseVersion).toBe('0.25.0');
    expect(read.waiting).toEqual(['rafa-19']);
    expect(read.forecast.version).toBe('0.26.0');
    expect(read.forecast.sentence).toBe('ships as the next minor, 0.26.0 if merged now');
    // The branch fragment is added today, UTC: the newest date folded.
    expect(read.forecast.section).toContain('## 0.26.0 — 2026-09-20, waiting minor; the branch');
    expect(read.forecast.section).toContain('<!-- rafa:fragments rafa-19 rafa-21 -->');
  });

  it('ships its own patch when nothing waits, the control beside the batch case', () => {
    const git = gitAnswering(MANIFEST);

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(), now: NOW });

    expect(read.ok && read.forecast.kind === 'ships' && read.forecast.version).toBe('0.25.1');
  });

  it('holds a waiting package fragment out of the root forecast, and folds a waiting root fragment', () => {
    const git = gitAnswering(MANIFEST);
    const queue = [
      waiting('rafa-18', { plan: 'rafa-18', title: 'plugin major', level: 'major', package: '@scope/plugin', notes: ['- plugin: break'] }),
      waiting('rafa-19', { plan: 'rafa-19', title: 'waiting minor', level: 'minor', package: null, notes: ['- cli: new'] }),
    ];

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver(queue), verified: verified(), now: NOW });

    if (!read.ok || read.forecast.kind !== 'ships') throw new Error(`expected a shipping forecast, got ${JSON.stringify(read)}`);
    expect(read.waiting).toEqual(['rafa-19']);
    expect(read.forecast.version).toBe('0.26.0');
    expect(read.forecast.section).toContain('<!-- rafa:fragments rafa-19 rafa-21 -->');
    expect(read.problems).toEqual([]);
  });

  it('folds the waiting fragments of the branch fragment\'s own package, the control beside the root case', () => {
    const git = gitOver(PLANTED);
    const ours: Fragment = { ...OURS, package: '@scope/plugin' };
    const queue = [
      waiting('rafa-18', { plan: 'rafa-18', title: 'plugin major', level: 'major', package: '@scope/plugin', notes: ['- plugin: break'] }),
      waiting('rafa-19', { plan: 'rafa-19', title: 'waiting minor', level: 'minor', package: null, notes: ['- cli: new'] }),
    ];

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver(queue), verified: verified(ours), now: NOW });

    if (!read.ok || read.forecast.kind !== 'ships') throw new Error(`expected a shipping forecast, got ${JSON.stringify(read)}`);
    expect(read.waiting).toEqual(['rafa-18']);
    expect(read.forecast.version).toBe('4.0.0');
  });

  it('folds a package slot from the member manifest version at step 1 commit', () => {
    const git = gitOver(PLANTED);
    const ours: Fragment = { ...OURS, package: '@scope/plugin' };

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(ours), now: NOW });

    if (!read.ok || read.forecast.kind !== 'ships') throw new Error(`expected a shipping forecast, got ${JSON.stringify(read)}`);
    expect(read.baseVersion).toBe('3.1.0');
    expect(read.forecast.version).toBe('3.1.1');
    expect(git.argv).toContain(`show ${COMMIT}:packages/plugin/package.json`);
  });

  it('folds a root slot on the same planted base from release.versionFile (control)', () => {
    const git = gitOver(PLANTED);

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(), now: NOW });

    if (!read.ok || read.forecast.kind !== 'ships') throw new Error(`expected a shipping forecast, got ${JSON.stringify(read)}`);
    expect(read.baseVersion).toBe('0.25.0');
    expect(read.forecast.version).toBe('0.25.1');
    expect(git.argv).toEqual([`show ${COMMIT}:package.json`]);
  });

  it('answers no forecast with the guard\'s sentence for a package absent from the base', () => {
    const git = gitOver(PLANTED);
    const ours: Fragment = { ...OURS, package: '@scope/absent' };

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(ours), now: NOW });

    expect(read).toEqual({
      ok: false,
      ref: 'origin/main',
      problem: 'origin/main\'s workspace holds no package @scope/absent, so no forecast was folded',
      problems: [],
    });
    expect(forecastLine(read)).toBe(
      'Release forecast: none computed, because origin/main\'s workspace holds no package @scope/absent, so no forecast was folded',
    );
  });

  it('leaves a waiting fragment that does not parse out of the fold and names it', () => {
    const git = gitAnswering(MANIFEST);

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([BROKEN]), verified: verified(), now: NOW });

    expect(read.ok).toBe(true);
    expect(read.ok && read.waiting).toEqual([]);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain('origin/main\'s .changes/rafa-9.md was left out of the forecast');
  });

  it('answers ships no release for a none fragment', () => {
    const git = gitAnswering(MANIFEST);
    const none: Fragment = { ...OURS, level: 'none', notes: [] };

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(none), now: NOW });

    expect(read.ok && read.forecast.kind).toBe('none');
    expect(forecastLine(read)).toBe('Release forecast: this branch ships no release (level none) (origin/main at 0.25.0, no fragment waiting)');
  });

  it('answers not ok when the base version file cannot be read', () => {
    const git = gitAnswering({ ok: false, stdout: '', stderr: 'fatal: path not in tree' });

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(), now: NOW });

    expect(read).toEqual({
      ok: false,
      ref: 'origin/main',
      problem: 'origin/main:package.json could not be read: fatal: path not in tree',
      problems: [],
    });
  });

  it('answers not ok when the base manifest declares no version', () => {
    const git = gitAnswering({ ok: true, stdout: '{"name":"x"}\n', stderr: '' });

    const read = readBranchForecast({ git: git.run, settings: SETTINGS, prepared: preparedOver([]), verified: verified(), now: NOW });

    expect(!read.ok && read.problem).toBe('origin/main:package.json declares no version');
  });

  it('names a second fragment of one plan by its file name', () => {
    const git = gitAnswering(MANIFEST);

    const read = readBranchForecast({
      git: git.run,
      settings: SETTINGS,
      prepared: preparedOver([]),
      verified: verified(OURS, '.changes/rafa-21-2.md'),
      now: NOW,
    });

    expect(read.ok && read.forecast.kind === 'ships' && read.forecast.section).toContain('<!-- rafa:fragments rafa-21-2 -->');
  });
});

/** A temporary directory of this file's own, for the one real repository. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-branch-forecast-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('the body and the guard over one real repository', () => {
  it('forecast 0.3.0 from the plugin\'s own 0.2.0, not the root\'s 0.24.0, in the same sentence', () => {
    const home = join(tempBase, 'home');
    const repo = join(tempBase, 'repo');
    mkdirSync(home, { recursive: true });
    mkdirSync(repo, { recursive: true });
    const git = (args: readonly string[]): string => execFileSync('git', [...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        ...gitIdentityEnv(),
        GIT_AUTHOR_DATE: '2026-09-01T12:00:00Z',
        GIT_COMMITTER_DATE: '2026-09-01T12:00:00Z',
        LC_ALL: 'C',
      },
    }).trim();
    const commit = (files: Readonly<Record<string, string>>, message: string): string => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), text, 'utf8');
      }
      git(['add', '-A']);
      git(['commit', '-q', '--no-verify', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    };
    git(['init', '-q', '--initial-branch=main', '.']);
    const baseCommit = commit({
      'package.json': '{"name":"demo","version":"0.24.0","workspaces":["packages/*"]}\n',
      'packages/plugin/package.json': '{"name":"@scope/plugin","version":"0.2.0"}\n',
      '.changes/.gitkeep': '',
    }, 'base');
    git(['switch', '-q', '-c', 'feat/1192']);
    const fragment: Fragment = { plan: 'rafa-1192', title: 'plugin feature', level: 'minor', package: '@scope/plugin', notes: ['- plugin: new'] };
    commit({ '.changes/rafa-1192.md': serializeFragment(fragment) }, 'feat: plugin fragment');
    const runner = createGitRunner(repo);
    const settings = {
      releaseVersionFile: 'package.json',
      releaseChangelog: 'CHANGELOG.md',
      releaseFragments: '.changes',
      releaseStrategy: 'semver-by-level',
      releaseHeading: '## {version} — {date}, {title}',
      releaseMoveLock: false,
    } as const;
    const now = new Date('2026-09-29T12:00:00Z');

    const guard = readGuard({ git: runner, settings, base: 'main', branch: { ref: 'feat/1192', name: 'feat/1192', pullRequest: null }, now });
    const tree = readFragmentTree(runner, baseCommit, '.changes');
    if (!tree.ok) throw new Error(`tree not read: ${tree.problem}`);
    const body = readBranchForecast({
      git: runner,
      settings,
      prepared: { ...preparedOver(tree.fragments), base: { ref: 'main', commit: baseCommit, waiting: tree.fragments } },
      verified: verified(fragment, '.changes/rafa-1192.md'),
      now,
    });

    if (!guard.ok) throw new Error(`guard not read: ${guard.problem}`);
    const guardForecast = guard.forecast;
    if (guardForecast === null || !guardForecast.ok || guardForecast.forecast.kind !== 'ships') {
      throw new Error(`expected a shipping guard forecast, got ${JSON.stringify(guardForecast)}`);
    }
    if (!body.ok || body.forecast.kind !== 'ships') throw new Error(`expected a shipping body forecast, got ${JSON.stringify(body)}`);
    expect(guardForecast.baseVersion).toBe('0.2.0');
    expect(body.baseVersion).toBe('0.2.0');
    expect(guardForecast.forecast.version).toBe('0.3.0');
    expect(body.forecast.version).toBe('0.3.0');
    expect(body.forecast.sentence).toBe(guardForecast.forecast.sentence);
    expect(body.forecast.sentence).toContain('0.3.0');
  });
});

/** A shipping forecast over one waiting fragment, as the block renders it. */
const SHIPS: BranchForecast = {
  ok: true,
  ref: 'origin/main',
  baseVersion: '0.25.0',
  waiting: ['rafa-19', 'rafa-20'],
  forecast: {
    kind: 'ships',
    strategy: 'semver-by-level',
    baseVersion: '0.25.0',
    waiting: ['rafa-19', 'rafa-20'],
    version: '0.26.0',
    bump: 'minor',
    section: '## 0.26.0',
    sentence: 'ships as the next minor, 0.26.0 if merged now',
  },
  problems: [],
};

const UNREAD: BranchForecast = { ok: false, ref: 'origin/main', problem: 'origin/main:package.json declares no version', problems: [] };

describe('forecastLine', () => {
  it('names the sentence, the strategy, the base and how many fragments wait', () => {
    expect(forecastLine(SHIPS)).toBe(
      'Release forecast: this branch ships as the next minor, 0.26.0 if merged now'
        + ' (semver-by-level, origin/main at 0.25.0, 2 fragments waiting)',
    );
  });

  it('says why no forecast was computed', () => {
    expect(forecastLine(UNREAD)).toBe('Release forecast: none computed, because origin/main:package.json declares no version');
  });
});

describe('releaseBodyBlock', () => {
  it('answers null when there is neither a forecast nor a level report', () => {
    expect(releaseBodyBlock({ forecast: null, levelReport: null })).toBeNull();
  });

  it('carries the basis in the opening marker and both lines between the markers', () => {
    expect(releaseBodyBlock({ forecast: SHIPS, levelReport: 'the plan declares release: patch, below the minor' })).toBe([
      '<!-- rafa:release v1 base=0.25.0 waiting=rafa-19,rafa-20 -->',
      forecastLine(SHIPS),
      'Level report: the plan declares release: patch, below the minor',
      RELEASE_BLOCK_CLOSE,
    ].join('\n'));
  });

  it('opens with no basis when no forecast was folded', () => {
    expect(releaseBodyBlock({ forecast: UNREAD, levelReport: null })?.split('\n')[0]).toBe('<!-- rafa:release v1 -->');
    expect(releaseBodyBlock({ forecast: null, levelReport: 'x' })?.split('\n')[0]).toBe('<!-- rafa:release v1 -->');
  });

  it('writes an empty waiting list as an empty value', () => {
    const alone: BranchForecast = { ...SHIPS, waiting: [] };

    expect(releaseBodyBlock({ forecast: alone, levelReport: null })?.split('\n')[0]).toBe('<!-- rafa:release v1 base=0.25.0 waiting= -->');
  });

  it('lists the lines a reader sees without the markers', () => {
    expect(releaseBodyLines({ forecast: null, levelReport: 'x' })).toEqual(['Level report: x']);
  });
});

describe('bodyWithRelease', () => {
  const block = releaseBodyBlock({ forecast: SHIPS, levelReport: null }) ?? '';
  const older = releaseBodyBlock({ forecast: { ...SHIPS, baseVersion: '0.24.0', waiting: [] }, levelReport: null }) ?? '';

  it('puts the block under the body as its own paragraph', () => {
    expect(bodyWithRelease('Closes #21\n', null, block)).toBe(`Closes #21\n\n${block}`);
  });

  it('replaces an earlier block rather than adding a second one', () => {
    const body = `Closes #21\n\n${older}\n\n## Notes\n\nkept`;

    const next = bodyWithRelease(body, null, block);

    expect(next).toBe(`Closes #21\n\n## Notes\n\nkept\n\n${block}`);
    expect(next.split('<!-- rafa:release v1').length).toBe(2);
  });

  it('answers the body itself when it already carries the block', () => {
    const body = `Closes #21\n\n${block}`;

    expect(bodyWithRelease(body, null, block)).toBe(body);
  });

  it('appends a sentence once and leaves an earlier block where it is when no block is given', () => {
    const body = `Closes #21\n\n${older}`;

    expect(bodyWithRelease(body, 'no release commit: x', null)).toBe(`${body}\n\nno release commit: x`);
    expect(bodyWithRelease(`${body}\n\nno release commit: x`, 'no release commit: x', null)).toBe(`${body}\n\nno release commit: x`);
  });

  it('answers the block alone for an empty body', () => {
    expect(bodyWithRelease('', null, block)).toBe(block);
  });
});
