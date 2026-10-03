/**
 * Tests for the forecast column of `rafa pr list` (`list-forecast.ts`):
 * the cell and the line under the table for every shape a body and a
 * base can take, the base read once per branch, and the column as the
 * dispatched command prints it over a real repository.
 *
 * Every body a case reads is written by the wrap-up's own writer
 * (`forecastRelease`, `releaseBodyBlock`, `bodyWithRelease`), so the
 * reader is measured against the block the loop actually writes.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - the unit cases hand a base reader that records each branch it was
 *     asked for, so "a body with no basis reads no base" and "each base
 *     is read once" are readings, not claims;
 *   - the dispatched cases run over a bare origin and a clone whose
 *     `origin/main` really holds the fragments, and the same bodies in a
 *     project whose release is off print no column at all, so the column
 *     is known to follow `release.enabled`;
 *   - the provider double's call log is asserted, so the column is known
 *     to cost no `gh` command beyond the list's own `1 + 2n`.
 */
import type { BaseNow, BaseReader, PrListForecast } from './list-forecast.js';
import type { RafaCommand } from '../../cli/command.js';
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { PullRequestDetail, PullRequestSummary } from '../../pr/index.js';
import type { BranchForecast } from '../../release/branch-forecast.js';
import type { FoldFragment } from '../../release/strategy.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/index.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { bodyWithRelease, releaseBodyBlock } from '../../release/branch-forecast.js';
import { forecastRelease } from '../../release/forecast.js';
import { serializeFragment } from '../../release/fragment.js';
import { releaseStrategyFor } from '../../release/strategy.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import {
  createBaseReader,
  forecastCell,
  forecastLine,
  listForecast,
  MOVED_MARK,
  NO_FORECAST,
  UNCHECKED_MARK,
} from './list-forecast.js';
import { createPrListCommand, UNREADABLE } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-list-forecast-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SEMVER = releaseStrategyFor('semver-by-level', { heading: '## {version} — {date}, {title}' });

/** The sentence every shipping body below carries. */
const SHIPS_MINOR = 'ships as the next minor, 0.26.0 if merged now';

/** A fragment of `level` named `id`. */
function fragmentOf(id: string, level: PlanReleaseLevel): FoldFragment {
  const notes = level === 'none'
    ? []
    : [`- Area ${id}: change`];
  return { id, addedOn: '2026-09-29', fragment: { plan: id, title: `title of ${id}`, level, notes } };
}

/** The body the wrap-up writes for a minor branch fragment over `waiting` at `baseVersion`. */
function writtenBody(baseVersion: string, waiting: readonly string[]): string {
  const folded = waiting.map((id) => fragmentOf(id, 'patch'));
  const forecast: BranchForecast = {
    ok: true,
    ref: 'origin/main',
    baseVersion,
    waiting,
    forecast: forecastRelease({ strategy: SEMVER, baseVersion, waiting: folded, branch: fragmentOf('rafa-21', 'minor') }),
    problems: [],
  };
  return bodyWithRelease('Closes #21', null, releaseBodyBlock({ forecast, levelReport: null }));
}

/** A base reader answering `now` for every branch, recording each branch it was asked for. */
function recordingReader(now: BaseNow): { readonly read: BaseReader; readonly asked: () => readonly string[] } {
  const asked: string[] = [];
  return {
    read: (branch) => {
      asked.push(branch);
      return now;
    },
    asked: () => [...asked],
  };
}

/** A base at `baseVersion` with `waiting`. */
function baseAt(baseVersion: string, waiting: readonly string[]): BaseNow {
  return { ref: 'origin/main', basis: { baseVersion, waiting }, problem: null };
}

