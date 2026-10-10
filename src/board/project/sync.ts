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
 *     number order, and the item id each add answers is kept. A second
 *     refresh over those issues alone fills their fields, handed those
 *     items as known items (`./refresh.ts`, "Known items, for issues just
 *     added"), so it fills each added issue whether or not the project's
 *     item listing shows its item yet.
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
 * ## Added, and filled
 *
 * {@link ProjectSynced.added} holds the issues added and
 * {@link ProjectSynced.filled} those of them the second refresh filled:
 * the added issues it did not answer in its `notFilled` (`./refresh.ts`).
 * Each one it did answer there gets the line
 * `#<n> added but not filled: <reason>` (`addedNotFilledWarning`), after
 * every other warning of both passes, in the order added. The reasons are
 * the refresh's. Two of them reach a sync: the issue's facts were refused,
 * or a rate-limit refusal left one of its writes unsent. The other two do
 * not, since each known item is built from the repository and number its
 * own add sent, and the second refresh is asked for exactly those issues.
 *
 * An added issue whose facts were refused is therefore named twice, by
 * the second pass's own `#<n> not refreshed: <reason>` and by this line,
 * with one reason: the first says nothing was written for it, the second
 * that it sits on the project unfilled. The next sync finds its item on
 * the project and fills it in its first pass.
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
  KnownItem,
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
import {
  addedNotFilledWarning,
  isMissingProjectScope,
  notFoundWarning,
  scopeWarning,
} from './refresh-warnings.js';
import { knownItem, refreshProjectItems } from './refresh.js';

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
  /** The issues of {@link ProjectSynced.added} whose fields the second pass filled; see the module note. */
  readonly filled: readonly number[];
  /** The issues whose facts could not be read, none written, the first pass's then the second's. */
  readonly refused: readonly FactsRefusal[];
  /** How the writes of both passes went, added together. */
  readonly writes: ProjectWritesResult;
  /** Every warning line of both passes, in order, then one `added but not filled` line per added issue not filled. */
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

/**
 * Adds `issues` to the project `ref` names, in order, and answers the
 * known item of each add; null when that project is not there.
 */
async function addIssues(options: RefreshOptions, ref: ProjectRef, issues: readonly number[]): Promise<readonly KnownItem[] | null> {
  const repository = await readBoardRepository(options.gh);
  const port: ProjectPort = createGhProjectPort(options.gh);
  const project = await port.find(ref);
  if (project === null) return null;
  const phase = openPhase(options.progress, 'adds', issues.length);
  let known: readonly KnownItem[] = [];
  try {
    for (const number of issues) {
      const content = { repository, number };
      known = [...known, knownItem(await port.addItem(project.id, content), content)];
      phase.advance(known.length);
    }
  } finally {
    phase.end({ done: known.length, refused: issues.length - known.length });
  }
  return known;
}

/** `synced`, the first pass's answer, with its missing issues added and refreshed; see the module note. */
async function addMissing(options: RefreshOptions, first: ProjectRefreshed, synced: ProjectSynced): Promise<ProjectSync> {
  if (synced.dryRun || first.missing.length === 0 || first.writes.rateLimited) return synced;
  try {
    const known = await addIssues(options, first.project, first.missing);
    if (known === null) return { kind: 'not-found', project: first.project, warnings: [notFoundWarning(first.project)] };
    const added = known.map(({ content }) => content.number);
    const second = await refreshProjectItems(options, added, {}, known);
    if (second.kind !== 'refreshed') return second;
    const notFilled = new Set(second.notFilled.map(({ number }) => number));
    return {
      ...synced,
      changes: [...first.changes, ...second.changes],
      added,
      filled: added.filter((issue) => !notFilled.has(issue)),
      refused: [...first.refused, ...second.refused],
      writes: addedWrites(first.writes, second.writes),
      warnings: [
        ...first.warnings,
        ...second.warnings.filter((line) => !first.warnings.includes(line)),
        ...second.notFilled.map(addedNotFilledWarning),
      ],
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
    filled: [],
    refused: first.refused,
    writes: first.writes,
    warnings: first.warnings,
  });
}
