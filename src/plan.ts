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
 * words are read by `board/spec-source.ts` and the routes are resolved
 * by `board/plan-spec.ts`, which builds the `gh` and `git` runners,
 * runs the cheap board checks and answers ONE spec path — a file for
 * `--spec`, and for the two board routes the snapshot of the issue body
 * written under `specs.dir`. Everything below that point is what
 * `--spec` always did: the stub, the prompt, the session, the stamp and
 * the classifier keys. A line naming no source is refused with
 * {@link usageRefusal}, and one naming two with the exclusion refusal,
 * both exit code 1.
 *
 * `--dry-run` reads and refuses everything and writes nothing, and
 * `--next` over a roadmap with nothing left prints a message; both end
 * the command at 0 before any session is paid for, which is why the
 * resolution is the first thing after the config.
 *
 * The board routes resolve BEFORE the plan-already-there refusal,
 * because the stub is read off the snapshot's name and there is no name
 * until the issue has been read. So `--issue` against a stub already
 * planned writes the snapshot and then refuses; the snapshot is the
 * text of an issue either way, and the refusal names the plan to remove.
 *
 * `--spec` names a file against the project root, and when nothing is
 * there, the same name under `specs.dir`; a spec in neither is refused,
 * naming both paths. So `--spec=my-feature.md` reads
 * `.rafa/specs/my-feature.md` in a project whose root holds no
 * `my-feature.md`, and a path written from the root, such as
 * `.rafa/specs/my-feature.md`, reads as it did before `specs.dir` was read. An
 * absolute `--spec` has the one candidate. The planner is handed the
 * candidate found, as the port documents a spec path: repository-relative
 * or absolute.
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
 * refusal — a closed or unlabelled issue, a leaking body, a snapshot
 * that differs with no `--refresh` — throws exit code 2, and a spec the
 * planner judged not ready throws exit code 3 with every gap in it. Text mode writes
 * that message to stderr, the bytes the command printed there before;
 * json mode carries it in the terminal result.
 *
 * ## The readiness gate's verdict
 *
 * The plan prompt asks the session to judge the spec BEFORE planning and
 * to END its final message with a `rafa:spec-review` block, which the
 * planner reads once and carries back both on the plan it answers and on
 * what it rejects with (`adapters/planner/claude.ts`). Neither of those acts on
 * it. This command does, through {@link enforceSpecReview}
 * (`board/gate.ts`): a review that is not ready moves the plan and the
 * prerequisites file into `rejected/` under `plan.dir` when the session
 * wrote them anyway, publishes the
 * gaps on the issue when there is one, swaps `spec:ready` for
 * `spec:needs-work`, and throws `CommandExit(3)` carrying every gap.
 * `--spec=<file>` has no issue and so no labels to move: that route
 * moves the files aside, prints and exits 3. The issue routes fill
 * {@link SpecReviewGateOptions.issue} with the number and the board
 * `board/plan-spec.ts` answers beside the spec, so a not-ready verdict
 * on an issue is published where the spec came from.
 *
 * A REJECTION is weighed differently from an answer, by
 * {@link rejectedReview}. One whose review block was READ and judged the
 * spec not ready is enforced: a session that judged a spec unplannable
 * writes no plan, and that rejection is the ordinary shape of the
 * verdict. One carrying an `absent` or `malformed` review is not,
 * because the session did not finish and what the operator needs is the
 * failure it ended with, not a gate refusal saying the review block was
 * missing.
 *
 * On a plan the planner DID answer, an `absent` or `malformed` review
 * does not refuse it by itself: the gate weighs the plan with
 * `plan validate`'s reader and answers `unread` for one that reads as
 * written, which this command records as `review: missing` in the
 * plan's `rafa:plan` block ({@link recordMissingReview},
 * `board/review-stamp.ts`) beside the gate's one warning. `board/gate.ts`
 * holds why a session's silence is no verdict on the spec.
 *
 * `--skip-review` bypasses that gate ALONE, and the plan it keeps
 * records `review: skipped` ({@link recordSkippedReview},
 * `board/review-stamp.ts`). Both it and `--no-comment` are read through
 * `readGateFlags` rather than here, and both are declared on
 * `commands/plan/create.ts` beside the board flags.
 *
 * ## What a plan off the board records
 *
 * A plan the issue routes generated records the issue it was planned
 * from, `issue: <n>` in its `rafa:plan` block, as the spec asks
 * ({@link recordPlanIssue}, `board/plan-field.ts`). The number is
 * written QUOTED, since the plan reader takes that field as a string and
 * reports a number as unusable; the note in `board/plan-field.ts` holds
 * the measurement.
 *
 * Every record is written AFTER the gate, so a plan the gate moved aside is
 * never stamped, and each is a warning when it cannot be written: the
 * plan is what the operator asked for, and a stamp that refused it
 * would throw away a session already paid for.
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
import type { SpecReviewGateOptions } from './board/gate.js';
import type { PlanFieldStamp } from './board/plan-field.js';
import type { SpecReviewReading } from './board/spec-review.js';
import type { RafaConfig } from './config.js';
import type { GeneratedPlan, Planner, PlanRequest } from './ports/index.js';

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { activeOutput } from './adapters/output/active.js';
import { ClaudePlannerError, planFilePath } from './adapters/planner/claude.js';
import { CORE_ADAPTER_REGISTRY } from './adapters/registry.js';
import { enforceSpecReview, readGateFlags, SKIP_REVIEW_FLAG } from './board/gate.js';
import { issueFieldLine, stampPlanIssue } from './board/plan-field.js';
import { resolvePlanSpec } from './board/plan-spec.js';
import {
  REVIEW_MISSING_LINE,
  REVIEW_SKIPPED_LINE,
  stampReviewMissing,
  stampReviewSkipped,
} from './board/review-stamp.js';
import { noSourceMessage, readSpecSourceFlags, SOURCE_REFUSAL_EXIT } from './board/spec-source.js';
import { CommandExit } from './cli/command.js';
import { loadConfig } from './config-load.js';
import { messageOf } from './config-sections.js';
import { ConfigError } from './config.js';
import { branchNameFor } from './start/branch-decision.js';
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
 * its frontmatter is dropped here ({@link planFormatBody}). `planDir` is
 * the directory the plan is written into, the run's resolved `plan.dir`,
 * and both files are named in it through `planFilePath`, as the adapter
 * names the files it looks for.
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
): string {
  const values: Record<PlanPromptSlot, string> = {
    PLAN_FILE: planFilePath(planDir, `PLAN-${stub}.md`),
    PREREQUISITES_FILE: planFilePath(planDir, `PREREQUISITES-${stub}.md`),
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
 * Where `--spec` looks for its spec, in order, each as the planner is
 * handed it: the value itself, read against the project root, then the
 * same value under `specsDir`. An absolute value is its one candidate,
 * and a second candidate spelled as the first is dropped. Exported for
 * tests.
 */
export function specCandidates(specArg: string, specsDir: string): string[] {
  if (path.isAbsolute(specArg)) return [specArg];
  return [...new Set([specArg, path.join(specsDir, specArg)])];
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

/**
 * The spec `--spec` names, as the planner is handed it: the first of
 * {@link specCandidates} that exists under `repoRoot`. When none does, a
 * `CommandExit` with exit code 1 naming every path looked at.
 */
function findSpec(repoRoot: string, specArg: string, specsDir: string): string {
  const candidates = specCandidates(specArg, specsDir);
  const found = candidates.find((candidate) => fs.existsSync(path.resolve(repoRoot, candidate)));
  if (found === undefined) {
    const looked = [...new Set(candidates.map((candidate) => path.resolve(repoRoot, candidate)))];
    throw new CommandExit(1, `❌ Spec file not found: ${looked.join(', or ')}`);
  }
  return found;
}

/**
 * The refusal a line naming no spec source gets: the usage, then
 * {@link noSourceMessage}, which names each of the three flags and where
 * a `--spec` file is looked for.
 */
export function usageRefusal(specsDir: string): string {
  return [
    'Usage: rafa plan create (--spec=<file>.md | --issue=<n> | --next[=<roadmap-issue>])',
    '  [--stub=<name>] [--no-progress] [--refresh] [--dry-run] [--skip-review] [--no-comment]',
    noSourceMessage(specsDir),
  ].join('\n');
}

/** Everything the readiness gate needs of a run but the verdict itself. */
type GateBase = Omit<SpecReviewGateOptions, 'review'>;

/**
 * The review a planner's rejection carries that the gate acts on: one
 * whose block was READ and judged the spec not ready. Every other
 * rejection answers undefined and keeps its own message; the module note
 * records why.
 */
function rejectedReview(error: unknown): SpecReviewReading | undefined {
  if (!(error instanceof ClaudePlannerError) || error.review === null) return undefined;
  return error.review.answer === 'not-ready'
    ? error.review
    : undefined;
}

/**
 * The plan `planner` generates for `request`, or a `CommandExit` when it
 * rejects: its message the rejection's, and its exit code the one a
 * `claude` planner's rejection carries, or 1 for any other.
 *
 * A rejection is weighed by the gate first, unless `--skip-review`
 * bypassed it, so a session that judged the spec unplannable and wrote
 * no plan ends with the gate's exit code 3 and its gaps rather than with
 * the adapter's "was not created" line.
 */
async function generateOrExit(
  planner: Planner,
  request: PlanRequest,
  gate: GateBase,
  skipReview: boolean,
): Promise<GeneratedPlan> {
  try {
    return await planner.create(request);
  } catch (error) {
    if (!skipReview) await enforceSpecReview({ ...gate, review: rejectedReview(error) });
    const exitCode = error instanceof ClaudePlannerError
      ? error.exitCode
      : 1;
    throw new CommandExit(exitCode, `\n❌ ${messageOf(error)}`);
  }
}

/**
 * Records one line in the generated plan's `rafa:plan` block, answering
 * whether the plan now carries it.
 *
 * A plan that cannot be read, cannot be written, or holds no readable
 * `rafa:plan` block is WARNED about and nothing else, and answers false:
 * the plan itself is what the operator asked for, and a stamp that
 * refused it would throw away a session already paid for. `line` is what
 * the warning calls the record.
 */
function recordInPlan(
  repoRoot: string,
  planPath: string,
  stamp: (written: string) => PlanFieldStamp,
  line: string,
): boolean {
  const file = path.resolve(repoRoot, planPath);
  const unrecorded = (why: string): boolean => {
    activeOutput().warn(`${planPath} does not record ${line}: ${why}`);
    return false;
  };

  let written: string;
  try {
    written = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return unrecorded(messageOf(error));
  }

  const stamped = stamp(written);
  if (!stamped.recorded) return unrecorded(stamped.note);
  if (stamped.answer !== 'unchanged') {
    try {
      fs.writeFileSync(file, stamped.text, 'utf8');
    } catch (error) {
      return unrecorded(messageOf(error));
    }
  }
  return true;
}

/** Records `review: skipped` in the plan `--skip-review` kept, and says so. */
function recordSkippedReview(repoRoot: string, planPath: string): void {
  if (!recordInPlan(repoRoot, planPath, stampReviewSkipped, REVIEW_SKIPPED_LINE)) return;
  activeOutput().info(`⏭  ${SKIP_REVIEW_FLAG}: the spec was not reviewed, and ${planPath} records ${REVIEW_SKIPPED_LINE}.`);
}

/** Records `review: missing` in the plan an unread review left standing, and says so. */
function recordMissingReview(repoRoot: string, planPath: string): void {
  if (!recordInPlan(repoRoot, planPath, stampReviewMissing, REVIEW_MISSING_LINE)) return;
  activeOutput().info(`🔍 ${planPath} records ${REVIEW_MISSING_LINE}: the session returned no readable rafa:spec-review block.`);
}

/** Records the issue a board route planned from in the plan it wrote, and says so. */
function recordPlanIssue(repoRoot: string, planPath: string, issue: number): void {
  const line = issueFieldLine(issue);
  if (!recordInPlan(repoRoot, planPath, (written) => stampPlanIssue(written, issue), line)) return;
  activeOutput().info(`🔖 ${planPath} records ${line}, the issue it was planned from.`);
}

export default async function plan(
  args: string[],
  repoRoot: string,
  registry: AdapterRegistry = CORE_ADAPTER_REGISTRY,
): Promise<void> {
  const { settingSources, planDir, specsDir, roadmapIssue } = resolvePlanConfig(repoRoot, homedir());
  const flags = readGateFlags(args);

  const source = readSpecSourceFlags(args);
  if (source.request === null) throw new CommandExit(SOURCE_REFUSAL_EXIT, usageRefusal(specsDir));

  const resolved = await resolvePlanSpec({
    request: source.request,
    refresh: source.refresh,
    dryRun: source.dryRun,
    repoRoot,
    specsDir,
    roadmapIssue,
    findSpec: (spec) => findSpec(repoRoot, spec, specsDir),
  });
  // `--dry-run` and a roadmap with nothing left have both said their
  // piece already; the run is over and no session is paid for.
  if (resolved.outcome === 'stopped') return;

  const specRequest = resolved.spec.path;
  const specPath = path.resolve(repoRoot, specRequest);

  const stub = argValue(args, '--stub') ?? stubFromSpecPath(specPath);
  const planFile = planFilePath(planDir, `PLAN-${stub}.md`);
  if (fs.existsSync(path.resolve(repoRoot, planFile))) {
    throw new CommandExit(1, `❌ ${planFile} already exists — remove it or pass a different --stub.`);
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
    planDir,
    settingSources,
    planPrompt: (specContent, planStub) => buildPlanPrompt(
      template,
      planFormat,
      specContent,
      planStub,
      planDir,
      progressContent,
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

  activeOutput().info(`📝 Generating ${planFile} from ${path.basename(specPath)}...`);
  const generated = await generateOrExit(planner, { specPath: specRequest, stub }, gate, flags.skipReview);

  if (flags.skipReview) {
    recordSkippedReview(repoRoot, generated.planPath);
  } else {
    // On an answer the paths are the planner's own, which are the files
    // it saw; the ones in `gate` are this command's spelling of them,
    // and are all a rejection leaves to go on.
    const standing = await enforceSpecReview({
      ...gate,
      planPath: generated.planPath,
      prerequisitesPath: generated.prerequisitesPath ?? gate.prerequisitesPath,
      review: generated.review,
    });
    if (standing === 'unread') recordMissingReview(repoRoot, generated.planPath);
  }

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
