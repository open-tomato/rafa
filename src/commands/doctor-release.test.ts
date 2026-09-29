/**
 * Tests for the release row of `rafa doctor` (`doctor-release.ts`): the
 * reading, the row it renders, when it warns, and that `doctor` itself
 * prints it.
 *
 * Every reading case drives a real scratch world — a bare origin, a
 * clone that lands commits on `main` and pushes them, and the caller's
 * clone the row is read in — so the base version, the tags and the
 * fragment order are git's own answers.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - the warning case is read once before the caller fetches and once
 *     after: the same world gives an `info` row, then a warning, so the
 *     warning is known to follow the fragments and not the world;
 *   - the version the row forecasts is compared with `readSettle` over
 *     the same ref, so "the release settle would fold" is measured;
 *   - the tag, the base version and the top heading are planted as three
 *     different versions, so a part read off the wrong source fails;
 *   - a project whose release is off counts the git runners made, and
 *     the release-on case counts them too, so "sends no git command" is
 *     not a runner that was never going to be asked.
 */
import type { DoctorReleaseReading } from './doctor-release.js';
import type { RafaCommand } from '../cli/command.js';
import type { Output } from '../ports/index.js';
import type { Fragment } from '../release/fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';
import { serializeFragment } from '../release/fragment.js';
import { readSettle } from '../release/settle.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../tests/cli-capture.js';
import { SERVE_CLI_VERSION } from '../tiers/delivery.js';

import {
  readDoctorRelease,
  readTopHeading,
  releaseProblemLines,
  releaseRow,
  releaseWaits,
  writeDoctorRelease,
} from './doctor-release.js';
import { createDoctorCommand } from './doctor.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-release-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directory. */
let worldCount = 0;

/** The settings every case reads under, the release on outright. */
const CONFIG = {
  prBase: null,
  releaseEnabled: true,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
} as const;

/** The manifest on `main`, at a version neither the tag nor the heading names. */
const MANIFEST = '{\n  "name": "demo",\n  "version": "0.25.0"\n}\n';

/** The changelog on `main`, its top heading naming a version of its own. */
const CHANGELOG = '# Changelog\n\n## 0.24.1 — 2026-08-30, older\n\n- a note\n\n## 0.24.0 — 2026-08-20, oldest\n';

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
function fragmentText(plan: string, level: Fragment['level']): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes: [`- Area: ${plan} change`] });
}

/** A bare origin, a clone that lands on `main`, and the caller's clone. */
interface World {
  readonly dir: string;
  readonly home: string;
  readonly caller: string;
  /** Runs git in `cwd` under the isolated environment, answering stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
  /** Writes each path's text in the landing clone, commits at `date` and pushes `main`. */
  readonly land: (files: Readonly<Record<string, string>>, message: string, date?: string) => void;
}

/** Builds a {@link World} whose `main` holds the manifest and the changelog, tagged `v0.24.0`. */
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
  land({ 'package.json': MANIFEST, 'CHANGELOG.md': CHANGELOG, ...seed }, 'first');
  git(other, ['tag', 'v0.24.0']);
  git(other, ['push', '-q', 'origin', 'v0.24.0']);
  git(dir, ['clone', '-q', origin, caller]);
  return { dir, home, caller, git, land };
}

/** Lands `rafa-9` (minor) on 2026-09-10, then `rafa-1` (patch) on 2026-09-11. */
function landTwo(w: World): void {
  w.land({ '.changes/rafa-9.md': fragmentText('rafa-9', 'minor') }, 'merge rafa-9', '2026-09-10T12:00:00Z');
  w.land({ '.changes/rafa-1.md': fragmentText('rafa-1', 'patch') }, 'merge rafa-1', '2026-09-11T12:00:00Z');
}

/** An enabled reading, or a thrown error naming what came back instead. */
function enabledOf(reading: DoctorReleaseReading): Extract<DoctorReleaseReading, { enabled: true }> {
  if (!reading.enabled) throw new Error('expected the release row to be read');
  return reading;
}

