/**
 * Integration test of the kind check over a real temporary git
 * repository: `readPlanBase` and `readPlanFiles` read its history,
 * `runNamedTestAt` runs a named test file in a real detached worktree
 * with a real `bun test`, and `checkKind` reads what they answered.
 *
 * The repository holds two commits. The first is `origin/main`'s tip and
 * has every test green but one; the second, on `HEAD` only, edits
 * `src/value.ts`, which turns `src/fallout.test.ts` red, and leaves
 * `src/inherited.test.ts` (red since the first commit) and
 * `src/untouched.ts` alone. Nothing here mocks git or bun, so the case
 * proves the three halves of the check agree about one repository.
 */
import type { BaseRunCache } from './base-run.js';
import type { KindCheck, KindCheckEntry } from './own-check.js';
import type { PlanFilesReading } from './plan-commits.js';
import type { GitRunner } from '../core/git/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../core/git/index.js';

import { createBaseRunCache, runNamedTestAt } from './base-run.js';
import { checkKind, namedTestOf } from './own-check.js';
import { readPlanBase, readPlanFiles } from './plan-commits.js';

/** Each case runs `bun test` in a worktree, so it is given room. */
const RUN_TIMEOUT_MS = 60_000;

/** The test the second commit turns red: green on the first commit. */
const FALLOUT_TEST = 'src/fallout.test.ts';

/** The test red on both commits. */
const INHERITED_TEST = 'src/inherited.test.ts';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-own-check-')));
const repo = join(scope, 'repo');

let git: GitRunner;
let baseSha: string;
let headSha: string;
let planFiles: PlanFilesReading;
let cache: BaseRunCache;

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(runner: GitRunner, args: readonly string[]): string {
  const result = runner(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Writes `text` to `path` under the repository, making its folder. */
function put(path: string, text: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** A test file holding one case, `describe` > `it`, whose body is `body`. */
function testFile(imports: string, describeName: string, caseName: string, body: string): string {
  return `${imports}import { describe, expect, it } from 'bun:test';\n\n`
    + `describe('${describeName}', () => {\n  it('${caseName}', () => {\n    ${body}\n  });\n});\n`;
}

/** An entry of `kind` the session wrote, naming the case of `file` on a `file > case` line. */
function testEntry(file: string, name: string, kind: KindCheckEntry['kind']): KindCheckEntry {
  return { what: `${name} fails`, artifact: `${file} > ${name}`, kind };
}

/**
 * The check as the loop runs it: the entry's named test is run on the
 * plan's base and on the head, and the readings and the plan's files go
 * to `checkKind`.
 */
async function checked(entry: KindCheckEntry): Promise<KindCheck> {
  const test = namedTestOf(entry);
  const options = {
    checkout: repo,
    cache,
    env: { ...process.env, PATH: `${dirname(Bun.which('bun') ?? '')}${delimiter}${process.env.PATH ?? ''}` },
  };
  const readings = test === null
    ? null
    : {
      base: await runNamedTestAt(baseSha, test, options),
      head: await runNamedTestAt(headSha, test, options),
    };
  return checkKind({ entry, readings, planFiles });
}

beforeAll(() => {
  mkdirSync(repo);
  git = createGitRunner(repo);
  must(createGitRunner(scope), ['init', '--quiet', '--initial-branch=main', repo]);
  must(git, ['config', 'user.name', 'own-check']);
  must(git, ['config', 'user.email', 'own-check@example.invalid']);
  must(git, ['config', 'commit.gpgsign', 'false']);
  // The worktree of a run links this folder in; the tests need nothing from it.
  mkdirSync(join(repo, 'node_modules'));
  put('src/value.ts', 'export const value = 1;\n');
  put('src/untouched.ts', 'export const untouched = 1;\n');
  put(FALLOUT_TEST, testFile('import { value } from \'./value.js\';\n', 'fallout', 'holds the value', 'expect(value).toBe(1);'));
  put(INHERITED_TEST, testFile('', 'inherited', 'was never green', 'expect(1).toBe(2);'));
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'first']);
  must(git, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  put('src/value.ts', 'export const value = 2;\n');
  must(git, ['add', '-A']);
  must(git, ['commit', '--quiet', '-m', 'second']);
  headSha = must(git, ['rev-parse', 'HEAD']);
  const base = readPlanBase(git, 'main');
  if (!base.ok) throw new Error(base.problem);
  baseSha = base.sha;
  planFiles = readPlanFiles(git, baseSha);
  cache = createBaseRunCache();
});

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

describe('checkKind over a temporary repository', () => {
  it('reads the repository as two commits, the second touching only src/value.ts', () => {
    expect(baseSha).not.toBe(headSha);
    expect(planFiles).toEqual({ ok: true, files: ['src/value.ts'] });
  });

  it('reads an entry naming the test the second commit turned red as own-fallout', async () => {
    const check = await checked(testEntry(FALLOUT_TEST, 'fallout > holds the value', 'bug'));

    expect(check.row).toBe('fallout');
    expect(check.kind).toBe('own-fallout');
    expect(check.inherited).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('reads the same entry as own-fallout when the session called it own-gap', async () => {
    const check = await checked(testEntry(FALLOUT_TEST, 'fallout > holds the value', 'own-gap'));

    expect(check.kind).toBe('own-fallout');
  }, RUN_TIMEOUT_MS);

  it('reads a test red on both commits as inherited, and not as the plan\'s own', async () => {
    const check = await checked(testEntry(INHERITED_TEST, 'inherited > was never green', 'own-fallout'));

    expect(check.row).toBe('red-on-both');
    expect(check.inherited).toBe(true);
    expect(check.kind).toBe('bug');
  }, RUN_TIMEOUT_MS);

  it('reads an entry naming a file the second commit did not touch as a bug', async () => {
    const check = await checked({
      what: 'src/untouched.ts keeps a stale constant',
      artifact: null,
      kind: 'own-gap',
    });

    expect(check.row).toBe('file-outside-plan');
    expect(check.kind).toBe('bug');
    expect(check.inherited).toBe(false);
  });

  it('reads an entry naming a file the second commit touched as own-gap', async () => {
    const check = await checked({
      what: 'src/value.ts leaves a constant half changed',
      artifact: null,
      kind: 'bug',
    });

    expect(check.row).toBe('plan-files');
    expect(check.kind).toBe('own-gap');
  });

  it('reads a test the base does not hold as a bug', async () => {
    const check = await checked(testEntry('src/absent.test.ts', 'absent > never existed', 'own-fallout'));

    expect(check.row).toBe('head-not-red');
    expect(check.kind).toBe('bug');
  }, RUN_TIMEOUT_MS);

  it('leaves no worktree behind after the runs', () => {
    const worktrees = must(git, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('worktree '));

    expect(worktrees).toEqual([`worktree ${repo}`]);
  });
});
