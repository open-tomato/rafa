#!/usr/bin/env bun

/**
 * rafa plan — generate a plan (and prerequisites) from a spec.
 *
 *   bun src/rafa.ts plan --spec=specs/my-feature.md [--stub=my-feature]
 *   bun src/rafa.ts plan --issue=20
 *   bun src/rafa.ts plan --next
 *
 * Wraps the spec in the plan-generation instructions (`plan-prompt.md`)
 * with the plan format inlined from the dev-planner skill, and hands it
 * to the Planner port's `claude` adapter (`adapters/planner/claude.ts`),
 * resolved through the adapter registry, whose Claude Code session writes:
 *
 *   .rafa/plans/PLAN-<stub>.md            the flat checklist + technical context
 *   .rafa/plans/PREREQUISITES-<stub>.md   non-automatable setup steps (only if any)
 *
 * both in `plan.dir`, `.rafa/plans` unless a config names another. The
 * stub defaults to the spec's basename. Execute the result with:
 *
 *   rafa loop start --plan=.rafa/plans/PLAN-<stub>.md
 *
 * and the hint that line is printed in names the branch that run will
 * be on, `feat/<stub>`; see {@link runBranchLine}.
 *
 * ## What the command keeps, and what the adapter does
 *
 * The command checks its command line (the config, the spec source,
 * `--stub` and a plan already there), runs the usage check, reads
 * `progress.txt` unless `--no-progress` is given, and reads the template
 * and the plan format beside itself. It makes the adapter with the setting sources,
 * `plan.dir` and {@link buildPlanPrompt} bound to what it read. The
 * adapter reads the spec, makes `plan.dir`, runs the session, and answers
 * the paths the session wrote or rejects.
 *
 * ## Which spec, and where the plan is
 *
 * Three flags name one spec, and they are mutually exclusive:
 * `--spec=<file>`, `--issue=<n>` and `--next[=<roadmap-issue>]`. The
 * words, the `--spec` candidate rule, the two board routes and the two
 * offers a terminal makes possible are `commands/plan/spec-route.ts`'s,
 * which answers ONE spec path — a file for `--spec`, and for the board
 * routes the snapshot of the issue body written under `specs.dir`.
 * Everything below that point is what `--spec` always did: the stub,
 * the prompt, the session, the stamp and the classifier keys.
 *
 * A resolution that STOPPED ends the command at 0 before any session is
 * paid for: a `--dry-run` run, a roadmap with nothing left, and a
 * blocked `--next` line nobody said yes past. That is why the spec is
 * resolved as the first thing after the config, and why the
 * plan-already-there refusal comes after it — the stub is read off the
 * snapshot's name, and there is no name until the issue has been read.
 *
 * The plan is `PLAN-<stub>.md` in `plan.dir`, and the refusal, the
 * announcement, the plan prompt and the adapter all spell it through
 * `planFilePath` (`adapters/planner/claude.ts`), so the plan the session
 * is told to write is the plan the adapter looks for and the command
 * names.
 *
 * The command writes every line the operator reads through the active
 * output (`adapters/output/active.ts`), at `info`, each message as
 * `console.log` printed it in phase 0. It refuses by throwing
 * `CommandExit` (`cli/command.ts`) and never by `process.exit`, so the
 * dispatcher writes the terminal event. A rejection throws the exit code
 * a `claude` planner's rejection carries, or 1 for any other, with the
 * rejection's message. An unusable config, a line naming no spec source
 * or several, a spec that does not exist and a plan already there each
 * throw exit code 1 with the whole refusal as the message; a board
 * refusal — an issue or a roadmap whose author is trusted with nothing,
 * a closed or unlabelled issue, a leaking body, a snapshot that differs
 * with no `--refresh`, a reference of the saved copy check 4 reads as
 * dangling or suspect with no `--accept-refs`
 * (`commands/plan/refs-check.ts`) — throws exit code 2, and a spec the planner
 * judged not ready over a gap that blocks planning throws exit code 3
 * with every gap in it. Text mode writes
 * that message to stderr, the bytes the command printed there before;
 * json mode carries it in the terminal result.
 *
 * ## The verdict, and what the plan records
 *
 * The plan prompt asks the session to judge the spec BEFORE planning
 * and to END its final message with a `rafa:spec-review` block, which
 * the planner reads once and carries back both on the plan it answers
 * and on what it rejects with (`adapters/planner/claude.ts`). Neither
 * of those acts on it. This command does, through
 * `commands/plan/review-gate.ts`: it weighs the review a rejection
 * carries, runs the gate (`board/gate.ts`) over the plan an answer
 * carried, and exits 3 with every gap on a verdict the plan does not
 * stand on.
 *
 * What the gate lets stand is stamped in the plan's `rafa:plan` block
 * by `commands/plan/plan-record.ts`: `review: skipped` under
 * `--skip-review`, `review: missing` where the session returned no
 * readable review, and `issue: "<n>"` on a plan an issue route
 * generated. Every record is written AFTER the gate, so a plan the gate
 * moved aside is never stamped, and each is a warning when it cannot be
 * written. A fourth record, `review: assumed`, is the gate's own: a
 * verdict no gap of which blocks planning keeps its plan, and the gate
 * opens it with the assumptions and stamps the word in one write
 * (`board/gate.ts`).
 *
 * `--skip-review` and `--no-comment` are read through `readGateFlags`
 * (`board/gate.ts`) rather than here, and both are declared on
 * `commands/plan/create.ts` beside the board flags.
 *
 * The project root is a parameter, the root the dispatcher resolved
 * (`src/commands/wrap.ts`): `--spec` resolves against it, `plan.dir` and
 * `specs.dir` resolve under it unless absolute, `progress.txt` sits under
 * it, and its config is the project scope's.
 *
 * The registry is a parameter, {@link CORE_ADAPTER_REGISTRY} unless one
 * is handed over, so `plan.test.ts` resolves a fixture planner under the
 * same kind and spawns no session.
 *
 * ## One source for the plan format
 *
 * `src/bundled/skills/dev-planner/SKILL.md`, the rafa tier's copy, is the
 * only file the plan format is written in. The template carries a
 * `{PLAN_FORMAT}` slot where the format goes, and {@link buildPlanPrompt}
 * fills it with the skill's body. {@link readPlanFormat} reads it at
 * {@link PLAN_FORMAT_SKILL} under this module's directory, which is
 * `src/` in a checkout and `dist/` in a build, where the build copies
 * `src/bundled/` whole; a project running an installed rafa has no copy
 * of its own. The directory is this module's `import.meta.url`, not the
 * entry `bundledSkillsDirectory` measures from (`src/schema/tiers.ts`):
 * `planCommand` also runs from the library bundle, `dist/index.js`,
 * where `Bun.main` is the importing program and not rafa's `cli.js`.
 *
 * ## The routing table
 *
 * The template carries a `{ROUTING}` slot beside `{PLAN_FORMAT}`, and
 * {@link buildPlanPrompt} fills it with {@link formatRoutingSection}:
 * the resolved `routing` setting (`tiers/routing.ts` holds its
 * defaults) as a shape → agent table, so the planner routes tasks by the
 * map this project's config resolved rather than by a table written into
 * a page. A `false` row is the setting's removal and is left out; a map
 * with no row left renders a sentence saying so, so the slot never
 * vanishes silently. The command hands over `config.routing` as it
 * resolved it for the rest of the run.
 *
 * ## The skill index
 *
 * The template carries a `{SKILL_INDEX}` slot after `{ROUTING}`, and
 * {@link buildPlanPrompt} fills it with {@link formatSkillIndexSection}:
 * a heading over the index `renderSkillIndex` (`task/skill-index.ts`)
 * writes, one line per skill a loop session will see, so a plan can name
 * the skills a task needs. The command reads it with
 * {@link readPlanSkillIndex}: the three tiers read and resolved under
 * the run's config by `resolveSessionTiers` (`start/serving.ts`), the
 * call that serves a loop session, with the rafa tier beside this module
 * as {@link readPlanFormat} finds the plan format. An index with no line
 * renders a sentence saying no skill reaches a session, so the slot never
 * vanishes silently.
 *
 * ## The settings the session loads
 *
 * The session loads settings from the sources `loop.settingSources`
 * names, resolved from the project's and the user scope's
 * `.rafa/config.yaml` as `rafa start` resolves them (`config-load.ts`),
 * so a plan is generated under the sources its tasks run under. A config
 * the loop cannot run on refuses the command before any session starts.
 */
