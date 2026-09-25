/**
 * The Settings reading of `rafa doctor --deep`: the setting sources a
 * loop session loads, and every agent, skill and MCP server configured
 * on this machine that such a session is not handed.
 *
 * A module of its own beside `./doctor-deep-env.ts`, as `./doctor.ts`
 * is near the 800-line cap (`context/source.md`). It re-derives
 * nothing: which items exist and whether a session sees them is
 * `buildInventory`'s `visibleToLoop` (`src/inventory/index.ts`), which
 * `skillOverrides` entry switched a skill off is `readSkillOverrides`'
 * (`src/inventory/disabled.ts`), and which MCP server a `-p` session
 * starts is `readMcpServers`, `isLoadedUnder` and `mcpServerFor`
 * (`src/inventory/mcp.ts`). Their rules, and the Claude Code version
 * they were measured against, are documented there, not here.
 *
 * {@link readDeepSettings} reads into data; {@link settingsSection}
 * turns that data into the rows `./doctor-deep-row.ts` renders.
 *
 * ## The rows
 *
 *   1. **One per setting source**, nearest first (`local`, `project`,
 *      `user`): `ok` when `loop.settingSources` names it, `note` when
 *      it does not. Neither carries a fix: leaving `user` out is the
 *      config default and a choice, not a fault, and the rows below say
 *      what the choice hides.
 *   2. **One `note` per hidden item**, grouped by source: every
 *      `local` item, then `project`, then `user`, then each plugin by
 *      name; within a group skills, agents, then MCP servers, each by
 *      name. The row names the source, the kind and the item, says why
 *      a session does not get it, and always carries a fix
 *      ({@link HiddenItem}).
 *   3. **One `warn` per file the readers could not use**, so a hidden
 *      item missing because its file did not parse is not read as
 *      "nothing hidden".
 *
 * ## What counts as hidden, and each fix
 *
 * A skill or agent row with `visibleToLoop: false`, read by its
 * inventory `state` first:
 *
 * | Reading | Fix |
 * | --- | --- |
 * | `shadowed-by:<source>` | rename it, or remove the nearer one |
 * | `collision` | the pin line `resolveTiers` answers for the name (`tiers/resolve.ts`) |
 * | `disabled:tiers.skills` or `disabled:tiers.agents` | remove the name's `false` from that config key |
 * | `disabled:skillOverrides` | remove the entry from the settings file that holds it |
 * | `disabled:<frontmatter key>` | remove the key from the definition |
 * | enabled, source not loaded | add `user` to `loop.settingSources` |
 *
 * Rows of the `rafa` and `addon:<name>` sources are left out whatever
 * they read. No session is ever handed an add-on's (`claudeArgs` passes
 * no directory of theirs), and a hidden rafa row is one rafa does not
 * serve (`inventory/index.ts`): shadowed, colliding, switched off or
 * unreviewed. A report listing rafa's own bundled items as problems
 * would bury the rows that are. That is a reading of "configured":
 * these are shipped by rafa and its modules, not configured for
 * sessions.
 *
 * An MCP declaration is hidden when it is not the one `mcpServerFor`
 * answers for its name under `loop.settingSources`, read in
 * `isLoadedUnder`'s order: its scope's source is off, then
 * `disabledMcpServers` names it, then a loaded settings file's
 * `disabledMcpjsonServers` rejects it; a declaration that would load
 * but loses its name to a nearer loaded one is shadowed.
 *
 * Only the first reason is given, the one to fix first: a `user` skill
 * shadowed by a `project` one under the default sources is reported as
 * shadowed.
 *
 * Nothing here throws, writes, or reads the real home: every path comes
 * from {@link DeepSettingsSeams}.
 */
import type { DeepRow, DeepSection } from './doctor-deep-row.js';
import type { ClaudeSettingSource } from '../config-sections.js';
import type { OverrideReading } from '../inventory/disabled.js';
import type { Inventory, InventorySeams } from '../inventory/index.js';
import type { McpDeclaration, McpReading } from '../inventory/mcp.js';
import type { InventoryRecord } from '../inventory/record.js';
import type { Resolution } from '../tiers/resolve.js';

import { join } from 'node:path';

import { CONFIG_FILE } from '../config.js';
import { OVERRIDE_DISABLED, OVERRIDES_KEY, overrideFor, overrideSettingsPath, readSkillOverrides } from '../inventory/disabled.js';
import { buildInventory } from '../inventory/index.js';
import { CLAUDE_JSON_FILE, DISABLE_KEY, MCP_SCOPES, mcpServerFor, PROJECTS_KEY, readMcpServers, REJECT_KEY } from '../inventory/mcp.js';
import { pinKey } from '../tiers/resolve.js';

/** The section's title. */
export const SETTINGS_SECTION_TITLE = 'Settings';

/** The config key the fixes name. */
export const SETTING_SOURCES_KEY = 'loop.settingSources';

