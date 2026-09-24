/**
 * Spawning a Claude session, and reading how much of the plan's budget
 * has gone.
 *
 * {@link runClaude} is the loop's door onto the CLI for a session whose
 * output only the operator reads. It has two call sites: the wrap-up
 * session in `start/wrap-up.ts` and the CI-repair session in
 * `start/pr-lifecycle.ts`, neither of which is routed — one model, one
 * effort, every tool. So the flags are a parameter with an EMPTY
 * default: `runClaude(prompt, settingSources)` spawns the base
 * arguments and the setting sources, and nothing a declaration could
 * add.
 *
 * {@link runClaudeCaptured} is the door for a session whose output the
 * LOOP reads as well. It has three callers: the per-task dispatch,
 * through `runTaskSession` in `start/dispatch.ts`, the backfill
 * proposal pass in `backfill/propose.ts`, and plan generation in the
 * `claude` planner, `adapters/planner/claude.ts`, which `plan.ts`
 * makes. Each of the three parses what its session wrote: a task
 * session ends its final message with a `rafa:report` block, a plan
 * session ends its final message with a `rafa:spec-review` one, and a
 * proposal session's answer goes through `parseSessionAnswer`.
 * {@link spawnClaude} answers the exit code alone, so a loop holding
 * that session's exit code holds nothing else. A task session's flags are
 * the ones its routing declaration resolved to, with the
 * `--session-id` the loop picked for that session ahead of them, and
 * the planner hands over none. The captured entry builds its argument
 * list through the same {@link claudeArgs} and hands the prompt over the
 * same way; only the spawner differs, {@link spawnClaudeCaptured} piping
 * stdout, echoing it on to the operator as it arrives and keeping the
 * same bytes for the answer. It sits BESIDE `runClaude` rather than
 * replacing its spawner, so in text mode a session nothing parses keeps
 * spawning exactly what it spawned before. What json mode changes is in
 * the section "What reaches the operator" below.
 *
 * The search runner (`inventory/search/index.ts`) captures its one
 * session through the same spawner without going through
 * `runClaudeCaptured`: it builds its argument list with
 * {@link claudeArgs} and hands the spawner the one option no other
 * caller passes, {@link CapturedSpawnOptions.cwd}, since that session
 * runs inside the scratch copy of its candidates.
 *
 * The flags land AFTER {@link CLAUDE_BASE_ARGS} and the setting sources
 * rather than before, and the ordering is load-bearing rather than
 * cosmetic. `--tools` is
 * VARIADIC in the CLI's own help (`--tools <tools...>`), so it keeps
 * consuming tokens until one that starts with a dash. `--tools` is the
 * LAST flag `resolveDeclarationFlags` emits, and the resolved flags are
 * the last thing appended here, so its value is the final element of
 * the argument list with nothing after it to be swallowed. Putting the
 * resolved flags FIRST would put `-p` behind that variadic, which is
 * the one arrangement that breaks. `-p` itself takes no value
 * (`-p, --print` is a boolean in the same help text), so nothing after
 * it is at risk either.
 *
 * ## Setting sources
 *
 * Every session, through either door, is spawned with
 * {@link SETTING_SOURCES_FLAG} naming the run's `loop.settingSources`
 * (`config.ts`), `project,local` unless a config names others. Finding
 * 3 of `.rafa/specs/phase-1-installable.md` measured the user scope at about
 * 14,900 tokens of a 58,989-token turn. The sources are a REQUIRED
 * parameter of {@link claudeArgs} and of both doors. A default here
 * would be a second one beside `CONFIG_DEFAULTS`, and a caller that
 * forgot to hand on the value its config resolved to would spawn under
 * that default with nothing to say so; with no default, that caller
 * does not compile.
 *
 * They go between the base arguments and the flags. The CLI's help, on
 * Claude Code 2.1.268, lists `--setting-sources <sources>` as one
 * comma-separated value where `--tools <tools...>` is variadic, so the
 * sources swallow nothing and `--tools` stays last. What they change is
 * measurable without a model call: an `--agent` name no scope defines
 * exits 1 and lists the agents it could have run. That list held this
 * repo's `.claude/agents` and none of `~/.claude/agents` under
 * `project,local`, both under `user,project,local`, and neither under
 * `local`.
 *
 * The prompt goes on STDIN and never into the argument list. That is
 * not a style choice: a plan's task prompt here is the injected
 * instructions plus `PROMPT.md` plus the plan, the whole file under the
 * `full` injection mode and in every wrap-up prompt, which is far past
 * what an argument list can carry, and an argument list is also
 * visible to every `ps` on the machine.
 *
 * {@link ClaudeSpawner} exists because the real spawn is
 * `Bun.spawn` and the root suite runs vitest under NODE — measured,
 * `globalThis.Bun` is `undefined` and `process.versions.bun` is null
 * in that runtime. So the default spawner cannot be driven from a test
 * at all, and the seam is what makes the argument list an assertion
 * rather than something inferred from a session that appeared to work.
 *
 * getClaudeUsagePercent returns current API consumption as 0–100, or null if
 * unavailable. Override via CLAUDE_USAGE_PERCENT env var for testing or manual
 * control. A real data source (Anthropic billing API, CLI flag, or injected
 * env var) should be wired in once reliably identified.
 *
 * ## What reaches the operator
 *
 * A session's stdout reaches the operator in the mode of the active
 * output (`adapters/output/active.ts`). In text mode it is the bytes the
 * session wrote, in the order it wrote them: {@link spawnClaude} inherits
 * the stream, and {@link spawnClaudeCaptured} writes each chunk to
 * `process.stdout` as it arrives. In json mode those bytes would put
 * lines no NDJSON reader parses among the events, so neither door lets
 * them through. {@link spawnClaudeCaptured} hands each line, its newline
 * off, to the active output's `info`, which the `json` adapter writes as
 * one `log` event. {@link spawnClaude} spawns through
 * {@link spawnClaudeCaptured} and answers its exit code alone. A last
 * line with no newline goes once stdout closes, and a blank line is an
 * event with an empty message, so the messages joined with newlines are
 * the session's stdout. The argument list, the prompt, the environment
 * and the inherited stderr are the same in both modes.
 *
 * The environment is `sessionSpawnEnv(process.env)` at both doors
 * (`session-env.ts`), the one function a reading of the session's
 * environment calls too, so neither door spells an entry of its own.
 * That puts the running entry's `bundled/bin` at the front of every
 * session's `PATH`.
 *
 * ## Interrupting a running session
 *
 * Both doors hold the process they spawn among the live sessions until it
 * has exited, and {@link interruptClaudeSessions} sends each of those
 * SIGINT. `loop start` calls it from its own SIGINT handler (`src/start.ts`).
 * A terminal's Ctrl-C reaches the loop and its session at once, as one
 * process group, but `rafa loop stop` signals the loop's pid alone, and a
 * signal to that pid never reaches the session. Measured on 2026-09-15 by
 * spawning `loop start` over a stand-in `claude` sleeping 20 seconds: a
 * SIGINT to the loop's pid ended the run after 20.06 s, once the session
 * had run to its own end, and one to its process group after 0.03 s.
 *
 * A signalled session has ended once its process exits, but the captured
 * door reads the session's stdout to its end first, and a process the
 * session left behind holding that stdout keeps it open. Measured on
 * 2026-09-15 with a stand-in that trapped SIGINT and exited 130 while a
 * sleep it had put in the background held the pipe: `rafa loop stop` took
 * 19.9 s, ending when the sleep did, against 0.28 s with the sleep's output
 * sent to `/dev/null`. Both doors answered 130 for a stand-in the signal
 * ended, under bun 1.3.14.
 *
 * {@link checkUsage} writes through the active output too: each warning
 * through `warn`, and the usage it read through `info`.
 *
 * ## The spend guard
 *
 * Both doors refuse to start a session for a running command whose
 * `spends` declaration (`src/cli/spends.ts`) does not cover the run. The
 * running command is the one the dispatcher recorded with its parsed
 * flags (`src/cli/running.ts`). The check runs once per session, before
 * `Bun.spawn`, so a refused run starts no process: {@link spawnClaude}
 * in json mode hands its session to the same unguarded spawner
 * {@link spawnClaudeCaptured} uses rather than to that door, and so is
 * not checked a second time.
 *
 * A run is covered when its command declares `always` or `through`, a
 * `with` declaration and the run carries the flag, or an `unless`
 * declaration and the run does not. `through` covers a run because the
 * command runs another's action in-process (`rafa next`,
 * `src/next/actions.ts`), and the recorded command stays the outer one.
 * A flag is matched by its name without the dashes, and `--no-<name>`
 * also as the parser keys it, `<name>` set to `false`; a flag recorded
 * as `false` is not carried. With no command recorded, as for a caller
 * that never went through the dispatcher, nothing is refused.
 *
 * A refusal throws {@link UndeclaredSpendError}, whose message names
 * the command as typed after `rafa` and says to declare `spends` on it,
 * with the flag missing for a `with` form and the flag present for an
 * `unless` one. Thrown from a command's `run`, it ends the invocation as
 * `command_error` with exit 1 (`src/cli/dispatch.ts`).
 */
