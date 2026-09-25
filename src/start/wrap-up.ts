/**
 * The session the loop runs once the tracker holds no task left.
 *
 * `start()` hands {@link preserveProgress} the plan it was started on,
 * the setting sources its config resolved to, and the release
 * preparation `start/release-stage.ts` made just before the call; and
 * the session built here, loading settings from those sources,
 * promotes the lessons the learning library names promotable, syncs
 * the branch with main, commits,
 * pushes and opens or updates the PR. `start()` finishes that release
 * and then waits on the PR's checks after it returns. The line naming
 * whether the session succeeded goes
 * through the active output (`adapters/output/active.ts`): `info` on
 * success, and `error` on a failure, which does not stop `start()`.
 * So does a warning for each rafa-tier winner the session is not
 * served, at `warn`.
 *
 * The session's `rafa:promoted` answer is checked once it has
 * succeeded (`start/promoted-check.ts`): the loop, not the session, sets
 * `promoted_to` on each lesson whose named path changed, and puts one
 * line naming every lesson left unanswered or unchanged in the PR body.
 *
 * The prompt's first line is the `wrap-up` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that literal from.
 */
import type { ClaudeSettingSource } from '../config.js';
import type { TaskLearning } from './dispatch.js';
import type { SessionServing } from './serving.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { ReleasePrepared, ReleasePreparation, ReleaseSkipped } from '../release/prepare.js';

import { activeOutput } from '../adapters/output/active.js';
import { CORE_ADAPTER_REGISTRY } from '../adapters/registry.js';
import { promotable } from '../learning/index.js';
import { mechanicalConflictBullet } from '../pr/conflict-sentence.js';
import { createGitRunner, ghPullRequestsIn } from '../pr/index.js';
import { runClaudeCaptured } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';

import { checkWrapUpAnswer, readHead } from './promoted-check.js';
import { serveSession } from './serving.js';
import { withStamp } from './stamp.js';

/**
 * Assembles the prompt the end-of-run wrap-up session is given.
 *
 * Its FIRST LINE is a classifier key: `effort/classify.ts` buckets a
 * session whose prompt begins with it as `wrap-up`. So the plan is
 * APPENDED below the instructions and never placed above them, and the
 * stamp {@link withStamp} adds lands after the plan.
 *
 * The plan goes in WHOLE whatever injection mode the run's task
 * sessions were dispatched under, which is why this takes the plan and
 * no mode: there is no mode to get wrong. `full` renders the plan
 * document byte for byte (`plan/inject.ts`), so what is appended here
 * is the `full` rendering. The session titles the PR `rafa-<n>:
 * <title>` from the plan title and the `issue: <n>` its `rafa:plan`
 * block carries, closes that issue from the body with `Closes #<n>`
 * and summarises the work of every stage, and a `stage` or `task`
 * rendering holds one stage, or one task line.
 *
 * The merge-conflict bullet is NOT written here: it is
 * `mechanicalConflictBullet()` from `pr/conflict-sentence.ts`, the one
 * source the pinned resolve plans read the same sentence from
 * (`pr/plans/load.ts`), so this prompt and those plans cannot drift on
 * what an agent does with a conflicted lockfile. It sits mid-list, and
 * the first line above it stays the classifier key.
 *
 * `openPullRequest` is the branch's open PR as the loop read it before
 * the session, or null when it found none. The session is told which
 * rather than asked to look, so whether to create or to edit is decided
 * here, and only a create that meets an existing PR is left to it.
 *
 * `release` is step 1's record, as `release/prepare.ts` answered it
 * before this session was spawned, and null when no preparation was
 * attempted at all — a wrap-up run outside the release stage, which
 * then gets no release bullet of any kind. The spec's step 2 is the
 * whole of what those bullets ask for
 * (`.rafa/specs/rafa-21-changelog-and-release.md`): "rewrite the raw lines
 * under that heading into one line per area, touching nothing else in
 * the file". {@link releaseBullets} holds why each of them is worded
 * the way it is.
 *
 * `lessons` is what {@link lessonsToPromote} answered before the
 * session: the records `promotable` (`learning/bless.ts`) names at the
 * run's `learning.promote.after` and `learning.promote.minConfidence`.
 * The session is no longer asked to read `progress.txt` and judge what
 * to keep; code picks the lessons, and {@link lessonsSection} lists
 * them under `## Lessons to promote` with the `rafa:promoted` block the
 * session answers them in (`start/promoted.ts` reads it). With no
 * lesson the section is not written at all, not even its heading.
 */
