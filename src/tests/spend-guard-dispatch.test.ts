/**
 * The spend guard, end to end: a REAL line dispatched over a PLANTED
 * registry, through the REAL dispatcher (`cli/dispatch.ts`), which
 * records the running command in `core/command/running.ts`, whose record a
 * planted command's `run` reads by calling the REAL `spawnClaude`
 * (`core/loop/claude.ts`) against a stand-in `claude` on PATH.
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
 *     ends 0 with a `warn:` line on stdout (text mode's one stream)
 *     naming the command and saying to declare `spends`, and the
 *     stand-in runs once. Usage is never a gate.
 *   - The planted `pr triage`, dispatched without `--resolve`: warned
 *     the same way, naming the missing flag, the stand-in run once.
 *   - The SAME planted `pr triage`, dispatched WITH `--resolve`: the
 *     control that says the warning above came from the declaration and
 *     not from every session. It ends 0 with no warning, and the
 *     stand-in's log holds exactly one line.
 *
 * The same undeclared command is also dispatched with `--output=events`,
 * where stdout and stderr hold no warning since that output drops `warn`,
 * and with `--output=json`, where one `log` event at level `warn` names
 * the command; the stand-in runs once in each.
 *
 * "Ran the stand-in" is read off a log file the stand-in itself appends
 * to, never off a resolved promise: a stand-in that ran without being
 * asked to log would leave that file empty in the case that should have
 * written to it.
 *
 * ## The overlap case
 *
 * Two undeclared commands that start no session are dispatched at once,
 * the first started ending first, and `spawnClaude` is then called
 * outside any dispatch, as a later test file's stand-in session is. It
 * runs the stand-in once and warns nothing: a dispatch records its
 * command in an async scope of its own (`core/command/running.ts`), so
 * nothing is left for the guard to read once both have ended. This is
 * #927 as it was measured: with the record put back in a `finally`, the second to
 * end put back the first's record, and the guard, which threw at the
 * time, refused every session a later file started, naming a command
 * that had long ended. Run on 2026-10-10 against that dispatcher, this
 * case alone was red, rejecting with `rafa plan idle started a Claude
 * session but declares no spends` and the stand-in's log empty.
 *
 * The session's `warn` lines are read off an output set at module
 * level, which is the one a caller outside every dispatch writes
 * through (`core/output/active.ts`). Its control was run on
 * 2026-10-12: with `runAsRunningCommand` also leaving its record at
 * module level, this case alone of the four was red, its list holding
 * one line that named `rafa plan waits`, and `cli/running.ts` was
 * restored sha256-identical.
 */
import type { CommandSpend, RafaCommand, RafaFlagSpec } from '@open-tomato/rafa/core/command';
import type { OutputStream } from '@open-tomato/rafa/core/output';

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { claudeArgs, spawnClaude } from '@open-tomato/rafa/core/loop';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

import { dispatch } from '../cli/dispatch.js';

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
    outputs: ['text', 'json', 'events'],
    needsProject: false,
    ...(spend === undefined
      ? {}
      : { spends: spend }),
    run: async () => {
      await spawnClaude(claudeArgs(DEFAULT_SOURCES), 'a planted prompt');
    },
  };
}

/** An undeclared command under `plan` that starts no session, running `run`. */
function idle(action: string, run: RafaCommand['run']): RafaCommand {
  return { ...spender('plan', action), run };
}

/** A promise and the function that settles it, so a case orders its own overlap. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
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
    setActiveOutput(null);
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

  it('warns about an undeclared command and still runs its session, exiting 0', async () => {
    const outcome = await run(['plan', 'create']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('warn: ⚠️  rafa plan create started a Claude session but declares no spends');
    expect(outcome.stdout).toContain('declare spends on the command');
    expect(standInCalls()).toBe(1);
  });

  it('writes no warning to stdout or stderr in events mode, which drops warn, and still runs its session', async () => {
    const outcome = await run(['plan', 'create', '--output=events']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain('started a Claude session');
    expect(outcome.stderr).not.toContain('started a Claude session');
    expect(standInCalls()).toBe(1);
  });

  it('writes one log event at level warn naming the command in json mode and still runs its session', async () => {
    const outcome = await run(['plan', 'create', '--output=json']);
    const events = outcome.stdout.split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { type: string; level?: string; message?: string });
    const warnings = events.filter((event) => event.type === 'log' && event.level === 'warn');

    expect(outcome.exitCode).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('rafa plan create started a Claude session but declares no spends');
    expect(standInCalls()).toBe(1);
  });

  it('warns about the planted pr triage dispatched without --resolve, its with check having no production path of its own', async () => {
    const outcome = await run(['pr', 'triage']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('warn: ⚠️  rafa pr triage started a Claude session without --resolve');
    expect(standInCalls()).toBe(1);
  });

  it('warns nothing for the SAME command dispatched with --resolve, the control', async () => {
    const outcome = await run(['pr', 'triage', '--resolve']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain('started a Claude session');
    expect(outcome.stderr).toBe('');
    expect(standInCalls()).toBe(1);
  });

  it('warns about no session started outside any dispatch after two undeclared commands overlapped, the first started ending first', async () => {
    const bothRunning = gate();
    const firstEnded = gate();
    const registry = createCommandRegistry({
      subjects: [{ name: 'plan', summary: 'plans' }],
      commands: [
        idle('idle', async () => {
          await bothRunning.opened;
        }),
        idle('waits', async () => {
          bothRunning.open();
          await firstEnded.opened;
        }),
      ],
    });
    const sink = memoryStream().stream;
    const options = { registry, env: {}, stdout: sink, stderr: sink };

    const outcomes = await Promise.all([
      dispatch(['plan', 'idle'], options).then((outcome) => {
        firstEnded.open();
        return outcome;
      }),
      dispatch(['plan', 'waits'], options),
    ]);
    const warnings: string[] = [];
    setActiveOutput(sinkOutput({ warn: (message) => warnings.push(message) }));
    const exitCode = await spawnClaude(claudeArgs(DEFAULT_SOURCES), 'a prompt outside any dispatch');

    expect(outcomes.map((outcome) => outcome.exitCode)).toEqual([0, 0]);
    expect(exitCode).toBe(0);
    expect(warnings).toEqual([]);
    expect(standInCalls()).toBe(1);
  });
});