import type { RunningCommand } from '../cli/running.js';
import type { ClaudeSettingSource } from '../config.js';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { commandSpelling } from '../cli/command.js';
import { runningCommand } from '../cli/running.js';

import { sessionSpawnEnv } from './session-env.js';

export async function getClaudeUsagePercent(): Promise<number | null> {
  const envPct = process.env['CLAUDE_USAGE_PERCENT'];
  if (envPct !== undefined) {
    const pct = Number(envPct);
    return Number.isFinite(pct)
      ? Math.max(0, Math.min(100, pct))
      : null;
  }
  return null;
}

/**
 * Checks current Claude usage and warns / signals a pause.
 *
 * context 'issue' — called before starting a new issue. Warns at ≥70%.
 * context 'task'  — called between ralph tasks. Warns at ≥80%, returns true
 *                   (pause signal) at ≥90%.
 *
 * Returns true if the caller should stop its current loop iteration.
 */
export async function checkUsage(context: 'issue' | 'task'): Promise<boolean> {
  const pct = await getClaudeUsagePercent();
  if (pct === null) return false;

  if (context === 'task' && pct >= 90) {
    activeOutput().warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=90%). Pausing after current task to avoid hitting the limit.`,
    );
    return true;
  }
  if (pct >= 80) {
    activeOutput().warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=80%). Monitor closely — tasks may be interrupted.`,
    );
  } else if (context === 'issue' && pct >= 70) {
    activeOutput().warn(
      `\nClaude usage at ${pct.toFixed(0)}% (>=70%). Consider whether to start the next issue.`,
    );
  } else {
    activeOutput().info(`\nClaude usage: ${pct.toFixed(0)}%`);
  }
  return false;
}

