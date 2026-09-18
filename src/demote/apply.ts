/**
 * The demotion pass's second half: what a reviewed report says is to
 * become of each file, checked in full before one byte moves, and then
 * carried out.
 *
 * The pass is deliberately two calls rather than one loop.
 * {@link planDemotion} reads every file the report names, hashes it
 * against its row, converts every observation-shaped one and runs
 * `checkFile` over the record that conversion produced — all of it
 * against a temporary directory nobody else can see — and answers one
 * {@link DemotionAction} per row saying what it WOULD do.
 * {@link applyDemotion} then does it. So "with instincts checked
 * before they are written" is structural: a record that fails the
 * checker never reaches `<base>/.rafa/instincts`, because the planner
 * turned its row into a refusal and the applier is handed no write for
 * it.
 *
 * ## Why a refusal is one row and not the run
 *
 * `status: draft` refuses the whole run and is the command's rule, not
 * this module's: an unreviewed report is one decision, taken once. The
 * three refusals HERE — a file whose hash differs from its row, a file
 * that is gone, and a record the checker fails — are each about one
 * file, and 124 rows reviewed by a person is too much work to throw
 * away because the 61st skill was edited in another window. So a
 * refused row is skipped, named in the output, and counted into the
 * exit code, and every other row is applied.
 *
 * This is safe because the pass is idempotent (below): the fix for a
 * refused row is to re-run the write, re-review that row and apply
 * again, and the rows that already moved are then `done` rather than
 * moved twice.
 *
 * ## The four things that happen to a row
 *
 *   - `demoted` — an observation. Its record is written to
 *     `<base>/.rafa/instincts/<id>.md` and the original is moved to
 *     `<base>/.rafa/demoted/<path>`, at its path relative to the skills
 *     directory, so a wrong verdict is a `mv` back.
 *   - `kept` — a procedure, which stays a skill. A `<name>/SKILL.md`
 *     is left exactly where it is. A `learned/<name>.md` is moved to
 *     `<dir>/<name>/SKILL.md`, because the flat grouped layout it sits
 *     in registers nothing: keeping it as a skill means putting it in
 *     the shape a skill is loaded from.
 *   - `left` — an unclassified row the review did not decide. Untouched,
 *     and not a refusal: deciding it is the reviewer's job and the pass
 *     has no opinion to act on.
 *   - `done` — a row this report already applied. See below.
 *
 * ## The second `--apply` changes nothing
 *
 * An applied row's file is no longer where the report says it is. That
 * is indistinguishable from a file someone deleted, so the planner asks
 * where the row WOULD have moved it: a `demoted` row whose original now
 * sits under `.rafa/demoted/` with the row's own hash, and a `kept`
 * `learned/` row whose file now sits at `<dir>/<name>/SKILL.md` with
 * the row's own hash, are `done` — the hash is what tells the two apart,
 * and a file that is gone with nothing matching at the destination is a
 * refusal rather than a shrug.
 *
 * ## The checker runs with no project root
 *
 * `rafa instinct check <dir>` declares no `--project` at all, so every
 * run of it resolves a body's paths against no project and counts a
 * project-looking path as `unchecked-path`, a warning. The check here
 * is made the same way, so "the record passed the check before it was
 * written" and "the record passes `rafa instinct check`" are the same
 * sentence. A record whose body names a path that does not exist is
 * therefore written, with a warning nobody sees: the body is prose
 * lifted out of a skill, and gating the pass on the paths that prose
 * names would refuse rows for a reason the review cannot fix.
 *
 * ## The order of the two writes
 *
 * A demoted row writes its record first and moves its original second.
 * Both are local filesystem calls that fail only when the disk does,
 * and the order is the one that loses nothing if the second never
 * happens: the record is recoverable from the original, and the
 * original is recoverable from nothing.
 */
