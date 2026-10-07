/**
 * `rafa stretch start [--n=<n>] [--remote-control] [--role=<role>] [--dry-run]`:
 * opens a stretch (#816). It pushes the integration branch, points
 * `pr.base` at it, copies the operators from the installed package and
 * opens the engineer, watchtower and analyst in one tmux session. With
 * `--role` it starts that one operator session in this terminal instead,
 * which is what each tmux window runs.
 *
 * It replaces `scripts/stretch/stretch.sh start`, and the readings it
 * acts on are `src/stretch/`'s: the numbering and liveness
 * (`folder.ts`), the operators and their version (`operators.ts`), the
 * engineer's prompt (`prompt.ts`) and the `claude` and tmux lines
 * (`launch.ts`).
 *
 * ## Opening a stretch, without `--role`
 *
 * The stretch is `--n`, else the next one (`nextStretch`). Before any
 * step runs it refuses, with exit code 1, each of:
 *
 *   - a live stretch of this project (`liveStretches`): an `agent.json`
 *     reading `running` whose pid is alive, or an open tmux session;
 *   - a loop of the project that runs: a session record under
 *     `.rafa/runs/` reading `running` or `paused` (`readSessions`), as
 *     `self-update` reads it;
 *   - a package with no operators (`findOperators` answering `missing`);
 *   - `claude` not on PATH, outside `--dry-run`;
 *   - a project config the `pr.base` edit refuses (`withConfigSetting`).
 *
 * Then the steps, in order, each printed as the line it runs:
 *
 *   1. `git fetch origin <default>`, where the default branch is the one
 *      `origin/HEAD` names, else `main` (`readRemoteHead`);
 *   2. `git push origin origin/<default>:refs/heads/stretch/<n>`, unless
 *      `git ls-remote` finds `stretch/<n>` on origin already, as after a
 *      start whose session never opened;
 *   3. the `pr.base` the project file held, recorded in
 *      `.rafa/stretch/<n>/stretch.json` ({@link StretchRecord}) for
 *      `stretch end` to put back. A record already there is kept, since
 *      by then `pr.base` names the stretch itself;
 *   4. `rafa config set pr.base=stretch/<n>`, the text edit of
 *      `src/config-set.ts`;
 *   5. the operators copied into `.rafa/stretch/<n>/operators/` once,
 *      printed as `cp -R`, and the version line: the rafa version they
 *      were copied from, or the installed one beside a copy kept;
 *   6. the tmux `new-session`, `new-window` and `select-window` lines,
 *      each window running `rafa stretch start --role=<role> --n=<n>`;
 *      then `tmux switch-client` inside tmux, `tmux attach` on a terminal,
 *      or the attach line printed.
 *
 * Operators still linked into `~/.claude` are warned about before the
 * tmux lines. Without tmux on PATH it prints the two lines to run in
 * other terminals and starts the engineer here, as the script did.
 *
 * ## One session, with `--role`
 *
 * No refusal of the list above applies: the tmux session that runs it is
 * itself what makes the stretch live. The engineer's stretch is `--n`,
 * else the next one, and its opening message is `engineerPrompt`'s. The
 * watchtower's and the analyst's is `--n`, else the newest one with an
 * `agent.json` (refused with exit code 1 when there is none), and each
 * waits for that `agent.json` before it starts, since both find the
 * engineer by it. The copy is made if it is not there yet. The session
 * runs in this terminal, and `claude`'s own exit code is the command's.
 *
 * ## `--dry-run`
 *
 * Every step is printed, in the same order, and none is run: no fetch,
 * push, file, config edit, copy, tmux line or session, and no wait for
 * an `agent.json`. The readings that decide which steps there are still
 * run: the stretch folders, the session records, `origin/HEAD` and
 * `git ls-remote`. It starts no session, so `spends` is declared
 * `unless --dry-run`.
 *
 * ## Exit codes
 *
 * 0 for a stretch opened, a session that ended clean and a dry run. 1
 * for every refusal above, a line it refuses and a prompt file that is
 * missing. 2 when a reading or a step failed: the refusal names the step,
 * what git or tmux said, and the steps already done. A session that ends
 * non-zero exits with its own code.
 *
 * Every effect goes through {@link StretchStartSeams}, so no test reaches
 * git, tmux, `claude` or the real HOME.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ConfigSetEdit } from '../../config-set.js';
import type { PidProbe } from '../../loop/sessions.js';
import type { GitRunner } from '../../pr/git.js';
import type { StretchFolderSeams } from '../../stretch/folder.js';
import type { OperatorRole } from '../../stretch/launch.js';
import type { OperatorsSeams } from '../../stretch/operators.js';
import type { PromptSeams } from '../../stretch/prompt.js';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readRemoteHead } from '../../cleanup/branches.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { ConfigSetRefusal, withConfigSetting } from '../../config-set.js';
import { configFilePath } from '../../config.js';
import { readSessions } from '../../loop/sessions.js';
import { DEFAULT_BASE_BRANCH } from '../../next/sources.js';
import { createGitRunner, gitSaid } from '../../pr/git.js';
import {
  agentFilePath,
  defaultSeams,
  liveStretches,
  newestWatched,
  nextStretch,
  projectName,
  stretchFolder,
  tmuxSessionName,
  tmuxTarget,
} from '../../stretch/folder.js';
import {
  besideEngineerPrompt,
  claudeLine,
  DEFAULT_RAFA_COMMAND,
  lineText,
  OPERATOR_ROLES,
  roleCommand,
  tmuxLines,
} from '../../stretch/launch.js';
import {
  copyOperators,
  defaultOperatorsSeams,
  findOperators,
  linkedOperatorLines,
  linkedOperators,
  missingOperatorsLine,
  operatorsCopyPath,
} from '../../stretch/operators.js';
import { defaultPromptSeams, engineerPrompt } from '../../stretch/prompt.js';
import { lineRefusal, readChoiceFlag, readTextFlag } from '../issue/issue-tracker.js';
import { expectNoArgument, readSwitch, requireProject } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch start';

/** The usage line a refusal ends with. */
export const STRETCH_START_USAGE = 'rafa stretch start [--n=<n>] [--remote-control] [--role=<role>] [--dry-run]';

