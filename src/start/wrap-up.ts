/**
 * The session the loop runs once the tracker holds no task left.
 *
 * `start()` hands {@link preserveProgress} the plan it was started on,
 * and the session built here promotes the run's findings, syncs the
 * branch with main, commits, pushes and opens or updates the PR.
 * `start()` waits on that PR's checks after it returns.
 *
 * The prompt's first line is the `wrap-up` classifier key, and
 * `PROMPT_SHAPES` in `effort/classify.ts` names this file as the source
 * its drift guard reads that literal from.
 */
import { runClaude } from '../utils/claude.js';
import { getCurrentBranch } from '../utils/git.js';
import { findOpenPullRequest } from '../utils/pr.js';

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
 * is the `full` rendering. The session titles the PR after the plan,
 * looks for its issue reference there and summarises the work of every
 * stage, and a `stage` or `task` rendering holds one stage, or one
 * task line.
 *
 * `openPullRequest` is the branch's open PR as the loop read it before
 * the session, or null when it found none. The session is told which
 * rather than asked to look, so whether to create or to edit is decided
 * here, and only a create that meets an existing PR is left to it.
 */
export function buildWrapUpPrompt(
  branch: string,
  planContent: string,
  openPullRequest: number | null = null,
): string {
  return [
    '* Read `@progress.txt` in full.',
    '* `@progress.txt` above names the file `progress.txt` at the repo root; the `@` is a reference marker, never part of a path. Do not create or write a file whose name starts with `@`.',
    '* If there\'s anything worth keeping, take what\'s generally relevant from that file into the `context/` page that owns its subject, `README.md` or a pertinent skill under `.claude/skills/`. The root `AGENTS.md` is a capped map read into every turn of every session: point at the page from there if a new one is needed, never inline the finding itself.',
    '* Promote a finding ONLY when all three hold, and delete or keep it rather than promoting it when any one fails. It is PROJECT-SPECIFIC — a fact about THIS tree (its layout, its gates, its conventions, what a command here actually answers) and not a general technique, which belongs in a skill and not in this repo\'s docs. It is NOT ALREADY COVERED by a skill under `.claude/skills/` — read the skill that matches the finding\'s subject before writing anything, and extend that skill in place rather than restating it in a second document. And it NAMES WHAT IT REPLACES — the sentence, bullet or table row it supersedes, deleted in the SAME edit — or, when it replaces nothing, says so. A promotion landing beside the claim it should have replaced leaves two authorities on one subject, and nothing here compares two documents, so the stale one is never reported again.',
    '* If a learn/learn-eval skill is available in this session, invoke it now so reusable patterns from this run are persisted as skills.',
    '* If it\'s present, extract the issue reference from the plan below (e.g. "#42") to be used in the PR title.',
    `* If the reference is not present on the plan check if the branch name (${branch}) carries one (e.g. feat/42-slug).`,
    '* Use the plan title as the PR title, include the issue reference if you found it, e.g. "Implement user authentication (#42)".',
    '* Create a concise yet descriptive PR description that summarizes the overall work done based on the completed plan and progress notes.',
    '* BEFORE pushing, bring the branch up to date with the base: `git fetch origin main` then `git merge origin/main`. A branch that conflicts with main gets NO CI run at all — GitHub cannot build `refs/pull/<n>/merge` for it — so a conflicted PR is a plan reported finished whose code was never once checked. Resolving here, where the plan\'s context is still loaded, is the cheapest place it will ever be.',
    '* Resolve MECHANICAL conflicts yourself and do not stop for them: dependency version bumps (take the base\'s version unless this branch deliberately pinned it, and say which in the commit), lockfiles, generated artifacts, and complementary additions where both sides appended different material to the same file (keep BOTH). Stop only for a genuine semantic conflict — two sides changing the same behaviour incompatibly. In that case commit nothing, leave the branch as it is, and report the conflicting paths and both sides\' intent, so a human decides.',
    '* If the merge touched `bun.lock` or any `package.json`, run `bun install --frozen-lockfile` and require it to pass BEFORE pushing. It is the one-second local reproduction of the CI install step, and it catches a lockfile that no longer matches the merged manifests — the failure mode where every CI job dies at its first step and nothing downstream runs. When it fails, do NOT hand-edit the lockfile: restore the base\'s copy (`git checkout origin/main -- bun.lock`), run a plain `bun install` so this branch\'s own dependencies are re-added, and confirm the frozen run then passes.',
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

/** Runs the wrap-up session over the plan the run was started on. */
export async function preserveProgress(planContent: string): Promise<void> {
  const branch = getCurrentBranch();
  const prompt = buildWrapUpPrompt(branch, planContent, findOpenPullRequest(branch));
  const exitCode = await runClaude(withStamp(prompt));
  if (exitCode !== 0) {
    console.error(`\n❌ Failed to preserve progress (exit ${exitCode}). Please try again.`);
  } else {
    console.log('\n✅ Progress preserved; PR opened or updated on this branch.');
  }
}
