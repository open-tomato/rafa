/**
 * Tests for the board ingest over the fixture cache
 * (`testdata/board-cache.fixture.ts`), written in a tmpdir with invented
 * titles and bodies: the label objects read by name, the bug and epic
 * flags, each member's epic, the Stage by labels with a closed issue
 * still labelled `rafa:in-development` reading Done, the two plan shapes
 * and a bug with no plan, today's counts by stage carried between builds,
 * and the missing stamps of a root with no cache, or one that cannot be
 * read, while the build goes on. Each reading that could pass over an
 * empty table has a fixed value beside it.
 */
import type { BoardIngest } from './board.js';
import type { SourceStamp } from '@open-tomato/atlas-data/replica';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';
import { STAGE_OPTIONS } from '@open-tomato/rafa-board/board/project/options';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_SOURCE, ingestBoard, ISSUES_SOURCE, parseBoardCache, planStubOf, UNREAD_ISSUE_COLUMNS } from './board.js';
import {
  boardCacheText,
  FIXTURE_EPIC,
  FIXTURE_EPIC_SLUG,
  FIXTURE_ROWS,
  FIXTURE_WATERMARK,
  fixtureRow,
  FOLLOW_UPS_PLAN,
  planBlockBody,
  writeBoardFixture,
} from './testdata/board-cache.fixture.js';
import { FIXTURE_PLAN } from './testdata/effort-store.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-ingest-board-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const READ_AT = new Date('2026-11-06T12:00:00.000Z');
const WATERMARK_ISO = new Date(FIXTURE_WATERMARK).toISOString();

type Row = Readonly<Record<string, string | number | null>>;

/** What one ingest into a replica wrote. */
interface Ingested {
  readonly ingest: BoardIngest;
  readonly issues: readonly Row[];
  readonly snapshot: readonly Row[];
  readonly stamps: readonly SourceStamp[];
}

let built = 0;

/** Run the ingest over `root` into the replica at `replicaPath` (a fresh one by default); answers its result and the rows written. */
async function ingestAt(root: string, now: Date = READ_AT, replicaPath?: string): Promise<Ingested> {
  built += 1;
  const path = replicaPath ?? join(scope, 'replicas', String(built), 'atlas.sqlite');
  const result = await writeReplica({ replicaPath: path, projectLabel: 'board-fixture' }, (build) => {
    const ingest = ingestBoard(build, { root, now: () => now });
    return { ingest, issues: build.database.query<Row, []>('SELECT * FROM issue_facts ORDER BY number').all() };
  });
  const replica = new Database(path, { readonly: true });
  try {
    return {
      ...result.value,
      snapshot: replica.query<Row, []>('SELECT * FROM board_snapshot ORDER BY day, stage').all(),
      stamps: replica.query<Row, []>('SELECT * FROM atlas_sources ORDER BY source').all()
        .map((row) => ({
          source: String(row['source']),
          asOf: row['as_of'] === null
            ? null
            : String(row['as_of']),
          readAt: String(row['read_at']),
          rows: Number(row['rows']),
          partial: row['partial'] === 1,
          reason: row['reason'] === null
            ? null
            : String(row['reason']),
        })),
    };
  } finally {
    replica.close();
  }
}

/** A root holding the fixture cache, or `text` as the cache. */
function rootWith(name: string, text?: string): string {
  const root = join(scope, name);
  writeBoardFixture(root, text);
  return root;
}

let fixture: Promise<Ingested> | undefined;

/** The fixture cache's one ingest, shared by the cases that only read it. */
function fixtureIngest(): Promise<Ingested> {
  fixture ??= ingestAt(rootWith('fixture'));
  return fixture;
}

/** The `issue_facts` row of issue `number`, or a failed expectation. */
function issue(rows: readonly Row[], number: number): Row {
  const row = rows.find((each) => each['number'] === number);
  expect(row).toBeDefined();
  return row ?? {};
}