import type { DemotionVerdict } from './classify.js';
import type { DemotionReport, DemotionReportRow } from './report.js';
import type { DemotionScope, SelectedFile } from './select.js';
import type { CheckIssue } from '../check/run.js';

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { MARKDOWN_EXTENSION, SKILL_FILE } from '../check/layout.js';
import { checkFile } from '../check/run.js';

import { convertToInstinct, LEARNED_DIRECTORY } from './classify.js';
import { effectiveVerdict, sourceHash } from './report.js';

/** What `--apply` did with one row. */
export type DemotionActionKind = 'demoted' | 'kept' | 'left' | 'done' | 'refused';

/** Every kind, in the order the summary counts them. */
export const DEMOTION_ACTION_KINDS: readonly DemotionActionKind[] = [
  'demoted',
  'kept',
  'left',
  'done',
  'refused',
];

/** A file `--apply` creates. */
export interface PlannedWrite {
  /** Where it goes, absolute. */
  readonly path: string;
  /** Its whole text. */
  readonly text: string;
}

/** A file `--apply` moves, keeping its bytes. */
export interface PlannedMove {
  /** Where it is now, absolute. */
  readonly from: string;
  /** Where it goes, absolute. */
  readonly to: string;
}

/** One row, and what is to become of the file it names. */
export interface DemotionAction {
  /** The file, relative to the skills directory, as the row spells it. */
  readonly path: string;
  /** The verdict applied: the row's override where it has one. */
  readonly verdict: DemotionVerdict;
  /** What happens to it. */
  readonly kind: DemotionActionKind;
  /** One line a caller prints unedited, saying why. */
  readonly detail: string;
  /** The record's id for a `demoted` row, null for every other kind. */
  readonly instinctId: string | null;
  /** The record to write, or null when the row writes nothing. */
  readonly write: PlannedWrite | null;
  /** The original to move, or null when the row moves nothing. */
  readonly move: PlannedMove | null;
}

/** Every row planned, with the counts a caller reports. */
export interface DemotionPlan {
  /** The scope it was planned against. */
  readonly scope: DemotionScope;
  /** One action per row, in report order. */
  readonly actions: readonly DemotionAction[];
  /** How many rows came to each kind, kinds with none at 0. */
  readonly counts: Readonly<Record<DemotionActionKind, number>>;
}

/** What the planner reads the world through beyond the filesystem. */
export interface DemotionApplySeams {
  /** The instant the records are filed at, an ISO 8601 instant. */
  readonly now: () => string;
  /** The directories a fenced command name is looked up in, for the checker. */
  readonly pathDirs: readonly string[];
}

/** The seams a run uses when the caller names none. */
export const DEFAULT_APPLY_SEAMS: DemotionApplySeams = Object.freeze({
  now: () => new Date().toISOString(),
  pathDirs: [],
});

/** Whether `path` names a `learned/<name>.md` file. */
export function isLearnedPath(path: string): boolean {
  const segments = path.split('/');
  return segments.length === 2
    && segments[0] === LEARNED_DIRECTORY
    && (segments[1] ?? '').endsWith(MARKDOWN_EXTENSION);
}

/** The skill name a `learned/<name>.md` would register as. */
export function learnedSkillName(path: string): string {
  const base = path.split('/').at(-1) ?? '';
  return base.slice(0, -MARKDOWN_EXTENSION.length);
}

/** Where a row's file sits now, absolute. */
export function sourcePath(scope: DemotionScope, path: string): string {
  return join(scope.dir, ...path.split('/'));
}

/** Where a demoted row's original is kept, absolute. */
export function demotedPath(scope: DemotionScope, path: string): string {
  return join(scope.demotedDir, ...path.split('/'));
}

/** Where a `learned/` row kept as a skill goes, absolute. */
export function promotedPath(scope: DemotionScope, path: string): string {
  return join(scope.dir, learnedSkillName(path), SKILL_FILE);
}

/** The ids the scope's instincts directory already holds. */
export function takenInstinctIds(dir: string): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith('.') && name.endsWith(MARKDOWN_EXTENSION) && name !== MARKDOWN_EXTENSION)
    .map((name) => name.slice(0, -MARKDOWN_EXTENSION.length))
    .sort((left, right) => left.localeCompare(right));
}

