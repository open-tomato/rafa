/**
 * The Environment reading of `rafa doctor --deep`: the environment a
 * loop session would run with, the directory it would run in, and how
 * that environment differs from the shell's.
 *
 * It is a module of its own beside `./doctor-blocked.ts` rather than
 * more functions in `./doctor.ts`, which is 700-odd lines against the
 * 800-line cap (`context/source.md`). It reads files and answers data;
 * the lines `--deep` prints from it are another module's.
 *
 * ## What the session is handed
 *
 * Two layers, the second over the first:
 *
 *   1. **The spawn.** `sessionSpawnEnv(env)` (`src/utils/session-env.ts`),
 *      where `env` is the invocation's `RafaContext.env`: the function
 *      both spawn doors in `src/utils/claude.ts` call, called here
 *      rather than spelled again, so the reading cannot drift from what
 *      a spawn hands `Bun.spawn`.
 *   2. **The settings files.** Claude Code then assigns the `env`
 *      mapping of each settings file its `--setting-sources` loads onto
 *      its own environment, which every tool it runs inherits. The three
 *      files are the ones `src/inventory/disabled.ts` reads
 *      (`overrideSettingsPath`, `OVERRIDE_SCOPES`), nearest first:
 *      `.claude/settings.local.json` and `.claude/settings.json` under
 *      the project root, then `~/.claude/settings.json`. A file is
 *      loaded when `loop.settingSources` names its scope, and the
 *      nearest loaded file holding a key decides it: `local` over
 *      `project` over `user`, key by key, never file by file.
 *
 * A file whose scope `loop.settingSources` leaves out is still read, so
 * the reading can say which keys it holds and that the session is not
 * handed them — the one question about a user-level `env` under the
 * default `project,local` a person can otherwise only guess at.
 *
 * ## How Claude Code reads a settings `env`, as 2.1.280 does
 *
 * Read out of the Claude Code {@link SESSION_ENV_CLI_VERSION} binary on
 * 2026-09-24, not from documentation; a later version may move any of
 * it. Its startup runs, per enabled source in the order `user`,
 * `project`, `local`, `Object.assign(process.env, filterSettingsEnv(env))`
 * — which is why the nearest file wins a key and the farther files keep
 * the keys it does not set. Of the filter, this module models the rules
 * that hold for any key in any scope:
 *
 *   - **The value.** A string is taken as written, a number or a
 *     boolean as `String()` spells it, and anything else is ignored
 *     (`its value isn't a string, a number or a boolean`). Nothing is
 *     expanded: an `env.PATH` of `/opt/bin:$PATH` sets exactly that
 *     text, which is why a `PATH` written there REPLACES the shell's.
 *   - **The name.** An empty name, or one holding `=` or a control
 *     character ({@link isInvalidEnvName}), is ignored.
 *   - **A NUL** in a value has the entry ignored.
 *
 * Each ignored entry is one {@link SessionEnvWarning} here, and the
 * file's other entries still count.
 *
 * Not modelled, each read from the same binary and left out on purpose,
 * so a reading can name a key the session would not in fact be handed:
 * the list of keys a project-scoped file (`project`, `local`) may not
 * set — 88 names spelled out, such as `HOME`, `TMPDIR` and
 * `XDG_CONFIG_HOME`, beside one constant and two lists spread into it,
 * a list any release may change (`PATH` is not on it); the keys it
 * reserves for its own hosts and for managed providers; `NO_COLOR` and
 * `FORCE_COLOR`, which it routes apart from the rest; the `env` of
 * `~/.claude.json`, which it assigns BEFORE the settings files; and a
 * user settings file moved by `CLAUDE_CONFIG_DIR`. Policy settings sit
 * above all three files and are nobody's project file, as in
 * `disabled.ts`.
 *
 * ## An unreadable settings file is a warning, never a gap
 *
 * An absent file, or a file with no `env`, adds nothing and warns of
 * nothing. A file that exists and does not read, is not JSON or not a
 * mapping (`readSettings`'s own reasons), or holds an `env` that is not
 * a mapping, is one warning and adds nothing. How Claude Code treats a
 * settings file its schema refuses as a whole was not measured, so
 * dropping just that file's `env` is this reader's choice.
 *
 * ## The working directory
 *
 * A session runs in the rafa process's working directory, so the
 * reading carries the one it is handed ({@link SessionEnvSeams.cwd}),
 * beside the project root the settings paths were resolved under.
 * Claude Code 2.1.280 resolves `.claude/settings.json` against its own
 * working directory, not the git root: from a subdirectory of the
 * project the two differ, and this reading, which follows
 * `disabled.ts` in reading the project root's file, may then name a
 * file the session does not load. Both directories are carried so the
 * caller can say so.
 *
 * ## The differences from the shell
 *
 * Every key whose value the session would see differently from the
 * shell's `env` is one {@link EnvDifference}, naming the key and the
 * layer that set it, never its value: an environment holds tokens, and
 * a doctor report is pasted into issues. `PATH` is the exception, and
 * it is compared entry by entry instead ({@link PathDifference}): the
 * directories the session gains, the ones it loses, and whether the
 * directories both hold are searched in another order. Entries are
 * split by `pathDirectories` (`src/check/references.ts`), which drops
 * empty ones, and a directory named twice counts where it is first
 * named, since that is where a lookup finds it.
 *
 * {@link SessionEnvReading.env} still holds every value, for a caller
 * that looks a program up on the session's `PATH`; a caller printing
 * the reading prints the differences, not that.
 *
 * Nothing here throws, writes, or reads `process.env`, `process.cwd()`
 * or the real home: every input comes from {@link SessionEnvSeams}.
 */
