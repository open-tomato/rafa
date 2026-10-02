/**
 * Inherited red: whether a reported bug is a test failure the run
 * started with, read against the run-start suite baseline's failures
 * (`../suite/baseline.ts`). Loop-owned triage (`./triage.ts`) files
 * nothing for such a bug, and comments at most once per run on the open
 * issue its key finds; that note holds the routing.
 *
 * ## The match
 *
 * A bug is inherited from a run-start failure ({@link inheritedFailureOf})
 * when:
 *
 *   - it names a test case (`./test-failure.ts`) with a test file and an
 *     evidence line;
 *   - its test file's base name equals the failure's, and its case name,
 *     put on one line, equals the failure's: the test the step-1 key of
 *     `./bug-key.ts` names, so a bug that quotes the file with a folder
 *     and a baseline that holds it without one still match;
 *   - its evidence line holds the failure's message, both read as the key
 *     reads an evidence line (`keyText`: commit hashes, folder prefixes
 *     and numbers taken out, on one line). Holds rather than equals, since
 *     a session quotes a line around what the JUnit message says.
 *
 * A run-start failure with no message, or a blank one, matches nothing:
 * the test name alone would also match a different failure of the same
 * test, which the run did not inherit. A bug with no test file or no
 * evidence line matches nothing for the same reason. The first failure
 * that matches is answered, in the baseline's order.
 *
 * The bug is read from the values triage keys it by, with local paths
 * already taken out; a baseline's file and message are compared as the
 * baseline holds them, since stripping takes out folder prefixes on both
 * sides.
 */
import type { TestFailure } from './test-failure.js';
import type { IssueState } from '../ports/index.js';
import type { ReportBug } from '../report/parse.js';
import type { SuiteFailure } from '../suite/run.js';

import { basename } from 'node:path';

import { hasText, keyText, oneLine } from './bug-key.js';
import { testFailureOf } from './test-failure.js';

/** The run-start failures and what one run commented on; `TriageOptions.inherited`. */
export interface InheritedTriage {
  /** The run-start baseline's failures, as `readBaseline` read them. */
  readonly failures: readonly SuiteFailure[];
  /**
   * The keys of inherited bugs already commented on this run. Shared by
   * every triage of one run and added to by `triageReport` after each
   * comment it makes, so a key is commented on at most once per run.
   */
  readonly commented: Set<string>;
}

/** The issue states that are closed: no inherited bug is commented on there. */
export const CLOSED_ISSUE_STATES: readonly IssueState[] = ['done', 'released', 'cancelled'];

/** True for an issue state that is still open. */
export function isOpenIssueState(state: IssueState): boolean {
  return !CLOSED_ISSUE_STATES.includes(state);
}

/** True when `failure`, read from a bug, is the run-start `baseline` failure; see the module note. */
function sameFailure(failure: TestFailure, baseline: SuiteFailure): boolean {
  const { file, evidence } = failure;
  const message = baseline.message ?? null;
  if (file === null || evidence === null || !hasText(message)) return false;
  return basename(file) === basename(baseline.file)
    && oneLine(failure.name) === oneLine(baseline.name)
    && keyText(evidence).includes(keyText(message));
}

/**
 * The run-start failure `bug` is, or null when it is none of `failures`;
 * see the module note. `bug` holds its `what` and `artifact` with local
 * paths taken out.
 */
export function inheritedFailureOf(
  bug: Pick<ReportBug, 'what' | 'artifact'>,
  failures: readonly SuiteFailure[],
): SuiteFailure | null {
  const failure = testFailureOf(bug);
  if (failure === null) return null;
  return failures.find((baseline) => sameFailure(failure, baseline)) ?? null;
}
