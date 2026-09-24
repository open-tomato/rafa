/**
 * The three directory trees the inventory reads skills and agents from:
 * the project's, rafa's own and the home's.
 *
 * `src/schema/tiers.ts` names the three tiers and resolves the skills
 * directory of each; this module walks them and turns what it finds
 * into inventory rows ({@link SourceItem}). Plugins and add-ons are
 * other sources with other readers beside this one, and precedence,
 * `shadowed-by:` and `visibleToLoop` are decided where every source is
 * gathered, so a row read here carries neither a state nor a
 * visibility: {@link SourceItem} is an {@link InventoryRecord} without
 * those two fields.
 *
 * ## Where each tree sits
 *
 * | Tier | Skills | Agents |
 * | --- | --- | --- |
 * | `project` | `<root>/.claude/skills` | `<root>/.claude/agents` |
 * | `rafa` | `bundled/skills` beside the running `cli.js` | `bundled/agents` beside it |
 * | `user` | `~/.claude/skills` | `~/.claude/agents` |
 *
 * The skills column is `skillTierDirectory`'s, unchanged. The agents
 * column mirrors it: `AGENT_DEFINITION_DIR` under a root or the home,
 * and {@link BUNDLED_AGENTS_DIR} beside the entry with its links
 * resolved, so rafa's `bundled/agents` sits beside its `bundled/skills`
 * as an add-on's `agents/` sits beside its `skills/` (the add-on spec
 * checks the two together). Until the bundle is populated that tree is
 * ordinarily absent.
 *
 * ## An absent tier is a listing, never a gap
 *
 * Every tier yields one {@link TreeListing} whatever the disk holds.
 * A tier whose directory is not there reads `exists: false` with no
 * items, and the project tier with no project root reads `dir: null`
 * as well. So "this tier holds nothing" and "this tier is not there"
 * stay two answers, as they are in `rafa skill list`, and a caller
 * never learns about a missing tree by the silence where it would be.
 *
 * ## Skills: the checker decides what there is, and its verdict
 *
 * A skills tree is read through `checkDirectory` (`check/run.ts`), the
 * same call `rafa skill list` makes, so the listing and `rafa skill
 * check` can never disagree about a file. Each report the layout scan
 * made on a FILE becomes a row: its name is the one its place implies
 * (the directory of a `SKILL.md`, the stem of a loose or grouped file,
 * which the checker then fails for not registering), its `check` is
 * {@link checkVerdict} over its issues, and its frontmatter is read a
 * second time through `readInventoryText`, because a report carries the
 * rules a file broke and not the block it carries. A report about a
 * directory holding no `SKILL.md` is not a row: there is no file to
 * point at and nothing Claude Code loads.
 *
 * The project tier is checked against the project root, and the rafa
 * and user tiers with none, as `rafa skill list` checks them: their
 * bodies are read in every project and in none, so a project-looking
 * path in them is a warning there.
 *
 * ## Agents: the roster's reading
 *
 * An agents tree is read through `readAgentDirectory`
 * (`agents/roster.ts`), so a definition is keyed by its frontmatter
 * `name`, the way Claude Code resolves `--agent`, and a file carrying
 * no usable `name` is passed over as the roster passes it over. The
 * checker does not read agents, so an agent row's `check` is null.
 *
 * Nothing here throws on a missing directory, and nothing reads the
 * real home unless it is handed it: every path comes from
 * {@link TreeSeams}.
 */
import type { InventoryKind, InventoryRecord, InventorySource } from './record.js';
import type { CheckReport } from '../check/run.js';
import type { SkillTier, TierSeams } from '../schema/tiers.js';

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { readAgentDirectory } from '../agents/roster.js';
import { checkDirectory } from '../check/run.js';
import { realEntry, SKILL_TIERS, skillTierDirectory, tierExists } from '../schema/tiers.js';
import { AGENT_DEFINITION_DIR } from '../utils/agent-definition.js';

import { checkVerdict, EMPTY_FRONTMATTER, readInventoryText, summarize } from './record.js';

/** The directory rafa's own agents sit in, relative to the running `cli.js`. */
export const BUNDLED_AGENTS_DIR = join('bundled', 'agents');

/**
 * One row as a source reads it: everything an {@link InventoryRecord}
 * carries except what only the gathered inventory can decide.
 */