import type { ClaudeSettingSource } from '../config-sections.js';
import type { SpawnEnv } from '../utils/session-env.js';

import { pathDirectories } from '../check/references.js';
import { describeValue, isMapping } from '../config-sections.js';
import { OVERRIDE_SCOPES, overrideSettingsPath, readSettings } from '../inventory/disabled.js';
import { sessionSpawnEnv } from '../utils/session-env.js';

/** The Claude Code version the settings `env` rules were read from. */
export const SESSION_ENV_CLI_VERSION = '2.1.280';

/** The settings key this module reads. */
export const SETTINGS_ENV_KEY = 'env';

/** The key compared entry by entry rather than as one value. */
export const PATH_KEY = 'PATH';

/** The code point ranges, inclusive, a name may not hold: C0 and C1 controls and DEL. */
const CONTROL_RANGES: readonly (readonly [number, number])[] = [[0x00, 0x1f], [0x7f, 0x9f]];

/** Who set a key the session sees: the spawn, or the settings file of a scope. */
export type EnvLayer = 'spawn' | ClaudeSettingSource;

/** What {@link readSessionEnv} reads through. */
export interface SessionEnvSeams {
  /** The shell's environment: the invocation's `RafaContext.env`. */
  readonly env: Readonly<SpawnEnv>;
  /** `loop.settingSources`, which decides the files the session loads. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The home the user settings file sits under. */
  readonly home: string;
  /** The project root the project settings files sit under; null outside a project. */
  readonly projectRoot: string | null;
  /** The directory the session would run in: the rafa process's own. */
  readonly cwd: string;
}

/** One settings file's `env`, as read. */
export interface SettingsEnvScope {
  readonly scope: ClaudeSettingSource;
  readonly path: string;
  /** True when `loop.settingSources` names the scope, so the session is handed its keys. */
  readonly loaded: boolean;
  /** Key to value, as Claude Code would take them, in the file's own order; ignored entries left out. */
  readonly entries: ReadonlyMap<string, string>;
}

/** One settings file, or one `env` entry in it, the reader could not use. */
export interface SessionEnvWarning {
  readonly scope: ClaudeSettingSource;
  readonly path: string;
  /** Whether the file's scope is one the session loads. */
  readonly loaded: boolean;
  /** Why, as one sentence fragment. */
  readonly reason: string;
}

/** One key the session sees differently from the shell. Never carries a value. */
export interface EnvDifference {
  readonly key: string;
  /** `added`: the shell has no value. `changed`: another value. `removed`: the session has none. */
  readonly kind: 'added' | 'changed' | 'removed';
  /** The layer that set the session's value; null for a removed key. */
  readonly layer: EnvLayer | null;
}

