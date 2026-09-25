/**
 * Lessons: the findings of a recorded task report that say what resolves
 * them, as the `task-report` payload the loop pushes to the Learning port.
 *
 * {@link reportLessons} takes what `recordTaskReport` answered, the
 * dispatch and the loop's outcome it was recorded under, and the time.
 * Each finding that carries a `resolution` becomes one instinct record,
 * in the report's order; a finding without one stays a finding only and
 * becomes nothing here. An output with no report, or a report with no
 * such finding, answers null, so there is nothing to push.
 *
 * ## What a lesson holds
 *
 * The record is the port's `InstinctRecord` with the `.md` form's other
 * fields under `description`, the shape the `local` adapter reads
 * (`DescribedInstinctRecord`), because a lesson on a trigger nothing
 * holds is written from them:
 *
 *   - `trigger`, `kind`, `signal` and `artifact` are the finding's, as
 *     written; an absent artifact is left out.
 *   - `action` is the `resolution`, and `action_hash` its
 *     {@link actionHash}.
 *   - `domain` is the finding's, or {@link DEFAULT_LESSON_DOMAIN} when
 *     it gave none.
 *   - `cause` is the finding's `cause`, or its `what` when it gave no
 *     cause. The schema refuses a record whose Cause section is empty,
 *     and the adapter refuses a push whose file would not read back, so
 *     a lesson with no cause at all could never be held; the `what` is
 *     the observation the resolution answers, which is what the section
 *     says.
 *   - `confidence` is {@link LESSON_CONFIDENCE}, or
 *     {@link BLOCKED_LESSON_CONFIDENCE} when the loop's outcome is
 *     `blocked`. The outcome is the loop's, not the report's claim; a
 *     `failed` task's lesson takes the ordinary confidence.
 *   - `evidence` is one entry of `plan`, `task`, `session` and
 *     `outcome`, the dispatch's plan stub, task line and session id and
 *     the loop's outcome. A dispatch that resolved no plan leaves `plan`
 *     out, since an evidence value is a scalar and null is not one.
 *   - `scope` is `project`, `source` is `task-report`, and `projectId`
 *     is null: nothing in a dispatch names the project's remote.
 *   - `usage_count` is 1 and `sources` the session id alone, the one
 *     source that confirmed it; `status` is `active`, and `created_at`
 *     and `updated_at` are both `now`.
 *
 * The payload's `source_id` is the session id, so two tasks of one plan
 * are two sources and a session pushing its lessons again counts once.
 *
 * A finding the parser left without a `trigger`, `kind` or `signal`, or
 * with neither a `cause` nor a `what`, is skipped: no record the schema
 * accepts can be made of it, and the parser already reported the field
 * as an issue, which `describeTaskReportRecord` warns about.
 *
 * ## The id
 *
 * {@link lessonId} is the trigger as a slug, cut to
 * {@link LESSON_SLUG_LENGTH} characters, then a hyphen and the first
 * {@link LESSON_HASH_LENGTH} hex digits of the sha256 of the trigger's
 * {@link triggerKey} and the action hash. It depends on nothing but the
 * trigger and the action, so the same lesson from two sessions carries
 * one id and the merge collapses it, while two actions on one trigger
 * carry two ids and are held side by side when the merge flags them. A
 * trigger with no letter or digit in it takes {@link LESSON_ID_FALLBACK}
 * as its slug.
 *
 * Nothing here opens a file, reads a clock or changes a value passed in.
 */
import type { ReportFinding } from './parse.js';
import type { TaskReportInput, TaskReportRecord } from './record.js';
import type { DescribedInstinctRecord } from '../adapters/learning/local.js';
import type { SyncPayload } from '../learning/index.js';
import type { InstinctDomain, InstinctEvidence } from '../schema/instinct.js';

import { createHash } from 'node:crypto';

import { slugifyId } from '../demote/classify.js';
import { actionHash, triggerKey } from '../learning/index.js';

