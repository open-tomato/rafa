/**
 * The release around the wrap-up session: step 1 before it is spawned,
 * and step 3 — the verification, the restore, the commit, the push and
 * the forecast — after it returns.
 *
 * No branch owns a version number
 * (`.rafa/specs/rafa-367-releases-settle-base-branch.md`): the LOOP
 * writes the plan's change fragment, the SESSION rewrites its notes,
 * and the LOOP then verifies, commits and pushes that one file and
 * writes a forecast of what it ships into the pull request body. The
 * version and the changelog section are written on the base branch
 * alone, by `rafa release settle`. Only the middle third is a prompt
 * (`./wrap-up.ts`), and this module is the two outer thirds, in the
 * order `src/start/wrap-up-run.ts` runs them:
 *
 * ```text
 * prepareReleaseStage(input)           → ReleasePreparation | null
 *   preserveProgress(plan, …, that)    ← the session, elsewhere
 * finishRelease({ preparation, … })    → ReleaseFinish
 * ```
 *
 * Nothing here decides what a release says. The reading modules under
 * `src/release/` own that: `prepare.ts` writes the fragment or says why
 * it wrote none, `verify.ts` reads what the session made of it and
 * restores step 1's text on any refusal, and `branch-forecast.ts` folds
 * the verified fragment over the base and renders the body block. This
 * module is the ORDER those run in, the git the verified fragment is
 * committed and pushed with, and what a finish leaves in the pull
 * request body.
 *
 * ## Why the finish takes a record rather than reading the files again
 *
 * {@link finishRelease} is handed the very {@link ReleasePreparation}
 * {@link prepareReleaseStage} answered. A finish that re-read the
 * config and re-derived what step 1 should have written could disagree
 * with what step 1 DID write — a fragments directory edited mid-run, a
 * name allocated against a base that moved — and would then verify a
 * fragment nobody prepared. Passing the record through is also what
 * makes the two halves testable apart, and it is what lets the forecast
 * fold over the base step 1 read rather than reading it again.
 *
 * A preparation of `null` is the stage itself having failed to run at
 * all: the change notes could not be read, or the preparation threw.
 * It is not a skip — a skip is a preparation that ran and decided
 * against a fragment — so it reaches neither the prompt (`./wrap-up.ts`
 * gives a null preparation no release bullet) nor the pull request
 * body, and the wrap-up carries on without a release. That is the
 * direction to fail in: the promotion of the run's findings is worth
 * more than its fragment, and a wrap-up that never ran loses both.
 *
 * ## The commit holds the fragment and nothing else
 *
 * `git add -A` is never run here. The wrap-up session commits its own
 * work first and is told to leave the fragment unstaged, but "the
 * session left nothing behind" is not a thing this module can check,
 * and a sweep would put whatever it did leave under a `chore: release
 * fragment` subject. So the commit names its one path:
 *
 * ```text
 * git add -- <fragment>
 * git diff --cached --quiet -- <fragment>
 * git commit --cleanup=whitespace --only -m 'chore: release fragment <plan id>' -- <fragment>
 * ```
 *
 * The plan id is the plan stub, the one the fragment's `plan` field
 * carries. Measured in a scratch repository on git 2.50.1 (2026-09-20),
 * with `other.txt` modified and `new.txt` added and both staged
 * beforehand: the commit held the named path alone, and `git status
 * --porcelain` still answered `A  new.txt` and `M  other.txt`
 * afterwards, so a partial commit neither takes nor unstages what the
 * session left in the index. A pre-commit hook run by that commit reads
 * the temporary index git builds for it: a hook writing `git diff
 * --cached --name-only` to a file saw the named path alone while
 * `other.txt` was staged, which is what lets `.githooks/pre-commit`
 * gate the release file and only it.
 *
 * `--only` is the default mode when paths are given and is spelled out
 * anyway, so the line says which of the two commit modes it means.
 * `--cleanup=whitespace` is spelled for the reason `utils/commit.ts`
 * spells it: a machine-wide `commit.cleanup=strip` would otherwise
 * delete a message line opening with a hash.
 *
 * The middle reading is the one place the `pr/git.ts` runner is thinner
 * than this module would like. `git diff --cached --quiet` uses its
 * exit code as an answer — 0 for nothing staged, 1 for something — and
 * {@link GitResult} carries `ok` and no status, so an exit 128 reads
 * here as "something is staged". That is the harmless direction: the
 * commit that follows fails on the same fault and reports what git
 * said. A reading of 0 is the fragment holding no change against
 * `HEAD` — already committed, by the session or by an earlier wrap-up
 * — and the commit would then exit 1 with `no changes added to commit`.
 *
 * ## What the body is given
 *
 * Every way this stage falls short of a pushed fragment ends in one
 * sentence, and that sentence goes into the pull request body through
 * `PullRequests.editBody` (`./release-body.ts`): the spec's "on
 * failure restore step 1's text and say so in the PR body". The
 * sentence is the record's own — the skip's own sentence for a skip,
 * the refusal's for a refused verification (`release/prepare.ts`,
 * `release/verify.ts`), and this module's only for what only this
 * module does, the commit and the push — so the prompt and the body
 * cannot word the same outcome two ways. It is appended when the body
 * does not carry it already.
 *
 * A pushed fragment instead gives the body its FORECAST — the fold
 * settle would run if the branch merged now, over the base step 1 read
 * (`release/branch-forecast.ts`) — and, whatever the outcome, the LEVEL
 * REPORT when the plan declared a level below the highest of its stored
 * notes (`release/level.ts`, `releaseLevelReport`). The level report is
 * a report and never a refusal: the declaration still wins. Both sit in
 * one marked block that a re-run replaces rather than repeats, since a
 * forecast goes stale as the base moves.
 *
 * The write itself — the read-modify-write, the provider it goes
 * through, and the one line a `none` provider prints instead — is
 * `./release-body.ts`. A finish keeps what it meant to write
 * ({@link ReleaseFinish.written}), so that module can write it again
 * once a retry session or the runner has opened a pull request the
 * finish found missing.
 *
 * ## Whose branch is pushed, and whose body is written
 *
 * The push and the pull request lookup both name
 * {@link ReleaseFinishInput.branch}, the run's head branch as the
 * caller holds it (`expected.branch` in `src/start/wrap-up-run.ts`).
 * It is a fact of the run, so it is handed in rather than read: under
 * `loop start --as-worktree` the process stands in the main checkout,
 * whose branch is the base, and a `getCurrentBranch()` with no
 * directory would push the base and write the line into whatever pull
 * request has the base as its head, or none (#627).
 */