/** The session's `PATH` against the shell's, entry by entry. */
export interface PathDifference {
  /** The layer that set the session's `PATH`, or null when neither layer did. */
  readonly layer: EnvLayer | null;
  /** Directories the session searches and the shell does not, in the session's order. */
  readonly added: readonly string[];
  /** Directories the shell searches and the session does not, in the shell's order. */
  readonly removed: readonly string[];
  /** True when the directories both search come in another order. */
  readonly reordered: boolean;
}

/** What {@link readSessionEnv} answers. */
export interface SessionEnvReading {
  /** Every entry the session is handed. Holds values: see the module note before printing it. */
  readonly env: Readonly<SpawnEnv>;
  /** The directory the session runs in. */
  readonly cwd: string;
  /** The project root the project settings files were read under; null outside a project. */
  readonly projectRoot: string | null;
  /** `loop.settingSources`, as it was handed in. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** Every settings file with a path, nearest first, loaded or not. */
  readonly scopes: readonly SettingsEnvScope[];
  /** Every key but `PATH` the session sees differently, by key. */
  readonly differences: readonly EnvDifference[];
  /** How the session's `PATH` differs; null when it searches the same directories in the same order. */
  readonly path: PathDifference | null;
  readonly warnings: readonly SessionEnvWarning[];
}

/**
 * Whether Claude Code ignores an `env` entry by its name: an empty
 * name, or one holding `=` or a control character. The binary spells
 * it as the pattern `/^$|[=\x00-\x1f\x7f-\x9f]/`.
 */
export function isInvalidEnvName(name: string): boolean {
  if (name === '' || name.includes('=')) return true;
  return [...name].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return CONTROL_RANGES.some(([low, high]) => code >= low && code <= high);
  });
}

/** A value as Claude Code takes it: a string as written, a number or boolean through `String()`, else null. */
function scalarValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** One entry's value as Claude Code takes it, or why it ignores the entry. */
function entryValue(name: string, value: unknown): { readonly value: string } | { readonly reason: string } {
  if (isInvalidEnvName(name)) return { reason: 'is not a valid environment variable name' };
  const taken = scalarValue(value);
  if (taken === null) return { reason: `is ${describeValue(value)}, expected a string, a number or a boolean` };
  if (taken.includes('\0')) return { reason: 'holds a NUL character' };
  return { value: taken };
}

/** One scope's file read into its entries and warnings. */
function readScope(
  scope: ClaudeSettingSource,
  path: string,
  loaded: boolean,
): { readonly read: SettingsEnvScope; readonly warnings: readonly SessionEnvWarning[] } {
  const none: SettingsEnvScope = { scope, path, loaded, entries: new Map() };
  const warn = (reason: string): SessionEnvWarning => ({ scope, path, loaded, reason });

  const settings = readSettings(path);
  if (settings === null) return { read: none, warnings: [] };
  if (typeof settings === 'string') return { read: none, warnings: [warn(settings)] };
  if (!Object.hasOwn(settings, SETTINGS_ENV_KEY)) return { read: none, warnings: [] };

  const raw = settings[SETTINGS_ENV_KEY];
  if (!isMapping(raw)) {
    return { read: none, warnings: [warn(`has ${SETTINGS_ENV_KEY} ${describeValue(raw)}, expected a mapping`)] };
  }

  const entries = new Map<string, string>();
  const warnings: SessionEnvWarning[] = [];
  for (const [name, value] of Object.entries(raw)) {
    const taken = entryValue(name, value);
    if ('value' in taken) {
      entries.set(name, taken.value);
    } else {
      warnings.push(warn(`${SETTINGS_ENV_KEY} "${name}" ${taken.reason}, so Claude Code ignores it`));
    }
  }
  return { read: { scope, path, loaded, entries }, warnings };
}

