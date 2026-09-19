/**
 * The loop one `rafa pr triage --resolve` attempt runs: the filled
 * pinned plan written outside the worktree, and the ordinary
 * `rafa loop start` spawned inside it.
 *
 * The spec resolves a simple pull request by running a pinned plan
 * "by the ordinary loop, so commits, reports and effort rows are the
 * usual ones" (`.specs/rafa-20-pr-commands.md`). That is taken
 * literally here: the plan is a file on disk and the loop is this same
 * rafa, spawned as `rafa loop start --plan=<file>` with the worktree as
 * its working directory. Nothing about the sessions it spawns is
 * special-cased — the budget rides in on the plan's own `budget=`
 * declarations (`src/pr/plans/budget.ts`), and the agent routing is the
 * plan's own.
 *
 * ## Why the plan is written OUTSIDE the worktree
 *
 * The loop stages and commits whatever a task session left in the tree
 * (`src/start/commit.ts`), so a plan file written inside the worktree
 * would be committed onto the pull request's branch and pushed with the
 * resolution in every repository that does not ignore the path. The
 * plan therefore lives under the home, beside the worktrees and not in
 * one: {@link resolveRunDir} is `<home>/.rafa/resolve/pr-<n>/attempt-<k>`,
 * and `--plan` takes the absolute path, which `resolvePlanPath`
 * (`src/start/plan-path.ts`) resolves as given.
 *
 * ## Why each attempt gets its own directory
 *
 * The loop tracks a plan in `PLAN_TRACKER-<stub>.md` beside it and
 * resumes from the tracker's first unfinished line. A second attempt
 * re-using the first attempt's file would therefore find every task
 * marked and run nothing at all, reporting a clean loop over a pull
 * request it never touched — a silent pass. A fresh directory per
 * attempt gives each run an untouched tracker, and leaves the previous
 * attempt's marks on disk for the operator who wants to know what the
 * run did.
 *
 * ## `--no-ci-wait`, and what the command does instead
 *
 * The spawned loop ends at its push. Its own CI gate would poll the
 * pull request's checks and spend repair sessions of its own
 * (`src/start/pr-lifecycle.ts`), and those sessions are outside the
 * attempt guard: the guard counts RESOLVE runs, and a repair session
 * inside one would fix or fail to fix the pull request without the
 * count moving. So the attempt ends at the push and
 * `./triage-resolve.ts` runs the wait, which is the same
 * `waitForChecks` the loop's gate polls with.
 *
 * ## The spawn
 *
 * `[execPath, entry, ...words]` with the worktree as `cwd`, as
 * `src/start/runtime.ts` spawns an installed runtime, so the child is
 * this rafa and not whatever `rafa` a PATH resolves to. The child's
 * environment names `RAFA_OUTPUT=text`, and its stdout is read a line
 * at a time and handed to {@link ResolveLoopRun.onLine}: a child
 * writing NDJSON onto the parent's stdout would interleave two event
 * streams in json mode, and a caller forwarding the lines through the
 * command's own output writes them as that mode's log lines instead.
 */
import type { TriageClass } from '../../pr/triage/classes.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../../config-sections.js';
import { pinnedPlanFileName } from '../../pr/plans/load.js';

/** Where under a home directory a resolve run keeps its plans and trackers. */
export const RESOLVE_SUBDIR = join('.rafa', 'resolve');

/** What a resolve run's directory is named before its pull request number. */
const RUN_PREFIX = 'pr-';

/** What an attempt's directory is named before its number. */
const ATTEMPT_PREFIX = 'attempt-';

/** The words `rafa loop start` is reached by, as the registry routes them. */
const LOOP_WORDS: readonly string[] = Object.freeze(['loop', 'start']);

/** The output mode the spawned loop writes in; see the module note. */
const CHILD_OUTPUT = 'text';

/**
 * Where attempt `attempt` of a resolve run for pull request `number`
 * keeps its plan, under `home`:
 * `<home>/.rafa/resolve/pr-<number>/attempt-<attempt>`.
 */
