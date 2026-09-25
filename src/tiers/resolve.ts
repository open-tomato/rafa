/**
 * Which holder of a skill or agent name a loop session is served, decided
 * over the three tiers in one fixed order: project, then rafa, then user.
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` makes this one pure resolver the
 * answer every later reader takes: the inventory's state, the doctor's
 * collision rows, and the refusals `loop start`'s preflight and
 * `rafa plan validate` make. {@link resolveTiers} reads inventory rows
 * and the four settings that decide what loads. It walks no directory and
 * reads no config. Wiring it into those readers is left to them.
 *
 * ## Only loaded tiers count
 *
 * A tier takes part only when a session the loop spawns would load it
 * ({@link loadedTiers}):
 *
 *   - `project` always, as `sourceVisibleToLoop` in `inventory/index.ts`
 *     answers for a project row.
 *   - `rafa` unless `tiers.rafa` is `off`.
 *   - `user` only when `loop.settingSources` includes `user`.
 *
 * A holder in a tier that is not loaded still appears in
 * {@link TierItem.holders}, so a listing can show it, but it never wins
 * and never collides. A name no loaded tier holds reads `unloaded`.
 * Plugins and add-ons are outside the three tiers, as the spec says, so
 * rows of `plugin:<name>` or `addon:<name>` are left out. They keep the
 * inventory's own precedence.
 *
 * ## One holder per tier
 *
 * Rows are keyed by kind and bare name, so a skill and an agent of one
 * name never meet. Rows may come in any order, and are taken in tier
 * order. When one tier holds a name twice, for example a `SKILL.md`
 * directory and a loose file, the first row that tier was handed holds
 * it, as `applyPrecedence` decides. The spec defines a collision across
 * TWO tiers, so a second holder inside one tier is never one.
 *
 * ## The outcome for one name
 *
 * The settings are read in this order, and the first that applies
 * decides:
 *
 *   1. `false` in `tiers.skills` or `tiers.agents` turns the name off
 *      in every tier (`off`). An item switched off never collides.
 *   2. No loaded tier holds it (`unloaded`).
 *   3. A pin naming a loaded tier that holds the name serves that
 *      tier's holder (`served`, by `pin`). The pin is the one declared
 *      collision. A pin naming a tier that is not loaded, or that holds
 *      nothing under the name, has no effect, and the order decides.
 *      `resolveConfig` already warns about a pin to the rafa tier while
 *      it is off. It is not refused here, because the operator may
 *      switch the tier back on. A skill pin naming a copy Claude Code
 *      would not load has no effect either (below).
 *   4. All loaded holders are one item (below), so the nearest serves
 *      it (`served`, by `order`), and the rest are its
 *      {@link ServedItem.copies}.
 *   5. Otherwise the name is a `collision`, and nothing serves it.
 *
 * ## A skill pin must name the copy Claude Code loads
 *
 * rafa serves only winners, but it does not decide which copy of a
 * skill a session runs: Claude Code loads the project's and a loaded
 * user tier's `.claude/skills/<name>` by itself, and a served skill
 * reaches it through `--add-dir` (`tiers/delivery.ts`). Claude Code's
 * own order for one skill name is {@link CLAUDE_SKILL_ORDER}: user, then
 * project, then the `--add-dir` copy. That is not the tier order above,
 * which is kept: it still decides which of byte-identical copies serves,
 * and which tiers load.
 *
 * The order was measured on 2026-09-25 against Claude Code 2.1.280, in a
 * scratch git repository. Each copy of one skill told the session to
 * reply with its own word, and every mix ran beside a control holding
 * one copy alone. The stream-json `init` event listed the name once in
 * every run, so the reply is the only thing that shows which copy
 * loaded. Under `--setting-sources project,local` a project skill beat
 * the `--add-dir` copy. Under `user,project,local` a user skill beat the
 * project's (three runs) and the `--add-dir` copy (two runs).
 *
 * So a skill pin has no effect while a loaded holder in a tier Claude
 * Code ranks above the pinned one differs from the pinned copy
 * ({@link outrankingHolders}), and the name stays a `collision`:
 *
 *   - a `rafa` pin, while the project or a loaded user tier holds a
 *     different copy;
 *   - a `project` pin, while a loaded user tier holds a different copy;
 *   - a `user` pin never, since nothing outranks a loaded user skill.
 *
 * {@link TierCollision.setAsidePin} records the pin and
 * {@link TierCollision.outrankedBy} the copies that outrank it.
 * {@link collisionMessage} names the two ways out: the pin that works,
 * which is {@link TierCollision.pinLine}, or deleting or renaming those
 * copies. A byte-identical copy is the same item, so it never sets a
 * pin aside.
 *
 * Agents keep their pins. A served agent goes through `--agents`, and
 * the same kind of probe, run on the same day and version under
 * `user,project,local`, found an `--agents` agent outranks both a
 * project and a user agent of the name: with the project copy, with the
 * user copy, and with both. That held as the session's `--agent`, which
 * is how a loop session is dispatched, and as a subagent through the
 * Agent tool, and each single-copy control replied with its own word.
 * The same runs found a project agent outranks a user agent, so a
 * `user` agent pin against a differing project agent does not reach the
 * session. The resolver does not act on that.
 *
 * ## Byte-identical holders are one item
 *
 * Two holders are the same item when their definition files are
 * byte-identical after every line holding rafa's `vendored by rafa`
 * header ({@link VENDORED_HEADER}) is removed. `rafa agent vendor`
 * writes that header on a line of its own (`commands/agent/vendor.ts`),
 * so a copy it made compares equal to its source. The comparison reads
 * the bytes as `latin1`, which maps each byte to one character, so it
 * is exact where a UTF-8 decode would fold every invalid sequence into
 * U+FFFD. A file the reader cannot read equals nothing.
 *
 * Only the row's own `path` is compared: an agent's file, or a skill's
 * `SKILL.md`. Supporting files beside a `SKILL.md` are not read, so two
 * skill directories with one `SKILL.md` and different scripts count as
 * one item, served by the nearer. The spec speaks of an item's file,
 * in the singular, and this module follows it.
 *
 * The bytes come through the {@link ReadItemBytes} seam, and it is
 * called only for a name held in two or more loaded tiers. The
 * resolver is pure given its seam. {@link readItemBytes} is the seam
 * that reads the disk.
 *
 * ## What a collision carries
 *
 * Every distinct holder, each the nearest of its byte-identical group,
 * so a refusal names both paths, or all three. It also carries
 * {@link TierCollision.pinLine}, the one config line that settles it.
 * For an agent that line pins the nearest holder's tier, since that
 * holder would have won by order. For a skill it pins the tier of the
 * copy Claude Code loads first, so the line it suggests is never one
 * the resolver sets aside. It is written the way the spec writes a pin,
 * `tiers.skills: { documentation: project }`, with the key path dotted
 * as every config message spells it. {@link collisionMessage} is the
 * sentence a refusal prints. A collision a skill pin failed to settle
 * also carries that pin and the copies that outrank it (see "A skill
 * pin must name the copy Claude Code loads").
 */
