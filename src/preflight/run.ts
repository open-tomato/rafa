/**
 * The preflight's runner: each prerequisite item checked once, a halt
 * naming every REQUIRED item that failed, and a warning plus a
 * `known-missing:` prompt line for each OPTIONAL one that failed.
 *
 * `prerequisites-md.ts` says which items a run checks; this module
 * checks them and words what each failure means. What the loop does
 * with that is its callers': storing a row per check, stopping
 * `loop start`, appending the lines to a task prompt, and printing the
 * reminders a PREREQUISITES file carries, which are never checked and so
 * are not taken here.
 *
 * ## How an item is checked
 *
 * An item with a `probe` runs it, and nothing else is asked of it: the
 * spec's `service: https://api.github.com` beside `probe: gh auth status`
 * is proved by `gh`, not by a request. An item with no probe checks
 * presence, by its kind:
 *
 *   - `tool`: its name resolves on the `PATH` of the environment handed
 *     in (`Bun.which`). An environment with no `PATH` finds nothing,
 *     because `Bun.which` handed `PATH: undefined` searches this process's
 *     own `PATH` instead (measured on bun 1.3.14).
 *   - `env`: the variable is set, and to a string that is not empty.
 *   - `service`: the URL answers a `HEAD` request within the timeout. Any
 *     status is an answer, and a redirect is one too, never followed: the
 *     question is whether the service is reachable, not whether it takes
 *     this request.
 *   - `lsp`: `<name>-language-server` resolves on that `PATH`.
 *
 * Every item is checked, in order: the required tier, then the optional
 * one, one at a time. A failed required item does not stop the checks
 * after it, so a report, and the store's rows, hold every item, and one
 * halt names all that failed.
 *
 * ## How a probe runs
 *
 * {@link runShellProbe} runs `/bin/sh -c <probe>` in the directory and
 * the environment handed in. Each rule below was measured on bun 1.3.14.
 *
 *   - **stdin is closed.** It is `ignore`, which is `/dev/null`: `cat`
 *     exits 0 at once and `read` answers 1. A probe waiting for input
 *     reads end of file, and one that opens a terminal of its own waits
 *     for the timeout.
 *   - **The shell is named by its absolute path.** Bun looks a bare
 *     command up on the `PATH` handed to the child, and throws when it
 *     is not there (`Executable not found in $PATH: "sh"`).
 *   - **The timeout kills the probe's process group.** The shell leads a
 *     group of its own (`detached`), and at the deadline the group gets
 *     SIGKILL. Killing the shell alone is not enough: of `sleep 3; true`,
 *     the read of stderr waited 3 seconds for the `sleep` still holding
 *     the pipe, where the group kill ended it in 104 ms. A killed probe
 *     answers 128 plus the signal, 137 for SIGKILL.
 *   - **The deadline also stops reading stderr**, keeping what was read,
 *     so no process can hold the loop past it. A grandchild in a session
 *     of its own is outside the group: it held stderr after its shell
 *     exited, the group kill answered `ESRCH`, and cancelling the reader
 *     ended the read at the deadline.
 *   - **stdout is ignored.** A failure is named by its exit code and its
 *     stderr.
 *
 * A probe TIMED OUT when the deadline found its shell still running. A
 * shell that exited in time is judged on its exit code, even when
 * something it left behind held stderr until the deadline.
 *
 * The timeout is {@link PROBE_TIMEOUT_MS}, 30 seconds, and a seam: a
 * service request is held to it too.
 *
 * ## What a failure answers
 *
 * A check that did not pass carries its `failure`, which names what was
 * checked and how it went:
 *
 *   - A probe: ``probe `bun --version` exited 127``, followed by `: ` and
 *     the first line of stderr that is not blank, when there is one. The
 *     spec asks for the exit code or that line; both are given when both
 *     exist, since neither alone says what the other does. A probe that
 *     timed out `timed out after 30s and was killed (exit 137)`, and one
 *     whose shell could not be started `could not be run`.
 *   - A presence check: `presence check: ` and what was missing.
 *
 * The halt opens with how many required items failed, then gives one
 * line per item, its kind and quoted name before its failure:
 *
 *     preflight halted: 1 required item failed
 *       tool "bun": probe `bun --version` exited 127: sh: bun: not found
 *
 * An optional failure is written through `warn` as it is found, and adds
 * the prompt line `known-missing: <name>`, followed by ` (<reason>)` when
 * the item gives one: `known-missing: mgrep (faster search; grep is the
 * fallback)`. Each run of whitespace in the name or the reason is one
 * space there, so the line stays one line.
 */
