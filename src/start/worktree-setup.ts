/**
 * The command `loop.worktreeSetup` names, run once in a run's worktree:
 * {@link runWorktreeSetup} runs it through `/bin/sh -c` with the worktree
 * as its `cwd`, prints what it wrote, and refuses the run when it fails.
 *
 * It runs through the spawn, the group kill and the stream reader of
 * `../preflight/shell.ts`, whose module note holds the rules they were
 * measured by:
 *
 *   - **stdin is closed**, so a command that waits for input reads end of
 *     file and ends instead of holding the run: `cat` exits 0 at once.
 *   - **The environment is the run's**, as the caller hands it in: the
 *     `PATH` the command is looked up on is that environment's.
 *   - **Both streams are piped and collected.** The output printed and
 *     tailed is stdout followed by stderr, each whole: the two are read
 *     apart, so their lines are not interleaved as a terminal would show
 *     them. Stderr comes last because a failing command says why there.
 *   - **The limit kills the command's process group**, at
 *     {@link WORKTREE_SETUP_TIMEOUT_MS}, ten minutes, and stops reading
 *     both streams, keeping what was read. The limit is the `timeoutMs`
 *     seam.
 *
 * ## What it prints
 *
 * One info line before the command starts, naming the command and the
 * worktree ({@link setupLine}), and, once it has ended, what it wrote,
 * when it wrote anything, as one more info message. Both go through the
 * `output` seam, the active output when it is left out.
 *
 * ## When it refuses
 *
 * An exit of 0 answers. Anything else throws `CommandExit(1, …)`, whose
 * first line names `loop.worktreeSetup`, the command, the worktree and
 * how the command ended:
 *
 *   - `exited <code>`, for a nonzero exit;
 *   - `timed out after 600s and was killed`, when the limit found the
 *     shell still running;
 *   - `could not start /bin/sh: <reason>`, when the shell never started,
 *     such as for a worktree directory that does not exist.
 *
 * The lines after it are the last {@link SETUP_TAIL_LINES} lines of the
 * output, each indented by two spaces, or a word that the command wrote
 * nothing; a shell that never started has no lines after the first.
 * Nothing here removes or changes the worktree.
 */
import type { ShellProcess } from '../preflight/shell.js';
import type { Output } from '@open-tomato/rafa/ports';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';

import { collect, killGroup, SHELL, spawnShell } from '../preflight/shell.js';

/** How long the setup command may run before its group is killed: ten minutes. */
export const WORKTREE_SETUP_TIMEOUT_MS = 600_000;

/** How many of the output's last lines a refusal quotes. */
export const SETUP_TAIL_LINES = 20;

/** The config key the command comes from, as every line here names it. */
const SETUP_KEY = 'loop.worktreeSetup';

/** What the setup runs, and where. */
export interface WorktreeSetupRequest {
  /** The shell command, as `loop.worktreeSetup` holds it. */
  readonly command: string;
  /** The worktree's path: the command's `cwd`. */
  readonly worktree: string;
  /** The run's environment, which the command runs with. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** What the setup runs with; each is filled in when left out. */
export interface WorktreeSetupSeams {
  /** The limit, in milliseconds. {@link WORKTREE_SETUP_TIMEOUT_MS} when left out. */
  readonly timeoutMs?: number;
  /** Where the lines go. The active output when left out. */
  readonly output?: Output;
}

/** How a run of the command ended. */
interface SetupRun {
  /** The shell's exit code, 128 plus the signal when killed. */
  readonly exitCode: number;
  /** Stdout followed by stderr, as far as either was read. */
  readonly text: string;
  /** True when the limit found the shell still running. */
  readonly timedOut: boolean;
}

/** The info line printed before the command starts, in the voice of the base line of `run-checkout.ts`. */
function setupLine(command: string, worktree: string): string {
  return `\n🧰 Setting up the worktree: running ${SETUP_KEY} \`${command}\` in ${worktree}.`;
}

/** A duration as a refusal names it: `600s`, `0.001s`. */
function secondsOf(timeoutMs: number): string {
  return `${timeoutMs / 1000}s`;
}

/** The output's lines, without the empty one a final newline leaves. */
function linesOf(text: string): readonly string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The lines a refusal ends with: the output's last {@link SETUP_TAIL_LINES}, indented. */
function tailOf(text: string): string {
  const lines = linesOf(text);
  if (lines.length === 0) return 'It wrote nothing.';
  const tail = lines.slice(-SETUP_TAIL_LINES);
  const heading = tail.length === lines.length
    ? 'Its output:'
    : `The last ${tail.length} of its ${lines.length} lines of output:`;
  return [heading, ...tail.map((line) => `  ${line}`)].join('\n');
}

/**
 * The refusal for a command that ended as `ending` says, quoting the tail
 * of `text`, or nothing past the first line when the shell never started
 * and `text` is null.
 */
function refusal(request: WorktreeSetupRequest, ending: string, text: string | null): CommandExit {
  const first = `${SETUP_KEY} \`${request.command}\` in ${request.worktree} ${ending}.`;
  return text === null
    ? new CommandExit(1, first)
    : new CommandExit(1, `${first}\n${tailOf(text)}`);
}

/** Runs the command in the worktree to its end or the limit; see the module note. */
async function runToEnd(proc: ShellProcess<'pipe', 'pipe'>, timeoutMs: number): Promise<SetupRun> {
  const stdout = collect(proc.stdout);
  const stderr = collect(proc.stderr);
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = proc.exitCode === null && proc.signalCode === null;
    killGroup(proc);
    stdout.stop();
    stderr.stop();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    const [out, err] = await Promise.all([stdout.text, stderr.text]);
    return { exitCode, text: out + err, timedOut };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Runs `request.command` through `/bin/sh -c` in `request.worktree` with
 * `request.env` and stdin closed, prints the line naming it and then what
 * it wrote, and answers once it exits 0. Throws `CommandExit(1, …)` on a
 * nonzero exit, at the limit, or when the shell could not start. See the
 * module note.
 */
export async function runWorktreeSetup(
  request: WorktreeSetupRequest,
  seams: WorktreeSetupSeams = {},
): Promise<void> {
  const output = seams.output ?? activeOutput();
  const timeoutMs = seams.timeoutMs ?? WORKTREE_SETUP_TIMEOUT_MS;
  output.info(setupLine(request.command, request.worktree));

  let proc: ShellProcess<'pipe', 'pipe'>;
  try {
    proc = spawnShell(request.command, { cwd: request.worktree, env: request.env, stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    throw refusal(request, `could not start ${SHELL}: ${messageOf(error)}`, null);
  }

  const run = await runToEnd(proc, timeoutMs);
  const printed = linesOf(run.text);
  if (printed.length > 0) output.info(printed.join('\n'));

  if (run.timedOut) throw refusal(request, `timed out after ${secondsOf(timeoutMs)} and was killed`, run.text);
  if (run.exitCode !== 0) throw refusal(request, `exited ${run.exitCode}`, run.text);
}
