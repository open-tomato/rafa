/**
 * Tests for the loop's one door onto the Claude CLI.
 *
 * The subject is an argument list and a spawn, so the question every
 * case here answers is "what would have been RUN", never "did a
 * session appear to work". That distinction is not a preference: the
 * real spawner is `Bun.spawn`, and the root suite runs vitest under
 * NODE, where `globalThis.Bun` is `undefined` and
 * `process.versions.bun` is null (measured with a throwaway test at
 * this commit). So {@link spawnClaude} cannot execute here at all, and
 * a suite without the {@link ClaudeSpawner} seam could assert nothing
 * about this module beyond its return type.
 *
 * That measurement is itself asserted rather than trusted, by the one
 * case that does NOT inject a spawner: `runClaude(prompt)` with the
 * default in place must REJECT with a `ReferenceError` naming `Bun`.
 * It is the control that says the default is still the real spawner —
 * an inert stub left in its place would satisfy every other case in
 * this file — and it is skipped rather than run wherever `Bun` does
 * exist, because there the same call would spawn a real session.
 *
 * Expected argument lists are pinned to LITERALS and never built from
 * {@link CLAUDE_BASE_ARGS}. A case comparing a constant against itself
 * moves with the constant, so it cannot tell `-p` from its absence,
 * and these two arguments are the compatibility promise this task is
 * about: `plan.ts`, the wrap-up and the CI-repair session all call
 * `runClaude(prompt)` and must keep spawning exactly what they spawned
 * before declarations existed.
 *
 * The flag fixtures are chosen to VIOLATE the rules they defend, which
 * is what a rule needs to be reddenable at all. They are deliberately
 * not in alphabetical order and not in the resolver's own key order,
 * so a mutation that sorts them reddens; one fixture repeats a flag,
 * so a mutation that dedupes reddens; and the base arguments appear
 * nowhere among them, so a mutation that puts flags first reddens on
 * position rather than on membership.
 *
 * Twelve module mutations were driven against this file and all
 * TWELVE reddened at least one case, with the module restored
 * byte-identical and the suite green either side: dropping the flags
 * from the argument list (5 of 15), putting them before the base
 * arguments instead of after (5), deduping them (1), sorting them (4),
 * dropping `-p` (10), dropping `--dangerously-skip-permissions` (10),
 * having `runClaude` ignore the flags it was handed (2), having it
 * answer 0 instead of the spawner's exit code (1), replacing its
 * default spawner with an inert stub (1), appending a newline to the
 * prompt (1), putting the prompt into the argument list as well (5),
 * and spawning twice per call (7). The UNION of their red sets covers
 * all 15 cases, which is the reading that says no fixture is riding
 * along — a per-leg count cannot say it. The last three legs were
 * added for exactly that reason: the first nine left the prompt
 * containment and the once-per-call claims unreddened, and a green
 * there is indistinguishable from a claim nothing tests.
 */
import type { ClaudeSpawner } from './claude.js';

import { describe, expect, it } from 'vitest';

import {
  CLAUDE_BASE_ARGS,
  claudeArgs,
  runClaude,
  spawnClaude,
} from './claude.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from './declaration.js';

/** One spawn the module asked for. */
interface SpawnCall {
  args: readonly string[];
  prompt: string;
}

/** A spawner that records what it was asked for and runs nothing. */
function recordingSpawner(exitCode = 0): {
  calls: SpawnCall[];
  spawn: ClaudeSpawner;
} {
  const calls: SpawnCall[] = [];
  const spawn: ClaudeSpawner = (args, prompt) => {
    calls.push({ args, prompt });
    return Promise.resolve(exitCode);
  };
  return { calls, spawn };
}

/** The one call a case made, with the stub proved to have been hit. */
function onlyCall(calls: readonly SpawnCall[]): SpawnCall {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('spawner was never called');
  return call;
}

/**
 * True where the real spawner could actually run.
 *
 * Measured false under the root suite, which is the whole reason
 * {@link ClaudeSpawner} exists. Where it is true the default-spawner
 * case would launch a real session, so that case skips itself.
 */
const HAS_BUN = (globalThis as Record<string, unknown>)['Bun'] !== undefined;