/** What {@link readDeepSettings} reads through: the inventory's seams, which hold the MCP reader's. */
export type DeepSettingsSeams = InventorySeams;

/** What a hidden item is. */
export type HiddenKind = 'skill' | 'agent' | 'mcp server';

/** One configured item a loop session is not handed, with why and the fix. */
export interface HiddenItem {
  readonly kind: HiddenKind;
  readonly name: string;
  /** The group it is listed under: an inventory source, or an MCP scope. */
  readonly source: string;
  /** The file that declares it. */
  readonly path: string;
  /** Why a session does not get it, as one sentence fragment. */
  readonly why: string;
  /** What to do so a session gets it. */
  readonly fix: string;
}

/** One file, or one entry in it, a reader could not use. */
export interface SettingsWarning {
  readonly path: string;
  readonly reason: string;
}

/** What {@link readDeepSettings} answers. */
export interface DeepSettingsReading {
  /** `loop.settingSources`, as handed in. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** Every hidden item, in the order the section lists them; see the module note. */
  readonly hidden: readonly HiddenItem[];
  /** Every warning of the inventory, the overrides and the MCP readers. */
  readonly warnings: readonly SettingsWarning[];
}

/** The fix for an item a source left out of `loop.settingSources` hides. */
function addSourceFix(source: ClaudeSettingSource): string {
  return `add ${source} to ${SETTING_SOURCES_KEY} in ${CONFIG_FILE}`;
}

/** Why an item a source left out hides, beside the sources it was read under. */
function sourceOffWhy(source: ClaudeSettingSource, settingSources: readonly ClaudeSettingSource[]): string {
  return `${SETTING_SOURCES_KEY} (${listed(settingSources)}) leaves out ${source}`;
}

/** Sources as a comma list, or `none`. */
function listed(sources: readonly string[]): string {
  return sources.length === 0
    ? 'none'
    : sources.join(', ');
}

/** Whether a record's source is one this section lists, rafa's and add-ons' left out; see the module note. */
function isSessionSource(record: InventoryRecord): boolean {
  return !(record.source === 'rafa' || record.source.startsWith('addon:'));
}

/** Why a hidden record hides, and its fix, read by its state first. */
function recordReason(
  record: InventoryRecord,
  overrides: OverrideReading,
  settingSources: readonly ClaudeSettingSource[],
  resolution: Resolution,
): Pick<HiddenItem, 'why' | 'fix'> {
  const { state, kind, name, path } = record;
  if (state === 'collision') {
    const collision = resolution.collisions.find((held) => held.kind === kind && held.name === name);
    return {
      why: `another loaded tier holds a different ${kind} of the same name, so neither is served`,
      fix: collision === undefined
        ? `pin the tier that serves it under ${pinKey(kind)} in ${CONFIG_FILE}`
        : `pin the tier that serves it in ${CONFIG_FILE}: ${collision.pinLine}`,
    };
  }
  if (state === `disabled:${pinKey(kind)}`) {
    return {
      why: `${pinKey(kind)} sets it to false in ${CONFIG_FILE}`,
      fix: `remove ${name} from ${pinKey(kind)} in ${CONFIG_FILE}`,
    };
  }
  if (state.startsWith('shadowed-by:')) {
    const holder = state.slice('shadowed-by:'.length);
    return {
      why: `shadowed by the ${holder} ${kind} of the same name`,
      fix: `rename it, or remove the ${holder} ${kind} ${name}`,
    };
  }
  if (state === OVERRIDE_DISABLED) {
    const file = overrideFor(overrides, name)?.path ?? 'a settings file';
    return {
      why: `${OVERRIDES_KEY} sets it off in ${file}`,
      fix: `remove "${name}" from ${OVERRIDES_KEY} in ${file}`,
    };
  }
  if (state.startsWith('disabled:')) {
    const key = state.slice('disabled:'.length);
    return { why: `its frontmatter sets ${key}`, fix: `remove ${key} from ${path}` };
  }
  return { why: sourceOffWhy('user', settingSources), fix: addSourceFix('user') };
}

/** Every skill and agent a session is not handed, rafa and add-on rows left out. */
function hiddenRecords(
  inventory: Inventory,
  overrides: OverrideReading,
  settingSources: readonly ClaudeSettingSource[],
): readonly HiddenItem[] {
  return inventory.records
    .filter((record) => !record.visibleToLoop && isSessionSource(record))
    .map((record) => ({
      kind: record.kind,
      name: record.name,
      source: record.source,
      path: record.path,
      ...recordReason(record, overrides, settingSources, inventory.resolution),
    }));
}

