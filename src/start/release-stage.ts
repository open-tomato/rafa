/**
 * The release around the wrap-up session: step 1 before it is spawned,
 * and step 3 — the verification, the restore, the commit and the push —
 * after it returns.
 *
 * The spec splits one release three ways
 * (`.specs/rafa-21-changelog-and-release.md`, step 3 of its design):
 * the LOOP writes the version and the raw notes, the SESSION rewrites
 * the prose, and the LOOP then verifies, commits and pushes. Only the
 * middle third is a prompt (`./wrap-up.ts`), and this module is the two
 * outer thirds, in the order `src/start.ts` runs them:
 *
 * ```text
 * prepareReleaseStage(input)           → ReleasePreparation | null
 *   preserveProgress(plan, …, that)    ← the session, elsewhere
 * finishRelease({ preparation })       → ReleaseFinish
 * ```
 *
 * Nothing here decides what a release says. The reading modules under
 * `src/release/` own that: `prepare.ts` writes the two files or says
 * why it wrote neither, and `verify.ts` reads what the session made of
 * them and restores step 1's text on any refusal. This module is the
 * ORDER those two run in, the git the verified release is committed and
 * pushed with, and the one sentence a failure leaves in the pull
 * request body.
 *
 * ## Why the finish takes a record rather than reading the files again
 *
 * {@link finishRelease} is handed the very {@link ReleasePreparation}
 * {@link prepareReleaseStage} answered. A finish that re-read the
 * config and re-derived what step 1 should have written could disagree
 * with what step 1 DID write — a changelog path edited mid-run, a
 * version bumped from a base that moved — and would then verify a
 * release nobody prepared. Passing the record through is also what
 * makes the two halves testable apart.
 *
 * A preparation of `null` is the stage itself having failed to run at
 * all: the change notes could not be read, or the preparation threw.
 * It is not a skip — a skip is a preparation that ran and decided
 * against a release — so it reaches neither the prompt (`./wrap-up.ts`
 * gives a null preparation no release bullet) nor the pull request
 * body, and the wrap-up carries on without a release. That is the
 * direction to fail in: the promotion of the run's findings is worth
 * more than its changelog entry, and a wrap-up that never ran loses
 * both.
 *
 * ## The commit holds the two files and nothing else
 *
 * `git add -A` is never run here. The wrap-up session commits its own
 * work first and is told to leave the two release files unstaged, but
 * "the session left nothing behind" is not a thing this module can
 * check, and a sweep would put whatever it did leave under a `chore:
 * release` subject. So the commit names its paths:
 *
 * ```text
 * git add -- <changelog> [<version file>]
 * git diff --cached --quiet -- <the same paths>
 * git commit --cleanup=whitespace --only -m <subject> -- <the same paths>
 * ```
 *
 * Measured in a scratch repository on git 2.50.1 (2026-09-20), with
 * `other.txt` modified and `new.txt` added and both staged beforehand:
 * the commit held the two named paths alone, and `git status
 * --porcelain` still answered `A  new.txt` and `M  other.txt`
 * afterwards, so a partial commit neither takes nor unstages what the
 * session left in the index. A pre-commit hook run by that commit reads
 * the temporary index git builds for it: a hook writing `git diff
 * --cached --name-only` to a file saw `CHANGELOG.md` alone while
 * `other.txt` was staged, which is what lets `.githooks/pre-commit`
 * gate the release files and only them.
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
 * said. A reading of 0, measured in the same scratch repository, is
 * what the session having committed the files itself looks like, and
 * the commit then exits 1 with `no changes added to commit`.
 *
 * ## The sentence always reaches the body, or says why it did not
 *
 * Every way this stage falls short of a pushed release ends in one
 * sentence, and that sentence goes into the pull request body through
 * {@link PullRequests.editBody}: the spec's "on failure restore step
 * 1's text and say so in the PR body", and its "Level `none` skips all
 * three steps and says so in the PR body". The sentence is the
 * record's own — the skip's own sentence for a skip, the refusal's for
 * a refused verification (`release/prepare.ts`, `release/verify.ts`), and this
 * module's only for what only this module does, the commit and the
 * push — so the prompt and the body cannot word the same outcome two
 * ways.
 *
 * The write is a read-modify-write: a provider has no way to append to
 * a body, so the body is read back and the sentence put under it. A
 * body that already carries the sentence is left alone, which is what
 * makes a re-run of the stage idempotent and what keeps the sentence
 * single when the session already copied it in from its prompt. A pull
 * request that cannot be found or cannot be asked is reported and NOT
 * thrown: the release is already decided by then, and the operator is
 * owed the reason on their terminal whether or not GitHub took it.
 */
