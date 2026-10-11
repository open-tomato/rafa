/**
 * The lint step run for real, over a file planted under a scratch
 * `packages/<name>/src/`. `lint-step.test.ts` answers its runner with
 * canned reports; this file spawns `bunx eslint` in a scratch repository
 * that holds the root lint config, so it reads what the gate says of
 * package code: red with the rule named for a rule-breaking file, and
 * green, with no `import/no-unresolved`, for a clean file importing
 * `@open-tomato/rafa/store` (resolved through the packages' tsconfig
 * `paths`, which the scratch repository carries a stub target for).
 *
 * The scratch repository lives under the checkout's gitignored `.tmp/`
 * so that Node resolution finds the installed `node_modules` above it.
 */
import type { GitResult, GitRunner } from '../pr/index.js';

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { runLintStep } from './lint-step.js';

const ROOT = join(import.meta.dir, '..', '..');
const STOP = 130;
const CONFIG_FILES = ['eslint.config.mjs', 'eslint.base.mjs', 'sharedRules.mjs', 'tsconfig.json', 'tsconfig.base.json', 'tsconfig.packages.json'];
const PACKAGE_FILE = 'packages/scratch-pkg/src/planted.ts';
const LINT_TIMEOUT_MS = 120_000;

let repo: string;
let printed: string[];

/** Runs git in the scratch repository. */
const git: GitRunner = (args): GitResult => {
  const proc = Bun.spawnSync(['git', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
  return { ok: proc.exitCode === 0, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
};

function write(relative: string, content: string): void {
  const path = join(repo, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Commits the scratch repository's tree, answering the new HEAD. */
function commit(message: string): string {
  git(['add', '-A']);
  const done = git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message]);
  if (!done.ok) throw new Error(done.stderr);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

/** Plants `source` at {@link PACKAGE_FILE} on a commit after the base and runs the step over it. */
async function lintPlanted(source: string): Promise<{ red: boolean; blocker: string | null; printed: string }> {
  const base = commit('base');
  write(PACKAGE_FILE, source);
  commit('plant');
  const outcome = await runLintStep({ checkout: repo, base, task: 'a package task', git, stopCode: STOP });
  return { red: outcome.red, blocker: outcome.blocker, printed: printed.join('\n') };
}

beforeEach(() => {
  mkdirSync(join(ROOT, '.tmp'), { recursive: true });
  repo = mkdtempSync(join(ROOT, '.tmp', 'lint-step-packages-'));
  for (const name of CONFIG_FILES) cpSync(join(ROOT, name), join(repo, name));
  cpSync(join(ROOT, 'scripts', 'unsafeUnicode.mjs'), join(repo, 'scripts', 'unsafeUnicode.mjs'));
  write('packages/scratch-pkg/tsconfig.json', '{ "extends": "../../tsconfig.packages.json", "include": ["src"] }\n');
  write('src/effort/store/index.ts', 'export const STORE_STUB = 1;\n');
  write('src/ports/index.ts', 'export const PORTS_STUB = 1;\n');
  git(['init', '-q']);
  printed = [];
  setActiveOutput(sinkOutput({ info: (message) => printed.push(message) }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(repo, { recursive: true, force: true });
});

describe('runLintStep over a file under packages/<name>/src/', () => {
  it('reads red with the rule named for a file breaking a rule', async () => {
    const outcome = await lintPlanted('export const quoted = "double";\n');

    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(PACKAGE_FILE);
    expect(outcome.printed).toContain(`${PACKAGE_FILE}:1:`);
    expect(outcome.printed).toContain('(@stylistic/quotes)');
  }, LINT_TIMEOUT_MS);

  it('reads green, with no import/no-unresolved, for a clean file importing @open-tomato/rafa/store', async () => {
    const outcome = await lintPlanted('import { STORE_STUB } from \'@open-tomato/rafa/store\';\n\nexport const stored = STORE_STUB;\n');

    expect(outcome.printed).not.toContain('import/no-unresolved');
    expect(outcome.blocker).toBeNull();
    expect(outcome.red).toBe(false);
  }, LINT_TIMEOUT_MS);
});
