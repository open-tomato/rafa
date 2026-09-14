/**
 * Tests for the loop's two doors onto the Claude CLI.
 *
 * The subject is an argument list and a spawn, so the question every
 * case answers, bar the stand-in cases described below, is "what
 * would have been RUN", never "did a session appear to work". That
 * distinction is not a preference: the
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
 * moves with the constant, so it cannot tell `-p` from its absence.
 * The setting sources are pinned the same way. Most cases hand over
 * `project,local`, the sources a run with no config resolves to, and
 * each door has a case handing over {@link UNSORTED_SOURCES}, in an
 * order neither the CLI's help nor a sort gives, so a door that spelled
 * the default, or sorted what it was handed, reddens there rather than
 * agreeing with a fixture that holds the default.
 *
 * Four mutations of `claudeArgs` were run once each against this file and
 * the six other suites that reach the setting sources, each restored
 * sha256-identical: dropping the sources (28 of 154 cases red across the
 * seven), spelling `project,local` whatever was handed (9), sorting them
 * (25) and putting them after the flags (18). In this file only the cases
 * handing over {@link UNSORTED_SOURCES} redden under the spelled default,
 * which is what those cases are for.
 *
 * The flag fixtures are chosen to VIOLATE the rules they defend, which
 * is what a rule needs to be reddenable at all. They are deliberately
 * not in alphabetical order and not in the resolver's own key order,
 * so a mutation that sorts them reddens; one fixture repeats a flag,
 * so a mutation that dedupes reddens; and the base arguments appear
 * nowhere among them, so a mutation that puts flags first reddens on
 * position rather than on membership.
 *
 * Twelve module mutations were driven against the fifteen cases this
 * file held before `runClaudeCaptured` existed, and all TWELVE
 * reddened at least one case, with the module restored
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
 *
 * The `runClaudeCaptured` cases come in two halves. The first drives
 * the entry through a recording double, exactly as the `runClaude`
 * cases do, and reads the same literals. The second is the one place
 * this file RUNS something, because a capture is a tee over a pipe —
 * chunk order, a character split across two reads, an exit code
 * beside the text, a session still running after a failed write — and
 * a recording double has none of that. Those cases call the entry with
 * its DEFAULT spawner against a stand-in `claude`: a `/bin/sh` script
 * in a temp directory that PATH is set to, alone, for the case. This
 * suite runs under bun (the runtime paragraphs above describe the
 * vitest era, and their `it.skipIf(HAS_BUN)` case is skipped here), so
 * the default is the real spawner, and the stand-in is what keeps it
 * from reaching a real session. Measured on bun 1.3.14, `Bun.spawn`
 * resolves the executable on the PATH it is handed, and a name missing
 * from that one directory is refused (`Executable not found in $PATH`)
 * rather than found on the PATH the process started with. That
 * one-directory PATH is also why the stand-ins name `/bin/cat` and
 * `/bin/sleep` absolutely.
 *
 * Two of those fixtures would pass vacuously if left to chance, so
 * neither is. The split character is FORCED: the stand-in writes the
 * first byte of a three-byte character, then polls (at most 100 times)
 * for a file the operator-stdout spy creates on its first call, so the
 * second half cannot join the first in a single read, and the case
 * asserts the split chunk before it reads the decoded text. And
 * `CLAUDE_CODE_ENTRYPOINT` is set to a sentinel first, so the `cli` a
 * stand-in reads back came from the spawner rather than from whatever
 * shell ran the suite, which may already carry `cli`.
 *
 * Seventeen module mutations were driven against the section once it
 * landed, over the file's 28 cases in two full passes, with the file
 * green before and after each pass and the module restored
 * byte-identical. Every leg reddened at least one case in both passes:
 * the entry ignoring its flags (2 of 28), answering exit 0 (3),
 * dropping the output (6), spawning twice (6, then 7), appending a
 * newline to the prompt (2), putting the prompt into the argument list
 * as well (4) and defaulting to an inert stub (7); the tee dropping the
 * operator write (3), buffering and writing once at the end (2),
 * decoding chunk by chunk (1), keeping only the last chunk (2),
 * skipping the decoder's final flush (1) and decoding `fatal` (1); the
 * spawner rejecting without waiting for the exit (1), answering exit 0
 * (2), inheriting stdout instead of piping it (7) and dropping the
 * entrypoint override (1). The UNION of their red sets is all 13 cases
 * of the section and none of the fifteen above it. The one set that
 * moved between passes is the double spawn's: its two stand-ins write
 * through one spy, so whether the failed-write case reddens as well is
 * a race, and the five recording cases plus the chunk case are what
 * both passes agree on.
 *
 * ## Json mode and the usage check
 *
 * The json-mode cases run the same kind of stand-in with a recording
 * output set as the active output in `json` (`adapters/output/active.ts`)
 * and the `process.stdout.write` spy still in place, so a byte reaching
 * stdout is a reading beside the lines the output was handed. The split
 * character is forced as above, the marker created by the output's first
 * `info` line, and the stand-in writes `marker never seen` in place of
 * the rest when its poll ran out, so a split left to chance reddens
 * rather than passing. The control sets that same output in `text`, and
 * reads the bytes on stdout and no line.
 *
 * `checkUsage` is read through a `sinkOutput` recording every level, with
 * `CLAUDE_USAGE_PERCENT` set for the case and put back after it: one case
 * per branch, and one for a usage that cannot be read.
 *
 * Six mutations of `claude.ts` were driven against these cases on
 * 2026-09-15, each restored sha256-identical with the suites green before
 * and after, and every one reddened at least one case of this file. The
 * tee's mode inverted reddened all four json cases and two text ones. A
 * last line left unflushed reddened 2, and blank lines dropped 1. Bytes
 * written in json mode as well reddened 2. `spawnClaude` never handing a
 * json-mode session to the capturing spawner reddened 1, and so did the
 * usage line written at `warn`.
 */