import type { GitResult, GitRunner, PullRequests, PushOutcome } from '../pr/index.js';
import type { ChangelogNote } from '../release/changelog.js';
import type {
  ReleasePreparation,
  ReleasePreparationInput,
  ReleasePrepared,
  ReleaseSettings,
} from '../release/prepare.js';
import type { ReleaseVerification } from '../release/verify.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { readPlanChanges } from '../effort/store/changes.js';
import { parsePlan } from '../plan/parse.js';
import { createGitRunner, ghPullRequestsIn, gitSaid, pushBranch } from '../pr/index.js';
import { prepareRelease } from '../release/prepare.js';
import { verifyRelease } from '../release/verify.js';
import { getCurrentBranch } from '../utils/git.js';

/**
 * The effects this stage reaches through, in one object so a test
 * replaces them together. {@link RELEASE_STAGE_SEAMS} holds the real
 * ones, and a key left out of a call runs the real helper.
 */
export interface ReleaseStageSeams {
  /** Step 1: `release/prepare.ts`. */
  readonly prepare: (input: ReleasePreparationInput) => ReleasePreparation;
  /** Step 3's readings and restore: `release/verify.ts`. */
  readonly verify: (prepared: ReleasePrepared) => ReleaseVerification;
  /** The plan's stored change notes, oldest first: `effort/store/changes.ts`. */
  readonly readNotes: (repoRoot: string, planStub: string | null) => readonly ChangelogNote[];
  /** Makes the git runner every command of this stage goes through. */
  readonly git: (repoRoot: string) => GitRunner;
  /** Pushes the branch to `origin` with upstream set. */
  readonly push: (repoRoot: string, branch: string) => PushOutcome;
  /** The provider the failure sentence is written through. */
  readonly pulls: (repoRoot: string) => PullRequests;
  /** The branch whose pull request carries the sentence. */
  readonly currentBranch: () => string;
  /** When the release is being made; the entry's date comes from it. */
  readonly now: () => Date;
}

/** The real helpers, which the stage runs on by default. */
export const RELEASE_STAGE_SEAMS: ReleaseStageSeams = {
  prepare: prepareRelease,
  verify: verifyRelease,
  readNotes: readPlanChanges,
  git: createGitRunner,
  push: pushBranch,
  pulls: ghPullRequestsIn,
  currentBranch: getCurrentBranch,
  now: () => new Date(),
};

/** What step 1 is made from, as the run already holds it. */
export interface ReleaseStageInput {
  /** The repository the two configured paths are relative to. */
  readonly repoRoot: string;
  /** The `release` settings, as the config resolved them. */
  readonly settings: ReleaseSettings;
  /** The plan stub the run's change notes are stored under. */
  readonly planStub: string | null;
  /** The plan document, whole: its `release` field and its title. */
  readonly planContent: string;
}

