/**
 * Sweep: no prompt the wrap-up hands a session names `origin/main`
 * literally, so under `pr.base: integration` none can send the session to
 * the wrong branch.
 *
 * Two readings of the same rule. The built wrap-up prompt, over a run
 * whose base is `integration` with `origin/HEAD` naming `main`, holds no
 * `origin/main` whether or not a pull request is open, and none under
 * `pr.provider: none` either, where it names no `gh pr` at all (#977).
 * And the source of
 * every module that writes a wrap-up, CI-repair or conflict-repair prompt
 * (`wrap-up.ts`, `pr-lifecycle.ts`, `wrap-up-run.ts`, `runner-pr.ts`)
 * carries no `origin/main` in its code, comments aside: a prompt line
 * must interpolate the run's base. The source reading is a content
 * sweep, so it has a planted-source control.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { resolveBaseBranch } from '@open-tomato/rafa-run/cleanup/index';
import { buildWrapUpPrompt } from '@open-tomato/rafa-run/start/wrap-up';

import { SWEEP_TIMEOUT } from '../tests/sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const PROMPT_MODULES = ['wrap-up.ts', 'pr-lifecycle.ts', 'wrap-up-run.ts', 'runner-pr.ts'];

/** The prompt modules' folder: they live in the run package since pass 4f, this file at the root. */
const MOVED_DIR = join(import.meta.dir, '..', '..', 'packages', 'rafa-run', 'src', 'start');
const LITERAL = 'origin/main';

/** `source` with block and line comments blanked, so only code and strings remain. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The lines of `source`'s code that name the literal. */
function literalLines(source: string): string[] {
  return withoutComments(source).split('\n')
    .filter((line) => line.includes(LITERAL));
}

describe('the base a prompt names under pr.base: integration', () => {
  const base = resolveBaseBranch(() => ({ ok: true, stdout: 'origin/main\n', stderr: '' }), 'integration');
  const plan = '# Plan: sweep\n\n- [ ] A task\n';

  test('the run resolves to integration over an origin/HEAD naming main', () => {
    expect(base).toBe('integration');
  });

  test('the wrap-up prompt names no origin/main with no pull request open', () => {
    const prompt = buildWrapUpPrompt('feat/sweep', base, plan, 'gh', null);

    expect(prompt).toContain('origin/integration');
    expect(prompt).not.toContain(LITERAL);
  });

  test('the wrap-up prompt under a none provider names no origin/main and no gh pr', () => {
    const prompt = buildWrapUpPrompt('feat/sweep', base, plan, 'none', null);

    expect(prompt).toContain('origin/integration');
    expect(prompt).not.toContain(LITERAL);
    expect(prompt).not.toContain('gh pr');

    // The control: the same call under `gh` does name a `gh pr` command.
    expect(buildWrapUpPrompt('feat/sweep', base, plan, 'gh', null)).toContain('gh pr create --base integration');
  });

  test.each(PROMPT_MODULES)('%s writes no origin/main literal in code', (name) => {
    const source = readFileSync(join(MOVED_DIR, name), 'utf8');

    expect(literalLines(source)).toEqual([]);
  });

  test('the detector finds a planted literal in code and ignores one in a comment', () => {
    const planted = ['// merges origin/main', 'const line = `git merge origin/main`;', '/* origin/main */'].join('\n');

    expect(literalLines(planted)).toEqual(['const line = `git merge origin/main`;']);
  });
});