export function buildWrapUpPrompt(
  branch: string,
  planContent: string,
  openPullRequest: number | null = null,
  release: ReleasePreparation | null = null,
  lessons: readonly InstinctRecord[] = [],
): string {
  return [
    '* Read `@progress.txt` in full.',
    '* `@progress.txt` above names the file `progress.txt` at the repo root; the `@` is a reference marker, never part of a path. Do not create or write a file whose name starts with `@`.',
    '* Find the plan\'s issue number `<n>`: the plan below carries it in its `rafa:plan` block as `issue: <n>`.',
    `* If the plan carries no \`issue:\` field, read the number from the branch name (${branch}), which is spelled \`feat/rafa-<n>-<slug>\`.`,
    '* Title the PR `rafa-<n>: <title>`, taking `<title>` from the plan title, e.g. "rafa-20: Add pull-request commands". Open the PR body with `Closes #<n>` — the GitHub issue number on its own, never `#rafa-<n>`, since the `rafa-` prefix is this project\'s naming convention and not a GitHub alias. If no number was found, title the PR with the plan title alone and write no closing line rather than inventing one.',
    '* Create a concise yet descriptive PR description that summarizes the overall work done based on the completed plan and progress notes.',
    '* BEFORE pushing, bring the branch up to date with the base: `git fetch origin main` then `git merge origin/main`. A branch that conflicts with main gets NO CI run at all — GitHub cannot build `refs/pull/<n>/merge` for it — so a conflicted PR is a plan reported finished whose code was never once checked. Resolving here, where the plan\'s context is still loaded, is the cheapest place it will ever be.',
    mechanicalConflictBullet(),
    '* If the merge touched `bun.lock` or any `package.json`, run `bun install --frozen-lockfile` and require it to pass BEFORE pushing. It is the one-second local reproduction of the CI install step, and it catches a lockfile that no longer matches the merged manifests — the failure mode where every CI job dies at its first step and nothing downstream runs. When it fails, do NOT hand-edit the lockfile: restore the base\'s copy (`git checkout origin/main -- bun.lock`), run a plain `bun install` so this branch\'s own dependencies are re-added, and confirm the frozen run then passes.',
    ...releaseBullets(release),
    `* Commit these changes and push them to the CURRENT branch (${branch}). Never create a branch here: the work under review is this branch's, and a second branch splits one plan across two reviews.`,
    pullRequestStep(branch, openPullRequest),
    '* Do not include Claude attribution in the commit or PR message.',
    ...lessonsSection(lessons),
    '',
    'The plan this run executed follows, in full.',
    '',
    planContent,
  ].join('\n');
}

/** A lesson's field as one line: trimmed, every whitespace run one space. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** One lesson of the list: its id, then its trigger, action and artifact. */
function lessonLines(lesson: InstinctRecord): readonly string[] {
  const artifact = lesson.artifact === undefined || oneLine(lesson.artifact) === ''
    ? 'none'
    : oneLine(lesson.artifact);
  return [
    `- \`${lesson.id}\``,
    `  - trigger: ${oneLine(lesson.trigger)}`,
    `  - action: ${oneLine(lesson.action)}`,
    `  - artifact: ${artifact}`,
  ];
}

/**
 * The `## Lessons to promote` section, or nothing at all when `lessons`
 * is empty.
 *
 * Each field is written on one line, whitespace runs collapsed, so a
 * multi-line action cannot break the list into lines that read as other
 * entries. The page rules are the ones the superseded promotion bullet
 * carried: the page that owns the subject, and the capped `AGENTS.md`
 * pointed from rather than written into. The block's line shapes are
 * the ones `start/promoted.ts` reads, `→` or `->` alike.
 *
 * The section sits below every bullet, so the first line stays the
 * classifier key, and it tells the session to promote BEFORE the
 * commit the bullets above ask for, since the pages it writes belong in
 * that commit.
 */