/** Flags out of both alphabetical and resolver order, on purpose. */
const UNSORTED_FLAGS = ['--effort', 'low', '--agent', 'doc-updater'];

describe('claudeArgs', () => {
  it('answers the two arguments the loop always spawned', () => {
    expect(claudeArgs()).toEqual(['-p', '--dangerously-skip-permissions']);
  });

  it('answers those same two for an explicitly empty flag list', () => {
    expect(claudeArgs([])).toEqual(['-p', '--dangerously-skip-permissions']);
  });

  it('appends flags after the base arguments in the order given', () => {
    expect(claudeArgs(UNSORTED_FLAGS)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--effort',
      'low',
      '--agent',
      'doc-updater',
    ]);
  });

  it('passes a repeated flag through rather than deduping it', () => {
    const flags = ['--tools', 'Read', '--tools', 'Write'];
    expect(claudeArgs(flags)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--tools',
      'Read',
      '--tools',
      'Write',
    ]);
  });

  it('answers a fresh array, so a caller cannot mutate the base', () => {
    const first = claudeArgs(['--effort', 'max']);
    first.push('--zz-not-a-flag');
    expect(claudeArgs()).toEqual(['-p', '--dangerously-skip-permissions']);
    expect(CLAUDE_BASE_ARGS).toEqual(['-p', '--dangerously-skip-permissions']);
  });
});

describe('runClaude', () => {
  it('spawns the base arguments alone for a plan or wrap-up call', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('generate the plan', [], spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
    ]);
  });

  it('spawns the base arguments when no flag argument is passed', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('preserve progress', undefined, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
    ]);
  });

  it('spawns the base arguments plus the flags it was handed', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('do the scoped task', UNSORTED_FLAGS, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--effort',
      'low',
      '--agent',
      'doc-updater',
    ]);
  });

  it('hands the prompt to the spawner unchanged', async () => {
    const { calls, spawn } = recordingSpawner();
    const prompt = 'Your scoped task is: measure the thing\nline two';

    await runClaude(prompt, ['--model', 'haiku'], spawn);

    expect(onlyCall(calls).prompt).toBe(prompt);
  });

  it('keeps the prompt out of the argument list entirely', async () => {
    const { calls, spawn } = recordingSpawner();
    const prompt = 'Your scoped task is: measure the thing';

    await runClaude(prompt, ['--model', 'haiku'], spawn);

    const { args } = onlyCall(calls);
    expect(args.filter((arg) => arg.includes('scoped'))).toEqual([]);
  });

  it('answers the exit code the spawner answered', async () => {
    const { spawn } = recordingSpawner(7);

    await expect(runClaude('a failing session', [], spawn)).resolves.toBe(7);
  });

  it('spawns exactly once per call', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('one session', ['--effort', 'low'], spawn);

    expect(calls).toHaveLength(1);
  });

  it.skipIf(HAS_BUN)('defaults to the real spawner', async () => {
    await expect(runClaude('would spawn for real'))
      .rejects.toThrow(ReferenceError);
    expect(spawnClaude).toBeTypeOf('function');
  });
});

describe('the argument list a declaration resolves to', () => {
  it('ends on the variadic --tools, with nothing left to swallow', () => {
    const taskLine =
      'Add the routing table  {tools=Read,Write,Edit effort=low}';
    const { declaration } = parseTaskDeclaration(taskLine);
    const resolved = resolveDeclarationFlags(declaration);

    const args = claudeArgs(resolved.args);

    expect(args.slice(0, 2)).toEqual(['-p', '--dangerously-skip-permissions']);
    expect(args.slice(-2)).toEqual(['--tools', 'Read,Write,Edit']);
  });

  it('emits only --agent when the declaration named an agent', async () => {
    const taskLine =
      'Update the cap sentence  {agent=doc-updater model=haiku}';
    const { declaration } = parseTaskDeclaration(taskLine);
    const resolved = resolveDeclarationFlags(declaration);
    const { calls, spawn } = recordingSpawner();

    await runClaude('the task prompt', resolved.args, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--agent',
      'doc-updater',
    ]);
  });
});