export function resolveRunDir(home: string, number: number, attempt: number): string {
  return join(home, RESOLVE_SUBDIR, `${RUN_PREFIX}${number}`, `${ATTEMPT_PREFIX}${attempt}`);
}

/** What one plan write is asked for. */
export interface ResolvePlanWrite {
  /** The home the run's directory sits under. */
  readonly home: string;
  /** The pull request number. */
  readonly number: number;
  /** Which attempt this is, from 1. */
  readonly attempt: number;
  /** The class whose pinned plan this is, which names the file. */
  readonly triageClass: TriageClass;
  /** The plan text, filled and budgeted. */
  readonly plan: string;
}

/**
 * Writes the filled plan for one attempt and answers its absolute path,
 * creating the run's directory. The file keeps the pinned plan's own
 * name, so the stub the loop stamps is the plan's
 * (`resolve-<class>`).
 */
export function writeResolvePlan(write: ResolvePlanWrite): string {
  const dir = resolveRunDir(write.home, write.number, write.attempt);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, pinnedPlanFileName(write.triageClass));
  writeFileSync(path, write.plan, 'utf8');
  return path;
}

/** The words the spawned rafa is handed for one attempt; see the module note. */
export function resolveLoopArgv(planPath: string): readonly string[] {
  return Object.freeze([...LOOP_WORDS, `--plan=${planPath}`, '--no-ci-wait']);
}

/** What one attempt's loop run is asked for. */
export interface ResolveLoopRun {
  /** The worktree the loop runs in, which is its working directory. */
  readonly worktree: string;
  /** The plan it runs, absolute. */
  readonly planPath: string;
  /** Where each line the child wrote on stdout goes, with no newline. */
  readonly onLine: (line: string) => void;
}

/** How one attempt's loop run ended. Never a throw; see {@link runResolveLoop}. */
export interface ResolveLoopOutcome {
  /** True when the loop exited 0. */
  readonly ok: boolean;
  /** Its exit code, or 1 when it could not be spawned at all. */
  readonly exitCode: number;
  /** The words it was spawned with, for a report. */
  readonly argv: readonly string[];
  /** Why it could not be spawned, or null when it ran. */
  readonly problem: string | null;
}

/** How a loop run reaches this process's own entry; each left out is the system's own. */
export interface ResolveLoopSeams {
  /** The runtime the child is run with. `process.execPath` when left out. */
  readonly execPath?: string;
  /** The entry the child runs. `Bun.main` when left out. */
  readonly entry?: string;
  /** The environment it runs in, before `RAFA_OUTPUT`. `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Hands every whole line of `stream` to `onLine`, and the last partial one. */
async function forwardLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  }
  if (pending !== '') onLine(pending);
}

/**
 * Runs the ordinary loop over `run.planPath` in `run.worktree` and
 * answers how it ended.
 *
 * Answers rather than throws, as `GitRunner` does, because the caller
 * has a worktree and a triage comment to see to whatever the loop did:
 * a child that could not be spawned is one more attempt that did not
 * fix the pull request.
 */
export async function runResolveLoop(
  run: ResolveLoopRun,
  seams: ResolveLoopSeams = {},
): Promise<ResolveLoopOutcome> {
  const argv = resolveLoopArgv(run.planPath);
  const words = [seams.execPath ?? process.execPath, seams.entry ?? Bun.main, ...argv];
  try {
    const child = Bun.spawn(words, {
      cwd: run.worktree,
      env: { ...seams.env ?? process.env, RAFA_OUTPUT: CHILD_OUTPUT },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'inherit',
    });
    await forwardLines(child.stdout, run.onLine);
    const exitCode = await child.exited;
    return { ok: exitCode === 0, exitCode, argv, problem: null };
  } catch (error) {
    return { ok: false, exitCode: 1, argv, problem: messageOf(error) };
  }
}

/**
 * How one attempt's loop is run. {@link runResolveLoop} is the real
 * one; a caller hands another to run the attempt without a spawn.
 */
export type ResolveLoopRunner = (run: ResolveLoopRun) => Promise<ResolveLoopOutcome>;
