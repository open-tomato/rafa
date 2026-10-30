/**
 * Where Claude Code files a project's session logs, and which of the
 * files there are sessions.
 *
 * `collect.ts` reads its session half through this module and nothing
 * else; it owns no path of its own.
 *
 * ## Where the session logs are
 *
 * Claude Code files a project's logs under
 * `~/.claude/projects/<encoded repo root>/`, where the encoding
 * replaces every `/` and `.` with a hyphen. That is measured off the
 * live directory rather than assumed: this repo's root encodes as
 * `-Users-marcos-projects-agentic-research`, and a sibling entry for
 * `<root>/.claude/worktrees/<name>` encodes as
 * `...-agentic-research--claude-worktrees-<name>` — the doubled
 * hyphen being the slash and the dot of `/.claude` in turn. Only
 * those two characters are known to be replaced; anything else in a
 * path is untested here, so the collector's `logDir` option exists as
 * the override rather than the derivation being widened on a guess.
 *
 * The population is DEPTH-DEFINED and that is the whole reason
 * {@link listSessionLogs} reads one directory instead of walking.
 * Loose `*.jsonl` files at the top of that directory are sessions;
 * `<session-uuid>/subagents/agent-*.jsonl` one level down are subagent
 * transcripts. A recursive walk folds the second population into the
 * first silently — the counts stay plausible, the token totals double
 * -count every subagent turn already billed to its parent, and
 * nothing in the output says so.
 *
 * ## A project's folders: the main checkout's and its worktrees'
 *
 * A session run in a worktree is filed under the WORKTREE's encoded
 * path, not the main checkout's, so one folder holds only the sessions
 * started in the main checkout. Measured on 2026-10-05 against this
 * repo: its main folder held 9 logs and the six
 * `<main>--rafa-worktrees-<stub>` folders beside it 90, every loop task
 * session among them. {@link projectLogDirs} answers the main checkout's
 * folder and every folder whose name is the encoded `loop.worktreeDir`
 * of this project followed by `-` and a name: live worktrees, and
 * removed ones whose folder remains. The `-` after the prefix is what
 * keeps another project out whose root merely extends this one's name
 * (`…-repo-other`): its folders start `…-repo-other`, never
 * `…-repo--rafa-worktrees-`.
 *
 * A worktree folder's path is read back from its name, as the worktree
 * directory joined with the rest of the name. That is exact for a
 * worktree named by a plan stub, which holds no `/` or `.`; a name that
 * held one reads back with a `-` in its place, the encoding being one
 * way. A `loop.worktreeDir` outside the project (`../trees`) shares its
 * prefix with whatever else is filed there, and its folders are read as
 * this project's: the setting is what names them so.
 *
 * {@link listProjectSessionLogs} lists the folders together, keeping a
 * session id once: the first folder holding it wins, the main
 * checkout's before any worktree's, and every other copy is answered
 * beside the list rather than dropped unseen. No real tree has been
 * seen holding one id twice (none of the 99 logs above); the rule
 * exists so a store keyed by session id is never handed two rows for
 * one key.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { sessionIdFromPath } from './session-log.js';

/**
 * Path characters the project log directory name replaces.
 *
 * Both are measured against the live directory; see the module note
 * on why the class is not widened past what was observed.
 */
const LOG_DIR_SEPARATORS = /[/\\.]/g;

/** A session log by name; a directory so named is excluded by stat. */
const SESSION_LOG_NAME = /\.jsonl$/i;

/** Where Claude Code files per-project logs, under the home directory. */
const PROJECT_LOG_ROOT = ['.claude', 'projects'] as const;

/** One session log the walk found, before anything has been read. */
export interface SessionLogCandidate {
  path: string;
  /** Basename without the extension, which is the session uuid. */
  sessionId: string;
  sizeBytes: number;
  modifiedAtMs: number;
  /**
   * The worktree the log's folder belongs to, null for the main
   * checkout's. Absent on a candidate built by hand, read as null.
   */
  worktree?: string | null;
}

/** One project folder a collect reads, and the worktree its sessions ran in. */
export interface ProjectLogDir {
  dir: string;
  /** The worktree's path, read back from the folder name; null for the main checkout. */
  worktree: string | null;
}

/** The logs of a set of project folders, each session id once. */
export interface ProjectSessionLogs {
  /** Oldest first, as {@link listSessionLogs} orders one folder. */
  candidates: SessionLogCandidate[];
  /** The copies of an id already taken from an earlier folder, never read. */
  duplicates: SessionLogCandidate[];
}