describe('ingestBoard, issue_facts', () => {
  it('writes one row per cache row, with the label objects read by name', async () => {
    const { issues, ingest } = await fixtureIngest();

    expect(issues.map((row) => row['number'])).toEqual([7, 40, 42, 50, 51, 52, 53]);
    expect(ingest).toEqual(expect.objectContaining({ read: true, issues: FIXTURE_ROWS.length, skipped: 0 }));
    expect(JSON.parse(String(issue(issues, 42)['labels_json']))).toEqual(['type:spec', 'spec:ready', `epic:${FIXTURE_EPIC_SLUG}`]);
    expect(issue(issues, 42)).toEqual(expect.objectContaining({ title: 'Spec: the notes page', state: 'OPEN', state_reason: null }));
    expect(issue(issues, 51)).toEqual(expect.objectContaining({ state: 'CLOSED', state_reason: 'NOT_PLANNED' }));
  });

  it('flags type:bug and a bare bug label as bugs, and type:epic as the epic', async () => {
    const { issues } = await fixtureIngest();

    expect(issues.filter((row) => row['is_bug'] === 1).map((row) => row['number'])).toEqual([50, 51, 52]);
    expect(issues.filter((row) => row['is_epic'] === 1).map((row) => row['number'])).toEqual([FIXTURE_EPIC]);
  });

  it('gives each member its epic\'s slug and number, the epic its slug and no parent, and an epic-less slug no parent', async () => {
    const { issues } = await fixtureIngest();

    expect(issue(issues, FIXTURE_EPIC)).toEqual(expect.objectContaining({ epic_slug: FIXTURE_EPIC_SLUG, parent_number: null }));
    expect(issue(issues, 42)).toEqual(expect.objectContaining({ epic_slug: FIXTURE_EPIC_SLUG, parent_number: FIXTURE_EPIC }));
    expect(issue(issues, 52)).toEqual(expect.objectContaining({ epic_slug: FIXTURE_EPIC_SLUG, parent_number: FIXTURE_EPIC }));
    expect(issue(issues, 53)).toEqual(expect.objectContaining({ epic_slug: 'lost-slug', parent_number: null }));
    expect(issue(issues, 7)).toEqual(expect.objectContaining({ epic_slug: null, parent_number: null }));
  });

  it('reads a closed issue still labelled rafa:in-development as Done, and only the open one as In development', async () => {
    const { issues } = await fixtureIngest();

    expect(JSON.parse(String(issue(issues, 7)['labels_json']))).toContain('rafa:in-development');
    expect(issue(issues, 7)['stage']).toBe('Done');
    expect(issue(issues, 50)['stage']).toBe('In development');
    expect(issues.filter((row) => row['stage'] === 'In development').map((row) => row['number'])).toEqual([50]);
  });

  it('reads every Stage from the labels, NULL for the epic, with labels as each row\'s basis', async () => {
    const { issues } = await fixtureIngest();

    expect(Object.fromEntries(issues.map((row) => [row['number'], row['stage']]))).toEqual({
      7: 'Done', 40: null, 42: 'Ready', 50: 'In development', 51: 'Cancelled', 52: 'Claimed', 53: 'Backlog',
    });
    expect(new Set(issues.map((row) => row['stage_basis']))).toEqual(new Set(['labels']));
  });

  it('gives the epic its horizon and every other issue none, and reads the module and priority labels', async () => {
    const { issues } = await fixtureIngest();

    expect(issues.filter((row) => row['horizon'] !== null).map((row) => [row['number'], row['horizon']])).toEqual([[FIXTURE_EPIC, 'now']]);
    expect(issue(issues, 50)).toEqual(expect.objectContaining({ module: 'notes', priority: 'high' }));
    expect(issue(issues, 51)).toEqual(expect.objectContaining({ module: 'cli-gap', priority: null }));
    expect(issue(issues, 52)).toEqual(expect.objectContaining({ module: null, priority: 'low' }));
  });

  it('reads the plan from a ## Plan block, then a follow-ups comment, and NULL for a bug with no plan', async () => {
    const { issues } = await fixtureIngest();

    expect(issue(issues, 50)['plan_stub']).toBe(FIXTURE_PLAN);
    expect(issue(issues, 51)['plan_stub']).toBe(FOLLOW_UPS_PLAN);
    expect(issue(issues, 52)).toEqual(expect.objectContaining({ is_bug: 1, plan_stub: null }));
  });

  it('leaves created_at and closed_at NULL, and stamps local.issues partial naming them, as of the watermark', async () => {
    const { issues, ingest } = await fixtureIngest();
    const stamp = ingest.stamps.find((each) => each.source === ISSUES_SOURCE);

    for (const row of issues) expect([row['created_at'], row['closed_at']]).toEqual([null, null]);
    expect(stamp).toEqual(expect.objectContaining({ asOf: WATERMARK_ISO, readAt: READ_AT.toISOString(), rows: 7, partial: true }));
    for (const column of UNREAD_ISSUE_COLUMNS) expect(stamp?.reason).toContain(column);
    expect(stamp?.reason).not.toContain('skipped');
  });

  it('leaves the parent NULL for a slug two epics carry, and keeps the one epic of another slug', async () => {
    const rows = [
      fixtureRow(1, ['type:epic', 'epic:twin']),
      fixtureRow(2, ['type:epic', 'epic:twin']),
      fixtureRow(3, ['type:epic', 'epic:solo']),
      fixtureRow(4, ['epic:twin']),
      fixtureRow(5, ['epic:solo']),
    ];
    const { issues } = await ingestAt(rootWith('twin-epics', boardCacheText(rows)));

    expect(issue(issues, 4)['parent_number']).toBeNull();
    expect(issue(issues, 5)['parent_number']).toBe(3);
  });
});

