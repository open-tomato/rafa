/**
 * `rafa skill list [--tier=project|rafa|user]`: every skill the three
 * tiers register, each with its tier, its `stack` and whether it passes
 * the checker.
 *
 * `rafa skill check <dir>` answers one directory in detail and exits
 * with its failures. This command answers the other question: what is
 * INSTALLED, where each one comes from, and how much of it is v2. The
 * tiers are `src/schema/tiers.ts`'s — `<root>/.claude/skills`,
 * `skills/` beside the running `cli.js`, and `~/.claude/skills` — and
 * the pass column is `checkDirectory`'s, so the two commands can never
 * disagree about a file.
 *
 * ## What each row says
 *
 * The skill's name as its place implies it, its `stack` as its
 * frontmatter carries it, and a mark: passing, or the number of
 * failures the checker counted. A file whose frontmatter cannot be read
 * at all, or which carries no `stack`, shows an empty stack and,
 * ordinarily, a failure beside it — `stack` is a required field, so a
 * row with no stack is a row the checker already reddened.
 *
 * The `stack` is read from the file a SECOND time, here, because a
 * {@link CheckReport} carries the rules a file broke and not the block
 * it carries; the checker has no reason to hand back frontmatter and
 * this is the only caller that wants it.
 *
 * ## The exit code is 0 whatever the rows say
 *
 * A listing reports; it does not gate. A tier full of failing skills
 * still exits 0, and the number beside each row is what to run
 * `rafa skill check` on. Exit code 1 is kept for the refusals: a
 * positional word, and a `--tier` naming something that is no tier.
 *
 * ## Which project a body is resolved in
 *
 * The project tier is checked against the project the dispatcher found,
 * since a skill in this checkout's `.claude/skills` is consumed in this
 * checkout. The `user` and `rafa` tiers are checked with NO project
 * root, as `rafa skill check` without `--project` is: their bodies are
 * consumed in every project and in none, so a path that looks like a
 * project path is counted as a warning there rather than a failure.
 * Warnings never redden a row.
 *
 * ## An absent tier is a row of its own
 *
 * The rafa tier is ordinarily absent until phase 6 populates it, and a
 * project may carry no `.claude/skills` at all. Such a tier prints its
 * path and `no such directory`, which is the reading a person wants;
 * `checkDirectory` throws on a missing directory, so the existence is
 * asked first ({@link tierExists}) rather than caught.
 *
 * ## The entry is a seam
 *
 * The rafa tier is measured from this process's entry, which under
 * `bun test` is the test runner rather than a `cli.js`. So the entry is
 * {@link SkillListSeams.entry}, `Bun.main` by default and a planted
 * file in a test, which is what lets a case have a rafa tier of its own
 * without writing beside the running build. The home and the project
 * root need no seam: they are the ones the dispatcher resolved.
 */
import type { CheckReport } from '../../check/run.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ProjectFound } from '../../project/scope.js';
import type { SkillTier, TierSeams } from '../../schema/tiers.js';

import { readFileSync } from 'node:fs';

import { pathDirectories } from '../../check/references.js';
import { checkDirectory } from '../../check/run.js';
import { CommandExit } from '../../cli/command.js';
import { readFrontmatter } from '../../schema/frontmatter.js';
import { isSkillTier, resolveSkillTiers, SKILL_TIERS, tierExists } from '../../schema/tiers.js';
import { expectNoArgument } from '../plan/plan-files.js';

/** What neither the context nor the registry carries. */
export interface SkillListSeams {
  /** This process's entry, which the rafa tier sits beside. */
  readonly entry: () => string;
}

/** The seams the registered command runs with. */
export const DEFAULT_SKILL_LIST_SEAMS: SkillListSeams = Object.freeze({
  entry: () => Bun.main,
});

/** The usage line a refusal names. */
const USAGE = 'rafa skill list [--tier=project|rafa|user]';