import type { ClaudeSettingSource, TierPin, TierSwitch } from '../config-sections.js';
import type { InventoryKind, InventorySource } from '../inventory/record.js';
import type { SkillTier } from '../schema/tiers.js';

import { readFileSync } from 'node:fs';

import { isSkillTier, SKILL_TIERS } from '../schema/tiers.js';

/** One inventory row as the resolver reads it; a `SourceItem` or an `InventoryRecord` is one. */
export interface TierRow {
  readonly kind: InventoryKind;
  /** The bare name the row is held under. */
  readonly name: string;
  readonly source: InventorySource;
  /** Absolute path of the definition file, the one the byte comparison reads. */
  readonly path: string;
}

/** The settings that decide what loads; a `RafaConfig` is one. */
export interface TierSettings {
  /** `loop.settingSources`: `user` in it loads the user tier. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** `tiers.rafa`: `off` unloads the rafa tier. */
  readonly tiersRafa: TierSwitch;
  /** `tiers.skills`: a skill turned off or pinned, by name. */
  readonly tiersSkills: ReadonlyMap<string, TierPin>;
  /** `tiers.agents`: an agent turned off or pinned, by name. */
  readonly tiersAgents: ReadonlyMap<string, TierPin>;
}

/** A definition file's bytes, or null when it cannot be read. */
export type ReadItemBytes = (path: string) => Uint8Array | null;