describe('ingestBoard, issue_type', () => {
  it('reads the value of one type label, the first of two, and NULL for none', async () => {
    const rows = [
      fixtureRow(1, ['spec:ready', 'type:spec']),
      fixtureRow(2, ['type:bug', 'type:debt']),
      fixtureRow(3, ['spec:ready', 'module:notes']),
    ];
    const { issues } = await ingestAt(rootWith('issue-types', boardCacheText(rows)));

    expect(issue(issues, 1)['issue_type']).toBe('spec');
    expect(issue(issues, 2)['issue_type']).toBe('bug');
    expect(issue(issues, 3)['issue_type']).toBeNull();
  });
});

describe('ingestBoard, board_snapshot', () => {
  it('counts today\'s issues of each of the eleven stages, zeros included, the epic counted in none', async () => {
    const { snapshot, ingest } = await fixtureIngest();
    const counts = Object.fromEntries(snapshot.map((row) => [row['stage'], row['count']]));

    expect(snapshot.map((row) => row['stage'])).toEqual([...STAGE_OPTIONS].sort());
    expect(new Set(snapshot.map((row) => row['day']))).toEqual(new Set(['2026-11-06']));
    expect(new Set(snapshot.map((row) => row['taken_at']))).toEqual(new Set([READ_AT.toISOString()]));
    expect(counts).toEqual(expect.objectContaining({
      'Backlog': 1, 'Ready': 1, 'Claimed': 1, 'In development': 1, 'Done': 1, 'Cancelled': 1, 'Triage': 0, 'In review': 0,
    }));
    expect(snapshot.reduce((sum, row) => sum + Number(row['count']), 0)).toBe(FIXTURE_ROWS.length - 1);
    expect(ingest.stamps.find((each) => each.source === BOARD_SOURCE)).toEqual({
      source: BOARD_SOURCE, asOf: WATERMARK_ISO, readAt: READ_AT.toISOString(), rows: STAGE_OPTIONS.length, partial: false, reason: null,
    });
  });

  it('keeps an earlier day\'s counts on the next build, and replaces today\'s with the second build of the day', async () => {
    const root = rootWith('carry');
    const replicaPath = join(scope, 'carry-replica', 'atlas.sqlite');
    await ingestAt(root, new Date('2026-11-05T09:00:00.000Z'), replicaPath);
    await ingestAt(root, new Date('2026-11-06T09:00:00.000Z'), replicaPath);
    writeBoardFixture(root, boardCacheText(FIXTURE_ROWS.filter((row) => row.number !== 42)));

    const { snapshot } = await ingestAt(root, new Date('2026-11-06T15:00:00.000Z'), replicaPath);
    const ready = Object.fromEntries(snapshot.filter((row) => row['stage'] === 'Ready').map((row) => [row['day'], row['count']]));

    expect(snapshot).toHaveLength(STAGE_OPTIONS.length * 2);
    expect(ready).toEqual({ '2026-11-05': 1, '2026-11-06': 0 });
  });
});

