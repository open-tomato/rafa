/**
 * Tests for `rafa release fragment` (`fragment.ts`): the file it writes,
 * the name it picks off the base, the json result, and every refusal.
 *
 * The dispatched cases drive a real scratch world, as `list.test.ts`
 * does: a bare origin whose `main` already holds `dependabot-7.md`, and
 * the caller's clone the command runs in, so the name is chosen off
 * git's own reading of the base after a real fetch.
 *
 * Controls for readings that would pass while wrong:
 *
 *   - a plan id the base does not hold is written as `<plan>.md`, so the
 *     `-2` of the base case is known to come from the base;
 *   - the base's fragment is pushed after the caller cloned, so only a
 *     fetch the command made puts it in the caller's `origin/main`;
 *   - every refusal case asserts the fragments directory holds what it
 *     held before, so a refusal that still wrote would fail;
 *   - a package the workspace holds and publishes is written, beside
 *     the refused private and unknown ones, so the check is known to
 *     pass a good name.
 */
import type { ReleaseFragmentResult } from './fragment.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { createGitRunner } from '@open-tomato/rafa/core/git';
import { parseFragment, serializeFragment } from '@open-tomato/rafa/release/fragment';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';

import { readGuard } from '../../release/guard.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createReleaseFragmentCommand, noteLine, readNoteValues, RELEASE_FRAGMENT_USAGE } from './fragment.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-fragment-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directory. */
let worldCount = 0;

/** What `main` is seeded with: a root workspace, a publishable plugin and a private core. */
const SEED: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "demo",\n  "version": "0.25.0",\n  "workspaces": ["packages/*"]\n}\n',
  'packages/plugin/package.json': '{\n  "name": "@scope/plugin",\n  "version": "0.10.0"\n}\n',
  'packages/core/package.json': '{\n  "name": "@scope/core",\n  "version": "0.0.0",\n  "private": true\n}\n',
};

/** The fragment waiting on the base before every case. */
const WAITING = serializeFragment({
  plan: 'dependabot-7',
  title: 'Bump zod',
  level: 'patch',
  package: null,
  notes: ['- deps: bump zod'],
});

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    LC_ALL: 'C',
  };
}

/** The caller's clone, and git run in it or in the clone that pushes to `main`. */
interface World {
  readonly project: PlantedProject;
  readonly inCaller: (args: readonly string[]) => void;
}

/** Writes `files` under `root`. */
function plant(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * A world whose `main` holds {@link SEED}, cloned by the caller, after
 * which `.changes/dependabot-7.md` lands on `main`, so the caller's
 * `origin/main` holds it only once fetched.
 */
function world(): World {
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
  plant(other, SEED);
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);
  git(dir, ['clone', '-q', origin, caller]);
  plant(other, { '.changes/dependabot-7.md': WAITING });
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'fragment']);
  git(other, ['push', '-q', 'origin', 'main']);

  plantProjectConfig(caller, 'release:\n  versionFile: package.json\n');
  const projectHome = join(dir, 'project-home');
  mkdirSync(projectHome);
  return { project: { root: caller, home: projectHome }, inCaller: (args) => git(caller, args) };
}

/** Dispatches `rafa release fragment` with `words` after it in `project`. */
async function ran(
  project: PlantedProject,
  words: readonly string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(
    ['release', 'fragment', ...words],
    [{ name: 'release', summary: 'releases' }],
    [createReleaseFragmentCommand()],
    project,
  );
}

/** The names under the caller's `.changes/`, sorted; empty when there is no such directory. */
function changesOf(project: PlantedProject): readonly string[] {
  const dir = join(project.root, '.changes');
  return existsSync(dir)
    ? readdirSync(dir).sort()
    : [];
}