import type {
  CapturedSession,
  CapturingSpawner,
  ClaudeSpawner,
} from './claude.js';
import type { AgentEffortLookup } from './declaration.js';
import type { ClaudeSettingSource } from '../config.js';

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  CLAUDE_BASE_ARGS,
  checkUsage,
  claudeArgs,
  runClaude,
  runClaudeCaptured,
  SETTING_SOURCES_FLAG,
  spawnClaude,
} from './claude.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from './declaration.js';

/** No agent definition here declares an effort of its own. */
const NO_OWN_EFFORT: AgentEffortLookup = () => false;

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

/** The setting sources a run with no config resolves to. */
const DEFAULT_SOURCES: readonly ClaudeSettingSource[] = ['project', 'local'];

/** Setting sources in an order neither the CLI help nor a sort gives. */
const UNSORTED_SOURCES: readonly ClaudeSettingSource[] = ['user', 'local', 'project'];

describe('claudeArgs', () => {
  it('answers the base arguments and the setting sources', () => {
    expect(claudeArgs(DEFAULT_SOURCES)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
  });

  it('answers those same four for an explicitly empty flag list', () => {
    expect(claudeArgs(DEFAULT_SOURCES, [])).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
  });

  it('joins the setting sources with commas in the order given', () => {
    expect(claudeArgs(UNSORTED_SOURCES)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'user,local,project',
    ]);
  });

  it('appends flags after the setting sources in the order given', () => {
    expect(claudeArgs(DEFAULT_SOURCES, UNSORTED_FLAGS)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--effort',
      'low',
      '--agent',
      'doc-updater',
    ]);
  });

  it('passes a repeated flag through rather than deduping it', () => {
    const flags = ['--tools', 'Read', '--tools', 'Write'];
    expect(claudeArgs(DEFAULT_SOURCES, flags)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--tools',
      'Read',
      '--tools',
      'Write',
    ]);
  });

  it('answers a fresh array, so a caller cannot mutate the base', () => {
    const first = claudeArgs(DEFAULT_SOURCES, ['--effort', 'max']);
    first.push('--zz-not-a-flag');
    expect(claudeArgs(DEFAULT_SOURCES)).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
    expect(CLAUDE_BASE_ARGS).toEqual(['-p', '--dangerously-skip-permissions']);
    expect(SETTING_SOURCES_FLAG).toBe('--setting-sources');
  });
});