/**
 * The executable every session is spawned as.
 *
 * Resolved on PATH rather than by absolute path, which is what lets a
 * version manager or a shim answer for it.
 */
export const CLAUDE_BIN = 'claude';

/**
 * Arguments every session gets, before any resolved flag.
 *
 * `-p` prints and exits, which is what makes the session
 * non-interactive; `--dangerously-skip-permissions` is what lets it
 * run unattended. Neither is a task's to choose, so neither is
 * reachable from a declaration.
 */
export const CLAUDE_BASE_ARGS: readonly string[] = [
  '-p',
  '--dangerously-skip-permissions',
];

/**
 * The flag every session names its setting sources with. See the
 * module note.
 */
export const SETTING_SOURCES_FLAG = '--setting-sources';

/**
 * Builds the argument list for one session: the base arguments, the
 * setting sources, the served flags, then the flags.
 *
 * `settingSources` is the run's resolved `loop.settingSources`, joined
 * with commas in the order given. `config.ts` has already refused a
 * source the CLI does not name, a repeat and an empty list, so nothing
 * is checked again here.
 *
 * `flags` is whatever a task's declaration resolved to, already
 * validated and already ordered by its own resolver. Nothing is
 * reordered, deduped or filtered here: this module has no opinion on
 * which flags are legal, and one that did would be a second authority
 * for a decision `utils/declaration.ts` already makes.
 *
 * `served` is `ServedSet.flags` from `serveResolution`
 * (`src/tiers/serve.ts`), the session-only flags handing the run's
 * served directory over, and is taken as it is for the same reason.
 * It defaults to empty, so a caller that serves nothing spawns what it
 * spawned before. It goes BEFORE `flags`, never after: `--tools` has to
 * stay the last element (see the module note), and the served flags
 * are safe ahead of the resolved ones, since `serve.ts` ends them with
 * `--agents <json>` when an agent is served and every resolved flag
 * starts with a dash, which is where the variadic `--add-dir` stops.
 */