/** The text of `path` under the caller's root. */
function textAt(project: PlantedProject, path: string): string {
  return readFileSync(join(project.root, path), 'utf8');
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

describe('rafa release fragment', () => {
  it('names the fragment -2 when its name waits on the fetched base, and prints only the path', async () => {
    const w = world();

    const run = await ran(w.project, ['--plan=dependabot-7', '--level=patch', '--title=Bump zod again', '--note=deps: bump zod']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('.changes/dependabot-7-2.md\n');
    expect(parseFragment(textAt(w.project, '.changes/dependabot-7-2.md'))).toEqual({
      ok: true,
      fragment: { plan: 'dependabot-7', title: 'Bump zod again', level: 'patch', package: null, notes: ['- deps: bump zod'] },
    });
  });

  it('names the fragment <plan>.md when the base holds no fragment of that plan', async () => {
    const w = world();

    const run = await ran(w.project, ['--plan=dependabot-8', '--level=patch', '--title=Bump bun', '--note=deps: bump bun']);

    expect(run.exitCode).toBe(0);
    expect(changesOf(w.project)).toEqual(['dependabot-8.md']);
  });

  it('writes every --note in the order given, both spellings, and the package line', async () => {
    const w = world();

    const run = await ran(w.project, [
      '--plan=rafa-12', '--level=minor', '--title=Plugin   hooks', '--package=@scope/plugin',
      '--note=hooks: run before each task', '--note', 'docs:  a page  for hooks',
    ]);

    expect(run.exitCode).toBe(0);
    expect(textAt(w.project, '.changes/rafa-12.md')).toBe([
      '---',
      'plan: rafa-12',
      'title: Plugin hooks',
      'level: minor',
      'package: @scope/plugin',
      '---',
      '',
      '- hooks: run before each task',
      '- docs: a page for hooks',
      '',
    ].join('\n'));
  });

  it('writes a none fragment with no note bare, and it reads back', async () => {
    const w = world();

    const run = await ran(w.project, ['--plan=dependabot-9', '--level=none', '--title=Bump eslint']);

    expect(run.exitCode).toBe(0);
    expect(parseFragment(textAt(w.project, '.changes/dependabot-9.md'))).toEqual({
      ok: true,
      fragment: { plan: 'dependabot-9', title: 'Bump eslint', level: 'none', package: null, notes: [] },
    });
  });

  it('carries the title as the one note of a shipping level given none, warning above the path', async () => {
    const w = world();

    const run = await ran(w.project, ['--plan=dependabot-10', '--level=patch', '--title=Bump zod']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('warn: no --note was given, so the patch fragment\'s one note is its title\n.changes/dependabot-10.md\n');
    expect(parseFragment(textAt(w.project, '.changes/dependabot-10.md'))).toEqual({
      ok: true,
      fragment: { plan: 'dependabot-10', title: 'Bump zod', level: 'patch', package: null, notes: ['- Bump zod'] },
    });
  });

  it('gives the path, the fragment and the warnings as the json result', async () => {
    const w = world();

    const run = await ran(w.project, ['--plan=dependabot-7', '--level=none', '--title=Bump zod', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(dataOf(eventsOf(run.stdout)) as ReleaseFragmentResult).toEqual({
      path: '.changes/dependabot-7-2.md',
      fragment: { plan: 'dependabot-7', title: 'Bump zod', level: 'none', package: null, notes: [] },
      problems: [],
    });
  });

  it('warns above the path and reads the base as held when the fetch fails', async () => {
    const w = world();
    w.inCaller(['fetch', '-q', 'origin']);
    w.inCaller(['remote', 'set-url', 'origin', join(tempBase, 'no-such-origin.git')]);

    const run = await ran(w.project, ['--plan=dependabot-7', '--level=none', '--title=Bump zod']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toStartWith('warn: main could not be fetched from origin, so the fragments waiting on it are whatever this clone holds for origin/main: ');
    expect(run.stdout).toEndWith('\n.changes/dependabot-7-2.md\n');
  });

  const refusals: readonly (readonly [string, readonly string[], string])[] = [
    ['a plan id outside the pattern', ['--plan=-bad', '--level=patch', '--title=T'], 'cannot name a fragment'],
    ['a plan id with a slash', ['--plan=a/b', '--level=patch', '--title=T'], 'cannot name a fragment'],
    ['no plan', ['--level=patch', '--title=T'], '--plan takes a value'],
    ['an unknown level', ['--plan=p-1', '--level=huge', '--title=T'], 'the level "huge" is not one of patch, minor, major, none'],
    ['no level', ['--plan=p-1', '--title=T'], '--level takes a value'],
    ['an empty title', ['--plan=p-1', '--level=none', '--title=  '], '--title takes a value'],
    ['a note with no area', ['--plan=p-1', '--level=patch', '--title=T', '--note=just words'], 'is not <area>: <summary>'],
    ['a package the workspace lacks', ['--plan=p-1', '--level=patch', '--title=T', '--package=@scope/nope'], 'the workspace holds no package named @scope/nope'],
    ['a private package', ['--plan=p-1', '--level=patch', '--title=T', '--package=@scope/core'], '@scope/core (packages/core) is private'],
    ['a stray word', ['extra', '--plan=p-1', '--level=none', '--title=T'], 'Expected no argument'],
  ];

  it.each(refusals)('refuses %s with exit 1, writing nothing', async (_name, words, said) => {
    const w = world();

    const run = await ran(w.project, words);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(said);
    expect(changesOf(w.project)).toEqual([]);
  });

  it('refuses a fragment of that name already in the working tree, leaving it as it was', async () => {
    const w = world();
    plant(w.project.root, { '.changes/dependabot-7-2.md': 'mine\n' });

    const run = await ran(w.project, ['--plan=dependabot-7', '--level=none', '--title=Bump zod']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('.changes/dependabot-7-2.md is already on this branch');
    expect(run.stderr).toContain(`Usage: ${RELEASE_FRAGMENT_USAGE}`);
    expect(textAt(w.project, '.changes/dependabot-7-2.md')).toBe('mine\n');
  });

  it('refuses a fragment of that name committed on the branch though gone from the working tree', async () => {
    const w = world();
    plant(w.project.root, { '.changes/dependabot-8.md': WAITING });
    w.inCaller(['add', '.changes/dependabot-8.md']);
    w.inCaller(['commit', '-q', '-m', 'fragment']);
    rmSync(join(w.project.root, '.changes', 'dependabot-8.md'));

    const run = await ran(w.project, ['--plan=dependabot-8', '--level=none', '--title=Bump bun']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('.changes/dependabot-8.md is already on this branch');
    expect(changesOf(w.project)).toEqual([]);
  });

  it('refuses with exit 1 when the base cannot be read at all', async () => {
    const w = world();
    w.inCaller(['remote', 'set-url', 'origin', join(tempBase, 'no-such-origin.git')]);
    w.inCaller(['update-ref', '-d', 'refs/remotes/origin/main']);

    const run = await ran(w.project, ['--plan=dependabot-8', '--level=none', '--title=Bump bun']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('the tree of origin/main could not be read');
    expect(changesOf(w.project)).toEqual([]);
  });
});

describe('the preflight guard over a branch holding the written fragment', () => {
  /** A branch changing a source file, guarded against the fetched `origin/main`. */
  function guardedAnswer(w: World): string | undefined {
    const git = createGitRunner(w.project.root);
    const reading = readGuard({
      git,
      settings: {
        releaseVersionFile: 'package.json',
        releaseChangelog: 'CHANGELOG.md',
        releaseFragments: '.changes',
        releaseStrategy: 'semver-by-level',
        releaseHeading: '## {version} — {date}, {title}',
        releaseMoveLock: false,
      },
      base: 'origin/main',
      branch: { ref: 'HEAD', name: 'dependabot/bun/zod', pullRequest: 7 },
      now: new Date('2026-10-16T12:00:00Z'),
    });
    return reading.ok
      ? reading.verdict.answer
      : `unread: ${reading.problem}`;
  }

  /** Lands a source change on a branch of the caller's clone. */
  function branchWithSourceChange(w: World): void {
    w.inCaller(['checkout', '-q', '-b', 'dependabot/bun/zod']);
    plant(w.project.root, { 'src/index.ts': 'export const a = 1;\n' });
    w.inCaller(['add', 'src/index.ts']);
    w.inCaller(['commit', '-q', '-m', 'bump zod']);
  }

  it('reads clean once the fragment the command wrote is committed', async () => {
    const w = world();
    branchWithSourceChange(w);

    const run = await ran(w.project, ['--plan=dependabot-7', '--level=none', '--title=Bump zod']);
    w.inCaller(['add', '.changes/dependabot-7-2.md']);
    w.inCaller(['commit', '-q', '-m', 'chore: release fragment dependabot-7']);

    expect(run.exitCode).toBe(0);
    expect(guardedAnswer(w)).toBe('clean');
  });

  it('reads missing for the same branch without the fragment', () => {
    const w = world();
    w.inCaller(['fetch', '-q', 'origin']);
    branchWithSourceChange(w);

    expect(guardedAnswer(w)).toBe('missing');
  });
});

describe('readNoteValues', () => {
  it('reads both spellings in order and stops at --', () => {
    expect(readNoteValues(['--note=a: one', '--plan=x', '--note', 'b: two', '--', '--note=c: three'])).toEqual(['a: one', 'b: two']);
  });

  it('refuses a bare --note', () => {
    expect(() => readNoteValues(['--note', '--plan=x'])).toThrow(CommandExit);
    expect(() => readNoteValues(['--note'])).toThrow(CommandExit);
  });
});

describe('noteLine', () => {
  it('writes <area>: <summary> as a bullet, splitting at the first colon and collapsing whitespace', () => {
    expect(noteLine(' cli :  a: b  c ')).toBe('- cli: a: b c');
  });

  it('refuses an empty side', () => {
    expect(() => noteLine(': summary')).toThrow(CommandExit);
    expect(() => noteLine('area:   ')).toThrow(CommandExit);
  });
});