/** What every outcome for one name carries. */
interface TierItemBase {
  readonly kind: InventoryKind;
  readonly name: string;
  /** Every row of the name in the three tiers, loaded or not, nearest tier first. */
  readonly holders: readonly TierRow[];
  /** The one holder of each loaded tier, nearest first. */
  readonly loaded: readonly TierRow[];
  /** The name's `tiers.skills` or `tiers.agents` value, or null when it has none. */
  readonly pin: TierPin | null;
}

/** A name served by one holder. */
export interface ServedItem extends TierItemBase {
  readonly state: 'served';
  /** The holder the session is served. */
  readonly winner: TierRow;
  /** `pin` when a pin chose the winner, `order` when the tier order did. */
  readonly decidedBy: 'pin' | 'order';
  /** Loaded holders byte-identical to the winner: copies a doctor can suggest deleting. */
  readonly copies: readonly TierRow[];
  /** Loaded holders that differ from the winner, which a pin set aside. */
  readonly overridden: readonly TierRow[];
}

/** Two or more loaded tiers holding different items under one name, with no pin. */
export interface CollisionItem extends TierItemBase {
  readonly state: 'collision';
  readonly collision: TierCollision;
}

/** A name `false` turned off in every tier. */
export interface OffItem extends TierItemBase {
  readonly state: 'off';
}

/** A name held only in tiers a session does not load. */
export interface UnloadedItem extends TierItemBase {
  readonly state: 'unloaded';
}

/** The outcome for one kind and name. */
export type TierItem = ServedItem | CollisionItem | OffItem | UnloadedItem;

/** A refused collision: the distinct holders and the line that settles it. */
export interface TierCollision {
  readonly kind: InventoryKind;
  readonly name: string;
  /** One holder per distinct item, nearest first, two at least. */
  readonly holders: readonly TierRow[];
  /** The config line pinning the nearest holder's tier. */
  readonly pinLine: string;
  /**
   * The tier a skill pin named that cannot take effect, because a copy
   * Claude Code loads over it differs. Null when no pin was set aside.
   * See "A skill pin must name the copy Claude Code loads".
   */
  readonly setAsidePin: SkillTier | null;
  /**
   * The loaded holders Claude Code loads over the set-aside pin's copy,
   * in {@link CLAUDE_SKILL_ORDER}. Empty when no pin was set aside.
   */
  readonly outrankedBy: readonly TierRow[];
}

/** Every name the three tiers hold, resolved. */
export interface Resolution {
  /** The tiers a session loads, nearest first. */
  readonly loadedTiers: readonly SkillTier[];
  /** One per kind and name, skills first, then by name. */
  readonly items: readonly TierItem[];
  /** The collisions among {@link items}, in the same order. */
  readonly collisions: readonly TierCollision[];
}

/**
 * A line of rafa's vendoring header, as `sourceHeader` in
 * `commands/agent/vendor.ts` writes it.
 */
export const VENDORED_HEADER = /^<!-- vendored by rafa from .* on \d{4}-\d{2}-\d{2} -->$/;

/**
 * The order Claude Code itself loads one skill name in, the copy a
 * session runs first: a loaded user skill, then the project's, then the
 * `--add-dir` copy rafa serves. Measured on Claude Code 2.1.280; see "A
 * skill pin must name the copy Claude Code loads".
 */
export const CLAUDE_SKILL_ORDER: readonly SkillTier[] = ['user', 'project', 'rafa'];

/** The kinds in the order a resolution lists them. */
const KIND_ORDER: readonly InventoryKind[] = ['skill', 'agent'];

/** A name a flow mapping can carry unquoted. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The tiers a session under `settings` loads, nearest first. See "Only loaded tiers count". */
export function loadedTiers(settings: TierSettings): readonly SkillTier[] {
  return SKILL_TIERS.filter((tier) => tier === 'project'
    || (tier === 'rafa' && settings.tiersRafa !== 'off')
    || (tier === 'user' && settings.settingSources.includes('user')));
}

/** The config key a kind's pins live under. */
export function pinKey(kind: InventoryKind): 'tiers.skills' | 'tiers.agents' {
  return kind === 'skill'
    ? 'tiers.skills'
    : 'tiers.agents';
}

