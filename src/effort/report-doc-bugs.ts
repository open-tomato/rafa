/**
 * The reading "filed bugs naming only documentation" of
 * `rafa effort report`: how many of the stored out-of-scope bugs a tracker
 * could be handed name documentation and nothing else.
 *
 * A stale page belongs in a report's `stale_docs` field, which stores a
 * row and files nothing. A session that writes it as an out-of-scope bug
 * instead sends it down the bug route, to a tracker. This count is the
 * control for that drift: it reads zero while the sessions keep the two
 * fields apart, and a figure that rises says they have stopped.
 *
 * ## What is counted
 *
 * Rows of `out_of_scope_bugs` whose `scope` is `rafa`. A `machine` row
 * reaches no tracker (`triage/triage.ts`), so it is no filed bug and is in
 * neither figure. A row is counted once per session that reported it, as
 * the table stores it (`store/triage.ts`): the reading is of what the
 * sessions wrote, not of how many issues a tracker holds.
 *
 * A row names only documentation when `namesOnlyDocs`
 * (`triage/doc-only.ts`) holds for its `what` and its `artifact` read as
 * ONE text, the two joined by a line break, a NULL artifact adding
 * nothing. Joined, because the reading is split across the pair both
 * ways: a `what` naming a page beside an `artifact` naming a source file
 * is a bug about code, and a `what` naming a page beside an `artifact`
 * quoting the page's sentence, which names no path and answers `false`
 * alone, is a bug about the page.
 *
 * ## The read
 *
 * {@link readDocOnlyBugs} reads under the repo root whichever backend
 * `store` selects, as the task report tallies are read
 * (`store/reports.ts`): it opens and creates nothing when the store file
 * does not exist and answers two zeroes, and a store that exists is
 * opened through `withSqliteStore` for a read, so its schema is brought
 * forward, or refused, as `store/sqlite.ts` says a read's is.
 * {@link countDocOnlyBugs} is the count alone, pure over the rows.
 */
import { existsSync } from 'node:fs';

import { namesOnlyDocs } from '../triage/doc-only.js';

import { sqliteStorePath, withSqliteStore } from './store/sqlite.js';

/** The stored bugs a tracker could be handed, and those naming only documentation. */
export interface DocOnlyBugs {
  /** The `out_of_scope_bugs` rows of scope `rafa`. */
  readonly bugs: number;
  /** Those of them whose `what` and `artifact` name only documentation. */
  readonly docOnly: number;
}

/** The two fields of a bug the reading is taken on. */
export interface BugText {
  readonly what: string;
  readonly artifact: string | null;
}

/** Every bug of scope `rafa`, by the two columns the reading needs. */
const SELECT_FILED_BUGS = `
  SELECT what, artifact
  FROM out_of_scope_bugs
  WHERE scope = 'rafa'
`;

/** A bug's two fields as the one text the reading is taken on. */
function bugText(bug: BugText): string {
  return bug.artifact === null
    ? bug.what
    : `${bug.what}\n${bug.artifact}`;
}

/**
 * How many of `bugs` there are, and how many name only documentation.
 * Pure over its input; see the module note for the joined reading.
 */
export function countDocOnlyBugs(bugs: readonly BugText[]): DocOnlyBugs {
  return {
    bugs: bugs.length,
    docOnly: bugs.filter((bug) => namesOnlyDocs(bugText(bug))).length,
  };
}

/**
 * Counts the stored bugs of scope `rafa` under `repoRoot`, and those of
 * them naming only documentation.
 *
 * Answers two zeroes, opening and creating nothing, when the store file
 * does not exist. Throws when it exists and cannot be read. See the
 * module note.
 */
export function readDocOnlyBugs(repoRoot: string): DocOnlyBugs {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return countDocOnlyBugs([]);

  return countDocOnlyBugs(
    withSqliteStore(path, 'read', false, (db) => db.query<BugText, []>(SELECT_FILED_BUGS).all()),
  );
}