export function claudeArgs(
  settingSources: readonly ClaudeSettingSource[],
  flags: readonly string[] = [],
  served: readonly string[] = [],
): string[] {
  return [...CLAUDE_BASE_ARGS, SETTING_SOURCES_FLAG, settingSources.join(','), ...served, ...flags];
}

/**
 * Runs `claude` with an argument list and a prompt on stdin, and
 * answers the exit code.
 *
 * The seam every test drives, since the default {@link spawnClaude}
 * cannot run under the root suite's runtime.
 */
export type ClaudeSpawner = (
  args: readonly string[],
  prompt: string,
) => Promise<number>;

/** A spawned session, as {@link interruptClaudeSessions} reaches it. */
interface LiveSession {
  kill(signal: 'SIGINT'): void;
}

/** The sessions either door spawned and has not yet seen exit. */
const liveSessions = new Set<LiveSession>();

/**
 * Sends SIGINT to every session either door spawned and has not yet seen
 * exit, and answers how many that is. A process that exited before its
 * door saw it is signalled too, which does nothing: measured under bun
 * 1.3.14, `kill` on a subprocess that has exited throws nothing. See the
 * module note.
 */
export function interruptClaudeSessions(): number {
  for (const session of liveSessions) session.kill('SIGINT');
  return liveSessions.size;
}

/**
 * Refused to start a session: the running command's `spends` declaration
 * does not cover this run. See "The spend guard" in the module note.
 */
export class UndeclaredSpendError extends Error {
  override readonly name = 'UndeclaredSpendError';
}

/**
 * True when `flags` carry `flag`, written as typed with its dashes: its
 * name is recorded as anything but `false`, or, for a `--no-<name>`
 * flag, `<name>` is recorded as `false`, which is how the parser keys it.
 */
export function carriesFlag(flags: RunningCommand['flags'], flag: string): boolean {
  const name = flag.replace(/^--/, '');
  const value = flags[name];
  if (value !== undefined && value !== false) return true;
  return name.startsWith('no-') && flags[name.slice(3)] === false;
}

/**
 * Why `running` may not start a session, as a sentence, or null when
 * its declaration covers the run or nothing is recorded.
 */
export function spendRefusal(running: RunningCommand | null): string | null {
  if (running === null) return null;
  const { command, flags } = running;
  const spend = command.spends;
  const named = `rafa ${commandSpelling(command)}`;
  const remedy = 'declare spends on the command to cover this run';
  if (spend === undefined) {
    return `${named} started a Claude session but declares no spends: ${remedy}`;
  }
  if (spend.when === 'with' && !carriesFlag(flags, spend.flag)) {
    return `${named} started a Claude session without ${spend.flag}, and its spends covers only a run with ${spend.flag}: ${remedy}`;
  }
  if (spend.when === 'unless' && carriesFlag(flags, spend.flag)) {
    return `${named} started a Claude session with ${spend.flag}, and its spends covers no run with ${spend.flag}: ${remedy}`;
  }
  return null;
}

/** Throws {@link UndeclaredSpendError} when the running command may not start a session. */
function guardSpend(): void {
  const refusal = spendRefusal(runningCommand());
  if (refusal !== null) throw new UndeclaredSpendError(refusal);
}