describe('ingestBoard, a cache it cannot read', () => {
  it('stamps both sources missing for a root with no cache, writes no row, and the build goes on', async () => {
    const root = join(scope, 'no-cache');
    const { ingest, issues, snapshot, stamps } = await ingestAt(root);

    expect(ingest).toEqual(expect.objectContaining({ read: false, issues: 0, snapshotRows: 0 }));
    expect(issues).toEqual([]);
    expect(snapshot).toEqual([]);
    expect(stamps.map((stamp) => [stamp.source, stamp.rows, stamp.partial, stamp.asOf])).toEqual([
      [BOARD_SOURCE, 0, true, null], [ISSUES_SOURCE, 0, true, null],
    ]);
    expect(stamps[0]?.reason).toBe('no board cache read: no file at .rafa/cache/board.json');
  });

  it('reads a cache that does not parse, or of another version, as no cache, naming why', async () => {
    const broken = await ingestAt(rootWith('broken', '{"version": 1, "rows": ['));
    const later = await ingestAt(rootWith('version-2', JSON.stringify({ version: 2, watermark: FIXTURE_WATERMARK, rows: [] })));

    expect(broken.ingest.read).toBe(false);
    expect(broken.ingest.stamps[0]?.reason).toContain('does not parse as JSON');
    expect(later.ingest.stamps[1]?.reason).toBe('no board cache read: the cache is version 2, not 1');
  });

  it('skips a row whose labels are plain strings or whose number is held again, and names the count', async () => {
    const stringLabels = { ...fixtureRow(60, []), labels: ['type:bug'] };
    const rows = [fixtureRow(61, ['type:bug']), stringLabels, fixtureRow(61, ['type:bug', 'priority:low'])];
    const { issues, ingest } = await ingestAt(rootWith('skipped', boardCacheText(rows)));

    expect(issues.map((row) => [row['number'], row['priority']])).toEqual([[61, 'low']]);
    expect(ingest.skipped).toBe(2);
    expect(ingest.stamps[0]?.reason).toContain('2 cache rows were skipped');
  });
});

describe('planStubOf and parseBoardCache', () => {
  it('reads the ## Plan block before a follow-ups comment, and NULL for a body naming neither', () => {
    const both = `${planBlockBody('block-plan')}\n<!-- rafa:follow-ups comment-plan -->\n`;

    expect(planStubOf(both)).toBe('block-plan');
    expect(planStubOf('<!-- rafa:follow-ups comment-plan -->')).toBe('comment-plan');
    expect(planStubOf('## Plans ahead\n\n```\nnot-a-plan\n```\n')).toBeNull();
    expect(planStubOf('No plan here.')).toBeNull();
  });

  it('answers the watermark as ISO-8601 UTC, and refuses a cache with none', () => {
    const read = parseBoardCache(boardCacheText([]));
    const none = parseBoardCache(JSON.stringify({ version: 1, rows: [] }));

    expect(read).toEqual({ ok: true, watermark: WATERMARK_ISO, rows: [], skipped: 0 });
    expect(none).toEqual({ ok: false, reason: 'the cache holds no watermark time' });
  });
});
