/**
 * `set.json`: the record of one set at one key. It replaces the old
 * `ENVIRONMENT` file, one record per fact. The reader is strict, as the
 * config reader is: an unknown key refuses, naming it and the file.
 */
import { describeValue, isMapping } from '@open-tomato/rafa-core/core/config/sections';

/** What one run measured. */
export interface RunCounts {
  readonly kind: 'seed' | 'assert' | 'update';
  readonly compared: number;
  readonly added: number;
  readonly updated: number;
  readonly failed: number;
}

/** What drew a set. */
export interface SetRunner {
  readonly kind: 'host' | 'container';
  /** `darwin-arm64`. */
  readonly platform: string;
  /** `macOS 26.6.2`, or null when the host did not say. */
  readonly os: string | null;
}

/** The record of one set at one key. */
export interface SetRecord {
  readonly set: string;
  readonly playwrightVersion: string;
  readonly runner: SetRunner;
  readonly projectCommit: string | null;
  readonly projectDirty: boolean;
  readonly promotedAt: string | null;
  readonly files: number;
  readonly lastRun: RunCounts | null;
  /** Set by `migrate`: the old record's state line, verbatim. */
  readonly migratedFrom?: { readonly state: string };
}

const RECORD_KEYS = ['set', 'playwrightVersion', 'runner', 'projectCommit', 'projectDirty', 'promotedAt', 'files', 'lastRun', 'migratedFrom'] as const;
const RUNNER_KEYS = ['kind', 'platform', 'os'] as const;
const COUNT_KEYS = ['kind', 'compared', 'added', 'updated', 'failed'] as const;
const RUN_KINDS = ['seed', 'assert', 'update'] as const;
const RUNNER_KINDS = ['host', 'container'] as const;

/** Reads one record, gathering every problem. */
class RecordReader {
  readonly problems: string[] = [];

  /** The fields of a mapping at `at`, refusing unknown keys. */
  fields(raw: unknown, at: string, keys: readonly string[]): ReadonlyMap<string, unknown> {
    const fields = new Map<string, unknown>();
    if (!isMapping(raw)) {
      this.problems.push(`${at} is ${describeValue(raw)}, expected a mapping`);
      return fields;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (keys.some((known) => known === key)) fields.set(key, value);
      else this.problems.push(`${at}.${key} is not a key a set record holds`);
    }
    return fields;
  }

  text(fields: ReadonlyMap<string, unknown>, key: string, at: string): string {
    const value = fields.get(key);
    if (typeof value === 'string' && value !== '') return value;
    this.problems.push(`${at}.${key} is ${describeValue(value)}, expected a non-empty string`);
    return '';
  }

  textOrNull(fields: ReadonlyMap<string, unknown>, key: string, at: string): string | null {
    return fields.get(key) === null
      ? null
      : this.text(fields, key, at);
  }

  count(fields: ReadonlyMap<string, unknown>, key: string, at: string): number {
    const value = fields.get(key);
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    this.problems.push(`${at}.${key} is ${describeValue(value)}, expected a whole number from 0`);
    return 0;
  }

  oneOf<K extends string>(fields: ReadonlyMap<string, unknown>, key: string, at: string, kinds: readonly K[]): K {
    const value = fields.get(key);
    const kind = kinds.find((known) => known === value);
    if (kind === undefined) this.problems.push(`${at}.${key} is ${describeValue(value)}, expected one of: ${kinds.join(', ')}`);
    return kind ?? kinds[0] as K;
  }

  record(raw: unknown): SetRecord {
    const fields = this.fields(raw, 'set.json', RECORD_KEYS);
    const runnerFields = this.fields(fields.get('runner'), 'set.json.runner', RUNNER_KEYS);
    const dirty = fields.get('projectDirty');
    if (typeof dirty !== 'boolean') this.problems.push(`set.json.projectDirty is ${describeValue(dirty)}, expected true or false`);
    const lastRunRaw = fields.get('lastRun');
    const migratedRaw = fields.get('migratedFrom');
    const record: SetRecord = {
      set: this.text(fields, 'set', 'set.json'),
      playwrightVersion: this.text(fields, 'playwrightVersion', 'set.json'),
      runner: {
        kind: this.oneOf(runnerFields, 'kind', 'set.json.runner', RUNNER_KINDS),
        platform: this.text(runnerFields, 'platform', 'set.json.runner'),
        os: this.textOrNull(runnerFields, 'os', 'set.json.runner'),
      },
      projectCommit: this.textOrNull(fields, 'projectCommit', 'set.json'),
      projectDirty: dirty === true,
      promotedAt: this.textOrNull(fields, 'promotedAt', 'set.json'),
      files: this.count(fields, 'files', 'set.json'),
      lastRun: lastRunRaw === null
        ? null
        : this.counts(lastRunRaw),
    };
    if (migratedRaw === undefined) return record;
    const migrated = this.fields(migratedRaw, 'set.json.migratedFrom', ['state']);
    return { ...record, migratedFrom: { state: this.text(migrated, 'state', 'set.json.migratedFrom') } };
  }

  counts(raw: unknown): RunCounts {
    const at = 'set.json.lastRun';
    const fields = this.fields(raw, at, COUNT_KEYS);
    return {
      kind: this.oneOf(fields, 'kind', at, RUN_KINDS),
      compared: this.count(fields, 'compared', at),
      added: this.count(fields, 'added', at),
      updated: this.count(fields, 'updated', at),
      failed: this.count(fields, 'failed', at),
    };
  }
}

/** Reads a set record; null when the file is absent. Throws naming the file and every problem. */
export async function readSetRecord(file: string): Promise<SetRecord | null> {
  const source = Bun.file(file);
  if (!(await source.exists())) return null;
  let raw: unknown;
  try {
    raw = await source.json();
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error instanceof Error
      ? error.message
      : String(error)}`, { cause: error });
  }
  const reader = new RecordReader();
  const record = reader.record(raw);
  if (reader.problems.length > 0) throw new Error(`${file}: ${reader.problems.join('; ')}`);
  return record;
}

/** Writes a set record as two-space JSON with a trailing newline. */
export async function writeSetRecord(file: string, record: SetRecord): Promise<void> {
  await Bun.write(file, `${JSON.stringify(record, null, 2)}\n`);
}
