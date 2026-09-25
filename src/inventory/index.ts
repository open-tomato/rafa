/**
 * The inventory of skills and agents: every source read, then
 * precedence, `shadowed-by:`, `disabled:` and `visibleToLoop` decided
 * over all of them at once.
 *
 * `trees.ts` reads the project, rafa and user tiers, `plugins.ts` the
 * plugins and the loaded add-ons, and `disabled.ts` the switches; each
 * answers rows that carry no state and no visibility, because both
 * depend on every other source. {@link buildInventory} is where they
 * meet and the only place either is decided, the tier rows' part of it
 * taken from `resolveTiers` (`tiers/resolve.ts`).
 *
 * ## The three tiers: state from `resolveTiers`
 *
 * Rows of `project`, `rafa` and `user` are not ranked here. They are
 * handed to `resolveTiers` (`tiers/resolve.ts`) under the seams'
 * {@link TierSettings}, and each row's state is read off the outcome
 * for its kind and name ({@link Inventory.resolution}). So the tier
 * order, which tiers are loaded, pins, `false`, collisions and the
 * byte-identical rule are decided once, there, and not restated:
 *
 * | Outcome | The row that holds the name | Every other row of the name |
 * | --- | --- | --- |
 * | `served` | the winner: `enabled`, or `disabled:<how>` when {@link disabledState} switches it off | `shadowed-by:<winner's source>` |
 * | `collision` | each loaded tier's holder: `collision` | `shadowed-by:<nearest loaded holder's source>` |
 * | `off` | the nearest holder: `disabled:tiers.skills` or `disabled:tiers.agents` | `shadowed-by:<its source>` |
 * | `unloaded` | the nearest holder: `disabled:tiers.rafa` in the rafa tier, else as `served` | `shadowed-by:<its source>` |
 *
 * A byte-identical copy of the winner therefore reads as shadowed by
 * it, never as a collision, and a pin can make a farther tier's row the
 * enabled one and a nearer row `shadowed-by:` it. Unlike the plain
 * precedence below, a tier row's state can move with
 * `loop.settingSources`: a project item and a different user item of
 * one name are `enabled` and `shadowed-by:project` without `user`, and
 * both `collision` with it.
 *
 * ## Add-ons and plugins: precedence, nearest first
 *
 * `resolveTiers` leaves these rows out, so they keep the inventory's
 * own precedence, behind the three tiers: `addon:<name>`, then
 * `plugin:<name>` ({@link SOURCE_ORDER}). Add-ons keep the order their
 * modules were handed in, which is the configured load order, and
 * plugins the order `readPlugins` answers, which is by name. Rows are
 * keyed by kind and name, so a skill and an agent of one name never
 * meet:
 *
 *   - A name any tier holds is `shadowed-by:` the source of the row
 *     that holds it in the table above.
 *   - Otherwise the FIRST holder of a key is `enabled`, or
 *     `disabled:<how>` when {@link disabledState} switches it off, and
 *     every later holder `shadowed-by:<first source>`, whether the
 *     first is enabled or disabled.
 *
 * A plugin row's name carries its plugin's prefix (`plugin:<p>` holds
 * `<p>:<name>`, see `plugins.ts`), so in practice a plugin item only
 * ever shadows or is shadowed by another holder of that prefixed name.
 *
 * ## `visibleToLoop`, under `loop.settingSources`
 *
 * True when a session the loop spawns with `--setting-sources` set to
 * {@link InventorySeams.settingSources} resolves the row, or is handed
 * it through the served directory (`tiers/serve.ts`):
 *
 * | Source | Visible when |
 * | --- | --- |
 * | `project` | always |
 * | `user` | `settingSources` includes `user` |
 * | `plugin:<name>` | `settingSources` includes `user`, where Claude Code records its plugins |
 * | `rafa` | it is being served: the winner of its name, and `serveVerdict` admits it |
 * | `addon:<name>` | never: `claudeArgs` (`utils/claude.ts`) hands a session no directory of theirs |
 *
 * and false, whatever its source, for a row that is not `enabled`.
 * `serveVerdict` is the check `serveResolution` makes before it copies
 * a winner, so an unreviewed third-party rafa item, which is not
 * served, is not visible either. A user item shadowed by a rafa item
 * no longer differs from what a session resolves: the served rafa item
 * is what the session gets.
 *
 * These are rules, not a measurement. The live comparison
 * (`src/tests/inventory-live.test.ts`) holds the project rows against a
 * real session, and the spawned serving test the rafa ones.
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
import type { Resolution, TierItem, TierRow, TierSettings } from '../tiers/resolve.js';

import { CONFIG_DEFAULTS } from '../config-schema.js';
import { isSkillTier } from '../schema/tiers.js';
import { pinKey, readItemBytes, resolveTiers } from '../tiers/resolve.js';
import { serveVerdict } from '../tiers/serve.js';

import { disabledState, readSkillOverrides } from './disabled.js';
import { readAddons, readPlugins } from './plugins.js';
import { readTrees } from './trees.js';

/** The kinds of source, nearest first; a named source ranks by its prefix. */
export const SOURCE_ORDER = ['project', 'rafa', 'user', 'addon', 'plugin'] as const;

