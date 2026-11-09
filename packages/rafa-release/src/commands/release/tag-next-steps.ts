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
 *
 * ## Every step carries its place and its case
 *
 * A step is a {@link ReleaseStep}: its command, its why, and the case of
 * the refusal that gave it (`./step-cases.ts`), which `hints.skills`
 * turns into a skill line. Each command is placed by core's `placeLine`
 * where it must run, through a {@link StepPlacing}: the branch step at
 * the checkout holding the release branch, every other at the project
 * root, since that is where the run read what it refused. A holder whose
 * path is gone, as `git worktree list` keeps a pruned worktree's record,
 * gives the `git switch` step a run with no holder gives. A step that is
 * an instruction rather than a command (`set pr.base in …`, `check …`)
 * is printed as it is: a `cd` in front of prose runs nothing.
 */
import type { ReleaseStep } from './step-cases.js';
import type { TagInputs, TagRefused } from './tag.js';
import type { GitRunner, PlaceSeams } from '@open-tomato/rafa/core/git';

import { existsSync } from 'node:fs';

import { placeLine, readTopLevel } from '@open-tomato/rafa/core/git';

import { caseOf } from './step-cases.js';
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

/** Where a run's steps are placed; see the module note. */
export interface StepPlacing {
  /** The project root, which every step but the branch step runs in. */
  readonly root: string;
  /** The top-level read and the path check `placeLine` reads. */
  readonly seams: PlaceSeams;
}

/** A step without its case: what each reason below spells. */
type StepText = Omit<ReleaseStep, 'case'>;

/** The line `git worktree list --porcelain` opens each worktree's block with. */
const WORKTREE_PREFIX = 'worktree ';

/** The command every reading that is hard to judge by eye ends at. */
const STATUS_COMMAND = 'rafa release status';

/** Why {@link STATUS_COMMAND} applies, before the clause each reason adds. */
const STATUS_WHY = 'shows the version file, the changelog and the tags side by side';

/** The command the branch step runs once it stands on the release branch. */
const TAG_COMMAND = 'rafa release tag';

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

/**
 * Where a run's steps are placed: at `root`, the top level read once
 * through `git`, the project's runner, and every path checked on disk.
 * `rafa release tag` and `rafa release settle` both place theirs so.
 */
export function stepPlacingOf(root: string, git: GitRunner): StepPlacing {
  const topLevel = readTopLevel(git);
  return { root, seams: { readTopLevel: () => topLevel, pathExists: existsSync } };
}

/**
 * `command` placed at the project root. A root that is not there, which
 * a run that read it cannot meet, leaves the command bare rather than
 * dropping the step.
 */
export function placedAtRoot(command: string, placing: StepPlacing): string {
  const answer = placeLine(command, placing.root, placing.seams);
  return answer.kind === 'placed'
    ? answer.line
    : command;
}

/** The step that moves onto the release branch: a `cd` into its holder, or a `git switch` when there is none. */
function moveStep(releaseBranch: string, holder: string | null, placing: StepPlacing): StepText {
  const placed = holder === null
    ? null
    : placeLine(TAG_COMMAND, holder, placing.seams);
  if (placed?.kind === 'placed') return { command: placed.line, why: `${releaseBranch} is checked out there` };
  return {
    command: placedAtRoot(`git switch ${releaseBranch}, then ${TAG_COMMAND}`, placing),
    why: `a release is tagged from ${releaseBranch}`,
  };
}

/** The steps of a branch refusal; see the module note. */
function branchSteps(releaseBranch: string, place: BranchPlace | null, placing: StepPlacing): readonly StepText[] {
  const move = moveStep(releaseBranch, place?.holder ?? null, placing);
  if (place?.defaulted !== true) return [move];
  return [
    {
      command: `set pr.base in ${place.configFile}`,
      why: `it is unset there, so ${releaseBranch} is the default release branch;`
        + ' a tracked rafa.config.ts reaches every worktree, a gitignored .rafa/config.yaml only its own checkout',
    },
    move,
  ];
}

/** The {@link STATUS_COMMAND} step, placed at the root, its why ending in `clause`. */
function statusStep(clause: string, placing: StepPlacing): StepText {
  return { command: placedAtRoot(STATUS_COMMAND, placing), why: `${STATUS_WHY}; ${clause}` };
}

/** The step of a changelog refusal, which depends on whether the file is there. */
function changelogStep(inputs: TagInputs, placing: StepPlacing): StepText {
  const { path, problem, absent } = inputs.changelog;
  if (problem !== null && absent !== true) {
    return { command: `check that ${path} is readable`, why: 'it is there and could not be read' };
  }
  if (problem !== null && inputs.package !== null) {
    return {
      command: placedAtRoot('rafa release settle', placing),
      why: `writes ${path} when ${inputs.package} is released; a package never released`
        + ` stays at ${UNRELEASED_VERSION} in ${inputs.version.path} with no changelog and no tag, and is passed over`,
    };
  }
  return statusStep('rafa release settle writes the version and its changelog section in one commit', placing);
}

/** The steps of `refused` without their case; see {@link nextStepsOf}. */
function stepsOf(
  refused: TagRefused,
  inputs: TagInputs,
  place: BranchPlace | null,
  placing: StepPlacing,
): readonly StepText[] {
  switch (refused.reason) {
    case 'branch':
      return branchSteps(inputs.releaseBranch, place, placing);
    case 'behind':
      return [];
    case 'version':
      return [{ command: `check ${inputs.version.path}`, why: 'it has to declare the version under "version"' }];
    case 'tagged':
      return [statusStep('fragments waiting there go into the next version through rafa release settle', placing)];
    case 'changelog':
      return [changelogStep(inputs, placing)];
    case 'git':
      return [{
        command: placedAtRoot('git status', placing),
        why: 'shows whether git answers in this checkout; then rafa release tag again',
      }];
    case 'receipt':
      return [statusStep('a section above the adoption boundary is one rafa release settle wrote', placing)];
  }
}

/**
 * The `Next:` steps of one refusal, `inputs` the readings it was decided
 * from, `place` the branch's, read only for a branch refusal, and
 * `placing` where each command is placed. Every step carries the
 * refusal's case.
 */
export function nextStepsOf(
  refused: TagRefused,
  inputs: TagInputs,
  place: BranchPlace | null,
  placing: StepPlacing,
): readonly ReleaseStep[] {
  const stepCase = caseOf(refused.reason);
  return stepsOf(refused, inputs, place, placing).map((step) => ({ ...step, case: stepCase }));
}