/** The seams of a case counting the git runners it makes. */
function countingSeams(): { readonly made: () => number; readonly releaseGit: (root: string) => ReturnType<typeof createGitRunner> } {
  let made = 0;
  return {
    made: () => made,
    releaseGit: (root: string) => {
      made += 1;
      return createGitRunner(root);
    },
  };
}

/** An output recording each line at the level it was written. */
function recordingOutput(): { readonly output: Output; readonly seen: Array<readonly [string, string]> } {
  const seen: Array<readonly [string, string]> = [];
  const at = (level: string) => (message: string): void => {
    seen.push([level, message]);
  };
  const output: Output = {
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
    emit: () => undefined,
    result: () => undefined,
  };
  return { output, seen };
}

describe('readDoctorRelease', () => {
  it('names the base version, the latest tag, the top heading, and no fragment waiting', () => {
    const w = world();
    const seams = countingSeams();

    const reading = enabledOf(readDoctorRelease({ root: w.caller, config: CONFIG }, seams));

    expect(seams.made()).toBe(1);
    expect(releaseWaits(reading)).toBe(false);
    expect(releaseRow(reading))
      .toBe('Release: origin/main at 0.25.0, latest tag v0.24.0, CHANGELOG.md tops at 0.24.1, no fragment waits.');
    expect(releaseProblemLines(reading)).toEqual([]);
  });

  it('warns naming rafa release settle once fragments wait on origin/main as last fetched', () => {
    const w = world();
    landTwo(w);

    const before = enabledOf(readDoctorRelease({ root: w.caller, config: CONFIG }));
    w.git(w.caller, ['fetch', '-q', 'origin']);
    const after = enabledOf(readDoctorRelease({ root: w.caller, config: CONFIG }));

    expect(releaseWaits(before)).toBe(false);
    expect(releaseWaits(after)).toBe(true);
    expect(releaseRow(after)).toBe('Release: origin/main at 0.25.0, latest tag v0.24.0, CHANGELOG.md tops at 0.24.1,'
      + ' 2 fragments wait (rafa-9, rafa-1): settles as the next minor, 0.26.0;'
      + ' run rafa release settle to fold them into one version.');
  });

  it('forecasts the version readSettle folds over the same ref', () => {
    const w = world();
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin']);

    const reading = enabledOf(readDoctorRelease({ root: w.caller, config: CONFIG }));
    const settle = readSettle(createGitRunner(w.caller), 'origin/main', CONFIG);

    if (settle.outcome !== 'folded') throw new Error(`expected folded, got ${settle.outcome}`);
    expect(reading.waiting.forecast).toMatchObject({ kind: 'settles', version: settle.version });
  });

  it('warns for a fragment that does not parse, saying settle would refuse, with the reason under the row', () => {
    const w = world({ '.changes/rafa-bad.md': 'no front matter here\n' });

    const reading = enabledOf(readDoctorRelease({ root: w.caller, config: CONFIG }));

    expect(releaseWaits(reading)).toBe(true);
    expect(releaseRow(reading)).toContain(', 1 fragment waits: 1 does not parse, so settle would refuse; run rafa release settle');
    expect(releaseProblemLines(reading)).toHaveLength(1);
    expect(releaseProblemLines(reading)[0]).toStartWith('  .changes/rafa-bad.md does not parse, so settle would refuse: ');
  });

  it('marks what it could not read as ? and says why, without warning', () => {
    const w = world();
    const lone = join(w.dir, 'lone');
    mkdirSync(lone);
    w.git(lone, ['init', '-q', '--initial-branch=main']);
    writeFileSync(join(lone, 'package.json'), MANIFEST);

    const reading = enabledOf(readDoctorRelease({ root: lone, config: CONFIG }));

    expect(releaseWaits(reading)).toBe(false);
    expect(releaseRow(reading))
      .toBe('Release: origin/main at ?, no release tag, CHANGELOG.md tops at ?, fragments ?.');
    const problems = releaseProblemLines(reading);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toStartWith('  the tree of origin/main could not be read');
    expect(problems[1]).toBe(`  the changelog could not be read at ${join(lone, 'CHANGELOG.md')}`);
  });

  it('reads nothing and makes no git runner where the release is off', () => {
    const w = world();
    const seams = countingSeams();

    const off = readDoctorRelease({ root: w.caller, config: { ...CONFIG, releaseEnabled: false } }, seams);
    const auto = readDoctorRelease({ root: w.caller, config: { ...CONFIG, releaseEnabled: 'auto', releaseChangelog: 'NEWS.md' } }, seams);

    expect(off).toEqual({ enabled: false });
    expect(auto).toEqual({ enabled: false });
    expect(seams.made()).toBe(0);
  });
});