import type { BodyWrite, ReleaseBodyRecord, ReleaseBodySeams } from './release-body.js';
import type { GitResult, GitRunner, PushOutcome } from '../pr/index.js';
import type { BranchForecast, BranchForecastInput, BranchForecastSettings } from '../release/branch-forecast.js';
import type { ChangelogNote } from '../release/changelog.js';
import type {
  ReleasePreparation,
  ReleasePreparationInput,
  ReleasePrepared,
  ReleaseSettings,
} from '../release/prepare.js';
import type { ReleaseVerification, ReleaseVerificationContext } from '../release/verify.js';

import { activeOutput } from '../adapters/output/active.js';
import { ASSUMPTIONS_HEADING } from '../board/review-stamp.js';
import { messageOf } from '../config-sections.js';
import { readPlanChanges } from '../effort/store/changes.js';
import { parsePlan } from '../plan/parse.js';
import { createGitRunner, gitSaid, pushBranch } from '../pr/index.js';
import {
  forecastLine,
  readBranchForecast,
  releaseBodyBlock,
  releaseBodyLines,
} from '../release/branch-forecast.js';
import { releaseLevelReport } from '../release/level.js';
import { prepareRelease } from '../release/prepare.js';
import { verifyRelease } from '../release/verify.js';
import { RELEASE_BASE_BRANCH } from '../release/version.js';

import { RELEASE_BODY_SEAMS, writeBody } from './release-body.js';

