/**
 * The embedding record: without a database, its check against the
 * embedder, the column its precision chooses and the refusal naming two
 * records, and the connector refusing an embedder and a record that are
 * no pair before it connects. Where `POSTGRES_URL` is set, each case
 * opens its store under a schema prefix no other case or run holds and
 * holds what a rebuild does with the record in the project's store
 * metadata: the first vector build records it, a build under the same
 * record goes on, and one under another model, another dimension or
 * another precision is refused naming both records with nothing changed.
 * Each case drops only the project schemas its prefix made and the build
 * schemas its rebuilds named.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { PostgresHubStoreParts } from './hub-store.js';
import type { HubDatabase } from './hub-tables.js';
import type { WirePayload } from '@open-tomato/rafa/store';
import type { HubStoreContext } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { IndexRebuildRefusal } from '@open-tomato/rafa-index';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';

import {
  checkEmbeddingRecord,
  describeEmbeddingRecord,
  EmbeddingRecordMismatch,
  sameEmbeddingRecord,
  vectorColumnOf,
} from './embedding-record.js';
import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { EMBEDDING_COLUMN, rebuildProjectIndex } from './index-build.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const T0 = '2026-11-26T10:00:00.000Z';
const CONTEXT: HubStoreContext = { directory: '/nonexistent', now: () => new Date(T0) };

/** The record a case's first vector build is made under. */
const RECORD: EmbeddingRecord = Object.freeze({ model: 'nomic-embed-text', hash: 'sha256-aaaa', dimension: 3, precision: 'half' });

/** An embedder of `dimension` numbers per text, recording every text it was handed; no vector is zero. */
function recordingEmbedder(dimension = RECORD.dimension): IndexEmbedder & { readonly texts: string[] } {
  const texts: string[] = [];
  return {
    dimension,
    texts,
    embed: async (given) => {
      texts.push(...given);
      return given.map((text) => Float32Array.from({ length: dimension }, (_, at) => 1 + ((text.length + at) % 5)));
    },
  };
}

/** One commit and one session of origin A: the rows a case's builds embed. */
const ROWS: WirePayload = {
  format: WIRE_FORMAT,
  version: WIRE_VERSION,
  migrations: DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire),
  tables: {
    commits: [{ seq: 50, sha: 'sha-1', row_json: '{"subject":"parser rewrite"}', origin_store: A, origin_seq: 1 }],
    sessions: [{ seq: 51, session_id: 's-2', row_json: '{"topic":"cache eviction"}', worktree: null, origin_store: A, origin_seq: 2 }],
  },
  cursor: {},
};

describe('checkEmbeddingRecord', () => {
  it('answers the record frozen when its dimension is the embedder\'s', () => {
    const checked = checkEmbeddingRecord({ ...RECORD }, recordingEmbedder());

    expect(checked).toEqual(RECORD);
    expect(Object.isFrozen(checked)).toBe(true);
  });

  it('refuses an embedder with no record, naming the four fields', () => {
    expect(() => checkEmbeddingRecord(undefined, recordingEmbedder())).toThrow('an embedder is given with no embedding record (model, hash, dimension, precision)');
  });

  it('refuses a record whose dimension is not the embedder\'s, naming both', () => {
    expect(() => checkEmbeddingRecord({ ...RECORD, dimension: 4 }, recordingEmbedder(3))).toThrow('the embedding record\'s dimension is 4, its embedder\'s 3');
  });

  it('refuses each field that is not what the record holds, naming the field', () => {
    const embedder = recordingEmbedder();
    const bad = (extra: Record<string, unknown>): EmbeddingRecord => ({ ...RECORD, ...extra }) as unknown as EmbeddingRecord;

    expect(() => checkEmbeddingRecord(bad({ model: '' }), embedder)).toThrow('the embedding record\'s model "" is no model name');
    expect(() => checkEmbeddingRecord(bad({ hash: ' x' }), embedder)).toThrow('the embedding record\'s hash " x" is no hash');
    expect(() => checkEmbeddingRecord(bad({ dimension: 0 }), recordingEmbedder(0))).toThrow('the embedding record\'s dimension 0 is no whole number above 0');
    expect(() => checkEmbeddingRecord(bad({ precision: 'double' }), embedder)).toThrow('the embedding record\'s precision double is neither half nor full');
  });
});

describe('vectorColumnOf', () => {
  it('chooses halfvec under precision half and vector under full, each with its cosine operator class', () => {
    expect(vectorColumnOf(RECORD)).toEqual({ type: 'halfvec', ops: 'halfvec_cosine_ops' });
    expect(vectorColumnOf({ ...RECORD, precision: 'full' })).toEqual({ type: 'vector', ops: 'vector_cosine_ops' });
  });
});

