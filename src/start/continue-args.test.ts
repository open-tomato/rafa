/**
 * Tests for `start/continue-args.ts`: the `--continue` flags read off
 * the words of a line, every combination the module refuses, the retry
 * count a `--continue` run opens with, and the criteria refusal made at
 * start.
 *
 * Every refusing case is paired with an accepted line one word away, so
 * a reader refusing everything fails here, and each refusal is read off
 * the `CommandExit` it throws: exit code 1, the words it names, and the
 * line saying nothing ran.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import {
  CONTINUE_OFF,
  DIRECTIVE_REASON,
  configuredRetries,
  readContinueArgs,
  refuseUnusableCriteria,
} from './continue-args.js';
import { NOTHING_DISPATCHED } from './session.js';

/** The `CommandExit` `read` threw. Fails when it threw none. */
function refusalOf(read: () => unknown): CommandExit {
  try {
    read();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
}

/** The refusal reading `args` threw. */
function argsRefusal(args: readonly string[]): CommandExit {
  return refusalOf(() => readContinueArgs(args));
}

describe('readContinueArgs', () => {
  it('reads a line without --continue as off, with no directive and no forced wrap-up', () => {
    expect(readContinueArgs([])).toEqual(CONTINUE_OFF);
    expect(readContinueArgs(['--plan=x.md', '--retry=2'])).toEqual(CONTINUE_OFF);
  });

  it('reads --continue alone as on, with no directive', () => {
    expect(readContinueArgs(['--continue'])).toEqual({ on: true, directive: null, forceWrapUp: false });
  });

  it('reads --force-wrap-up beside --continue', () => {
    expect(readContinueArgs(['--continue', '--force-wrap-up']).forceWrapUp).toBe(true);
  });

  it('reads --decide=stop and --decide=jump as a directive with the line\'s reason', () => {
    for (const strategy of ['stop', 'jump'] as const) {
      expect(readContinueArgs(['--continue', `--decide=${strategy}`]).directive).toEqual({
        strategy,
        reason: DIRECTIVE_REASON,
      });
    }
  });

  it('reads --decide=retry with its --approach, trimmed', () => {
    expect(readContinueArgs(['--continue', '--decide=retry', '--approach=  Run the suite in the foreground ']).directive)
      .toEqual({ strategy: 'retry', reason: DIRECTIVE_REASON, approach: 'Run the suite in the foreground' });
  });

  it('reads --decide=defer with its --after, counted from one', () => {
    expect(readContinueArgs(['--continue', '--decide=defer', '--after=15']).directive)
      .toEqual({ strategy: 'defer', reason: DIRECTIVE_REASON, after: 15 });
  });

  it('takes the last --decide of two, as the parser takes the later flag', () => {
    expect(readContinueArgs(['--continue', '--decide=stop', '--decide=jump']).directive?.strategy).toBe('jump');
  });

  it('reads nothing past a --, where a word is no flag of the run', () => {
    expect(readContinueArgs(['--', '--continue', '--decide=nope'])).toEqual(CONTINUE_OFF);
  });

  it('refuses --decide and --force-wrap-up without --continue, each naming --continue', () => {
    for (const [word, flag] of [['--decide=jump', '--decide'], ['--force-wrap-up', '--force-wrap-up']] as const) {
      const refusal = argsRefusal([word]);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain(`Refusing ${flag}:`);
      expect(refusal.message).toContain('needs --continue');
      expect(refusal.message).toContain(NOTHING_DISPATCHED);
    }
  });

  it.each([['maybe'], [''], ['Jump'], ['retry,stop']])('refuses --decide=%p, naming the four strategies', (value) => {
    const refusal = argsRefusal(['--continue', `--decide=${value}`]);

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`--decide=${value}`);
    expect(refusal.message).toContain('retry, stop, jump or defer');
  });

  it('refuses a bare --decide, --approach and --after, naming the = spelling', () => {
    for (const flag of ['--decide', '--approach', '--after']) {
      const refusal = argsRefusal(['--continue', flag]);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain(`${flag}=<`);
    }
  });

  it('refuses --decide=retry with no --approach, or a blank one', () => {
    for (const args of [['--continue', '--decide=retry'], ['--continue', '--decide=retry', '--approach=  ']]) {
      const refusal = argsRefusal(args);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain('--decide=retry needs --approach=<text>');
    }
  });

  it('refuses --approach beside any decision but retry, and without one', () => {
    for (const args of [['--continue', '--decide=jump', '--approach=x'], ['--continue', '--approach=x']]) {
      const refusal = argsRefusal(args);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain('--approach is read only beside --decide=retry');
    }
  });

  it('refuses --decide=defer with no --after', () => {
    const refusal = argsRefusal(['--continue', '--decide=defer']);

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain('--decide=defer needs --after=<line>');
  });

  it('refuses --after beside any decision but defer, and without one', () => {
    for (const args of [['--continue', '--decide=stop', '--after=3'], ['--continue', '--after=3']]) {
      const refusal = argsRefusal(args);

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain('--after is read only beside --decide=defer');
    }
  });

  it.each([['0'], ['-1'], ['1.5'], ['two'], ['02'], ['']])('refuses --after=%p, naming a line number from 1', (value) => {
    const refusal = argsRefusal(['--continue', '--decide=defer', `--after=${value}`]);

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain(`--after=${value}`);
    expect(refusal.message).toContain('a tracker line number from 1');
  });
});

