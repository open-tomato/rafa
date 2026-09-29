/**
 * Tests for the release guard (`guard.ts`): the pure judgement over
 * literal facts, and `readGuard` over real repositories — a bare origin
 * and a clone that lands commits on `main` and pushes them, the guard
 * reading `origin/main` as `rafa pr merge` would.
 *
 * The git cases measure git's own answers: which commit `-S` names for a
 * section a `--no-ff` merge brought in, which commit set a version file
 * whose later commits kept the version, and what settle folds once the
 * guarded branch has really merged. Every answer that could be a probe
 * that never looked is paired with the commit the case recorded when it
 * made it, not with "not null".
 */
import type { Fragment } from './fragment.js';
import type { GuardFacts, GuardRead, GuardReading } from './guard.js';
import type { SettleSettings } from './settle.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeChanges } from '../effort/store/changes.js';
import { createGitRunner } from '../pr/git.js';

import { serializeFragment } from './fragment.js';
import {
  guardFixCommand,
  guardLines,
  judgeGuard,
  localPlanNotes,
  readGuard,
  sectionFor,
  stampedVersion,
} from './guard.js';
import { readSettle } from './settle.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-guard-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case guards under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** When every guard runs; a merge at this UTC day is what the forecast dates. */
const NOW = new Date('2026-09-29T12:00:00Z');

/** A date every setup commit gets unless one is named. */
const SETUP_DATE = '2026-09-01T12:00:00Z';

/** A manifest declaring `version`. */
function manifest(version: string): string {
  return `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;
}

/** A changelog holding `sections` under its preamble, newest first. */
function changelog(...sections: readonly string[]): string {
  return ['# Changelog', '', ...sections.flatMap((section) => [section, ''])].join('\n');
}

/** One stamped section, the way the old wrap-up wrote it. */
function stamped(version: string, title: string, ...notes: readonly string[]): string {
  return [`## ${version} — 2026-09-28, ${title}`, '', ...notes].join('\n');
}

/** A fragment's text. */
function fragmentText(plan: string, level: Fragment['level'], ...notes: readonly string[]): string {
  return serializeFragment({ plan, title: `title of ${plan}`, level, notes });
}

/** The base both sides of the 0.25.0 incident forked from. */
const FORK_CHANGELOG = changelog(stamped('0.24.0', 'older', '- Loop: old line'));

/** A bare origin and the clone every case works in. */
interface World {
  readonly clone: string;
  /** Runs git in the clone under an isolated environment, answering stdout trimmed. */
  readonly git: (args: readonly string[], date?: string) => string;
  /** Writes each path's text (null deletes it), commits at `date`, answering the commit. */
  readonly commit: (files: Readonly<Record<string, string | null>>, message: string, date?: string) => string;
}

/** A world whose `main`, pushed to origin, holds the manifest at 0.24.0 and the fork changelog. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const clone = join(dir, 'clone');
  mkdirSync(home, { recursive: true });
  mkdirSync(clone, { recursive: true });
  const run = (cwd: string, args: readonly string[], date = SETUP_DATE): string => execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
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
    },
  }).trim();
  const git = (args: readonly string[], date?: string): string => run(clone, args, date);
  const commit = (files: Readonly<Record<string, string | null>>, message: string, date?: string): string => {
    for (const [path, text] of Object.entries(files)) {
      const full = join(clone, path);
      if (text === null) {
        rmSync(full, { force: true });
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '-m', message], date);
    return git(['rev-parse', 'HEAD']);
  };
  run(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(['init', '-q', '--initial-branch=main', '.']);
  git(['remote', 'add', 'origin', origin]);
  commit({ 'package.json': manifest('0.24.0'), 'CHANGELOG.md': FORK_CHANGELOG, 'src/a.ts': 'a\n' }, 'first');
  git(['push', '-q', 'origin', 'main']);
  return { clone, git, commit };
}

/** The guard of `branch` (a local branch of the clone) against `origin/main`. */
function guard(w: World, branch: string, pullRequest: number | null = 356, readNotes?: (plan: string) => readonly { readonly level: Fragment['level'] }[]): GuardReading {
  return readGuard({
    git: createGitRunner(w.clone),
    settings: SETTINGS,
    base: 'origin/main',
    branch: { ref: branch, name: branch, pullRequest },
    now: NOW,
    ...(readNotes === undefined
      ? {}
      : { readNotes }),
  });
}

