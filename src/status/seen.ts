/**
 * What the since-last-command notice compares: a small snapshot of the
 * project's local state, the reading it is taken from, and the file
 * `<project>/.rafa/status-seen.json` it is kept in between commands.
 *
 * ## The snapshot
 *
 * {@link SeenSnapshot} is `version: 1` and holds three things:
 *
 * - **`idleWorktrees`**: the paths of the worktrees `rafa cleanup` lists
 *   that nothing touched within `cleanup.worktreeIdleDays`
 *   (`isIdleWorktree`, `./sections.ts`), sorted.
 * - **`mergedBranches`**: the names of the branches in Merged, sorted.
 * - **`sessions`**: per session id under `.rafa/runs/`, the state its
 *   record reads as (`readState`, a live state whose pid is gone reading
 *   `stopped`) and the line numbers, counting from one, of the blocked
 *   tasks in its checklist (`blockedTasks`). Several sessions of one plan
 *   read one tracker, so each of them holds the same lines.
 *
 * ## The reading is local
 *
 * {@link takeSeenSnapshot} runs before every command that runs inside a
 * project, so nothing it reads may wait on the network. It calls
 * `readCleanup` with `fetch: false` (`doctorCleanupSettings`) and with
 * `pulls: null`: {@link SeenSeams.worktreeSeams} answers the worktree
 * seams alone and the provider is laid over them here, so no caller can
 * hand one in. No `gh` runner is built. Merged is therefore what git
 * alone reads as merged — reachable from the base, or an upstream the
 * last fetch left `[gone]` — and a squash-merged branch is not in it
 * until a fetch prunes its upstream.
 *
 * It answers `{ ok: false, detail }` rather than throwing: when git
 * refuses the listing, and when a session record cannot be read. The
 * notice then prints nothing and nothing is written.
 *
 * ## The file
 *
 * {@link readSeenFile} answers null for a file that is missing, holds no
 * JSON, or holds JSON that is not a version 1 snapshot, so the notice
 * treats all three as a first run. {@link writeSeenFile} creates `.rafa/`
 * when it is not there and writes to a temporary file renamed over the
 * old one, so a command reading while another writes reads a whole file.
 * `.rafa/` is gitignored whole, so the file is never tracked.
 */
import type { WorktreeSeams } from '../cleanup/index.js';
import type { RafaConfig } from '../config.js';
import type { PidProbe, SessionState } from '../loop/sessions.js';

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defaultWorktreeSeams, readCleanup } from '../cleanup/index.js';
import { doctorCleanupSettings } from '../commands/doctor-cleanup.js';
import { readSessionChecklist } from '../commands/loop/loop-sessions.js';
import { blockedTasks } from '../commands/loop/status.js';
import { messageOf } from '../config-sections.js';
import { readSessions, SESSION_STATES } from '../loop/sessions.js';
import { scopeAt } from '../project/scope.js';

import { isIdleWorktree } from './sections.js';

/** The snapshot's file name, under the project's `.rafa/`. */
export const SEEN_FILE = 'status-seen.json';

/** The only snapshot version this module reads and writes. */
export const SEEN_VERSION = 1;

/** One session as the snapshot holds it. */
export interface SeenSession {
  /** The state its record reads as. */
  readonly state: SessionState;
  /** The blocked tasks' line numbers in its checklist, counting from one, ascending. */
  readonly blocked: readonly number[];
}

/** What the notice compares; see the module note. */
export interface SeenSnapshot {
  readonly version: typeof SEEN_VERSION;
  /** The idle worktrees' paths, sorted. */
  readonly idleWorktrees: readonly string[];
  /** The Merged branches' names, sorted. */
  readonly mergedBranches: readonly string[];
  /** Per session id, its state and blocked lines. */
  readonly sessions: Readonly<Record<string, SeenSession>>;
}

/** The settings the reading takes. */
export type SeenConfig = Pick<RafaConfig, 'prBase' | 'cleanupKeep' | 'cleanupStaleDays' | 'cleanupWorktreeIdleDays'>;

