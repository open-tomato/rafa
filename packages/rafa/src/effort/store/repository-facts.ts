/**
 * Repository facts: the readings of a shared source that two stores can
 * both hold, and the supersedes that make two readings of one fact
 * count once.
 *
 * A port and the hub can each read the same pull request's checks on
 * the same head, so a merge of their stores holds two `plan_ci` rows that
 * say one thing. Neither row is wrong and neither is dropped: the second
 * is superseded by a row of `reading_supersedes`, never by a flag on the
 * reading, and every reader that counts facts reads through those rows.
 *
 * ## The registry
 *
 * {@link REPOSITORY_FACTS} lists every table whose rows are readings of
 * a shared source, beside `MERGE_RULES` (`merge-rules.ts`). An entry
 * declares only its fact columns, the columns whose values are what the
 * reading says, and its time column, when the reading was taken. Its
 * identity, the columns that name one reading, is the table's
 * `MERGE_RULES` identity and is never spelled twice.
 *
 * | Table | Facts | Time |
 * | --- | --- | --- |
 * | `plan_ci` | `pr`, `head_sha`, `verdict`, `failing` | `read_at` |
 *
 * ## The rule
 *
 * {@link SAME_FACT_RULE}, `same-fact@1`: two readings of one table are
 * one fact when their fact columns are equal, two NULLs counting as
 * equal; the canonical reading is the one with the earliest reading
 * time. Two readings at one time are ordered by their key, so every
 * store picks the same canonical one. For `plan_ci` the time is part of
 * the identity, so two readings with one `pr`, `head_sha` and `read_at`
 * are one row already and never meet that tie.
 *
 * ## A reading's key
 *
 * {@link readingKey} names a reading by its table's identity, as the
 * JSON array of the identity values in `MERGE_RULES` order:
 * `[7,"3f2a…","2026-11-08T10:00:00.000Z"]` for a `plan_ci` row. Never by
 * the origin pair, which a reading an older runtime wrote does not hold.
 * An identity value is text, a finite number or NULL; any other value is
 * refused, since JSON would not spell it back.
 *
 * ## Writing supersedes
 *
 * {@link writeSupersedes} is handed the keys of the readings a write or
 * a merge touched. For each fact they reach it reads every reading of
 * that fact, takes the canonical one, and gives every other reading that
 * is not yet the `superseded_key` of a row of that table and rule one
 * row naming the canonical reading. So a late reading older than the
 * canonical one adds a row superseding the old canonical reading, and
 * the rows the old one already canonicalised are left to the reader's
 * chain. Each insert is stamped (`stampedValues`, `origins.ts`) and
 * absorbed on the table's identity (`reading_supersedes_by_fact`), so a
 * port and the hub that write one supersede write one row.
 *
 * The writer opens no transaction of its own: a merge calls it as its
 * last step inside the transaction of the union, and a reading's writer
 * inside its own, so the readings and their supersedes land together.
 * It never rescans a table it was not handed keys of.
 *
 * ## Reading facts
 *
 * {@link readRepositoryFacts} answers one {@link RepositoryFact} per
 * fact of a table: its canonical reading, `sightings` (how many readings
 * it superseded, so two readings of one fact answer one sighting), the
 * origins that read it, and `lastSighting`, the latest reading time over
 * all its readings, the canonical one included. Each reading follows its
 * supersede rows to the reading no row of the rule supersedes, the
 * earliest one first where a reading has two; a row naming a reading the
 * store does not hold is not followed, and a chain that comes back to a
 * reading it passed, which the writer never writes, ends at the earliest
 * reading of that loop. The reader trusts the rows: what they join is
 * one fact, as the writer that wrote them read it.
 *
 * A reading no supersede names stands as a fact of its own, as a
 * reading written before the writer ran does. Nothing here matches
 * readings at read time.
 */
import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { MERGE_RULES } from './merge-rules.js';
import { STAMPED_COLUMNS, stampedValues } from './origins.js';
import { quoted } from './rebuild-aside.js';