/** The remote the integration branch is pushed to. */
export const REMOTE = 'origin';

/** The prefix of every integration branch: `stretch/<n>`. */
export const STRETCH_BRANCH_PREFIX = 'stretch/';

/** The record of the `pr.base` a start found, in `.rafa/stretch/<n>/`. */
export const STRETCH_RECORD_FILE = 'stretch.json';

/** The key a start points at the integration branch. */
export const PR_BASE_KEY = 'pr.base';

/** How long the watchtower and analyst sleep between two looks for `agent.json`. */
export const AGENT_WAIT_MS = 5_000;

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading or step that failed. */
const FAILED_EXIT = 2;

/** A number a line names as a stretch: a whole number from 1. */
const STRETCH_NUMBER = /^[1-9]\d*$/;

/** What `stretch.json` holds: the `pr.base` the start found, for `stretch end` to put back. */
export interface StretchRecord {
  readonly stretch: number;
  /** `stretch/<n>`. */
  readonly branch: string;
  /** The branch `stretch/<n>` was pushed from. */
  readonly defaultBranch: string;
  /** What the project file set `pr.base` to before the start, or null when it set none. */
  readonly prBase: string | null;
  /** When the record was written, as ISO 8601. */
  readonly startedAt: string;
}

/** How one step program ended: its exit code and what it wrote on stderr, or null when it could not start. */
export interface StepRun {
  readonly exitCode: number;
  readonly said: string;
}