/** `reading` as a read guard, failing the case otherwise. */
function read(reading: GuardReading): GuardRead {
  if (!reading.ok) throw new Error(`guard not read: ${reading.problem}`);
  return reading;
}

/** Facts with no stamp, no fragment and no change, for a case to override. */
const QUIET: GuardFacts = {
  fragmentsDir: '.changes',
  changedPaths: [],
  fragments: [],
  mergeBase: { version: '0.24.0', changelog: FORK_CHANGELOG },
  branch: { version: '0.24.0', changelog: FORK_CHANGELOG },
  base: { version: '0.24.0', changelog: FORK_CHANGELOG },
};

describe('judgeGuard over literal facts', () => {
  it('answers clean for a fragment with the version and changelog unchanged', () => {
    const judgement = judgeGuard({ ...QUIET, changedPaths: ['src/a.ts', '.changes/rafa-1.md'], fragments: ['.changes/rafa-1.md'] });
    expect(judgement).toEqual({ answer: 'clean', fragments: ['.changes/rafa-1.md'] });
  });

  it('answers missing for a change outside the fragments directory with no fragment, naming the paths', () => {
    const judgement = judgeGuard({ ...QUIET, changedPaths: ['src/a.ts', '.changes/notes.txt', 'README.md'] });
    expect(judgement).toEqual({ answer: 'missing', outside: ['src/a.ts', 'README.md'] });
  });

  it('answers clean with no fragment for a branch that changes nothing outside the fragments directory', () => {
    expect(judgeGuard({ ...QUIET, changedPaths: ['.changes/notes.txt'] })).toEqual({ answer: 'clean', fragments: [] });
    expect(judgeGuard(QUIET)).toEqual({ answer: 'clean', fragments: [] });
  });

  it('answers collision for the 0.25.0 incident: the same version on the base with other notes', () => {
    const branchLog = changelog(stamped('0.25.0', 'next roadmap', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    const baseLog = changelog(stamped('0.25.0', 'migrations', '- Store: named migrations'), stamped('0.24.0', 'older', '- Loop: old line'));
    const judgement = judgeGuard({
      ...QUIET,
      changedPaths: ['package.json', 'CHANGELOG.md', 'src/a.ts'],
      branch: { version: '0.25.0', changelog: branchLog },
      base: { version: '0.25.0', changelog: baseLog },
    });
    expect(judgement).toEqual({
      answer: 'collision',
      stamp: { version: '0.25.0', section: { heading: '## 0.25.0 — 2026-09-28, next roadmap', notes: ['- Next: one hop'] } },
      base: { version: '0.25.0', section: { heading: '## 0.25.0 — 2026-09-28, migrations', notes: ['- Store: named migrations'] } },
    });
  });

  it('answers stale, passed, when the base has moved above the stamp, naming the base\'s own section', () => {
    const branchLog = changelog(stamped('0.25.0', 'next roadmap', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    const baseLog = changelog(stamped('0.26.0', 'hub', '- Hub: sync'), stamped('0.24.0', 'older', '- Loop: old line'));
    const judgement = judgeGuard({
      ...QUIET,
      branch: { version: '0.25.0', changelog: branchLog },
      base: { version: '0.26.0', changelog: baseLog },
    });
    expect(judgement).toMatchObject({ answer: 'stale', relation: 'passed' });
    if (judgement.answer !== 'stale') throw new Error('not stale');
    expect(judgement.base.section?.heading).toBe('## 0.26.0 — 2026-09-28, hub');
  });

  it('answers stale, not-on-base, for a stamp the base has not reached, and outranks a fragment', () => {
    const branchLog = changelog(stamped('0.25.0', 'next', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    const judgement = judgeGuard({
      ...QUIET,
      fragments: ['.changes/rafa-1.md'],
      branch: { version: '0.25.0', changelog: branchLog },
    });
    expect(judgement).toMatchObject({ answer: 'stale', relation: 'not-on-base' });
  });

  it('answers stale, released, when the base carries the same version with the same notes', () => {
    const log = changelog(stamped('0.25.0', 'next', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    const settled = changelog(
      ['## 0.25.0 — 2026-09-29, next', '<!-- rafa:fragments rafa-1 -->', '', '- Next: one hop'].join('\n'),
      stamped('0.24.0', 'older', '- Loop: old line'),
    );
    const judgement = judgeGuard({ ...QUIET, branch: { version: '0.25.0', changelog: log }, base: { version: '0.25.0', changelog: settled } });
    expect(judgement).toMatchObject({ answer: 'stale', relation: 'released' });
  });

  it('reads a changelog heading with the version file unchanged as a stamp, and an edit to an old section as none', () => {
    const added = changelog(stamped('0.25.0', 'next', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    expect(stampedVersion({ mergeBase: QUIET.mergeBase, branch: { version: '0.24.0', changelog: added } })).toBe('0.25.0');
    const typo = changelog(stamped('0.24.0', 'older', '- Loop: old line, fixed'));
    expect(stampedVersion({ mergeBase: QUIET.mergeBase, branch: { version: '0.24.0', changelog: typo } })).toBeNull();
    expect(judgeGuard({ ...QUIET, changedPaths: ['CHANGELOG.md'], branch: { version: '0.24.0', changelog: typo } }))
      .toEqual({ answer: 'missing', outside: ['CHANGELOG.md'] });
  });

  it('collides with a base whose version file says the stamp and whose changelog has no section for it', () => {
    const log = changelog(stamped('0.25.0', 'next', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line'));
    const judgement = judgeGuard({ ...QUIET, branch: { version: '0.25.0', changelog: log }, base: { version: '0.25.0', changelog: FORK_CHANGELOG } });
    expect(judgement).toMatchObject({ answer: 'collision', base: { version: '0.25.0', section: null } });
  });
});

describe('sectionFor', () => {
  it('stops at the next version heading, skips blank and receipt lines, and ignores headings in a fence', () => {
    const text = [
      '# Changelog',
      '## 0.25.0 — today, x',
      '<!-- rafa:fragments rafa-1 -->',
      '',
      '- A: one',
      '```text',
      '## 0.24.0 inside a fence',
      '```',
      '### Notes',
      '## 0.24.0 — older',
      '- B: two',
    ].join('\n');
    expect(sectionFor(text, '0.25.0')).toEqual({
      heading: '## 0.25.0 — today, x',
      notes: ['- A: one', '```text', '## 0.24.0 inside a fence', '```', '### Notes'],
    });
    expect(sectionFor(text, '0.24.0')).toEqual({ heading: '## 0.24.0 — older', notes: ['- B: two'] });
    expect(sectionFor(text, '0.23.0')).toBeNull();
    expect(sectionFor(null, '0.25.0')).toBeNull();
  });
});

describe('guardFixCommand', () => {
  it('names the pull request, or the current branch\'s when there is none', () => {
    expect(guardFixCommand(356)).toBe('rafa pr triage 356 --resolve');
    expect(guardFixCommand(null)).toBe('rafa pr triage --resolve');
  });
});

describe('readGuard over a bare origin and a clone', () => {
  it('names both sides of the 0.25.0 collision, the base entry by the merge that brought it, and ends with the fix', () => {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/356']);
    w.commit({
      'src/next.ts': 'next\n',
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(stamped('0.25.0', 'next roadmap', '- Next: one hop'), stamped('0.24.0', 'older', '- Loop: old line')),
    }, 'feat 356 with its stamp');
    w.git(['switch', '-q', 'main']);
    w.git(['switch', '-q', '-c', 'feat/354']);
    w.commit({
      'src/store.ts': 'store\n',
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(stamped('0.25.0', 'migrations', '- Store: named migrations'), stamped('0.24.0', 'older', '- Loop: old line')),
    }, 'feat 354 with its stamp');
    w.git(['switch', '-q', 'main']);
    w.git(['merge', '-q', '--no-ff', '-m', 'Merge #354', 'feat/354'], '2026-09-28T10:00:00Z');
    const merge354 = w.git(['rev-parse', 'HEAD']);
    w.commit({ 'src/later.ts': 'later\n' }, 'a later change on main');
    w.git(['push', '-q', 'origin', 'main']);

    const reading = read(guard(w, 'feat/356'));
    expect(reading.verdict.answer).toBe('collision');
    if (reading.verdict.answer !== 'collision') throw new Error('not a collision');
    expect(reading.verdict.base.commit).toBe(merge354);
    expect(reading.verdict.stamp.section?.notes).toEqual(['- Next: one hop']);

    expect(guardLines(reading, 'package.json')).toEqual([
      'Release guard: collision — feat/356 stamps 0.25.0, which origin/main already names with different notes',
      '  branch: feat/356 (pull request #356): package.json 0.25.0, "## 0.25.0 — 2026-09-28, next roadmap"',
      `  base:   origin/main: package.json 0.25.0, "## 0.25.0 — 2026-09-28, migrations", commit ${merge354.slice(0, 7)}`,
      'Release forecast: this branch carries no release fragment (origin/main at 0.25.0, no fragment waiting)',
      '  fix:    rafa pr triage 356 --resolve',
    ]);
  });

  it('answers stale, passed, when the base has released above the stamp, naming the commit that added its section', () => {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/old']);
    w.commit({
      'src/old.ts': 'old\n',
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(stamped('0.25.0', 'old', '- Old: line'), stamped('0.24.0', 'older', '- Loop: old line')),
    }, 'stamped branch');
    w.git(['switch', '-q', 'main']);
    const released = w.commit({
      'package.json': manifest('0.26.0'),
      'CHANGELOG.md': changelog(stamped('0.26.0', 'hub', '- Hub: sync'), stamped('0.24.0', 'older', '- Loop: old line')),
    }, 'chore: release 0.26.0');
    w.commit({ 'src/other.ts': 'other\n' }, 'unrelated');
    w.git(['push', '-q', 'origin', 'main']);

    const reading = read(guard(w, 'feat/old', null));
    expect(reading.verdict).toMatchObject({ answer: 'stale', relation: 'passed' });
    if (reading.verdict.answer !== 'stale') throw new Error('not stale');
    expect(reading.verdict.base.commit).toBe(released);
    const lines = guardLines(reading, 'package.json');
    expect(lines[0]).toBe('Release guard: stale — feat/old stamps 0.25.0, which origin/main has passed at 0.26.0');
    expect(lines[1]).toContain('feat/old (no pull request)');
    expect(lines.at(-1)).toBe('  fix:    rafa pr triage --resolve');
  });

  it('names the commit that set a version the base holds with no section, passing over a later commit that kept it', () => {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/x']);
    w.commit({
      'package.json': manifest('0.25.0'),
      'CHANGELOG.md': changelog(stamped('0.25.0', 'x', '- X: line'), stamped('0.24.0', 'older', '- Loop: old line')),
    }, 'stamped branch');
    w.git(['switch', '-q', 'main']);
    const bumped = w.commit({ 'package.json': manifest('0.25.0') }, 'bump by hand');
    w.commit({ 'package.json': manifest('0.25.0').replace('"demo"', '"demo-renamed"') }, 'rename, version kept');
    w.git(['push', '-q', 'origin', 'main']);

    const reading = read(guard(w, 'feat/x'));
    expect(reading.verdict).toMatchObject({ answer: 'collision', base: { section: null, commit: bumped } });
  });

  it('reads a fragment branch as clean, and forecasts exactly the section settle folds once it has merged', () => {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/frag']);
    w.commit({ 'src/b.ts': 'b\n', '.changes/rafa-7.md': fragmentText('rafa-7', 'minor', '- Next: one hop') }, 'fragment branch');
    w.git(['switch', '-q', 'main']);
    w.commit({ '.changes/rafa-5.md': fragmentText('rafa-5', 'patch', '- Loop: a fix') }, 'waiting fragment', '2026-09-20T12:00:00Z');
    w.git(['push', '-q', 'origin', 'main']);

    const reading = read(guard(w, 'feat/frag'));
    expect(reading.verdict).toEqual({ answer: 'clean', fragments: ['.changes/rafa-7.md'] });
    const forecast = reading.forecast;
    if (forecast === null || !forecast.ok || forecast.forecast.kind !== 'ships') throw new Error('no shipping forecast');
    expect(forecast.waiting).toEqual(['rafa-5']);
    expect(forecast.forecast.version).toBe('0.25.0');
    expect(guardLines(reading, 'package.json')).toEqual([
      'Release guard: clean — feat/frag carries .changes/rafa-7.md',
      'Release forecast: this branch ships as the next minor, 0.25.0 if merged now (semver-by-level, origin/main at 0.24.0, 1 fragment waiting)',
    ]);

    w.git(['merge', '-q', '--no-ff', '-m', 'Merge feat/frag', 'feat/frag'], '2026-09-29T15:00:00Z');
    const settled = readSettle(createGitRunner(w.clone), 'HEAD', SETTINGS);
    if (settled.outcome !== 'folded') throw new Error(`settle did not fold: ${settled.outcome}`);
    expect(settled.version).toBe(forecast.forecast.version);
    expect(settled.section).toBe(forecast.forecast.section);
  });

  it('answers missing for a branch with no fragment, and reads a malformed fragment as none, saying why', () => {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/bare']);
    w.commit({ 'src/c.ts': 'c\n' }, 'no fragment');
    w.git(['switch', '-q', 'main']);
    w.git(['switch', '-q', '-c', 'feat/broken']);
    w.commit({ 'src/d.ts': 'd\n', '.changes/rafa-9.md': '---\nplan: rafa-9\ntitle: t\n---\n\n- A: b\n' }, 'broken fragment');

    const bare = read(guard(w, 'feat/bare'));
    expect(bare.verdict).toEqual({ answer: 'missing', outside: ['src/c.ts'] });
    expect(guardLines(bare, 'package.json')[0])
      .toBe('Release guard: missing — feat/bare (pull request #356) changes 1 path outside the release fragments and carries no fragment');

    const broken = read(guard(w, 'feat/broken'));
    expect(broken.verdict).toEqual({ answer: 'missing', outside: ['src/d.ts'] });
    expect(broken.problems).toHaveLength(1);
    expect(broken.problems[0]).toContain('feat/broken\'s .changes/rafa-9.md does not count as a fragment');
  });

  it('folds a waiting fragment the branch edits once, in the branch\'s place', () => {
    const w = world();
    w.commit({ '.changes/rafa-5.md': fragmentText('rafa-5', 'patch', '- Loop: a fix') }, 'waiting fragment');
    w.git(['push', '-q', 'origin', 'main']);
    w.git(['switch', '-q', '-c', 'feat/edit']);
    w.commit({ '.changes/rafa-5.md': fragmentText('rafa-5', 'minor', '- Loop: a larger fix') }, 'edit it');

    const reading = read(guard(w, 'feat/edit'));
    expect(reading.verdict).toEqual({ answer: 'clean', fragments: ['.changes/rafa-5.md'] });
    const forecast = reading.forecast;
    if (forecast === null || !forecast.ok || forecast.forecast.kind !== 'ships') throw new Error('no shipping forecast');
    expect(forecast.waiting).toEqual([]);
    expect(forecast.forecast.section).toContain('<!-- rafa:fragments rafa-5 -->');
    expect(forecast.forecast.version).toBe('0.25.0');
  });

  it('counts only the fragments the branch changed, not the waiting ones it inherited', () => {
    const w = world();
    w.commit({ '.changes/rafa-5.md': fragmentText('rafa-5', 'patch', '- Loop: a fix') }, 'waiting fragment');
    w.git(['push', '-q', 'origin', 'main']);
    w.git(['switch', '-q', '-c', 'feat/code']);
    w.commit({ 'src/e.ts': 'e\n' }, 'code only');

    expect(read(guard(w, 'feat/code')).verdict).toEqual({ answer: 'missing', outside: ['src/e.ts'] });
  });

  it('refuses to read a base that names no commit', () => {
    const w = world();
    const reading = readGuard({
      git: createGitRunner(w.clone),
      settings: SETTINGS,
      base: 'origin/nowhere',
      branch: { ref: 'main', name: 'main', pullRequest: null },
      now: NOW,
    });
    expect(reading).toEqual({ ok: false, problem: 'the base origin/nowhere names no commit' });
    expect(guardLines(reading, 'package.json')).toEqual(['Release guard: not read, because the base origin/nowhere names no commit']);
  });
});

describe('the local level report', () => {
  /** A branch carrying a patch fragment for rafa-7. */
  function patchBranch(): World {
    const w = world();
    w.git(['switch', '-q', '-c', 'feat/lvl']);
    w.commit({ 'src/f.ts': 'f\n', '.changes/rafa-7.md': fragmentText('rafa-7', 'patch', '- Loop: small') }, 'patch fragment');
    return w;
  }

  it('reports notes above the fragment\'s level, and never changes the answer', () => {
    const w = patchBranch();
    const asked: string[] = [];
    const reading = read(guard(w, 'feat/lvl', 356, (plan) => {
      asked.push(plan);
      return [{ level: 'patch' }, { level: 'major' }];
    }));
    expect(asked).toEqual(['rafa-7']);
    expect(reading.verdict.answer).toBe('clean');
    expect(reading.levelReport).toBe('.changes/rafa-7.md carries level patch, below the major this machine\'s change notes'
      + ' for rafa-7 reach; the fragment stands, so it ships as patch');
    expect(guardLines(reading, 'package.json')).toContain(`Level report: ${reading.levelReport ?? ''}`);
  });

  it('stays silent with no notes, with notes at or below the level, and with no reader', () => {
    const w = patchBranch();
    expect(read(guard(w, 'feat/lvl', 356, () => [])).levelReport).toBeNull();
    expect(read(guard(w, 'feat/lvl', 356, () => [{ level: 'patch' }, { level: 'none' }])).levelReport).toBeNull();
    expect(read(guard(w, 'feat/lvl')).levelReport).toBeNull();
  });

  it('reads this machine\'s effort store through localPlanNotes, by the fragment\'s plan id', () => {
    const w = patchBranch();
    const root = join(tempBase, `store-${String(worldCount)}`);
    const note = (level: Fragment['level'], summary: string) => ({ level, area: 'loop', summary, extras: [] });
    writeChanges(root, {
      dispatch: { sessionId: 's-1', planStub: 'rafa-7', taskLine: 'a task' },
      changes: [note('patch', 'small'), note('minor', 'larger')],
    });
    writeChanges(root, {
      dispatch: { sessionId: 's-2', planStub: 'rafa-8', taskLine: 'another plan' },
      changes: [note('major', 'not this plan')],
    });

    const reading = read(guard(w, 'feat/lvl', 356, localPlanNotes(root)));
    expect(reading.levelReport).toContain('below the minor this machine\'s change notes for rafa-7 reach');
    expect(read(guard(w, 'feat/lvl', 356, localPlanNotes(join(tempBase, 'no-store')))).levelReport).toBeNull();
  });

  it('turns a store that throws into a problem and no report', () => {
    const w = patchBranch();
    const reading = read(guard(w, 'feat/lvl', 356, () => {
      throw new Error('database is locked');
    }));
    expect(reading.levelReport).toBeNull();
    expect(reading.problems).toEqual(['the change notes of rafa-7 could not be read for the level report: database is locked']);
  });
});