/** One {@link REPOSITORY_FACTS} entry: what a reading says, and when it was read. */
export interface RepositoryFactColumns {
  /** The columns whose values are the fact; equal in all of them, two readings are one fact. */
  readonly facts: readonly string[];
  /** The column holding when the reading was taken, as ISO 8601 text. */
  readonly time: string;
}

/** Every table whose rows are readings of a shared source, by name. */
export const REPOSITORY_FACTS: Readonly<Record<string, RepositoryFactColumns>> = {
  plan_ci: { facts: ['pr', 'head_sha', 'verdict', 'failing'], time: 'read_at' },
};

/** The rule every supersede here is written under, as `reading_supersedes.rule` holds it. */
export const SAME_FACT_RULE = 'same-fact@1';

/** One reading of a repository fact, as the reader answers it. */
export interface FactReading {
  /** The reading's key, see {@link readingKey}. */
  readonly key: string;
  /** The fact columns' values, by column name. */
  readonly fact: Readonly<Record<string, SQLQueryBindings>>;
  /** When it was read. */
  readonly time: string;
  /** The store that wrote it, or null for a row with no origin pair. */
  readonly origin: string | null;
}

/** One fact of a table, every reading of it counted once. */
export interface RepositoryFact {
  /** The reading table. */
  readonly table: string;
  /** The earliest reading, the one its supersede chains end at. */
  readonly canonical: FactReading;
  /** How many readings the canonical one supersedes. */
  readonly sightings: number;
  /** The distinct origin stores of its readings, sorted; a reading with no origin adds none. */
  readonly origins: readonly string[];
  /** The latest reading time over all its readings, the canonical one included. */
  readonly lastSighting: string;
}

/** A table of {@link REPOSITORY_FACTS} with its identity read off `MERGE_RULES`. */
interface FactTable extends RepositoryFactColumns {
  readonly name: string;
  readonly identity: readonly string[];
}

/** A row as the readings query answers it. */
type StoredRow = Readonly<Record<string, SQLQueryBindings>>;

/** The supersede insert; a row whose identity is held already is absorbed. */
const INSERT_SUPERSEDE = `
  INSERT INTO reading_supersedes (table_name, canonical_key, superseded_key, rule, ${STAMPED_COLUMNS})
  VALUES (?, ?, ?, ?, ${stampedValues('reading_supersedes')})
  ON CONFLICT (table_name, canonical_key, superseded_key) DO NOTHING
`;

/** Whether a reading is already superseded under a table and rule. */
const SUPERSEDED = `
  SELECT 1 AS held FROM reading_supersedes
  WHERE table_name = ? AND rule = ? AND superseded_key = ?
  LIMIT 1
`;

/** A refusal of this module, naming the table. */
function refused(table: string, reason: string): Error {
  return new Error(`effort store: repository facts of ${table} ${reason}`);
}

/** The entry of `table` with its identity, or a refusal for a table that is no merged repository fact. */
function factTableOf(table: string): FactTable {
  const columns = Object.hasOwn(REPOSITORY_FACTS, table)
    ? REPOSITORY_FACTS[table]
    : undefined;
  if (columns === undefined) throw refused(table, 'are not read: the table has no REPOSITORY_FACTS entry');
  const rule = MERGE_RULES[table];
  if (rule?.scope !== 'merged') throw refused(table, 'are not read: the table is no merged table of MERGE_RULES');
  return { name: table, identity: rule.identity, facts: columns.facts, time: columns.time };
}

/** `value` as a key or fact part, refusing what JSON does not spell back. */
function jsonPart(table: string, column: string, value: unknown): string | number | null {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw refused(table, `cannot name a reading by ${column}: its value is not text, a finite number or NULL`);
}

/** The JSON array of `columns`' values of `row`, in that order. */
function encode(table: string, columns: readonly string[], row: StoredRow): string {
  return JSON.stringify(columns.map((column) => jsonPart(table, column, row[column])));
}

