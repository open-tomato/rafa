/**
 * The re-embed job beside the connector: when the hub opens with another
 * embedding record than the one the first served project's store
 * metadata holds, the vectors its serving build holds are no space for
 * the configured embedder's, so the connector opens with `vector`
 * `false`, its why {@link reembeddingWhy}, and {@link runReembedJob}
 * builds the project's index again from its rows' text.
 *
 * ## What it does
 *
 * The job is one rebuild (`index-build.ts`) under the configured
 * embedder and record, with `replaceRecord`: it fills a new build schema
 * from the row tables, embeds every body and makes its HNSW index, all
 * inside the rebuild's transaction, while the serving build goes on
 * answering `fts` searches. Then, in that transaction, it writes the
 * configured record over the stored one and swaps the new build in, so
 * the record and the vectors change in one commit. The connector then
 * measures its capabilities again with nothing held back, and `vector`
 * turns `true`.
 *
 * It is never part of a push: a push writes the row tables alone, and
 * the job reads them at one point of their history, as every rebuild
 * does. A `rebuild` asked while it runs waits for it to settle, then
 * runs under what the connector measured after it.
 *
 * ## How it ends
 *
 * The job settles with a {@link ReembedOutcome} and never rejects:
 *
 *   - `swapped`: the new build serves and the configured record is
 *     stored;
 *   - `failed`: the build was refused or failed, so nothing changed: the
 *     old build serves `fts`, the stored record stays, and `vector` stays
 *     `false`, its why {@link reembedFailedWhy}, naming the failure, until
 *     the hub opens again;
 *   - `closed`: the connector was closed under it. Closing the client
 *     waits for the job's transaction rather than cutting it (measured,
 *     `reembed-job.test.ts`), so the job looks for the close itself,
 *     before each batch it hands the embedder and before the swap, and
 *     throws, which rolls the build back with nothing changed; the next
 *     open starts it again.
 *
 * Only the first served project is measured at open, as `graph` is, so
 * only its index is re-embedded; another project under a stored record
 * other than the configured one is refused at its rebuild naming both
 * (`EmbeddingRecordMismatch`).
 *
 * Nothing here is exported from the package's entry but the outcome's
 * type: the job takes the Drizzle database, which the leak rule keeps
 * inside the connector.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase } from './hub-tables.js';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { describeEmbeddingRecord, readEmbeddingRecord, sameEmbeddingRecord } from './embedding-record.js';
import { inProjectSchema } from './hub-tables.js';
import { rebuildProjectIndex } from './index-build.js';

/** The fields every outcome of a re-embed carries. */
interface ReembedOutcomeOf<S extends string> {
  /** How the job ended. */
  readonly state: S;
  /** The project it re-embedded. */
  readonly project: string;
  /** The record the project's store metadata held when the hub opened. */
  readonly stored: EmbeddingRecord;
  /** The configured record the job embedded under. */
  readonly record: EmbeddingRecord;
}

/** How a re-embed ended; see the module note. */
export type ReembedOutcome =
  | ReembedOutcomeOf<'swapped'> & {
    /** The vectors the new serving build holds. */
    readonly vectors: number;
  }
  | ReembedOutcomeOf<'failed'> & {
    /** What refused or failed the build. */
    readonly error: Error;
  }
  | ReembedOutcomeOf<'closed'>;

/** What one re-embed is handed. */
export interface ReembedJobOptions {
  /** The connector's Drizzle database. */
  readonly db: HubDatabase;
  /** The project to re-embed. */
  readonly place: ProjectSchema;
  /** The clock the build's stamp is read from. */
  readonly now: () => Date;
  /** The configured embedder. */
  readonly embedder: IndexEmbedder;
  /** The configured record, which the job stores. */
  readonly record: EmbeddingRecord;
  /** The record the project's store metadata held when the hub opened. */
  readonly stored: EmbeddingRecord;
  /** Whether the connector was closed, which makes a failure a `closed` outcome. */
  readonly isClosed: () => boolean;
}

/** Why `vector` is off while the job runs, naming both records. */
export function reembeddingWhy(stored: EmbeddingRecord, record: EmbeddingRecord): string {
  return `re-embedding from text under the configured embedding record (${describeEmbeddingRecord(record)}), `
    + `the stored one being (${describeEmbeddingRecord(stored)})`;
}

/** Why `vector` stays off once the job failed, naming the configured record and the failure. */
export function reembedFailedWhy(record: EmbeddingRecord, error: Error): string {
  return `the re-embed under the configured embedding record (${describeEmbeddingRecord(record)}) failed: ${error.message}; `
    + 'the stored record and its build stay until the hub opens again';
}

/**
 * The record `place`'s store metadata holds when it is not `record`,
 * which a re-embed then replaces; `null` when it holds `record` or none,
 * which the first vector build claims.
 */
export async function storedRecordToReplace(db: HubDatabase, place: ProjectSchema, record: EmbeddingRecord): Promise<EmbeddingRecord | null> {
  const stored = await inProjectSchema(db, place.schema, readEmbeddingRecord);
  return stored === null || sameEmbeddingRecord(stored, record)
    ? null
    : stored;
}

/** Re-embeds `place`'s index under the configured record and swaps it in; settles with its outcome, never rejecting. */
export async function runReembedJob(options: ReembedJobOptions): Promise<ReembedOutcome> {
  const { db, embedder, isClosed, now, place, record, stored } = options;
  const of = { project: place.id, stored, record };
  const stopIfClosed = (): void => {
    if (isClosed()) throw new Error('hub postgres: the connector was closed under the re-embed');
  };
  const stopping: IndexEmbedder = {
    dimension: embedder.dimension,
    embed: async (texts) => {
      stopIfClosed();
      return embedder.embed(texts);
    },
  };
  try {
    const { result } = await rebuildProjectIndex({
      db,
      place,
      request: { project: place.id },
      now,
      embedder: stopping,
      record,
      replaceRecord: true,
      hooks: { beforeSwap: stopIfClosed },
    });
    return Object.freeze({ state: 'swapped', ...of, vectors: result.vectors });
  } catch (error) {
    if (isClosed()) return Object.freeze({ state: 'closed', ...of });
    const failure = error instanceof Error
      ? error
      : new Error(String(error));
    return Object.freeze({ state: 'failed', ...of, error: failure });
  }
}
