/**
 * The disabled readings: whether a skill found in some tree is switched
 * off, by `skillOverrides` in a settings file or by a switch in its own
 * frontmatter.
 *
 * The tree, plugin and add-on readers say what exists; this module says
 * which of those rows Claude Code will not hand the model, as the
 * `disabled:<how>` state of an {@link InventoryState}. It only READS:
 * turning a skill off or on again belongs to another spec. Precedence,
 * `shadowed-by:` and `visibleToLoop` are decided where every source is
 * gathered, which asks {@link disabledState} of each row.
 *
 * ## `skillOverrides`, as Claude Code 2.1.280 reads it
 *
 * Nothing here is taken from documentation: every rule below was read
 * out of the Claude Code {@link OVERRIDES_CLI_VERSION} binary on
 * 2026-09-23, and a later version may move any of them.
 *
 *   - **The shape.** `skillOverrides` is a mapping from a skill's name
 *     to one of {@link SKILL_OVERRIDE_VALUES}; the settings schema
 *     describes it as `Per-skill listing overrides keyed by skill name
 *     … Absent = on.` `name-only` lists the skill without its
 *     description, `user-invocable-only` hides it from the model but
 *     keeps `/name`, and `off` hides it from both.
 *   - **The three files, nearest first.** `.claude/settings.local.json`
 *     under the project root, then `.claude/settings.json` beside it,
 *     then `~/.claude/settings.json` ({@link OVERRIDE_SCOPES}). The
 *     `/skills` screen resolves a name as the local file's entry, else
 *     the project file's, else the user file's, so the NEAREST file
 *     holding the name decides and a nearer `on` re-enables a skill a
 *     farther `off` switched off. Policy and flag settings sit above
 *     all three; they are nobody's project file and are not read.
 *   - **Plugins are exempt.** A skill whose source is a plugin reads as
 *     `on` whatever the settings hold, so a `plugin:` row is never
 *     `disabled:skillOverrides`.
 *   - **Skills only.** Nothing in the binary reads `skillOverrides`
 *     for an agent, so an agent row is never disabled here.
 *
 * Only `off` reads as {@link OVERRIDE_DISABLED}, as the plan states:
 * `name-only` and `user-invocable-only` still list the skill, and the
 * value is kept on {@link OverrideHit} for whatever shows it.
 *
 * ## The frontmatter switches
 *
 * Claude Code reads two boolean keys from a skill's own block, each
 * through one parser: `true`/`false`, or a string or number that reads
 * `1`, `true`, `yes`, `on` or `0`, `false`, `no`, `off` in any case,
 * with anything else read as false ({@link readSwitch}).
 *
 *   - `disable-model-invocation: true` takes the skill away from the
 *     model — the binary's own refusal reads `Skill … is disabled for
 *     model invocation` — so it reads as `disabled:disable-model-invocation`.
 *     A loop session is the model and types no slash command, so for
 *     every purpose the inventory has, that skill is off.
 *   - `user-invocable: false` only drops the skill from the `/` menu;
 *     the model still invokes it. It is NOT a disabled reading, which
 *     is measured rather than a narrowing: marking it disabled would
 *     call a skill every loop session can use invisible to the loop.
 *     {@link SkillSwitches} still carries it.
 *
 * An `off` override is read before the frontmatter switch, since it
 * hides the skill from the person as well and so says more.
 *
 * ## An unreadable settings file is a warning, never a gap
 *
 * An absent file, or a file with no `skillOverrides`, is no reading and
 * no warning. A file that exists and does not read, is not JSON or not
 * a mapping, or holds a `skillOverrides` that is not a mapping, is one
 * {@link OverrideWarning} and contributes nothing; one entry whose value
 * is not among the four is a warning for that entry, and the file's
 * other entries still count. How Claude Code itself treats a value its
 * schema refuses was not measured, so skipping the entry is this
 * reader's choice, stated here rather than implied.
 *
 * Nothing here throws, and nothing reads the real home unless it is
 * handed it: every path comes from {@link OverrideSeams}.
 */
import type { InventoryKind, InventorySource, InventoryState } from './record.js';
import type { ClaudeSettingSource } from '../config-sections.js';
import type { TierSeams } from '../schema/tiers.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeValue, isMapping, messageOf } from '../config-sections.js';
import { readFrontmatter } from '../schema/frontmatter.js';

/** The Claude Code version the override and switch rules were read from. */
export const OVERRIDES_CLI_VERSION = '2.1.280';

/** The settings key this module reads. */
export const OVERRIDES_KEY = 'skillOverrides';