describe('listForecast, forecastCell and forecastLine', () => {
  it('shows the body sentence alone, and says nothing under the table, when the base has not moved', () => {
    const reader = recordingReader(baseAt('0.25.0', ['rafa-19']));

    const forecast = listForecast(writtenBody('0.25.0', ['rafa-19']), 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe(SHIPS_MINOR);
    expect(forecastLine(21, forecast)).toBeNull();
    expect(reader.asked()).toEqual(['main']);
  });

  it('marks the sentence and names both bases when the base version moved', () => {
    const reader = recordingReader(baseAt('0.26.0', []));

    const forecast = listForecast(writtenBody('0.25.0', ['rafa-19']), 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe(`${SHIPS_MINOR} ${MOVED_MARK}`);
    expect(forecastLine(21, forecast)).toBe(
      '#21 forecast was made against origin/main at 0.25.0 with rafa-19 waiting;'
        + ' origin/main is now at 0.26.0 with none waiting',
    );
  });

  it('marks the sentence when only the waiting fragments moved', () => {
    const reader = recordingReader(baseAt('0.25.0', ['rafa-19', 'rafa-20']));

    const forecast = listForecast(writtenBody('0.25.0', ['rafa-19']), 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe(`${SHIPS_MINOR} ${MOVED_MARK}`);
    expect(forecastLine(21, forecast)).toContain('origin/main is now at 0.25.0 with rafa-19, rafa-20 waiting');
  });

  it('marks the sentence as unchecked, and says why, when the base cannot be read', () => {
    const reader = recordingReader({ ref: 'origin/main', basis: null, problem: 'origin/main names no commit' });

    const forecast = listForecast(writtenBody('0.25.0', []), 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe(`${SHIPS_MINOR} ${UNCHECKED_MARK}`);
    expect(forecastLine(21, forecast)).toBe('#21 forecast could not be checked against origin/main — origin/main names no commit');
  });

  it('reads no base for a body carrying no forecast', () => {
    const reader = recordingReader(baseAt('0.25.0', []));

    const forecast = listForecast('Closes #21\n\nNo release block.', 'main', reader.read);

    expect(forecast).toEqual({ kind: 'absent' });
    expect(forecastCell(forecast, UNREADABLE)).toBe(NO_FORECAST);
    expect(forecastLine(21, forecast)).toBeNull();
    expect(reader.asked()).toEqual([]);
  });

  it('reads no base for a forecast the wrap-up could not compute', () => {
    const reader = recordingReader(baseAt('0.25.0', []));
    const unread: BranchForecast = { ok: false, ref: 'origin/main', problem: 'no version', problems: [] };
    const body = bodyWithRelease('', null, releaseBodyBlock({ forecast: unread, levelReport: null }));

    expect(listForecast(body, 'main', reader.read)).toEqual({ kind: 'absent' });
    expect(reader.asked()).toEqual([]);
  });

  it('shows the table mark for a body that could not be read, and leaves the line to the mergeable probe', () => {
    const reader = recordingReader(baseAt('0.25.0', []));

    const forecast = listForecast(null, 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe(UNREADABLE);
    expect(forecastLine(21, forecast)).toBeNull();
    expect(reader.asked()).toEqual([]);
  });

  it('shows a sentence whose marker names no basis as it is, reading no base', () => {
    const reader = recordingReader(baseAt('0.25.0', []));
    const body = '<!-- rafa:release v1 -->\nRelease forecast: this branch ships as 1.0.0 if merged now (x)\n<!-- /rafa:release -->';

    const forecast: PrListForecast = listForecast(body, 'main', reader.read);

    expect(forecastCell(forecast, UNREADABLE)).toBe('ships as 1.0.0 if merged now');
    expect(forecastLine(21, forecast)).toBeNull();
    expect(reader.asked()).toEqual([]);
  });
});

// --- over a real repository --------------------------------------------------

/** How many worlds this file has made, so each gets its own directory. */
let worldCount = 0;

/** The manifest on `main`. */
const MANIFEST = '{\n  "name": "demo",\n  "version": "0.25.0"\n}\n';

/** The config every dispatched case plants. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: '2026-09-01T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-09-01T12:00:00Z',
    LC_ALL: 'C',
  };
}

/** A bare origin whose `main` holds `files`, and the caller's clone of it with a project config. */
interface World {
  readonly caller: string;
  readonly home: string;
}

/** Builds a {@link World}: `files` land on `main` in one commit, then the caller clones. */
function world(files: Readonly<Record<string, string>>): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const other = join(dir, 'other');
  const caller = join(dir, 'caller');
  mkdirSync(home, { recursive: true });
  const git = (cwd: string, args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd, env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  };
  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(other, path)), { recursive: true });
    writeFileSync(join(other, path), text);
  }
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);
  git(dir, ['clone', '-q', origin, caller]);
  plantProjectConfig(caller, GH_CONFIG);
  return { caller, home };
}

/** The files of a base at 0.25.0 with `rafa-19` waiting, and a changelog unless `withChangelog` is false. */
function baseFiles(withChangelog = true): Readonly<Record<string, string>> {
  return {
    'package.json': MANIFEST,
    '.changes/rafa-19.md': serializeFragment({ plan: 'rafa-19', title: 'title of rafa-19', level: 'patch', notes: ['- Area: fix'] }),
    ...(withChangelog
      ? { 'CHANGELOG.md': '# Changelog\n\n## 0.25.0 — 2026-09-01, first\n\n- first\n' }
      : {}),
  };
}

/** An open pull request `number` from `head` into `main`. */
function summaryOf(number: number, head: string): PullRequestSummary {
  return {
    number,
    title: `title of ${head}`,
    state: 'open',
    url: `https://github.com/open-tomato/rafa/pull/${number}`,
    headRefName: head,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-29T10:00:00Z',
  };
}