describe('readTopHeading', () => {
  it('answers the first version a heading names, skipping a heading that names none', () => {
    const w = world();
    writeFileSync(join(w.caller, 'NEWS.md'), '# News\n\n## Unreleased\n\n```\n## 9.9.9\n```\n\n## v1.2.3 — 2026-01-01\n');

    expect(readTopHeading(w.caller, 'NEWS.md')).toEqual({ path: 'NEWS.md', version: '1.2.3', problem: null });
  });

  it('says the changelog names no version when no heading does', () => {
    const w = world();
    writeFileSync(join(w.caller, 'NEWS.md'), '# News\n');

    const reading = enabledOf(readDoctorRelease({ root: w.caller, config: { ...CONFIG, releaseChangelog: 'NEWS.md' } }));

    expect(releaseRow(reading)).toContain(', NEWS.md names no version,');
  });
});

describe('writeDoctorRelease', () => {
  it('writes the row at info in text mode while nothing waits, and nothing in json mode', () => {
    const reading = readDoctorRelease({ root: world().caller, config: CONFIG });
    const text = recordingOutput();
    const json = recordingOutput();

    writeDoctorRelease({ output: text.output, outputMode: 'text' }, reading);
    writeDoctorRelease({ output: json.output, outputMode: 'json' }, reading);

    expect(text.seen.map(([level]) => level)).toEqual(['info']);
    expect(json.seen).toEqual([]);
  });

  it('warns in both modes while fragments wait', () => {
    const w = world();
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin']);
    const reading = readDoctorRelease({ root: w.caller, config: CONFIG });
    const text = recordingOutput();
    const json = recordingOutput();

    writeDoctorRelease({ output: text.output, outputMode: 'text' }, reading);
    writeDoctorRelease({ output: json.output, outputMode: 'json' }, reading);

    expect(text.seen.map(([level]) => level)).toEqual(['warn']);
    expect(json.seen.map(([level]) => level)).toEqual(['warn']);
    expect(json.seen[0]?.[1]).toContain('run rafa release settle');
  });

  it('writes nothing where the release is off', () => {
    const text = recordingOutput();

    writeDoctorRelease({ output: text.output, outputMode: 'text' }, { enabled: false });

    expect(text.seen).toEqual([]);
  });
});

describe('rafa doctor', () => {
  /** The doctor command with no claude spawned and a tier inventory under `home`. */
  function doctorCommand(home: string): RafaCommand {
    return createDoctorCommand({
      checks: { now: () => 0 },
      readClaudeVersion: () => Promise.resolve(SERVE_CLI_VERSION),
      inventory: { entry: () => join(home, 'runtime', 'cli.js') },
    });
  }

  it('prints the release row, as a warning, and gives it as json\'s release', async () => {
    const w = world();
    landTwo(w);
    w.git(w.caller, ['fetch', '-q', 'origin']);
    plantProjectConfig(w.caller);
    const project = { root: w.caller, home: w.home };
    const env = { PATH: process.env['PATH'] ?? '' };

    const text = await dispatchInProject(['doctor'], [], [doctorCommand(w.home)], project, env);
    const json = await dispatchInProject(['doctor', '--output=json'], [], [doctorCommand(w.home)], project, env);

    expect(text.exitCode).toBe(0);
    expect(`${text.stdout}${text.stderr}`).toContain('Release: origin/main at 0.25.0, latest tag v0.24.0,');
    expect(`${text.stdout}${text.stderr}`).toContain('run rafa release settle to fold them into one version.');
    const result = eventsOf(json.stdout).find((event) => event.type === 'result');
    expect(result).toMatchObject({ data: { release: { enabled: true, latestTag: 'v0.24.0' } } });
  });
});
