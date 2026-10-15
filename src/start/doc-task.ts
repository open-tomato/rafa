/**
 * The doc task's prompt section, put into a dispatch by
 * {@link docTaskPrompt}.
 *
 * A plan that changes code ends on one task declared `docs=repair`
 * beside `agent=doc-updater` (`core/plan/declaration.ts`). That task, and no
 * other, is handed the `## Documentation to repair` section
 * `docs/task-reading.ts` renders: the plan's `sighting` rows and the
 * files its commits touched. `dispatchTask` (`start/dispatch.ts`) makes
 * one call here with the `PROMPT.md` text it is about to place, and gets
 * it back unchanged for every task whose declaration names no docs role,
 * so their prompts are the ones built before the section existed. For
 * the doc task it gets the section, a blank line, then that text: the
 * section sits after the skills, lessons and inherited sections and
 * ahead of `PROMPT.md`.
 *
 * ## Where it reads
 *
 * The rows are read from the store under the PROJECT ROOT, under the
 * run's plan stub; a run of a bare `PLAN.md` has no stub, and so no
 * rows, and is handed the touched files alone. The files are read by git
 * in the CHECKOUT, whose `HEAD` is the run's branch: in a linked
 * worktree the project root's `HEAD` is some other branch. The section
 * is redacted of local paths under the checkout, where the sessions
 * that wrote the rows ran, and under the home directory.
 *
 * The base the files are diffed from is the run's base branch, `pr.base`
 * or else the branch `origin`'s `HEAD` names (`resolveBaseBranch`,
 * `cleanup/branches.ts`), read as `origin/<base>` when that ref resolves
 * in the checkout and as the bare `<base>` otherwise, so a checkout with
 * no `origin` still diffs against its local branch.
 *
 * A dispatch handed no {@link DocTaskPlace} reads nothing and hands no
 * section, whatever its task declared: a test driving the `run` seam
 * names none. Nothing here throws on a read: `readDocTaskInput` answers
 * a failed read as a sentence the section carries.
 */
import type { DocTaskInputOptions } from '../docs/task-reading.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { TaskDeclaration } from '@open-tomato/rafa/core/plan';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { readDocsRole } from '@open-tomato/rafa/core/plan';

import { resolveBaseBranch } from '../cleanup/branches.js';
import { readDocTaskInput, renderDocTaskSection } from '../docs/task-reading.js';

/** Where the run's doc task reads its input: what `start()` knows of the run. */
export interface DocTaskPlace {
  /** The run's plan stub, or null for a plan file whose name gives none. */
  readonly planStub: string | null;
  /** The run's `pr.base`, or null when nobody named one. */
  readonly prBase: string | null;
  /** Runs git in the checkout. Defaults to `createGitRunner` over it. */
  readonly git?: GitRunner;
  /** Reads a plan's rows. Defaults to `readStaleDocsForPlan`. */
  readonly readRows?: DocTaskInputOptions['readRows'];
}

/** What {@link docTaskPrompt} reads besides the prompt text. */
export interface DocTaskDispatch {
  /** What the task's block declared, or null for no block. */
  readonly declaration: TaskDeclaration | null;
  /** The project root, which holds the store. */
  readonly repoRoot: string;
  /** The run's checkout, where git runs. */
  readonly checkout: string;
  /** The home directory the section is redacted of. */
  readonly home: string;
  /** Where the doc task reads, or null or absent to read nothing. */
  readonly place?: DocTaskPlace | null;
}

/** The ref the doc task's files are diffed from; see the module note. */
export function docTaskBaseRef(git: GitRunner, prBase: string | null): string {
  const base = resolveBaseBranch(git, prBase);
  const remote = `origin/${base}`;
  return git(['rev-parse', '--verify', '--quiet', `${remote}^{commit}`]).ok
    ? remote
    : base;
}

/**
 * `promptContent` with the doc task's section ahead of it for a task
 * declared `docs=repair`, and unchanged for every other task or for no
 * place. See the module note.
 */
export function docTaskPrompt(promptContent: string, dispatch: DocTaskDispatch): string {
  const place = dispatch.place ?? null;
  if (place === null || readDocsRole(dispatch.declaration) !== 'repair') return promptContent;
  const git = place.git ?? createGitRunner(dispatch.checkout);
  const input = readDocTaskInput({
    repoRoot: dispatch.repoRoot,
    planStub: place.planStub ?? '',
    baseRef: docTaskBaseRef(git, place.prBase),
    git,
    readRows: place.planStub === null
      ? () => []
      : place.readRows,
  });
  return `${renderDocTaskSection(input, dispatch.checkout, dispatch.home)}\n\n${promptContent}`;
}
