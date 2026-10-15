/**
 * `rafa config show [--resolved | --sources]`: every setting the
 * registry holds, read through `loadConfig` as any command reads it, and
 * printed in one of two views. Starts no Claude session and declares no
 * `spends`.
 *
 * ## The two views
 *
 * With no flag, or with `--resolved`, every setting with its merged
 * value, nested as a config file spells it: `pr.base` under `pr:` as
 * `base:`. Text mode prints that tree as YAML, two spaces a level, each
 * leaf written as JSON, which YAML reads as its flow form, so the text
 * parses as YAML to the same tree json mode gives. A map setting
 * (`routing`, `tiers.skills` and the like) is a leaf, written as one
 * JSON object.
 *
 * The values are the merged values, not a file's spelling of them, so
 * the text is not always a config file the reader accepts back:
 * `loop.settingSources` resolves to a list and a file spells it as a
 * comma-separated string, which the reader refuses a list for
 * (measured when the command was added).
 *
 * With `--sources`, every setting on a line of its own by its dotted key,
 * with its value, the layer that answered it and, for a file, the file
 * and the zero-based entry of it that last set it, as
 * `ResolvedConfig.provenance` (`src/core/config/config-origins.ts`)
 * records them. A YAML file is one entry, so its every setting is entry
 * 0. A setting no file answers names the layer `default` and no file.
 *
 * The settings come in one order in both views: the registry's
 * (`SETTING_NAMES`, `src/config-registry.ts`), each key grouped under the
 * first key that opened its section, so `loop.settingSources` and
 * `loop.worktreeDir` sit together in `--sources` as they do in the tree.
 *
 * ## The layers
 *
 * A layer is named as the plan's scopes name it, not as `ConfigSource`
 * spells it: `project` for the project's file (`file` in `sources`),
 * `user` for `~/.rafa/`'s, and `default`. `cli` is kept for a value a
 * command line gave, which this command never passes, so it does not
 * appear in practice.
 *
 * ## Exit codes
 *
 * 0 for a view printed. 1 for a line handing an argument, for both flags
 * at once, for a flag given a value, and for a config `loadConfig`
 * refuses, each problem on a line of its own. With `--output=json` the
 * {@link ConfigShowResult} is the data of the terminal result event.
 * The config's own warnings go through the active output's `warn`, as
 * every command loading the config writes them.
 */
import type { RafaCommand, RafaContext } from '../../core/command/index.js';
import type { ConfigSetting, ConfigSource, ResolvedConfig } from '../../core/config/index.js';

import { SETTING_BY_KEY, SETTING_NAMES, SETTINGS } from '../../config-registry.js';
import { CommandExit } from '../../core/command/index.js';
import { ConfigError } from '../../core/config/index.js';
import { loadConfig } from '../../core/config/load.js';
import { expectNoArgument, readSwitch, requireProject } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa config show';

/** The usage line a refusal ends with. */
export const CONFIG_SHOW_USAGE = 'rafa config show [--resolved | --sources]';

/** The exit code of every refusal. */
const REFUSED_EXIT = 1;

/** The indent of one level of the resolved tree. */
const INDENT = '  ';

/** The two views the command prints. */
export type ConfigShowView = 'resolved' | 'sources';

/** A layer as this command names it; see "The layers". */
export type ConfigShowLayer = 'cli' | 'project' | 'user' | 'default';

/** The settings nested as a config file spells them. */
export interface ConfigTree {
  readonly [key: string]: unknown;
}

/** One setting as `--sources` lists it. */
export interface ConfigShowSource {
  /** The dotted key a config file spells it by. */
  readonly key: string;
  /** The value it resolved to. */
  readonly value: unknown;
  /** The layer that answered it. */
  readonly layer: ConfigShowLayer;
  /** The file that answered it, or null for a default. */
  readonly file: string | null;
  /** The zero-based entry of that file that last set it, or null with no file. */
  readonly entry: number | null;
}

/** What json mode gives as the terminal result's `data`. */
export type ConfigShowResult =
  | { readonly view: 'resolved'; readonly config: ConfigTree }
  | { readonly view: 'sources'; readonly settings: readonly ConfigShowSource[] };

/** The layer names of each `ConfigSource`. */
const LAYER_OF: Readonly<Record<ConfigSource, ConfigShowLayer>> = Object.freeze({
  cli: 'cli',
  file: 'project',
  user: 'user',
  default: 'default',
});

/** A refusal naming `why` and the usage. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}.\nUsage: ${CONFIG_SHOW_USAGE}`);
}

/** The view the line's flags name: `resolved` unless `--sources` is typed; a refusal for both. */
export function readView(flags: RafaContext['flags']): ConfigShowView {
  const hint = `Usage: ${CONFIG_SHOW_USAGE}`;
  const resolved = readSwitch('resolved', flags['resolved'], hint);
  const sources = readSwitch('sources', flags['sources'], hint);
  if (resolved && sources) throw refusal('--resolved and --sources are two views; give one of them');
  return sources
    ? 'sources'
    : 'resolved';
}

/** True for a value that is a mapping and nothing else: no array, no map, no null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map);
}

/** `value` as JSON can hold it: each map an object, each array and object copied through. */
export function plainValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), plainValue(item)]));
  }
  if (Array.isArray(value)) return value.map(plainValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]));
  return value;
}

/** A tree with `value` set at the dotted `path`, a copy of `tree`; throws when a leaf stands on the way. */
function withLeaf(tree: ConfigTree, path: readonly string[], value: unknown): ConfigTree {
  const [head, ...rest] = path;
  if (head === undefined) throw new Error('a setting key is empty');
  if (rest.length === 0) return { ...tree, [head]: value };
  const below = tree[head] ?? {};
  if (!isRecord(below)) throw new Error(`the setting key ${path.join('.')} runs through a setting's value at ${head}`);
  return { ...tree, [head]: withLeaf(below, rest, value) };
}