describe('runClaude', () => {
  it('spawns the base arguments and setting sources alone for a plan or wrap-up call', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('generate the plan', DEFAULT_SOURCES, [], spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
  });

  it('spawns the base arguments and setting sources when no flag argument is passed', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('preserve progress', DEFAULT_SOURCES, undefined, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
  });

  it('spawns the base arguments, the setting sources and the flags it was handed', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('do the scoped task', DEFAULT_SOURCES, UNSORTED_FLAGS, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--effort',
      'low',
      '--agent',
      'doc-updater',
    ]);
  });

  it('spawns under the setting sources it was handed, in their order', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('repair the PR', UNSORTED_SOURCES, [], spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'user,local,project',
    ]);
  });

  it('hands the prompt to the spawner unchanged', async () => {
    const { calls, spawn } = recordingSpawner();
    const prompt = 'Your scoped task is: measure the thing\nline two';

    await runClaude(prompt, DEFAULT_SOURCES, ['--model', 'haiku'], spawn);

    expect(onlyCall(calls).prompt).toBe(prompt);
  });

  it('keeps the prompt out of the argument list entirely', async () => {
    const { calls, spawn } = recordingSpawner();
    const prompt = 'Your scoped task is: measure the thing';

    await runClaude(prompt, DEFAULT_SOURCES, ['--model', 'haiku'], spawn);

    const { args } = onlyCall(calls);
    expect(args.filter((arg) => arg.includes('scoped'))).toEqual([]);
  });

  it('answers the exit code the spawner answered', async () => {
    const { spawn } = recordingSpawner(7);

    await expect(runClaude('a failing session', DEFAULT_SOURCES, [], spawn)).resolves.toBe(7);
  });

  it('spawns exactly once per call', async () => {
    const { calls, spawn } = recordingSpawner();

    await runClaude('one session', DEFAULT_SOURCES, ['--effort', 'low'], spawn);

    expect(calls).toHaveLength(1);
  });

  it.skipIf(HAS_BUN)('defaults to the real spawner', async () => {
    await expect(runClaude('would spawn for real', DEFAULT_SOURCES))
      .rejects.toThrow(ReferenceError);
    expect(spawnClaude).toBeTypeOf('function');
  });
});

describe('the argument list a declaration resolves to', () => {
  it('ends on the variadic --tools, with nothing left to swallow', () => {
    const taskLine =
      'Add the routing table  {tools=Read,Write,Edit effort=low}';
    const { declaration } = parseTaskDeclaration(taskLine);
    const resolved = resolveDeclarationFlags(declaration, NO_OWN_EFFORT);

    const args = claudeArgs(DEFAULT_SOURCES, resolved.args);

    expect(args.slice(0, 4)).toEqual(['-p', '--dangerously-skip-permissions', '--setting-sources', 'project,local']);
    expect(args.slice(-2)).toEqual(['--tools', 'Read,Write,Edit']);
  });

  it('emits no --model beside --agent when the declaration named an agent', async () => {
    const taskLine =
      'Update the cap sentence  {agent=doc-updater model=haiku}';
    const { declaration } = parseTaskDeclaration(taskLine);
    const resolved = resolveDeclarationFlags(declaration, NO_OWN_EFFORT);
    const { calls, spawn } = recordingSpawner();

    await runClaude('the task prompt', DEFAULT_SOURCES, resolved.args, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--agent',
      'doc-updater',
    ]);
  });
});

/**
 * A capturing spawner that records what it was asked for, runs
 * nothing, and answers `answer`.
 */
