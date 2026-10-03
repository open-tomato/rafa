/**
 * The determinism the module notes of `strategy.ts` and
 * `fragment-tree.ts` promise — "two machines folding the same tree get
 * byte-identical answers" — measured rather than assumed: this file
 * builds one scratch git tree of fragments, then folds it from two
 * SEPARATE, real `bun` child processes (not two calls in this process,
 * the way `hop-record.integration.test.ts`'s racing case tells a real
 * process apart from a same-process call) and asserts their `{ version,
 * section }` answers are byte-identical, both to each other and to a
 * fold run in this process over the same tree.
 *
 * Each process reads the tree fresh with `readFragmentTree`, builds the
 * `semver-by-level` strategy from the same `release.heading`, and folds
 * through `foldWithStrategy` — the same path `forecast.ts` and settle
 * take — so nothing here is a shortcut around the module's own contract.
 */
import type { Fragment } from './fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { readFragmentTree } from './fragment-tree.js';
import { serializeFragment } from './fragment.js';
import { releaseStrategyFor } from './strategy.js';

/** A temporary directory of this file's own. */
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fold-spawned-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The fragments directory the scratch tree writes under. */
const DIR = '.changes';

/** `release.heading`'s value, matched between the in-process fold and both racers. */
const HEADING = '## {version} — {date}, {title}';

/** The base version every fold in this file starts from. */
const BASE_VERSION = '0.25.0';

/** The date every commit in the scratch tree gets, so `{date}` is fixed rather than "today". */
const COMMIT_DATE = '2026-09-20T12:00:00Z';

/** The absolute path to `fragment-tree.ts`, handed to each spawned racer. */
const FRAGMENT_TREE_MODULE = fileURLToPath(new URL('./fragment-tree.js', import.meta.url));
/** The absolute path to `strategy.ts`, handed to each spawned racer. */
const STRATEGY_MODULE = fileURLToPath(new URL('./strategy.js', import.meta.url));
/** The absolute path to `pr/index.ts`, handed to each spawned racer. */
const GIT_RUNNER_MODULE = fileURLToPath(new URL('../pr/index.js', import.meta.url));

/** The fragment text of plan `plan`, at `level`, with one note. */
function fragmentText(plan: string, level: Fragment['level'], note: string): string {
  const fragment: Fragment = { plan, title: `title of ${plan}`, level, notes: [`- ${note}`] };
  return serializeFragment(fragment);
}

/** Builds the scratch repository this file folds: three commits on `main`. */
function plantTree(): string {
  const root = join(tempRoot, 'repo');
  const home = join(tempRoot, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });

  const env = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
    GIT_AUTHOR_DATE: COMMIT_DATE,
    GIT_COMMITTER_DATE: COMMIT_DATE,
    LC_ALL: 'C',
  };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  };
  const commit = (files: Readonly<Record<string, string>>, message: string): void => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
  };

  git(['init', '-q', '--initial-branch=main', '.']);
  commit({ 'README.md': 'scratch\n' }, 'first');
  commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1', 'patch', 'Area rafa-1: a fix') }, 'add rafa-1');
  commit({ [`${DIR}/rafa-2.md`]: fragmentText('rafa-2', 'minor', 'Area rafa-2: a feature') }, 'add rafa-2');
  return root;
}

/** What each racer prints: the fold's `{ version, section }`, or null. */
interface FoldAnswer {
  readonly version: string;
  readonly section: string;
}

/**
 * The source of one racer: reads `root`'s tree fresh, folds it through
 * `semver-by-level` over `BASE_VERSION`, and prints the answer as one
 * line of JSON — nothing else on stdout, so two racers' whole output
 * can be compared byte for byte.
 */
function racerSource(root: string): string {
  return [
    `import { createGitRunner } from ${JSON.stringify(GIT_RUNNER_MODULE)};`,
    `import { readFragmentTree } from ${JSON.stringify(FRAGMENT_TREE_MODULE)};`,
    `import { foldWithStrategy, releaseStrategyFor } from ${JSON.stringify(STRATEGY_MODULE)};`,
    `const root = ${JSON.stringify(root)};`,
    `const dir = ${JSON.stringify(DIR)};`,
    `const baseVersion = ${JSON.stringify(BASE_VERSION)};`,
    `const heading = ${JSON.stringify(HEADING)};`,
    'const reading = readFragmentTree(createGitRunner(root), "HEAD", dir);',
    'if (!reading.ok) { console.error(reading.problem); process.exit(1); }',
    'const fragments = [];',
    'for (const item of reading.fragments) {',
    '  if (!item.reading.ok) { console.error(`unreadable fragment ${item.id}`); process.exit(1); }',
    '  fragments.push({ id: item.id, addedOn: item.addedOn, fragment: item.reading.fragment });',
    '}',
    'const strategy = releaseStrategyFor("semver-by-level", { heading });',
    'const outcome = foldWithStrategy(strategy, baseVersion, fragments);',
    'if (!outcome.ok) { console.error(outcome.line); process.exit(1); }',
    'process.stdout.write(JSON.stringify(outcome.result));',
  ].join('\n');
}

/** Runs one racer as a real, separate `bun` process; answers its whole stdout. */
function runRacer(root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = Bun.spawn(['bun', '-e', racerSource(root)], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    void (async () => {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`racer over ${root} exited ${String(code)}: ${stderr}`));
    })();
  });
}

describe('two separate bun processes folding the same scratch tree', () => {
  it('answer byte-identical { version, section }, matching a fold run in this process', async () => {
    const root = plantTree();

    const [first, second] = await Promise.all([runRacer(root), runRacer(root)]);
    expect(first).toBe(second);

    const answer = JSON.parse(first) as FoldAnswer;
    expect(answer.version).toBe('0.26.0');
    expect(answer.section.split('\n').slice(0, 2)).toEqual([
      '## 0.26.0 — 2026-09-20, title of rafa-1; title of rafa-2',
      '<!-- rafa:fragments rafa-1 rafa-2 -->',
    ]);

    const reading = readFragmentTree(createGitRunner(root), 'HEAD', DIR);
    if (!reading.ok) throw new Error(reading.problem);
    const fragments = reading.fragments.map((item) => {
      if (!item.reading.ok) throw new Error(`unreadable fragment ${item.id}`);
      return { id: item.id, addedOn: item.addedOn, fragment: item.reading.fragment };
    });
    const strategy = releaseStrategyFor('semver-by-level', { heading: HEADING });
    const expected = strategy.fold(BASE_VERSION, fragments);
    expect(expected).not.toBeNull();
    expect(JSON.stringify(expected)).toBe(first);
  });
});
