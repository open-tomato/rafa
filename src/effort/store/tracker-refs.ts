/**
 * The tracker reference writer and reader: the reference a filed issue
 * got, kept in the `findings` row keyed by the bug's artifact, and
 * answered back for an artifact.
 *
 * Phase 1's triage files an out-of-scope bug through the Tracker port,
 * and a recurrence of its artifact in a later task comments on that
 * issue rather than filing a second one. {@link writeTrackerRef} stores
 * the reference `tracker.create` answered, and {@link readTrackerRef}
 * answers it for the artifact a later bug carries. The column is
 * `findings.tracker_ref`, which the findings writer leaves null.
 *
 * ## The row
 *
 * A findings row with an artifact is keyed by its session and that
 * artifact, so a reference goes into the row the dispatch's session holds
 * under the bug's artifact:
 *
 *   - The session holds none: one is inserted, carrying the dispatch,
 *     the outcome, the artifact and the reference, with a generated id,
 *     the write's time, and every report column (`kind`, `trigger`,
 *     `what`, `cause`, `resolution`, `signal`) null. The bug itself stays
 *     in `out_of_scope_bugs`, which joins on `session_id` and `artifact`.
 *   - It holds one with no reference, such as the finding the session
 *     reported under that artifact: the reference is set on it, and no
 *     other column changes.
 *   - It holds one with the same reference: nothing is written.
 *   - It holds one with another reference: that one is kept, nothing is
 *     written, and the write answers `conflict` with the reference kept.
 *     One artifact files one issue, so a second reference means a second
 *     issue for the caller to surface, and an overwrite would lose the
 *     first.
 *
 * The artifact matches byte for byte, as in the findings writer's dedupe.
 * A bug with no artifact has no recurrence key (roadmap Q18) and stores
 * no reference, so a write without one is refused. The lookup and the
 * write it decides run in one `BEGIN IMMEDIATE` transaction, so another
 * process cannot insert the row between them. Measured, a write throws
 * `database is locked` while another connection holds the write lock,
 * even one that finds its reference already held.
 *
 * ## What an inserted row does to the table's other readers
 *
 *   - A finding written AFTER a reference, under the same session and
 *     artifact, is not stored: `writeFindings` skips it as that row's
 *     duplicate, and its fields are lost. Measured, its write answers 0
 *     appended and 1 skipped. A report's findings go in first.
 *   - `progress.txt` renders an inserted row as it renders a finding,
 *     measured as the one bullet `- artifact: <artifact>`.
 *
 * ## The reference, as stored
 *
 * `tracker_ref` holds the `IssueRef` as JSON with its fields in one
 * order: `opt`, `kind`, `externalId`, `url`, then `module` and `repo`
 * when the reference carries them. `warning` is left out, since it
 * reports a step that failed while filing rather than where the issue
 * lives. A key the port does not name is left out as well, from a
 * reference read back as from one written. Two references are the same
 * when that JSON is, so a reference answered by a read and written again
 * is held, whatever order its keys arrived in.
 *
 * `JSON.stringify` escapes a lone UTF-16 surrogate, so a reference
 * holding one is stored as ASCII and answered back unchanged, measured.
 * The artifact is bound as text, and is refused with one, as a findings
 * key is (`sqlite.ts` says why).
 *
 * ## The lookup
 *
 * {@link readTrackerRef} answers the OLDEST reference stored under the
 * artifact, by `seq`, in any session and under any plan stub, or null
 * when no row holds one. The oldest is the issue the first sighting
 * filed. It opens and creates nothing when the store file does not
 * exist. Every row answers the lookup, so a reference no public lookup
 * may see, a `security: true` bug's, never belongs in this table.
 *
 * A stored reference that is not one, written from outside, throws,
 * naming its row, whether a read or a write reaches it.
 *
 * ## What is refused
 *
 * A write throws before the store is opened, leaving no file behind and
 * no byte of one changed, when its dispatch or outcome fails the findings
 * writer's `checkDispatch`, when its artifact is missing, not a string,
 * blank or holds a lone surrogate, or when its reference is not an
 * `IssueRef`: `opt` a safe integer, `kind` and `externalId` non-blank
 * strings, `url` a string or null, `module` and `repo` strings when
 * present. A read refuses its artifact by the same rule, opening nothing.
 * Both throw the store's refusal of a schema past this rafa's version
 * with no byte changed, and bring an older store forward first.
 *
 * The write always has its one row to place, so it opens the store with
 * `withSqliteStore`, creating it when absent, as `absences.ts` does.
 */