import type { AdapterRegistry } from './adapters/registry.js';
import type { GateBase } from './commands/plan/review-gate.js';
import type { RouteTarget } from './config-sections.js';
import type { RafaConfig } from './config.js';
import type { TierSettings } from './tiers/resolve.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { activeOutput } from './adapters/output/active.js';
import { planFilePath } from './adapters/planner/claude.js';
import { CORE_ADAPTER_REGISTRY } from './adapters/registry.js';
import { readGateFlags } from './board/gate.js';
import { CommandExit } from './cli/command.js';
import { recordPlanIssue } from './commands/plan/plan-record.js';
import { announceCreateRefs, checkCreateRefs } from './commands/plan/refs-check.js';
import { generateOrExit, settleReview } from './commands/plan/review-gate.js';
import { resolveCreateSpec } from './commands/plan/spec-route.js';
import { loadConfig } from './config-load.js';
import { ConfigError } from './config.js';
import { requireNoticesAnswered } from './notices/run.js';
import { BUNDLED_SKILLS_DIR } from './schema/tiers.js';
import { branchNameFor } from './start/branch-decision.js';
import { resolveSessionTiers } from './start/serving.js';
import { renderSkillIndex } from './task/skill-index.js';
import { DEFAULT_ROUTING } from './tiers/routing.js';
import { checkUsage } from './utils/claude.js';
import { planStubFromPath } from './utils/plan-stamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argValue(args: string[], flag: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit?.slice(flag.length + 1);
}

