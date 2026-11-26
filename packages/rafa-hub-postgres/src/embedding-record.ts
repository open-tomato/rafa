/**
 * The embedding record: the four fields a project's vectors are made
 * under, `model`, `hash`, `dimension` and `precision`, kept in the
 * project's store metadata (`hub_store_meta`, `schema.ts`), all four set
 * or none.
 *
 * ## Where it comes from
 *
 * `rafa-index`'s embedder answers its `dimension` alone, so the connector
 * is handed the record beside it ({@link checkEmbeddingRecord} holds the
 * two to one dimension). `model` and `hash` name the model and its
 * weights, `dimension` the length of every vector, and `precision` how
 * the build stores them.
 *
 * ## The column it chooses
 *
 * {@link vectorColumnOf} reads the column from the record's precision:
 * `halfvec` (2-byte floats) under `half`, `vector` (4-byte floats) under
 * `full`, each with the HNSW operator class of its cosine distance. A
 * build makes its vector column and its HNSW index from it
 * (`index-build.ts`).
 *
 * ## One record per project
 *
 * Every vector the project's index holds was made under the record its
 * metadata holds, since vectors of two models, two widths or two
 * precisions are not one space and an HNSW index over them answers
 * nearest neighbours that are not. {@link claimEmbeddingRecord} runs
 * inside a rebuild's transaction before any vector is written: with no
 * record stored it writes the given one, under the stored one it lets
 * the write go, and under another it refuses with
 * {@link EmbeddingRecordMismatch}, naming both records, before anything
 * is touched. A rebuild with no embedder writes no vector, reads no
 * record and leaves the stored one as it is.
 *
 * The rebuild's `SHARE ROW EXCLUSIVE` lock on the serving pointer makes
 * two rebuilds of one project run one after the other, and the rebuild
 * is the only writer of the record, so the read and the write of the
 * claim need no lock of their own.
 *
 * Nothing here is exported from the package's entry but the record's
 * type: the claim takes a Drizzle transaction, which the leak rule keeps
 * inside the connector.
 */
import type { HubTransaction } from './hub-tables.js';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { IndexRebuildRefusal } from '@open-tomato/rafa-index';
import { eq } from 'drizzle-orm';

import { hubStoreMeta } from './schema.js';

/** How a build stores its vectors: `halfvec` (2-byte floats) under `half`, `vector` under `full`. */
export type EmbeddingPrecision = 'half' | 'full';

/** Every {@link EmbeddingPrecision}. */
export const EMBEDDING_PRECISIONS: readonly EmbeddingPrecision[] = Object.freeze(['half', 'full']);

/** The four fields a project's vectors are made under, as its store metadata records them. */
export interface EmbeddingRecord {
  /** The model the hub embeds text with: `hub.index.embedding.model`. */
  readonly model: string;
  /** The hash of the model's weights, an install fact. */
  readonly hash: string;
  /** The length of every vector the model answers, an install fact. */
  readonly dimension: number;
  /** How the build stores each vector: `hub.index.embedding.precision`. */
  readonly precision: EmbeddingPrecision;
}

/** The column type a precision's vectors take and the HNSW operator class of its cosine distance. */
export interface VectorColumn {
  /** pgvector's type, `halfvec` or `vector`. */
  readonly type: 'halfvec' | 'vector';
  /** The HNSW operator class of the type's cosine distance. */
  readonly ops: 'halfvec_cosine_ops' | 'vector_cosine_ops';
}

/** The column of each precision. */
export const VECTOR_COLUMNS: Readonly<Record<EmbeddingPrecision, VectorColumn>> = Object.freeze({
  half: Object.freeze({ type: 'halfvec', ops: 'halfvec_cosine_ops' }),
  full: Object.freeze({ type: 'vector', ops: 'vector_cosine_ops' }),
});

/** A vector write under another record than the one the project's store metadata holds. */
export class EmbeddingRecordMismatch extends IndexRebuildRefusal {
  /** The record the project's store metadata holds. */
  readonly stored: EmbeddingRecord;
  /** The record the refused write was made under. */
  readonly given: EmbeddingRecord;

  constructor(project: string, stored: EmbeddingRecord, given: EmbeddingRecord) {
    super(
      `hub postgres: a vector write under the embedding record (${describeEmbeddingRecord(given)}) is refused: `
      + `project ${project}'s store metadata records (${describeEmbeddingRecord(stored)}), and vectors of two records `
      + 'are no one space for one index. Nothing was written',
    );
    this.name = 'EmbeddingRecordMismatch';
    this.stored = stored;
    this.given = given;
  }
}

