/**
 * Tests for the waiting-fragments reading of `rafa release status`
 * (`status-fragments.ts`): which fragments it lists and in what order,
 * the forecast it prints, and the cells it answers when something could
 * not be read or would make settle refuse.
 *
 * Every reading case drives a real scratch world — a bare origin, a
 * clone that lands commits on `main` and pushes them, and the caller's
 * clone the reading runs in — so the tree, the add order and the base
 * version are git's own answers, not a table's.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - the forecast is compared with `readSettle` over the same ref, so
 *     "the release settle would fold" is measured, not assumed;
 *   - the two fragments land minor first, then patch, under ids that
 *     sort the other way, so an order read off the names would fail;
 *   - a fragment committed in the caller's clone and never pushed is
 *     NOT listed, so the reading is known to be of `origin/main` and not
 *     of the checkout;
 *   - a fragment landed after the caller's last fetch is not listed
 *     until the caller fetches, which is what "as last fetched" says.
 */
import type { WaitingSettings } from './status-fragments.js';
import type { RafaCommand } from '../../cli/command.js';
import type { Fragment } from '../../release/fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/index.js';
import { serializeFragment } from '../../release/fragment.js';
import { readSettle } from '../../release/settle.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { readWaiting, waitingCell, waitingLines, waitingSettingsOf } from './status-fragments.js';
import { createReleaseStatusCommand } from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-fragments-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directory. */
let worldCount = 0;

/** The settings every case reads under. */
const SETTINGS: WaitingSettings = {
  ref: 'origin/main',
  releaseFragments: '.changes',
  releaseVersionFile: 'package.json',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The manifest on `main`. */
const MANIFEST = '{\n  "name": "demo",\n  "version": "0.25.0"\n}\n';

/** The committer date every setup commit gets unless one is named. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string, date: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    LC_ALL: 'C',
  };
}

/** A fragment's text. */
function fragmentText(plan: string, level: Fragment['level']): string {
  const notes = level === 'none'
    ? []
    : [`- Area: ${plan} change`];
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** A bare origin, a clone that lands on `main`, and the caller's clone. */
interface World {
  readonly dir: string;
  readonly caller: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[], date?: string) => string;
  /** Writes each path's text in the landing clone, commits at `date` and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string, date?: string) => void;
}

/** Builds a {@link World} whose `main` holds the manifest, the caller cloned after `seed` landed. */
function world(seed: Readonly<Record<string, string>> = {}): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const other = join(dir, 'other');
  const caller = join(dir, 'caller');
  mkdirSync(home, { recursive: true });
  const git = (cwd: string, args: readonly string[], date = SETUP_DATE): string => execFileSync(
    'git',
    [...args],
    { cwd, encoding: 'utf8', env: isolatedEnv(home, date), stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const land = (files: Readonly<Record<string, string>>, message: string, date = SETUP_DATE): void => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(other, path)), { recursive: true });
      writeFileSync(join(other, path), text);
    }
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', message], date);
    git(other, ['push', '-q', 'origin', 'main']);
  };

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  land({ 'package.json': MANIFEST, ...seed }, 'first');
  git(dir, ['clone', '-q', origin, caller]);
  return { dir, caller, git, land };
}

/** Lands `rafa-9` (minor) on 2026-09-10, then `rafa-1` (patch) on 2026-09-11. */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9', '2026-09-10T12:00:00Z');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch') }, 'merge rafa-1', '2026-09-11T12:00:00Z');
  w.git(w.caller, ['fetch', '-q', 'origin']);
}