/**
 * The effects this stage reaches through, in one object so a test
 * replaces them together. {@link RELEASE_STAGE_SEAMS} holds the real
 * ones, and a key left out of a call runs the real helper.
 */
export interface ReleaseStageSeams extends ReleaseBodySeams {
  /** Step 1: `release/prepare.ts`. */
  readonly prepare: (input: ReleasePreparationInput) => ReleasePreparation;
  /** Step 3's readings and restore: `release/verify.ts`. */
  readonly verify: (prepared: ReleasePrepared, context: ReleaseVerificationContext) => ReleaseVerification;
  /** The forecast of the verified fragment: `release/branch-forecast.ts`. */
  readonly forecast: (input: BranchForecastInput) => BranchForecast;
  /** The plan's stored change notes, oldest first: `effort/store/changes.ts`. */
  readonly readNotes: (repoRoot: string, planStub: string | null) => readonly ChangelogNote[];
  /** Makes the git runner every command of this stage goes through. */
  readonly git: (repoRoot: string) => GitRunner;
  /** Pushes the branch to `origin` with upstream set. */
  readonly push: (repoRoot: string, branch: string) => PushOutcome;
  /** When the forecast is made; a merge now would add the fragment on its UTC day. */
  readonly now: () => Date;
}

/** The real helpers, which the stage runs on by default. */
export const RELEASE_STAGE_SEAMS: ReleaseStageSeams = {
  prepare: prepareRelease,
  verify: verifyRelease,
  forecast: readBranchForecast,
  readNotes: readPlanChanges,
  git: createGitRunner,
  push: pushBranch,
  ...RELEASE_BODY_SEAMS,
  now: () => new Date(),
};

/**
 * The settings this stage reads, named as `ResolvedConfig` names them,
 * so the run's resolved config is one: the fragment's, the forecast's,
 * and `pr.base`, the branch whose waiting fragments and version the
 * forecast folds over (`main` when the project names none).
 */
export interface ReleaseStageSettings extends ReleaseSettings, BranchForecastSettings {
  /** `pr.base`, or null when the project leaves it to the default. */
  readonly prBase: string | null;
}

/** What step 1 is made from, as the run already holds it. */
export interface ReleaseStageInput {
  /** The project root, whose store the plan's change notes are read from. */
  readonly repoRoot: string;
  /**
   * The run's checkout (`start/checkout.ts`): the working tree the
   * fragment is written in, and git runs in. `repoRoot` when absent,
   * which is the checkout of every loop that does not run in a linked
   * worktree.
   */
  readonly checkout?: string;
  /** The release settings, as the config resolved them. */
  readonly settings: ReleaseStageSettings;
  /** The plan stub: the plan id the fragment is named and marked by, and the change notes are stored under. */
  readonly planStub: string | null;
  /** The plan document, whole: its `release` field and its title. */
  readonly planContent: string;
}

/** What {@link finishRelease} is made from. */
export interface ReleaseFinishInput {
  /**
   * The repository the commit and the push are made in: the run's
   * checkout, the same working tree step 1 wrote the two files in.
   */
  readonly repoRoot: string;
  /**
   * The run's head branch: the branch the fragment commit is pushed to
   * and whose open pull request carries the body. Handed in rather than
   * read, because the process may stand in another checkout than the
   * run's; see the module note.
   */
  readonly branch: string;
  /** The release settings step 1 ran under; step 3 and the forecast read them too. */
  readonly settings: ReleaseStageSettings;
  /** Step 1's record, or null when no preparation ran; see the module note. */
  readonly preparation: ReleasePreparation | null;
}

/** How far a release got. */
export type ReleaseFinishOutcome =
  /** No preparation ran at all, so there was nothing to finish. */
  | 'none'
  /** Step 1 wrote nothing, and said why in the pull request body. */
  | 'skipped'
  /** The verification refused the session's edit; step 1's text is back. */
  | 'refused'
  /** Verified, and the commit did not happen. */
  | 'uncommitted'
  /** Committed, and the push did not happen. */
  | 'unpushed'
  /** Committed and pushed, and the forecast written. */
  | 'released';