/** Encodes a repo root the way Claude Code names its log directory. */
export function projectLogDirName(repoRoot: string): string {
  return repoRoot.replace(LOG_DIR_SEPARATORS, '-');
}

/** The session log directory for one repo root. */
export function sessionLogDir(
  repoRoot: string,
  home: string = homedir(),
): string {
  return join(home, ...PROJECT_LOG_ROOT, projectLogDirName(repoRoot));
}

/**
 * The main checkout's folder, then every worktree folder of this
 * project by name; see the module note. `worktreeDir` is
 * `loop.worktreeDir` as the config holds it, resolved against
 * `repoRoot`. A HOME with no projects root answers the main folder
 * alone, which {@link listProjectSessionLogs} then reports missing.
 */
export function projectLogDirs(
  repoRoot: string,
  worktreeDir: string,
  home: string = homedir(),
): ProjectLogDir[] {
  const main: ProjectLogDir = { dir: sessionLogDir(repoRoot, home), worktree: null };
  const root = join(home, ...PROJECT_LOG_ROOT);
  if (!existsSync(root)) return [main];

  const worktreeRoot = resolve(repoRoot, worktreeDir);
  const prefix = `${projectLogDirName(worktreeRoot)}-`;
  const mainName = projectLogDirName(repoRoot);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== mainName && name.startsWith(prefix) && name.length > prefix.length)
    .sort();
  return [
    main,
    ...names.map((name) => ({
      dir: join(root, name),
      worktree: join(worktreeRoot, name.slice(prefix.length)),
    })),
  ];
}

/**
 * Lists the loose logs of every folder in `dirs`, each stamped with its
 * folder's worktree, a session id kept from the first folder holding it.
 *
 * A folder that is not there is skipped while another is; when NONE of
 * them is, this throws as {@link listSessionLogs} does on the first, for
 * the reason given there.
 */
export function listProjectSessionLogs(
  dirs: readonly ProjectLogDir[],
): ProjectSessionLogs {
  const present = dirs.filter(({ dir }) => existsSync(dir));
  const first = dirs[0];
  if (present.length === 0 && first !== undefined) listSessionLogs(first.dir);

  const kept = new Map<string, SessionLogCandidate>();
  const duplicates: SessionLogCandidate[] = [];
  for (const { dir, worktree } of present) {
    for (const candidate of listSessionLogs(dir, worktree)) {
      if (kept.has(candidate.sessionId)) {
        duplicates.push(candidate);
        continue;
      }
      kept.set(candidate.sessionId, candidate);
    }
  }
  return { candidates: sortCandidates([...kept.values()]), duplicates };
}

/**
 * Lists the loose session logs in one directory.
 *
 * One directory read, never a walk — see the module note on the depth
 * rule. Entries are stat'd here rather than at read time so the
 * `--since` filter and the row's own size and mtime come from one
 * reading, and so the collector's selection is pure over the result.
 *
 * A missing directory THROWS rather than answering an empty list: an
 * empty answer is what a wrong derivation and a repo with no sessions
 * both look like, and only one of those is worth reporting as a clean
 * run of zero. Each log carries `worktree`, null unless one is given.
 */
export function listSessionLogs(
  dir: string,
  worktree: string | null = null,
): SessionLogCandidate[] {
  if (!existsSync(dir)) {
    throw new Error(
      `effort collect: no session log directory at ${dir}`
      + ' (pass logDir, or run with --no-sessions)',
    );
  }

  const candidates: SessionLogCandidate[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!SESSION_LOG_NAME.test(entry.name)) continue;

    const path = join(dir, entry.name);
    const stats = statSync(path);
    candidates.push({
      path,
      sessionId: sessionIdFromPath(path),
      sizeBytes: stats.size,
      modifiedAtMs: stats.mtimeMs,
      worktree,
    });
  }
  return sortCandidates(candidates);
}

/**
 * Oldest first, ties broken by id.
 *
 * Deterministic on purpose: the store is append-only, so this is also
 * the order rows are written in, and two runs over the same tree
 * should not produce two different files.
 */
function sortCandidates(
  candidates: SessionLogCandidate[],
): SessionLogCandidate[] {
  return candidates.sort((a, b) => {
    if (a.modifiedAtMs !== b.modifiedAtMs) {
      return a.modifiedAtMs - b.modifiedAtMs;
    }
    if (a.sessionId === b.sessionId) return 0;
    return a.sessionId < b.sessionId
      ? -1
      : 1;
  });
}
