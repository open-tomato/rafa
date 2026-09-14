/**
 * Finding and reading rafa's two config files, and printing what they
 * warn about: the disk half of the config, over the pure half in
 * `config.ts`, which parses each file and ranks the layers.
 *
 * The file is `config-load.ts` and not `config/load.ts` for the reason
 * `config-sections.ts` gives: a `src/config/` directory beside
 * `config.ts` would set the trap `context/source.md` records for
 * `./plan`.
 *
 * ## Two scopes
 *
 * The PROJECT's `.rafa/config.yaml` sits under the repo root and the
 * USER scope's under the home directory, the two scopes of
 * `.specs/phase-1-installable.md`. {@link loadConfig} reads both and
 * hands them to `resolveConfig`, which ranks the project's over the
 * user's key by key: a project file naming `store` leaves every other
 * setting to the user's file, and the user's leaves what it does not
 * name to the default.
 *
 * A root that IS the home, compared after symlinks are followed, holds
 * one file, and it is read once, as the project's. Read as both, it
 * would answer every setting from the project layer all the same and
 * warn twice about each unknown key.
 *
 * ## The home is a seam
 *
 * {@link loadConfig} takes the home as an argument and never looks it
 * up. A command entry passes `homedir()`, and a test passes a directory
 * of its own. There is no default, so a caller that leaves the home out
 * fails loudly rather than reading the real `~/.rafa/config.yaml`:
 * measured on bun 1.3.14, `isAbsolute(undefined)` throws a `TypeError`.
 * That is what holds the suite off the operator's home. Most machines
 * have no user config, so a case reading the real one would pass there
 * and fail only on a machine that has one.
 *
 * A home that is not an absolute path is refused with a
 * {@link ConfigError}. Measured on bun 1.3.14, `homedir()` hands a
 * relative `HOME` back as written, `HOME=rel/home` answering `rel/home`,
 * and a file read under it would be whatever the working directory
 * holds at that path. An empty `HOME` never arrives here: `homedir()`
 * answers the account's home for it.
 *
 * ## Judging order
 *
 * Both files are read and judged before the command line is looked at,
 * the user's first, and the first file with a problem refuses the run
 * with every problem it has. Each file is judged whole, whatever
 * outranks it: an unusable `store` in the user's file is refused even
 * where the project's names one, because the next project without one
 * would run on it.
 *
 * ## Existence
 *
 * "When the file exists" is decided with `existsSync`, and the choice
 * is measured rather than habitual: `Bun.file(path).exists()` answers
 * false for a DIRECTORY, so a `.rafa/config.yaml` that is one would
 * pass for no config and the run would go on at defaults. Only absence
 * is absorbed — the rule `effort/store.ts` applies to its own files —
 * and anything at the path that cannot be read is refused.
 */
import type { ConfigFile, ConfigOverrides, ResolvedConfig } from './config.js';

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { describeValue, messageOf } from './config-sections.js';
import { ConfigError, configFilePath, parseConfigText, resolveConfig } from './config.js';

/** The two directories {@link loadConfig} reads a config file under. */
export interface ConfigRoots {
  /** The project root. Its `.rafa/config.yaml` is the project's file. */
  readonly root: string;
  /** The home directory. Its `.rafa/config.yaml` is the user scope's. */
  readonly home: string;
}

/**
 * Reads `.rafa/config.yaml` under `root`, or answers null when nothing
 * is at that path. Anything there that cannot be read — a directory,
 * a file without read permission — is refused with a
 * {@link ConfigError} rather than read as absent; see the module note.
 */
export function readConfigFile(root: string): ConfigFile | null {
  const path = configFilePath(root);
  if (!existsSync(path)) return null;

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const problem = `${path}: cannot be read (${messageOf(error)})`;
    throw new ConfigError([problem], { cause: error });
  }
  return parseConfigText(text, path);
}

/**
 * True when both paths name one existing directory, symlinks followed.
 * A path that does not resolve holds no config file, so reading it as
 * a directory of its own reads nothing twice.
 */
function isSameDirectory(first: string, second: string): boolean {
  try {
    return realpathSync(first) === realpathSync(second);
  } catch {
    return false;
  }
}

/**
 * The user scope's file under `home`, or null when there is none or the
 * home is the project root. Refuses a home that is not an absolute
 * path; see the module note.
 */
function readUserConfigFile({ root, home }: ConfigRoots): ConfigFile | null {
  if (!isAbsolute(home)) {
    throw new ConfigError([
      `home directory is ${describeValue(home)}, expected an absolute path`,
    ]);
  }
  return isSameDirectory(root, home)
    ? null
    : readConfigFile(home);
}

/** The default warning sink. */
function printWarning(message: string): void {
  console.warn(message);
}

/**
 * Reads the project's config under `roots.root` and the user scope's
 * under `roots.home`, ranks both against `cli`, and prints a warning per
 * unknown key through `warn`.
 *
 * The files are read and judged before the command line is looked at,
 * the user's first, so a run with problems in all three reports the
 * user file's alone. See the module note for the home.
 */
export function loadConfig(
  roots: ConfigRoots,
  cli: ConfigOverrides = {},
  warn: (message: string) => void = printWarning,
): ResolvedConfig {
  const user = readUserConfigFile(roots);
  const file = readConfigFile(roots.root);
  const resolved = resolveConfig({ cli, file, user });
  for (const warning of resolved.warnings) warn(warning);
  return resolved;
}