/**
 * What one call to {@link finishRelease} did. Its `written` and `body`
 * ({@link ReleaseBodyRecord}) are what the finish wrote into the pull
 * request body and what that write answered: `written` is null only
 * when there was nothing to write, the finish of no preparation.
 */
export interface ReleaseFinish extends ReleaseBodyRecord {
  /** How far the release got; see {@link ReleaseFinishOutcome}. */
  readonly outcome: ReleaseFinishOutcome;
  /** The fragment committed, relative to the repository root, or null. */
  readonly fragment: string | null;
  /** The commit subject, or null when no commit was attempted. */
  readonly subject: string | null;
  /** The release commit, or null when none was made. */
  readonly sha: string | null;
  /** The one failure line the pull request body was given, or null. */
  readonly sentence: string | null;
  /** The forecast of the pushed fragment, or null when none was made. */
  readonly forecast: BranchForecast | null;
  /** The level report, or null when the declaration overruled no note. */
  readonly levelReport: string | null;
}

/** The plan title heading: one `#`, a space, and the title after it. */
const PLAN_HEADING = /^# +(.+)$/;

/** The label a plan title opens with, which the heading already implies. */
const PLAN_LABEL = /^plan\s*[:—–-]\s*/i;

/**
 * The title the fragment names this release after: the plan's own
 * title as {@link planTitleIn} picks it, its `Plan:` label off, and the
 * plan stub when the document carries no title heading.
 *
 * The label comes off because settle renders the title into a changelog
 * heading a person reads — `## 0.5.0 — 2026-09-20, Plan: rafa-21 …`
 * names the document, where `## 0.5.0 — 2026-09-20, rafa-21 …` names
 * the release.
 */
function releaseTitle(input: ReleaseStageInput): string {
  return planTitleIn(input.planContent, input.planStub);
}

/**
 * The plan's title as {@link releaseTitle} reads it, its `Plan:` label
 * off: the first heading carrying that label; else the first heading
 * other than {@link ASSUMPTIONS_HEADING}, which the readiness gate puts
 * above a plan created under assumptions and which names no release;
 * else `planStub` (empty when null).
 * The runner-opened pull request takes its title from here too
 * (`start/wrap-up-run.ts`), so the fragment and that title cannot name
 * the plan two ways.
 */
export function planTitleIn(planContent: string, planStub: string | null): string {
  const headings = planContent.split('\n')
    .filter((line) => line.trim() !== ASSUMPTIONS_HEADING)
    .map((line) => (PLAN_HEADING.exec(line)?.[1] ?? '').trim())
    .filter((heading) => heading !== '');
  const chosen = headings.find((heading) => PLAN_LABEL.test(heading)) ?? headings[0];
  return chosen === undefined
    ? planStub ?? ''
    : chosen.replace(PLAN_LABEL, '').trim();
}

/** Says what step 1 wrote, or why it wrote nothing, and the level report. */
function announcePreparation(preparation: ReleasePreparation): void {
  const out = activeOutput();
  if (preparation.kind === 'skipped') {
    out.info(`\n📦 No release prepared for this pull request: ${preparation.sentence}`);
  } else {
    out.info(`\n📦 Release fragment prepared: ${preparation.file.path} carries level ${preparation.level} for ${preparation.plan}.`);
    out.info('   The wrap-up session rewrites its notes; the loop verifies and commits it after.');
  }
  for (const problem of preparation.problems) out.warn(`   ⚠️  ${problem}`);
  const report = releaseLevelReport({
    level: preparation.level,
    source: preparation.levelSource,
    notesLevel: preparation.notesLevel,
  });
  if (report !== null) out.warn(`   ⚠️  Level report: ${report}`);
}

/**
 * Step 1, run before the wrap-up session is spawned: the plan's change
 * notes, its declared level, its title and its stub, handed to
 * `release/prepare.ts` with `pr.base` as the branch the fragment's name
 * is allocated against. The notes are read from the store under the
 * project root, and the fragment is written in the checkout, where git
 * runs too.
 *
 * Answers the record the session's prompt is built from and the finish
 * works against, or null when the stage could not run — see the module
 * note for why that is not a skip and why it is not thrown.
 */
