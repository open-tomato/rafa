/**
 * `rafa stretch item <issue> [--wait] [--dry-run]`: takes one item of a
 * stretch from planning to a running loop (#816). It replaces the hand
 * steps the engineer operator took per item: `rafa plan create --issue`,
 * then a `setsid nohup` loop start with its events output redirected into
 * the stretch folder. What happens once `loop wait` has ended, the merge
 * of the loop's pull request into the integration branch, the wait for
 * CI on it, the ledger line and the pit-stop readings, is
 * `./item-merge.ts`'s.
 *
 * `stretch item` decides nothing: it runs the steps and prints what they
 * read. The pit-stop skill decides what to do with them.
 *
 * ## The steps
 *
 * Before any step runs it refuses, with exit code 1, each of:
 *
 *   - a line naming no issue, or a word that is no issue number;
 *   - a config `loadConfig` refuses;
 *   - a `pr.base` that names no `stretch/<n>` branch, the default branch
 *     and no `pr.base` at all included ({@link stretchOfBase}): an item
 *     merges into the integration branch, never the default branch;
 *   - two plans in `plan.dir` for the issue, `PLAN-rafa-<issue>-*.md`;
 *   - a loop of the issue's plan that already runs, by its session
 *     record (`readSessions`), so a second start never appends to the
 *     first one's log.
 *
 * Then the steps, in order, each printed as the line it runs:
 *
 *   1. `rafa plan create --issue=<issue>`, on this terminal, with the
 *      reference check as `plan create` keeps it: no `--accept-refs`. A
 *      plan of the issue already in `plan.dir` is kept instead, as after
 *      an item whose loop never started, and `keep <plan>` is printed. A
 *      plan create that ends non-zero ends the item with its own exit
 *      code, so a spec not ready (3) still reads as such;
 *   2. `RAFA_OUTPUT=events rafa loop start --plan=<plan> --as-worktree
 *      --no-ci-wait`, started as a detached child in its own session,
 *      both its streams appended to `.rafa/stretch/<n>/loop-<issue>.log`
 *      ({@link itemLogPath}). The folder is made when it is not there,
 *      since an item needs no `stretch start` before it;
 *   3. the wait for the loop's session record: the newest record of the
 *      plan's stub started at or after the launch. A child that ends
 *      before writing one ends the item with exit code 2 and the log's
 *      last {@link LOG_TAIL_LINES} lines. Without `--wait` the item stops
 *      looking after {@link RECORD_WAIT_MS}, notes that the loop has
 *      written no record yet, and exits 0 with the log's path: the child
 *      is still running;
 *   4. with `--wait`, `rafa loop wait --session-id=<id>` on this
 *      terminal, then `./item-merge.ts`'s half: the merge, the CI wait,
 *      the ledger line and the pit-stop readings once the loop opened a
 *      pull request, else the reason it opened none and `loop wait`'s
 *      exit code, so a caller reads the same reason codes `loop wait`
 *      documents.
 *
 * ## `--dry-run`
 *
 * Every step is printed, in the same order, and none is run: no plan
 * session, no folder, no log and no loop; with `--wait`, the merge half's
 * lines follow (`mergeDryRunLines`). The readings that decide which
 * steps there are still run: the config, `plan.dir` and the session
 * records. With no plan of the issue yet, the loop line names the plan
 * as `PLAN-rafa-<issue>-<slug>.md`, the slug being the issue title's,
 * which only the planning step reads. It starts no session, so `spends`
 * is declared `unless --dry-run`.
 *
 * ## Exit codes
 *
 * 0 for a loop started and a dry run, 1 for each refusal above, 2 when a
 * step failed or a reading of the session records did, `plan create`'s
 * own code when it ends non-zero, and under `--wait` the codes
 * `./item-merge.ts` names.
 *
 * Every process goes through {@link StretchItemSeams}, so no test runs
 * `rafa`, a planning session or a loop.
 */