/** Every settings file with a path, nearest first, and a warning per thing that did not read. */
function readScopes(seams: SessionEnvSeams): {
  readonly scopes: readonly SettingsEnvScope[];
  readonly warnings: readonly SessionEnvWarning[];
} {
  const read = OVERRIDE_SCOPES.flatMap((scope) => {
    const path = overrideSettingsPath(scope, { home: seams.home, projectRoot: seams.projectRoot });
    return path === null
      ? []
      : [readScope(scope, path, seams.settingSources.includes(scope))];
  });
  return { scopes: read.map((scope) => scope.read), warnings: read.flatMap((scope) => scope.warnings) };
}

/**
 * `spawned` with each loaded scope's entries assigned over it, farthest
 * first, so the nearest file holding a key decides it. Answers the
 * environment and, per key, the layer that set its value.
 */
function overlay(
  spawned: Readonly<SpawnEnv>,
  shell: Readonly<SpawnEnv>,
  scopes: readonly SettingsEnvScope[],
): { readonly env: SpawnEnv; readonly layers: ReadonlyMap<string, EnvLayer> } {
  const env: SpawnEnv = { ...spawned };
  const layers = new Map<string, EnvLayer>();
  for (const [key, value] of Object.entries(spawned)) {
    if (value !== shell[key]) layers.set(key, 'spawn');
  }
  for (const scope of [...scopes].reverse()) {
    if (!scope.loaded) continue;
    for (const [key, value] of scope.entries) {
      env[key] = value;
      layers.set(key, scope.scope);
    }
  }
  return { env, layers };
}

/** The keys `session` holds another value for than `shell`, `PATH` left out, by key. */
export function envDifferences(
  shell: Readonly<SpawnEnv>,
  session: Readonly<SpawnEnv>,
  layers: ReadonlyMap<string, EnvLayer>,
): readonly EnvDifference[] {
  const keys = [...new Set([...Object.keys(shell), ...Object.keys(session)])]
    .filter((key) => key !== PATH_KEY)
    .sort((a, b) => a.localeCompare(b));
  return keys.flatMap((key): EnvDifference[] => {
    const before = shell[key];
    const after = session[key];
    if (before === after) return [];
    if (after === undefined) return [{ key, kind: 'removed', layer: null }];
    const kind = before === undefined
      ? 'added'
      : 'changed';
    return [{ key, kind, layer: layers.get(key) ?? null }];
  });
}

/** `value`'s directories, each where it is first named. */
function firstNamed(value: string | undefined): readonly string[] {
  return [...new Set(pathDirectories(value))];
}

/**
 * The session's `PATH` against the shell's, entry by entry, or null when
 * both search the same directories in the same order. See the module
 * note for how entries are split and counted.
 */
export function pathDifference(
  shell: string | undefined,
  session: string | undefined,
  layer: EnvLayer | null,
): PathDifference | null {
  const before = firstNamed(shell);
  const after = firstNamed(session);
  const added = after.filter((entry) => !before.includes(entry));
  const removed = before.filter((entry) => !after.includes(entry));
  const sharedBefore = before.filter((entry) => after.includes(entry));
  const sharedAfter = after.filter((entry) => before.includes(entry));
  const reordered = sharedBefore.some((entry, index) => entry !== sharedAfter[index]);

  if (added.length === 0 && removed.length === 0 && !reordered) return null;
  return Object.freeze({ layer, added: Object.freeze(added), removed: Object.freeze(removed), reordered });
}

/**
 * The environment a loop session would be handed, where it would run,
 * and how that differs from the shell's. Reads the three settings files
 * and nothing else; never throws. See the module note.
 */
export function readSessionEnv(seams: SessionEnvSeams): SessionEnvReading {
  const { scopes, warnings } = readScopes(seams);
  const { env, layers } = overlay(sessionSpawnEnv(seams.env), seams.env, scopes);

  return Object.freeze({
    env: Object.freeze(env),
    cwd: seams.cwd,
    projectRoot: seams.projectRoot,
    settingSources: Object.freeze([...seams.settingSources]),
    scopes: Object.freeze(scopes),
    differences: Object.freeze(envDifferences(seams.env, env, layers)),
    path: pathDifference(seams.env[PATH_KEY], env[PATH_KEY], layers.get(PATH_KEY) ?? null),
    warnings: Object.freeze(warnings),
  });
}
