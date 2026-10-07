/**
 * The stretch folder: `.rafa/stretch/<n>/` numbering, the engineer's
 * `agent.json`, and whether a stretch of this project is live (#816).
 *
 * The rules are the ones `scripts/stretch/stretch.sh` follows, so the
 * commands that replace it number and find stretches the same way:
 *
 *   - **Numbers.** Only a folder whose whole name is digits counts, so
 *     `3-archive.tar.gz` and `engineer-prompt.md` beside the folders are
 *     never stretches. {@link highestStretch} is the largest, or 0.
 *   - **The next stretch** ({@link nextStretch}) is the highest while
 *     that folder has no `agent.json` (a start copied the operators and
 *     the engineer never ran), and one more than the highest once it has.
 *   - **The newest watched stretch** ({@link newestWatched}) is the
 *     highest one holding an `agent.json`, or 0: the stretch the
 *     watchtower and analyst read.
 *   - **A live stretch** ({@link stretchLiveness}) has an `agent.json`
 *     reading `state: running` whose `pid` is alive, or an open tmux
 *     session {@link tmuxSessionName}. A tmux target is always written
 *     `=<name>` ({@link tmuxTarget}): a bare `-t` is a prefix match, so
 *     `stretch-rafa-2` would find `stretch-rafa-23`.
 *
 * `agent.json` is written by the engineer operator by hand, so its read
 * ({@link readAgentFile}) keeps the four fields a command needs and lets
 * every other field through unread. Stretches 1 to 4 wrote `sessionId`,
 * `pid`, and from stretch 2 `tmuxSession`; only stretch 4's carried
 * `state`, so a missing field reads as null rather than a refusal.
 *
 * Every effect goes through {@link StretchFolderSeams}: the filesystem,
 * the pid probe and the tmux probe. Nothing outside
 * `src/commands/stretch/` and `src/commands/doctor-stretch.ts` imports
 * this module, so the stretch logic can move into its own package.
 */
import type { PidProbe } from '../loop/sessions.js';

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { isPositiveWhole } from '../loop/session-record-parse.js';
import { errorCode, isPidAlive } from '../loop/sessions.js';

/** The folder every stretch writes under, relative to the project root. */
export const STRETCH_DIR = join('.rafa', 'stretch');

/** The engineer's record in a stretch folder. */
export const AGENT_FILE = 'agent.json';

/** The `state` an `agent.json` carries while its engineer runs. */
export const RUNNING_STATE = 'running';

const DIGITS = /^\d+$/;

/** One name in a listed directory. */
export interface FolderEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/** The filesystem reads the stretch folder goes through. */
export interface StretchFs {
  /** The entries of `dir`, or none when it does not exist. */
  readonly list: (dir: string) => readonly FolderEntry[];
  /** The text of `file`, or null when it does not exist. */
  readonly readText: (file: string) => string | null;
}

/** Answers whether a tmux session with this exact name is open. */
export type TmuxProbe = (sessionName: string) => boolean;

/** The effects every reading here reaches through. */
export interface StretchFolderSeams {
  readonly fs: StretchFs;
  readonly isAlive: PidProbe;
  readonly hasTmuxSession: TmuxProbe;
}

/** The result of one command a probe ran: its exit code. */
export interface ProbeRun {
  readonly exitCode: number;
}

/** Runs a command and returns its exit code, or null when it could not start. */
export type ProbeRunner = (argv: readonly string[]) => ProbeRun | null;

/** The engineer's record: the fields a command reads, each null when absent. */
export interface StretchAgent {
  readonly sessionId: string | null;
  readonly pid: number | null;
  readonly state: string | null;
  readonly tmuxSession: string | null;
}

/** A stretch folder with no `agent.json`. */
export interface AgentAbsent {
  readonly kind: 'absent';
  readonly file: string;
}

/** An `agent.json` that is no JSON object, or holds a field of the wrong type. */
export interface AgentMalformed {
  readonly kind: 'malformed';
  readonly file: string;
  readonly reason: string;
}

/** An `agent.json` read. */
export interface AgentRead {
  readonly kind: 'read';
  readonly file: string;
  readonly agent: StretchAgent;
}

/** What {@link readAgentFile} found. */
export type AgentReading = AgentAbsent | AgentMalformed | AgentRead;

/** One stretch folder and whether it is live, with both readings that decide it. */
export interface StretchLiveness {
  readonly n: number;
  readonly agent: AgentReading;
  /** The agent reads `state: running` and its pid is alive. */
  readonly pidAlive: boolean;
  /** The tmux session {@link tmuxSessionName} is open. */
  readonly tmuxOpen: boolean;
  readonly live: boolean;
}

/** `<root>/.rafa/stretch`. */
export function stretchRoot(root: string): string {
  return join(root, STRETCH_DIR);
}

/** `<root>/.rafa/stretch/<n>`. Throws on a number that is not a positive whole one. */
export function stretchFolder(root: string, n: number): string {
  return join(stretchRoot(root), String(stretchNumber(n)));
}

/** `<root>/.rafa/stretch/<n>/agent.json`. */
export function agentFilePath(root: string, n: number): string {
  return join(stretchFolder(root, n), AGENT_FILE);
}