/** The config line pinning `name` of `kind` to `tier`. */
export function pinLine(kind: InventoryKind, name: string, tier: SkillTier): string {
  const key = PLAIN_NAME.test(name)
    ? name
    : JSON.stringify(name);
  return `${pinKey(kind)}: { ${key}: ${tier} }`;
}

/**
 * The sentence a refusal prints for `collision`: every path, then the pin
 * line. When a skill pin was set aside, it names the copies Claude Code
 * loads over the pinned one, and the two ways out: the pin that works,
 * or deleting or renaming those copies.
 */
export function collisionMessage(collision: TierCollision): string {
  const places = collision.holders
    .map((holder) => `${holder.source} ${holder.path}`)
    .join(' and ');
  const held = `${collision.kind} ${collision.name} is held by ${collision.holders.length} loaded tiers `
    + `with different contents: ${places}; `;
  const tier = collision.setAsidePin;
  if (tier === null) return `${held}pin the tier that serves it: ${collision.pinLine}`;
  const over = collision.outrankedBy;
  const tiers = over.map((holder) => holder.source).join(' and ');
  const copies = over.length === 1
    ? 'copy'
    : 'copies';
  const paths = over.map((holder) => holder.path).join(' and ');
  return `${held}${pinLine(collision.kind, collision.name, tier)} has no effect, because Claude Code loads `
    + `the ${tiers} ${copies} over the ${tier} copy: pin the copy it loads (${collision.pinLine}), `
    + `or delete or rename ${paths} to let the ${tier} copy serve`;
}

/** A file's bytes, or null when it cannot be read. The seam that reads the disk. */
export function readItemBytes(path: string): Uint8Array | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** `bytes` as the text the comparison reads: `latin1`, with the vendoring header removed. */
export function comparableText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
    .split('\n')
    .filter((line) => !VENDORED_HEADER.test(line))
    .join('\n');
}

/** A row's tier: the index of its source in {@link SKILL_TIERS}. */
function tierIndex(row: TierRow): number {
  return (SKILL_TIERS as readonly string[]).indexOf(row.source);
}

