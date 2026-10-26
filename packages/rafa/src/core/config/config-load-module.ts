/**
 * The helpers `config-load.ts` reads a module file (`rafa.config.ts`,
 * `rafa.config.mjs`) through: the `false` the merge removes set back,
 * the entry that last touched each setting, and the refusal of a module
 * it imports and cannot find.
 *
 * They sit beside the loader rather than in it so `config-load.ts`,
 * which reads two places per scope, stays under the 800-line ceiling of
 * `context/source.md`. The rules they apply are the loader's, argued in
 * its module note under "Reading a scope's file" and "Refusals"; nothing
 * here reads a file, and no file outside `config-load.ts` imports this
 * one.
 */
import type { Mapping } from './config-sections.js';
import type { ConfigSetting } from './config.js';
import type { LoadResult, Provenance } from '@open-tomato/define-config';

import { isMapping } from './config-sections.js';
import { activeSettingByKey, activeSettings } from './section.js';

/** The package a config module imports its types from. */
const RAFA_PACKAGE = '@open-tomato/rafa';

/**
 * The package a bare specifier installs, or null for a relative, an
 * absolute or a `node:` one.
 */
function packageOf(specifier: string): string | null {
  if (/^(?:[./]|node:)/.test(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0] ?? null;
}

/**
 * The refusal of a module file importing `specifier`, which cannot be
 * found from it: the file, the module and, for a package, the install.
 *
 * @param path - The module file.
 * @param specifier - The import it could not resolve.
 * @returns One problem sentence.
 */
export function missingModuleProblem(path: string, specifier: string): string {
  const installed = packageOf(specifier);
  const install = installed === null
    ? ''
    : `; install ${installed} in the project (bun add -d ${installed})`;
  const typesOnly = installed === RAFA_PACKAGE
    ? `, or import its types alone (import type { Config } from '${RAFA_PACKAGE}/config'), which need nothing at run time`
    : '';
  return `${path}: imports ${specifier}, which cannot be found from this file${install}${typesOnly}`;
}

/** True when a later entry than `entry` removed or replaced a mapping above `path`. */
function wipedAbove(path: string, entry: number, provenance: Provenance): boolean {
  const parts = path.split('.');
  return parts.some((_, depth) => {
    const records = provenance.get(parts.slice(0, depth).join('.')) ?? [];
    return records.some((record) => record.entry > entry && record.kind !== 'set');
  });
}

/** `mapping` with `false` at `path`, where every mapping above it stands and the key is absent. */
function withFalseAt(mapping: Mapping, path: readonly string[]): Mapping {
  const [head, ...rest] = path;
  if (head === undefined) return mapping;
  const present = Object.hasOwn(mapping, head);
  if (rest.length === 0) {
    return present
      ? mapping
      : { ...mapping, [head]: false };
  }
  const child = present
    ? mapping[head]
    : undefined;
  return isMapping(child)
    ? { ...mapping, [head]: withFalseAt(child, rest) }
    : mapping;
}

/**
 * False when `path` is an id of a keyed map whose reader refuses `false`
 * there, such as `logger.modules.<module>`: a `false` at such an id
 * removes it, as `src/config/entry.ts` documents. True anywhere else.
 */
function isFalseAValueAt(path: readonly string[]): boolean {
  const setting = activeSettingByKey().get(path.slice(0, -1).join('.'));
  const spec = setting === undefined
    ? undefined
    : activeSettings()[setting];
  const id = path.at(-1);
  if (spec === undefined || id === undefined) return true;
  return spec.read({ [id]: false }, { label: spec.key, key: spec.key }).problems.length === 0;
}

/**
 * A module file's merged value with each `false` the merge removed set
 * back, unless a later entry removed or replaced a mapping above it or
 * the key's reader refuses `false` there; see "Reading a scope's file"
 * in `config-load.ts`.
 *
 * @param result - What define-config's loader read off the file.
 * @returns The mapping the file's settings are read from.
 */
export function restoredMapping({ config, provenance }: LoadResult): Mapping {
  const removed = [...provenance]
    .flatMap(([path, records]) => {
      const last = records.at(-1);
      return path === '' || last?.kind !== 'remove' || wipedAbove(path, last.entry, provenance)
        ? []
        : [path.split('.')];
    })
    .filter(isFalseAValueAt)
    .sort((first, second) => first.length - second.length);
  return removed.reduce(withFalseAt, config);
}

/**
 * The last entry that touched each registered setting of a module file,
 * its key or a key below it: what `provenance` names.
 *
 * @param provenance - The loader's record of every key the file's entries set.
 * @returns The entry by setting, for the settings the file touched.
 */
export function entriesOf(provenance: Provenance): ReadonlyMap<ConfigSetting, number> {
  const entries = new Map<ConfigSetting, number>();
  for (const [setting, spec] of Object.entries(activeSettings())) {
    if (spec === undefined) continue;
    const below = `${spec.key}.`;
    for (const [path, records] of provenance) {
      if (path !== spec.key && !path.startsWith(below)) continue;
      const last = Math.max(...records.map((record) => record.entry));
      entries.set(setting as ConfigSetting, Math.max(last, entries.get(setting as ConfigSetting) ?? 0));
    }
  }
  return entries;
}
