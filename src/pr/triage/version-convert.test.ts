/**
 * Tests for the `conflict-version` conversion (`version-convert.ts`):
 * the pure level and plan-id readings over literals, and
 * `convertStampedVersion` over real repositories — a bare origin and a
 * clone replaying the 0.25.0 incident: a branch that stamped `0.25.0`
 * while `main` released `0.25.0` with other notes.
 *
 * What is measured is git's own state after the call: the commits
 * `HEAD` gained, the paths the commit touched, the files' text, and the
 * guard's answer and `git merge-tree`'s over the converted branch. Each
 * reading that could come from a probe that never looked is paired with
 * the same probe taken BEFORE the conversion, where it must read the
 * opposite: the guard `collision`, the merge conflicting. The case for
 * restoring the merge base's values rather than the base tip's measures
 * the tip's reading directly, so the module note's reason is a reading
 * and not a claim.
 */
import type { SettleSettings } from '../../release/settle.js';

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseFragment, serializeFragment } from '../../release/fragment.js';
import { readGuard } from '../../release/guard.js';
import { createGitRunner } from '../git.js';

import {
  conversionCommitSubject,
  conversionLevel,
  conversionLines,
  conversionPlanId,
  convertStampedVersion,
} from './version-convert.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-version-convert-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The settings every case converts under. */
const SETTINGS: SettleSettings = {
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The branch the incident's second pull request came from. */
const BRANCH = 'feat/rafa-356-parallel-thing';

/** Its pull request's number. */
const PULL_REQUEST = 356;

/** Its pull request's title. */
const TITLE = 'Parallel thing';

/** When every conversion runs. */
const NOW = new Date('2026-09-29T12:00:00Z');

/**
 * A manifest declaring `version`, with the branch's dependency when
 * asked. The dependency goes after `license`, a line away from the
 * version's, so the branch's own edit and the base's bump do not touch
 * adjacent lines and git merges the two.
 */
function manifest(version: string, dependency = false): string {
  const extra = dependency
    ? ',\n  "dependencies": {\n    "left-pad": "1.3.0"\n  }'
    : '';
  return `{\n  "name": "demo",\n  "version": "${version}",\n  "description": "demo",\n  "license": "MIT"${extra}\n}\n`;
}

/** A changelog holding `sections` under its preamble, newest first. */
function changelog(...sections: readonly string[]): string {
  return ['# Changelog', '', ...sections.flatMap((section) => [section, ''])].join('\n');
}

/** One stamped section, the way the old wrap-up wrote it. */
function section(version: string, title: string, ...notes: readonly string[]): string {
  return [`## ${version} — 2026-09-28, ${title}`, '', ...notes].join('\n');
}

/** The changelog both sides forked from. */
const FORK_CHANGELOG = changelog(section('0.24.0', 'older', '- Loop: old line'));

/** The branch's stamped notes, which the fragment must carry. */
const BRANCH_NOTES = ['- Loop: the branch line', '- Docs: the branch doc line'];

/** A bare origin and the clone every case works in. */
interface World {
  readonly clone: string;
  /** Runs git in the clone, answering stdout trimmed. */
  readonly git: (args: readonly string[]) => string;
  /** Writes each path's text, commits, answering the commit. */
  readonly commit: (files: Readonly<Record<string, string>>, message: string) => string;
}

/**
 * A world whose clone has pushed `main` at 0.24.0 and holds nothing
 * else yet. The clone's own config names an identity, turns signing off
 * and points hooks at an empty directory, since the conversion commits
 * through `createGitRunner`, which runs under the operator's environment.
 */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const origin = join(dir, 'origin.git');
  const clone = join(dir, 'clone');
  mkdirSync(join(dir, 'no-hooks'), { recursive: true });
  mkdirSync(clone, { recursive: true });
  const run = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  }).trim();
  const git = (args: readonly string[]): string => run(clone, args);
  const commit = (files: Readonly<Record<string, string>>, message: string): string => {
    for (const [path, text] of Object.entries(files)) {
      const full = join(clone, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  run(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(['init', '-q', '--initial-branch=main', '.']);
  for (const [key, value] of [
    ['user.name', 'rafa convert'],
    ['user.email', 'convert@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', join(dir, 'no-hooks')],
  ] as const) git(['config', key, value]);
  git(['remote', 'add', 'origin', origin]);
  commit({ 'package.json': manifest('0.24.0'), 'CHANGELOG.md': FORK_CHANGELOG, 'src/a.ts': 'a\n' }, 'fork point');
  git(['push', '-q', 'origin', 'main']);
  return { clone, git, commit };
}

/** What the incident left: the branch's stamped head, and main's release of the same number. */
interface Incident {
  readonly w: World;
  readonly head: string;
}

/**
 * Replays the 0.25.0 incident: the branch stamps 0.25.0 with its own
 * notes and a new dependency, `main` releases 0.25.0 with other notes
 * and pushes, and the clone is left on the branch.
 */
function incident(options: { readonly branchFiles?: Readonly<Record<string, string>> } = {}): Incident {
  const w = world();
  w.git(['switch', '-q', '-c', BRANCH]);
  const head = w.commit(options.branchFiles ?? {
    'src/a.ts': 'a, changed by the branch\n',
    'package.json': manifest('0.25.0', true),
    'CHANGELOG.md': changelog(section('0.25.0', TITLE, ...BRANCH_NOTES), section('0.24.0', 'older', '- Loop: old line')),
  }, 'feat: parallel thing, stamped 0.25.0');
  w.git(['push', '-q', 'origin', BRANCH]);
  w.git(['switch', '-q', 'main']);
  w.commit({
    'package.json': manifest('0.25.0'),
    'CHANGELOG.md': changelog(section('0.25.0', 'the other one', '- Effort: the base line'), section('0.24.0', 'older', '- Loop: old line')),
  }, 'chore: release 0.25.0');
  w.git(['push', '-q', 'origin', 'main']);
  w.git(['switch', '-q', BRANCH]);
  return { w, head };
}

/** Converts the clone's branch, the pull request's head being `head`. */
function convert(w: World, head: string | null): ReturnType<typeof convertStampedVersion> {
  return convertStampedVersion({
    git: createGitRunner(w.clone),
    worktree: w.clone,
    settings: SETTINGS,
    base: 'main',
    branch: BRANCH,
    pullRequest: PULL_REQUEST,
    title: TITLE,
    head,
    now: NOW,
  });
}

/** The guard's answer over the clone's `HEAD` against `origin/main`. */
function guardAnswer(w: World): string {
  const reading = readGuard({
    git: createGitRunner(w.clone),
    settings: SETTINGS,
    base: 'origin/main',
    branch: { ref: 'HEAD', name: BRANCH, pullRequest: PULL_REQUEST },
    now: NOW,
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.verdict.answer === 'stale'
    ? `stale ${reading.verdict.relation}`
    : reading.verdict.answer;
}

/**
 * The paths merging the branch into `origin/main` now would conflict on,
 * as `git merge-tree` reads them: empty when it exits 0, and the
 * `--name-only` listing after the tree line when it exits 1.
 */
function mergeConflicts(w: World): readonly string[] {
  const result = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'origin/main', 'HEAD'], {
    cwd: w.clone,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.status === 0) return [];
  if (result.status !== 1) throw new Error(`git merge-tree exited ${String(result.status)}: ${result.stderr}`);
  return result.stdout
    .trim()
    .split('\n')
    .slice(1);
}

describe('conversionLevel', () => {
  it('reads the first number the stamp moved, from the merge base', () => {
    expect(conversionLevel('0.24.0', '0.25.0')).toBe('minor');
    expect(conversionLevel('0.24.3', '0.24.4')).toBe('patch');
    expect(conversionLevel('0.24.0', '1.0.0')).toBe('major');
    expect(conversionLevel('0.25.0-rc.1', '0.25.0')).toBe('patch');
  });

  it('reads no level from a stamp that is not above the merge base, or with nothing to measure from', () => {
    expect(conversionLevel('0.25.0', '0.25.0')).toBeNull();
    expect(conversionLevel('0.25.0', '0.24.0')).toBeNull();
    expect(conversionLevel(null, '0.25.0')).toBeNull();
    expect(conversionLevel('not a version', '0.25.0')).toBeNull();
  });
});

describe('conversionPlanId', () => {
  it('takes the branch name\'s last segment, which is a rafa branch\'s plan stub', () => {
    expect(conversionPlanId('feat/rafa-356-parallel-thing', 356)).toBe('rafa-356-parallel-thing');
    expect(conversionPlanId('fix-typo', 12)).toBe('fix-typo');
  });

  it('turns every run of unusable characters into one dash and drops a leading one', () => {
    expect(conversionPlanId('feat/Some thing+more', 7)).toBe('Some-thing-more');
    expect(conversionPlanId('feat/.hidden', 7)).toBe('hidden');
  });

  it('falls back to pr-<n> when nothing usable is left', () => {
    expect(conversionPlanId('feat/', 7)).toBe('pr-7');
    expect(conversionPlanId('feat/...', 8)).toBe('pr-8');
  });
});

describe('convertStampedVersion over the 0.25.0 incident', () => {
  it('makes one commit on the branch over exactly the fragment, the version file and the changelog', () => {
    const { w, head } = incident();
    const conversion = convert(w, head);

    expect(conversion.outcome).toBe('converted');
    if (conversion.outcome !== 'converted') return;
    expect(w.git(['rev-parse', 'HEAD^'])).toBe(head);
    expect(w.git(['rev-parse', 'HEAD'])).toBe(conversion.commit);
    expect(w.git(['log', '-1', '--format=%s'])).toBe(conversionCommitSubject('rafa-356-parallel-thing', '0.25.0'));
    const touched = w.git(['diff', '--name-only', head, 'HEAD'])
      .split('\n')
      .sort();
    expect(touched).toEqual(['.changes/rafa-356-parallel-thing.md', 'CHANGELOG.md', 'package.json']);
    expect(w.git(['status', '--porcelain'])).toBe('');
    expect(conversion.problems).toEqual([]);
  });

  it('writes the stamped section\'s lines as a fragment at the level the stamp asked for', () => {
    const { w, head } = incident();
    const conversion = convert(w, head);

    expect(conversion.outcome).toBe('converted');
    const reading = parseFragment(readFileSync(join(w.clone, '.changes/rafa-356-parallel-thing.md'), 'utf8'));
    expect(reading).toEqual({
      ok: true,
      fragment: { plan: 'rafa-356-parallel-thing', title: TITLE, level: 'minor', notes: BRANCH_NOTES },
    });
  });

  it('sets the version file back to the merge base\'s version and keeps the branch\'s other bytes in it', () => {
    const { w, head } = incident();
    convert(w, head);

    expect(readFileSync(join(w.clone, 'package.json'), 'utf8')).toBe(manifest('0.24.0', true));
    expect(readFileSync(join(w.clone, 'CHANGELOG.md'), 'utf8')).toBe(FORK_CHANGELOG);
    expect(readFileSync(join(w.clone, 'src/a.ts'), 'utf8')).toBe('a, changed by the branch\n');
  });

  it('leaves the guard reading clean and the merge conflict-free, where both read otherwise before it', () => {
    const { w, head } = incident();
    const before = { guard: guardAnswer(w), conflicts: mergeConflicts(w) };
    convert(w, head);

    expect(before).toEqual({ guard: 'collision', conflicts: ['CHANGELOG.md'] });
    expect({ guard: guardAnswer(w), conflicts: mergeConflicts(w) }).toEqual({ guard: 'clean', conflicts: [] });
  });

  it('leaves the base\'s version and section once the branch merges', () => {
    const { w, head } = incident();
    convert(w, head);
    const tree = w.git(['merge-tree', '--write-tree', 'origin/main', 'HEAD']);

    expect(w.git(['show', `${tree}:package.json`])).toBe(manifest('0.25.0', true).trim());
    expect(w.git(['show', `${tree}:CHANGELOG.md`])).toContain('- Effort: the base line');
    expect(w.git(['show', `${tree}:CHANGELOG.md`])).not.toContain('- Loop: the branch line');
    expect(w.git(['show', `${tree}:.changes/rafa-356-parallel-thing.md`])).toContain('- Loop: the branch line');
  });

  it('control: the base tip\'s values written by hand leave the guard reading the branch as stamped', () => {
    const { w } = incident();
    w.commit({
      'package.json': manifest('0.25.0', true),
      'CHANGELOG.md': w.git(['show', 'origin/main:CHANGELOG.md']).concat('\n'),
      '.changes/rafa-356-parallel-thing.md': serializeFragment({ plan: 'rafa-356-parallel-thing', title: TITLE, level: 'minor', notes: BRANCH_NOTES }),
    }, 'the tip\'s values, by hand');

    expect(guardAnswer(w)).toBe('stale released');
  });

  it('answers unstamped and writes nothing when run again over the converted branch', () => {
    const { w, head } = incident();
    convert(w, head);
    const converted = w.git(['rev-parse', 'HEAD']);
    const again = convert(w, converted);

    expect(again).toEqual({ outcome: 'unstamped', answer: 'clean', problems: [] });
    expect(w.git(['rev-parse', 'HEAD'])).toBe(converted);
    expect(w.git(['status', '--porcelain'])).toBe('');
  });
});

describe('convertStampedVersion refusals, which write nothing', () => {
  it('refuses a worktree that is not at the pull request\'s head', () => {
    const { w, head } = incident();
    const elsewhere = w.git(['rev-parse', 'origin/main']);
    const conversion = convert(w, elsewhere);

    expect(conversion.outcome).toBe('refused');
    if (conversion.outcome !== 'refused') return;
    expect(conversion.problem).toContain(`is at ${head.slice(0, 7)}, not at the pull request's head ${elsewhere.slice(0, 7)}`);
    expect(w.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(w.git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a stamp no level reads off: a version below the merge base\'s', () => {
    const { w, head } = incident({
      branchFiles: { 'package.json': manifest('0.23.0'), 'src/a.ts': 'changed\n' },
    });
    const conversion = convert(w, head);

    expect(conversion.outcome).toBe('refused');
    if (conversion.outcome !== 'refused') return;
    expect(conversion.problem).toContain('no release level reads off the stamp');
    expect(conversion.problem).toContain('stamped 0.23.0 over 0.24.0');
    expect(w.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(w.git(['status', '--porcelain'])).toBe('');
  });
});

describe('convertStampedVersion edges', () => {
  it('carries the title as the one note of a version-file-only stamp, and says so', () => {
    const { w, head } = incident({
      branchFiles: { 'package.json': manifest('0.24.1'), 'src/a.ts': 'fixed\n' },
    });
    const conversion = convert(w, head);

    expect(conversion.outcome).toBe('converted');
    expect(conversion.problems).toEqual([`${BRANCH} stamped 0.24.1 with no changelog notes, so the fragment carries its title as its one note`]);
    const reading = parseFragment(readFileSync(join(w.clone, '.changes/rafa-356-parallel-thing.md'), 'utf8'));
    expect(reading).toEqual({ ok: true, fragment: { plan: 'rafa-356-parallel-thing', title: TITLE, level: 'patch', notes: [TITLE] } });
  });

  it('names the fragment past one of the same name waiting on the base', () => {
    const { w, head } = incident();
    w.git(['switch', '-q', 'main']);
    w.commit({ '.changes/rafa-356-parallel-thing.md': serializeFragment({ plan: 'rafa-356-parallel-thing', title: 'earlier', level: 'patch', notes: ['- Loop: earlier'] }) }, 'an earlier fragment');
    w.git(['push', '-q', 'origin', 'main']);
    w.git(['switch', '-q', BRANCH]);
    const conversion = convert(w, head);

    expect(conversion.outcome).toBe('converted');
    if (conversion.outcome !== 'converted') return;
    expect(conversion.fragmentPath).toBe('.changes/rafa-356-parallel-thing-2.md');
    expect(w.git(['show', 'HEAD:.changes/rafa-356-parallel-thing-2.md'])).toContain('level: minor');
  });
});

describe('conversionLines', () => {
  it('names the fragment, both files, the merge base\'s version, the tip\'s and the commit', () => {
    const { w, head } = incident();
    const conversion = convert(w, head);
    const commit = w.git(['rev-parse', '--short=7', 'HEAD']);

    expect(conversionLines(conversion, SETTINGS)).toEqual([
      'Converted the stamped 0.25.0 into .changes/rafa-356-parallel-thing.md (level minor): package.json back to'
      + ' 0.24.0 and CHANGELOG.md back to the merge base\'s text; a merge leaves origin/main\'s 0.25.0,'
      + ` commit ${commit}.`,
    ]);
  });

  it('says what stopped a refusal and what the guard read instead of a stamp, with a note per problem', () => {
    expect(conversionLines({ outcome: 'refused', problem: 'no way', problems: ['a note'] }, SETTINGS)).toEqual([
      'The stamped version was not converted: no way.',
      '  note: a note',
    ]);
    expect(conversionLines({ outcome: 'unstamped', answer: 'missing', problems: [] }, SETTINGS)).toEqual([
      'The release guard reads missing at the branch\'s head, so there is no stamped version to convert.',
    ]);
  });
});
