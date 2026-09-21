/**
 * The session the loop runs once the tracker holds no task left.
 *
 * `start()` hands {@link preserveProgress} the plan it was started on,
 * the setting sources its config resolved to, and the release
 * preparation `start/release-stage.ts` made just before the call; and
 * the session built here, loading settings from those sources,
 * promotes the run's findings, syncs the branch with main, commits,
 * pushes and opens or updates the PR. `start()` finishes that release
 * and then waits on the PR's checks after it returns. The line this
 * module closes with, naming whether the session succeeded, goes
 * through the active output (`adapters/output/active.ts`): `info` on
 * success, and `error` on a failure, which does not stop `start()`.
 *
 * The prompt's first line is the `wrap-up` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that literal from.
 */
import type { ClaudeSettingSource } from '../config.js';
import type { ReleasePrepared, ReleasePreparation, ReleaseSkipped } from '../release/prepare.js';

import { activeOutput } from '../adapters/output/active.js';
import { mechanicalConflictBullet } from '../pr/conflict-sentence.js';
import { ghPullRequestsIn } from '../pr/index.js';
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';

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
 */
export function buildWrapUpPrompt(
  branch: string,
  planContent: string,
  openPullRequest: number | null = null,
  release: ReleasePreparation | null = null,
): string {
  return [
    '* Read `@progress.txt` in full.',
    '* `@progress.txt` above names the file `progress.txt` at the repo root; the `@` is a reference marker, never part of a path. Do not create or write a file whose name starts with `@`.',
    '* If there\'s anything worth keeping, take what\'s generally relevant from that file into the `context/` page that owns its subject, `README.md` or a pertinent skill under `.claude/skills/`. The root `AGENTS.md` is a capped map read into every turn of every session: point at the page from there if a new one is needed, never inline the finding itself.',
    '* Promote a finding ONLY when all three hold, and delete or keep it rather than promoting it when any one fails. It is PROJECT-SPECIFIC — a fact about THIS tree (its layout, its gates, its conventions, what a command here actually answers) and not a general technique, which belongs in a skill and not in this repo\'s docs. It is NOT ALREADY COVERED by a skill under `.claude/skills/` — read the skill that matches the finding\'s subject before writing anything, and extend that skill in place rather than restating it in a second document. And it NAMES WHAT IT REPLACES — the sentence, bullet or table row it supersedes, deleted in the SAME edit — or, when it replaces nothing, says so. A promotion landing beside the claim it should have replaced leaves two authorities on one subject, and nothing here compares two documents, so the stale one is never reported again.',
    '* If a learn/learn-eval skill is available in this session, invoke it now so reusable patterns from this run are persisted as skills.',
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
    '',
    'The plan this run executed follows, in full.',
    '',
    planContent,
  ].join('\n');
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
 */
export async function preserveProgress(
  planContent: string,
  settingSources: readonly ClaudeSettingSource[],
  release: ReleasePreparation | null = null,
): Promise<void> {
  const branch = getCurrentBranch();
  const prompt = buildWrapUpPrompt(branch, planContent, await openPullRequestNumber(branch), release);
  const exitCode = await runClaude(withStamp(prompt), settingSources);
  if (exitCode !== 0) {
    activeOutput().error(`\n❌ Failed to preserve progress (exit ${exitCode}). Please try again.`);
  } else {
    activeOutput().info('\n✅ Progress preserved; PR opened or updated on this branch.');
  }
}