/** The effects the command reaches through; see the module note. */
export interface StretchStartSeams {
  readonly folder: StretchFolderSeams;
  readonly operators: OperatorsSeams;
  readonly prompt: PromptSeams;
  /** The git runner for the project root. */
  readonly git: (root: string) => GitRunner;
  /** The path `program` resolves to on `path`, or null. */
  readonly which: (program: string, path: string | undefined) => string | null;
  /** Runs a step program with its output read, such as a tmux line; null when it could not start. */
  readonly runStep: (argv: readonly string[], cwd: string) => StepRun | null;
  /** Runs a program on this terminal and answers its exit code, or null when it could not start. */
  readonly runSession: (argv: readonly string[], cwd: string) => Promise<number | null>;
  /** Waits `ms` milliseconds. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Whether standard output is a terminal, where `tmux attach` can take it over. */
  readonly isTerminal: () => boolean;
  readonly now: () => Date;
  /** The program words each tmux window runs rafa with. */
  readonly rafa: readonly string[];
}

/** What one line asks for. */
export interface StartLine {
  readonly n: number | null;
  readonly role: OperatorRole | null;
  readonly remoteControl: boolean;
  readonly dryRun: boolean;
}

/** `stretch/<n>`. */
export function stretchBranch(n: number): string {
  return `${STRETCH_BRANCH_PREFIX}${String(n)}`;
}

/** `<root>/.rafa/stretch/<n>/stretch.json`. */
export function stretchRecordPath(root: string, n: number): string {
  return join(stretchFolder(root, n), STRETCH_RECORD_FILE);
}

/** A refusal with exit code 1 naming `why` and that nothing was run. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** Reads the line; see the module note. */
export function readStartLine(context: RafaContext): StartLine {
  expectNoArgument(context.args, STRETCH_START_USAGE);
  const hint = `Usage: ${STRETCH_START_USAGE}`;
  const word = readTextFlag(context.flags, 'n', STRETCH_START_USAGE);
  if (word !== undefined && !STRETCH_NUMBER.test(word)) {
    throw lineRefusal(`--n is "${word}", expected a stretch number, a whole number from 1`, STRETCH_START_USAGE);
  }
  return {
    n: word === undefined
      ? null
      : Number(word),
    role: readChoiceFlag(context.flags, 'role', OPERATOR_ROLES, STRETCH_START_USAGE) ?? null,
    remoteControl: readSwitch('remote-control', context.flags['remote-control'], hint),
    dryRun: readSwitch('dry-run', context.flags['dry-run'], hint),
  };
}

/** The steps already run, and how the next one is printed and run. */
class Steps {
  private readonly done: string[] = [];

  constructor(private readonly dryRun: boolean, private readonly info: (line: string) => void) {}

  /** Prints `line`, then runs `act` unless this is a dry run; a throw is a failed step. */
  run(line: string, act: () => void): void {
    this.info(line);
    if (this.dryRun) return;
    try {
      act();
    } catch (error) {
      throw this.failed(line, messageOf(error));
    }
    this.done.push(line);
  }

  /** The exit-2 refusal of a step that failed, naming what is already done. */
  failed(line: string, said: string): CommandExit {
    const done = this.done.length === 0
      ? 'no step had run before it.'
      : `already done:\n${this.done.map((step) => `  ${step}`).join('\n')}`;
    return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${line} failed: ${said}\n${done}`);
  }
}

/** Refuses while a stretch of this project is live. */
function refuseLiveStretch(root: string, seams: StretchFolderSeams): void {
  const live = liveStretches(root, seams);
  if (live.length === 0) return;
  const lines = live.map((reading) => {
    const why = [
      reading.pidAlive && reading.agent.kind === 'read'
        ? `agent.json reads running, pid ${String(reading.agent.agent.pid)} alive`
        : null,
      reading.tmuxOpen
        ? `tmux session ${tmuxSessionName(projectName(root), reading.n)} open`
        : null,
    ].filter((part) => part !== null);
    return `  stretch ${String(reading.n)}: ${why.join(', ')}`;
  });
  throw refusal(['a stretch of this project is live, and one runs at a time:', ...lines,
    'Nothing was pushed, set or copied. End it first, or attach to its tmux session.'].join('\n'));
}

/** Refuses while a loop of this project runs; a record it cannot read is a failed reading. */
function refuseLiveLoop(root: string, isAlive: PidProbe): void {
  let records;
  try {
    records = readSessions(root, { isAlive });
  } catch (error) {
    throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: the session records could not be read: ${messageOf(error)}\nNothing was pushed, set or copied.`);
  }
  const loops = records.filter((record) => record.state === 'running' || record.state === 'paused');
  if (loops.length === 0) return;
  throw refusal([`${String(loops.length)} loop(s) of this project run, and a stretch starts with none:`,
    ...loops.map((loop) => `  loop on ${loop.branch} (pid ${String(loop.pid)}, session ${loop.sessionId})`),
    'Nothing was pushed, set or copied. Wait for them to end, or stop them with rafa loop stop.'].join('\n'));
}

