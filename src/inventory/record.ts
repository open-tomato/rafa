/**
 * One row of the inventory of skills and agents, and the frontmatter
 * reading every tree reader fills it from.
 *
 * The inventory lists every skill and agent a person could reach from
 * this project — the project's own, rafa's, the home's, a plugin's and
 * an add-on's — and says of each where it sits, what it says of itself,
 * whether the skill checker passes it, whether a nearer holder of its
 * name shadows it, and whether a session the loop spawns resolves it.
 * This module holds the row ({@link InventoryRecord}) and the one reading
 * every source shares: the keys a definition's own frontmatter carries.
 * Walking the trees, precedence and `visibleToLoop` belong to the
 * modules beside it.
 *
 * ## The reading is lenient on purpose
 *
 * `schema/skill.ts` reads a block as skill frontmatter v2 and answers
 * no skill at all when any rule is broken. The inventory cannot use that
 * reading: its whole point is to list what exists, a home or plugin
 * skill written before v2 included, and an agent definition was never
 * v2 in the first place. So {@link readInventoryFrontmatter} takes each
 * key on its own and lets a wrong one read as absent — never throwing,
 * never dropping the item. Whether the item is well-formed is the
 * checker's verdict ({@link InventoryRecord.check}), not this reading's.
 *
 *   - A string key (`description`, `when_to_use`, `prevents`) reads as
 *     its trimmed text, and as null when absent, not a string, or blank.
 *   - A list key (`tags`, `stack`) reads as its string entries, trimmed,
 *     with blank and non-string entries dropped, and as an empty list
 *     when absent. A bare string reads as a list of one, so `stack:
 *     agnostic` lists as `agnostic` rather than as nothing.
 *   - `stack` entries are NOT checked against `schema/stack.ts`: an
 *     unknown stack is the checker's `unknown-stack` failure, and the
 *     inventory shows what the file says.
 *
 * ## The summary is cut, never generated
 *
 * {@link InventoryRecord.summary} is the item's own `description` and
 * nothing else, cut to {@link SUMMARY_LIMIT} characters by {@link
 * summarize}. No model writes it and no body line stands in for a
 * missing one: an item with no description has an empty summary, which
 * is itself worth seeing. The limit is `schema/skill.ts`'s
 * `DESCRIPTION_LIMIT`, and a character is a codepoint counted the way
 * that module counts, so a description the checker passes (129 or
 * fewer) is never cut, and the cut never splits an emoji's surrogate
 * pair. Whitespace runs, newlines from a folded YAML scalar included,
 * are collapsed to one space first, since a summary is shown on one
 * line.
 */
import type { CheckIssue } from '../check/run.js';

import { hasCheckFailure } from '../check/run.js';
import { readFrontmatter } from '../schema/frontmatter.js';
import { countCharacters, DESCRIPTION_LIMIT } from '../schema/skill.js';

/** Longest a summary may be, in codepoints: the checker's description cap. */
export const SUMMARY_LIMIT = DESCRIPTION_LIMIT;

/** What an inventory row describes. */
export type InventoryKind = 'skill' | 'agent';

/**
 * Where an item was found. `plugin:<name>` is a Claude Code plugin
 * recorded in `~/.claude/plugins/installed_plugins.json`, and
 * `addon:<name>` a loaded rafa module's manifest.
 */
export type InventorySource =
  | 'project'
  | 'rafa'
  | 'user'
  | `plugin:${string}`
  | `addon:${string}`;

/**
 * The skill checker's verdict on an item: `pass` with no issue, `warn`
 * with warnings only, `fail` with at least one failure. {@link
 * checkVerdict} reads it from a `CheckReport`'s issues.
 */
export type InventoryCheck = 'pass' | 'warn' | 'fail';

/**
 * Whether an item answers under its name. `shadowed-by:<source>` names
 * the nearer source holding the same name and kind; `disabled:<how>`
 * names the switch that turned it off (`skillOverrides`, or the
 * frontmatter key).
 */
export type InventoryState =
  | 'enabled'
  | `shadowed-by:${InventorySource}`
  | `disabled:${string}`;

