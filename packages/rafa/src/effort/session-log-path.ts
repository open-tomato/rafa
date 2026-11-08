/**
 * The form a session row stores its log's path in, and the way back
 * from it to a file on the reading machine.
 *
 * A session log lives under `<home>/.claude/projects/<folder>/`, where
 * `<folder>` is the encoded repo root `session-log-dirs.ts` derives. The
 * absolute path names the home directory, which differs per machine and
 * per user, and sync carries a row to every store (#1489). So a row
 * stores the part after the projects root, `<folder>/<file>`, with no
 * leading `/`, and each reader joins it back under its own home.
 *
 * Three functions, one per direction:
 *
 *   - {@link storedLogPath} is the write side: an absolute path under
 *     the given home's projects root answers its relative form, and any
 *     other path, a `logDir` override's among them, answers unchanged.
 *   - {@link storedLogPathOf} is the read-time rewrite of a row written
 *     before the stored form: an absolute value holding
 *     `/.claude/projects/` is cut after it whatever home precedes it, so a
 *     macOS `/Users/<u>/` row reads the same as a Linux `/home/<u>/` one.
 *     Any other value, a relative one, one outside the root or one that is
 *     not a string, answers unchanged.
 *   - {@link resolveSessionLogPath} is the way back: a relative value is
 *     joined under the given home's projects root, and an absolute one is
 *     answered as it is.
 *
 * ## What counts as a stored relative path
 *
 * A stored value is POSIX-shaped: `/` separates its segments, since both
 * machines rafa runs on write it so. A value holding `\` is a path a
 * Windows machine wrote, which this module cannot read back, so it is
 * refused as a relative value rather than joined as a file name holding
 * backslashes. A value that is empty, or whose `..` segments climb out of
 * the projects root, is refused too: resolving it would name a file the
 * row never pointed at. {@link resolveSessionLogPath} answers `null` for a
 * refused value, and the two writing functions keep it out of the stored
 * form by answering their input unchanged.
 *
 * The projects root is held here rather than imported:
 * `session-log-dirs.ts` keeps its own `PROJECT_LOG_ROOT` private, and the
 * two spell the same two segments.
 */
import { posix } from 'node:path';

const { isAbsolute, join, normalize } = posix;

/** Where Claude Code files per-project logs, under the home directory. */
const PROJECT_LOG_SEGMENTS = ['.claude', 'projects'] as const;

/** The projects root as it appears inside an absolute path, slashes included. */
const PROJECT_LOG_MARKER = `/${PROJECT_LOG_SEGMENTS.join('/')}/`;

/** A separator only a Windows-written path holds. */
const WINDOWS_SEPARATOR = '\\';

/** The segment that climbs one folder up. */
const PARENT_SEGMENT = '..';

/**
 * Whether `value` is a path relative to the projects root that stays
 * inside it: non-empty, `/`-separated, not absolute, and not climbing out
 * through its `..` segments.
 *
 * @param value - The candidate relative path.
 * @returns True when the value can be joined under the root.
 */
function isStoredRelative(value: string): boolean {
  if (value === '' || value.includes(WINDOWS_SEPARATOR)) return false;
  if (isAbsolute(value)) return false;
  const normalized = normalize(value);
  if (normalized === '.' || normalized === PARENT_SEGMENT) return false;
  return !normalized.startsWith(`${PARENT_SEGMENT}/`);
}

/**
 * The projects root under one home, `<home>/.claude/projects`.
 *
 * @param home - The home directory, absolute.
 * @returns The root, with no trailing `/`.
 */
function projectLogRoot(home: string): string {
  return join(home, ...PROJECT_LOG_SEGMENTS);
}

/**
 * The form a session row stores a log's path in.
 *
 * @param absolutePath - The log's absolute path, as the collector read it.
 * @param home - The home directory whose projects root the path is cut against.
 * @returns `<folder>/<file>` for a path under `<home>/.claude/projects/`,
 *   and the path unchanged for any other, a `logDir` override's included.
 */
export function storedLogPath(absolutePath: string, home: string): string {
  if (!isAbsolute(absolutePath) || !isAbsolute(home)) return absolutePath;
  const prefix = `${projectLogRoot(home)}/`;
  if (!absolutePath.startsWith(prefix)) return absolutePath;
  const rest = absolutePath.slice(prefix.length);
  return isStoredRelative(rest)
    ? rest
    : absolutePath;
}

/**
 * The stored form of a value a row already holds, whatever machine wrote it.
 *
 * An absolute value is cut after its last `/.claude/projects/`, so the
 * home before it, on whatever machine, is dropped. The last rather than
 * the first, because a folder name never holds a `/` and so never the
 * marker, while a home could.
 *
 * @param value - A row's `filePath`, or whatever the row holds there.
 * @returns The relative form for an absolute value under a projects root,
 *   and the value unchanged otherwise: a relative one, one outside the
 *   root, one whose rest is refused, and one that is not a string.
 */
export function storedLogPathOf<T>(value: T): T | string {
  if (typeof value !== 'string' || !isAbsolute(value)) return value;
  const at = value.lastIndexOf(PROJECT_LOG_MARKER);
  if (at === -1) return value;
  const rest = value.slice(at + PROJECT_LOG_MARKER.length);
  return isStoredRelative(rest)
    ? rest
    : value;
}

/**
 * The file a stored value names on this machine.
 *
 * @param stored - A row's stored `filePath`.
 * @param home - The reading machine's home directory.
 * @returns The absolute path under `<home>/.claude/projects/` for a
 *   relative value, the value itself for an absolute one, and `null` for a
 *   value refused as a relative path: empty, holding `\`, or climbing out
 *   of the root.
 */
export function resolveSessionLogPath(stored: string, home: string): string | null {
  if (isAbsolute(stored)) return stored;
  if (!isStoredRelative(stored)) return null;
  return join(projectLogRoot(home), stored);
}
