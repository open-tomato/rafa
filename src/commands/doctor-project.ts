/**
 * The project rows of `rafa doctor`: three light readings of the
 * repository's GitHub project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "`rafa
 * doctor`"), none of which reads an item.
 *
 * ```text
 * GitHub project:
 *   present  project scope
 *   present  project 6: https://github.com/orgs/open-tomato/projects/6
 *   present  project fields
 * Run rafa board sync --dry-run to check the project for drift.
 * ```
 *
 * ## Only where the project is on
 *
 * The rows are read and printed only on a repository whose provider is
 * `gh` (`./doctor-board.ts`'s runner) and whose `board.project.number`
 * is set. A repository that never opted in gets no row and sends no
 * call, so the other rows of `doctor` read as they did before these.
 *
 * ## The three rows, in order
 *
 *  1. **Scope** ({@link SCOPE_ROW}): `gh auth status --active --json
 *     hosts` read as the project step of `rafa init --board` reads it
 *     (`holdsProjectScope`, `./init-board-project.ts`). `missing` names
 *     `gh auth refresh -s project`.
 *  2. **The project** ({@link PROJECT_ROW}): the repository's owner
 *     (`gh repo view`) holds a project of that number, found through the
 *     project port (`../board/project/gh.ts`). `missing` names
 *     `rafa init --board --project`.
 *  3. **The fields** ({@link FIELDS_ROW}): the project's five fields
 *     carry the names, types and options the template has
 *     (`matchProjectFields`, `../board/project/port.ts`). `missing` names
 *     each field that does not and `board.project.template`.
 *
 * A row whose reading failed is `unknown`, saying why. A row that needs
 * the one before it, when that one is not `present`, sends nothing and
 * is `unknown` too, naming the row it waits on. With all three present,
 * one line names `rafa board sync --dry-run` as the way to check the
 * items for drift; otherwise each row not present names its own fix.
 *
 * ## Never the exit code
 *
 * The project is a mirror of the issues, never their source, so no row
 * here changes `doctor`'s exit code. A rejection of any call is an
 * `unknown` row, never a throw. Nothing is written. In json mode the
 * reading is the result's `project`, null where there are no rows.
 *
 * The three readings go through the board's runner opened retrying
 * (`../board/project/project-runner.ts`): a call that failed on a
 * network error is sent again, each retry reported to `retry.onRetry`
 * before its wait, and only a call that still fails is an `unknown` row.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Project } from '../board/project/port.js';
import type { ProjectRetryConfig, ProjectRunnerSeams } from '../board/project/project-runner.js';
import type { BoardStatusOutcome } from '../board/status.js';

import { createGhProjectPort } from '../board/project/gh.js';
import { matchProjectFields } from '../board/project/port.js';
import { openProjectRunner } from '../board/project/project-runner.js';
import { isMissingProjectScope, PROJECT_SCOPE_FIX } from '../board/project/refresh-warnings.js';
import { readBoardRepository } from '../board/repository.js';
import { isMapping, messageOf } from '../config-sections.js';

import { holdsProjectScope, PROJECT_HEADING, PROJECT_SCOPE, PROJECT_STEP_FIX, SCOPE_ARGS } from './init-board-project.js';

/** The scope row's name. */
export const SCOPE_ROW = 'project scope';

/** The project row's name, before its number. */
export const PROJECT_ROW = 'project';

/** The fields row's name. */
export const FIELDS_ROW = 'project fields';

/** The command a project in place names for its items' drift. */
export const DRIFT_CHECK = 'rafa board sync --dry-run';

/** How wide a row's outcome column is: `present`, `missing` and `unknown` are each seven. */
const OUTCOME_WIDTH = 7;

/** Which of the three rows a {@link ProjectRow} is. */
export type ProjectRowKind = 'scope' | 'project' | 'fields';

/** One row, as it was read. */
export interface ProjectRow {
  readonly kind: ProjectRowKind;
  /** What the line calls it. */
  readonly name: string;
  readonly outcome: BoardStatusOutcome;
  /** For a row not present: what was not there, or why it was not read, with the fix. The project's URL when it is. */
  readonly detail: string;
}

/** The three rows of a repository whose project is on. */
export interface DoctorProjectReading {
  /** `board.project.number`. */
  readonly number: number;
  /** Scope, project, fields, in that order. */
  readonly rows: readonly ProjectRow[];
}

/** What {@link readDoctorProject} reads with. */
export interface DoctorProjectInput {
  /** The board's runner; null for a repository whose provider is not `gh`. */
  readonly gh: GhRunner | null;
  /** `board.project.number`; null when the repository has not opted in. */
  readonly number: number | null;
  /** `board.project.template`, named by the fields row's fix. */
  readonly template: string;
  /** `board.project.retries` and `retryWaitSeconds`, the runner is opened retrying with. */
  readonly config: ProjectRetryConfig;
  /** How a retried call waits and is reported; `Bun.sleep` and the active output when left out. */
  readonly retry?: ProjectRunnerSeams;
}