/** Every value `skillOverrides` takes, least to most hidden. */
export const SKILL_OVERRIDE_VALUES = ['on', 'name-only', 'user-invocable-only', 'off'] as const;

/** One `skillOverrides` value. */
export type SkillOverride = (typeof SKILL_OVERRIDE_VALUES)[number];

/** The state an `off` override reads as. */
export const OVERRIDE_DISABLED = 'disabled:skillOverrides';

/** The frontmatter key that takes a skill away from the model. */
export const DISABLE_MODEL_INVOCATION_KEY = 'disable-model-invocation';

/** The frontmatter key that drops a skill from the `/` menu only. */
export const USER_INVOCABLE_KEY = 'user-invocable';

/** The settings files `skillOverrides` is read from, nearest first. */
export const OVERRIDE_SCOPES: readonly ClaudeSettingSource[] = ['local', 'project', 'user'];

/** Each scope's file, under the project root (`local`, `project`) or the home (`user`). */
const SCOPE_FILES: Readonly<Record<ClaudeSettingSource, string>> = {
  local: join('.claude', 'settings.local.json'),
  project: join('.claude', 'settings.json'),
  user: join('.claude', 'settings.json'),
};

/** What the settings files are resolved against. */
export type OverrideSeams = Pick<TierSeams, 'home' | 'projectRoot'>;

/** One settings file's `skillOverrides`, entries it could not read left out. */
export interface ScopeOverrides {
  readonly scope: ClaudeSettingSource;
  readonly path: string;
  /** Name to value, in the file's own order. Empty when the file or key is absent. */
  readonly overrides: ReadonlyMap<string, SkillOverride>;
}

/** One settings file, or one entry in it, the reader could not use. */
export interface OverrideWarning {
  readonly scope: ClaudeSettingSource;
  readonly path: string;
  /** Why, as one sentence fragment. */
  readonly reason: string;
}

/** Every settings file read, nearest first, and a warning per thing that did not read. */
export interface OverrideReading {
  /** One per scope that has a file path; the project scopes drop out with no project root. */
  readonly scopes: readonly ScopeOverrides[];
  readonly warnings: readonly OverrideWarning[];
}

/** The override that decides one name, and the file it came from. */
export interface OverrideHit {
  readonly value: SkillOverride;
  readonly scope: ClaudeSettingSource;
  readonly path: string;
}

/** The two frontmatter switches, as Claude Code parses them. */
export interface SkillSwitches {
  /** `disable-model-invocation`; false when absent. */
  readonly disableModelInvocation: boolean;
  /** `user-invocable`; true when absent. */
  readonly userInvocable: boolean;
}

/** What {@link disabledState} reads of a row; a `SourceItem` satisfies it. */
export interface DisabledSubject {
  readonly kind: InventoryKind;
  readonly name: string;
  readonly source: InventorySource;
  readonly path: string;
}

/** Switches of a skill whose frontmatter sets neither. */
export const DEFAULT_SWITCHES: SkillSwitches = { disableModelInvocation: false, userInvocable: true };

/** Strings Claude Code's boolean parser reads as true and as false. */
const TRUE_WORDS: readonly string[] = ['1', 'true', 'yes', 'on'];
const FALSE_WORDS: readonly string[] = ['0', 'false', 'no', 'off'];

/** The file `scope` reads, or null for a project scope with no project root. */
export function overrideSettingsPath(scope: ClaudeSettingSource, seams: OverrideSeams): string | null {
  if (scope === 'user') return join(seams.home, SCOPE_FILES.user);
  return seams.projectRoot === null
    ? null
    : join(seams.projectRoot, SCOPE_FILES[scope]);
}

/** Whether `value` is one of {@link SKILL_OVERRIDE_VALUES}. */
export function isSkillOverride(value: unknown): value is SkillOverride {
  return typeof value === 'string' && (SKILL_OVERRIDE_VALUES as readonly string[]).includes(value);
}

/** Whether a thrown read error is the file not being there. */
function isAbsent(error: unknown): boolean {
  return isMapping(error) && Object.hasOwn(error, 'code') && error.code === 'ENOENT';
}

/** A settings file's parsed mapping, null when absent, or the reason it does not read. */
function readSettings(path: string): Readonly<Record<string, unknown>> | null | string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return isAbsent(error)
      ? null
      : `does not read: ${messageOf(error)}`;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    return `is not JSON: ${messageOf(error)}`;
  }
  return isMapping(value)
    ? value
    : `is ${describeValue(value)}, expected a mapping`;
}

