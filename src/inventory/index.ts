/**
 * The inventory of skills and agents: every source read, then
 * precedence, `shadowed-by:`, `disabled:` and `visibleToLoop` decided
 * over all of them at once.
 *
 * `trees.ts` reads the project, rafa and user tiers, `plugins.ts` the
 * plugins and the loaded add-ons, and `disabled.ts` the switches; each
 * answers rows that carry no state and no visibility, because both
 * depend on every other source. {@link buildInventory} is where they
 * meet and the only place either is decided.
 *
 * ## Precedence, nearest first
 *
 * `project`, `rafa`, `user`, `addon:<name>`, `plugin:<name>`
 * ({@link SOURCE_ORDER}). Add-ons keep the order their modules were
 * handed in, which is the configured load order, and plugins the
 * order `readPlugins` answers, which is by name. Rows are keyed by kind
 * and name, so a skill and an agent of one name never meet:
 *
 *   - The FIRST holder of a key is `enabled`, or `disabled:<how>` when
 *     {@link disabledState} switches it off.
 *   - Every later holder of that key is `shadowed-by:<first source>`,
 *     whether the first holder is enabled or disabled. A disabled
 *     project skill still holds its name, so the user skill of that name
 *     reads as shadowed by the project, not as the one that answers.
 *   - Two holders inside ONE source (a `SKILL.md` directory and a loose
 *     file of the same name, say) follow the same rule: the first in
 *     that source's own name-then-path order holds the name, and the
 *     second reads `shadowed-by:` its own source.
 *
 * A plugin row's name carries its plugin's prefix (`plugin:<p>` holds
 * `<p>:<name>`, see `plugins.ts`), so in practice a plugin item only
 * ever shadows or is shadowed by another holder of that prefixed name.
 *
 * ## `visibleToLoop`, under `loop.settingSources`
 *
 * True when a session the loop spawns with `--setting-sources` set to
 * {@link InventorySeams.settingSources} resolves the row:
 *
 * | Source | Visible when |
 * | --- | --- |
 * | `project` | always |
 * | `user` | `settingSources` includes `user` |
 * | `plugin:<name>` | `settingSources` includes `user`, where Claude Code records its plugins |
 * | `rafa`, `addon:<name>` | never: `claudeArgs` (`utils/claude.ts`) hands a session no directory of theirs |
 *
 * and false, whatever its source, for a row that is not `enabled`.
 *
 * These are the plan's rules, not a measurement. The live comparison
 * the next task adds (`src/tests/inventory-live.test.ts`) is what holds
 * them against a real session. One case in them is known to differ
 * from what a session resolves: a user item shadowed by a RAFA item of
 * the same name reads as not visible, while the session, which never
 * sees the rafa tier, loads the user one. The rule is kept as stated
 * so the two readings stay one decision each, and the test pins it so
 * a change to it is a visible one.
 *
 * ## Warnings travel with the rows
 *
 * An unreadable plugin record, plugin install or add-on manifest is one
 * {@link SourceWarning} in {@link Inventory.warnings}, and an unreadable
 * settings file or `skillOverrides` entry one {@link OverrideWarning} in
 * {@link Inventory.overrideWarnings}. Neither drops a row another source
 * could read, and an absent tier is kept as its listing in
 * {@link Inventory.trees}, so "holds nothing" and "is not there" stay
 * two answers here too.
 *
 * Nothing here reads the real home unless it is handed it: every path
 * comes from {@link InventorySeams}.
 */
import type { OverrideReading, OverrideWarning } from './disabled.js';
import type { AddonModule, PluginSeams, SourceWarning } from './plugins.js';
import type { InventoryKind, InventoryRecord, InventorySource, InventoryState } from './record.js';
import type { SourceItem, TreeListing } from './trees.js';
import type { ClaudeSettingSource } from '../config-sections.js';

import { disabledState, readSkillOverrides } from './disabled.js';
import { readAddons, readPlugins } from './plugins.js';
import { readTrees } from './trees.js';