describe('configuredRetries', () => {
  const config = { loopRetries: 3, loopRetriesOnContinue: 1 } as const;

  it('reads loop.retries for a run without --continue', () => {
    expect(configuredRetries(config, false)).toBe(3);
  });

  it('reads loop.retriesOnContinue for a --continue run', () => {
    expect(configuredRetries(config, true)).toBe(1);
    expect(configuredRetries({ loopRetries: 3, loopRetriesOnContinue: false }, true)).toBe(false);
  });
});

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-continue-args-'));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A project root holding, at `.rafa/continue-criteria.md`, `text` or nothing for null. */
function projectWith(text: string | null): string {
  const root = mkdtempSync(join(tempRoot, 'root-'));
  mkdirSync(join(root, '.rafa'));
  if (text !== null) writeFileSync(join(root, '.rafa', 'continue-criteria.md'), text, 'utf8');
  return root;
}

/** The criteria settings of a config naming `mode` at the default path. */
function settingsOf(mode: 'extend' | 'replace') {
  return { loopContinueCriteria: '.rafa/continue-criteria.md', loopContinueCriteriaMode: mode } as const;
}

describe('refuseUnusableCriteria', () => {
  const on = { on: true, directive: null, forceWrapUp: false } as const;

  it('refuses replace with no project file under --continue, naming the key and the path', () => {
    const root = projectWith(null);
    const refusal = refusalOf(() => refuseUnusableCriteria(on, root, settingsOf('replace')));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain('❌ Refusing --continue');
    expect(refusal.message).toContain('loop.continue.criteriaMode is replace');
    expect(refusal.message).toContain(join(root, '.rafa', 'continue-criteria.md'));
    expect(refusal.message).toContain(NOTHING_DISPATCHED);
  });

  it('refuses replace with a blank project file', () => {
    const root = projectWith('  \n');

    expect(refusalOf(() => refuseUnusableCriteria(on, root, settingsOf('replace'))).message).toContain('holds no criteria');
  });

  it('lets replace through with criteria in the file, and extend with no file', () => {
    expect(() => refuseUnusableCriteria(on, projectWith('- stop always'), settingsOf('replace'))).not.toThrow();
    expect(() => refuseUnusableCriteria(on, projectWith(null), settingsOf('extend'))).not.toThrow();
  });

  it('reads nothing for a run without --continue, whatever the mode', () => {
    expect(() => refuseUnusableCriteria(CONTINUE_OFF, projectWith(null), settingsOf('replace'))).not.toThrow();
  });
});
