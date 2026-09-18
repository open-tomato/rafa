/**
 * Where a skill and an instinct live: the three skill tiers, the two
 * instinct scopes, and the paths each resolves to.
 *
 * `src/check/layout.ts` answers what one directory holds and
 * `src/check/run.ts` checks it; neither knows which directory it was
 * handed or why. This module is the other half: it answers WHICH
 * directories exist to be checked, so `rafa skill list` and every later
 * writer name a tier rather than a path, and one place carries the
 * answer when a tier moves.
 *
 * ## The three skill tiers
 *
 *   - `project`: `<root>/.claude/skills`, the checkout's own, which
 *     Claude Code loads for a session started in it.
 *   - `rafa`: `skills/` beside the running `cli.js`, the skills rafa
 *     ships. Phase 6 populates it; until then the directory is
 *     ordinarily absent, which {@link resolveSkillTiers} reports
 *     rather than hides.
 *   - `user`: `~/.claude/skills`, the machine's own.
 *
 * {@link SKILL_TIERS} is that order, which is the order the spec's
 * `--tier=project|rafa|user` writes them in and the order a listing
 * reads in: nearest the work first.
 *
 * ## The rafa tier is measured from the entry, with its links resolved
 *
 * The bundle is `dist/cli.js` and its skills sit beside it, so the tier
 * is `dirname(entry)/skills`. The entry is resolved through
 * {@link realEntry} because the installed rafa is reached through a
 * link — `~/.rafa/bin/rafa` points into `~/.rafa/runtime/<version>/` —
 * and the skills of a runtime sit in that runtime's directory, not in
 * `bin/`. `src/start/runtime.ts` compares entries the same way and for
 * the same reason.
 *
 * Run from the checkout as `bun src/rafa.ts`, the entry is
 * `src/rafa.ts` and the tier resolves to `src/skills`, which the
 * repository does not have. That is the honest answer for a checkout:
 * the tier is what the RUNNING build carries, and a checkout run
 * carries whatever sits beside the file bun was handed.
 *
 * ## The two instinct scopes
 *
 * `~/.rafa/instincts` and `<root>/.rafa/instincts`. There is no rafa
 * scope: an instinct is something a run learned, and rafa ships none.
 * The scopes are named `user` and `project` so a caller that carries
 * both kinds carries one vocabulary ({@link InstinctScope} is a subset
 * of {@link SkillTier}).
 *
 * ## No directory is read here
 *
 * Every function is path arithmetic over its seams, apart from the one
 * `realpathSync` {@link realEntry} makes, and {@link tierExists}, which
 * is the single `existsSync` a caller needs to tell an absent tier from
 * an empty one. So a test hands a home and a root of its own and gets
 * paths under them, and nothing here reaches the real home.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The skill tiers, nearest the work first. */
export const SKILL_TIERS = ['project', 'rafa', 'user'] as const;

/** One of {@link SKILL_TIERS}. */
export type SkillTier = typeof SKILL_TIERS[number];

/** The instinct scopes, nearest the work first. There is no rafa scope. */
export const INSTINCT_SCOPES = ['project', 'user'] as const;

/** One of {@link INSTINCT_SCOPES}. */
export type InstinctScope = typeof INSTINCT_SCOPES[number];

/** The skills directory Claude Code loads, under a project root or the home. */
export const CLAUDE_SKILLS_PATH = join('.claude', 'skills');

/** The instincts directory a scope holds, under a project root or the home. */
export const RAFA_INSTINCTS_PATH = join('.rafa', 'instincts');

/** The directory rafa's own skills sit in, beside the running `cli.js`. */
export const BUNDLED_SKILLS_DIR = 'skills';

/** What a tier is resolved against. Each seam is given; none is read from the environment. */
export interface TierSeams {
  /** The home directory, an absolute path. */
  readonly home: string;
  /** The project root, or null when the caller stands in no project. */
  readonly projectRoot: string | null;
  /** This process's entry, which the rafa tier sits beside. Defaults to `Bun.main`. */
  readonly entry?: string;
}

/** One tier and the directory it resolves to. */
export interface SkillTierLocation {
  /** Which tier. */
  readonly tier: SkillTier;
  /** The directory it resolves to, absolute. */
  readonly dir: string;
}

/** One instinct scope and the directory it resolves to. */
export interface InstinctScopeLocation {
  /** Which scope. */
  readonly scope: InstinctScope;
  /** The directory it resolves to, absolute. */
  readonly dir: string;
}

/** Whether `value` names a tier, for a `--tier` a line typed. */
export function isSkillTier(value: string): value is SkillTier {
  return (SKILL_TIERS as readonly string[]).includes(value);
}

/** Whether `value` names an instinct scope. */
export function isInstinctScope(value: string): value is InstinctScope {
  return (INSTINCT_SCOPES as readonly string[]).includes(value);
}

/** `entry` with its links resolved, or as it was when nothing is there. */
export function realEntry(entry: string): string {
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

/**
 * The directory rafa's own skills sit in: `skills/` beside the running
 * `cli.js`, links resolved. See the module note.
 */
export function bundledSkillsDirectory(entry?: string): string {
  return join(dirname(realEntry(entry ?? Bun.main)), BUNDLED_SKILLS_DIR);
}

/**
 * The directory `tier` resolves to, or null for the project tier with
 * no project root: a tier with no directory is not an empty one, and
 * a caller has to be able to tell them apart.
 */
export function skillTierDirectory(tier: SkillTier, seams: TierSeams): string | null {
  if (tier === 'user') return join(seams.home, CLAUDE_SKILLS_PATH);
  if (tier === 'rafa') return bundledSkillsDirectory(seams.entry);
  return seams.projectRoot === null
    ? null
    : join(seams.projectRoot, CLAUDE_SKILLS_PATH);
}

/**
 * Every tier that has a directory, in {@link SKILL_TIERS} order. The
 * directory need not be there: an absent one is {@link tierExists}'s
 * question, and a tier is left out here only when it resolves to no
 * path at all.
 */
export function resolveSkillTiers(seams: TierSeams): readonly SkillTierLocation[] {
  const located: SkillTierLocation[] = [];
  for (const tier of SKILL_TIERS) {
    const dir = skillTierDirectory(tier, seams);
    if (dir !== null) located.push({ tier, dir });
  }
  return located;
}

/** The directory `scope` resolves to, or null for the project scope with no project root. */
export function instinctScopeDirectory(scope: InstinctScope, seams: TierSeams): string | null {
  if (scope === 'user') return join(seams.home, RAFA_INSTINCTS_PATH);
  return seams.projectRoot === null
    ? null
    : join(seams.projectRoot, RAFA_INSTINCTS_PATH);
}

/** Every instinct scope that has a directory, in {@link INSTINCT_SCOPES} order. */
export function resolveInstinctScopes(seams: TierSeams): readonly InstinctScopeLocation[] {
  const located: InstinctScopeLocation[] = [];
  for (const scope of INSTINCT_SCOPES) {
    const dir = instinctScopeDirectory(scope, seams);
    if (dir !== null) located.push({ scope, dir });
  }
  return located;
}

/** Whether a resolved tier or scope directory is there at all. */
export function tierExists(dir: string): boolean {
  return existsSync(dir);
}
