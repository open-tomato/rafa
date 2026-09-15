/**
 * The Tracker port's closed unions, as lists a module can read at run
 * time.
 *
 * `src/ports/index.ts` exports types and no value, so it spells
 * `IssueType`, `IssuePriority` and `IssueState` as literal unions and
 * leaves out the `as const` tuples they were derived from:
 * `ISSUE_TYPES`, `ISSUE_PRIORITIES` and `ISSUE_STATES` in open-tomato's
 * `packages/shared/issue-tracker/src/port.ts` at commit
 * `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05). An adapter
 * that checks a value a person may have edited, as the `local` adapter
 * checks an issue file, needs the members as a value, so each list is
 * rebuilt here under the source's name.
 *
 * Each list is the keys of a record that `satisfies` a record keyed by
 * its union. That refuses a record missing a member and one naming a
 * member the union lacks, so `check-types` fails on a list that drifts
 * from its port union either way. The keys come back in the order the
 * record spells them, which is the source's order: lifecycle order for
 * the states.
 */
import type { IssuePriority, IssueState, IssueType } from '../../ports/index.js';

/** Every issue type, closed over {@link IssueType}. */
const TYPE_MEMBERS = {
  'code': true,
  'bug': true,
  'spike': true,
  'adr': true,
  'chore': true,
  'package-api': true,
} satisfies Record<IssueType, true>;

/** Every priority, closed over {@link IssuePriority}. */
const PRIORITY_MEMBERS = {
  urgent: true,
  high: true,
  medium: true,
  low: true,
} satisfies Record<IssuePriority, true>;

/** Every state, closed over {@link IssueState}, in lifecycle order. */
const STATE_MEMBERS = {
  'backlog': true,
  'todo': true,
  'in-progress': true,
  'in-review': true,
  'done': true,
  'released': true,
  'cancelled': true,
} satisfies Record<IssueState, true>;

/** Every issue type, in the source's order. Frozen. */
export const ISSUE_TYPES: readonly IssueType[] = Object.freeze(
  Object.keys(TYPE_MEMBERS) as IssueType[],
);

/** Every priority, most urgent first. Frozen. */
export const ISSUE_PRIORITIES: readonly IssuePriority[] = Object.freeze(
  Object.keys(PRIORITY_MEMBERS) as IssuePriority[],
);

/** Every state, in lifecycle order with `cancelled` last. Frozen. */
export const ISSUE_STATES: readonly IssueState[] = Object.freeze(
  Object.keys(STATE_MEMBERS) as IssueState[],
);