/** The kinds of source, nearest first; a named source ranks by its prefix. */
export const SOURCE_ORDER = ['project', 'rafa', 'user', 'addon', 'plugin'] as const;

/** The kinds in the order the inventory lists them. */
const KIND_ORDER: readonly InventoryKind[] = ['skill', 'agent'];

/** What the inventory is built against. */
export interface InventorySeams extends PluginSeams {
  /** `loop.settingSources`, which decides {@link InventoryRecord.visibleToLoop}. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The configured modules; only the `loaded` ones are add-on sources. */
  readonly modules: readonly AddonModule[];
}

/** Every row, and what could not be read. */
export interface Inventory {
  /** Every row, by kind (skills first), then name, then precedence. */
  readonly records: readonly InventoryRecord[];
  /** The six tier listings `readTrees` answered, absent tiers included. */
  readonly trees: readonly TreeListing[];
  /** One per plugin record, plugin or add-on that did not read. */
  readonly warnings: readonly SourceWarning[];
  /** One per settings file, or `skillOverrides` entry, that did not read. */
  readonly overrideWarnings: readonly OverrideWarning[];
}

/** A source's rank in {@link SOURCE_ORDER}: its prefix for a named one. */
export function sourceRank(source: InventorySource): number {
  const prefix = source.split(':', 1)[0];
  return (SOURCE_ORDER as readonly string[]).indexOf(prefix ?? source);
}

/** Every source's rows in precedence order, stable within a source kind. */
function inPrecedence(items: readonly SourceItem[]): readonly SourceItem[] {
  return [...items].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
}

/** Whether a session under `settingSources` resolves an enabled row of `source`. */
export function sourceVisibleToLoop(
  source: InventorySource,
  settingSources: readonly ClaudeSettingSource[],
): boolean {
  if (source === 'project') return true;
  if (source === 'user' || source.startsWith('plugin:')) return settingSources.includes('user');
  return false;
}

/** The key a name is held under: kind and name, so a skill never shadows an agent. */
function holdKey(item: SourceItem): string {
  return `${item.kind}\u0000${item.name}`;
}

/**
 * States decided over rows already in precedence order: the first
 * holder of a key is enabled or disabled, each later one shadowed by
 * the first one's source. See the module note.
 */
export function applyPrecedence(
  items: readonly SourceItem[],
  overrides: OverrideReading,
  settingSources: readonly ClaudeSettingSource[],
): readonly InventoryRecord[] {
  const holders = new Map<string, InventorySource>();

  return items.map((item) => {
    const key = holdKey(item);
    const holder = holders.get(key);
    if (holder === undefined) holders.set(key, item.source);

    const state: InventoryState = holder === undefined
      ? disabledState(item, overrides) ?? 'enabled'
      : `shadowed-by:${holder}`;
    const visibleToLoop = state === 'enabled' && sourceVisibleToLoop(item.source, settingSources);

    return { ...item, state, visibleToLoop };
  });
}

/** Rows by kind, then name, then precedence, which {@link applyPrecedence} left them in. */
function forListing(records: readonly InventoryRecord[]): readonly InventoryRecord[] {
  return [...records].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.name.localeCompare(b.name));
}

/**
 * The inventory: every tier, loaded add-on and plugin read, with each
 * row's state and `visibleToLoop` decided. See the module note.
 */
export function buildInventory(seams: InventorySeams): Inventory {
  const trees = readTrees(seams);
  const addons = readAddons(seams.modules, seams);
  const plugins = readPlugins(seams);
  const overrides = readSkillOverrides(seams);

  const items = inPrecedence([
    ...trees.flatMap((listing) => listing.items),
    ...addons.items,
    ...plugins.items,
  ]);

  return {
    records: forListing(applyPrecedence(items, overrides, seams.settingSources)),
    trees,
    warnings: [...addons.warnings, ...plugins.warnings],
    overrideWarnings: overrides.warnings,
  };
}
