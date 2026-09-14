/**
 * Imports the command entries of modules and mounts each under
 * `module/<name>`, turning every failure into a warning that names the
 * file and loading the rest.
 *
 * `bun build` bundles what static imports reach, and core's roster is a
 * static list for that reason. A module's command entry lives outside
 * the bundle, so it is imported at run time, and this is where that
 * happens. `.specs/cli-surface.md` fixes the rule: an import failure is
 * logged at warn level with the file path, and nothing disappears
 * silently. open-tomato's autoload swallowed a broken command file with
 * an empty `catch`, and the command vanished from the roster.
 *
 * ## The unit is the file
 *
 * Each entry names a module and one absolute file, whose default export
 * is the module's `RafaCommand[]` (`.specs/modules-and-addons.md`, under
 * `commands.entry`). A file is mounted whole or skipped whole, with one
 * warning, and the entries after it still load. It is skipped when:
 *
 *   - the path is not absolute, since a relative one would resolve
 *     against this module rather than against anything the caller
 *     meant;
 *   - importing it throws, a syntax error included;
 *   - its default export is not a list;
 *   - the registry refuses the mount: a command failing the shape check,
 *     one declaring `exec`, an action declared twice, a name that is not
 *     a word, or a module mounted twice.
 *
 * The warning reads `module "<name>": skipped <file>: <reason>`, the
 * reason being the first line of what was thrown or a sentence naming
 * what was found. Nothing is written here: the warnings are answered as
 * data, and the dispatcher writes them through the invocation's output
 * after its start event, so a json stream stays one event per line.
 *
 * Which modules to load is the caller's to say. Enabling a module and
 * reading its manifest are phase 7's, so until then the dispatcher's
 * caller passes no entry and nothing is imported.
 */
import type { RafaCommand } from './command.js';
import type { CommandRegistry } from './registry.js';

import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describeValue } from '../config-sections.js';

/** One module's command entry: the name its commands mount under, and the file exporting them. */
export interface ModuleCommandEntry {
  /** The word typed after an `exec` action. */
  readonly name: string;
  /** The absolute path of the file whose default export is the module's commands. */
  readonly entry: string;
}

/** Imports one entry file, answering its module namespace. */
export type ModuleImporter = (entry: string) => Promise<unknown>;

/** The registry with every entry that loaded mounted, and a warning for each that did not. */
export interface LoadedModuleCommands {
  readonly registry: CommandRegistry;
  readonly warnings: readonly string[];
}

/** Imports an entry file by its absolute path, through a file URL. */
export const importModuleEntry: ModuleImporter = (entry) => import(pathToFileURL(entry).href);

/** The first line of what was thrown that holds anything. */
function firstLine(error: unknown): string {
  const text = error instanceof Error
    ? error.message
    : String(error);
  return text.split('\n').find((line) => line.trim() !== '') ?? describeValue(text);
}

/** The commands a module namespace exports as its default, or the reason there are none. */
function defaultCommands(loaded: unknown): { commands: readonly RafaCommand[] } | { reason: string } {
  const exported = typeof loaded === 'object' && loaded !== null
    ? (loaded as { default?: unknown }).default
    : undefined;
  return Array.isArray(exported)
    ? { commands: exported as readonly RafaCommand[] }
    : { reason: `its default export is ${describeValue(exported)}, expected a list of commands` };
}

/**
 * Imports each entry in order and mounts its commands on `registry`,
 * answering the registry every entry that loaded is mounted on and a
 * warning for each that was skipped. Never throws for an entry; see the
 * module note.
 */
export async function loadModuleCommands(
  registry: CommandRegistry,
  entries: readonly ModuleCommandEntry[],
  importModule: ModuleImporter = importModuleEntry,
): Promise<LoadedModuleCommands> {
  let mounted = registry;
  const warnings: string[] = [];

  for (const { name, entry } of entries) {
    const skip = (reason: string): void => {
      warnings.push(`module ${describeValue(name)}: skipped ${describeValue(entry)}: ${reason}`);
    };
    if (typeof entry !== 'string' || !isAbsolute(entry)) {
      skip('expected an absolute path');
      continue;
    }

    let loaded: unknown;
    try {
      loaded = await importModule(entry);
    } catch (error) {
      skip(`import failed: ${firstLine(error)}`);
      continue;
    }

    const exported = defaultCommands(loaded);
    if ('reason' in exported) {
      skip(exported.reason);
      continue;
    }
    try {
      mounted = mounted.mount({ name, entry, commands: exported.commands });
    } catch (error) {
      skip(firstLine(error));
    }
  }

  return { registry: mounted, warnings: Object.freeze(warnings) };
}