import type { ItemMergeSeams } from './item-merge.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { PidProbe, SessionRecord } from '../../loop/sessions.js';
import type { PlansDir } from '../plan/plan-files.js';

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { createGhRunner, createGithubTracker } from '../../adapters/tracker/github.js';
import { boardId } from '../../board/naming.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { isPidAlive, readSessions } from '../../loop/sessions.js';
import { stretchFolder } from '../../stretch/folder.js';
import { DEFAULT_RAFA_COMMAND, lineText } from '../../stretch/launch.js';
import {
  expectOneArgument,
  plansDirAt,
  readSwitch,
  requireProject,
  resolveProjectConfig,
  stubOfPlanFile,
} from '../plan/plan-files.js';

import { afterLoopWait, ghFiledAt, mergeDryRunLines } from './item-merge.js';
import { PR_BASE_KEY, STRETCH_BRANCH_PREFIX } from './start.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch item';

/** The usage line a refusal ends with. */
export const STRETCH_ITEM_USAGE = 'rafa stretch item <issue> [--wait] [--dry-run]';

/** The flags the loop is started with: its own worktree, and no wait on CI, which the stretch reads itself. */
export const LOOP_FLAGS: readonly string[] = Object.freeze(['--as-worktree', '--no-ci-wait']);

/** The output mode the loop writes its log in. */
export const LOOP_OUTPUT = 'events';

/** How long apart two looks for the loop's session record are. */
export const RECORD_POLL_MS = 2_000;

/** How long an item without `--wait` looks for the loop's session record. */
export const RECORD_WAIT_MS = 5 * 60_000;

/** How many of the log's last lines a loop that ended early is shown by. */
export const LOG_TAIL_LINES = 20;

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading or step that failed. */
const FAILED_EXIT = 2;

/** An issue number: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/;

/** A `stretch/<n>` branch, `<n>` a whole number from 1. */
const STRETCH_BASE = new RegExp(`^${STRETCH_BRANCH_PREFIX}([1-9]\\d*)$`);

/** A loop started detached: its pid, and its exit code once it has ended. */
export interface LaunchedLoop {
  readonly pid: number;
  /** The child's exit code, or null while it runs. */
  readonly exitCode: () => number | null;
}

/** The processes and clock the command reaches through, the merge half's among them; see the module note. */
export interface StretchItemSeams extends ItemMergeSeams {
  /** Starts a line detached in its own session, both streams appended to `logPath`; null when it could not start. */
  readonly launch: (argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>, logPath: string) => LaunchedLoop | null;
  /** The pid probe the session records are read with. */
  readonly isAlive: PidProbe;
}

/** What one line asks for. */
export interface ItemLine {
  readonly issue: number;
  readonly wait: boolean;
  readonly dryRun: boolean;
}

/** `<root>/.rafa/stretch/<n>/loop-<issue>.log`. */
export function itemLogPath(root: string, n: number, issue: number): string {
  return join(stretchFolder(root, n), `loop-${String(issue)}.log`);
}

/** The stretch number a `pr.base` names, or null for one naming no `stretch/<n>` branch. */
export function stretchOfBase(prBase: string | null): number | null {
  const word = prBase === null
    ? undefined
    : STRETCH_BASE.exec(prBase)?.[1];
  return word === undefined
    ? null
    : Number(word);
}