export function prepareReleaseStage(
  input: ReleaseStageInput,
  seams: Partial<ReleaseStageSeams> = {},
): ReleasePreparation | null {
  const io: ReleaseStageSeams = { ...RELEASE_STAGE_SEAMS, ...seams };
  const checkout = input.checkout ?? input.repoRoot;
  try {
    const preparation = io.prepare({
      repoRoot: checkout,
      settings: input.settings,
      git: io.git(checkout),
      plan: input.planStub ?? '',
      declared: parsePlan(input.planContent).header.release,
      notes: io.readNotes(input.repoRoot, input.planStub),
      title: releaseTitle(input),
      base: { branch: input.settings.prBase ?? RELEASE_BASE_BRANCH },
    });
    announcePreparation(preparation);
    return preparation;
  } catch (error) {
    activeOutput().error(`\n❌ No release fragment was prepared for this pull request: ${messageOf(error)}`);
    activeOutput().error('   The wrap-up session runs without one; no release file is touched.');
    return null;
  }
}

/** The subject the fragment is committed under: the plan id names it. */
function releaseSubject(prepared: ReleasePrepared): string {
  return `chore: release fragment ${prepared.plan}`;
}

/** What git said, as the tail of a sentence a person reads. */
function saidClause(result: GitResult): string {
  const said = gitSaid(result).split('\n')[0]?.trim() ?? '';
  return said === ''
    ? 'and said nothing'
    : `and said ${JSON.stringify(said)}`;
}

/** A commit that was made, or the sentence saying why it was not. */
type CommitOutcome =
  | { readonly committed: true; readonly sha: string | null }
  | { readonly committed: false; readonly sentence: string };

/**
 * Commits the fragment step 1 wrote, and nothing else: the three
 * commands of the module note, each one's failure its own sentence.
 *
 * The sha is read AFTER the commit succeeded, so a read that fails
 * leaves a made commit with a null sha rather than reporting a release
 * that did not happen.
 */
function commitFragment(git: GitRunner, path: string, subject: string): CommitOutcome {
  const staged = git(['add', '--', path]);
  if (!staged.ok) {
    return { committed: false, sentence: `no release commit: git could not stage ${path}, ${saidClause(staged)}` };
  }

  // Exit 0 says nothing is staged for the path; see the module note.
  if (git(['diff', '--cached', '--quiet', '--', path]).ok) {
    return {
      committed: false,
      sentence: `no release commit: ${path} holds no change against HEAD, so it was already committed`,
    };
  }

  const made = git(['commit', '--cleanup=whitespace', '--only', '-m', subject, '--', path]);
  if (!made.ok) {
    return { committed: false, sentence: `no release commit: git refused \`${subject}\` over ${path}, ${saidClause(made)}` };
  }

  const head = git(['rev-parse', 'HEAD']);
  return {
    committed: true,
    sha: head.ok
      ? head.stdout.trim()
      : null,
  };
}

/** The commit as a message names it: its short sha, or the subject. */
function commitName(sha: string | null, subject: string): string {
  return sha === null
    ? `the \`${subject}\` commit`
    : `the \`${subject}\` commit ${sha.slice(0, 7)}`;
}

/** `body` with `sentence` under it, as its own paragraph. */
export function bodyWithSentence(body: string, sentence: string): string {
  const kept = body.trimEnd();
  return kept === ''
    ? sentence
    : `${kept}\n\n${sentence}`;
}

/** What a finish carries besides its outcome, sentence and body write. */
type FinishFacts = Pick<ReleaseFinish, 'fragment' | 'subject' | 'sha' | 'levelReport'>;