function lessonsSection(lessons: readonly InstinctRecord[]): readonly string[] {
  if (lessons.length === 0) return [];
  return [
    '',
    '## Lessons to promote',
    '',
    'These lessons recurred across enough task sessions of this project, at a high enough confidence, to belong in its tracked docs. Handle them BEFORE the commit and push above, so the pages you write are in that commit.',
    '',
    ...lessons.flatMap(lessonLines),
    '',
    'For each lesson, EITHER write it into the tracked page that owns its subject — a `context/` page, `README.md`, or a skill under `.claude/skills/` — replacing in the same edit any sentence, bullet or table row it supersedes, OR leave it out and say why. The root `AGENTS.md` is a capped map read into every turn of every session: point at a new page from there if one is needed, never inline the lesson itself.',
    '',
    'Then answer every lesson listed above, and no other, in ONE `rafa:promoted` block in your final message: one line per lesson, its id, an arrow, and either the path you changed or `skipped:` and the reason. A promoted path must be a file this session changed, and a lesson the block does not answer is reported in the pull request body.',
    '',
    '```rafa:promoted',
    '<id> → <path>',
    '<id> → skipped: <reason>',
    '```',
  ];
}

/**
 * The bullet that opens or updates the PR, from the state the loop read.
 *
 * A plan's own close-out may already have opened the PR. A lookup that
 * found none can still be wrong, `gh` being absent or offline, so the
 * create branch keeps the one reading of a refusal that must not turn
 * into a second PR.
 */
function pullRequestStep(branch: string, openPullRequest: number | null): string {
  return openPullRequest === null
    ? `* No open PR was found for ${branch}: open one with \`gh pr create\`. If it answers that a PR already exists, push to that PR and update its body with \`gh pr edit\`; never open a second PR from a new branch.`
    : `* PR #${openPullRequest} is already open for ${branch}, likely opened by the plan's close-out: push to it and update its body with \`gh pr edit ${openPullRequest}\` so the description covers the promotions this session committed.`;
}

/**
 * The release bullets, as step 1's record leaves them: three when it
 * wrote the two files, one when it wrote nothing, and none at all when
 * no preparation was attempted.
 *
 * The spec splits the release three ways
 * (`.rafa/specs/rafa-21-changelog-and-release.md`, its step 3 list): the
 * loop writes the version and the raw notes, the SESSION rewrites the
 * prose, and the loop then verifies, commits and pushes. Only the
 * middle third is a prompt, so only the middle third is here. Each
 * bullet exists because `release/verify.ts` refuses something:
 *
 *   - The rewrite is bounded to ONE section because the verification
 *     compares every line outside the inserted span byte for byte
 *     (`changelogInsertionSpan`). A session that rewrapped the
 *     preamble is refused exactly as one that rewrote an old release,
 *     so the bullet names the preamble, the other sections, the
 *     heading and the trailing newline rather than saying "nothing
 *     else" and leaving the reader to guess how strict that is.
 *   - The two files are left UNSTAGED because step 3's commit holds
 *     them alone. A `git add -A` in this session would put them under
 *     the session's own subject, and the release commit that follows
 *     would then be empty — a release nothing verified, since the
 *     verification runs after this session and before that commit.
 *   - The entry goes into the pull request body because that is where
 *     the spec puts it ("The PR body gains the entry"), and the body
 *     is this session's to write; nothing downstream rewrites it.
 *
 * A SKIPPED preparation gets one bullet instead of the three, carrying
 * {@link ReleaseSkipped.sentence} verbatim — the same sentence the
 * release stage puts in the body when the session does not, so the two
 * cannot word it differently. It also says to leave both files alone:
 * a session told only that there is no release is a session that might
 * write the entry by hand, and a hand-written entry is one no
 * verification ever reads.
 *
 * Every bullet here sits BELOW the prompt's first line, which is the
 * `wrap-up` classifier key; none of them may be moved above it.
 */
function releaseBullets(release: ReleasePreparation | null): readonly string[] {
  if (release === null) return [];
  if (release.kind === 'skipped') return [skippedReleaseBullet(release)];
  return [
    changelogRewriteBullet(release),
    releaseFilesBullet(release),
    releaseBodyBullet(release),
  ];
}

/**
 * The paths step 1 wrote, as backticked prose: both files, or the
 * changelog alone in a project with no version file.
 */
function releaseFilePhrase(prepared: ReleasePrepared): string {
  const paths = prepared.versionFile === null
    ? [prepared.changelog.path]
    : [prepared.changelog.path, prepared.versionFile.path];
  return paths.map((path) => `\`${path}\``).join(' and ');
}