function recordingCapturingSpawner(answer: CapturedSession): {
  calls: SpawnCall[];
  spawn: CapturingSpawner;
} {
  const calls: SpawnCall[] = [];
  const spawn: CapturingSpawner = (args, prompt) => {
    calls.push({ args, prompt });
    return Promise.resolve(answer);
  };
  return { calls, spawn };
}

/** The answer for a case that reads nothing of what came back. */
const QUIET_SESSION: CapturedSession = { exitCode: 0, stdout: '' };

describe('runClaudeCaptured', () => {
  it('spawns the base arguments and setting sources alone when no flag argument is passed', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);

    await runClaudeCaptured('do the scoped task', DEFAULT_SOURCES, undefined, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
  });

  it('spawns the base arguments, the setting sources and the flags it was handed', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);

    await runClaudeCaptured('do the scoped task', DEFAULT_SOURCES, UNSORTED_FLAGS, spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--effort',
      'low',
      '--agent',
      'doc-updater',
    ]);
  });

  it('spawns under the setting sources it was handed, in their order', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);

    await runClaudeCaptured('do the scoped task', UNSORTED_SOURCES, ['--model', 'haiku'], spawn);

    expect(onlyCall(calls).args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'user,local,project',
      '--model',
      'haiku',
    ]);
  });

  it('hands the prompt to the spawner unchanged', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);
    const prompt = 'Your scoped task is: measure the thing\nline two';

    await runClaudeCaptured(prompt, DEFAULT_SOURCES, ['--model', 'haiku'], spawn);

    expect(onlyCall(calls).prompt).toBe(prompt);
  });

  it('keeps the prompt out of the argument list entirely', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);
    const prompt = 'Your scoped task is: measure the thing';

    await runClaudeCaptured(prompt, DEFAULT_SOURCES, ['--model', 'haiku'], spawn);

    const { args } = onlyCall(calls);
    expect(args.filter((arg) => arg.includes('scoped'))).toEqual([]);
  });

  it('answers the exit code and the output the spawner answered', async () => {
    const { spawn } = recordingCapturingSpawner({
      exitCode: 7,
      stdout: 'the final message\n',
    });

    await expect(runClaudeCaptured('a failing session', DEFAULT_SOURCES, [], spawn))
      .resolves.toEqual({ exitCode: 7, stdout: 'the final message\n' });
  });

  it('spawns exactly once per call', async () => {
    const { calls, spawn } = recordingCapturingSpawner(QUIET_SESSION);

    await runClaudeCaptured('one session', DEFAULT_SOURCES, ['--effort', 'low'], spawn);

    expect(calls).toHaveLength(1);
  });
});

/** The file the operator-stdout spy creates on its first call. */
const FIRST_WRITE_MARKER = 'first-write-seen';

/** The directory holding this case's stand-in and its marker files. */
let binDir = '';

/** Every chunk the capture wrote on to the operator, in order. */
let written: Uint8Array[] = [];

/** When set, the operator-stdout spy throws this instead of recording. */
let writeFailure: Error | undefined;

/** PATH and the entrypoint as the case found them. */
let savedEnv: Record<'PATH' | 'CLAUDE_CODE_ENTRYPOINT', string | undefined> = {
  PATH: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
};