/** The kinds in the order the inventory lists them. */
const KIND_ORDER: readonly InventoryKind[] = ['skill', 'agent'];

/**
 * What the inventory is built against: the {@link TierSettings}
 * `resolveTiers` reads, which a `RafaConfig` supplies. `tiersRafa`,
 * `tiersSkills` and `tiersAgents` fall back to `CONFIG_DEFAULTS` when
 * absent, as `entry` falls back to `Bun.main`; a command reading a
 * project's config passes all three.
 */
export interface InventorySeams extends PluginSeams, Partial<Omit<TierSettings, 'settingSources'>> {
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
  /** What `resolveTiers` made of the tier rows, which their states were read from. */
  readonly resolution: Resolution;
  /** One per plugin record, plugin or add-on that did not read. */
  readonly warnings: readonly SourceWarning[];
  /** One per settings file, or `skillOverrides` entry, that did not read. */
  readonly overrideWarnings: readonly OverrideWarning[];
}

/** What decides a row's state and visibility besides the row itself. */
export interface PrecedenceReading {
  /** The `skillOverrides` reading {@link disabledState} consults. */
  readonly overrides: OverrideReading;
  /** `loop.settingSources`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** `resolveTiers` over the same rows' tier part. */
  readonly resolution: Resolution;
  /** Whether a rafa-tier winner is served; `serveVerdict` in {@link buildInventory}. */
  readonly isServed: (row: TierRow) => boolean;
}

/** A source's rank in {@link SOURCE_ORDER}: its prefix for a named one. */
export function sourceRank(source: InventorySource): number {
  const prefix = source.split(':', 1)[0];
  return (SOURCE_ORDER as readonly string[]).indexOf(prefix ?? source);
}

/** The {@link TierSettings} of `seams`, each absent one at its config default. */
export function tierSettings(seams: InventorySeams): TierSettings {
  return {
    settingSources: seams.settingSources,
    tiersRafa: seams.tiersRafa ?? CONFIG_DEFAULTS.tiersRafa,
    tiersSkills: seams.tiersSkills ?? CONFIG_DEFAULTS.tiersSkills,
    tiersAgents: seams.tiersAgents ?? CONFIG_DEFAULTS.tiersAgents,
  };
}

/** Every source's rows in precedence order, stable within a source kind. */
function inPrecedence(items: readonly SourceItem[]): readonly SourceItem[] {
  return [...items].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
}

/**
 * Whether a session under `settingSources` resolves an enabled row of
 * `source`. A rafa row is visible only when `isServed`, which the
 * caller answers for that row: see the module note.
 */
export function sourceVisibleToLoop(
  source: InventorySource,
  settingSources: readonly ClaudeSettingSource[],
  isServed = false,
): boolean {
  if (source === 'project') return true;
  if (source === 'rafa') return isServed;
  if (source === 'user' || source.startsWith('plugin:')) return settingSources.includes('user');
  return false;
}

