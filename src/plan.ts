#!/usr/bin/env bun

/**
 * ralph plan — generate a plan (and prerequisites) from a spec.
 *
 *   bun src/rafa.ts plan --spec=specs/my-feature.md [--stub=my-feature]
 *
 * Wraps the spec in the plan-generation instructions (`plan-prompt.md`)
 * with the plan format inlined from the dev-planner skill, and hands it
 * to the Planner port's `claude` adapter (`adapters/planner/claude.ts`),
 * resolved through the adapter registry, whose Claude Code session writes:
 *
 *   .plans/PLAN-<stub>.md            the flat checklist + technical context
 *   .plans/PREREQUISITES-<stub>.md   non-automatable setup steps (only if any)
 *
 * The stub defaults to the spec's basename. Execute the result with:
 *
 *   bun src/rafa.ts start --plan=.plans/PLAN-<stub>.md
 *
 * ## What the command keeps, and what the adapter does
 *
 * The command checks its command line (the config, `--spec`, `--stub`
 * and a plan already there), runs the usage check, reads `progress.txt`
 * unless `--no-progress` is given, and reads the template and the plan
 * format beside itself. It makes the adapter with the setting sources and
 * with {@link buildPlanPrompt} bound to what it read. The adapter reads
 * the spec, makes `.plans/`, runs the session, and answers the paths the
 * session wrote or rejects.
 *
 * The command writes every line the operator reads through the active
 * output (`adapters/output/active.ts`), at `info`, each message as
 * `console.log` printed it in phase 0. It refuses by throwing
 * `CommandExit` (`cli/command.ts`) and never by `process.exit`, so the
 * dispatcher writes the terminal event. A rejection throws the exit code
 * a `claude` planner's rejection carries, or 1 for any other, with the
 * rejection's message. An unusable config, a missing `--spec`, a spec
 * that does not exist and a plan already there each throw exit code 1
 * with the whole refusal as the message. Text mode writes that message to
 * stderr, the bytes the command printed there before; json mode carries it
 * in the terminal result.
 *
 * The registry is a parameter, {@link CORE_ADAPTER_REGISTRY} unless one
 * is handed over, so `plan.test.ts` resolves a fixture planner under the
 * same kind and spawns no session.
 *
 * ## One source for the plan format
 *
 * `.claude/skills/dev-planner/SKILL.md` is the only file the plan format
 * is written in. The template carries a `{PLAN_FORMAT}` slot where the
 * format goes, and {@link buildPlanPrompt} fills it with the skill's body.
 * A project running an installed rafa has no copy of the skill, so the
 * build copies it into `dist/` beside `plan-prompt.md`, and
 * {@link readPlanFormat} looks there first: beside this module, which is
 * `dist/` in a build, then at the checkout's own skill, which is what this
 * module finds when it runs from `src/`.
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
import type { ClaudeSettingSource } from './config.js';
import type { GeneratedPlan, Planner, PlanRequest } from './ports/index.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { activeOutput } from './adapters/output/active.js';
import { ClaudePlannerError } from './adapters/planner/claude.js';
import { CORE_ADAPTER_REGISTRY } from './adapters/registry.js';
import { CommandExit } from './cli/command.js';
import { loadConfig } from './config-load.js';
import { messageOf } from './config-sections.js';
import { ConfigError } from './config.js';
import { checkUsage } from './utils/claude.js';
import { getRepoRoot } from './utils/git.js';

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

/** The dev-planner skill, relative to the root of a rafa checkout. */
export const PLAN_FORMAT_SKILL = path.join('.claude', 'skills', 'dev-planner', 'SKILL.md');

/**
 * Where {@link readPlanFormat} looks for the skill, in order: beside the
 * module, where the build copies it, then the checkout's own skill one
 * directory up, where a module running from `src/` finds it.
 */
export function planFormatCandidates(moduleDir: string): string[] {
  return [
    path.join(moduleDir, path.basename(PLAN_FORMAT_SKILL)),
    path.join(moduleDir, '..', PLAN_FORMAT_SKILL),
  ];
}

/**
 * Reads the dev-planner skill the plan prompt inlines, from the first of
 * {@link planFormatCandidates} that exists.
 *
 * @throws Error when none exists, naming every path it looked at, so a
 * build that lost its copy refuses before any session starts.
 */
export function readPlanFormat(moduleDir: string): string {
  const candidates = planFormatCandidates(moduleDir);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found === undefined) {
    throw new Error(`The plan format is missing: no dev-planner SKILL.md at ${candidates.join(' or ')}`);
  }
  return fs.readFileSync(found, 'utf8');
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