/** What {@link takeSeenSnapshot} reads. */
export interface SeenInput {
  /** The project root: git runs here, and its `.rafa/runs/` holds the sessions. */
  readonly root: string;
  /** The home `~/.rafa/worktrees/` is under. */
  readonly home: string;
  /** The resolved config. */
  readonly config: SeenConfig;
}

/** How the reading reaches the system; each left out is the system's own. None reaches the network. */
export interface SeenSeams {
  /** The worktree seams, git at `cwd`; the provider is always null. `defaultWorktreeSeams` when left out. */
  readonly worktreeSeams?: (cwd: string) => WorktreeSeams;
  /** Whether a pid is alive, as a session record's state is read. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
  /** The clock the idle ages are read against. `new Date()` when left out. */
  readonly now?: () => Date;
}

/** What {@link takeSeenSnapshot} answers. Never a rejection. */
export type SeenReading =
  | { readonly ok: true; readonly snapshot: SeenSnapshot }
  | { readonly ok: false; readonly detail: string };

/** `<root>/.rafa/status-seen.json`. */
export function seenFilePath(root: string): string {
  return join(scopeAt(root).dir, SEEN_FILE);
}

/** Per session id under `root`, its state and blocked lines. Throws on a record that cannot be read. */
function readSeenSessions(root: string, isAlive: PidProbe | undefined): Record<string, SeenSession> {
  const sessions: Record<string, SeenSession> = {};
  for (const record of readSessions(root, { isAlive })) {
    const blocked = blockedTasks(readSessionChecklist(root, record)).map((task) => task.line);
    sessions[record.sessionId] = { state: record.state, blocked: [...blocked].sort((a, b) => a - b) };
  }
  return sessions;
}

/** The project's snapshot, read now and locally; see the module note. */
export async function takeSeenSnapshot(input: SeenInput, seams: SeenSeams = {}): Promise<SeenReading> {
  try {
    const now = (seams.now ?? ((): Date => new Date()))();
    const worktreeSeams = (seams.worktreeSeams ?? defaultWorktreeSeams)(input.root);
    const settings = doctorCleanupSettings({ ...input, gh: null }, now);
    const reading = await readCleanup({ ...worktreeSeams, pulls: null }, { ...settings, fetch: false });
    if (!reading.ok) return { ok: false, detail: reading.detail };
    const idle = reading.worktrees.filter((row) => isIdleWorktree(row)).map((row) => row.path);
    const merged = reading.merged.map((row) => row.branch.name);
    return {
      ok: true,
      snapshot: {
        version: SEEN_VERSION,
        idleWorktrees: [...idle].sort(),
        mergedBranches: [...merged].sort(),
        sessions: readSeenSessions(input.root, seams.isAlive),
      },
    };
  } catch (error) {
    return { ok: false, detail: messageOf(error) };
  }
}

/** True for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an array of strings. */
function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** True for one session as the snapshot holds it. */
function isSeenSession(value: unknown): value is SeenSession {
  return isRecord(value)
    && (SESSION_STATES as readonly unknown[]).includes(value.state)
    && Array.isArray(value.blocked)
    && value.blocked.every((line) => Number.isInteger(line) && (line as number) > 0);
}

/** `value` as a snapshot, or null when it is not a version 1 one. */
function asSnapshot(value: unknown): SeenSnapshot | null {
  if (!isRecord(value) || value.version !== SEEN_VERSION) return null;
  const { idleWorktrees, mergedBranches, sessions } = value;
  if (!isStrings(idleWorktrees) || !isStrings(mergedBranches) || !isRecord(sessions)) return null;
  if (!Object.values(sessions).every((session) => isSeenSession(session))) return null;
  return { version: SEEN_VERSION, idleWorktrees, mergedBranches, sessions: sessions as Record<string, SeenSession> };
}

/** The snapshot `.rafa/status-seen.json` holds, or null when it is missing or unparseable; see the module note. */
export function readSeenFile(root: string): SeenSnapshot | null {
  let text: string;
  try {
    text = readFileSync(seenFilePath(root), 'utf8');
  } catch {
    return null;
  }
  try {
    return asSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Writes `snapshot` to `.rafa/status-seen.json` whole; see the module note. Throws when it cannot. */
export function writeSeenFile(root: string, snapshot: SeenSnapshot): void {
  const file = seenFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temporary, file);
}
