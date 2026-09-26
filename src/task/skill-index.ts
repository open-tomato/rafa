/**
 * The compact skill index the planner reads: one line per skill a loop
 * session will see, so a plan can name the skills each task needs with
 * `skills=`.
 *
 * `.rafa/specs/rafa-23-right-skills-reach-right.md` ("The index") sets
 * the shape. {@link renderSkillIndex} is pure: it reads a `Resolution`
 * from `resolveTiers` (`tiers/resolve.ts`), walks no directory and reads
 * no config, so a later step contract can call it unchanged.
 *
 * ## What it lists
 *
 * Every `served` skill of the resolution, by its winner. A name switched
 * off (`tiers.skills: { name: false }`) resolves `off` and is left out,
 * as are `unloaded` names and collisions, which nothing serves. A winner
 * that is an `InventoryRecord` whose own `state` reads `disabled:<how>`
 * (`skillOverrides`, `disable-model-invocation`) is left out too; a
 * `SourceItem` from `readTrees` carries no state, so only the resolution
 * decides for it. Agents are never listed: the planner prompt's
 * `{ROUTING}` covers them.
 *
 * ## One line
 *
 * `name — tags — prevents`: the tags joined with `, `, and the winner's
 * `prevents`, or its `summary` (its own `description`, cut by
 * `summarize` in `inventory/record.ts`) when it has no `prevents`. A
 * part with nothing in it is dropped with its separator, so a skill with
 * no tags reads `name — prevents` and one with nothing but a name reads
 * `name`. Whitespace runs are collapsed to one space, since a folded
 * YAML scalar may hold newlines. The frontmatter fields are read from
 * the winner when it carries them, which every row `readTrees` or the
 * inventory hands `resolveTiers` does; a bare `TierRow` reads as a name.
 *
 * ## How big it gets
 *
 * A line is cut to {@link LINE_LIMIT} characters and the whole index,
 * newlines and tail included, to {@link INDEX_LIMIT}. A character is a
 * codepoint, counted as `schema/skill.ts` counts, so a cut never splits
 * a surrogate pair. Lines are always written in tier order (project,
 * rafa, user), then by name, and the index keeps the longest run from
 * the top that fits. When any line is dropped, the last line is
 * `N more: rafa skill list`, and the lines kept leave room for it.
 * Nothing served renders as the empty string.
 */
import type { InventoryState } from '../inventory/record.js';
import type { Resolution, ServedItem, TierRow } from '../tiers/resolve.js';

import { countCharacters } from '../schema/skill.js';
import { SKILL_TIERS } from '../schema/tiers.js';

/** Longest one index line may be, in codepoints. */
export const LINE_LIMIT = 160;

/** Longest the whole index may be, in codepoints, the tail line included. */
export const INDEX_LIMIT = 8000;

/** Between the parts of one line. */
const SEPARATOR = ' — ';

/** The frontmatter fields a winner may carry beside its `TierRow` fields. */
interface IndexFields {
  readonly tags?: readonly string[];
  readonly prevents?: string | null;
  readonly summary?: string;
  readonly state?: InventoryState;
}

/** The line that closes an index `dropped` lines were cut from. */
export function moreLine(dropped: number): string {
  return `${dropped} more: rafa skill list`;
}

/** `text` on one line: whitespace runs collapsed, trimmed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `line` cut to its first {@link LINE_LIMIT} codepoints. */
function cutLine(line: string): string {
  if (countCharacters(line) <= LINE_LIMIT) return line;
  return Array.from(line).slice(0, LINE_LIMIT)
    .join('')
    .trimEnd();
}

/** The winner's frontmatter fields, when it carries them. */
function fieldsOf(row: TierRow): IndexFields {
  return row as TierRow & IndexFields;
}

/** Whether the winner itself reads as switched off, when it carries a state. */
function isDisabled(row: TierRow): boolean {
  const { state } = fieldsOf(row);
  return typeof state === 'string' && state.startsWith('disabled:');
}

/** The index line for one served skill. See "One line". */
export function skillIndexLine(item: ServedItem): string {
  const fields = fieldsOf(item.winner);
  const tags = (fields.tags ?? []).map(oneLine).filter((tag) => tag !== '')
    .join(', ');
  const prevents = oneLine(fields.prevents ?? '');
  const about = prevents === ''
    ? oneLine(fields.summary ?? '')
    : prevents;
  const parts = [item.name, tags, about].filter((part) => part !== '');
  return cutLine(parts.join(SEPARATOR));
}

/** A winner's tier: its place in {@link SKILL_TIERS}. */
function tierIndex(item: ServedItem): number {
  return (SKILL_TIERS as readonly string[]).indexOf(item.winner.source);
}

/** The skills the index lists, in tier order then by name. See "What it lists". */
export function indexedSkills(resolution: Resolution): readonly ServedItem[] {
  return resolution.items
    .flatMap((item) => item.kind === 'skill' && item.state === 'served' && !isDisabled(item.winner)
      ? [item]
      : [])
    .sort((a, b) => tierIndex(a) - tierIndex(b) || a.name.localeCompare(b.name));
}

/**
 * How many of `lines`, from the top, fit in {@link INDEX_LIMIT} with the
 * tail line the rest would need.
 */
function keptCount(lines: readonly string[]): number {
  const sizes = lines.map(countCharacters);
  let total = sizes.reduce((sum, size) => sum + size, 0) + Math.max(lines.length - 1, 0);
  if (total <= INDEX_LIMIT) return lines.length;

  for (let kept = lines.length - 1; kept >= 0; kept -= 1) {
    total -= (sizes[kept] ?? 0) + (kept > 0
      ? 1
      : 0);
    const tail = countCharacters(moreLine(lines.length - kept)) + (kept > 0
      ? 1
      : 0);
    if (total + tail <= INDEX_LIMIT) return kept;
  }
  return 0;
}

/**
 * The planner's skill index over `resolution`: one line per skill a loop
 * session will see, capped, and closed by `N more: rafa skill list` when
 * the cap drops any. See the module note.
 */
export function renderSkillIndex(resolution: Resolution): string {
  const lines = indexedSkills(resolution).map(skillIndexLine);
  const kept = keptCount(lines);
  return kept === lines.length
    ? lines.join('\n')
    : [...lines.slice(0, kept), moreLine(lines.length - kept)].join('\n');
}