/**
 * The real spawner: `Bun.spawn`, streams inherited so the session's
 * output reaches the operator as it happens.
 *
 * In json mode it spawns through {@link spawnClaudeCaptured} instead and
 * answers that session's exit code, so the session's stdout reaches the
 * operator as `log` events and never as bytes among them; see the module
 * note.
 *
 * An exit code of `undefined` — which is what a signalled process
 * answers — is reported as 1, because every caller here treats a
 * non-zero as a failed session and a killed one is not a success.
 *
 * Rejects with {@link UndeclaredSpendError}, spawning nothing, when the
 * running command's `spends` does not cover the run; see the module note.
 */
export async function spawnClaude(
  args: readonly string[],
  prompt: string,
): Promise<number> {
  guardSpend();
  if (activeOutputMode() === 'json') {
    const { exitCode } = await spawnCaptured(args, prompt);
    return exitCode;
  }
  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdin: new TextEncoder().encode(prompt),
    stdout: 'inherit',
    stderr: 'inherit',
    env: sessionSpawnEnv(process.env),
  });
  liveSessions.add(proc);
  try {
    return (await proc.exited) ?? 1;
  } finally {
    liveSessions.delete(proc);
  }
}

/**
 * Spawns one Claude session with `prompt` on stdin, loading settings
 * from `settingSources`.
 *
 * `flags` defaults to empty, so plan generation, the wrap-up and the
 * CI-repair session, which hand over none, cannot be routed by
 * accident: each spawns the base arguments and its setting sources
 * alone. `settingSources` has no default; see the module note.
 */
export function runClaude(
  prompt: string,
  settingSources: readonly ClaudeSettingSource[],
  flags: readonly string[] = [],
  spawn: ClaudeSpawner = spawnClaude,
): Promise<number> {
  return spawn(claudeArgs(settingSources, flags), prompt);
}

/**
 * What a captured session answers: its exit code, and everything it
 * wrote to stdout, decoded as UTF-8.
 */
export interface CapturedSession {
  readonly exitCode: number;
  readonly stdout: string;
}

/**
 * Where a captured session runs. Every field is optional, and an empty
 * object spawns exactly what no options spawn.
 */
export interface CapturedSpawnOptions {
  /**
   * The session's working directory, or the loop's own when absent. The
   * search session (`src/inventory/search/index.ts`) is the one caller
   * that names one: it runs inside the scratch copy of its candidates.
   */
  readonly cwd?: string;
}

/**
 * Runs `claude` with an argument list and a prompt on stdin, and
 * answers the exit code together with the session's stdout.
 *
 * A seam of its own rather than a widened {@link ClaudeSpawner}:
 * widening that one would change what every existing `runClaude`
 * double has to answer, for sessions whose output nothing reads. The
 * third parameter is optional for the same reason: a double written
 * for `(args, prompt)` is still a `CapturingSpawner`.
 */
export type CapturingSpawner = (
  args: readonly string[],
  prompt: string,
  options?: CapturedSpawnOptions,
) => Promise<CapturedSession>;

/**
 * Hands each whole line of `text` to `write`, its newline off, and
 * answers what follows the last newline, which is no line yet.
 */
function writeWholeLines(text: string, write: (line: string) => void): string {
  const lines = text.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) write(line);
  return rest;
}

/**
 * Echoes each chunk of `stream` on to the operator as it arrives, and
 * answers all of them decoded as one string.
 *
 * The mode is read once, before the first chunk, off the active output
 * (`adapters/output/active.ts`). In text mode each chunk is written to
 * `process.stdout` as its bytes. In json mode nothing is: each line the
 * decoded text completes goes to that output's `info`, and what follows
 * the last newline goes once the stream ends, unless it is empty. See
 * the module note.
 */
async function teeToOperator(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  const jsonOutput = activeOutputMode() === 'json'
    ? activeOutput()
    : null;
  const writeLine = (line: string): void => {
    jsonOutput?.info(line);
  };
  let text = '';
  let pending = '';
  for await (const chunk of stream) {
    if (jsonOutput === null) process.stdout.write(chunk);
    const decoded = decoder.decode(chunk, { stream: true });
    text += decoded;
    if (jsonOutput !== null) pending = writeWholeLines(pending + decoded, writeLine);
  }
  const tail = decoder.decode();
  if (jsonOutput !== null) {
    const rest = writeWholeLines(pending + tail, writeLine);
    if (rest !== '') writeLine(rest);
  }
  return text + tail;
}