/**
 * Keeps the injected progress notes bounded: progress.txt is curated by the
 * loop prompt (broad findings only, deduped), but it accrues across plans —
 * beyond the cap only the most recent findings are kept.
 */
const PROGRESS_CAP_CHARS = 16_000;

/** Formats the optional progress section for the plan prompt. Exported for tests. */
export function formatProgressSection(progressContent: string | undefined): string {
  const trimmed = progressContent?.trim();
  if (!trimmed) return '';

  const capped = trimmed.length > PROGRESS_CAP_CHARS
    ? `…(older findings truncated)…\n${trimmed.slice(-PROGRESS_CAP_CHARS)}`
    : trimmed;

  return [
    '## Findings from previous runs (progress.txt)',
    '',
    'Curated notes earlier loop runs left behind: patterns this codebase uses,',
    'gotchas hit, useful module locations. Treat them as ADVISORY context for',
    'better task ordering and to avoid re-discovering known traps — they are',
    'not requirements, they may be stale, and they must NOT be copied into',
    'the plan.',
    '',
    capped,
    '',
  ].join('\n');
}

/** The dev-planner skill in the rafa tier, relative to the directory holding the entry. */
export const PLAN_FORMAT_SKILL = path.join(BUNDLED_SKILLS_DIR, 'dev-planner', 'SKILL.md');

/**
 * Where {@link readPlanFormat} reads the skill: {@link PLAN_FORMAT_SKILL}
 * under `moduleDir`, `src/` from the checkout and `dist/` in a build.
 */
export function planFormatPath(moduleDir: string): string {
  return path.join(moduleDir, PLAN_FORMAT_SKILL);
}

/**
 * Reads the dev-planner skill the plan prompt inlines, from
 * {@link planFormatPath}.
 *
 * @throws Error when it is not there, naming the path, so a build that
 * lost its copy refuses before any session starts.
 */
export function readPlanFormat(moduleDir: string): string {
  const skill = planFormatPath(moduleDir);
  if (!fs.existsSync(skill)) {
    throw new Error(`The plan format is missing: no dev-planner SKILL.md at ${skill}`);
  }
  return fs.readFileSync(skill, 'utf8');
}

/** A YAML frontmatter block opening a file, and the blank lines after it. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)*/;

