/**
 * What more than one `issue` declarations file spells: the subject the
 * nine commands sit under, and the state, type and priority lists their
 * help names.
 *
 * ## Why this file sits apart
 *
 * `declarations.ts` re-exports `declarations-create.ts`, and
 * `declarations-create.ts` spells the subject and two of these lists. Held
 * in `declarations.ts`, they would close an import cycle between the two,
 * and the file a cycle reaches first would read a binding before it is
 * set (`ReferenceError: Cannot access … before initialization`). Both
 * import them from here, and `declarations.ts` re-exports them, so its
 * importers read them where they always did.
 *
 * ## What this file imports
 *
 * Types from `@open-tomato/rafa/core/command` alone, and no module under
 * `src/`, for the reason `declarations.ts` gives; `declarations.test.ts`
 * reads this file's imports and holds that.
 *
 * The three lists are copies of `ISSUE_STATES`, `ISSUE_TYPES` and
 * `ISSUE_PRIORITIES`
 * (`packages/rafa-board/src/adapters/tracker/issue-values.ts`), which
 * `declarations-integration.test.ts` holds equal to their sources.
 */
import type { SubjectSpec } from '@open-tomato/rafa/core/command';

/** The `issue` subject: its routing word and its roster line. */
export const ISSUE_SUBJECT: SubjectSpec = Object.freeze({
  name: 'issue',
  summary: 'the tracker: list, show, create, edit, comment on and move issues; mark one ready, unblock it and check its references',
});

/** Every issue state, in lifecycle order: a copy of `ISSUE_STATES`; see the module note. */
export const ISSUE_STATE_WORDS: readonly string[] = Object.freeze([
  'backlog',
  'todo',
  'in-progress',
  'in-review',
  'done',
  'released',
  'cancelled',
]);

/** Every issue type, `epic` and `spec` last: a copy of `ISSUE_TYPES`; see the module note. */
export const ISSUE_TYPE_WORDS: readonly string[] = Object.freeze([
  'code',
  'bug',
  'spike',
  'adr',
  'chore',
  'package-api',
  'epic',
  'spec',
]);

/** Every priority, most urgent first: a copy of `ISSUE_PRIORITIES`; see the module note. */
export const ISSUE_PRIORITY_WORDS: readonly string[] = Object.freeze([
  'urgent',
  'high',
  'medium',
  'low',
]);