/** One skill, as a tier holds it. */
export interface SkillRow {
  /** Which tier registers it. */
  readonly tier: SkillTier;
  /** The name its place implies, or its path under the tier when its place implies none. */
  readonly name: string;
  /** The file, or the directory when the finding is that it holds no `SKILL.md`. */
  readonly path: string;
  /** `stack` as the frontmatter carries it, empty when it carries none. */
  readonly stack: readonly string[];
  /** Whether the checker found no failure. */
  readonly ok: boolean;
  /** How many failures the checker counted, 0 on a passing row. */
  readonly failures: number;
}

/** One tier, and what it holds. */
export interface TierListing {
  /** Which tier. */
  readonly tier: SkillTier;
  /** The directory it resolved to. */
  readonly dir: string;
  /** Whether that directory is there at all. */
  readonly exists: boolean;
  /** One row per entry the layout scan found, in path order. Empty for an absent tier. */
  readonly skills: readonly SkillRow[];
}

/** What json mode gives as the terminal result's `data`. */
export interface SkillListResult {
  /** The project the project tier was read from and resolved against. */
  readonly projectRoot: string;
  /** The tier the line narrowed to, or null when it listed them all. */
  readonly tier: SkillTier | null;
  /** One entry per tier listed, in {@link SKILL_TIERS} order. */
  readonly tiers: readonly TierListing[];
  /** How many rows there are in all. */
  readonly total: number;
  /** How many of them pass the checker. */
  readonly passing: number;
}

/** The tier `--tier` names, or null when the line left the flag out. */
export function readTierFlag(value: string | boolean | undefined): SkillTier | null {
  if (value === undefined || value === false) return null;
  if (typeof value !== 'string' || value === '') {
    throw new CommandExit(1, `❌ --tier needs a value: --tier=<tier>\nUsage: ${USAGE}`);
  }
  if (isSkillTier(value)) return value;
  throw new CommandExit(
    1,
    `❌ --tier is "${value}", expected one of: ${SKILL_TIERS.join(', ')}\nUsage: ${USAGE}`,
  );
}

/**
 * `stack` as the file's frontmatter carries it, and empty for a file
 * that cannot be read, carries no frontmatter, or carries no `stack`
 * list. Every entry is taken as written, whatever the vocabulary says:
 * the checker has already judged it, and a row showing `stack: [nope]`
 * beside a failure is the reading that explains the failure.
 */
export function skillStack(path: string): readonly string[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const data = readFrontmatter(text);
  const value = data?.['stack'];
  return Array.isArray(value)
    ? value.map((entry) => String(entry))
    : [];
}

/** How many of a report's issues count towards a failure. */
export function failureCount(report: CheckReport): number {
  return report.issues.filter((issue) => issue.severity === 'failure').length;
}

/** One report as a row, reading the file's `stack` when there is a file. */
export function skillRow(report: CheckReport, tier: SkillTier, dir: string): SkillRow {
  const relative = report.path.startsWith(`${dir}/`)
    ? report.path.slice(dir.length + 1)
    : report.path;
  return {
    tier,
    name: report.name ?? relative,
    path: report.path,
    stack: report.isFile
      ? skillStack(report.path)
      : [],
    ok: !report.failed,
    failures: failureCount(report),
  };
}

/** The tiers to list: the one `--tier` named, or all of them. */
function listedTiers(tier: SkillTier | null, seams: TierSeams): readonly { tier: SkillTier; dir: string }[] {
  return resolveSkillTiers(seams).filter((location) => tier === null || location.tier === tier);
}

/** One tier checked, or an empty listing when its directory is not there. */
export function listTier(
  tier: SkillTier,
  dir: string,
  options: { readonly projectRoot: string | null; readonly pathDirs: readonly string[] },
): TierListing {
  if (!tierExists(dir)) return { tier, dir, exists: false, skills: [] };
  const report = checkDirectory(dir, 'skill', {
    projectRoot: options.projectRoot,
    pathDirs: options.pathDirs,
  });
  return {
    tier,
    dir,
    exists: true,
    skills: report.reports.map((entry) => skillRow(entry, tier, dir)),
  };
}

