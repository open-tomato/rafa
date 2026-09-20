/**
 * An end-to-end proof of the "Scope and init" stage: `rafa init` spawned
 * as `bun src/rafa.ts` over a scratch repository sitting two directories
 * inside a monorepo fixture, its `package.json` naming `packages/*` as
 * workspaces, under a scratch HOME `plantScratchRepo` (`cli-capture.ts`)
 * plants beside it. Never the real home, never the suite's own working
 * directory.
 *
 * Six readings, each a case below:
 *
 *   1. `rafa init --root=<repo> --yes` writes `.rafa/config.yaml`, the
 *      project tree and the `.gitignore` entry under the repository, not
 *      the monorepo root above it, and the user scope under the home.
 *   2. A rerun changes no byte of what was written, in either scope.
 *   3. `--root` naming the scratch home or `/` is refused, each with its
 *      reason, and nothing is written.
 *   4. A command run from a subdirectory of the initialised repository
 *      resolves it as its project: `effort collect`, which prints the
 *      root it was handed as its first line.
 *   5. The same command run outside any project exits nonzero with the
 *      `rafa init` hint on stderr and nothing on stdout.
 *   6. `tracking.specs` set in the project's config is read back through
 *      `git check-ignore`, a control path ignored either way
 *      (`.rafa/effort/`) and one never ignored beside it.
 *
 * The commit `effort collect` needs is made the way `makeRepo` in
 * `src/effort/collect.test.ts` does: proof against hooks, gpg signing
 * and a missing identity. Every git run here, that commit and every
 * `git check-ignore`, is scoped to the fixture's own scratch HOME and a
 * `.gitconfig` beside it, global and system config switched off, so
 * none reads the operator's own.
 */
import type { CapturedRun, ScratchRepo } from './cli-capture.js';

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BLOCK_BEGIN, BLOCK_END } from '../project/gitignore.js';
import { PROJECT_TREE, projectConfigText, userConfigText } from '../project/scaffold.js';
import { initHint } from '../project/scope.js';

import { plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own, its real path. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-scope-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const RUN_TIMEOUT = 30_000;

/** A monorepo fixture and the scratch repository `--root` names inside it. */
interface Fixture {
  /** The monorepo root: `package.json` names `packages/*` as workspaces. Every case names `scratch.repo` by `--root`, never this. */
  readonly mono: string;
  /** The scratch repository two directories under `mono`, its own HOME and PATH; see `cli-capture.ts`. */
  readonly scratch: ScratchRepo;
  /** A subdirectory of the repository, for the case resolving the project from below it. */
  readonly sub: string;
  /** A directory outside the fixture, holding no project and no `.rafa/config.yaml` above it. */
  readonly outside: string;
}

/** Plants a fresh instance of the fixture under `base`. */
function plantFixture(base: string): Fixture {
  const mono = mkdtempSync(join(base, 'mono-'));
  writeFileSync(join(mono, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  const packages = join(mono, 'packages');
  mkdirSync(packages);
  const scratch = plantScratchRepo(packages, { project: false });
  const sub = join(scratch.repo, 'sub');
  mkdirSync(sub);
  const outside = mkdtempSync(join(base, 'outside-'));
  return { mono, scratch, sub, outside };
}

/** The environment every git run here uses: `scratch`'s own HOME, global and system config off. */
function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/** Commits once, empty, in `scratch.repo`; see the module note. */
function commitOnce(scratch: ScratchRepo): void {
  const run = spawnSync('git', [
    '-c', 'user.name=rafa',
    '-c', 'user.email=rafa@example.invalid',
    '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null',
    'commit', '-q', '--allow-empty', '--no-verify', '-m', 'seed',
  ], { cwd: scratch.repo, encoding: 'utf8', env: gitEnv(scratch) });
  if (run.status !== 0) throw new Error(`git commit: ${run.stderr}`);
}

/** Whether git ignores `path` in `scratch.repo`, read by the exit code of `git check-ignore`. Throws for any exit but 0 and 1. */
function isIgnored(scratch: ScratchRepo, path: string): boolean {
  const run = spawnSync('git', ['check-ignore', '--no-index', '-q', path], {
    cwd: scratch.repo,
    encoding: 'utf8',
    env: gitEnv(scratch),
  });
  if (run.status === 0) return true;
  if (run.status === 1) return false;
  throw new Error(`git check-ignore ${path}: exit ${String(run.status)}: ${run.stderr}`);
}

/** Writes an empty file at `path`, creating its parent directories. */
function plantFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
}

/** Runs `rafa init --root=<root> --yes` under `fixture`'s scratch repository. */
function initAt(fixture: Fixture, root: string): CapturedRun {
  return runRafa(fixture.scratch, fixture.scratch.repo, ['init', `--root=${root}`, '--yes']);
}

/** Every path under `path`, `path` first; a plain file answers itself alone. */
function pathsUnder(path: string): readonly string[] {
  return lstatSync(path).isDirectory()
    ? [path, ...readdirSync(path).flatMap((name) => pathsUnder(join(path, name)))]
    : [path];
}

/** Every path under `path` with its modification time and its bytes, sorted by path. */
function stateOf(path: string): readonly string[] {
  return pathsUnder(path)
    .map((entry) => {
      const stat = lstatSync(entry);
      const body = stat.isDirectory()
        ? '<directory>'
        : readFileSync(entry, 'utf8');
      return `${entry} ${String(stat.mtimeMs)} ${body}`;
    })
    .sort((a, b) => a.localeCompare(b));
}

/** Every path `init` writes to, in `fixture`'s repository and its home, with its bytes and modification time. */
function writtenState(fixture: Fixture): readonly string[] {
  return [
    ...stateOf(join(fixture.scratch.repo, '.rafa')),
    ...stateOf(join(fixture.scratch.repo, '.gitignore')),
    ...stateOf(join(fixture.scratch.home, '.rafa')),
  ];
}

/** The text-mode lines a first init lists as created, the user scope under `fixture`'s scratch home. */
function createdLines(fixture: Fixture): readonly string[] {
  return [
    '  created   .rafa/',
    '  created   .rafa/config.yaml',
    ...PROJECT_TREE.map((name) => `  created   .rafa/${name}/`),
    '  created   .gitignore',
    '  created   .rafa/tracking.digest',
    `  created   ${join(fixture.scratch.home, '.rafa')}/`,
    `  created   ${join(fixture.scratch.home, '.rafa', 'config.yaml')}`,
    `  created   ${join(fixture.scratch.home, '.rafa', 'instincts')}/`,
  ];
}

describe('rafa init and project scope, spawned in a monorepo fixture under a scratch home', () => {
  it('writes the config, the tree and the .gitignore entry at the repository, not the monorepo root', () => {
    const fixture = plantFixture(tempRoot);

    const run = initAt(fixture, fixture.scratch.repo);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    // Starts with, rather than is, because the scratch PATH carries no
    // ~/.rafa/bin: the PATH check's own warning, unrelated to this case,
    // follows as one more line.
    expect(run.stdout).toStartWith([
      `Initialised a rafa project at ${fixture.scratch.repo} (named by --root).`,
      ...createdLines(fixture),
      '',
    ].join('\n'));
    expect(readFileSync(join(fixture.scratch.repo, '.rafa', 'config.yaml'), 'utf8')).toBe(projectConfigText());
    for (const name of PROJECT_TREE) {
      expect(lstatSync(join(fixture.scratch.repo, '.rafa', name)).isDirectory()).toBe(true);
    }
    expect(readFileSync(join(fixture.scratch.repo, '.gitignore'), 'utf8')).toBe(`${BLOCK_BEGIN}\n.rafa/\n${BLOCK_END}\n`);
    expect(readFileSync(join(fixture.scratch.home, '.rafa', 'config.yaml'), 'utf8')).toBe(userConfigText());
    expect(existsSync(join(fixture.mono, '.rafa'))).toBe(false);
  }, RUN_TIMEOUT);

  it('changes no byte on a rerun, and says the project already is one', () => {
    const fixture = plantFixture(tempRoot);
    initAt(fixture, fixture.scratch.repo);
    const before = writtenState(fixture);

    const run = initAt(fixture, fixture.scratch.repo);

    expect(run.exitCode).toBe(0);
    // Starts with; see the note on the PATH warning above.
    expect(run.stdout).toStartWith([
      `${fixture.scratch.repo} (named by --root) is already a rafa project: its .rafa/config.yaml is left as it was.`,
      'release.enabled is left unset, which reads as auto; run rafa init --release to set it.',
      'Nothing changed.',
      '',
    ].join('\n'));
    expect(writtenState(fixture)).toEqual(before);
  }, RUN_TIMEOUT);

  it.each([
    [
      'the scratch home',
      (fixture: Fixture) => fixture.scratch.home,
      (fixture: Fixture) => `${fixture.scratch.home} is the home directory, whose .rafa/ is the user scope`,
    ],
    ['/', () => '/', () => '/ is the filesystem root'],
  ])('refuses %s named by --root, naming its reason, and writes nothing', (_label, rootOf, reasonOf) => {
    const fixture = plantFixture(tempRoot);

    const run = initAt(fixture, rootOf(fixture));

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(`rafa init: refused: ${reasonOf(fixture)}\nNothing was written.\n`);
    expect(existsSync(join(fixture.scratch.repo, '.rafa'))).toBe(false);
  }, RUN_TIMEOUT);

  it('resolves the project from a subdirectory once it is initialised', () => {
    const fixture = plantFixture(tempRoot);
    commitOnce(fixture.scratch);
    initAt(fixture, fixture.scratch.repo);

    const run = runRafa(fixture.scratch, fixture.sub, ['effort', 'collect', '--no-sessions']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n')[0]).toBe(`effort collect: ${fixture.scratch.repo}`);
  }, RUN_TIMEOUT);

  it('refuses a command outside any project with exit code 1 and the rafa init hint', () => {
    const fixture = plantFixture(tempRoot);
    initAt(fixture, fixture.scratch.repo);

    const run = runRafa(fixture.scratch, fixture.outside, ['usage']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(`rafa: ${initHint(fixture.outside)}\n`);
  }, RUN_TIMEOUT);

  it('reads tracking.specs back through git check-ignore, a control ignored either way and one never ignored', () => {
    const fixture = plantFixture(tempRoot);
    initAt(fixture, fixture.scratch.repo);
    plantFile(join(fixture.scratch.repo, 'zz-control.txt'));
    plantFile(join(fixture.scratch.repo, '.rafa', 'specs', 's.md'));
    plantFile(join(fixture.scratch.repo, '.rafa', 'effort', 'e.sqlite'));

    expect(isIgnored(fixture.scratch, 'zz-control.txt')).toBe(false);
    expect(isIgnored(fixture.scratch, '.rafa/specs/s.md')).toBe(true);
    expect(isIgnored(fixture.scratch, '.rafa/effort/e.sqlite')).toBe(true);

    writeFileSync(join(fixture.scratch.repo, '.rafa', 'config.yaml'), `${projectConfigText()}tracking:\n  specs: true\n`);
    const run = initAt(fixture, fixture.scratch.repo);

    expect(run.exitCode).toBe(0);
    expect(isIgnored(fixture.scratch, 'zz-control.txt')).toBe(false);
    expect(isIgnored(fixture.scratch, '.rafa/specs/s.md')).toBe(false);
    expect(isIgnored(fixture.scratch, '.rafa/effort/e.sqlite')).toBe(true);
  }, RUN_TIMEOUT);
});