/** Why a hidden MCP declaration hides, and its fix, in `isLoadedUnder`'s order. */
function declarationReason(
  declaration: McpDeclaration,
  answering: McpDeclaration | null,
  seams: DeepSettingsSeams,
): Pick<HiddenItem, 'why' | 'fix'> {
  const { scope, name } = declaration;
  const sources = seams.settingSources;
  if (!sources.includes(scope)) return { why: sourceOffWhy(scope, sources), fix: addSourceFix(scope) };
  if (declaration.disabled) {
    // The switch sits in the project's `~/.claude.json` entry, not in the declaring file.
    const file = join(seams.home, CLAUDE_JSON_FILE);
    const entry = `${PROJECTS_KEY}["${seams.projectRoot ?? ''}"]`;
    return {
      why: `${DISABLE_KEY} names it in ${file}`,
      fix: `remove "${name}" from ${DISABLE_KEY} under ${entry} in ${file}`,
    };
  }
  const files = declaration.rejectedBy
    .filter((source) => sources.includes(source))
    .flatMap((source) => overrideSettingsPath(source, seams) ?? []);
  if (files.length > 0) {
    return {
      why: `${REJECT_KEY} names it in ${files.join(', ')}`,
      fix: `remove "${name}" from ${REJECT_KEY} in ${files.join(', ')}`,
    };
  }
  // Every reason above is `isLoadedUnder` saying no, so this one loads
  // and loses its name to `answering`, which is then never null.
  const holder = answering?.scope ?? 'nearer';
  return {
    why: `shadowed by the ${holder} mcp server of the same name`,
    fix: `rename it, or remove the ${holder} mcp server ${name}`,
  };
}

/** Every MCP declaration that is not the one a session starts for its name. */
function hiddenServers(reading: McpReading, seams: DeepSettingsSeams): readonly HiddenItem[] {
  return reading.servers.flatMap((declaration) => {
    const answering = mcpServerFor(reading, declaration.name, seams.settingSources);
    if (answering === declaration) return [];
    return [{
      kind: 'mcp server' as const,
      name: declaration.name,
      source: declaration.scope,
      path: declaration.path,
      ...declarationReason(declaration, answering, seams),
    }];
  });
}

/** A group's rank: the MCP scopes nearest first, then every other source after them. */
function groupRank(source: string): number {
  const index = (MCP_SCOPES as readonly string[]).indexOf(source);
  return index === -1
    ? MCP_SCOPES.length
    : index;
}

/** The kinds in the order a group lists them. */
const KIND_ORDER: readonly HiddenKind[] = ['skill', 'agent', 'mcp server'];

/** Items grouped by source, then by kind, then by name; see the module note. */
export function byGroup(items: readonly HiddenItem[]): readonly HiddenItem[] {
  return [...items].sort((a, b) => groupRank(a.source) - groupRank(b.source)
    || a.source.localeCompare(b.source)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.name.localeCompare(b.name));
}

/**
 * The setting sources a loop session loads, and every configured
 * skill, agent and MCP server it is not handed, with each one's fix.
 * Never throws; see the module note.
 */
export function readDeepSettings(seams: DeepSettingsSeams): DeepSettingsReading {
  const inventory = buildInventory(seams);
  const overrides = readSkillOverrides(seams);
  const mcp = readMcpServers(seams);

  const hidden = byGroup([
    ...hiddenRecords(inventory, overrides, seams.settingSources),
    ...hiddenServers(mcp, seams),
  ]);
  const warnings = [...inventory.warnings, ...inventory.overrideWarnings, ...mcp.warnings]
    .map(({ path, reason }) => ({ path, reason }));

  return Object.freeze({
    settingSources: Object.freeze([...seams.settingSources]),
    hidden: Object.freeze(hidden),
    warnings: Object.freeze(warnings),
  });
}

/** The row of one setting source: `ok` when a session loads it, else `note`. */
function sourceRow(source: ClaudeSettingSource, settingSources: readonly ClaudeSettingSource[]): DeepRow {
  const name = `setting source ${source}`;
  return settingSources.includes(source)
    ? { status: 'ok', name, detail: 'loaded by every loop session' }
    : { status: 'note', name, detail: `not loaded: ${SETTING_SOURCES_KEY} is ${listed(settingSources)}` };
}

/** The `note` row of one hidden item. */
function hiddenRow(item: HiddenItem): DeepRow {
  return {
    status: 'note',
    name: `${item.source} ${item.kind} ${item.name}`,
    detail: `hidden from sessions: ${item.why}`,
    fix: item.fix,
  };
}

/** The Settings section of a reading: source rows, hidden rows, then warnings. */
export function settingsSection(reading: DeepSettingsReading): DeepSection {
  return {
    title: SETTINGS_SECTION_TITLE,
    rows: [
      ...MCP_SCOPES.map((source) => sourceRow(source, reading.settingSources)),
      ...reading.hidden.map(hiddenRow),
      ...reading.warnings.map((warning): DeepRow => ({
        status: 'warn',
        name: warning.path,
        detail: warning.reason,
      })),
    ],
  };
}