describe('sameEmbeddingRecord and EmbeddingRecordMismatch', () => {
  it('holds a record the same as a copy of it, and another in each of the four fields as not', () => {
    expect(sameEmbeddingRecord(RECORD, { ...RECORD })).toBe(true);
    expect([
      sameEmbeddingRecord(RECORD, { ...RECORD, model: 'all-minilm' }),
      sameEmbeddingRecord(RECORD, { ...RECORD, hash: 'sha256-bbbb' }),
      sameEmbeddingRecord(RECORD, { ...RECORD, dimension: 4 }),
      sameEmbeddingRecord(RECORD, { ...RECORD, precision: 'full' }),
    ]).toEqual([false, false, false, false]);
  });

  it('names both records in its message, the given one and the stored one, and is a rebuild refusal', () => {
    const given: EmbeddingRecord = { ...RECORD, precision: 'full' };
    const refusal = new EmbeddingRecordMismatch('p1', RECORD, given);

    expect(refusal.message).toContain('a vector write under the embedding record (model nomic-embed-text, hash sha256-aaaa, dimension 3, precision full) is refused');
    expect(refusal.message).toContain('project p1\'s store metadata records (model nomic-embed-text, hash sha256-aaaa, dimension 3, precision half)');
    expect([refusal.stored, refusal.given]).toEqual([RECORD, given]);
    expect(refusal).toBeInstanceOf(IndexRebuildRefusal);
  });
});

