/**
 * Tests for `daily.ts` over the ingest's fixture store, widened here with
 * a wrap-up, a ci-repair and a search session on days a task session also
 * ran, and one session with no start time. The day sums of
 * `daily_rollup` are checked against sums taken in TypeScript over the
 * replica's `task_facts`, per day and kind and in total; fixed values for
 * one day and a non-empty rollup keep that comparison from passing over
 * empty tables.
 */
import type { SourceStamp } from '@open-tomato/atlas-data/replica';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica, writeReplica } from '@open-tomato/atlas-data/replica';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { ingestEffort, TASKS_SOURCE } from '../ingest/effort.js';
import { sessionRow, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';

import { DAILY_SOURCE, KIND_COLUMNS, rollupDaily, UNDERIVED_COLUMNS } from './daily.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-daily-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The session with no start time, which lands in `task_facts` with no day. */
const DAYLESS_SESSION = 'session-dayless';

/** One `task_facts` row, the columns the rollup reads. */
interface FactRow {
  readonly session_id: string;
  readonly kind: string;
  readonly day: string | null;
  readonly minutes: number | null;
  readonly tokens: number | null;
}

type DailyRow = Readonly<Record<string, string | number | null>>;

/** The fixture store under `root`, with four more sessions appended through core's writer. */
function writeWideFixture(root: string): void {
  writeFixtureStore(root);
  openSqliteStore(root).append('sessions', [
    sessionRow({ sessionId: 'session-wrap', kind: 'wrap-up', first: '2026-11-02T12:00:00.000Z', last: '2026-11-02T12:20:00.000Z' }),
    sessionRow({
      sessionId: 'session-repair',
      kind: 'ci-repair',
      first: '2026-11-03T11:00:00.000Z',
      last: '2026-11-03T11:10:00.000Z',
      tokens: { inputTokens: 7 },
    }),
    sessionRow({
      sessionId: 'session-search',
      kind: 'search',
      first: '2026-11-03T08:00:00.000Z',
      last: '2026-11-03T08:06:00.000Z',
      tokens: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 },
    }),
    sessionRow({ sessionId: DAYLESS_SESSION, kind: 'task', first: '', last: '2026-11-03T09:00:00.000Z' }),
  ]);
}

/** Build a replica under a fresh root with the ingest and the rollup; answers its rows and the daily stamp. */
async function build(name: string): Promise<{ facts: FactRow[]; days: DailyRow[]; stamp: SourceStamp }> {
  const root = join(scope, name);
  writeWideFixture(root);
  const replicaPath = join(root, '.rafa', 'atlas', 'atlas.sqlite');
  const result = await writeReplica({ replicaPath, projectLabel: 'fixture' }, (replica) => {
    const effort = ingestEffort(replica, { root, env: {} });
    return rollupDaily(replica, effort.stamp);
  });
  const reader = openReplica(replicaPath);
  try {
    const { database } = reader.current();
    return {
      facts: database.query<FactRow, []>('SELECT session_id, kind, day, minutes, tokens FROM task_facts').all(),
      days: database.query<DailyRow, []>('SELECT * FROM daily_rollup ORDER BY day').all(),
      stamp: result.value,
    };
  } finally {
    reader.close();
  }
}

/** The column suffix a kind sums into, as the test reads `KIND_COLUMNS`. */
function suffixOf(kind: string): string {
  return KIND_COLUMNS[kind] ?? 'other';
}

/** The sum of `pick` over the facts of `day`, of the suffix `suffix` when one is given. */
function sumOf(facts: readonly FactRow[], day: string, pick: (fact: FactRow) => number | null, suffix?: string): number {
  return facts
    .filter((fact) => fact.day === day && (suffix === undefined || suffixOf(fact.kind) === suffix))
    .reduce((sum, fact) => sum + (pick(fact) ?? 0), 0);
}

const SUFFIXES = ['task', 'plan', 'wrap_up', 'ci_repair', 'other'];

describe('rollupDaily, day sums against task sums', () => {
  it('sums each day\'s minutes and tokens per kind to the task_facts sums of that day', async () => {
    const { facts, days } = await build('per-kind');

    const factDays = [...new Set(facts.map((fact) => fact.day).filter((day): day is string => day !== null))].sort();
    expect(days.map((row) => row.day)).toEqual(factDays);
    expect(days).toHaveLength(4);
    for (const row of days) {
      const day = String(row.day);
      for (const suffix of SUFFIXES) {
        expect(row[`minutes_${suffix}`]).toBeCloseTo(sumOf(facts, day, (fact) => fact.minutes, suffix), 9);
        expect(row[`tokens_${suffix}`]).toBe(sumOf(facts, day, (fact) => fact.tokens, suffix));
      }
      expect(row.tokens_total).toBe(sumOf(facts, day, (fact) => fact.tokens));
    }
  });

  it('control: the comparison runs over filled days, with known values for one of them', async () => {
    const { days } = await build('known-values');
    const fixtureTokens = 100 + 20 + 300 + 4_000;

    const second = days.find((row) => row.day === '2026-11-02');
    const third = days.find((row) => row.day === '2026-11-03');

    expect(second).toEqual(expect.objectContaining({
      minutes_task: 30,
      minutes_wrap_up: 20,
      minutes_plan: 0,
      tokens_task: fixtureTokens,
      tokens_wrap_up: fixtureTokens,
      tokens_total: 2 * fixtureTokens,
    }));
    expect(third).toEqual(expect.objectContaining({
      minutes_task: 45,
      minutes_ci_repair: 10,
      minutes_other: 6,
      tokens_ci_repair: 7 + 20 + 300 + 4_000,
      tokens_other: 1 + 2 + 3 + 4,
    }));
  });

  it('equals the task sums across all days, less the session that has no day', async () => {
    const { facts, days } = await build('totals');

    const dayless = facts.find((fact) => fact.session_id === DAYLESS_SESSION);
    const allTokens = facts.reduce((sum, fact) => sum + (fact.tokens ?? 0), 0);
    const allMinutes = facts.reduce((sum, fact) => sum + (fact.minutes ?? 0), 0);
    const dayTokens = days.reduce((sum, row) => sum + Number(row.tokens_total), 0);
    const dayMinutes = days.reduce((sum, row) => sum + SUFFIXES.reduce((acc, suffix) => acc + Number(row[`minutes_${suffix}`]), 0), 0);

    expect(dayless).toEqual(expect.objectContaining({ day: null, minutes: null }));
    expect(dayTokens).toBe(allTokens - (dayless?.tokens ?? 0));
    expect(dayless?.tokens).toBeGreaterThan(0);
    expect(dayMinutes).toBeCloseTo(allMinutes, 9);
    expect(dayMinutes).toBeGreaterThan(0);
  });
});

describe('rollupDaily, the stamp and the columns left NULL', () => {
  it('leaves every underived column NULL and stamps local.daily partial, naming them', async () => {
    const { days, stamp } = await build('stamp');

    for (const row of days) {
      for (const column of UNDERIVED_COLUMNS) expect(row[column]).toBeNull();
    }
    expect(stamp).toEqual(expect.objectContaining({ source: DAILY_SOURCE, rows: days.length, partial: true }));
    for (const column of UNDERIVED_COLUMNS) expect(stamp.reason).toContain(column);
    expect(stamp.reason).not.toContain(TASKS_SOURCE);
  });
});