/** Every setting's merged value, nested as the file spells it, in registry order. */
export function resolvedTree(config: ResolvedConfig['config']): ConfigTree {
  return SETTING_NAMES.reduce<ConfigTree>(
    (tree, setting) => withLeaf(tree, SETTINGS[setting].key.split('.'), plainValue(config[setting])),
    {},
  );
}

/** The dotted key of every leaf of `tree`, in the tree's own order. */
function leafKeys(tree: ConfigTree, above: readonly string[] = []): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = [...above, key];
    const setting = SETTING_BY_KEY.get(path.join('.'));
    if (setting !== undefined) return [path.join('.')];
    return isRecord(value)
      ? leafKeys(value, path)
      : [];
  });
}

/** The setting a dotted key names; throws for one the registry does not know. */
function settingOf(key: string): ConfigSetting {
  const setting = SETTING_BY_KEY.get(key);
  if (setting === undefined) throw new Error(`no setting is registered at ${key}`);
  return setting;
}

/** Every setting with its value, its layer and the file and entry that answered it; see the module note. */
export function sourceRows(resolved: ResolvedConfig): ConfigShowSource[] {
  return leafKeys(resolvedTree(resolved.config)).map((key) => {
    const setting = settingOf(key);
    const origin = resolved.provenance[setting];
    return {
      key,
      value: plainValue(resolved.config[setting]),
      layer: LAYER_OF[resolved.sources[setting]],
      file: origin?.file ?? null,
      entry: origin?.entry ?? null,
    };
  });
}

/** The view `view` names, read off `resolved`. */
export function configShowResult(resolved: ResolvedConfig, view: ConfigShowView): ConfigShowResult {
  return view === 'resolved'
    ? { view, config: resolvedTree(resolved.config) }
    : { view, settings: sourceRows(resolved) };
}

/**
 * The tree as YAML lines: a section on a line of its own, a setting as
 * JSON after its key. Whether a key is a setting is read off the
 * registry by its dotted path, so a map setting is one leaf.
 */
export function renderTree(tree: ConfigTree, above: readonly string[] = []): string[] {
  const indent = INDENT.repeat(above.length);
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = [...above, key];
    return isRecord(value) && !SETTING_BY_KEY.has(path.join('.'))
      ? [`${indent}${key}:`, ...renderTree(value, path)]
      : [`${indent}${key}: ${JSON.stringify(value)}`];
  });
}

/** One `--sources` line: the key, the value, and where it came from. */
function sourceLine(row: ConfigShowSource): string {
  const from = row.file === null
    ? row.layer
    : `${row.layer} ${row.file} entry ${String(row.entry ?? 0)}`;
  return `${row.key}: ${JSON.stringify(row.value)}  from ${from}`;
}

/** Every line one result prints. */
export function renderConfigShow(result: ConfigShowResult): string[] {
  return result.view === 'sources'
    ? result.settings.map(sourceLine)
    : renderTree(result.config);
}

/** Loads the config and shows the view the line names; see the module note. */
async function runShow(context: RafaContext): Promise<void> {
  expectNoArgument(context.args, CONFIG_SHOW_USAGE);
  const view = readView(context.flags);
  const project = requireProject(context, COMMAND_NAME);
  let resolved: ResolvedConfig;
  try {
    resolved = await loadConfig({ root: project.root, home: project.home });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(REFUSED_EXIT, [`❌ ${COMMAND_NAME}: the config cannot be used:`, ...error.problems.map((problem) => `  ${problem}`)].join('\n'));
  }
  const result = configShowResult(resolved, view);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderConfigShow(result)) context.output.info(line);
}

/** The command; see the module note. */
export function createConfigShowCommand(): RafaCommand {
  const command: RafaCommand = {
    name: 'config show',
    subject: 'config',
    action: 'show',
    summary: 'print every setting with its merged value, or with the layer, file and entry it came from',
    description: 'Prints every setting the config reads, resolved as every command resolves it: the'
      + ' project\'s file over the user scope\'s under `~/.rafa/`, each over the default, the file of a'
      + ' scope being the first of `rafa.config.ts`, `rafa.config.mjs` and `.rafa/config.yaml` that exists.'
      + ' With no flag or `--resolved`, every setting with its merged value, nested as a config file spells'
      + ' it and printed as YAML, each value written as JSON. With `--sources`, one line per setting by its'
      + ' dotted key: its value, the layer that answered it (`project`, `user` or `default`) and, for a'
      + ' file, the file and the zero-based entry of it that last set the setting; a YAML file is one'
      + ' entry, entry 0. Exit code 1 for an argument, for both flags at once, and for a config that'
      + ' cannot be used, each problem named. With `--output=json` the view is the data of the terminal'
      + ' result event: the nested settings under `config`, or the rows under `settings`. Starts no session.',
    args: [],
    flags: [
      {
        name: 'resolved',
        description: 'Print every setting with its merged value, nested as the file spells it; the default view.',
        type: 'boolean',
      },
      {
        name: 'sources',
        description: 'Print every setting with its value, its layer, and the file and entry it came from.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa config show',
        note: 'Prints every setting with the value it resolved to, as YAML nested by section.',
      },
      {
        cmd: 'rafa config show --sources',
        note: 'Prints each setting with its value and where it came from: the layer, the file and the entry.',
      },
      {
        cmd: 'rafa config show --sources --output=json',
        note: 'Gives one row per setting, with its key, value, layer, file and entry, as the terminal result.',
      },
    ],
    outputs: ['text', 'json'],
    run: runShow,
  };
  return Object.freeze(command);
}

const command: RafaCommand = createConfigShowCommand();
export default command;