/** Puts an environment variable back the way a case found it. */
function restoreEnv(name: keyof typeof savedEnv, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/**
 * Installs a `/bin/sh` script of `lines` as the only `claude` on PATH
 * for the rest of the case.
 */
function standInClaude(lines: readonly string[]): void {
  const path = join(binDir, 'claude');
  writeFileSync(path, ['#!/bin/sh', ...lines, ''].join('\n'));
  chmodSync(path, 0o755);
  process.env['PATH'] = binDir;
}

/**
 * A stand-in writing `x` and the first byte of a euro sign, then the
 * rest of the sign and `y` only once the operator holds the first
 * chunk, polling for the spy's marker at most 100 times.
 */
function splitCharacterStandIn(): void {
  const marker = join(binDir, FIRST_WRITE_MARKER);
  standInClaude([
    'printf \'x\\342\'',
    'n=0',
    `while [ ! -e '${marker}' ] && [ "$n" -lt 100 ]; do /bin/sleep 0.01; n=$((n + 1)); done`,
    'printf \'\\202\\254y\\n\'',
  ]);
}

describe('runClaudeCaptured against a stand-in claude on PATH', () => {
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'rafa-claude-stand-in-'));
    savedEnv = {
      PATH: process.env['PATH'],
      CLAUDE_CODE_ENTRYPOINT: process.env['CLAUDE_CODE_ENTRYPOINT'],
    };
    written = [];
    writeFailure = undefined;
    spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      if (writeFailure !== undefined) throw writeFailure;
      if (written.length === 0) {
        writeFileSync(join(binDir, FIRST_WRITE_MARKER), '');
      }
      const bytes = typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk;
      written.push(bytes);
      return true;
    });
  });

  afterEach(() => {
    restoreEnv('PATH', savedEnv.PATH);
    restoreEnv('CLAUDE_CODE_ENTRYPOINT', savedEnv.CLAUDE_CODE_ENTRYPOINT);
    mock.restore();
    rmSync(binDir, { recursive: true, force: true });
  });

  it('runs the claude on PATH by default with the arguments and prompt given', async () => {
    process.env['CLAUDE_CODE_ENTRYPOINT'] = 'rafa-test-sentinel';
    standInClaude([
      'for arg in "$@"; do printf \'arg:%s\\n\' "$arg"; done',
      'printf \'entrypoint:%s\\n\' "$CLAUDE_CODE_ENTRYPOINT"',
      'printf \'stdin:\'',
      '/bin/cat',
    ]);

    const session = await runClaudeCaptured(
      'Your scoped task is: measure the thing\nline two',
      UNSORTED_SOURCES,
      UNSORTED_FLAGS,
    );

    expect(session).toEqual({
      exitCode: 0,
      stdout: [
        'arg:-p',
        'arg:--dangerously-skip-permissions',
        'arg:--setting-sources',
        'arg:user,local,project',
        'arg:--effort',
        'arg:low',
        'arg:--agent',
        'arg:doc-updater',
        'entrypoint:cli',
        'stdin:Your scoped task is: measure the thing',
        'line two',
      ].join('\n'),
    });
  });

  it('writes each stdout chunk on to the operator as it arrives', async () => {
    splitCharacterStandIn();

    await runClaudeCaptured('split the character', DEFAULT_SOURCES);

    expect(written.map((chunk) => Array.from(chunk))).toEqual([
      [0x78, 0xe2],
      [0x82, 0xac, 0x79, 0x0a],
    ]);
  });

  it('decodes a character split across two chunks as that character', async () => {
    splitCharacterStandIn();

    const session = await runClaudeCaptured('split the character', DEFAULT_SOURCES);

    expect(Array.from(written[0] ?? [])).toEqual([0x78, 0xe2]);
    expect(session.stdout).toBe(`x${String.fromCodePoint(0x20ac)}y\n`);
  });

  it('answers bytes that are not UTF-8 as replacement characters', async () => {
    standInClaude(['printf \'ok\\n\\377\\342\'']);

    const replacement = String.fromCodePoint(0xfffd);
    await expect(runClaudeCaptured('write a broken tail', DEFAULT_SOURCES))
      .resolves.toEqual({
        exitCode: 0,
        stdout: `ok\n${replacement}${replacement}`,
      });
  });

  it('answers a failing exit code with the output written before it', async () => {
    standInClaude(['printf \'partial report\\n\'', 'exit 3']);

    await expect(runClaudeCaptured('fail after writing', DEFAULT_SOURCES))
      .resolves.toEqual({ exitCode: 3, stdout: 'partial report\n' });
  });

  it('answers a killed session as 128 plus the signal number', async () => {
    standInClaude(['printf \'before the signal\\n\'', 'kill -KILL $$']);

    await expect(runClaudeCaptured('be killed', DEFAULT_SOURCES))
      .resolves.toEqual({ exitCode: 137, stdout: 'before the signal\n' });
  });

  it('waits for the session to exit before rejecting on a failed write', async () => {
    const exited = join(binDir, 'stand-in-exited');
    writeFailure = new Error('operator stdout is gone');
    standInClaude([
      'printf \'first chunk\\n\'',
      '/bin/sleep 0.3',
      `: > '${exited}'`,
    ]);

    await expect(runClaudeCaptured('outlive the reader', DEFAULT_SOURCES))
      .rejects.toThrow('operator stdout is gone');

    expect(existsSync(exited)).toBe(true);
  });
});