/** What step 1 left behind, as one clause naming the heading and the bump. */
function releaseStateClause(prepared: ReleasePrepared): string {
  const section = `\`${prepared.changelog.path}\` now carries a new section headed \`${prepared.entry.heading}\``;
  const { version, versionFile } = prepared;
  return version === null || versionFile === null
    ? `${section}, and this project has no version file to bump`
    : `${section}, and \`${versionFile.path}\` now declares ${version}`;
}

/** Step 2 itself: the raw lines under that one heading, and nothing else. */
function changelogRewriteBullet(prepared: ReleasePrepared): string {
  return `* The loop has already prepared this pull request's release: ${releaseStateClause(prepared)}. Rewrite the raw \`- <area>: <summary>\` lines under THAT heading into one line per area, in the changelog's own voice, and change nothing else anywhere in the file: not another release's section, not the file's preamble above them all, not the heading line itself, not the blank lines around the section, and not the file's trailing newline. Every line outside that section is compared byte for byte against what the loop wrote, and one changed byte anywhere else costs this pull request its release. If the section has no lines under its heading, leave it as it is rather than inventing any.`;
}

/** Why the two files stay out of this session's commit. */
function releaseFilesBullet(prepared: ReleasePrepared): string {
  const subject = prepared.version === null
    ? '`chore: release`'
    : `\`chore: release ${prepared.version}\``;
  return `* Leave ${releaseFilePhrase(prepared)} UNSTAGED and UNCOMMITTED. Do not \`git add\` them, and do not sweep them up with \`git add -A\`, \`git commit -a\` or \`git commit <path>\`: after this session ends the loop checks your rewrite, and then makes its own ${subject} commit holding those files and nothing else. A commit of yours that took them is a release commit nothing ever verified.`;
}

/** The entry, carried from the changelog into the pull request body. */
function releaseBodyBullet(prepared: ReleasePrepared): string {
  return `* Carry the entry into the pull request body: the heading \`${prepared.entry.heading}\` and the lines you left under it, as a section of the description, so a reader sees what this release ships without opening \`${prepared.changelog.path}\`.`;
}

/** The one line a preparation that wrote nothing asks the session for. */
function skippedReleaseBullet(skipped: ReleaseSkipped): string {
  return `* This pull request ships NO release: ${skipped.sentence}. Put that line in the pull request body as it is written here, and leave the changelog and the version file exactly as you found them — do not write an entry or bump a version by hand, since a release the loop did not prepare is one nothing verifies.`;
}

/**
 * The branch's open PR number as the loop reads it before the session,
 * or null when it has none.
 *
 * A provider that could not be ASKED — `gh` absent, unauthenticated or
 * offline — throws, and that is read as null here rather than stopping
 * the wrap-up: the session still has to promote the findings, commit and
 * push, and the create bullet already carries the reading of a refusal
 * that must not turn into a second PR.
 */
async function openPullRequestNumber(branch: string): Promise<number | null> {
  try {
    const found = await ghPullRequestsIn(process.cwd()).findOpen(branch);
    return found?.number ?? null;
  } catch {
    return null;
  }
}

/**
 * What {@link lessonsToPromote} reads: the run's learning adapter as a
 * task's lessons are pushed to it (`start/dispatch.ts`), the root it
 * is made over, and the run's two `learning.promote.*` keys.
 */
export interface WrapUpLearning extends TaskLearning {
  /** The repo root the adapter holds its lessons under. */
  readonly repoRoot: string;
  /** The run's `learning.promote.after`. */
  readonly promoteAfter: number;
  /** The run's `learning.promote.minConfidence`. */
  readonly promoteMinConfidence: number;
}

/** An error's message, or the value itself as text. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * The run's learning adapter, made as a task's is (`start/dispatch.ts`):
 * the kind resolved in its registry, at the run's root, home and bless
 * floor. Throws when no adapter has the kind or it cannot be made.
 */
function wrapUpAdapter(learning: WrapUpLearning): Learning {
  const registry = learning.registry ?? CORE_ADAPTER_REGISTRY;
  return registry.resolve('learning', learning.kind).create({
    repoRoot: learning.repoRoot,
    home: learning.home,
    learningBlessMinConfidence: learning.blessMinConfidence,
  });
}

