/**
 * The `Next:` lines a refused `rafa release tag` prints between its `❌`
 * lines and its usage: every refusal names the step that clears it, in
 * the `<command> — <why>` form the follow-ups of a run that tagged use
 * (`./tag-follow-ups.ts`).
 *
 * ## Why every refusal carries one
 *
 * A refusal that only says what is wrong leaves the operator to work out
 * the fix, and the fix is often in another place than the one the run
 * stands in. Measured on 2026-11-08 at 0.52.0: a session worktree on a
 * detached HEAD refused with `a release is tagged on main` and nothing
 * else, while the project releases from `integration` (its `pr.base` sat
 * in the main checkout's gitignored YAML, which the worktree's walk
 * never reaches), and the branch was checked out in the main checkout,
 * so `git switch` there would have refused too.
 *
 * ## The branch refusal
 *
 * It names two things the readings alone cannot: where the release branch
 * is checked out ({@link readBranchHolder}, over `git worktree list
 * --porcelain`, local and with no network), so the step is a `cd` into
 * that checkout instead of a `git switch` git would refuse; and, when
 * `pr.base` is unset, that the branch is the default and which config
 * file was read, so a project that releases from another branch sees the
 * cause rather than a branch name it never chose.
 *
 * `behind` gives no step of its own: its sentence already names the
 * `git merge --ff-only` to run.
 */
import type { TagInputs, TagRefused } from './tag.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { UNRELEASED_VERSION } from './tag-units.js';

/** Where the release branch stands, read only once the branch check refused. */
export interface BranchPlace {
  /** The worktree that has the release branch checked out, or null when none does or git did not answer. */
  readonly holder: string | null;
  /** True when `pr.base` is unset, so the release branch is the default. */
  readonly defaulted: boolean;
  /** The config file the project scope was read from. */
  readonly configFile: string;
}

/** The line `git worktree list --porcelain` opens each worktree's block with. */
const WORKTREE_PREFIX = 'worktree ';

/** The step every reading that is hard to judge by eye ends at. */
const STATUS_STEP = 'rafa release status — shows the version file, the changelog and the tags side by side';

/**
 * The worktree that has `branch` checked out, read off `git worktree
 * list --porcelain`, or null when none does or git did not answer.
 */
export function readBranchHolder(git: GitRunner, branch: string): string | null {
  const listed = git(['worktree', 'list', '--porcelain']);
  if (!listed.ok) return null;
  const holding = listed.stdout
    .split(/\n\s*\n/u)
    .map((block) => block.split('\n'))
    .find((lines) => lines.includes(`branch refs/heads/${branch}`));
  const path = holding?.find((line) => line.startsWith(WORKTREE_PREFIX));
  return path === undefined
    ? null
    : path.slice(WORKTREE_PREFIX.length);
}

/** The steps of a branch refusal; see the module note. */
function branchSteps(releaseBranch: string, place: BranchPlace | null): readonly string[] {
  const move = place?.holder == null
    ? `git switch ${releaseBranch}, then rafa release tag — a release is tagged from ${releaseBranch}`
    : `cd ${place.holder} && rafa release tag — ${releaseBranch} is checked out there`;
  if (place?.defaulted !== true) return [move];
  return [
    `set pr.base in ${place.configFile} — it is unset there, so ${releaseBranch} is the default release branch;`
    + ' a tracked rafa.config.ts reaches every worktree, a gitignored .rafa/config.yaml only its own checkout',
    move,
  ];
}

/** The step of a changelog refusal, which depends on whether the file is there. */
function changelogStep(inputs: TagInputs): string {
  const { path, problem, absent } = inputs.changelog;
  if (problem !== null && absent !== true) return `check that ${path} is readable — it is there and could not be read`;
  if (problem !== null && inputs.package !== null) {
    return `rafa release settle — writes ${path} when ${inputs.package} is released; a package never released`
      + ` stays at ${UNRELEASED_VERSION} in ${inputs.version.path} with no changelog and no tag, and is passed over`;
  }
  return `${STATUS_STEP}; rafa release settle writes the version and its changelog section in one commit`;
}

/**
 * The `Next:` steps of one refusal, `inputs` the readings it was decided
 * from and `place` the branch's, read only for a branch refusal.
 */
export function nextStepsOf(refused: TagRefused, inputs: TagInputs, place: BranchPlace | null): readonly string[] {
  switch (refused.reason) {
    case 'branch':
      return branchSteps(inputs.releaseBranch, place);
    case 'behind':
      return [];
    case 'version':
      return [`check ${inputs.version.path} — it has to declare the version under "version"`];
    case 'tagged':
      return [`${STATUS_STEP}; fragments waiting there go into the next version through rafa release settle`];
    case 'changelog':
      return [changelogStep(inputs)];
    case 'git':
      return ['git status — shows whether git answers in this checkout; then rafa release tag again'];
    case 'receipt':
      return [`${STATUS_STEP}; a section above the adoption boundary is one rafa release settle wrote`];
  }
}