/** Refuses when `program` is not on the line's PATH. */
function requireProgram(context: RafaContext, seams: StretchStartSeams, program: string): void {
  if (seams.which(program, context.env['PATH']) !== null) return;
  throw refusal(`${program} is not on PATH. Nothing was pushed, set or copied.`);
}

/** The `pr.base` edit of the project file, made but not written; a refusal for an edit refused. */
function prBaseEdit(root: string, n: number): { path: string; edit: ConfigSetEdit } {
  const path = configFilePath(root);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw refusal(`${path} could not be read (${messageOf(error)}). Nothing was pushed, set or copied.`);
  }
  try {
    return { path, edit: withConfigSetting(text, PR_BASE_KEY, stretchBranch(n), path) };
  } catch (error) {
    if (error instanceof ConfigSetRefusal) {
      throw refusal(`${PR_BASE_KEY} cannot be set: ${error.message}. Nothing was pushed, set or copied.`);
    }
    throw error;
  }
}

/** Whether origin holds `branch`, by `git ls-remote --exit-code`: exit 2 means it does not. */
function remoteHolds(git: GitRunner, branch: string): boolean {
  const result = git(['ls-remote', '--exit-code', '--heads', REMOTE, `refs/heads/${branch}`]);
  if (result.ok) return true;
  if (result.stdout.trim() === '' && result.stderr.trim() === '') return false;
  throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: git ls-remote ${REMOTE} could not be read: ${gitSaid(result)}\nNothing was pushed, set or copied.`);
}

/** Runs one git line as a step, a failure throwing what git said. */
function gitStep(steps: Steps, git: GitRunner, args: readonly string[]): void {
  steps.run(lineText(['git', ...args]), () => {
    const result = git(args);
    if (!result.ok) throw new Error(gitSaid(result) || 'git exited non-zero');
  });
}

/** Steps 1 and 2: the fetch, and the push unless origin holds the branch already. */
function pushBranch(steps: Steps, git: GitRunner, n: number, info: (line: string) => void): string {
  const defaultBranch = readRemoteHead(git) ?? DEFAULT_BASE_BRANCH;
  const branch = stretchBranch(n);
  const held = remoteHolds(git, branch);
  gitStep(steps, git, ['fetch', REMOTE, defaultBranch]);
  if (held) {
    info(`${REMOTE} already holds ${branch}; it is not pushed again`);
  } else {
    gitStep(steps, git, ['push', REMOTE, `${REMOTE}/${defaultBranch}:refs/heads/${branch}`]);
  }
  return defaultBranch;
}

/** Steps 3 and 4: the record of the `pr.base` found, then the edit written. */
function setPrBase(steps: Steps, root: string, n: number, defaultBranch: string, now: Date, info: (line: string) => void): void {
  const { path, edit } = prBaseEdit(root, n);
  const recordPath = stretchRecordPath(root, n);
  if (existsSync(recordPath)) {
    info(`keep ${recordPath}, written by an earlier start`);
  } else {
    const prBase = typeof edit.before === 'string'
      ? edit.before
      : null;
    const record: StretchRecord = { stretch: n, branch: stretchBranch(n), defaultBranch, prBase, startedAt: now.toISOString() };
    steps.run(`record ${PR_BASE_KEY} ${prBase ?? '(not set)'} in ${recordPath}`, () => {
      mkdirSync(dirname(recordPath), { recursive: true });
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    });
  }
  if (!edit.changed) {
    info(`${path} already reads ${PR_BASE_KEY}: ${stretchBranch(n)}`);
    return;
  }
  // Written out rather than through `lineText`, which quotes any `=` word
  // not opening with a dash; this one holds only the key and `stretch/<n>`.
  steps.run(`rafa config set ${PR_BASE_KEY}=${stretchBranch(n)}`, () => {
    writeFileSync(path, edit.text, 'utf8');
  });
}

/** Step 5: the copy of the operators, made once, and the version line. */
function copyStep(steps: Steps, root: string, n: number, seams: OperatorsSeams, info: (line: string) => void): void {
  const found = findOperators(seams);
  if (found.kind === 'missing') throw refusal(missingOperatorsLine(found));
  const copy = operatorsCopyPath(root, n);
  if (seams.fs.exists(copy)) {
    info(`keep ${copy}, copied by an earlier start`);
    info(`operators: the copy kept; the installed rafa is ${found.version}`);
    return;
  }
  steps.run(lineText(['cp', '-R', found.dir, copy]), () => {
    const result = copyOperators(root, n, seams);
    if (result.kind === 'missing') throw new Error(result.reason);
  });
  const source = found.versionSource === 'build'
    ? ' (the version built into this rafa: the package names none)'
    : '';
  info(`operators: rafa ${found.version}${source}, from ${found.dir}`);
}

/** Runs one tmux line as a step, a failure throwing what tmux said. */
function tmuxStep(steps: Steps, seams: StretchStartSeams, argv: readonly string[], root: string): void {
  steps.run(lineText(argv), () => {
    const result = seams.runStep(argv, root);
    if (result === null) throw new Error(`${argv[0] ?? 'tmux'} could not start`);
    if (result.exitCode !== 0) throw new Error(result.said || `exit code ${String(result.exitCode)}`);
  });
}

/** Step 6: the tmux session, then the person brought into it. */
async function openTmux(context: RafaContext, steps: Steps, root: string, n: number, line: StartLine, seams: StretchStartSeams): Promise<void> {
  const session = tmuxSessionName(projectName(root), n);
  const lines = tmuxLines({ root, project: projectName(root), n, remoteControl: line.remoteControl, rafa: seams.rafa });
  for (const argv of lines) tmuxStep(steps, seams, argv, root);
  const info = (text: string): void => context.output.info(text);
  if (line.dryRun) {
    info(`dry run: would start stretch ${String(n)} in tmux session ${session}; nothing was run`);
    return;
  }
  info(`stretch ${String(n)} started in tmux session ${session} (windows: ${OPERATOR_ROLES.join(', ')})`);
  const target = tmuxTarget(session);
  if (context.env['TMUX'] !== undefined && context.env['TMUX'] !== '') {
    if (seams.runStep(['tmux', 'switch-client', '-t', target], root)?.exitCode === 0) return;
  } else if (seams.isTerminal() && (await seams.runSession(['tmux', 'attach', '-t', target], root)) === 0) {
    return;
  }
  info(`attach with: tmux attach -t ${session}`);
}

/** Without tmux: the lines for two more terminals, then the engineer here. */
async function engineerHere(context: RafaContext, root: string, n: number, line: StartLine, seams: StretchStartSeams): Promise<void> {
  const info = (text: string): void => context.output.info(text);
  const other = (role: OperatorRole): string => `  ${lineText(roleCommand({ role, n, remoteControl: line.remoteControl, rafa: seams.rafa }))}`;
  info('tmux is not installed: starting the engineer here. In a second terminal run:');
  info(other('watchtower'));
  info('and in a third, for the analyst:');
  info(other('analyst'));
  await runRole(context, root, { ...line, role: 'engineer', n }, seams, true);
}

/** Opens a stretch; see the module note. */
async function openStretch(context: RafaContext, root: string, line: StartLine, seams: StretchStartSeams): Promise<void> {
  const n = line.n ?? nextStretch(root, seams.folder.fs);
  refuseLiveStretch(root, seams.folder);
  refuseLiveLoop(root, seams.folder.isAlive);
  const found = findOperators(seams.operators);
  if (found.kind === 'missing') throw refusal(missingOperatorsLine(found));
  if (!line.dryRun) requireProgram(context, seams, 'claude');
  prBaseEdit(root, n);

  const info = (text: string): void => context.output.info(text);
  info(`stretch ${String(n)}: ${stretchBranch(n)}${line.dryRun
    ? ', dry run: each step is printed and none is run'
    : ''}`);
  const steps = new Steps(line.dryRun, info);
  const defaultBranch = pushBranch(steps, seams.git(root), n, info);
  setPrBase(steps, root, n, defaultBranch, seams.now(), info);
  copyStep(steps, root, n, seams.operators, info);
  for (const warning of linkedOperatorLines(linkedOperators(seams.operators))) context.output.warn(warning);
  if (seams.which('tmux', context.env['PATH']) === null) {
    await engineerHere(context, root, n, line, seams);
    return;
  }
  await openTmux(context, steps, root, n, line, seams);
}

/** The stretch a role's session reads: `--n`, else the next one for the engineer and the newest watched for the others. */
function roleStretch(root: string, line: StartLine, role: OperatorRole, seams: StretchStartSeams): number {
  if (line.n !== null) return line.n;
  if (role === 'engineer') return nextStretch(root, seams.folder.fs);
  const n = newestWatched(root, seams.folder.fs);
  if (n > 0) return n;
  throw refusal('no .rafa/stretch/<n>/agent.json yet: start the engineer first, or pass --n=<n>');
}

/** Waits until the engineer of stretch `n` has written its `agent.json`. */
async function waitForAgent(context: RafaContext, root: string, n: number, seams: StretchStartSeams): Promise<void> {
  const file = agentFilePath(root, n);
  if (seams.folder.fs.readText(file) !== null) return;
  context.output.info(`waiting for ${file} …`);
  while (seams.folder.fs.readText(file) === null) {
    if (context.signal.aborted) throw refusal(`stopped waiting for ${file}`);
    await seams.sleep(AGENT_WAIT_MS);
  }
}

/** The opening message of `role` in stretch `n`. */
function rolePrompt(context: RafaContext, root: string, role: OperatorRole, n: number, seams: StretchStartSeams): string {
  if (role !== 'engineer') return besideEngineerPrompt(role, n);
  const prompt = engineerPrompt(root, n, seams.prompt);
  if (prompt.kind === 'missing') throw refusal(`the engineer's prompt ${prompt.reason}`);
  context.output.info(`prompt: ${prompt.path}`);
  return prompt.text;
}