/**
 * The skill as the prompt inlines it: the body, without the frontmatter
 * that names the skill to its loader, and without trailing whitespace. A
 * file with no frontmatter is inlined whole.
 */
export function planFormatBody(skill: string): string {
  return skill.replace(FRONTMATTER, '').trimEnd();
}

/** The heading {@link formatRoutingSection} opens the `{ROUTING}` slot with. */
export const ROUTING_HEADING = '## Task shape to agent (the `routing` setting)';

/**
 * One table cell as a code span: whitespace runs collapsed to one space,
 * `|` escaped so it cannot end the cell, and a backtick fence one longer
 * than the longest backtick run inside, padded when the value touches a
 * backtick, so any name the setting accepts renders as written.
 */
function codeCell(value: string): string {
  const flat = value
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('|', '\\|');
  const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`')
    ? ' '
    : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * Renders the resolved `routing` setting for the `{ROUTING}` slot: a
 * heading, one sentence on how to use it, and a `Shape | Agent` table in
 * the map's order. A `false` row is removed and not listed; a map with
 * no row left says that no shape is routed. Exported for tests.
 */
export function formatRoutingSection(routing: ReadonlyMap<string, RouteTarget>): string {
  const rows = [...routing].flatMap(([shape, agent]) => agent === false
    ? []
    : [`| ${codeCell(shape)} | ${codeCell(agent)} |`]);
  if (rows.length === 0) {
    return [
      ROUTING_HEADING,
      '',
      'This project\'s `routing` setting routes no task shape to an agent. Declare the granular keys',
      'on each task instead of `agent=`.',
    ].join('\n');
  }
  return [
    ROUTING_HEADING,
    '',
    'Route each task by its SHAPE to the agent this project\'s `routing` setting names for it,',
    'written as `{agent=<name>}` on the task line. Where no row fits, declare the granular keys',
    'instead of an agent.',
    '',
    '| Shape | Agent |',
    '| --- | --- |',
    ...rows,
  ].join('\n');
}

/** The heading {@link formatSkillIndexSection} opens the `{SKILL_INDEX}` slot with. */
export const SKILL_INDEX_HEADING = '## Skill index (the skills a loop session will see)';

/**
 * Renders a rendered skill index for the `{SKILL_INDEX}` slot: a
 * heading, one sentence on how a line reads, and the index as written.
 * An empty index says that no skill reaches a loop session. Exported for
 * tests.
 */
export function formatSkillIndexSection(index: string): string {
  if (index.trim() === '') {
    return [
      SKILL_INDEX_HEADING,
      '',
      'No skill reaches a loop session under this project\'s settings.',
    ].join('\n');
  }
  return [
    SKILL_INDEX_HEADING,
    '',
    'One skill per line, as `name — tags — what it prevents`, or its description where it names',
    'nothing it prevents.',
    '',
    index,
  ].join('\n');
}

/**
 * The skill index for a plan written under `settings`: the three tiers
 * read under `repoRoot` and `home`, with the rafa tier beside `entry`,
 * resolved as a loop session is served them, and rendered by
 * `renderSkillIndex`. See "The skill index".
 */
export function readPlanSkillIndex(
  repoRoot: string,
  home: string,
  settings: TierSettings,
  entry: string,
): string {
  return renderSkillIndex(resolveSessionTiers({ root: repoRoot, home, settings, entry }));
}

/** The slots a plan-prompt template carries. */
export const PLAN_PROMPT_SLOTS = [
  'PLAN_FILE',
  'PREREQUISITES_FILE',
  'PROGRESS_SECTION',
  'PLAN_FORMAT',
  'ROUTING',
  'SKILL_INDEX',
  'SPEC_CONTENT',
] as const;

/** One of {@link PLAN_PROMPT_SLOTS}. */
export type PlanPromptSlot = (typeof PLAN_PROMPT_SLOTS)[number];

/** Any slot, braces included, with its name captured. */
const SLOT_PATTERN = new RegExp(`\\{(${PLAN_PROMPT_SLOTS.join('|')})\\}`, 'g');

/**
 * Builds the full plan-generation prompt. Exported for tests.
 *
 * `planFormat` is the dev-planner skill as read ({@link readPlanFormat});
 * its frontmatter is dropped here ({@link planFormatBody}). `planDir` is
 * the directory the plan is written into, the run's resolved `plan.dir`,
 * and both files are named in it through `planFilePath`, as the adapter
 * names the files it looks for. `routing` is the resolved `routing`
 * setting the `{ROUTING}` slot renders ({@link formatRoutingSection}),
 * rafa's defaults unless one is handed over. `skillIndex` is the index
 * the `{SKILL_INDEX}` slot renders ({@link formatSkillIndexSection}), as
 * {@link readPlanSkillIndex} reads it; empty unless one is handed over.
 *
 * Every slot is filled in ONE pass over the template, through a replacer
 * function. Filled text is never scanned again, so a spec, a progress
 * note or the skill that names a slot keeps the name as written, and no
 * filled text is read as a replacement pattern, so a `$&` in it stays
 * two characters. Measured on the chained `replaceAll` calls this
 * replaced: a spec holding `$&` came out holding `{SPEC_CONTENT}`, and a
 * progress note naming `{SPEC_CONTENT}` came out holding the spec.
 */
export function buildPlanPrompt(
  template: string,
  planFormat: string,
  specContent: string,
  stub: string,
  planDir: string,
  progressContent?: string,
  routing: ReadonlyMap<string, RouteTarget> = DEFAULT_ROUTING,
  skillIndex = '',
): string {
  const values: Record<PlanPromptSlot, string> = {
    PLAN_FILE: planFilePath(planDir, `PLAN-${stub}.md`),
    PREREQUISITES_FILE: planFilePath(planDir, `PREREQUISITES-${stub}.md`),
    PROGRESS_SECTION: formatProgressSection(progressContent),
    PLAN_FORMAT: planFormatBody(planFormat),
    ROUTING: formatRoutingSection(routing),
    SKILL_INDEX: formatSkillIndexSection(skillIndex),
    SPEC_CONTENT: specContent,
  };
  return template.replace(SLOT_PATTERN, (_slot: string, name: PlanPromptSlot) => values[name]);
}

/** Derives the plan stub from a spec path: specs/my-feature.md → my-feature. */
export function stubFromSpecPath(specPath: string): string {
  return path.basename(specPath).replace(/\.md$/, '');
}

/**
 * The branch `rafa loop start` will run this plan on, as a line printed
 * under the `Execute with` hint — or null when there is none to name.
 *
 * The stub is read back off the plan the planner wrote, with
 * {@link planStubFromPath}, rather than off the `--stub` this command
 * resolved: the path is the adapter's own, and `loop start` derives the
 * branch from that same path, so what is printed here is the name the
 * run will build. A plan whose name carries no stub (`PLAN.md`) answers
 * null, because `loop start` would name no branch for it either and a
 * `feat/` with nothing after it is not a name to print.
 *
 * Exported for tests.
 */
export function runBranchLine(planPath: string): string | null {
  const stub = planStubFromPath(planPath);
  return stub === null
    ? null
    : `   Runs on ${branchNameFor(stub)} — started from the base branch, the run offers to create it.`;
}

/**
 * The config the plan command runs on: the project's config under
 * `repoRoot` over the user scope's under `home`, over the defaults. The
 * session loads its `loop.settingSources`, `plan.dir` places the plan and
 * `specs.dir` is where a spec the root does not hold is looked for.
 *
 * A config the loop cannot run on refuses the command with every problem
 * named, as `rafa start` refuses one, before any session starts: a
 * `CommandExit` with exit code 1 whose message is the whole refusal.
 */
function resolvePlanConfig(repoRoot: string, home: string): RafaConfig {
  try {
    return loadConfig({ root: repoRoot, home }).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const problems = error.problems.map((problem) => `   ${problem}`);
    throw new CommandExit(1, ['❌ Refusing to generate a plan on this configuration:', ...problems].join('\n'));
  }
}

export default async function plan(
  args: string[],
  repoRoot: string,
  registry: AdapterRegistry = CORE_ADAPTER_REGISTRY,
): Promise<void> {
  const home = homedir();
  const config = resolvePlanConfig(repoRoot, home);
  const {
    settingSources,
    routing,
    planDir,
    specsDir,
    roadmapIssue,
    boardTrustedAuthors,
    dangerousAcceptStaleRefs,
  } = config;
  const flags = readGateFlags(args);
  // Before any board read, so an operator who forgot the setting is told
  // before anything is spent (`commands/plan/refs-check.ts`).
  announceCreateRefs(args, dangerousAcceptStaleRefs);

  const resolved = await resolveCreateSpec({
    args,
    repoRoot,
    specsDir,
    roadmapIssue,
    trustedAuthors: boardTrustedAuthors,
  });
  // `--dry-run`, a roadmap with nothing left and a blocked next line
  // nobody said yes past have each said their piece already; the run is
  // over and no session is paid for.
  if (resolved.outcome === 'stopped') return;

  const specRequest = resolved.spec.path;
  const specPath = path.resolve(repoRoot, specRequest);

  const stub = argValue(args, '--stub') ?? stubFromSpecPath(specPath);
  const planFile = planFilePath(planDir, `PLAN-${stub}.md`);
  if (fs.existsSync(path.resolve(repoRoot, planFile))) {
    throw new CommandExit(1, `❌ ${planFile} already exists — remove it or pass a different --stub.`);
  }

  // Check 4: the references the saved copy names, read against its
  // stamps, before any session is paid for. `--spec` has no copy to read.
  await checkCreateRefs({ spec: resolved.spec, repoRoot, args, acceptStaleRefs: dangerousAcceptStaleRefs });

  await checkUsage('issue');

  // Feed the loop's accumulated findings into planning (opt out with
  // --no-progress): the planner never used to see progress.txt, which meant
  // every plan re-discovered known gotchas and module locations.
  const progressPath = path.join(repoRoot, 'progress.txt');
  const progressContent = !args.includes('--no-progress') && fs.existsSync(progressPath)
    ? fs.readFileSync(progressPath, 'utf8')
    : undefined;
  if (progressContent?.trim()) {
    activeOutput().info('📎 Including findings from progress.txt (disable with --no-progress).');
  }

  const template = fs.readFileSync(path.join(__dirname, 'plan-prompt.md'), 'utf8');
  const planFormat = readPlanFormat(__dirname);
  const skillIndex = readPlanSkillIndex(repoRoot, home, config, fileURLToPath(import.meta.url));
  const planner = registry.resolve('planner', 'claude').create({
    repoRoot,
    planDir,
    settingSources,
    planPrompt: (specContent, planStub) => buildPlanPrompt(
      template,
      planFormat,
      specContent,
      planStub,
      planDir,
      progressContent,
      routing,
      skillIndex,
    ),
  });

  const gate: GateBase = {
    source: resolved.spec.source,
    repoRoot,
    planPath: planFile,
    prerequisitesPath: planFilePath(planDir, `PREREQUISITES-${stub}.md`),
    issue: resolved.gate,
    comment: flags.comment,
  };

  // The planner is a session too: the same notices `loop start` shows
  // (`notices/notices.ts`), ahead of the one call that costs money.
  await requireNoticesAnswered();

  activeOutput().info(`📝 Generating ${planFile} from ${path.basename(specPath)}...`);
  const generated = await generateOrExit(planner, { specPath: specRequest, stub }, gate, flags.skipReview);

  await settleReview(gate, generated, flags.skipReview);

  if (resolved.spec.issue !== null) {
    recordPlanIssue(repoRoot, generated.planPath, resolved.spec.issue);
  }

  activeOutput().info(`\n✅ Plan ready: ${generated.planPath}`);
  if (generated.prerequisitesPath !== null) {
    activeOutput().info(`⚠️  Prerequisites detected: complete ${generated.prerequisitesPath} before starting the loop.`);
  }
  activeOutput().info(`▶ Execute with: rafa loop start --plan=${generated.planPath}`);
  const branchLine = runBranchLine(generated.planPath);
  if (branchLine !== null) {
    activeOutput().info(branchLine);
  }
}