/** The record as a refusal names it: `model <m>, hash <h>, dimension <d>, precision <p>`. */
export function describeEmbeddingRecord(record: EmbeddingRecord): string {
  return `model ${record.model}, hash ${record.hash}, dimension ${String(record.dimension)}, precision ${record.precision}`;
}

/** Whether `a` and `b` hold the same four fields. */
export function sameEmbeddingRecord(a: EmbeddingRecord, b: EmbeddingRecord): boolean {
  return a.model === b.model && a.hash === b.hash && a.dimension === b.dimension && a.precision === b.precision;
}

/** The column `record`'s precision chooses: `halfvec` under `half`, `vector` under `full`. */
export function vectorColumnOf(record: EmbeddingRecord): VectorColumn {
  return VECTOR_COLUMNS[record.precision];
}

/** Whether `value` is text with something in it and no white space at either end. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.trim() === value;
}

/**
 * `record`, frozen, refused with a `TypeError` naming the field when one
 * is not what the record holds, when it is missing while `embedder` is
 * given, and when its dimension is not the embedder's.
 */
export function checkEmbeddingRecord(record: EmbeddingRecord | undefined, embedder: IndexEmbedder): EmbeddingRecord {
  if (record === undefined) {
    throw new TypeError('hub postgres: an embedder is given with no embedding record (model, hash, dimension, precision); give the record its vectors are made under');
  }
  const { model, hash, dimension, precision } = record;
  if (!isName(model)) throw new TypeError(`hub postgres: the embedding record's model ${JSON.stringify(model)} is no model name`);
  if (!isName(hash)) throw new TypeError(`hub postgres: the embedding record's hash ${JSON.stringify(hash)} is no hash`);
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new TypeError(`hub postgres: the embedding record's dimension ${String(dimension)} is no whole number above 0`);
  }
  if (!EMBEDDING_PRECISIONS.includes(precision)) {
    throw new TypeError(`hub postgres: the embedding record's precision ${String(precision)} is neither half nor full`);
  }
  if (dimension !== embedder.dimension) {
    throw new TypeError(`hub postgres: the embedding record's dimension is ${String(dimension)}, its embedder's ${String(embedder.dimension)}`);
  }
  return Object.freeze({ model, hash, dimension, precision });
}

/** The record the project's store metadata holds, `null` while it holds none; `tx` runs in the project's schema. */
export async function readEmbeddingRecord(tx: HubTransaction): Promise<EmbeddingRecord | null> {
  const [row] = await tx
    .select({
      model: hubStoreMeta.embeddingModel,
      hash: hubStoreMeta.embeddingHash,
      dimension: hubStoreMeta.embeddingDimension,
      precision: hubStoreMeta.embeddingPrecision,
    })
    .from(hubStoreMeta)
    .where(eq(hubStoreMeta.id, 1));
  if (row === undefined || row.model === null || row.hash === null || row.dimension === null || row.precision === null) return null;
  const { model, hash, dimension, precision } = row;
  if (precision !== 'half' && precision !== 'full') {
    throw new Error(`hub postgres: the store metadata records the precision ${precision}, neither half nor full`);
  }
  return Object.freeze({ model, hash, dimension: Number(dimension), precision });
}

/** Writes `record` into the project's store metadata row, which the store wrote at open; `tx` runs in the project's schema. */
export async function writeEmbeddingRecord(tx: HubTransaction, record: EmbeddingRecord): Promise<void> {
  const written = await tx
    .update(hubStoreMeta)
    .set({
      embeddingModel: record.model,
      embeddingHash: record.hash,
      embeddingDimension: record.dimension,
      embeddingPrecision: record.precision,
    })
    .where(eq(hubStoreMeta.id, 1))
    .returning({ id: hubStoreMeta.id });
  if (written.length !== 1) {
    throw new Error('hub postgres: the project\'s schema holds no store metadata row to record the embedding record in');
  }
}

/**
 * Lets a vector write under `given` go: records it when the project's
 * metadata holds no record, passes under the same record, and refuses
 * under another with {@link EmbeddingRecordMismatch}; answers whether
 * it wrote. See the module note.
 */
export async function claimEmbeddingRecord(tx: HubTransaction, project: string, given: EmbeddingRecord): Promise<boolean> {
  const stored = await readEmbeddingRecord(tx);
  if (stored === null) {
    await writeEmbeddingRecord(tx, given);
    return true;
  }
  if (!sameEmbeddingRecord(stored, given)) throw new EmbeddingRecordMismatch(project, stored, given);
  return false;
}