function rowOf(kind: ProjectRowKind, name: string, outcome: BoardStatusOutcome, detail: string): ProjectRow {
  return { kind, name, outcome, detail };
}

/** The scope row's detail for a token without the scope. */
function noScope(): string {
  return `the gh token has no \`${PROJECT_SCOPE}\` scope; run \`${PROJECT_SCOPE_FIX}\``;
}

/** The scope row; see the module note. */
export async function readScopeRow(gh: GhRunner): Promise<ProjectRow> {
  const command = `gh ${SCOPE_ARGS.join(' ')}`;
  const result = await gh(SCOPE_ARGS);
  if (!result.ok) {
    const written = result.stderr.trim() || result.stdout.trim() || 'it wrote nothing';
    return rowOf('scope', SCOPE_ROW, 'unknown', `${command} failed: ${written}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    return rowOf('scope', SCOPE_ROW, 'unknown', `${command} wrote output that is not JSON: ${messageOf(error)}`);
  }
  const hosts = isMapping(payload)
    ? payload['hosts']
    : null;
  return holdsProjectScope(hosts)
    ? rowOf('scope', SCOPE_ROW, 'present', `the gh token holds the \`${PROJECT_SCOPE}\` scope`)
    : rowOf('scope', SCOPE_ROW, 'missing', noScope());
}

/** A row that waits on `before`, which is not present: unknown, nothing sent. */
function notRead(kind: ProjectRowKind, name: string, before: ProjectRow): ProjectRow {
  return rowOf(kind, name, 'unknown', `not read: the ${before.name} row is ${before.outcome}`);
}

/** What the project row came to, and the project the fields row reads. */
interface ProjectStep {
  readonly row: ProjectRow;
  readonly project: Project | null;
}

/** The project row: the repository's owner holds project `number`. */
async function readProjectStep(gh: GhRunner, number: number): Promise<ProjectStep> {
  const name = `${PROJECT_ROW} ${String(number)}`;
  try {
    const owner = (await readBoardRepository(gh)).split('/')[0] ?? '';
    const project = await createGhProjectPort(gh).find({ owner, number });
    if (project === null) {
      const why = `board.project.number ${String(number)} names no project of ${owner}; run \`${PROJECT_STEP_FIX}\` to make one`;
      return { row: rowOf('project', name, 'missing', why), project: null };
    }
    return { row: rowOf('project', name, 'present', project.url), project };
  } catch (error) {
    const row = isMissingProjectScope(error)
      ? rowOf('project', name, 'missing', noScope())
      : rowOf('project', name, 'unknown', messageOf(error));
    return { row, project: null };
  }
}

/** The fields row, over the project found. */
export function fieldsRow(project: Pick<Project, 'fields'>, template: string): ProjectRow {
  const { mismatched } = matchProjectFields(project);
  if (mismatched.length === 0) return rowOf('fields', FIELDS_ROW, 'present', 'the five fields carry the template\'s names and options');
  const sentences = mismatched.map((mismatch) => mismatch.sentence).join(' ');
  const skipped = mismatched.length === 1
    ? 'that field'
    : 'those fields';
  const fix = `Give the project the fields and options of board.project.template (${template}); until then the refresh skips ${skipped}.`;
  return rowOf('fields', FIELDS_ROW, 'missing', `${sentences} ${fix}`);
}

/** The rows for the repository, or null where it has none; see the module note. Never a throw. */
export async function readDoctorProject(input: DoctorProjectInput): Promise<DoctorProjectReading | null> {
  const { number, template } = input;
  if (input.gh === null || number === null) return null;
  const gh = openProjectRunner(input.gh, input.config, input.retry);
  const scope = await readScopeRow(gh);
  if (scope.outcome !== 'present') {
    const project = notRead('project', `${PROJECT_ROW} ${String(number)}`, scope);
    return { number, rows: [scope, project, notRead('fields', FIELDS_ROW, project)] };
  }
  const step = await readProjectStep(gh, number);
  const fields = step.project === null
    ? notRead('fields', FIELDS_ROW, step.row)
    : fieldsRow(step.project, template);
  return { number, rows: [scope, step.row, fields] };
}

/** One row as a line: a present row its name alone, the project's with its URL; any other with its detail. */
export function projectRowLine(row: ProjectRow): string {
  const line = `  ${row.outcome.padEnd(OUTCOME_WIDTH, ' ')}  ${row.name}`;
  if (row.outcome !== 'present') return `${line}: ${row.detail}`;
  return row.kind === 'project'
    ? `${line}: ${row.detail}`
    : line;
}

/** The lines text mode writes: `rafa init --board`'s project heading, a row each, and the drift line when all three are present. */
export function renderDoctorProject(reading: DoctorProjectReading | null): readonly string[] {
  if (reading === null) return [];
  const inPlace = reading.rows.every((row) => row.outcome === 'present');
  const drift = inPlace
    ? [`Run ${DRIFT_CHECK} to check the project for drift.`]
    : [];
  return [PROJECT_HEADING, ...reading.rows.map(projectRowLine), ...drift];
}