/** The slots a plan-prompt template carries. */
export const PLAN_PROMPT_SLOTS = [
  'PLAN_FILE',
  'PREREQUISITES_FILE',
  'PROGRESS_SECTION',
  'PLAN_FORMAT',
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
 * its frontmatter is dropped here ({@link planFormatBody}).
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
  progressContent?: string,
): string {
  const values: Record<PlanPromptSlot, string> = {
    PLAN_FILE: `.plans/PLAN-${stub}.md`,
    PREREQUISITES_FILE: `.plans/PREREQUISITES-${stub}.md`,
    PROGRESS_SECTION: formatProgressSection(progressContent),
    PLAN_FORMAT: planFormatBody(planFormat),
    SPEC_CONTENT: specContent,
  };
  return template.replace(SLOT_PATTERN, (_slot: string, name: PlanPromptSlot) => values[name]);
}

/** Derives the plan stub from a spec path: specs/my-feature.md → my-feature. */
export function stubFromSpecPath(specPath: string): string {
  return path.basename(specPath).replace(/\.md$/, '');
}

/**
 * The setting sources the plan session loads: `loop.settingSources` from
 * the project's config under `repoRoot` and the user scope's under
 * `home`, over the default.
 *
 * A config the loop cannot run on refuses the command with every problem
 * named, as `rafa start` refuses one, before any session starts: a
 * `CommandExit` with exit code 1 whose message is the whole refusal.
 */
function resolvePlanSettingSources(
  repoRoot: string,
  home: string,
): readonly ClaudeSettingSource[] {
  try {
    return loadConfig({ root: repoRoot, home }).config.settingSources;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const problems = error.problems.map((problem) => `   ${problem}`);
    throw new CommandExit(1, ['❌ Refusing to generate a plan on this configuration:', ...problems].join('\n'));
  }
}

/**
 * The plan `planner` generates for `request`, or a `CommandExit` when it
 * rejects: its message the rejection's, and its exit code the one a
 * `claude` planner's rejection carries, or 1 for any other.
 */
async function generateOrExit(planner: Planner, request: PlanRequest): Promise<GeneratedPlan> {
  try {
    return await planner.create(request);
  } catch (error) {
    const exitCode = error instanceof ClaudePlannerError
      ? error.exitCode
      : 1;
    throw new CommandExit(exitCode, `\n❌ ${messageOf(error)}`);
  }
}

export default async function plan(
  args: string[],
  registry: AdapterRegistry = CORE_ADAPTER_REGISTRY,
): Promise<void> {
  const repoRoot = getRepoRoot();
  const settingSources = resolvePlanSettingSources(repoRoot, homedir());

  const specArg = argValue(args, '--spec');
  if (!specArg) {
    throw new CommandExit(1, [
      'Usage: ralph plan --spec=<spec-file>.md [--stub=<name>] [--no-progress]',
      'Specs live in specs/ (trackable follow-ups) or .specs/ (untracked, sensitive).',
    ].join('\n'));
  }

  const specPath = path.resolve(repoRoot, specArg);
  if (!fs.existsSync(specPath)) {
    throw new CommandExit(1, `❌ Spec file not found: ${specPath}`);
  }

  const stub = argValue(args, '--stub') ?? stubFromSpecPath(specPath);
  const planPath = path.join(repoRoot, '.plans', `PLAN-${stub}.md`);
  if (fs.existsSync(planPath)) {
    throw new CommandExit(1, `❌ .plans/${path.basename(planPath)} already exists — remove it or pass a different --stub.`);
  }

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
  const planner = registry.resolve('planner', 'claude').create({
    repoRoot,
    settingSources,
    planPrompt: (specContent, planStub) => buildPlanPrompt(
      template,
      planFormat,
      specContent,
      planStub,
      progressContent,
    ),
  });

  activeOutput().info(`📝 Generating .plans/PLAN-${stub}.md from ${path.basename(specPath)}...`);
  const generated = await generateOrExit(planner, { specPath: specArg, stub });

  activeOutput().info(`\n✅ Plan ready: ${generated.planPath}`);
  if (generated.prerequisitesPath !== null) {
    activeOutput().info(`⚠️  Prerequisites detected: complete ${generated.prerequisitesPath} before starting the loop.`);
  }
  activeOutput().info(`▶ Execute with: bun src/rafa.ts start --plan=${generated.planPath}`);
}