/** `path`'s text, or null when nothing readable sits there. */
function readText(path: string): string | null {
  try {
    return statSync(path).isFile()
      ? readFileSync(path, 'utf8')
      : null;
  } catch {
    return null;
  }
}

/** An action with everything a kind that does nothing leaves null. */
function inert(
  path: string,
  verdict: DemotionVerdict,
  kind: DemotionActionKind,
  detail: string,
): DemotionAction {
  return { path, verdict, kind, detail, instinctId: null, write: null, move: null };
}

/** The failures of a check report, each as one line. */
function failureLines(issues: readonly CheckIssue[]): readonly string[] {
  return issues
    .filter((issue) => issue.severity === 'failure')
    .map((issue) => `${issue.stage} ${issue.code}: ${issue.message}`);
}

/**
 * Whether a row that has already been applied is `done`: its file is
 * gone and the file it would have been moved to holds the row's own
 * bytes. See the module note.
 */
function alreadyApplied(scope: DemotionScope, row: DemotionReportRow, verdict: DemotionVerdict): boolean {
  const destination = verdict === 'observation'
    ? demotedPath(scope, row.path)
    : promotedPath(scope, row.path);
  const text = readText(destination);
  return text !== null && sourceHash(text) === row.hash;
}

/** A row whose file is not where the report says it is. */
function missingSource(scope: DemotionScope, row: DemotionReportRow, verdict: DemotionVerdict): DemotionAction {
  const movable = verdict === 'observation' || (verdict === 'procedure' && isLearnedPath(row.path));
  if (movable && alreadyApplied(scope, row, verdict)) {
    return inert(row.path, verdict, 'done', 'already applied: the file is at its destination, unchanged');
  }
  return inert(
    row.path,
    verdict,
    'refused',
    'the file the row names is gone, and nothing matching its hash is where the row would have put it',
  );
}

/** A procedure row: the skill stays a skill, and a `learned/` one moves into the shape that registers. */
function planKept(scope: DemotionScope, row: DemotionReportRow, file: SelectedFile): DemotionAction {
  if (!isLearnedPath(row.path)) {
    return inert(row.path, 'procedure', 'kept', 'procedure-shaped: left where it is, for the backfill');
  }

  const to = promotedPath(scope, row.path);
  if (existsSync(to) || existsSync(dirname(to))) {
    return inert(row.path, 'procedure', 'refused', `kept as a skill, but ${to} is already there`);
  }
  return {
    path: row.path,
    verdict: 'procedure',
    kind: 'kept',
    detail: `procedure-shaped: moved to ${to}, the layout that registers`,
    instinctId: null,
    write: null,
    move: { from: file.absolute, to },
  };
}

/** Where a candidate record is written to be checked, and checked. */
function checkCandidate(dir: string, id: string, text: string, pathDirs: readonly string[]): readonly string[] {
  const path = join(dir, `${id}${MARKDOWN_EXTENSION}`);
  writeFileSync(path, text, 'utf8');
  const report = checkFile(path, 'instinct', { projectRoot: null, pathDirs });
  return failureLines(report.issues);
}