export type SourceItem = Omit<InventoryRecord, 'state' | 'visibleToLoop'>;

/** What the trees are resolved against. */
export interface TreeSeams extends TierSeams {
  /** The directories a skill body's command names are looked up in. */
  readonly pathDirs: readonly string[];
}

/** One tier's tree of one kind, and what it holds. */
export interface TreeListing {
  readonly kind: InventoryKind;
  /** Which tier, which is also each item's source. */
  readonly source: SkillTier;
  /** The directory it resolves to, or null for the project tier with no project root. */
  readonly dir: string | null;
  /** Whether that directory is there at all. */
  readonly exists: boolean;
  /** Its rows, sorted by name. Empty for an absent tier. */
  readonly items: readonly SourceItem[];
}

/** The directory rafa's own agents sit in: `bundled/agents` beside the entry, links resolved. */
export function bundledAgentsDirectory(entry?: string): string {
  return join(dirname(realEntry(entry ?? Bun.main)), BUNDLED_AGENTS_DIR);
}

/** The agents directory `tier` resolves to, or null for the project tier with no project root. */
export function agentTreeDirectory(tier: SkillTier, seams: TierSeams): string | null {
  if (tier === 'user') return join(seams.home, AGENT_DEFINITION_DIR);
  if (tier === 'rafa') return bundledAgentsDirectory(seams.entry);
  return seams.projectRoot === null
    ? null
    : join(seams.projectRoot, AGENT_DEFINITION_DIR);
}

/** A file's text, or null when nothing readable sits at `path`. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * One row from a file's frontmatter, with the name, place and verdict
 * given. Shared with the plugin and add-on readers (`plugins.ts`).
 */
export function sourceItem(
  kind: InventoryKind,
  source: InventorySource,
  name: string,
  path: string,
  check: SourceItem['check'],
): SourceItem {
  const text = readText(path);
  const frontmatter = text === null
    ? EMPTY_FRONTMATTER
    : readInventoryText(text);

  return {
    kind,
    name,
    source,
    path,
    summary: summarize(frontmatter.description),
    whenToUse: frontmatter.whenToUse,
    prevents: frontmatter.prevents,
    stack: frontmatter.stack,
    tags: frontmatter.tags,
    check,
  };
}

/** Rows sorted by name, then path, so two holders of a name keep a fixed order. */
export function byName(items: readonly SourceItem[]): readonly SourceItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/** A checker report on a file under `dir` as a skill row. */
export function skillItem(report: CheckReport, source: InventorySource, dir: string): SourceItem {
  const name = report.name ?? relative(dir, report.path);
  return sourceItem('skill', source, name, report.path, checkVerdict(report.issues));
}

/** One tier's skills tree. See the module note. */
export function readSkillTree(source: SkillTier, seams: TreeSeams): TreeListing {
  const dir = skillTierDirectory(source, seams);
  if (dir === null || !tierExists(dir)) {
    return { kind: 'skill', source, dir, exists: false, items: [] };
  }

  const report = checkDirectory(dir, 'skill', {
    projectRoot: source === 'project'
      ? seams.projectRoot
      : null,
    pathDirs: seams.pathDirs,
  });
  const items = report.reports
    .filter((entry) => entry.isFile)
    .map((entry) => skillItem(entry, source, dir));

  return { kind: 'skill', source, dir, exists: true, items: byName(items) };
}

/** One tier's agents tree. See the module note. */
export function readAgentTree(source: SkillTier, seams: TierSeams): TreeListing {
  const dir = agentTreeDirectory(source, seams);
  if (dir === null || !tierExists(dir)) {
    return { kind: 'agent', source, dir, exists: false, items: [] };
  }

  const items = readAgentDirectory(dir)
    .map((file) => sourceItem('agent', source, file.name, file.path, null));

  return { kind: 'agent', source, dir, exists: true, items: byName(items) };
}

/**
 * Every tier's skills tree, then every tier's agents tree, each in
 * {@link SKILL_TIERS} order: six listings, absent ones included.
 */
export function readTrees(seams: TreeSeams): readonly TreeListing[] {
  return [
    ...SKILL_TIERS.map((source) => readSkillTree(source, seams)),
    ...SKILL_TIERS.map((source) => readAgentTree(source, seams)),
  ];
}