import type { PreflightItems } from './prerequisites-md.js';
import type { OptionalPrerequisiteItem, PrerequisiteItem } from '../config.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';

/** How long a probe, or a service request, may take: 30 seconds. */
export const PROBE_TIMEOUT_MS = 30_000;

/** The shell a probe runs through, by absolute path; see the module note. */
const SHELL = '/bin/sh';

/** The tier an item was configured on. */
export type PreflightTier = 'required' | 'optional';

/** How one check went: `timeout` is a failure that ran out of time. */
export type CheckOutcome = 'pass' | 'fail' | 'timeout';

/** The environment a check reads and a probe runs in. */
export type PreflightEnv = Readonly<Record<string, string | undefined>>;

/** What one probe run answered. */
export interface ProbeRun {
  /** The shell's exit code, 128 plus the signal when killed; null when it never started. */
  readonly exitCode: number | null;
  /** What it wrote to stderr before it ended, or why it could not start. */
  readonly stderr: string;
  /** True when the deadline found the shell still running. */
  readonly timedOut: boolean;
}

/** Where, and for how long, a probe runs. */
export interface ProbeOptions {
  readonly cwd: string;
  readonly env: PreflightEnv;
  readonly timeoutMs: number;
}

/** Runs one probe; {@link runShellProbe} is the real one. Never rejects for a failing probe. */
export type ProbeRunner = (probe: string, options: ProbeOptions) => Promise<ProbeRun>;

/** The request a service presence check sends. */
export interface ServiceRequestInit {
  readonly method: 'HEAD';
  readonly redirect: 'manual';
  readonly signal: AbortSignal;
}

/** Sends one HTTP request, as `fetch` does; any response is an answer. */
export type ServiceRequester = (url: string, init: ServiceRequestInit) => Promise<unknown>;

/** One item, checked. */
export interface PreflightCheck {
  readonly tier: PreflightTier;
  readonly item: PrerequisiteItem;
  readonly outcome: CheckOutcome;
  /** How long the check took, in whole milliseconds. */
  readonly durationMs: number;
  /** What failed, as the halt and the warning word it; null for a pass. */
  readonly failure: string | null;
}

/** What a preflight found. */
export interface PreflightReport {
  /** Every check, the required tier first, each tier in its order. */
  readonly checks: readonly PreflightCheck[];
  /** The halt naming every failed required item, or null when none failed. */
  readonly halt: string | null;
  /** One `known-missing:` line per failed optional item, in order. */
  readonly knownMissing: readonly string[];
}

/** The two tiers a preflight checks; a {@link PreflightItems} is one. */
export type PreflightTiers = Pick<PreflightItems, 'required' | 'optional'>;

/** What a preflight runs with. Everything past `cwd` is a seam. */
export interface PreflightOptions {
  /** The directory each probe runs in. */
  readonly cwd: string;
  /** What checks read and probes run with. `process.env` when left out. */
  readonly env?: PreflightEnv;
  /** {@link PROBE_TIMEOUT_MS} when left out. */
  readonly timeoutMs?: number;
  /** {@link runShellProbe} when left out. */
  readonly runProbe?: ProbeRunner;
  /** `fetch` when left out. */
  readonly request?: ServiceRequester;
  /** Where an optional failure is written. The active output's `warn` when left out. */
  readonly warn?: (message: string) => void;
  /** A clock in milliseconds. `performance.now` when left out. */
  readonly now?: () => number;
}

/** {@link PreflightOptions} with every seam filled. */
type PreflightContext = Required<PreflightOptions>;

/** A check's result before it is timed. */
type Verdict = Pick<PreflightCheck, 'outcome' | 'failure'>;

/** The verdict of every check that passed. */
const PASS: Verdict = Object.freeze({ outcome: 'pass', failure: null });

/** Spawns the shell running `probe`; see the module note. */
function spawnShell(probe: string, options: ProbeOptions) {
  return Bun.spawn([SHELL, '-c', probe], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    detached: true,
  });
}