/** The key a name is held under: kind and name, so a skill never shadows an agent. */
function holdKey(item: { readonly kind: InventoryKind; readonly name: string }): string {
  return `${item.kind}\u0000${item.name}`;
}

/** Whether `a` and `b` are one row: one source and one definition file. */
function sameRow(a: TierRow, b: TierRow): boolean {
  return a.source === b.source && a.path === b.path;
}

/** The row holding `item`'s name, which every other row of it is shadowed by. */
function tierHolder(item: TierItem): TierRow {
  const holder = item.state === 'served'
    ? item.winner
    : item.state === 'collision'
      ? item.loaded[0]
      : item.holders[0];
  if (holder === undefined) throw new Error(`tierHolder: ${item.kind} ${item.name} has no holder`);
  return holder;
}

/** A row's state and visibility, before `...item` is spread under them. */
interface Decided {
  readonly state: InventoryState;
  readonly visibleToLoop: boolean;
}

/** The first-holder state {@link disabledState} leaves `enabled` or switches off. */
function holderState(item: SourceItem, reading: PrecedenceReading, isServed: boolean): Decided {
  const state = disabledState(item, reading.overrides) ?? 'enabled';
  return {
    state,
    visibleToLoop: state === 'enabled' && sourceVisibleToLoop(item.source, reading.settingSources, isServed),
  };
}

/** A tier row's state from its name's outcome. See "The three tiers". */
function tierState(item: SourceItem, tier: TierItem, reading: PrecedenceReading): Decided {
  if (tier.state === 'collision' && tier.loaded.some((row) => sameRow(row, item))) {
    return { state: 'collision', visibleToLoop: false };
  }
  const holder = tierHolder(tier);
  if (!sameRow(holder, item)) return { state: `shadowed-by:${holder.source}`, visibleToLoop: false };
  if (tier.state === 'off') return { state: `disabled:${pinKey(item.kind)}`, visibleToLoop: false };
  if (tier.state === 'unloaded' && item.source === 'rafa') return { state: 'disabled:tiers.rafa', visibleToLoop: false };
  if (tier.state === 'unloaded') return { ...holderState(item, reading, false), visibleToLoop: false };
  return holderState(item, reading, item.source === 'rafa' && reading.isServed(item));
}

/**
 * States decided over rows already in precedence order: tier rows from
 * `reading.resolution`, add-on and plugin rows behind them, first
 * holder enabled or disabled and each later one shadowed. See the
 * module note.
 */
export function applyPrecedence(
  items: readonly SourceItem[],
  reading: PrecedenceReading,
): readonly InventoryRecord[] {
  const outcomes = new Map(reading.resolution.items.map((tier) => [holdKey(tier), tier]));
  const holders = new Map<string, InventorySource>();

  return items.map((item) => {
    const key = holdKey(item);
    const tier = outcomes.get(key);
    if (tier !== undefined && isSkillTier(item.source)) return { ...item, ...tierState(item, tier, reading) };
    if (tier !== undefined) return { ...item, state: `shadowed-by:${tierHolder(tier).source}`, visibleToLoop: false };

    const holder = holders.get(key);
    if (holder !== undefined) return { ...item, state: `shadowed-by:${holder}`, visibleToLoop: false };
    holders.set(key, item.source);
    return { ...item, ...holderState(item, reading, false) };
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

  const tierRows = trees.flatMap((listing) => listing.items);
  const resolution = resolveTiers(tierRows, tierSettings(seams), readItemBytes);
  const items = inPrecedence([...tierRows, ...addons.items, ...plugins.items]);
  const reading: PrecedenceReading = {
    overrides,
    settingSources: seams.settingSources,
    resolution,
    isServed: (row) => serveVerdict(row).ok,
  };

  return {
    records: forListing(applyPrecedence(items, reading)),
    trees,
    resolution,
    warnings: [...addons.warnings, ...plugins.warnings],
    overrideWarnings: overrides.warnings,
  };
}