describe('readWaiting', () => {
  it('lists the waiting fragments in add order, with the release settle would fold them into', () => {
    const w = world();
    landTwo(w);
    const git = createGitRunner(w.caller);

    const reading = readWaiting(git, SETTINGS);

    expect(reading.problems).toEqual([]);
    expect(reading.baseVersion).toBe('0.25.0');
    expect(reading.fragments.map((each) => [each.id, each.level, each.addedOn])).toEqual([
      ['rafa-9', 'minor', '2026-09-10'],
      ['rafa-1', 'patch', '2026-09-11'],
    ]);
    expect(reading.forecast).toMatchObject({ kind: 'settles', version: '0.26.0', bump: 'minor', waiting: ['rafa-9', 'rafa-1'] });
    expect(waitingCell(reading)).toBe('2 fragments on origin/main at 0.25.0, settles as the next minor, 0.26.0');
  });

  it('forecasts the same version and section `readSettle` folds over the same ref', () => {
    const w = world();
    landTwo(w);
    const git = createGitRunner(w.caller);

    const reading = readWaiting(git, SETTINGS);
    const settle = readSettle(git, 'origin/main', { ...SETTINGS, releaseChangelog: 'CHANGELOG.md' });

    if (settle.outcome !== 'folded') throw new Error(`expected folded, got ${settle.outcome}`);
    if (reading.forecast?.kind !== 'settles') throw new Error(`expected settles, got ${String(reading.forecast?.kind)}`);
    expect(reading.forecast.version).toBe(settle.version);
    expect(reading.forecast.section).toBe(settle.section);
  });

  it('reads origin/main as last fetched: neither an unpushed nor an unfetched fragment is listed', () => {
    const w = world();
    w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9');
    w.git(w.caller, ['fetch', '-q', 'origin']);
    mkdirSync(join(w.caller, '.changes'), { recursive: true });
    writeFileSync(join(w.caller, '.changes', 'rafa-local.md'), fragmentText('rafa-local', 'major'));
    w.git(w.caller, ['add', '-A']);
    w.git(w.caller, ['commit', '-q', '-m', 'local only']);
    w.land({ '.changes/rafa-late.md': fragmentText('rafa-late', 'patch') }, 'merge rafa-late');
    const git = createGitRunner(w.caller);

    const before = readWaiting(git, SETTINGS);
    w.git(w.caller, ['fetch', '-q', 'origin']);
    const after = readWaiting(git, SETTINGS);

    expect(before.fragments.map((each) => each.id)).toEqual(['rafa-9']);
    expect(after.fragments.map((each) => each.id)).toEqual(['rafa-9', 'rafa-late']);
  });

  it('answers none waiting, and no forecast problem, for a base with no fragment', () => {
    const w = world();

    const reading = readWaiting(createGitRunner(w.caller), SETTINGS);

    expect(reading.forecast?.kind).toBe('empty');
    expect(reading.problems).toEqual([]);
    expect(waitingCell(reading)).toBe('none on origin/main');
    expect(waitingLines(reading)).toEqual([]);
  });

  it('says settle ships nothing when every waiting fragment is level none', () => {
    const w = world({ '.changes/rafa-2.md': fragmentText('rafa-2', 'none') });

    const reading = readWaiting(createGitRunner(w.caller), SETTINGS);

    expect(waitingCell(reading))
      .toBe('1 fragment on origin/main at 0.25.0, settles no release (every waiting fragment is level none)');
  });

  it('makes no forecast while a fragment does not parse, and names it under the block', () => {
    const w = world({
      '.changes/rafa-9.md': fragmentText('rafa-9', 'minor'),
      '.changes/rafa-bad.md': 'no front matter here\n',
    });

    const reading = readWaiting(createGitRunner(w.caller), SETTINGS);

    expect(reading.forecast).toBeNull();
    expect(reading.fragments.map((each) => each.id)).toEqual(['rafa-9']);
    expect(reading.malformed).toBe(1);
    expect(waitingCell(reading)).toBe('2 fragments on origin/main at 0.25.0, 1 does not parse, so settle would refuse');
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toStartWith('.changes/rafa-bad.md does not parse, so settle would refuse: ');
  });

  it('lists the fragments but makes no forecast when the base version cannot be read', () => {
    const w = world({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') });

    const reading = readWaiting(createGitRunner(w.caller), { ...SETTINGS, releaseVersionFile: 'Cargo.toml' });

    expect(reading.forecast).toBeNull();
    expect(reading.baseVersion).toBeNull();
    expect(waitingCell(reading)).toBe('1 fragment on origin/main, no forecast, the base version could not be read');
    expect(reading.problems[0]).toStartWith('the base version could not be read: ');
  });

  it('reads nothing, and says why, where the ref does not exist', () => {
    const w = world();

    const reading = readWaiting(createGitRunner(w.caller), { ...SETTINGS, ref: 'origin/trunk' });

    expect(reading.read).toBe(false);
    expect(waitingCell(reading)).toBeNull();
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toStartWith('the tree of origin/trunk could not be read');
  });
});

describe('waitingLines', () => {
  it('writes one line per fragment, its id and level padded to one column', () => {
    const w = world();
    w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9', '2026-09-10T12:00:00Z');
    w.land({ '.changes/rafa-100.md': fragmentText('rafa-100', 'patch') }, 'merge rafa-100', '2026-09-11T12:00:00Z');
    w.git(w.caller, ['fetch', '-q', 'origin']);

    const lines = waitingLines(readWaiting(createGitRunner(w.caller), SETTINGS));

    expect(lines).toEqual([
      'rafa-9    minor  2026-09-10  title of rafa-9',
      'rafa-100  patch  2026-09-11  title of rafa-100',
    ]);
  });
});

describe('waitingSettingsOf', () => {
  const config = {
    releaseFragments: '.changes',
    releaseVersionFile: 'package.json',
    releaseStrategy: 'semver-by-level',
    releaseHeading: '## {version}',
  } as const;

  it('reads origin/<pr.base>, and origin/main when the project names no base', () => {
    expect(waitingSettingsOf({ ...config, prBase: 'develop' }).ref).toBe('origin/develop');
    expect(waitingSettingsOf({ ...config, prBase: null }).ref).toBe('origin/main');
  });
});

describe('rafa release status, dispatched', () => {
  it('prints the waiting line and the fragments under it, after the pending notes', async () => {
    const w = world();
    landTwo(w);
    const project = plantProject(join(w.dir, 'scope'), 'release:\n  versionFile: package.json\n');
    const command: RafaCommand = createReleaseStatusCommand({
      git: () => createGitRunner(w.caller),
      readNotes: () => [],
    });

    const run = await dispatchInProject(['release', 'status', '--plan=rafa-9'], [{ name: 'release', summary: 'releases' }], [command], project);

    const lines = run.stdout.split('\n');
    const at = lines.findIndex((line) => line.trimStart().startsWith('waiting'));
    expect(run.exitCode).toBe(0);
    expect(at).toBeGreaterThan(lines.findIndex((line) => line.trimStart().startsWith('pending')));
    expect(lines[at]).toBe('  waiting       2 fragments on origin/main at 0.25.0, settles as the next minor, 0.26.0');
    expect(lines.slice(at + 1, at + 3)).toEqual([
      '                rafa-9  minor  2026-09-10  title of rafa-9',
      '                rafa-1  patch  2026-09-11  title of rafa-1',
    ]);
  });
});