/** A probe's shell, as {@link spawnShell} answers it. */
type ShellProcess = ReturnType<typeof spawnShell>;

/** True for the error `kill` throws when no process is left to signal. */
function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

/**
 * Sends SIGKILL to the process group `proc` leads. A group with no
 * process left is no error; any other refusal falls back to the shell.
 */
function killGroup(proc: ShellProcess): void {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch (error) {
    if (!isNoSuchProcess(error)) proc.kill('SIGKILL');
  }
}

/** A stream being read to its end, and the call that stops reading it early. */
interface Collected {
  readonly text: Promise<string>;
  readonly stop: () => void;
}

/** Reads `stream` to its end, or until `stop`, keeping what was read. */
function collect(stream: ReadableStream<Uint8Array>): Collected {
  const reader = stream.getReader();
  const read = async (): Promise<string> => {
    const chunks: Uint8Array[] = [];
    let next = await reader.read();
    while (!next.done) {
      chunks.push(next.value);
      next = await reader.read();
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  // A cancel that rejects leaves a stream errored, and the read above
  // rejects with that error, so the rejection is not lost by ignoring it here.
  const stop = () => {
    reader.cancel().catch(() => undefined);
  };
  return { text: read(), stop };
}

/**
 * Runs `probe` through `/bin/sh` in `options.cwd` with stdin closed,
 * killing its process group at the timeout; see the module note. A probe
 * that fails, times out or cannot start answers so, and never rejects.
 */
export async function runShellProbe(probe: string, options: ProbeOptions): Promise<ProbeRun> {
  let proc: ShellProcess;
  try {
    proc = spawnShell(probe, options);
  } catch (error) {
    const stderr = `could not run ${SHELL} in ${options.cwd}: ${messageOf(error)}`;
    return Object.freeze({ exitCode: null, stderr, timedOut: false });
  }

  const stderr = collect(proc.stderr);
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = proc.exitCode === null && proc.signalCode === null;
    killGroup(proc);
    stderr.stop();
  }, options.timeoutMs);

  try {
    const exitCode = await proc.exited;
    const text = await stderr.text;
    return Object.freeze({ exitCode, stderr: text, timedOut });
  } finally {
    clearTimeout(deadline);
  }
}

/** A duration as a failure names it: `30s`, `0.2s`. */
function secondsOf(timeoutMs: number): string {
  return `${timeoutMs / 1000}s`;
}

/** The first line of `stderr` that is not blank, trimmed; or null. */
function firstLineOf(stderr: string): string | null {
  const line = stderr
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  return line ?? null;
}

/** How a probe run that did not pass ended, as its failure words it. */
function endingOf(run: ProbeRun, timeoutMs: number): string {
  if (run.timedOut) return `timed out after ${secondsOf(timeoutMs)} and was killed (exit ${run.exitCode})`;
  if (run.exitCode === null) return 'could not be run';
  return `exited ${run.exitCode}`;
}

/** The verdict on one probe run; see the module note. */
function probeVerdict(probe: string, run: ProbeRun, timeoutMs: number): Verdict {
  if (run.exitCode === 0 && !run.timedOut) return PASS;
  const line = firstLineOf(run.stderr);
  const stated = `probe \`${probe}\` ${endingOf(run, timeoutMs)}`;
  const failure = line === null
    ? stated
    : `${stated}: ${line}`;
  const outcome = run.timedOut
    ? 'timeout'
    : 'fail';
  return Object.freeze({ outcome, failure });
}

/** A failed presence check's verdict. */
function missing(outcome: 'fail' | 'timeout', what: string): Verdict {
  return Object.freeze({ outcome, failure: `presence check: ${what}` });
}

/** Whether `command` resolves on the context's `PATH`; see the module note. */
function onPath(command: string, context: PreflightContext): Verdict {
  const found = Bun.which(command, { PATH: context.env.PATH ?? '', cwd: context.cwd });
  return found === null
    ? missing('fail', `${command} is not on PATH`)
    : PASS;
}

/** Whether the variable `name` is set and not empty. */
function envSet(name: string, context: PreflightContext): Verdict {
  const value = context.env[name];
  if (value === undefined) return missing('fail', `${name} is not set`);
  if (value === '') return missing('fail', `${name} is set but empty`);
  return PASS;
}