/** A provider listing two pull requests: #21 forecast against today's base, #22 against an older one. */
function twoPulls(): ReturnType<typeof createPullRequestsDouble> {
  const bodies: Readonly<Record<number, string>> = {
    21: writtenBody('0.25.0', ['rafa-19']),
    22: writtenBody('0.25.0', []),
  };
  const pulls = [summaryOf(21, 'rafa-21'), summaryOf(22, 'rafa-22')];
  return createPullRequestsDouble({
    list: () => Promise.resolve(pulls),
    get: (number: number): Promise<PullRequestDetail | null> => Promise.resolve({
      ...(pulls.find((each) => each.number === number) ?? summaryOf(number, 'gone')),
      body: bodies[number] ?? '',
      headRefOid: 'abc',
      mergeable: 'mergeable',
      mergeStateStatus: 'CLEAN',
      labels: [],
    }),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
  });
}

/** Dispatches `rafa pr list` from `w`'s clone over `double`, with git counted. */
async function listIn(w: World, double: ReturnType<typeof createPullRequestsDouble>, words: readonly string[] = []) {
  const gitCalls: string[] = [];
  const real = createGitRunner(w.caller);
  const command: RafaCommand = createPrListCommand({
    pullRequests: () => double.pulls,
    readRemote: () => 'git@github.com:open-tomato/rafa.git',
    git: () => (args) => {
      gitCalls.push(args.join(' '));
      return real(args);
    },
  });
  const run = await dispatchInProject(['pr', 'list', ...words], [{ name: 'pr', summary: 'pull requests' }], [command], {
    root: w.caller,
    home: w.home,
  });
  return { run, gitCalls };
}

describe('the forecast column of rafa pr list', () => {
  it('shows each body forecast and marks the one whose base moved, reading origin/main once', async () => {
    const w = world(baseFiles());
    const double = twoPulls();

    const { run, gitCalls } = await listIn(w, double);

    expect(run.exitCode).toBe(0);
    const lines = run.stdout.split('\n');
    const row21 = lines.find((line) => line.includes('#21')) ?? '';
    const row22 = lines.find((line) => line.trimStart().startsWith('#22 ')) ?? '';
    expect(row21.endsWith(SHIPS_MINOR)).toBe(true);
    expect(row22.endsWith(`${SHIPS_MINOR} ${MOVED_MARK}`)).toBe(true);
    expect(run.stdout).toContain(
      '#22 forecast was made against origin/main at 0.25.0 with none waiting;'
        + ' origin/main is now at 0.25.0 with rafa-19 waiting',
    );
    expect(run.stdout).not.toContain('#21 forecast');
    expect(gitCalls.filter((call) => call.startsWith('rev-parse'))).toHaveLength(1);
    expect(gitCalls.some((call) => call.startsWith('fetch'))).toBe(false);
    expect(double.sent()).toEqual(['list', 'checks 21', 'get 21', 'checks 22', 'get 22']);
  });

  it('carries each row forecast in json mode', async () => {
    const w = world(baseFiles());

    const { run } = await listIn(w, twoPulls(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    const last = run.stdout
      .trim()
      .split('\n')
      .at(-1) ?? '{}';
    const rows = (JSON.parse(last) as { data: { rows: { forecast: PrListForecast | null }[] } }).data.rows;
    expect(rows.map((row) => (row.forecast?.kind === 'body'
      ? row.forecast.moved
      : null))).toEqual([false, true]);
  });

  it('leaves the column out, reading no git, where the release is off', async () => {
    const w = world(baseFiles(false));

    const { run, gitCalls } = await listIn(w, twoPulls());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('#22');
    expect(run.stdout).not.toContain('ships as');
    expect(run.stdout).not.toContain(MOVED_MARK);
    expect(gitCalls).toEqual([]);
  });
});

describe('createBaseReader', () => {
  it('reads a base once however often it is asked, and names a base it cannot read', () => {
    const w = world(baseFiles());
    const calls: string[] = [];
    const real = createGitRunner(w.caller);
    const read = createBaseReader((args) => {
      calls.push(args.join(' '));
      return real(args);
    }, {
      releaseFragments: '.changes',
      releaseVersionFile: 'package.json',
      releaseStrategy: 'semver-by-level',
      releaseHeading: '## {version} — {date}, {title}',
    });

    const first = read('main');
    const count = calls.length;
    const again = read('main');
    const missing = read('nowhere');

    expect(first).toEqual(baseAt('0.25.0', ['rafa-19']));
    expect(again).toBe(first);
    expect(calls.length).toBeGreaterThan(count);
    expect(calls.slice(count).some((call) => call.includes('origin/main'))).toBe(false);
    expect(missing.ref).toBe('origin/nowhere');
    expect(missing.basis).toBeNull();
    expect(missing.problem).not.toBeNull();
  });
});