import type { FindingOutcome, FindingsDispatch, FindingsWriterSeams } from './findings.js';
import type { IssueRef } from '../../ports/index.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { sqliteStorePath, withSqliteStore } from './sqlite.js';

/** One write: a filed issue's reference, the artifact it is kept under, and its dispatch. */
export interface TrackerRefWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** The filed bug's artifact, the recurrence key. */
  readonly artifact: string;
  /** What the tracker answered for the filed issue. */
  readonly ref: IssueRef;
}

/** What one write did to the session's row for the artifact. */
export type TrackerRefWriteAction =
  /** The session held no row for the artifact; one now holds the reference. */
  | 'inserted'
  /** The session's row held no reference; it now holds this one. */
  | 'attached'
  /** The row already held this reference; nothing was written. */
  | 'held'
  /** The row already held another reference, which is kept; nothing was written. */
  | 'conflict';

/** What one write did. */
export interface TrackerRefWriteResult {
  /** The store's file. */
  readonly path: string;
  readonly action: TrackerRefWriteAction;
  /** The reference the row holds once the write returns, in the stored form. */
  readonly stored: IssueRef;
}

/** The session's row for an artifact, as the write looks it up. */
interface HeldRow {
  readonly seq: number;
  readonly tracker_ref: string | null;
}

/** A reference in its stored form, with the JSON it is stored as. */
interface StoredRef {
  readonly ref: IssueRef;
  readonly json: string;
}

/** A column value, as it is bound. */
type Bound = string | null;

/** The row the session holds for an artifact. The partial unique index allows one. */
const SELECT_HELD = `
  SELECT seq, tracker_ref FROM findings
  WHERE session_id = ? AND artifact = ?
`;

/** A row holding only the dispatch, the artifact and the reference. */
const INSERT_REF = `
  INSERT INTO findings (
    id, session_id, plan_stub, task_line,
    artifact,
    outcome, tracker_ref, collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

/** The reference, set on a row that holds none. */
const ATTACH_REF = 'UPDATE findings SET tracker_ref = ? WHERE seq = ? AND tracker_ref IS NULL';

/** The oldest row holding a reference under an artifact. */
const SELECT_OLDEST = `
  SELECT seq, tracker_ref FROM findings
  WHERE artifact = ? AND tracker_ref IS NOT NULL
  ORDER BY seq
  LIMIT 1
