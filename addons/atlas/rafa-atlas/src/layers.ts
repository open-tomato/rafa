/**
 * `readAtlasLayers`: the `atlas` section of the project's tracked config
 * (`rafa.config.ts`), read into the ordered list of layers the import
 * flow card draws as its columns (spec C8). The runtime hands the section
 * to the module's command whole and unread, as `ctx.moduleConfig`
 * (decision D10 keeps Atlas off core's `loadConfig`), so this module is
 * the one that validates it:
 *
 *   - `layers`: an ordered list, the columns from left to right, each a
 *     `{ name, modules }` mapping. `name` is a string holding something
 *     besides white space; `modules` a list of the modules the layer
 *     holds, each named by its package (`@open-tomato/rafa-core`) or, for
 *     a module with no package, by its folder as the module scan writes
 *     it in `module_facts.path` (`src/commands`).
 *
 * An undefined section, or a `null` one (which core reads as saying
 * nothing), answers no layers, as does a section with no `layers` key.
 * A section that does not parse throws `AtlasConfigError` naming every
 * problem at once: a section or a layer that is not a mapping, `layers`
 * or `modules` that is not a list, a blank or repeated layer name, a
 * module that is not a string holding something, a module listed twice,
 * in one layer or in two, and an unknown key at either level.
 *
 * `layerOf` places a module: the first layer listing its package or its
 * folder, with its rank, the layer's place in the list from 0, or null
 * for a module no layer lists (the card's `unassigned` column, and NULL
 * `layer` and `layer_rank` in `module_facts`).
 */
import { AtlasConfigError } from './config.js';

/** What `AtlasConfigError` names as the place of a problem of the section. */
export const ATLAS_SECTION = 'the atlas section of the project config';

/** One layer: its name and the modules it holds, each a package name or a module folder. */
export interface AtlasLayer {
  readonly name: string;
  readonly modules: readonly string[];
}

/** The `atlas` section as the project's config writes it. */
export interface AtlasSection {
  readonly layers?: readonly AtlasLayer[];
}

/** Where a module sits: its layer's name and that layer's place in the list, from 0. */
export interface LayerPlace {
  readonly layer: string;
  readonly rank: number;
}

/** The keys the section holds. */
const SECTION_KEYS: readonly string[] = ['layers'];

/** The keys a layer holds. */
const LAYER_KEYS: readonly string[] = ['name', 'modules'];

/** True for a plain mapping. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a string holding something besides white space. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Names each key of `record` outside `known`. */
function unknownKeys(record: Record<string, unknown>, known: readonly string[], prefix: string, problems: string[]): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) problems.push(`${prefix}${key} is not a key Atlas reads; it reads ${known.map((name) => `${prefix}${name}`).join(' and ')}`);
  }
}

/** The name of the layer at `at`, or null with a problem named when it is blank or not a string. */
function readName(value: unknown, at: string, problems: string[]): string | null {
  if (isFilled(value)) return value;
  problems.push(`${at}.name is ${JSON.stringify(value) ?? 'missing'}, expected a layer name holding something`);
  return null;
}

/** The modules of the layer at `at`, each one a string holding something; a problem named for each other entry. */
function readModules(value: unknown, at: string, problems: string[]): readonly string[] {
  if (!Array.isArray(value)) {
    problems.push(`${at}.modules is ${JSON.stringify(value) ?? 'missing'}, expected a list of package names or module folders`);
    return [];
  }
  return (value as readonly unknown[]).flatMap((module, index) => {
    if (isFilled(module)) return [module];
    problems.push(`${at}.modules[${index}] is ${JSON.stringify(module)}, expected a package name or a module folder`);
    return [];
  });
}

/** The layer at `index`, or null when it is not a mapping; every problem in it named. */
function readLayer(value: unknown, index: number, problems: string[]): AtlasLayer | null {
  const at = `layers[${index}]`;
  if (!isRecord(value)) {
    problems.push(`${at} is ${JSON.stringify(value)}, expected a mapping holding name and modules`);
    return null;
  }
  unknownKeys(value, LAYER_KEYS, `${at}.`, problems);
  const name = readName(value['name'], at, problems);
  const modules = readModules(value['modules'], at, problems);
  return name === null
    ? null
    : { name, modules };
}

/** Names each layer name used more than once, and each module listed more than once. */
function repeats(layers: readonly AtlasLayer[], problems: string[]): void {
  const names = new Set<string>();
  const homes = new Map<string, string>();
  for (const layer of layers) {
    if (names.has(layer.name)) problems.push(`layer ${JSON.stringify(layer.name)} is named more than once`);
    names.add(layer.name);
    for (const module of layer.modules) {
      const home = homes.get(module);
      if (home === undefined) homes.set(module, layer.name);
      else if (home === layer.name) problems.push(`${module} is listed twice in layer ${JSON.stringify(home)}`);
      else problems.push(`${module} is listed in layer ${JSON.stringify(home)} and in layer ${JSON.stringify(layer.name)}`);
    }
  }
}

/** The layers `section` writes, or every problem in it. */
function readSection(section: unknown, problems: string[]): readonly AtlasLayer[] {
  if (!isRecord(section)) {
    problems.push(`the section is ${JSON.stringify(section)}, expected a mapping holding layers`);
    return [];
  }
  unknownKeys(section, SECTION_KEYS, '', problems);
  const layers = section['layers'];
  if (layers === undefined) return [];
  if (!Array.isArray(layers)) {
    problems.push(`layers is ${JSON.stringify(layers)}, expected a list of { name, modules } mappings`);
    return [];
  }
  const read = (layers as readonly unknown[])
    .map((layer, index) => readLayer(layer, index, problems))
    .filter((layer): layer is AtlasLayer => layer !== null);
  repeats(read, problems);
  return read;
}

/**
 * The layers the `atlas` section `value` lists, in its order; none when
 * the section is undefined or null. Throws `AtlasConfigError`, naming
 * {@link ATLAS_SECTION} and every problem at once, for a section that
 * does not parse.
 */
export function readAtlasLayers(value: unknown): readonly AtlasLayer[] {
  if (value === undefined || value === null) return [];
  const problems: string[] = [];
  const layers = readSection(value, problems);
  if (problems.length > 0) throw new AtlasConfigError(ATLAS_SECTION, problems);
  return layers;
}

/**
 * The layer of the module at folder `path` whose package is
 * `packageName` (null for a module with no package): the first layer
 * listing either, with its rank, or null when no layer lists the module.
 */
export function layerOf(layers: readonly AtlasLayer[], path: string, packageName: string | null): LayerPlace | null {
  const rank = layers.findIndex((layer) => layer.modules.some((module) => module === path || module === packageName));
  return rank === -1
    ? null
    : { layer: (layers[rank] as AtlasLayer).name, rank };
}