/** A finish that ends in a sentence: written to the body, then reported. */
async function reportFailure(
  io: ReleaseStageSeams,
  input: ReleaseFinishInput,
  outcome: Exclude<ReleaseFinishOutcome, 'none' | 'released'>,
  sentence: string,
  facts: FinishFacts,
): Promise<ReleaseFinish> {
  const out = activeOutput();
  if (outcome === 'skipped') {
    out.info(`\n📦 ${sentence}`);
  } else {
    out.error(`\n❌ ${sentence}`);
  }

  const parts = { forecast: null, levelReport: facts.levelReport };
  const block = releaseBodyBlock(parts);
  const written: BodyWrite = { sentence, block, lines: [sentence, ...releaseBodyLines(parts)] };
  const body = await writeBody(io, input, written);
  return { outcome, sentence, forecast: null, written, body, ...facts };
}

/** Nothing was prepared, nothing was finished. */
const NO_RELEASE: ReleaseFinish = {
  outcome: 'none',
  fragment: null,
  subject: null,
  sha: null,
  sentence: null,
  forecast: null,
  levelReport: null,
  written: null,
  body: null,
};

/** The pushed fragment's forecast, printed and written with the level report. */
async function reportForecast(
  io: ReleaseStageSeams,
  input: ReleaseFinishInput,
  forecast: BranchForecast,
  facts: FinishFacts,
): Promise<ReleaseFinish> {
  const out = activeOutput();
  out.info(`   ${forecastLine(forecast)}.`);
  for (const problem of forecast.problems) out.warn(`   ⚠️  ${problem}`);

  const parts = { forecast, levelReport: facts.levelReport };
  const block = releaseBodyBlock(parts);
  const written: BodyWrite = { sentence: null, block, lines: releaseBodyLines(parts) };
  const body = await writeBody(io, input, written);
  return { outcome: 'released', sentence: null, forecast, written, body, ...facts };
}

/**
 * Step 3, run once the wrap-up session has returned: the verification,
 * the restore it makes on a refusal, the `chore: release fragment <plan
 * id>` commit over the fragment alone, the push, and the forecast.
 *
 * Every outcome short of a pushed fragment ends with one sentence in
 * the pull request body, the record's own wherever the record has one;
 * a pushed fragment gives the body its forecast instead. The level
 * report joins either. See the module note for what the commit names
 * and what the body is given.
 */
export async function finishRelease(
  input: ReleaseFinishInput,
  seams: Partial<ReleaseStageSeams> = {},
): Promise<ReleaseFinish> {
  const io: ReleaseStageSeams = { ...RELEASE_STAGE_SEAMS, ...seams };
  const { preparation, repoRoot, branch, settings } = input;
  if (preparation === null) return NO_RELEASE;

  const levelReport = releaseLevelReport({
    level: preparation.level,
    source: preparation.levelSource,
    notesLevel: preparation.notesLevel,
  });
  const none: FinishFacts = { fragment: null, subject: null, sha: null, levelReport };
  if (preparation.kind === 'skipped') {
    return reportFailure(io, input, 'skipped', preparation.sentence, none);
  }

  const git = io.git(repoRoot);
  const verification = io.verify(preparation, { git, settings });
  if (verification.kind === 'refused') {
    return reportFailure(io, input, 'refused', verification.sentence, none);
  }

  const fragment = verification.path;
  const subject = releaseSubject(preparation);
  const commit = commitFragment(git, fragment, subject);
  if (!commit.committed) {
    return reportFailure(io, input, 'uncommitted', commit.sentence, { ...none, fragment, subject });
  }

  const out = activeOutput();
  const sha = commit.sha;
  const facts: FinishFacts = { fragment, subject, sha, levelReport };
  out.info(`\n📦 Committed ${commitName(sha, subject)} over ${fragment}.`);

  const pushed = io.push(repoRoot, branch);
  if (!pushed.ok) {
    const said = pushed.output.trim() === ''
      ? ''
      : `: ${pushed.output.trim().split('\n')[0] ?? ''}`;
    const sentence = `${commitName(sha, subject)} was made but could not be pushed to ${branch}${said}`;
    return reportFailure(io, input, 'unpushed', sentence, facts);
  }

  out.info(`   Pushed it to ${branch}.`);
  const forecast = io.forecast({ git, settings, prepared: preparation, verified: verification, now: io.now() });
  return reportForecast(io, input, forecast, facts);
}