/** An observation row: the record, checked, and the original's move. */
function planDemoted(
  scope: DemotionScope,
  row: DemotionReportRow,
  file: SelectedFile,
  context: { readonly temp: string; readonly taken: string[]; readonly seams: DemotionApplySeams },
): DemotionAction {
  const conversion = convertToInstinct(file, {
    scope: scope.scope,
    takenIds: context.taken,
    now: context.seams.now(),
    mtime: file.mtime,
  });
  if (conversion.instinct === null || conversion.text === null) {
    const reasons = conversion.issues.map((issue) => `${issue.code}: ${issue.message}`);
    return inert(row.path, 'observation', 'refused', `the record the file converts to is refused — ${reasons.join('; ')}`);
  }

  const id = conversion.instinct.id;
  const failures = checkCandidate(context.temp, id, conversion.text, context.seams.pathDirs);
  if (failures.length > 0) {
    return inert(row.path, 'observation', 'refused', `the record ${id} fails the checker — ${failures.join('; ')}`);
  }

  const destination = join(scope.instinctsDir, `${id}${MARKDOWN_EXTENSION}`);
  const kept = demotedPath(scope, row.path);
  if (existsSync(destination)) return inert(row.path, 'observation', 'refused', `${destination} is already there`);
  if (existsSync(kept)) return inert(row.path, 'observation', 'refused', `${kept} is already there`);

  context.taken.push(id);
  return {
    path: row.path,
    verdict: 'observation',
    kind: 'demoted',
    detail: `demoted to ${destination}, the original kept at ${kept}`,
    instinctId: id,
    write: { path: destination, text: conversion.text },
    move: { from: file.absolute, to: kept },
  };
}

/** One row planned, with its file read and hashed. See the module note. */
function planRow(
  scope: DemotionScope,
  row: DemotionReportRow,
  context: { readonly temp: string; readonly taken: string[]; readonly seams: DemotionApplySeams },
): DemotionAction {
  const verdict = effectiveVerdict(row);
  const absolute = sourcePath(scope, row.path);
  const text = readText(absolute);
  if (text === null) return missingSource(scope, row, verdict);

  const hash = sourceHash(text);
  if (hash !== row.hash) {
    return inert(
      row.path,
      verdict,
      'refused',
      `the file changed since the report was written (row ${row.hash.slice(0, 12)}, file ${hash.slice(0, 12)})`,
    );
  }

  if (verdict === 'unclassified') {
    return inert(row.path, verdict, 'left', 'unclassified and not decided by the review: left untouched');
  }

  const file: SelectedFile = {
    path: row.path,
    text,
    entries: undefined,
    absolute,
    hash,
    mtime: statSync(absolute).mtime.toISOString(),
  };
  return verdict === 'procedure'
    ? planKept(scope, row, file)
    : planDemoted(scope, row, file, context);
}

/** How many actions came to each kind. */
export function countActions(
  actions: readonly DemotionAction[],
): Readonly<Record<DemotionActionKind, number>> {
  const counts = Object.fromEntries(
    DEMOTION_ACTION_KINDS.map((kind) => [kind, 0]),
  ) as Record<DemotionActionKind, number>;

  for (const action of actions) counts[action.kind] += 1;
  return counts;
}

/**
 * What `--apply` would do to every row of `report`, with every record
 * converted and checked and not one byte written outside a temporary
 * directory this call removes. See the module note.
 */
export function planDemotion(
  report: DemotionReport,
  scope: DemotionScope,
  seams: DemotionApplySeams = DEFAULT_APPLY_SEAMS,
): DemotionPlan {
  const temp = mkdtempSync(join(tmpdir(), 'rafa-demote-'));
  const taken = [...takenInstinctIds(scope.instinctsDir)];

  try {
    const actions = report.rows.map((row) => planRow(scope, row, { temp, taken, seams }));
    return { scope, actions, counts: countActions(actions) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** `move`, by rename where the two sit on one filesystem and by copy where they do not. */
function moveFile(move: PlannedMove): void {
  mkdirSync(dirname(move.to), { recursive: true });
  try {
    renameSync(move.from, move.to);
  } catch {
    copyFileSync(move.from, move.to);
    unlinkSync(move.from);
  }
}

/**
 * Carries out `plan`: every record it planned, then every move it
 * planned. A refused, left, kept-in-place or already-applied row
 * carries neither, so this walks the whole plan and touches only the
 * rows that have something to do.
 */
export function applyDemotion(plan: DemotionPlan): void {
  for (const action of plan.actions) {
    if (action.write !== null) {
      mkdirSync(dirname(action.write.path), { recursive: true });
      writeFileSync(action.write.path, action.write.text, 'utf8');
    }
    if (action.move !== null) moveFile(action.move);
  }
}