/** The stretch numbers that have a folder, smallest first. */
export function stretchNumbers(root: string, fs: StretchFs = nodeStretchFs): readonly number[] {
  return fs.list(stretchRoot(root))
    .filter((entry) => entry.isDirectory && DIGITS.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

/** The highest numbered stretch folder, or 0 when there is none. */
export function highestStretch(root: string, fs: StretchFs = nodeStretchFs): number {
  const numbers = stretchNumbers(root, fs);
  return numbers.length === 0
    ? 0
    : numbers[numbers.length - 1]!;
}

/**
 * The stretch the next engineer opens: the highest folder while it has no
 * `agent.json`, else one more than the highest.
 */
export function nextStretch(root: string, fs: StretchFs = nodeStretchFs): number {
  const highest = highestStretch(root, fs);
  if (highest > 0 && !hasAgentFile(root, highest, fs)) return highest;
  return highest + 1;
}

/** The highest stretch whose folder holds an `agent.json`, or 0. */
export function newestWatched(root: string, fs: StretchFs = nodeStretchFs): number {
  const numbers = stretchNumbers(root, fs);
  for (let index = numbers.length - 1; index >= 0; index -= 1) {
    const n = numbers[index]!;
    if (hasAgentFile(root, n, fs)) return n;
  }
  return 0;
}

/** Reads stretch `n`'s `agent.json`; never throws on its content. */
export function readAgentFile(root: string, n: number, fs: StretchFs = nodeStretchFs): AgentReading {
  const file = agentFilePath(root, n);
  const text = fs.readText(file);
  if (text === null) return { kind: 'absent', file };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: 'malformed', file, reason: `is not JSON: ${messageOf(error)}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'malformed', file, reason: 'is not a JSON object' };
  }
  return agentFields(file, value as Record<string, unknown>);
}

/**
 * The project's name as tmux keeps it: the root folder's name with every
 * character outside `A-Za-z0-9_-` turned into `-`, trailing dashes
 * dropped. Throws when nothing is left.
 */
export function projectName(root: string): string {
  const name = basename(root)
    .replace(/[^\w-]/g, '-')
    .replace(/-+$/, '');
  if (name === '') {
    throw new Error(`stretch: ${JSON.stringify(root)} leaves no project name for a tmux session`);
  }
  return name;
}

/** `stretch-<project>-<n>`, the tmux session one stretch runs in. */
export function tmuxSessionName(project: string, n: number): string {
  return `stretch-${project}-${stretchNumber(n)}`;
}

/** `=<name>`: the exact-match tmux target for a session. */
export function tmuxTarget(sessionName: string): string {
  return `=${sessionName}`;
}

/** Whether stretch `n` of this project is live, and both readings behind the answer. */
export function stretchLiveness(root: string, n: number, seams: StretchFolderSeams = defaultSeams()): StretchLiveness {
  const agent = readAgentFile(root, n, seams.fs);
  const pidAlive = agent.kind === 'read'
    && agent.agent.state === RUNNING_STATE
    && agent.agent.pid !== null
    && seams.isAlive(agent.agent.pid);
  const tmuxOpen = seams.hasTmuxSession(tmuxSessionName(projectName(root), n));
  return { n, agent, pidAlive, tmuxOpen, live: pidAlive || tmuxOpen };
}

/** The live stretches of this project, smallest number first. */
export function liveStretches(root: string, seams: StretchFolderSeams = defaultSeams()): readonly StretchLiveness[] {
  return stretchNumbers(root, seams.fs)
    .map((n) => stretchLiveness(root, n, seams))
    .filter((reading) => reading.live);
}

/**
 * Runs `argv` with its output discarded; null when the program could not
 * start, as when tmux is not installed.
 */
export function spawnProbe(argv: readonly string[]): ProbeRun | null {
  try {
    const result = Bun.spawnSync([...argv], { stdout: 'ignore', stderr: 'ignore' });
    return { exitCode: result.exitCode };
  } catch {
    return null;
  }
}

/**
 * A {@link TmuxProbe} over `tmux has-session -t =<name>`: open when tmux
 * exits 0, closed on any other exit or when tmux cannot start.
 */
export function tmuxProbe(run: ProbeRunner = spawnProbe): TmuxProbe {
  return (sessionName) => run(['tmux', 'has-session', '-t', tmuxTarget(sessionName)])?.exitCode === 0;
}

/** The real filesystem, pid probe and tmux. */
export function defaultSeams(): StretchFolderSeams {
  return { fs: nodeStretchFs, isAlive: isPidAlive, hasTmuxSession: tmuxProbe() };
}

/** {@link StretchFs} over `node:fs`; a missing path reads as empty or null, any other failure throws. */
export const nodeStretchFs: StretchFs = {
  list(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  },
  readText(file) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
};

function hasAgentFile(root: string, n: number, fs: StretchFs): boolean {
  return fs.readText(agentFilePath(root, n)) !== null;
}

function stretchNumber(n: number): number {
  if (!isPositiveWhole(n)) {
    throw new Error(`stretch: ${String(n)} is not a stretch number`);
  }
  return n;
}

function agentFields(file: string, record: Record<string, unknown>): AgentReading {
  const sessionId = optionalString(record, 'sessionId');
  if (sessionId === undefined) return malformedField(file, 'sessionId');
  const state = optionalString(record, 'state');
  if (state === undefined) return malformedField(file, 'state');
  const tmuxSession = optionalString(record, 'tmuxSession');
  if (tmuxSession === undefined) return malformedField(file, 'tmuxSession');
  const pid = record.pid ?? null;
  if (pid !== null && !isPositiveWhole(pid)) {
    return { kind: 'malformed', file, reason: 'pid is not a positive whole number' };
  }
  return { kind: 'read', file, agent: { sessionId, pid, state, tmuxSession } };
}

function malformedField(file: string, key: string): AgentMalformed {
  return { kind: 'malformed', file, reason: `${key} is not a string` };
}

/** The field as a string, null when absent, undefined when it holds another type. */
function optionalString(record: Record<string, unknown>, key: string): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return null;
  return typeof value === 'string'
    ? value
    : undefined;
}