/** A lesson's confidence when its task did not end blocked. */
export const LESSON_CONFIDENCE = 0.5;

/** A lesson's confidence when the loop's outcome for its task is `blocked`. */
export const BLOCKED_LESSON_CONFIDENCE = 0.4;

/** The domain of a lesson whose finding gave none. */
export const DEFAULT_LESSON_DOMAIN: InstinctDomain = 'workflow';

/** The longest the trigger's slug in a {@link lessonId} runs. */
export const LESSON_SLUG_LENGTH = 48;

/** How many hex digits of the identity hash a {@link lessonId} ends with. */
export const LESSON_HASH_LENGTH = 8;

/** The slug of a trigger that has no letter or digit in it. */
export const LESSON_ID_FALLBACK = 'lesson';

/** What {@link reportLessons} needs besides the record: where it came from. */
export type LessonContext = Pick<TaskReportInput, 'dispatch' | 'outcome'>;

/**
 * The id a lesson on `trigger` with `action` is filed under. See the
 * module note.
 */
export function lessonId(trigger: string, action: string): string {
  const slug = slugifyId(trigger).slice(0, LESSON_SLUG_LENGTH)
    .replace(/-+$/, '');
  const digest = createHash('sha256')
    .update(`${triggerKey(trigger)}\n${actionHash(action)}`)
    .digest('hex')
    .slice(0, LESSON_HASH_LENGTH);
  return `${slug === ''
    ? LESSON_ID_FALLBACK
    : slug}-${digest}`;
}

/** The one evidence entry every lesson of a dispatch carries. */
function lessonEvidence(context: LessonContext): InstinctEvidence {
  const { dispatch, outcome } = context;
  return {
    ...dispatch.planStub === null
      ? {}
      : { plan: dispatch.planStub },
    task: dispatch.taskLine,
    session: dispatch.sessionId,
    outcome,
  };
}

/** `finding` as a lesson, or null when it carries none or cannot make one. */
function toLesson(
  finding: ReportFinding,
  context: LessonContext,
  at: string,
): DescribedInstinctRecord | null {
  const { trigger, kind, signal, resolution, artifact } = finding;
  const cause = finding.cause ?? finding.what;
  if (resolution === null || trigger === null || kind === null || signal === null) return null;
  if (cause === null) return null;

  const { sessionId } = context.dispatch;
  return {
    id: lessonId(trigger, resolution),
    trigger,
    action: resolution,
    action_hash: actionHash(resolution),
    confidence: context.outcome === 'blocked'
      ? BLOCKED_LESSON_CONFIDENCE
      : LESSON_CONFIDENCE,
    usage_count: 1,
    sources: [sessionId],
    ...artifact === null
      ? {}
      : { artifact },
    signal,
    status: 'active',
    created_at: at,
    updated_at: at,
    description: {
      kind,
      domain: finding.domain ?? DEFAULT_LESSON_DOMAIN,
      scope: 'project',
      source: 'task-report',
      evidence: [lessonEvidence(context)],
      cause,
      projectId: null,
    },
  };
}

/**
 * The lessons in `record`, as the payload its session pushes, or null
 * when it holds none. See the module note.
 *
 * @param record - what `recordTaskReport` answered for the session.
 * @param context - the dispatch and outcome it was recorded under.
 * @param now - the time each lesson is created at.
 * @returns a new payload whose `source_id` is the session id, or null.
 */
export function reportLessons(
  record: TaskReportRecord,
  context: LessonContext,
  now: Date,
): SyncPayload | null {
  if (!record.present) return null;

  const at = now.toISOString();
  const instincts = record.reading.report.findings
    .map((finding) => toLesson(finding, context, at))
    .filter((lesson) => lesson !== null);
  return instincts.length === 0
    ? null
    : { source_id: context.dispatch.sessionId, instincts };
}
