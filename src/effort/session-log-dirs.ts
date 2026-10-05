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
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
 * run of zero.
 */
export function listSessionLogs(dir: string): SessionLogCandidate[] {
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