/** Starts one operator session in this terminal; see the module note. */
async function runRole(context: RafaContext, root: string, line: StartLine, seams: StretchStartSeams, copied = false): Promise<void> {
  const role = line.role ?? 'engineer';
  const n = roleStretch(root, line, role, seams);
  const prompt = rolePrompt(context, root, role, n, seams);
  if (role !== 'engineer' && !line.dryRun) await waitForAgent(context, root, n, seams);
  const info = (text: string): void => context.output.info(text);
  if (!copied) copyStep(new Steps(line.dryRun, info), root, n, seams.operators, info);
  const argv = claudeLine({
    pluginDir: operatorsCopyPath(root, n),
    role,
    project: projectName(root),
    n,
    prompt,
    remoteControl: line.remoteControl,
  });
  if (line.dryRun) {
    info(lineText(argv));
    info(`dry run: would start the ${role} of stretch ${String(n)} here; nothing was run`);
    return;
  }
  requireProgram(context, seams, 'claude');
  info(`starting the ${role} of stretch ${String(n)}: ${argv.slice(0, 7).join(' ')} …`);
  const exitCode = await seams.runSession(argv, root);
  if (exitCode === null) throw new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: claude could not start`);
  if (exitCode !== 0) throw new CommandExit(exitCode, `❌ ${COMMAND_NAME}: the ${role} session ended with exit code ${String(exitCode)}`);
}

/** Runs the line: one role session with `--role`, the whole stretch without. */
export async function runStretchStart(context: RafaContext, seams: StretchStartSeams): Promise<void> {
  const line = readStartLine(context);
  const root = requireProject(context, COMMAND_NAME).root;
  if (line.role !== null) {
    await runRole(context, root, line, seams);
    return;
  }
  await openStretch(context, root, line, seams);
}

/** Runs `argv` with its output read; null when it could not start. */
function spawnStep(argv: readonly string[], cwd: string): StepRun | null {
  try {
    const result = Bun.spawnSync([...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const said = [result.stderr.toString(), result.stdout.toString()]
      .map((text) => text.trim())
      .filter((text) => text !== '')
      .join('\n');
    return { exitCode: result.exitCode, said };
  } catch {
    return null;
  }
}

/** Runs `argv` on this terminal, ignoring an interrupt the session itself answers; null when it could not start. */
async function spawnSession(argv: readonly string[], cwd: string): Promise<number | null> {
  const ignoreInterrupt = (): void => {};
  process.on('SIGINT', ignoreInterrupt);
  try {
    const child = Bun.spawn([...argv], { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    return await child.exited;
  } catch {
    return null;
  } finally {
    process.off('SIGINT', ignoreInterrupt);
  }
}

/** The real filesystem, git, tmux, `claude`, clock and HOME. */
export function defaultStretchStartSeams(): StretchStartSeams {
  return {
    folder: defaultSeams(),
    operators: defaultOperatorsSeams(),
    prompt: defaultPromptSeams(),
    git: createGitRunner,
    which: (program, path) => Bun.which(program, { PATH: path ?? '' }),
    runStep: spawnStep,
    runSession: spawnSession,
    sleep: (ms) => Bun.sleep(ms),
    isTerminal: () => process.stdout.isTTY,
    now: () => new Date(),
    rafa: DEFAULT_RAFA_COMMAND,
  };
}

/** The command over `seams`, the real ones made when it runs unless a case hands its own. */
export function createStretchStartCommand(seams?: StretchStartSeams): RafaCommand {
  const command: RafaCommand = {
    name: 'stretch start',
    subject: 'stretch',
    action: 'start',
    summary: 'open a stretch: push stretch/<n>, point pr.base at it, copy the operators and start them in tmux',
    description: 'Opens the next stretch, or `--n`: refuses while a stretch of the project is live or a loop'
      + ' of it runs, then fetches the default branch, pushes it to `stretch/<n>` on origin, records the'
      + ' `pr.base` it found in `.rafa/stretch/<n>/stretch.json` and sets `pr.base` to `stretch/<n>` with every'
      + ' comment kept, copies the operators from the installed package into `.rafa/stretch/<n>/operators/`'
      + ' once and prints the rafa version they came from, and opens the engineer, watchtower and analyst in'
      + ' the tmux session `stretch-<project>-<n>`. Without tmux it starts the engineer in this terminal and'
      + ' prints the lines for the other two. `--role` starts that one operator session here and nothing'
      + ' else, which is what each tmux window runs. `--dry-run` prints every step in order and runs none.'
      + ' Exit code 1 for a refusal, 2 for a step that failed, naming the steps already done.',
    args: [],
    flags: [
      { name: 'n', description: 'The stretch number; the next one when left out.', type: 'number' },
      {
        name: 'remote-control',
        description: 'Start each session with Remote Control, so another device drives it from claude.ai.',
        type: 'boolean',
      },
      {
        name: 'role',
        description: 'Start this one operator session here: `engineer`, `watchtower` or `analyst`.',
        type: 'string',
      },
      { name: 'dry-run', description: 'Print every step in order, and run none of them.', type: 'boolean' },
    ],
    examples: [
      { cmd: 'rafa stretch start --dry-run', note: 'Prints the push, the pr.base edit, the copy and the tmux lines.' },
      { cmd: 'rafa stretch start', note: 'Opens the next stretch and attaches to its tmux session.' },
      { cmd: 'rafa stretch start --role=watchtower --n=5', note: 'Starts the watchtower of stretch 5 in this terminal.' },
    ],
    outputs: ['text'],
    spends: { when: 'unless', flag: '--dry-run', what: 'one session per operator it starts' },
    run: async (context) => runStretchStart(context, seams ?? defaultStretchStartSeams()),
  };
  return Object.freeze(command);
}

export default createStretchStartCommand();