/** Whether `url` answers a `HEAD` request within the timeout. */
async function serviceAnswers(url: string, context: PreflightContext): Promise<Verdict> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, context.timeoutMs);
  try {
    await context.request(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
    return PASS;
  } catch (error) {
    if (controller.signal.aborted) {
      return missing('timeout', `${url} did not answer within ${secondsOf(context.timeoutMs)}`);
    }
    return missing('fail', `${url} did not answer: ${messageOf(error)}`);
  } finally {
    clearTimeout(deadline);
  }
}

/** The presence check for an item with no probe; see the module note. */
async function presenceVerdict(item: PrerequisiteItem, context: PreflightContext): Promise<Verdict> {
  switch (item.kind) {
    case 'tool': return onPath(item.name, context);
    case 'env': return envSet(item.name, context);
    case 'service': return serviceAnswers(item.name, context);
    case 'lsp': return onPath(`${item.name}-language-server`, context);
  }
}

/** Checks one item, timed. */
async function checkItem(
  tier: PreflightTier,
  item: PrerequisiteItem,
  context: PreflightContext,
): Promise<PreflightCheck> {
  const started = context.now();
  const verdict = item.probe === null
    ? await presenceVerdict(item, context)
    : probeVerdict(item.probe, await context.runProbe(item.probe, context), context.timeoutMs);
  const durationMs = Math.max(0, Math.round(context.now() - started));
  return Object.freeze({ tier, item, outcome: verdict.outcome, durationMs, failure: verdict.failure });
}

/** An item as the halt and the warning name it: `tool "bun"`. */
function labelOf(item: PrerequisiteItem): string {
  return `${item.kind} ${JSON.stringify(item.name)}`;
}

/** `text` on one line, each run of whitespace one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The prompt line naming a failed optional item; see the module note. */
function knownMissingLine(item: OptionalPrerequisiteItem): string {
  const reason = item.reason === null
    ? ''
    : ` (${oneLine(item.reason)})`;
  return `known-missing: ${oneLine(item.name)}${reason}`;
}

/** The warning for a failed optional item. */
function warningOf(check: PreflightCheck): string {
  return `preflight: optional item ${labelOf(check.item)} failed: ${check.failure}; `
    + 'the run goes on, and each task prompt names it known-missing';
}

/** The halt naming every failed required check, or null when there is none. */
function haltOf(failed: readonly PreflightCheck[]): string | null {
  if (failed.length === 0) return null;
  const noun = failed.length === 1
    ? 'item'
    : 'items';
  const lines = failed.map((check) => `  ${labelOf(check.item)}: ${check.failure}`);
  return [`preflight halted: ${failed.length} required ${noun} failed`, ...lines].join('\n');
}

/** Writes one warning through the active output. */
function warnThroughActiveOutput(message: string): void {
  activeOutput().warn(message);
}

/** The options with every seam left out filled in. */
function contextOf(options: PreflightOptions): PreflightContext {
  return {
    cwd: options.cwd,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
    runProbe: options.runProbe ?? runShellProbe,
    request: options.request ?? ((url, init) => fetch(url, init)),
    warn: options.warn ?? warnThroughActiveOutput,
    now: options.now ?? (() => performance.now()),
  };
}

/**
 * Checks every item of `items`, the required tier first, and answers
 * the report; see the module note. An optional failure is written through
 * `warn` as it is found. Nothing handed in is written to, and the report
 * and its lists are frozen.
 */
export async function runPreflight(
  items: PreflightTiers,
  options: PreflightOptions,
): Promise<PreflightReport> {
  const context = contextOf(options);
  const checks: PreflightCheck[] = [];
  const knownMissing: string[] = [];

  for (const item of items.required) {
    checks.push(await checkItem('required', item, context));
  }
  for (const item of items.optional) {
    const check = await checkItem('optional', item, context);
    checks.push(check);
    if (check.outcome === 'pass') continue;
    context.warn(warningOf(check));
    knownMissing.push(knownMissingLine(item));
  }

  const failed = checks.filter((check) => check.tier === 'required' && check.outcome !== 'pass');
  return Object.freeze({
    checks: Object.freeze(checks),
    halt: haltOf(failed),
    knownMissing: Object.freeze(knownMissing),
  });
}