/** One scope's file read into its overrides and warnings. */
function readScope(
  scope: ClaudeSettingSource,
  path: string,
): { readonly read: ScopeOverrides; readonly warnings: readonly OverrideWarning[] } {
  const none: ScopeOverrides = { scope, path, overrides: new Map() };
  const settings = readSettings(path);
  if (settings === null) return { read: none, warnings: [] };
  if (typeof settings === 'string') return { read: none, warnings: [{ scope, path, reason: settings }] };
  if (!Object.hasOwn(settings, OVERRIDES_KEY)) return { read: none, warnings: [] };

  const raw = settings[OVERRIDES_KEY];
  if (!isMapping(raw)) {
    const reason = `has ${OVERRIDES_KEY} ${describeValue(raw)}, expected a mapping`;
    return { read: none, warnings: [{ scope, path, reason }] };
  }

  const overrides = new Map<string, SkillOverride>();
  const warnings: OverrideWarning[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (isSkillOverride(value)) {
      overrides.set(name, value);
    } else {
      const expected = SKILL_OVERRIDE_VALUES.join(', ');
      warnings.push({ scope, path, reason: `${OVERRIDES_KEY} "${name}" is ${describeValue(value)}, expected one of ${expected}` });
    }
  }
  return { read: { scope, path, overrides }, warnings };
}

/**
 * `skillOverrides` from the local, project and user settings files,
 * nearest first. See the module note for what an unreadable file reads as.
 */
export function readSkillOverrides(seams: OverrideSeams): OverrideReading {
  const read = OVERRIDE_SCOPES.flatMap((scope) => {
    const path = overrideSettingsPath(scope, seams);
    return path === null
      ? []
      : [readScope(scope, path)];
  });

  return {
    scopes: read.map((scope) => scope.read),
    warnings: read.flatMap((scope) => scope.warnings),
  };
}

/** The override the nearest settings file holds for `name`, or null when none does. */
export function overrideFor(reading: OverrideReading, name: string): OverrideHit | null {
  for (const scope of reading.scopes) {
    const value = scope.overrides.get(name);
    if (value !== undefined) return { value, scope: scope.scope, path: scope.path };
  }
  return null;
}

/**
 * A frontmatter value through Claude Code's boolean parser: a boolean
 * as itself, a string or number by its words, null for anything else.
 */
export function readSwitch(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const word = String(value)
    .trim()
    .toLowerCase();
  if (TRUE_WORDS.includes(word)) return true;
  if (FALSE_WORDS.includes(word)) return false;
  return null;
}

/**
 * The two switches in a parsed frontmatter mapping, as Claude Code
 * reads them: an absent `user-invocable` is true, while one present
 * and unparseable is false, like an unparseable `disable-model-invocation`.
 */
export function readSwitches(data: Readonly<Record<string, unknown>> | null): SkillSwitches {
  if (data === null) return DEFAULT_SWITCHES;

  const userInvocable = Object.hasOwn(data, USER_INVOCABLE_KEY)
    ? readSwitch(data[USER_INVOCABLE_KEY]) ?? false
    : true;
  const disableModelInvocation = Object.hasOwn(data, DISABLE_MODEL_INVOCATION_KEY)
    ? readSwitch(data[DISABLE_MODEL_INVOCATION_KEY]) ?? false
    : false;
  return { disableModelInvocation, userInvocable };
}

/** The switches of the definition at `path`; a file that does not read has none set. */
export function readFileSwitches(path: string): SkillSwitches {
  try {
    return readSwitches(readFrontmatter(readFileSync(path, 'utf8')));
  } catch {
    return DEFAULT_SWITCHES;
  }
}

/**
 * The `disabled:<how>` state of one row, or null when nothing switches
 * it off: `disabled:skillOverrides` for an `off` in the nearest settings
 * file naming it (plugin rows exempt), else
 * `disabled:disable-model-invocation` for that switch set in its own
 * frontmatter. Agents are never disabled here. See the module note.
 */
export function disabledState(
  item: DisabledSubject,
  reading: OverrideReading,
): Extract<InventoryState, `disabled:${string}`> | null {
  if (item.kind !== 'skill') return null;

  const isPlugin = item.source.startsWith('plugin:');
  if (!isPlugin && overrideFor(reading, item.name)?.value === 'off') return OVERRIDE_DISABLED;

  return readFileSwitches(item.path).disableModelInvocation
    ? `disabled:${DISABLE_MODEL_INVOCATION_KEY}`
    : null;
}