/** Every line a json-mode case handed the active output's `info`, in order. */
let infoLines: string[] = [];

/** Every line it handed any other level, tagged by that level. */
let otherLines: string[] = [];

/** When set, the output's `info` throws this instead of recording. */
let infoFailure: Error | undefined;

/**
 * An output recording what it is handed, level by level. Its first
 * `info` line creates the marker a split-character stand-in polls for.
 */
function recordingOutput(): ReturnType<typeof sinkOutput> {
  return sinkOutput({
    info: (message) => {
      if (infoFailure !== undefined) throw infoFailure;
      if (infoLines.length === 0) writeFileSync(join(binDir, FIRST_WRITE_MARKER), '');
      infoLines.push(message);
    },
    warn: (message) => {
      otherLines.push(`warn:${message}`);
    },
    error: (message) => {
      otherLines.push(`error:${message}`);
    },
    debug: (message) => {
      otherLines.push(`debug:${message}`);
    },
  });
}

describe('both doors in json mode, against a stand-in claude on PATH', () => {
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'rafa-claude-stand-in-'));
    savedEnv = {
      PATH: process.env['PATH'],
      CLAUDE_CODE_ENTRYPOINT: process.env['CLAUDE_CODE_ENTRYPOINT'],
    };
    written = [];
    infoLines = [];
    otherLines = [];
    infoFailure = undefined;
    spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      const bytes = typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk;
      written.push(bytes);
      return true;
    });
    setActiveOutput(recordingOutput(), 'json');
  });

  afterEach(() => {
    setActiveOutput(null);
    restoreEnv('PATH', savedEnv.PATH);
    restoreEnv('CLAUDE_CODE_ENTRYPOINT', savedEnv.CLAUDE_CODE_ENTRYPOINT);
    mock.restore();
    rmSync(binDir, { recursive: true, force: true });
  });

  it('hands each line of a captured session to info with its newline off, and writes no byte to stdout', async () => {
    const marker = join(binDir, FIRST_WRITE_MARKER);
    standInClaude([
      'printf \'first line\\n\\nx\\342\'',
      'n=0',
      `while [ ! -e '${marker}' ] && [ "$n" -lt 100 ]; do /bin/sleep 0.01; n=$((n + 1)); done`,
      `if [ -e '${marker}' ]; then printf '\\202\\254y\\nlast words'; else printf 'marker never seen'; fi`,
    ]);

    const session = await runClaudeCaptured('echo as events', DEFAULT_SOURCES);

    const euro = String.fromCodePoint(0x20ac);
    expect(infoLines).toEqual(['first line', '', `x${euro}y`, 'last words']);
    expect(session).toEqual({ exitCode: 0, stdout: `first line\n\nx${euro}y\nlast words` });
    expect(written).toEqual([]);
    expect(otherLines).toEqual([]);
  });

  it('writes the bytes to stdout and hands the output no line when that same output is set in text mode', async () => {
    setActiveOutput(recordingOutput(), 'text');
    standInClaude(['printf \'one line\\nno newline\'']);

    const session = await runClaudeCaptured('the text control', DEFAULT_SOURCES);

    expect(infoLines).toEqual([]);
    expect(Buffer.concat(written).toString('utf8')).toBe('one line\nno newline');
    expect(session.stdout).toBe('one line\nno newline');
  });

  it('spawns runClaude through a pipe, handing its lines to info and answering its exit code', async () => {
    process.env['CLAUDE_CODE_ENTRYPOINT'] = 'rafa-test-sentinel';
    standInClaude([
      'for arg in "$@"; do printf \'arg:%s\\n\' "$arg"; done',
      'printf \'entrypoint:%s\\n\' "$CLAUDE_CODE_ENTRYPOINT"',
      'printf \'stdin:\'',
      '/bin/cat',
      'exit 4',
    ]);

    const exitCode = await runClaude('Preserve progress\nline two', UNSORTED_SOURCES);

    expect(exitCode).toBe(4);
    expect(infoLines).toEqual([
      'arg:-p',
      'arg:--dangerously-skip-permissions',
      'arg:--setting-sources',
      'arg:user,local,project',
      'entrypoint:cli',
      'stdin:Preserve progress',
      'line two',
    ]);
    expect(written).toEqual([]);
    expect(otherLines).toEqual([]);
  });

  it('waits for the session to exit before rejecting on a line the output refuses', async () => {
    const exited = join(binDir, 'stand-in-exited');
    infoFailure = new Error('the event stream is gone');
    standInClaude([
      'printf \'first chunk\\n\'',
      '/bin/sleep 0.3',
      `: > '${exited}'`,
    ]);

    await expect(runClaudeCaptured('outlive the output', DEFAULT_SOURCES))
      .rejects.toThrow('the event stream is gone');

    expect(existsSync(exited)).toBe(true);
  });
});