/** A refusal with exit code 1 naming `why`. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** A failure with exit code 2 naming `why`. */
function failure(why: string): CommandExit {
  return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** Reads the line; see the module note. */
export function readItemLine(context: RafaContext): ItemLine {
  const word = expectOneArgument(context.args, STRETCH_ITEM_USAGE);
  if (!ISSUE_NUMBER.test(word) || !Number.isSafeInteger(Number(word))) {
    throw new CommandExit(REFUSED_EXIT, `❌ "${word}" is no issue number, expected a whole number from 1\nUsage: ${STRETCH_ITEM_USAGE}`);
  }
  const hint = `Usage: ${STRETCH_ITEM_USAGE}`;
  return {
    issue: Number(word),
    wait: readSwitch('wait', context.flags['wait'], hint),
    dryRun: readSwitch('dry-run', context.flags['dry-run'], hint),
  };
}

/** The stretch `pr.base` names; a refusal for one naming no `stretch/<n>` branch. */
function requireStretchBase(prBase: string | null): number {
  const n = stretchOfBase(prBase);
  if (n !== null) return n;
  const found = prBase === null
    ? 'not set, so pull requests open into the default branch'
    : `"${prBase}"`;
  throw refusal(`${PR_BASE_KEY} is ${found}, expected a ${STRETCH_BRANCH_PREFIX}<n> branch: an item merges into the`
    + ' integration branch, never the default branch. Run rafa stretch start, or push the branch and run'
    + ` rafa config set ${PR_BASE_KEY}=${STRETCH_BRANCH_PREFIX}<n>. Nothing was run.`);
}

/** The plans of `issue` in `plans`, as `plan.dir` spells them, by name. */
export function issuePlans(plans: PlansDir, issue: number): string[] {
  const prefix = `${boardId(issue)}-`;
  let names: string[];
  try {
    names = readdirSync(plans.path);
  } catch {
    return [];
  }
  return names
    .filter((name) => stubOfPlanFile(name)?.startsWith(prefix) === true)
    .sort()
    .map((name) => posix.join(plans.label, name));
}

/** The one plan of `issue` already there, null for none; a refusal for several. */
function existingPlan(plans: PlansDir, issue: number): string | null {
  const found = issuePlans(plans, issue);
  if (found.length > 1) {
    throw refusal([`${plans.label} holds ${String(found.length)} plans of #${String(issue)}, and an item runs one:`,
      ...found.map((plan) => `  ${plan}`),
      'Remove the ones not wanted. Nothing was run.'].join('\n'));
  }
  return found[0] ?? null;
}

/** The session records under the project, a reading that failed being exit code 2. */
function sessionRecords(root: string, isAlive: PidProbe): readonly SessionRecord[] {
  try {
    return readSessions(root, { isAlive });
  } catch (error) {
    throw failure(`the session records could not be read: ${messageOf(error)}`);
  }
}

/** Refuses while a loop of `stub` runs. */
function refuseRunningLoop(root: string, stub: string, isAlive: PidProbe): void {
  const running = sessionRecords(root, isAlive)
    .filter((record) => record.planStub === stub && (record.state === 'running' || record.state === 'paused'));
  const [first] = running;
  if (first === undefined) return;
  throw refusal(`a loop of ${stub} runs already: session ${first.sessionId} (pid ${String(first.pid)}, ${first.state}).`
    + ` Wait on it with rafa loop wait --session-id=${first.sessionId}. Nothing was run.`);
}

/** The words the loop is started with. */
function loopArgv(rafa: readonly string[], plan: string): string[] {
  return [...rafa, 'loop', 'start', `--plan=${plan}`, ...LOOP_FLAGS];
}

/** The loop line as printed: its environment, the line, and the redirect a shell would spell. */
function loopLineText(rafa: readonly string[], plan: string | null, placeholder: string, log: string): string {
  const words = plan === null
    ? `${lineText([...rafa, 'loop', 'start'])} --plan=${placeholder} ${lineText(LOOP_FLAGS)}`
    : lineText(loopArgv(rafa, plan));
  return `RAFA_OUTPUT=${LOOP_OUTPUT} ${words} >> ${lineText([log])} 2>&1 &`;
}

/** The environment a child runs with: the line's own, every unset name left out, and `extra` over it. */
function childEnv(context: RafaContext, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(context.env)) {
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Step 1: the issue's plan, kept or made by `rafa plan create --issue`; null under a dry run with none. */
async function planStep(context: RafaContext, root: string, plans: PlansDir, line: ItemLine, seams: StretchItemSeams): Promise<string | null> {
  const info = (text: string): void => context.output.info(text);
  const kept = existingPlan(plans, line.issue);
  if (kept !== null) {
    info(`keep ${kept}, written by an earlier plan create`);
    return kept;
  }
  const argv = [...seams.rafa, 'plan', 'create', `--issue=${String(line.issue)}`];
  info(lineText(argv));
  if (line.dryRun) return null;
  const exitCode = await seams.runRafa(argv, root, childEnv(context));
  if (exitCode === null) throw failure(`${lineText(argv)} could not start. Nothing else was run.`);
  if (exitCode !== 0) {
    throw new CommandExit(exitCode, `❌ ${COMMAND_NAME}: ${lineText(argv)} ended with exit code ${String(exitCode)}; no loop was started.`);
  }
  const made = existingPlan(plans, line.issue);
  if (made === null) {
    throw failure(`${lineText(argv)} ended with exit code 0 and wrote no ${boardId(line.issue)}-* plan in ${plans.label}; no loop was started.`);
  }
  return made;
}

/** The size of `path`, or 0 when there is no file yet. */
function sizeOf(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

/** The last {@link LOG_TAIL_LINES} lines `log` gained past `offset`, each indented. */
function logTail(log: string, offset: number): string {
  let text: string;
  try {
    text = readFileSync(log)
      .subarray(offset)
      .toString('utf8');
  } catch (error) {
    return `  (the log could not be read: ${messageOf(error)})`;
  }
  const lines = text
    .split('\n')
    .filter((entry) => entry.trim() !== '')
    .slice(-LOG_TAIL_LINES);
  return lines.length === 0
    ? '  (the log is empty)'
    : lines.map((entry) => `  ${entry}`).join('\n');
}

/** The newest record of `stub` started at or after `since`. */
function launchedRecord(root: string, stub: string, since: number, isAlive: PidProbe): SessionRecord | null {
  const records = sessionRecords(root, isAlive)
    .filter((record) => record.planStub === stub && Date.parse(record.startedAt) >= since);
  return records.at(-1) ?? null;
}

/** What the record wait needs. */
interface RecordWait {
  readonly root: string;
  readonly stub: string;
  readonly since: number;
  readonly launched: LaunchedLoop;
  readonly log: string;
  readonly offset: number;
  /** Whether to look until the child ends, as `--wait` does, rather than for {@link RECORD_WAIT_MS}. */
  readonly patient: boolean;
}

/** Step 3: the loop's session record, or null once an impatient look has run out; see the module note. */
async function awaitRecord(context: RafaContext, wait: RecordWait, seams: StretchItemSeams): Promise<SessionRecord | null> {
  for (;;) {
    const record = launchedRecord(wait.root, wait.stub, wait.since, seams.isAlive);
    if (record !== null) return record;
    const exitCode = wait.launched.exitCode();
    if (exitCode !== null) {
      throw failure(`the loop (pid ${String(wait.launched.pid)}) ended with exit code ${String(exitCode)} before it`
        + ` wrote a session record. The last lines of ${wait.log}:\n${logTail(wait.log, wait.offset)}`);
    }
    if (!wait.patient && seams.now().getTime() - wait.since >= RECORD_WAIT_MS) return null;
    if (context.signal.aborted) {
      throw refusal(`stopped looking for the loop's session record; the loop (pid ${String(wait.launched.pid)}) still runs, logging to ${wait.log}`);
    }
    await seams.sleep(RECORD_POLL_MS);
  }
}

/** Step 2: the loop started detached, its streams appended to the item's log; answers the launch and the log's size before it. */
function launchStep(context: RafaContext, root: string, plan: string, log: string, seams: StretchItemSeams): { launched: LaunchedLoop; offset: number } {
  const folder = dirname(log);
  try {
    mkdirSync(folder, { recursive: true });
  } catch (error) {
    throw failure(`${folder} could not be made: ${messageOf(error)}; ${plan} is planned and no loop was started.`);
  }
  const offset = sizeOf(log);
  const launched = seams.launch(loopArgv(seams.rafa, plan), root, childEnv(context, { RAFA_OUTPUT: LOOP_OUTPUT }), log);
  if (launched === null) throw failure(`the loop could not start; ${plan} is planned and no loop runs.`);
  return { launched, offset };
}

/** What the wait step needs of the item. */
interface WaitInput {
  readonly root: string;
  readonly n: number;
  readonly issue: number;
  readonly stub: string;
  readonly record: SessionRecord;
  readonly log: string;
}

/** Step 4: `rafa loop wait` on the session, then the merge half over its exit code. */
async function waitStep(context: RafaContext, wait: WaitInput, seams: StretchItemSeams): Promise<void> {
  const { root, record } = wait;
  const argv = [...seams.rafa, 'loop', 'wait', `--session-id=${record.sessionId}`];
  context.output.info(lineText(argv));
  const env = childEnv(context);
  const exitCode = await seams.runRafa(argv, root, env);
  if (exitCode === null) throw failure(`${lineText(argv)} could not start; the loop still runs.`);
  await afterLoopWait(context, {
    root,
    n: wait.n,
    issue: wait.issue,
    stub: wait.stub,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    log: wait.log,
    env,
  }, exitCode, seams);
}

/** Runs the line; see the module note. */
export async function runStretchItem(context: RafaContext, seams: StretchItemSeams): Promise<void> {
  const line = readItemLine(context);
  const project = requireProject(context, COMMAND_NAME);
  const { root } = project;
  const warn = (text: string): void => context.output.warn(text);
  const config = resolveProjectConfig(project, COMMAND_NAME, warn);
  const n = requireStretchBase(config.prBase);
  const plans = plansDirAt(root, config.planDir);
  const kept = existingPlan(plans, line.issue);
  const keptStub = kept === null
    ? null
    : stubOfPlanFile(posix.basename(kept));
  if (keptStub !== null) refuseRunningLoop(root, keptStub, seams.isAlive);

  const info = (text: string): void => context.output.info(text);
  const issue = String(line.issue);
  info(`stretch item #${issue}: stretch ${String(n)} (${PR_BASE_KEY} ${STRETCH_BRANCH_PREFIX}${String(n)})${line.dryRun
    ? ', dry run: each step is printed and none is run'
    : ''}`);
  const log = itemLogPath(root, n, line.issue);
  const plan = await planStep(context, root, plans, line, seams);
  const placeholder = posix.join(plans.label, `PLAN-${boardId(line.issue)}-<slug>.md`);
  info(loopLineText(seams.rafa, plan, placeholder, log));
  if (plan === null || line.dryRun) {
    if (line.wait) {
      info(`${lineText([...seams.rafa, 'loop', 'wait'])} --session-id=<session id>`);
      for (const step of mergeDryRunLines(seams.rafa, root, n)) info(step);
    }
    info(`dry run: would start the loop of #${issue} for ${STRETCH_BRANCH_PREFIX}${String(n)}; nothing was run`);
    return;
  }

  const stub = stubOfPlanFile(posix.basename(plan)) ?? '';
  if (keptStub === null) refuseRunningLoop(root, stub, seams.isAlive);
  const since = seams.now().getTime();
  const { launched, offset } = launchStep(context, root, plan, log, seams);
  const record = await awaitRecord(context, { root, stub, since, launched, log, offset, patient: line.wait }, seams);
  if (record === null) {
    info(`the loop (pid ${String(launched.pid)}) has written no session record yet; it still runs, logging to ${log}`);
    return;
  }
  info(`loop running: session ${record.sessionId}, pid ${String(record.pid)}, ${plan}`);
  info(`log: ${log}`);
  if (!line.wait) {
    info(`wait on it with: rafa loop wait --session-id=${record.sessionId}`);
    return;
  }
  await waitStep(context, { root, n, issue: line.issue, stub, record, log }, seams);
}

/** Runs `argv` on this terminal; null when it could not start. */
async function spawnOnTerminal(argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>): Promise<number | null> {
  try {
    const child = Bun.spawn([...argv], { cwd, env: { ...env }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    return await child.exited;
  } catch {
    return null;
  }
}

/**
 * Starts `argv` in a session of its own, both streams appended to
 * `logPath`, and lets this process exit without it: measured on bun
 * 1.3.14, a `detached` child given the log's descriptor and unref'd
 * outlives its parent, and its `exitCode` is still read while the parent
 * runs. Null when it could not start.
 */
function spawnDetached(argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>, logPath: string): LaunchedLoop | null {
  let fd: number;
  try {
    fd = openSync(logPath, 'a');
  } catch {
    return null;
  }
  try {
    const child = Bun.spawn([...argv], { cwd, env: { ...env }, stdin: 'ignore', stdout: fd, stderr: fd, detached: true });
    child.unref();
    return { pid: child.pid, exitCode: () => child.exitCode };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The real processes, pid probe, `gh`, tracker and clock. */
export function defaultStretchItemSeams(): StretchItemSeams {
  return {
    runRafa: spawnOnTerminal,
    launch: spawnDetached,
    isAlive: isPidAlive,
    gh: (root) => createGhRunner({ cwd: root }),
    tracker: (gh) => createGithubTracker({ gh }),
    filedAt: ghFiledAt,
    sleep: (ms) => Bun.sleep(ms),
    now: () => new Date(),
    rafa: DEFAULT_RAFA_COMMAND,
  };
}

/** The command over `seams`, the real ones made when it runs unless a case hands its own. */
export function createStretchItemCommand(seams?: StretchItemSeams): RafaCommand {
  const command: RafaCommand = {
    name: 'stretch item',
    subject: 'stretch',
    action: 'item',
    summary: 'plan one issue of a stretch and start its loop, logging into the stretch folder',
    description: 'Takes the integration branch from `pr.base`, refusing one that names no `stretch/<n>`'
      + ' branch, then runs `rafa plan create --issue=<issue>` on this terminal, keeping a plan of the issue'
      + ' already in `plan.dir` instead, and starts `rafa loop start --plan=<plan> --as-worktree --no-ci-wait`'
      + ' detached with `RAFA_OUTPUT=events`, its output appended to `.rafa/stretch/<n>/loop-<issue>.log`.'
      + ' It waits for the loop\'s session record and prints its id. With `--wait` it then runs'
      + ' `rafa loop wait --session-id=<id>`; once the loop has opened a pull request it refuses one whose base'
      + ' is not a `stretch/*` branch, runs `rafa pr merge <pr> --skip-checks --yes`, waits for the run on the'
      + ' merge commit to end, appends the item to `.rafa/stretch/<n>/items.ndjson` and prints the pit-stop'
      + ' readings. A loop that opened no pull request has its reason printed, merges nothing and exits with'
      + ' `loop wait`\'s code. `--dry-run` prints every step in order and runs none. Exit code 1 for a refusal,'
      + ' 2 for a step that failed, and the code of `plan create`, `loop wait` or `pr merge` when it fails.',
    args: [
      { name: 'issue', description: 'The number of the `type:spec` issue to plan and run.', type: 'string', required: true },
    ],
    flags: [
      {
        name: 'wait',
        description: 'Wait on the loop through `rafa loop wait`, then merge its pull request into the integration branch'
          + ' with checks skipped, wait for CI and print the pit-stop readings.',
        type: 'boolean',
      },
      { name: 'dry-run', description: 'Print every step in order, and run none of them.', type: 'boolean' },
    ],
    examples: [
      { cmd: 'rafa stretch item 812 --dry-run', note: 'Prints the plan create line and the detached loop line.' },
      { cmd: 'rafa stretch item 812 --wait', note: 'Plans #812, starts its loop, waits on it and merges its pull request.' },
    ],
    outputs: ['text'],
    spends: { when: 'unless', flag: '--dry-run', what: 'one planning session and the loop it starts' },
    run: async (context) => runStretchItem(context, seams ?? defaultStretchItemSeams()),
  };
  return Object.freeze(command);
}

export default createStretchItemCommand();