/** A row as text mode writes it: the mark, the name, the stack, and the failures. */
export function skillRowLine(row: SkillRow): string {
  const stack = row.stack.length === 0
    ? '—'
    : row.stack.join(', ');
  const failures = row.ok
    ? ''
    : `  ${String(row.failures)} failure(s)`;
  const mark = row.ok
    ? '✅'
    : '❌';
  return `    ${mark} ${row.name}  [${stack}]${failures}`;
}

/** A tier as text mode writes it: its heading, then its rows or why it has none. */
export function tierLines(listing: TierListing): readonly string[] {
  if (!listing.exists) return [`  ${listing.tier}  ${listing.dir}  (no such directory)`];
  if (listing.skills.length === 0) return [`  ${listing.tier}  ${listing.dir}  (no skills)`];
  return [
    `  ${listing.tier}  ${listing.dir}`,
    ...listing.skills.map(skillRowLine),
  ];
}

/** Every line text mode writes: the heading, each tier, then the count. */
export function renderSkillList(result: SkillListResult): readonly string[] {
  const scope = result.tier === null
    ? 'Skills by tier'
    : `Skills in the ${result.tier} tier`;
  return [
    `${scope} (project: ${result.projectRoot}):`,
    ...result.tiers.flatMap((listing) => tierLines(listing)),
    `${String(result.total)} skill(s): ${String(result.passing)} pass the checker,`
      + ` ${String(result.total - result.passing)} do not`,
  ];
}

/** Every row of every tier, in tier order. */
function allRows(tiers: readonly TierListing[]): readonly SkillRow[] {
  return tiers.flatMap((listing) => listing.skills);
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa skill list runs inside a project, and was handed none');
  return context.project;
}

/** Lists the tiers. See the module note. */
function runList(context: RafaContext, seams: SkillListSeams): void {
  const tier = readTierFlag(context.flags['tier']);
  expectNoArgument(context.args, USAGE);
  const project = projectOf(context);
  const pathDirs = pathDirectories(context.env['PATH']);
  const tierSeams: TierSeams = { home: project.home, projectRoot: project.root, entry: seams.entry() };

  const tiers = listedTiers(tier, tierSeams).map((location) => listTier(location.tier, location.dir, {
    projectRoot: location.tier === 'project'
      ? project.root
      : null,
    pathDirs,
  }));
  const rows = allRows(tiers);
  const result: SkillListResult = {
    projectRoot: project.root,
    tier,
    tiers,
    total: rows.length,
    passing: rows.filter((row) => row.ok).length,
  };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderSkillList(result)) context.output.info(line);
}

/** The command, measuring the rafa tier from `seams`. See the module note. */
export function createSkillListCommand(seams: SkillListSeams = DEFAULT_SKILL_LIST_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill list',
    subject: 'skill',
    action: 'list',
    summary: 'list the skills each tier registers, with their stack and whether they pass the checker',
    description: 'Lists every skill the three tiers register — the project\'s `.claude/skills`, the `skills/`'
      + ' directory beside the running rafa, and `~/.claude/skills` — with, for each, the tier it comes from,'
      + ' the `stack` its frontmatter carries and whether it passes the same checks `rafa skill check` runs,'
      + ' with the number of failures beside a skill that does not. A tier whose directory is not there says'
      + ' so and holds up nothing. The project tier is checked against this project, and the user and rafa'
      + ' tiers against none, so a body naming a project path is a warning there rather than a failure.'
      + ' `--tier=<tier>` narrows to one of them. The exit code is 0 whatever the rows say: this command'
      + ' reports and `rafa skill check` gates. With `--output=json` the tiers and their rows are the data of'
      + ' the terminal result event.',
    args: [],
    flags: [
      {
        name: 'tier',
        description: `List one tier alone: ${SKILL_TIERS.join(', ')}.`,
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa skill list',
        note: 'Lists all three tiers, each skill with its stack and whether it passes the checker.',
      },
      {
        cmd: 'rafa skill list --tier=user',
        note: 'Lists `~/.claude/skills` alone, which is where the backfill works.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runList(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createSkillListCommand();