/**
 * The key of one reading of `table`: the JSON array of its identity
 * values in `MERGE_RULES` order. Throws for a table with no
 * {@link REPOSITORY_FACTS} entry and for an identity value that is not
 * text, a finite number or NULL. See the module note.
 */
export function readingKey(table: string, row: StoredRow): string {
  return encode(table, factTableOf(table).identity, row);
}

/** The identity values a key names, or a refusal for a key that names none. */
function decodeKey(shape: FactTable, key: string): (string | number | null)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== shape.identity.length) {
    throw refused(shape.name, `cannot read key ${key}: not a JSON array of ${String(shape.identity.length)} identity values`);
  }
  return parsed.map((value: unknown, index) => jsonPart(shape.name, shape.identity[index] ?? '', value));
}

/** The columns a readings query selects. */
function selectedColumns(shape: FactTable): string {
  const columns = [...new Set([...shape.identity, ...shape.facts, shape.time])];
  return [...columns.map(quoted), 'origin_store'].join(', ');
}

/** `SELECT` of every reading of `shape` matching `columns`, NULL matching NULL. */
function readingsWhere(shape: FactTable, columns: readonly string[]): string {
  const where = columns.map((column) => `${quoted(column)} IS ?`).join(' AND ');
  return `SELECT ${selectedColumns(shape)} FROM ${quoted(shape.name)} WHERE ${where}`;
}

/** One stored row as a {@link FactReading}. */
function readingOf(shape: FactTable, row: StoredRow): FactReading {
  const time = row[shape.time];
  if (typeof time !== 'string') throw refused(shape.name, `hold a reading whose ${shape.time} is not text`);
  const origin = row.origin_store;
  return {
    key: encode(shape.name, shape.identity, row),
    fact: Object.fromEntries(shape.facts.map((column) => [column, row[column] ?? null])),
    time,
    origin: typeof origin === 'string'
      ? origin
      : null,
  };
}

/** Whether `left` was read before `right`: by time, then by key. */
function readBefore(left: FactReading, right: FactReading): boolean {
  if (left.time !== right.time) return left.time < right.time;
  return left.key < right.key;
}

/** The earliest of `readings`, which holds at least one. */
function earliestOf(readings: readonly FactReading[]): FactReading | undefined {
  return readings.reduce<FactReading | undefined>(
    (earliest, reading) => (earliest === undefined || readBefore(reading, earliest)
      ? reading
      : earliest),
    undefined,
  );
}

/**
 * Writes the supersedes the readings of `table` named by `touchedKeys`
 * call for, and answers how many rows it added: for each fact they
 * reach, one row per reading of it that is not its canonical one and
 * not yet superseded under {@link SAME_FACT_RULE}. A key named twice, or
 * two keys of one fact, write that fact's rows once.
 *
 * Throws for a table with no {@link REPOSITORY_FACTS} entry, a key that
 * is not a JSON array of the table's identity values, and a key naming
 * no reading the store holds: each is a caller's fault, and the caller's
 * transaction takes back what was written. See the module note.
 */
export function writeSupersedes(db: Database, table: string, touchedKeys: readonly string[]): number {
  const shape = factTableOf(table);
  const byKey = db.query<StoredRow, SQLQueryBindings[]>(readingsWhere(shape, shape.identity));
  const byFact = db.query<StoredRow, SQLQueryBindings[]>(readingsWhere(shape, shape.facts));
  const superseded = db.query<{ held: number }, [string, string, string]>(SUPERSEDED);
  const insert = db.query<unknown, [string, string, string, string]>(INSERT_SUPERSEDE);

  const facts = new Map<string, FactReading>();
  for (const key of touchedKeys) {
    const row = byKey.get(...decodeKey(shape, key));
    if (row === null) throw refused(table, `name no reading by key ${key}`);
    const reading = readingOf(shape, row);
    const fact = encode(table, shape.facts, row);
    if (!facts.has(fact)) facts.set(fact, reading);
  }

  let added = 0;
  for (const touched of facts.values()) {
    const readings = byFact.all(...shape.facts.map((column) => touched.fact[column] ?? null)).map((row) => readingOf(shape, row));
    const canonical = earliestOf(readings) ?? touched;
    for (const reading of readings) {
      if (reading.key === canonical.key) continue;
      if (superseded.get(table, SAME_FACT_RULE, reading.key) !== null) continue;
      added += insert.run(table, canonical.key, reading.key, SAME_FACT_RULE).changes;
    }
  }
  return added;
}