/**
 * The lessons the wrap-up session is asked to promote: `promotable`
 * over the adapter's blessed set, at the run's `learning.promote.*`
 * keys. Never throws.
 *
 * The port gives no held set, only `pullBlessed`, and the adapter is
 * made at `learning.bless.minConfidence` as a task's is: the spec's
 * promotable lessons are the BLESSED ones that also recurred, so a
 * lesson tasks may not use is never promoted, whatever
 * `learning.promote.minConfidence` says. Under `local`, the bundle also
 * carries the user scope's lessons on triggers the project holds
 * nothing on, and those are listed like any other.
 *
 * A null `learning` lists nothing. An adapter that cannot be made or
 * refuses the pull is one warning and lists nothing: the wrap-up still
 * has to sync, commit, push and open the PR.
 */
export async function lessonsToPromote(learning: WrapUpLearning | null): Promise<readonly InstinctRecord[]> {
  if (learning === null) return [];
  try {
    const bundle = await wrapUpAdapter(learning).pullBlessed();
    return promotable(bundle.instincts, {
      after: learning.promoteAfter,
      minConfidence: learning.promoteMinConfidence,
    });
  } catch (error) {
    activeOutput().warn(`   The wrap-up lists no lesson to promote: the \`${learning.kind}\` learning adapter answered no blessed set: ${messageOf(error)}`);
    return [];
  }
}

/**
 * Runs the wrap-up session over the plan the run was started on, loading
 * settings from `settingSources`, the run's `loop.settingSources`.
 *
 * `release` is step 1's record, as `prepareReleaseStage`
 * (`start/release-stage.ts`) answered it just before this call, and
 * null when no preparation ran at all — this session then gets no
 * release bullet of any kind ({@link buildWrapUpPrompt}). It is handed
 * over rather than prepared here because the loop verifies and commits
 * the same record after this session returns: a preparation made
 * inside this function would leave `start.ts` nothing to finish.
 *
 * `serving` is what the session is served against (`start/serving.ts`),
 * as a task session is: the run's served directory is filled just
 * before the spawn, each winner left out is warned about, and the
 * served flags reach the spawn through `runClaudeCaptured`. Null serves
 * nothing. It is required, as `release` is, so a caller has to name
 * both.
 *
 * `learning` is where the lessons to promote are read from
 * ({@link lessonsToPromote}), before the session and after the PR
 * lookup. Null lists none. It is required for the same reason: a
 * default of nothing would drop every promotion and nothing would say
 * so.
 *
 * When the list holds a lesson, HEAD is read just before the spawn, the
 * session's output is captured as it is shown, and once the session has
 * succeeded its `rafa:promoted` answer is checked against the changes
 * since that HEAD (`start/promoted-check.ts`): each confirmed lesson
 * gets `promoted_to` through the same adapter, and one line naming each
 * unanswered or unchanged id goes into the PR body with `gh pr edit`. A
 * session that FAILED is not checked. Its commit, push and PR may never
 * have happened, and the rerun this module then asks for lists the same
 * lessons again, which a `promoted_to` set now would take off that list.
 */
export async function preserveProgress(
  planContent: string,
  settingSources: readonly ClaudeSettingSource[],
  release: ReleasePreparation | null,
  serving: SessionServing | null,
  learning: WrapUpLearning | null,
): Promise<void> {
  const branch = getCurrentBranch();
  const openPullRequest = await openPullRequestNumber(branch);
  const lessons = await lessonsToPromote(learning);
  const prompt = buildWrapUpPrompt(branch, planContent, openPullRequest, release, lessons);
  const served = serving === null
    ? null
    : serveSession(serving);
  for (const skipped of served?.skipped ?? []) activeOutput().warn(`   ${skipped.message}`);
  const git = learning === null || lessons.length === 0
    ? null
    : createGitRunner(learning.repoRoot);
  const head = git === null
    ? null
    : readHead(git);
  const session = await runClaudeCaptured(withStamp(prompt), settingSources, [], undefined, served?.flags ?? []);
  if (session.exitCode !== 0) {
    activeOutput().error(`\n❌ Failed to preserve progress (exit ${session.exitCode}). Please try again.`);
    return;
  }
  activeOutput().info('\n✅ Progress preserved; PR opened or updated on this branch.');
  if (learning === null || git === null) return;
  await checkWrapUpAnswer({
    lessons,
    output: session.stdout,
    head,
    repoRoot: learning.repoRoot,
    branch,
    git,
    pulls: ghPullRequestsIn(process.cwd()),
    learning: () => wrapUpAdapter(learning),
  });
}