describe('checkUsage', () => {
  /** Every line a check wrote, tagged by its level. */
  let seen: string[] = [];

  /** `CLAUDE_USAGE_PERCENT` as the case found it. */
  let savedPercent: string | undefined;

  beforeEach(() => {
    seen = [];
    savedPercent = process.env['CLAUDE_USAGE_PERCENT'];
    setActiveOutput(sinkOutput({
      info: (message) => {
        seen.push(`info:${message}`);
      },
      warn: (message) => {
        seen.push(`warn:${message}`);
      },
      error: (message) => {
        seen.push(`error:${message}`);
      },
      debug: (message) => {
        seen.push(`debug:${message}`);
      },
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
    if (savedPercent === undefined) {
      delete process.env['CLAUDE_USAGE_PERCENT'];
    } else {
      process.env['CLAUDE_USAGE_PERCENT'] = savedPercent;
    }
  });

  /** Each reading: what it shows, its context, the percent, whether it pauses, and its one line. */
  const READINGS: readonly (readonly [string, 'issue' | 'task', string, boolean, string])[] = [
    ['pauses a task at 90 or more, through warn', 'task', '95', true, 'warn:\nClaude usage at 95% (>=90%). Pausing after current task to avoid hitting the limit.'],
    ['warns a task at 80 or more without pausing it', 'task', '85', false, 'warn:\nClaude usage at 85% (>=80%). Monitor closely — tasks may be interrupted.'],
    ['warns an issue at 90 or more without pausing it', 'issue', '92', false, 'warn:\nClaude usage at 92% (>=80%). Monitor closely — tasks may be interrupted.'],
    ['warns an issue at 70 or more', 'issue', '75', false, 'warn:\nClaude usage at 75% (>=70%). Consider whether to start the next issue.'],
    ['tells a task under 80 its usage through info', 'task', '75', false, 'info:\nClaude usage: 75%'],
  ];

  it.each(READINGS)('%s', async (_label, context, percent, pauses, line) => {
    process.env['CLAUDE_USAGE_PERCENT'] = percent;

    await expect(checkUsage(context)).resolves.toBe(pauses);

    expect(seen).toEqual([line]);
  });

  it('writes nothing and never pauses when no usage can be read', async () => {
    delete process.env['CLAUDE_USAGE_PERCENT'];

    await expect(checkUsage('task')).resolves.toBe(false);

    expect(seen).toEqual([]);
  });
});