/** Tier rows grouped by kind and name, each group nearest tier first. */
function groupByName(rows: readonly TierRow[]): ReadonlyMap<string, readonly TierRow[]> {
  const groups = new Map<string, TierRow[]>();
  for (const row of rows) {
    if (!isSkillTier(row.source)) continue;
    const key = `${row.kind}\u0000${row.name}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return new Map([...groups].map(([key, group]) => [
    key,
    [...group].sort((a, b) => tierIndex(a) - tierIndex(b)),
  ]));
}

/** The first holder of each loaded tier, nearest first. */
function loadedHolders(holders: readonly TierRow[], tiers: readonly SkillTier[]): readonly TierRow[] {
  return tiers.flatMap((tier) => {
    const holder = holders.find((row) => row.source === tier);
    return holder === undefined
      ? []
      : [holder];
  });
}

/**
 * `holders` split into groups of one item each, nearest first within a
 * group and by nearest member across them. An unreadable file is a
 * group of its own.
 */
function sameItemGroups(holders: readonly TierRow[], read: ReadItemBytes): readonly (readonly TierRow[])[] {
  if (holders.length < 2) return [holders];

  const groups: { text: string | null; rows: TierRow[] }[] = [];
  for (const row of holders) {
    const bytes = read(row.path);
    const text = bytes === null
      ? null
      : comparableText(bytes);
    const group = text === null
      ? undefined
      : groups.find((candidate) => candidate.text === text);
    if (group === undefined) groups.push({ text, rows: [row] });
    else group.rows.push(row);
  }
  return groups.map((group) => group.rows);
}

/** The served outcome with `winner`, splitting the rest into copies and overridden. */
function served(
  base: TierItemBase,
  winner: TierRow,
  decidedBy: ServedItem['decidedBy'],
  groups: readonly (readonly TierRow[])[],
): ServedItem {
  const same = groups.find((group) => group.includes(winner)) ?? [winner];
  return {
    ...base,
    state: 'served',
    winner,
    decidedBy,
    copies: same.filter((row) => row !== winner),
    overridden: base.loaded.filter((row) => !same.includes(row)),
  };
}

/** A skill holder's place in {@link CLAUDE_SKILL_ORDER}: lower loads first. */
function claudeRank(row: TierRow): number {
  return (CLAUDE_SKILL_ORDER as readonly string[]).indexOf(row.source);
}

/**
 * The loaded holders Claude Code loads over the `pinned` skill: in a tier
 * it ranks above the pinned one, and not byte-identical to it. Empty for
 * an agent. See "A skill pin must name the copy Claude Code loads".
 */
export function outrankingHolders(
  pinned: TierRow,
  loaded: readonly TierRow[],
  groups: readonly (readonly TierRow[])[],
): readonly TierRow[] {
  if (pinned.kind !== 'skill') return [];
  const same = groups.find((group) => group.includes(pinned)) ?? [pinned];
  return loaded
    .filter((row) => claudeRank(row) < claudeRank(pinned) && !same.includes(row))
    .sort((a, b) => claudeRank(a) - claudeRank(b));
}

/**
 * The tier the pin line of a collision names: for a skill, the tier of
 * the copy Claude Code loads first; for an agent, the nearest loaded
 * tier. `loaded` is nearest first and never empty here.
 */
function workingPinTier(kind: InventoryKind, loaded: readonly TierRow[]): SkillTier {
  const [first] = kind === 'skill'
    ? [...loaded].sort((a, b) => claudeRank(a) - claudeRank(b))
    : loaded;
  return first !== undefined && isSkillTier(first.source)
    ? first.source
    : 'project';
}

/** The outcome for one name's holders. See "The outcome for one name". */
function resolveItem(
  holders: readonly TierRow[],
  settings: TierSettings,
  tiers: readonly SkillTier[],
  read: ReadItemBytes,
): TierItem {
  const [first] = holders;
  if (first === undefined) throw new Error('resolveItem: a name with no holder');
  const { kind, name } = first;
  const pins = kind === 'skill'
    ? settings.tiersSkills
    : settings.tiersAgents;
  const base: TierItemBase = {
    kind,
    name,
    holders,
    loaded: loadedHolders(holders, tiers),
    pin: pins.get(name) ?? null,
  };

  if (base.pin === false) return { ...base, state: 'off' };
  const [nearest] = base.loaded;
  if (nearest === undefined) return { ...base, state: 'unloaded' };

  const groups = sameItemGroups(base.loaded, read);
  const pinned = base.loaded.find((row) => row.source === base.pin);
  const outrankedBy = pinned === undefined
    ? []
    : outrankingHolders(pinned, base.loaded, groups);
  if (pinned !== undefined && outrankedBy.length === 0) return served(base, pinned, 'pin', groups);
  if (groups.length === 1) return served(base, nearest, 'order', groups);

  const distinct = groups.flatMap((group) => group.slice(0, 1));
  const setAsidePin = pinned !== undefined && isSkillTier(pinned.source)
    ? pinned.source
    : null;
  return {
    ...base,
    state: 'collision',
    collision: {
      kind,
      name,
      holders: distinct,
      pinLine: pinLine(kind, name, workingPinTier(kind, base.loaded)),
      setAsidePin,
      outrankedBy,
    },
  };
}

/**
 * Every skill and agent name the three tiers hold, resolved under
 * `settings`: served, a collision, off, or unloaded. `read` is called
 * only for a name held in two or more loaded tiers. See the module note.
 */
export function resolveTiers(
  rows: readonly TierRow[],
  settings: TierSettings,
  read: ReadItemBytes,
): Resolution {
  const tiers = loadedTiers(settings);
  const items = [...groupByName(rows).values()]
    .map((holders) => resolveItem(holders, settings, tiers, read))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || a.name.localeCompare(b.name));

  return {
    loadedTiers: tiers,
    items,
    collisions: items.flatMap((item) => item.state === 'collision'
      ? [item.collision]
      : []),
  };
}

/** The outcome for `kind` and `name` in `resolution`, or undefined when no tier holds it. */
export function findTierItem(
  resolution: Resolution,
  kind: InventoryKind,
  name: string,
): TierItem | undefined {
  return resolution.items.find((item) => item.kind === kind && item.name === name);
}