/** One supersede row of a table and rule, as the reader reads it. */
interface StoredSupersede {
  readonly canonical_key: string;
  readonly superseded_key: string;
}

/** Each held reading's supersede targets that are held readings too, by superseded key. */
function supersedeTargets(db: Database, table: string, readings: ReadonlyMap<string, FactReading>): Map<string, FactReading[]> {
  const rows = db
    .query<StoredSupersede, [string, string]>('SELECT canonical_key, superseded_key FROM reading_supersedes WHERE table_name = ? AND rule = ? ORDER BY seq')
    .all(table, SAME_FACT_RULE);
  const targets = new Map<string, FactReading[]>();
  for (const { canonical_key: canonicalKey, superseded_key: supersededKey } of rows) {
    const canonical = readings.get(canonicalKey);
    if (canonical === undefined || !readings.has(supersededKey) || canonicalKey === supersededKey) continue;
    targets.set(supersededKey, [...targets.get(supersededKey) ?? [], canonical]);
  }
  return targets;
}

/**
 * The reading `start`'s chain ends at, taking the earliest target where
 * a reading has two: the first reading with none, or, for a chain that
 * comes back to a reading it passed, the earliest reading of that loop,
 * which every reading leading into the loop ends at alike.
 */
function chainEnd(start: FactReading, targets: ReadonlyMap<string, readonly FactReading[]>): FactReading {
  const path: FactReading[] = [start];
  for (;;) {
    const current = path[path.length - 1] ?? start;
    const next = earliestOf(targets.get(current.key) ?? []);
    if (next === undefined) return current;
    const seen = path.findIndex(({ key }) => key === next.key);
    if (seen >= 0) return earliestOf(path.slice(seen)) ?? next;
    path.push(next);
  }
}

/** The {@link RepositoryFact} of one canonical reading and every reading whose chain ends at it. */
function factOf(table: string, canonical: FactReading, readings: readonly FactReading[]): RepositoryFact {
  const origins = [...new Set(readings.flatMap(({ origin }) => (origin === null
    ? []
    : [origin])))].sort();
  const lastSighting = readings.reduce((latest, { time }) => (time > latest
    ? time
    : latest), canonical.time);
  return { table, canonical, sightings: readings.length - 1, origins, lastSighting };
}

/**
 * Every fact of `table`, each reading counted once: one
 * {@link RepositoryFact} per reading the supersede chains end at, in the
 * order of their canonical readings' time, then key.
 *
 * Throws for a table with no {@link REPOSITORY_FACTS} entry. See the
 * module note for how a chain is followed.
 */
export function readRepositoryFacts(db: Database, table: string): RepositoryFact[] {
  const shape = factTableOf(table);
  const rows = db.query<StoredRow, []>(`SELECT ${selectedColumns(shape)} FROM ${quoted(table)}`).all();
  const readings = new Map(rows.map((row) => {
    const reading = readingOf(shape, row);
    return [reading.key, reading] as const;
  }));
  const targets = supersedeTargets(db, table, readings);

  const groups = new Map<string, { canonical: FactReading; readings: FactReading[] }>();
  for (const reading of readings.values()) {
    const canonical = chainEnd(reading, targets);
    const group = groups.get(canonical.key) ?? { canonical, readings: [] };
    group.readings.push(reading);
    groups.set(canonical.key, group);
  }

  return [...groups.values()]
    .sort((left, right) => (readBefore(left.canonical, right.canonical)
      ? -1
      : 1))
    .map(({ canonical, readings: grouped }) => factOf(table, canonical, grouped));
}