`;

/** What a refusal ends with, by the call it refuses. */
const REFUSAL_TAILS = { write: 'nothing written', read: 'nothing opened' } as const;

/** A refusal thrown before the store is opened. */
function refused(call: keyof typeof REFUSAL_TAILS, reason: string): Error {
  return new Error(`effort store: tracker ref ${call} ${reason}; ${REFUSAL_TAILS[call]}`);
}

/** Throws unless an artifact can key a reference. */
function checkArtifact(call: keyof typeof REFUSAL_TAILS, artifact: unknown): void {
  if (artifact === null || artifact === undefined) {
    throw refused(call, 'has no artifact, the key a reference is kept under');
  }
  const problem = textProblem(artifact);
  if (problem !== null) throw refused(call, `has an artifact that ${problem}`);
}

/** Why a reference field's value cannot be stored, or null when it can. */
type RefFieldCheck = (value: unknown) => string | null;

/** A string with something in it. */
function nonBlankText(value: unknown): string | null {
  if (typeof value !== 'string') return `is ${describeValue(value)}, not a string`;
  return value.trim().length === 0
    ? 'is blank'
    : null;
}

/** A string, or null. */
function textOrNull(value: unknown): string | null {
  return value === null || typeof value === 'string'
    ? null
    : `is ${describeValue(value)}, not a string or null`;
}

/** A string, or absent. */
function optionalText(value: unknown): string | null {
  return value === undefined || typeof value === 'string'
    ? null
    : `is ${describeValue(value)}, not a string`;
}

/** A whole number a double holds exactly. */
function safeInteger(value: unknown): string | null {
  return Number.isSafeInteger(value)
    ? null
    : `is ${describeValue(value)}, not a safe integer`;
}

/** Each stored field's check, in the stored order. */
const REF_FIELDS: readonly (readonly [keyof IssueRef, RefFieldCheck])[] = [
  ['opt', safeInteger],
  ['kind', nonBlankText],
  ['externalId', nonBlankText],
  ['url', textOrNull],
  ['module', optionalText],
  ['repo', optionalText],
];

/**
 * A value as a stored reference, or why it is not one, worded to follow
 * "a reference" or "a tracker_ref".
 */
function storedRefOf(value: unknown): StoredRef | string {
  if (Array.isArray(value)) return 'that is an array, not an object';
  if (typeof value !== 'object' || value === null) {
    return `that is ${describeValue(value)}, not an object`;
  }

  const fields = value as Readonly<Record<string, unknown>>;
  for (const [field, check] of REF_FIELDS) {
    const problem = check(fields[field]);
    if (problem !== null) return `whose ${field} ${problem}`;
  }

  const ref: IssueRef = {
    opt: fields.opt as number,
    kind: fields.kind as string,
    externalId: fields.externalId as string,
    url: fields.url as string | null,
  };
  if (typeof fields.module === 'string') ref.module = fields.module;
  if (typeof fields.repo === 'string') ref.repo = fields.repo;
  return { ref, json: JSON.stringify(ref) };
}

/** The reference one stored row holds. Throws, naming the row, when it holds none. */
function heldRefOf(path: string, seq: number, text: string): StoredRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const stored = parsed === undefined
    ? 'that is not JSON'
    : storedRefOf(parsed);
  if (typeof stored !== 'string') return stored;

  throw new Error(
    `effort store: ${path}: findings row ${seq} holds a tracker_ref ${stored};`
      + ' no writer stores one',
  );
}

/**
 * Looks up the session's row for the artifact and places the reference
 * on it, inserting the row when there is none. Runs inside the write's
 * transaction.
 */
function placeRef(
  db: Database,
  path: string,
  write: TrackerRefWrite,
  wanted: StoredRef,
  insertValues: () => Bound[],
): readonly [TrackerRefWriteAction, IssueRef] {
  const held = db
    .query<HeldRow, [string, string]>(SELECT_HELD)
    .get(write.dispatch.sessionId, write.artifact);
  if (held === null) {
    db.query<unknown, Bound[]>(INSERT_REF).run(...insertValues());
    return ['inserted', wanted.ref];
  }
  if (held.tracker_ref === null) {
    db.query<unknown, [string, number]>(ATTACH_REF).run(wanted.json, held.seq);
    return ['attached', wanted.ref];
  }

  const kept = heldRefOf(path, held.seq, held.tracker_ref);
  return kept.json === wanted.json
    ? ['held', kept.ref]
    : ['conflict', kept.ref];
}

/**
 * Keeps a filed issue's reference in the findings row the dispatch's
 * session holds under the artifact, inserting that row when there is
 * none, and answers what it did.
 *
 * Throws, having opened nothing, when the dispatch, the outcome, the
 * artifact or the reference cannot be stored. Throws the store's own
 * refusal of a schema past this rafa's version, and on a row holding a
 * stored reference that is not one. See the module note.
 */
export function writeTrackerRef(
  repoRoot: string,
  write: TrackerRefWrite,
  seams: FindingsWriterSeams = {},
): TrackerRefWriteResult {
  checkDispatch('tracker ref', write.dispatch, write.outcome);
  checkArtifact('write', write.artifact);
  const wanted = storedRefOf(write.ref);
  if (typeof wanted === 'string') throw refused('write', `has a reference ${wanted}`);
  const path = sqliteStorePath(repoRoot);

  const { sessionId, planStub, taskLine } = write.dispatch;
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const insertValues = (): Bound[] => [
    newId(), sessionId, planStub, taskLine,
    write.artifact,
    write.outcome, wanted.json, collectedAt,
  ];

  const [action, stored] = withSqliteStore(path, !existsSync(path), (db) => {
    const place = db.transaction(() => placeRef(db, path, write, wanted, insertValues));
    return place.immediate();
  });
  return { path, action, stored };
}

/**
 * The oldest reference stored under an artifact, in the stored form, or
 * null when no row holds one or the store does not exist.
 *
 * Throws, having opened nothing, on an artifact that cannot key a
 * reference. Throws the store's own refusal of a schema past this rafa's
 * version, and on a stored reference that is not one. See the module
 * note.
 */
export function readTrackerRef(repoRoot: string, artifact: string): IssueRef | null {
  checkArtifact('read', artifact);
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return null;

  const oldest = withSqliteStore(path, false, (db) => db
    .query<{ seq: number; tracker_ref: string }, [string]>(SELECT_OLDEST)
    .get(artifact));
  return oldest === null
    ? null
    : heldRefOf(path, oldest.seq, oldest.tracker_ref).ref;
}