/**
 * The capturing spawner: `Bun.spawn` with stdout PIPED, each chunk
 * written on to the operator's stdout as it arrives and kept for the
 * answer.
 *
 * Everything else matches {@link spawnClaude}: the executable, the
 * prompt on stdin, the environment. The working directory is the
 * loop's own unless `options.cwd` names another; {@link spawnClaude}
 * never names one. Stderr stays inherited, so the
 * operator sees it and the capture never holds it, and a report parsed
 * out of `stdout` cannot have been a warning line.
 *
 * The bytes go through ONE streaming `TextDecoder`, never a decode per
 * chunk, because a pipe read can end inside a character. Measured on
 * bun 1.3.14, a `€` written in two halves arrived as the chunks
 * `78 e2` and `82 ac 79`; decoded chunk by chunk that is three U+FFFD
 * replacement characters where the streaming decoder answers the `€`.
 * The decoder is not `fatal`, so bytes that are not UTF-8 at all
 * become U+FFFD rather than a rejection.
 *
 * The answer waits for stdout to CLOSE as well as for the exit, which
 * is what reading a pipe to its end means: a process the session left
 * behind that still holds the pipe holds the answer too. Measured, a
 * shell that backgrounded a `sleep 1.5` exited at 17ms and closed its
 * stdout at 1,530ms.
 *
 * A signalled session needs no fallback here. Measured on bun 1.3.14,
 * `exited` answers 128 plus the signal number (137 for a SIGKILL)
 * while `exitCode` is null, so a killed session is already a non-zero,
 * which every caller reads as a failure.
 *
 * When a write to the operator throws, the call rejects with that
 * error, but only once the session has EXITED. Stopping the read does
 * not stop the process: measured, a shell writing into a pipe whose
 * reader had quit kept running, each write failing with `Broken pipe`,
 * until it was killed 3s later. Rejecting at once would hand the loop
 * back a tree that a session is still changing.
 *
 * Rejects with {@link UndeclaredSpendError}, spawning nothing, when the
 * running command's `spends` does not cover the run; see the module note.
 */
export async function spawnClaudeCaptured(
  args: readonly string[],
  prompt: string,
  options: CapturedSpawnOptions = {},
): Promise<CapturedSession> {
  guardSpend();
  return spawnCaptured(args, prompt, options);
}

/** {@link spawnClaudeCaptured} past its guard, which both doors spawn through. */
async function spawnCaptured(
  args: readonly string[],
  prompt: string,
  options: CapturedSpawnOptions = {},
): Promise<CapturedSession> {
  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdin: new TextEncoder().encode(prompt),
    stdout: 'pipe',
    stderr: 'inherit',
    env: sessionSpawnEnv(process.env),
    ...(options.cwd === undefined
      ? {}
      : { cwd: options.cwd }),
  });
  liveSessions.add(proc);
  let stdout: string;
  try {
    stdout = await teeToOperator(proc.stdout);
  } finally {
    await proc.exited;
    liveSessions.delete(proc);
  }
  return { exitCode: await proc.exited, stdout };
}

/**
 * Spawns one Claude session with `prompt` on stdin, and answers its
 * exit code together with everything it wrote to stdout.
 *
 * The argument list is the one {@link runClaude} builds for the same
 * setting sources and flags, both going through {@link claudeArgs}, so
 * capturing a session changes where its stdout goes and nothing about
 * what is run. The operator still sees that output as it is written,
 * through the tee in {@link spawnClaudeCaptured}.
 */
export function runClaudeCaptured(
  prompt: string,
  settingSources: readonly ClaudeSettingSource[],
  flags: readonly string[] = [],
  spawn: CapturingSpawner = spawnClaudeCaptured,
): Promise<CapturedSession> {
  return spawn(claudeArgs(settingSources, flags), prompt);
}
