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
 *
 * `ISSUE_UPSTREAM_FLAG` and `ISSUE_UPSTREAM_TOOL_WORDS` are copies of
 * `UPSTREAM_FLAG` and `UPSTREAM_TOOLS` (`upstream.ts`), which
 * `declarations.test.ts` holds equal to their sources.
 */
import type { RafaFlagSpec, SubjectSpec } from '@open-tomato/rafa/core/command';

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

/** The flag that sends an `issue` command to the board `collaborate.<tool>` names: a copy of `UPSTREAM_FLAG`; see the module note. */
export const ISSUE_UPSTREAM_FLAG = 'upstream';

/** The tools `--upstream` accepts: a copy of `UPSTREAM_TOOLS`; see the module note. */
export const ISSUE_UPSTREAM_TOOL_WORDS: readonly string[] = Object.freeze(['rafa']);

/** What every `--upstream` help line says: the key it reads and the same-owner rule. */
const UPSTREAM_RULE = `one of ${ISSUE_UPSTREAM_TOOL_WORDS.join(', ')}, whose board \`collaborate.<tool>\` names`
  + ' in `.rafa/config.yaml` (`collaborate.rafa` for rafa). Refused, exit 1, when the key is not set or its owner'
  + ' differs from this board\'s, ignoring case: reporting upstream is allowed only between repositories of one owner.';

/**
 * The `--upstream=<tool>` flag one `issue` command declares.
 *
 * @param what - What the command does on that board, opening the help line.
 * @returns The flag spec.
 */
export function issueUpstreamFlagSpec(what: string): RafaFlagSpec {
  return Object.freeze<RafaFlagSpec>({
    name: ISSUE_UPSTREAM_FLAG,
    description: `${what} on the upstream board of a tool: ${UPSTREAM_RULE}`,
    type: 'string',
  });
}