describe('connectPostgresHub with an embedder, before it connects', () => {
  it('refuses an embedder with no record ahead of the URL variable', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: {}, embedder: recordingEmbedder() });

    await expect(opened).rejects.toThrow('an embedder is given with no embedding record');
  });

  it('refuses a record with no embedder ahead of the URL variable', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: {}, embeddingRecord: RECORD });

    await expect(opened).rejects.toThrow('an embedding record is given with no embedder');
  });

  it('refuses a record whose dimension is not its embedder\'s ahead of the URL variable', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: {}, embedder: recordingEmbedder(4), embeddingRecord: RECORD });

    await expect(opened).rejects.toThrow('the embedding record\'s dimension is 3, its embedder\'s 4');
  });

  it('reaches the URL variable with a pair of one dimension, as the control', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: {}, embedder: recordingEmbedder(), embeddingRecord: RECORD });

    await expect(opened).rejects.toThrow('the environment variable HUB_DB_URL is unset');
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('the embedding record, live on POSTGRES_URL', () => {
  let admin: SQL;
  let parts: PostgresHubStoreParts | undefined;
  let db: HubDatabase;
  const projectSchemas: string[] = [];
  const builds: string[] = [];

  /** A schema prefix no other case or run holds. */
  function freshPrefix(): string {
    return `test_embrec_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
  }

  /** Opens a store holding {@link ROWS} under a fresh prefix, recording its project schema for the drop; answers the schema. */
  async function open(): Promise<string> {
    const prefix = freshPrefix();
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    projectSchemas.push(schema);
    const client = new SQL(url);
    db = drizzle({ client });
    parts = await openPostgresHubStoreParts(CONTEXT, { client, schemaPrefix: prefix });
    await parts.store.push({ device: A, payload: ROWS });
    return schema;
  }

  /** Rebuilds the project, embedding with `embedder` under `record` when given, recording the build for the drop. */
  async function rebuild(embedder?: IndexEmbedder, record?: EmbeddingRecord): Promise<string> {
    const place = await (parts as PostgresHubStoreParts).placeOf(undefined);
    const built = await rebuildProjectIndex({ db, place, request: { project: place.id }, now: CONTEXT.now, embedder, record });
    builds.push(built.schema);
    return built.schema;
  }

  /** The embedding record `schema`'s store metadata holds, read from outside every rebuild, its four columns null while none. */
  async function storedOf(schema: string): Promise<Record<string, unknown> | undefined> {
    const [row] = await admin.unsafe<Record<string, unknown>[]>(
      `SELECT embedding_model AS model, embedding_hash AS hash, embedding_dimension AS dimension, embedding_precision AS precision FROM "${schema}".hub_store_meta`,
    );
    return row === undefined
      ? undefined
      : { ...row };
  }

  /** The build schema the pointer of `schema` names, read from outside. */
  async function pointerOf(schema: string): Promise<string | undefined> {
    const [row] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
    return row?.build_schema;
  }

  /** The type of the vector column of `build`'s copy of `commits`, as `format_type` names it. */
  async function vectorTypeOf(build: string): Promise<string | undefined> {
    const [row] = await admin.unsafe<{ type: string }[]>(`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = to_regclass($1) AND attname = '${EMBEDDING_COLUMN}'`, [`"${build}".commits`]);
    return row?.type;
  }

  /** A case under the record `RECORD` recorded: the store opened and built once under it. */
  async function recorded(): Promise<{ readonly schema: string; readonly serving: string }> {
    const schema = await open();
    const serving = await rebuild(recordingEmbedder(), RECORD);
    return { schema, serving };
  }

  /** Holds a rebuild under `given` refused naming both records, with the pointer, the record and the embedder untouched. */
  async function expectRefused(given: EmbeddingRecord): Promise<void> {
    const { schema, serving } = await recorded();
    const embedder = recordingEmbedder(given.dimension);

    const refused = rebuild(embedder, given);

    await expect(refused).rejects.toBeInstanceOf(EmbeddingRecordMismatch);
    await expect(refused).rejects.toThrow(`a vector write under the embedding record (${describeEmbeddingRecord(given)}) is refused`);
    await expect(refused).rejects.toThrow(`store metadata records (${describeEmbeddingRecord(RECORD)})`);
    expect(await pointerOf(schema)).toBe(serving);
    expect(await storedOf(schema)).toEqual({ ...RECORD });
    expect(embedder.texts).toEqual([]);
  }

  beforeAll(() => {
    admin = new SQL(url);
  });

  afterEach(async () => {
    await parts?.store.close();
    parts = undefined;
    for (const name of [...builds.splice(0), ...projectSchemas.splice(0)]) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  it('holds no record before a vector build, and none after a build with no embedder', async () => {
    const schema = await open();
    const none = { model: null, hash: null, dimension: null, precision: null };
    const before = await storedOf(schema);

    await rebuild();

    expect([before, await storedOf(schema)]).toEqual([none, none]);
  });

  it('records the first vector build\'s record in the store metadata', async () => {
    const { schema } = await recorded();

    expect(await storedOf(schema)).toEqual({ ...RECORD });
  });

  it('builds again under the same record, and leaves it as it is under a build with no embedder, as the control', async () => {
    const { schema, serving } = await recorded();

    const again = await rebuild(recordingEmbedder(), { ...RECORD });
    const textOnly = await rebuild();

    expect([again, textOnly].includes(serving)).toBe(false);
    expect(await pointerOf(schema)).toBe(textOnly);
    expect(await storedOf(schema)).toEqual({ ...RECORD });
  });

  it('refuses a vector write under another model, naming both records', async () => {
    await expectRefused({ ...RECORD, model: 'all-minilm' });
  });

  it('refuses a vector write under another dimension, naming both records', async () => {
    await expectRefused({ ...RECORD, dimension: 4 });
  });

  it('refuses a vector write under precision full against a stored half, naming both records', async () => {
    await expectRefused({ ...RECORD, precision: 'full' });
  });

  it('chooses the halfvec or vector column from the record\'s precision', async () => {
    await open();
    const half = await rebuild(recordingEmbedder(), RECORD);
    await parts?.store.close();
    const fullSchema = await open();
    const full = await rebuild(recordingEmbedder(), { ...RECORD, precision: 'full' });

    expect([await vectorTypeOf(half), await vectorTypeOf(full)]).toEqual(['halfvec(3)', 'vector(3)']);
    expect((await storedOf(fullSchema))?.['precision']).toBe('full');
  });

  it('records the connector\'s record at its open build, and refuses another one\'s rebuild of the same project', async () => {
    const prefix = freshPrefix();
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    projectSchemas.push(schema);
    const env = { POSTGRES_URL: url };
    const first = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', env, schemaPrefix: prefix, embedder: recordingEmbedder(), embeddingRecord: RECORD });
    const serving = await pointerOf(schema);
    builds.push(serving ?? '');
    await first.store.close();
    const full: EmbeddingRecord = { ...RECORD, precision: 'full' };
    const second = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', env, schemaPrefix: prefix, embedder: recordingEmbedder(), embeddingRecord: full });
    try {
      const refused = second.index.rebuild({ project: DEFAULT_PROJECT_ID });

      await expect(refused).rejects.toThrow(`(${describeEmbeddingRecord(full)}) is refused`);
      expect(await storedOf(schema)).toEqual({ ...RECORD });
      expect(await vectorTypeOf(serving ?? '')).toBe('halfvec(3)');
      expect(await pointerOf(schema)).toBe(serving);
    } finally {
      await second.store.close();
    }
  });
});
