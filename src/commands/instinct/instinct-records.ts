/**
 * What only `rafa instinct list` and `rafa instinct show` use over the
 * two instinct scopes: the lookup an id is answered by, and the project
 * a command context has to carry.
 *
 * This is the command half. Reading the scopes — which files in a scope
 * are records, what one file reads as, `readScope` and
 * `readScopes` — is the library half, `src/schema/scope-records.ts`,
 * which the local Learning adapter and the skills report read too; this
 * file re-exports none of it.
 *
 * `rafa instinct check <dir>` answers one directory in detail and
 * exits with its failures. These two commands answer the other
 * question: what has been LEARNED, in which scope, and what one record
 * says.
 *
 * ## The adapter's store is named, not matched
 *
 * The library half passes over everything in a scope that is no
 * top-level `.md`, the local Learning adapter's `instincts.ndjson` and
 * `flags.ndjson` among it, by that rule rather than by name. {@link
 * LEARNING_STORE_FILES} names the two anyway, for the sentence a
 * listing prints and for a test to plant.
 *
 * ## The id is the file name
 *
 * {@link findRecords} matches on `InstinctRecordEntry.id`, the file's
 * stem, never the frontmatter `id`, so a record whose frontmatter
 * cannot be read at all is still reachable by the name it is filed
 * under.
 */
import type { RafaContext } from '../../cli/command.js';
import type { ProjectFound } from '../../project/scope.js';
import type { InstinctRecordEntry, ScopeListing } from '../../schema/scope-records.js';

/** The local Learning adapter's own files, which are no records. */
export const LEARNING_STORE_FILES: readonly string[] = ['instincts.ndjson', 'flags.ndjson'];

/** Every entry of every scope, in scope order. */
export function allRecords(listings: readonly ScopeListing[]): readonly InstinctRecordEntry[] {
  return listings.flatMap((listing) => listing.records);
}

/** Every entry filed under `id`, in scope order: the project scope holds one too. */
export function findRecords(listings: readonly ScopeListing[], id: string): readonly InstinctRecordEntry[] {
  return allRecords(listings).filter((entry) => entry.id === id);
}

/** The project the dispatcher resolved, which both commands declare they need. */
export function instinctProject(context: RafaContext, name: string): ProjectFound {
  if (context.project === null) throw new Error(`${name} runs inside a project, and was handed none`);
  return context.project;
}
