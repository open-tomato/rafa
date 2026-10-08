/**
 * The sync: {@link syncProject} brings the whole project in step with the
 * issues, the step behind `rafa board sync`
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "`rafa board
 * sync`"). It repairs what changed outside rafa: a label edited in the web
 * UI, an issue closed by hand, the Roadmap issue's order edited in its
 * body.
 *
 * ## Two passes at most
 *
 *  1. One refresh (`./refresh.ts`) widened by `everyItem` and
 *     `openIssues`: every item of this repository on the project, then
 *     every open issue on the board listing. It writes the values that
 *     differ and answers, as `missing`, the open issues with no item.
 *  2. When that refresh was refused nothing and some open issue is
 *     missing, each one is added through {@link ProjectPort.addItem}, in
 *     number order, and a second refresh over those issues alone fills
 *     their fields, as `rafa issue create`'s add does
 *     (`./add-issue.ts`).
 *
 * A dry run sends the first refresh with `dryRun` set and no second: the
 * changes are answered as they would be written, the missing issues as
 * ones it would add, and nothing is written or added.
 *
 * ## What it answers
 *
 * The first refresh's answer when it read no project (`skipped`,
 * `not-found`, `refused`), since there is nothing to sync; otherwise a
 * {@link ProjectSynced}. A rate-limit refusal in the first pass leaves the
 * missing issues unadded, since every add would be refused the same way.
 * A token without the `project` scope found at the add answers `refused`,
 * as the refresh does. Any other rejection is the reader's own error, for
 * the command to refuse with.
 *
 * ## An issue refused alone
 *
 * An issue whose facts could not be read in either pass is answered in
 * {@link ProjectSynced.refused}, its line `#<n> not refreshed: <reason>`
 * among the warnings, and nothing is written for it. It stops nothing
 * else: the other issues are written, the missing ones still added, and
 * the next sync reads the refused one again. An added issue refused in the
 * second pass is on the project with no value filled.
 *
 * ## Progress
 *
 * Given {@link RefreshOptions.progress}, the second pass's adds are the
 * `adding issues` phase (`./progress.ts`): its total is the missing
 * issues, it advances after each add, and its end counts the issues added
 * and, as refused, those a rejected add left unadded, before the
 * rejection goes on. Each refresh feeds its own `reading facts` and
 * `writing fields` phases (`./refresh.ts`), so a sync that adds issues
 * prints those two phases twice, once per pass.
 */
import type { FactsRefusal } from './facts.js';
import type { ProjectPort, ProjectRef } from './port.js';
import type { ProjectChange } from './refresh-values.js';
import type {
  ProjectRefreshed,
  ProjectRefreshNotFound,
  ProjectRefreshRefused,
  ProjectRefreshSkipped,
  RefreshOptions,
  RefreshWidening,
} from './refresh.js';
import type { ProjectWritesResult } from './writes.js';

import { readBoardRepository } from '../../commands/epic/move-native.js';

import { createGhProjectPort } from './gh.js';
import { openPhase } from './progress.js';
import { isMissingProjectScope, notFoundWarning, scopeWarning } from './refresh-warnings.js';
import { refreshProjectItems } from './refresh.js';

/** A sync that read the project. */
export interface ProjectSynced {
  readonly kind: 'synced';
  readonly project: ProjectRef;
  readonly dryRun: boolean;
  /** Every value that differed, the items already there first, then the issues added; none written on a dry run. */
  readonly changes: readonly ProjectChange[];
  /** The open issues that had no item on the project, lowest number first. */
  readonly missing: readonly number[];
  /** The issues of {@link ProjectSynced.missing} added to the project; none on a dry run. */
  readonly added: readonly number[];
  /** The issues whose facts could not be read, none written, the first pass's then the second's. */
  readonly refused: readonly FactsRefusal[];
  /** How the writes of both passes went, added together. */
  readonly writes: ProjectWritesResult;
  /** Every warning line of both passes, in order. */
  readonly warnings: readonly string[];
}

/** What {@link syncProject} answers; see the module note. */
export type ProjectSync = ProjectRefreshSkipped | ProjectRefreshNotFound | ProjectRefreshRefused | ProjectSynced;

/** The widening of the first pass: the whole project, then every open issue. */
const WHOLE_PROJECT: RefreshWidening = Object.freeze({ everyItem: true, openIssues: true });

/** The writes of two passes, added together. */
function addedWrites(first: ProjectWritesResult, second: ProjectWritesResult): ProjectWritesResult {
  return {
    written: first.written + second.written,
    notUpdated: first.notUpdated + second.notUpdated,
    rateLimited: first.rateLimited || second.rateLimited,
    detail: [first.detail, second.detail].filter((detail) => detail !== '').join('\n'),
  };
}

/** Adds `issues` to the project `ref` names, in order; null when that project is not there. */
async function addIssues(options: RefreshOptions, ref: ProjectRef, issues: readonly number[]): Promise<readonly number[] | null> {
  const repository = await readBoardRepository(options.gh);
  const port: ProjectPort = createGhProjectPort(options.gh);
  const project = await port.find(ref);
  if (project === null) return null;
  const phase = openPhase(options.progress, 'adds', issues.length);
  let added = 0;
  try {
    for (const number of issues) {
      await port.addItem(project.id, { repository, number });
      added += 1;
      phase.advance(added);
    }
  } finally {
    phase.end({ done: added, refused: issues.length - added });
  }
  return issues;
}

/** `synced`, the first pass's answer, with its missing issues added and refreshed; see the module note. */
async function addMissing(options: RefreshOptions, first: ProjectRefreshed, synced: ProjectSynced): Promise<ProjectSync> {
  if (synced.dryRun || first.missing.length === 0 || first.writes.rateLimited) return synced;
  try {
    const added = await addIssues(options, first.project, first.missing);
    if (added === null) return { kind: 'not-found', project: first.project, warnings: [notFoundWarning(first.project)] };
    const second = await refreshProjectItems(options, added);
    if (second.kind !== 'refreshed') return second;
    return {
      ...synced,
      changes: [...first.changes, ...second.changes],
      added,
      refused: [...first.refused, ...second.refused],
      writes: addedWrites(first.writes, second.writes),
      warnings: [...first.warnings, ...second.warnings.filter((line) => !first.warnings.includes(line))],
    };
  } catch (error) {
    if (isMissingProjectScope(error)) return { kind: 'refused', reason: 'scope', project: first.project, warnings: [scopeWarning()] };
    throw error;
  }
}

/**
 * Refreshes every item on the project and adds every open issue missing
 * from it, or with {@link RefreshOptions.dryRun} answers what that would
 * change and writes nothing; see the module note.
 */
export async function syncProject(options: RefreshOptions): Promise<ProjectSync> {
  const first = await refreshProjectItems(options, [], WHOLE_PROJECT);
  if (first.kind !== 'refreshed') return first;
  return addMissing(options, first, {
    kind: 'synced',
    project: first.project,
    dryRun: options.dryRun === true,
    changes: first.changes,
    missing: first.missing,
    added: [],
    refused: first.refused,
    writes: first.writes,
    warnings: first.warnings,
  });
}