/** What {@link finishRelease} is made from. */
export interface ReleaseFinishInput {
  /** The repository the commit and the push are made in. */
  readonly repoRoot: string;
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
  /** Committed and pushed. */
  | 'released';

/** What became of the sentence a failure or a skip had to report. */
export interface ReleaseBodyWrite {
  /** The pull request it was written to, or null when none was found. */
  readonly number: number | null;
  /** True when the body carries the sentence now. */
  readonly carried: boolean;
  /** True when it already did, so nothing was written. */
  readonly already: boolean;
  /** Why it does not, or null when it does. */
  readonly problem: string | null;
}

/** What one call to {@link finishRelease} did. */
export interface ReleaseFinish {
  /** How far the release got; see {@link ReleaseFinishOutcome}. */
  readonly outcome: ReleaseFinishOutcome;
  /** The version this release ships, or null when it ships none. */
  readonly version: string | null;
  /** The commit subject, or null when no commit was attempted. */
  readonly subject: string | null;
  /** The release commit, or null when none was made. */
  readonly sha: string | null;
  /** The one line the pull request body was given, or null on success. */
  readonly sentence: string | null;
  /** What became of that line, or null when there was none to write. */
  readonly body: ReleaseBodyWrite | null;
}

/** The plan title heading: one `#`, a space, and the title after it. */
const PLAN_HEADING = /^# +(.+)$/;

/** The label a plan title opens with, which the heading already implies. */
const PLAN_LABEL = /^plan\s*[:—–-]\s*/i;

/**
 * The title the entry's heading names this release after: the plan's
 * own first heading, its `Plan:` label off, and the plan stub when the
 * document carries no heading at all.
 *
 * The label comes off because the heading template renders the title
 * into a changelog a person reads — `## 0.5.0 — 2026-09-20, Plan:
 * rafa-21 …` names the document, where `## 0.5.0 — 2026-09-20,
 * rafa-21 …` names the release. A plan with neither a heading nor a
 * stub renders an empty `{title}`, which `release/changelog.ts` takes
 * the dangling separator with.
 */
function releaseTitle(input: ReleaseStageInput): string {
  for (const line of input.planContent.split('\n')) {
    const heading = PLAN_HEADING.exec(line);
    if (heading === null) continue;
    return (heading[1] ?? '').replace(PLAN_LABEL, '').trim();
  }
  return input.planStub ?? '';
}

/** Says what step 1 wrote, or why it wrote nothing. */
function announcePreparation(preparation: ReleasePreparation): void {
  const out = activeOutput();
  if (preparation.kind === 'skipped') {
    out.info(`\n📦 No release prepared for this pull request: ${preparation.sentence}`);
  } else {
    const bump = preparation.version === null
      ? 'no version file to bump'
      : `${preparation.versionFile?.path ?? 'the version file'} now declares ${preparation.version}`;
    out.info(`\n📦 Release prepared: ${preparation.changelog.path} carries ${preparation.entry.heading}, and ${bump}.`);
    out.info('   The wrap-up session rewrites its lines; the loop verifies and commits them after.');
  }
  for (const problem of preparation.problems) out.warn(`   ⚠️  ${problem}`);
}

/**
 * Step 1, run before the wrap-up session is spawned: the plan's change
 * notes, its declared level and its title, handed to
 * `release/prepare.ts`.
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
  try {
    const preparation = io.prepare({
      repoRoot: input.repoRoot,
      settings: input.settings,
      git: io.git(input.repoRoot),
      declared: parsePlan(input.planContent).header.release,
      notes: io.readNotes(input.repoRoot, input.planStub),
      title: releaseTitle(input),
      now: io.now(),
    });
    announcePreparation(preparation);
    return preparation;
  } catch (error) {
    activeOutput().error(`\n❌ No release was prepared for this pull request: ${messageOf(error)}`);
    activeOutput().error('   The wrap-up session runs without one; the changelog and the version file are untouched.');
    return null;
  }
}

/** The files step 1 wrote, as the paths the commit names. */
function releasePaths(prepared: ReleasePrepared): readonly string[] {
  return prepared.versionFile === null
    ? [prepared.changelog.path]
    : [prepared.changelog.path, prepared.versionFile.path];
}

/** `names` as English: `a`, or `a and b`. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The subject the release commit is made under. */
function releaseSubject(version: string | null): string {
  return version === null
    ? 'chore: release'
    : `chore: release ${version}`;
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
 * Commits the two files step 1 wrote, and nothing else: the three
 * commands of the module note, each one's failure its own sentence.
 *
 * The sha is read AFTER the commit succeeded, so a read that fails
 * leaves a made commit with a null sha rather than reporting a release
 * that did not happen.
 */
function commitRelease(git: GitRunner, prepared: ReleasePrepared, subject: string): CommitOutcome {
  const paths = releasePaths(prepared);
  const named = listOf(paths);

  const staged = git(['add', '--', ...paths]);
  if (!staged.ok) {
    return { committed: false, sentence: `no release commit: git could not stage ${named}, ${saidClause(staged)}` };
  }

  // Exit 0 says nothing is staged for these paths; see the module note.
  if (git(['diff', '--cached', '--quiet', '--', ...paths]).ok) {
    return {
      committed: false,
      sentence: `no release commit: ${named} hold no change against HEAD, so the wrap-up session committed them itself`,
    };
  }

  const made = git(['commit', '--cleanup=whitespace', '--only', '-m', subject, '--', ...paths]);
  if (!made.ok) {
    return { committed: false, sentence: `no release commit: git refused \`${subject}\` over ${named}, ${saidClause(made)}` };
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

/** A sentence that reached no body, and why. */
function unwritten(number: number | null, problem: string): ReleaseBodyWrite {
  return { number, carried: false, already: false, problem };
}

/**
 * Puts `sentence` in the pull request body of `branch`, unless the body
 * already carries it.
 *
 * Reported and never thrown; see the module note for why the read comes
 * first and why a body that already says this is left alone.
 */
async function carryIntoBody(
  pulls: PullRequests,
  branch: string,
  sentence: string,
): Promise<ReleaseBodyWrite> {
  try {
    const found = await pulls.findOpen(branch);
    if (found === null) {
      return unwritten(null, `no open pull request was found for ${branch} to write it to`);
    }

    const detail = await pulls.get(found.number);
    if (detail === null) {
      return unwritten(found.number, `pull request #${found.number} could not be read back`);
    }
    if (detail.body.includes(sentence)) {
      return { number: found.number, carried: true, already: true, problem: null };
    }

    await pulls.editBody(found.number, bodyWithSentence(detail.body, sentence));
    return { number: found.number, carried: true, already: false, problem: null };
  } catch (error) {
    return unwritten(null, `the pull request body could not be written: ${messageOf(error)}`);
  }
}

/** Says where the sentence went, or that it went nowhere. */
function announceBody(write: ReleaseBodyWrite): void {
  const out = activeOutput();
  if (write.problem !== null) {
    out.error(`   That line is not in the pull request body: ${write.problem}`);
    return;
  }
  if (write.already) {
    out.info(`   Pull request #${write.number} already carries that line.`);
    return;
  }
  out.info(`   That line is now in the body of pull request #${write.number}.`);
}

/** A finish that ends in a sentence: written to the body, then reported. */
async function reportFailure(
  io: ReleaseStageSeams,
  repoRoot: string,
  outcome: Exclude<ReleaseFinishOutcome, 'none' | 'released'>,
  sentence: string,
  made: Pick<ReleaseFinish, 'version' | 'subject' | 'sha'>,
): Promise<ReleaseFinish> {
  const out = activeOutput();
  if (outcome === 'skipped') {
    out.info(`\n📦 ${sentence}`);
  } else {
    out.error(`\n❌ ${sentence}`);
  }

  const body = await carryIntoBody(io.pulls(repoRoot), io.currentBranch(), sentence);
  announceBody(body);
  return { outcome, sentence, body, ...made };
}

/** Nothing was prepared, nothing was finished. */
const NO_RELEASE: ReleaseFinish = {
  outcome: 'none',
  version: null,
  subject: null,
  sha: null,
  sentence: null,
  body: null,
};

/**
 * Step 3, run once the wrap-up session has returned: the verification,
 * the restore it makes on a refusal, the `chore: release <version>`
 * commit over the two release files alone, and the push.
 *
 * Every outcome short of a pushed release ends with one sentence in the
 * pull request body, the record's own wherever the record has one. See
 * the module note for what the commit names and what the sentence is
 * read against.
 */
export async function finishRelease(
  input: ReleaseFinishInput,
  seams: Partial<ReleaseStageSeams> = {},
): Promise<ReleaseFinish> {
  const io: ReleaseStageSeams = { ...RELEASE_STAGE_SEAMS, ...seams };
  const { preparation, repoRoot } = input;
  if (preparation === null) return NO_RELEASE;

  const none = { version: null, subject: null, sha: null };
  if (preparation.kind === 'skipped') {
    return reportFailure(io, repoRoot, 'skipped', preparation.sentence, none);
  }

  const verification = io.verify(preparation);
  if (verification.kind === 'refused') {
    return reportFailure(io, repoRoot, 'refused', verification.sentence, none);
  }

  const version = verification.version;
  const subject = releaseSubject(version);
  const git = io.git(repoRoot);
  const commit = commitRelease(git, preparation, subject);
  if (!commit.committed) {
    return reportFailure(io, repoRoot, 'uncommitted', commit.sentence, { version, subject, sha: null });
  }

  const out = activeOutput();
  const sha = commit.sha;
  out.info(`\n📦 Committed ${commitName(sha, subject)} over ${listOf(releasePaths(preparation))}.`);

  const branch = io.currentBranch();
  const pushed = io.push(repoRoot, branch);
  if (!pushed.ok) {
    const said = pushed.output.trim() === ''
      ? ''
      : `: ${pushed.output.trim().split('\n')[0] ?? ''}`;
    const sentence = `${commitName(sha, subject)} was made but could not be pushed to ${branch}${said}`;
    return reportFailure(io, repoRoot, 'unpushed', sentence, { version, subject, sha });
  }

  out.info(`   Pushed it to ${branch}.`);
  return { outcome: 'released', version, subject, sha, sentence: null, body: null };
}