/** The keys the inventory reads from a definition's frontmatter. */
export interface InventoryFrontmatter {
  /** `description`, trimmed, or null when absent, blank or not a string. */
  readonly description: string | null;
  /** `when_to_use`, Claude Code's trigger text, or null. */
  readonly whenToUse: string | null;
  /** `prevents`, the failure the item heads off, or null. */
  readonly prevents: string | null;
  /** `tags`, free text. Empty when absent. */
  readonly tags: readonly string[];
  /** `stack`, as written and unchecked. Empty when absent. */
  readonly stack: readonly string[];
}

/** One skill or agent, as every later inventory stage reads it. */
export interface InventoryRecord {
  readonly kind: InventoryKind;
  /** The item's name as its place implies it. */
  readonly name: string;
  readonly source: InventorySource;
  /** Absolute path of the definition file. */
  readonly path: string;
  /** Its own `description`, cut by {@link summarize}. Empty when it has none. */
  readonly summary: string;
  /** `when_to_use` from its frontmatter, or null. */
  readonly whenToUse: string | null;
  /** `prevents` from its frontmatter, or null. */
  readonly prevents: string | null;
  /** `stack` from its frontmatter, empty when absent. */
  readonly stack: readonly string[];
  /** `tags` from its frontmatter, empty when absent. */
  readonly tags: readonly string[];
  /**
   * The skill checker's verdict. Null for an agent, which the checker
   * does not read.
   */
  readonly check: InventoryCheck | null;
  readonly state: InventoryState;
  /** True when a session spawned under `loop.settingSources` resolves it. */
  readonly visibleToLoop: boolean;
}

/** The frontmatter reading of a file with no block, or none that parses. */
export const EMPTY_FRONTMATTER: InventoryFrontmatter = {
  description: null,
  whenToUse: null,
  prevents: null,
  tags: [],
  stack: [],
};

/** The trimmed string at `key`, or null when absent, blank or another type. */
function textAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** The string entries at `key`, trimmed and non-blank; a bare string is one. */
function listAt(data: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = data[key];
  const entries: unknown[] = Array.isArray(value)
    ? value
    : [value];

  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * The inventory's keys read from a parsed frontmatter mapping, or
 * {@link EMPTY_FRONTMATTER} when there is none. Never throws; a key of
 * the wrong type reads as absent.
 */
export function readInventoryFrontmatter(
  data: Readonly<Record<string, unknown>> | null,
): InventoryFrontmatter {
  if (data === null) return EMPTY_FRONTMATTER;

  return {
    description: textAt(data, 'description'),
    whenToUse: textAt(data, 'when_to_use'),
    prevents: textAt(data, 'prevents'),
    tags: listAt(data, 'tags'),
    stack: listAt(data, 'stack'),
  };
}

/**
 * The inventory's keys read from a definition file's `text`, through
 * `schema/frontmatter.ts`. A file with no block, an unclosed one or one
 * that is not a YAML mapping reads as {@link EMPTY_FRONTMATTER}.
 */
export function readInventoryText(text: string): InventoryFrontmatter {
  return readInventoryFrontmatter(readFrontmatter(text));
}

/**
 * `description` as a one-line summary: whitespace runs collapsed to one
 * space, then cut to the first {@link SUMMARY_LIMIT} codepoints. Null
 * reads as the empty string.
 */
export function summarize(description: string | null): string {
  if (description === null) return '';

  const line = description.replace(/\s+/g, ' ').trim();
  if (countCharacters(line) <= SUMMARY_LIMIT) return line;

  const kept = Array.from(line).slice(0, SUMMARY_LIMIT);
  return kept.join('').trimEnd();
}

/**
 * The checker's verdict on one report's `issues` (`check/run.ts`):
 * `fail` when any is a failure, `warn` when all are warnings, `pass`
 * when there are none.
 */
export function checkVerdict(issues: readonly CheckIssue[]): InventoryCheck {
  if (hasCheckFailure(issues)) return 'fail';
  return issues.length > 0
    ? 'warn'
    : 'pass';
}
