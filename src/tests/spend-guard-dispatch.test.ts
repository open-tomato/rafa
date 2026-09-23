/**
 * The spend guard, end to end: a REAL line dispatched over a PLANTED
 * registry, through the REAL dispatcher (`cli/dispatch.ts`), which
 * records the running command in `cli/running.ts`, whose record a
 * planted command's `run` reads by calling the REAL `spawnClaude`
 * (`utils/claude.ts`) against a stand-in `claude` on PATH.
 *
 * `claude.test.ts` drives the guard directly: it calls `setRunningCommand`
 * itself and then a door, so it proves the guard reads the record
 * correctly but nothing about whether `dispatch.ts` ever sets that
 * record the way the guard expects it. `dispatch.test.ts` drives the
 * recording directly: its commands read `runningCommand()` themselves
 * and never reach `spawnClaude`, so it proves the record but not the
 * guard. This file is the join: nothing here calls `setRunningCommand`,
 * and nothing here injects a spawner. The registry, the dispatcher, the
 * record and the guard are all the real modules, and the only stand-in
 * is the `claude` on PATH neither of those two files needs.
 *
 * ## `pr triage`'s `with --resolve` has no production path
 *
 * `pr triage --resolve` never calls `spawnClaude` in its own process: it
 * spawns a child `rafa loop start` (`commands/pr/resolve-loop.ts`), whose
 * own dispatch records `loop start` and is the command a session there
 * runs under. So driving the REAL `createPrTriageCommand` through this
 * file would exercise no guard at all. What is planted instead is a
 * command under the same subject, action and `spends` declaration as
 * the real one — `pr triage`, `with --resolve` — whose `run` calls
 * `spawnClaude` directly. That is what lets the `with` form be driven
 * here, over the real dispatcher, rather than left to the unit-level
 * cases of `claude.test.ts` alone.
 *
 * ## The three cases
 *
 *   - An undeclared command's `run` calls `spawnClaude`: the dispatch
 *     fails as `command_error`, its stderr line naming the command and
 *     saying to declare `spends`, and the stand-in is never reached.
 *   - The planted `pr triage`, dispatched without `--resolve`: refused
 *     the same way, naming the missing flag, the stand-in unreached.
 *   - The SAME planted `pr triage`, dispatched WITH `--resolve`: the
 *     control that says the case above was a refusal and not a command
 *     that could never have reached the stand-in at all. It ends 0, and
 *     the stand-in's log holds exactly one line.
 *
 * "Reached the stand-in" is read off a log file the stand-in itself
 * appends to, never off a resolved promise: a guard checked after the
 * spawn, or a stand-in that ran without being asked to log, would both
 * leave that file empty in the case that should have written to it.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand, RafaFlagSpec } from '../cli/command.js';
import type { CommandSpend } from '../cli/spends.js';

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';
import { claudeArgs, spawnClaude } from '../utils/claude.js';

/** The setting sources every planted command's session spawns with. */
const DEFAULT_SOURCES = ['project', 'local'] as const;

/** A stream collecting what is written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk) => { chunks.push(chunk); return true; } },
    text: () => chunks.join(''),
  };
}

/**
 * A command whose `run` calls the real `spawnClaude`, needing no
 * project so the case plants nothing beyond the registry and the
 * stand-in. `spends` is left off entirely where `spend` is undefined,
 * exactly as a command declaring nothing would be written.
 */
function spender(subject: string, action: string, spend?: CommandSpend, flags: RafaFlagSpec[] = []): RafaCommand {
  return {
    name: `${subject} ${action}`,
    subject,
    action,
    summary: 'planted so its spend guard can be driven through the real dispatcher',
    description: 'planted so its spend guard can be driven through the real dispatcher',
    args: [],
    flags,
    examples: [],
    outputs: ['text'],
    needsProject: false,
    ...(spend === undefined
      ? {}
      : { spends: spend }),
    run: async () => {
      await spawnClaude(claudeArgs(DEFAULT_SOURCES), 'a planted prompt');
    },
  };
}

/** The planted `pr triage`'s `--resolve` flag, matching the real command's own. */
const RESOLVE_FLAG: RafaFlagSpec = { name: 'resolve', description: 'Covers the run.', type: 'boolean' };

/** An undeclared command, the shape `plan create` would be without a `spends` field. */
const UNDECLARED = spender('plan', 'create');

/** `pr triage`, under the same `spends` the real command declares: `with --resolve`. */
const PLANTED_TRIAGE = spender('pr', 'triage', { when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' }, [RESOLVE_FLAG]);

/** The registry every case in this file dispatches over. */
const REGISTRY = createCommandRegistry({
  subjects: [
    { name: 'plan', summary: 'plans' },
    { name: 'pr', summary: 'pull requests' },
  ],
  commands: [UNDECLARED, PLANTED_TRIAGE],
});

describe('the spend guard, dispatched over a planted registry with a stand-in claude on PATH', () => {
  /** The bin directory holding this case's stand-in `claude`, and its call log. */
  let binDir = '';
  /** The file the stand-in appends one line to per session it is asked to run. */
  let callsFile = '';
  /** PATH as the case found it. */
  let savedPath: string | undefined;

  /** How many sessions the stand-in ran, 0 when it was never called at all. */
  function standInCalls(): number {
    return existsSync(callsFile)
      ? readFileSync(callsFile, 'utf8').split('\n')
        .filter((line) => line !== '').length
      : 0;
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'rafa-spend-guard-dispatch-'));
    callsFile = join(binDir, 'calls');
    savedPath = process.env['PATH'];
    const claudePath = join(binDir, 'claude');
    writeFileSync(claudePath, [
      '#!/bin/sh',
      `printf 'session\\n' >> '${callsFile}'`,
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(claudePath, 0o755);
    // A single-directory PATH: `Bun.spawn` refuses a name missing from
    // the PATH it is handed rather than falling back to the one the
    // suite runs under, so a call reaching anything but this stand-in
    // would fail loudly rather than pass by accident.
    process.env['PATH'] = binDir;
  });

  afterEach(() => {
    if (savedPath === undefined) {
      delete process.env['PATH'];
    } else {
      process.env['PATH'] = savedPath;
    }
    rmSync(binDir, { recursive: true, force: true });
  });

  /** Dispatches `words` over {@link REGISTRY} with streams of its own. */
  async function run(words: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const stdout = memoryStream();
    const stderr = memoryStream();
    const { exitCode } = await dispatch(words, {
      registry: REGISTRY,
      env: {},
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  }

  it('fails an undeclared command with the named error before any spawn, and reaches the stand-in never', async () => {
    const outcome = await run(['plan', 'create']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('rafa plan create started a Claude session but declares no spends');
    expect(outcome.stderr).toContain('declare spends on the command');
    expect(standInCalls()).toBe(0);
  });

  it('refuses the planted pr triage dispatched without --resolve, its with check having no production path of its own', async () => {
    const outcome = await run(['pr', 'triage']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('rafa pr triage started a Claude session without --resolve');
    expect(standInCalls()).toBe(0);
  });

  it('reaches the stand-in once for the SAME command dispatched with --resolve, the liveness control', async () => {
    const outcome = await run(['pr', 'triage', '--resolve']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(standInCalls()).toBe(1);
  });
});
