/**
 * Tests for the tracker reference writer and reader.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every stored row is read through `bun:sqlite` directly and never
 * through the module, so the columns a reference fills and the JSON it is
 * stored as are spelled here rather than read off the code under test. A
 * finding a case needs beforehand is written by `writeFindings`, the
 * writer that fills the table first.
 *
 * Twenty-one mutations of the module were driven against this file
 * alone, with the unmutated module green twice before and once after each
 * grid and restored sha256-identical after every mutation. Eighteen of
 * the first twenty reddened the file's first 18 cases: a conflict
 * answered as held (1 red), the session left out of the lookup (2), the
 * newest reference answered (1), `warning` kept (2), the read's artifact
 * unchecked (1), the write's artifact unchecked (1), a finite `opt`
 * accepted (1), an absent store opened by a read (1), the attach also
 * setting `outcome` (1), stored text compared raw (1), a blank field
 * accepted untrimmed (1), the insert storing a null reference (9), an
 * undefined `url` accepted (1), another reference treated as unset (3),
 * a stored non-reference answered as-is (1), an array not refused (2),
 * the dispatch unchecked (1) and `module` dropped (1). A deferred
 * transaction stayed green, and reddens the lock case added for it
 * alone. The held path running an UPDATE that sets `tracker_ref` to
 * itself stays green: measured on SQLite 3.51.0, that update reports one
 * change and leaves the file's bytes and change counter as they were, so
 * no reading of the disk tells it from no update. The same path setting
 * `outcome` reddens both byte cases, the control that they can fail.
 *
 * That grid ran while the lookup answered the oldest reference, so its
 * "newest reference answered" mutation is now the module itself. Once
 * the lookup answered the newest and the superseding write came in, four
 * more mutations were driven against this file, the module restored
 * sha256-identical after each: the lookup in `ACROSS_STORES_ORDER`
 * forwards reddened 4 cases, the lookup by `seq` descending alone 2 (the
 * clock case and the merge case), the own-row refusal dropped 1, and a
 * `supersedes` equal to the reference let through 1. Once that refusal
 * became `SupersedeInSessionRefusal`, throwing a plain `Error` with its
 * message reddened 1, the own-row case.
 *
 * Measuring the merge case needs the merge itself, so it plants two
 * stores with origins and runs `mergeStore` both ways, as
 * `merge-store.test.ts` does.
 */
import type { FindingsWriterSeams } from './findings.js';
import type { TrackerRefWrite } from './tracker-refs.js';
import type { IssueRef } from '../../ports/index.js';
import type { ReportFinding } from '../../report/parse.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readProgressFindings, renderProgressText } from '../../utils/progress.js';

import { bringForward } from './bring-forward.js';
import { writeFindings } from './findings.js';
import { mergeStore } from './merge-store.js';
import { LEGACY_GATE_OPEN } from './migrations.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';
import { readTrackerRef, SupersedeInSessionRefusal, writeTrackerRef } from './tracker-refs.js';

/** A findings row as the table holds it. */
interface StoredFinding {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  kind: string | null;
  trigger: string | null;
  what: string | null;
  cause: string | null;
  resolution: string | null;
  artifact: string | null;
  signal: string | null;
  outcome: string;
  tracker_ref: string | null;
  collected_at: string;
  origin_store: string | null;
  origin_seq: number | null;
}

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-tracker-refs-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** The store file under a root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** The store file's bytes, or null when nothing was ever written. */
function readRaw(root: string): Buffer | null {
  const path = storeFile(root);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/** Runs one query against the store file, read-only, module uninvolved. */
function rawQuery<T>(root: string, sql: string): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

/** Runs one statement against an existing store file, module uninvolved. */
function rawRun(root: string, sql: string, ...bindings: string[]): void {
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    db.query<unknown, string[]>(sql).run(...bindings);
  } finally {
    db.close();
  }
}

/** Every findings row, in append order. */
function rowsOf(root: string): StoredFinding[] {
  return rawQuery<StoredFinding>(root, 'SELECT * FROM findings ORDER BY seq');
}

/** One column of every findings row, in append order. */
function columnOf(root: string, column: keyof StoredFinding): unknown[] {
  return rowsOf(root).map((row) => row[column]);
}

/** Inserts a row by hand holding `trackerRef` under `artifact`, bypassing both writers. */
function plantRef(root: string, sessionId: string, artifact: string, trackerRef: string): void {
  rawRun(
    root,
    'INSERT INTO findings (id, session_id, task_line, artifact, outcome, tracker_ref, collected_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    `planted-${planted}-${sessionId}-${artifact}`,
    sessionId,
    'A planted task',
    artifact,
    'done',
    trackerRef,
    '2026-09-15T00:00:00.000Z',
  );
}

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** A reference one store holds under {@link ARTIFACT}, as one session wrote it at `at`. */
interface PlantedRef {
  readonly sessionId: string;
  readonly externalId: string;
  readonly at: string;
}

/** A store of one origin and the references it holds, in append order. */
interface PlantedStore {
  readonly storeId: string;
  readonly refs: readonly PlantedRef[];
}

/**
 * Makes the store at `path` and plants `store`'s identity and references,
 * stamped as a production insert stamps them. A store under the temp
 * directory outside a repository is never minted, so `store_meta` is
 * planted by hand, as `merge-store.test.ts` plants it.
 */
function plantStore(path: string, store: PlantedStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { identity: INSTALLED });
    db.query(
      'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
        + ' VALUES (1, ?, \'root-commit-1\', NULL, \'host\', ?, 1, 1, \'2026-09-15T00:00:00.000Z\')',
    ).run(store.storeId, path);
    for (const [index, planted] of store.refs.entries()) {
      const seq = index + 1;
      db.query(
        'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, artifact, outcome, tracker_ref, collected_at)'
          + ' VALUES (?, ?, ?, ?, ?, \'A merged task\', ?, \'done\', ?, ?)',
      ).run(seq, store.storeId, seq, `${store.storeId}-${seq}`, planted.sessionId, ARTIFACT, localJson(planted.externalId), planted.at);
    }
  } finally {
    db.close();
  }
}

/** A repo root whose store holds `here` with `there` merged into it by `mergeStore`. */
function mergedRoot(name: string, here: PlantedStore, there: PlantedStore): string {
  const root = freshRoot(name);
  const otherPath = join(`${root}-other`, 'effort.sqlite');
  plantStore(storeFile(root), here);
  plantStore(otherPath, there);

  const merged = mergeStore({
    path: storeFile(root),
    otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: '20260915T120000Z',
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    newMergeId: () => `merge-${name}`,
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
    isAlive: () => false,
  });
  expect([merged.status, merged.rowsAdded, merged.rowsInConflict]).toEqual(['merged', there.refs.length, 0]);
  return root;
}

/** The artifact most cases file under. */
const ARTIFACT = 'Cannot find package';

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'bbbb-2222',
  planStub: 'phase-1',
  taskLine: 'Add the triage module',
};

/** A `local` reference, as the local adapter answers one, unless overridden. */
function ref(overrides: Partial<IssueRef> = {}): IssueRef {
  return { opt: 0, kind: 'local', externalId: '1', url: null, ...overrides };
}

/** The JSON {@link ref} is stored as, with only `externalId` varied. */
function localJson(externalId: string): string {
  return `{"opt":0,"kind":"local","externalId":"${externalId}","url":null}`;
}

/** A write of {@link ref} under {@link ARTIFACT} and the default dispatch, outcome `done`. */
function writeOf(overrides: Partial<TrackerRefWrite> = {}): TrackerRefWrite {
  return { dispatch: DISPATCH, outcome: 'done', artifact: ARTIFACT, ref: ref(), ...overrides };
}

/** A finding as `parseReport` answers one, under {@link ARTIFACT}. */
function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    trigger: 'when running bun test under a fresh worktree',
    kind: 'gotcha',
    what: 'node_modules is absent after fork',
    cause: 'worktree creation does not run bun install',
    resolution: 'run bun install before the first test',
    artifact: ARTIFACT,
    signal: 'loud',
    domain: null,
    extras: [],
    ...overrides,
  };
}

/** Ids no other case generates, and a clock fixed at `at`. */
function seams(prefix: string, at = '2026-09-15T10:00:00.000Z'): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date(at),
    newId: () => {
      count += 1;
      return `${prefix}-${count}`;
    },
  };
}

/** What `call` throws. Fails the case when it throws nothing. */
function caught(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw, and none came');
}

/** The dispatch of another session than {@link DISPATCH}'s. */
function sessionOf(sessionId: string): typeof DISPATCH {
  return { ...DISPATCH, sessionId };
}

/** The `tracker_ref` of every row under {@link ARTIFACT}, in append order. */
function refsUnderArtifact(root: string): unknown[] {
  return rowsOf(root)
    .filter((row) => row.artifact === ARTIFACT)
    .map((row) => row.tracker_ref);
}

describe('writeTrackerRef', () => {
  it('inserts a row holding the dispatch, the artifact and the reference when the session holds none', () => {
    const root = freshRoot('insert');

    const result = writeTrackerRef(root, writeOf(), seams('insert'));

    expect(result).toEqual({ path: storeFile(root), action: 'inserted', stored: ref() });
    expect(rowsOf(root)).toEqual([{
      seq: 1,
      id: 'insert-1',
      session_id: 'bbbb-2222',
      plan_stub: 'phase-1',
      task_line: 'Add the triage module',
      kind: null,
      trigger: null,
      what: null,
      cause: null,
      resolution: null,
      artifact: ARTIFACT,
      signal: null,
      outcome: 'done',
      tracker_ref: localJson('1'),
      collected_at: '2026-09-15T10:00:00.000Z',
      origin_store: null,
      origin_seq: null,
    }]);
  });

  it('sets the reference on the finding the session reported under the artifact, and nothing else', () => {
    const root = freshRoot('attach');
    const dispatchOnly = { dispatch: DISPATCH, outcome: 'done' as const };
    writeFindings(root, { ...dispatchOnly, findings: [finding()] }, seams('attach-finding'));
    const before = rowsOf(root);

    const result = writeTrackerRef(root, writeOf({ outcome: 'blocked' }), seams('attach'));

    expect(result).toEqual({ path: storeFile(root), action: 'attached', stored: ref() });
    expect(before).toHaveLength(1);
    expect(rowsOf(root)).toEqual(before.map((row) => ({ ...row, tracker_ref: localJson('1') })));
  });

  it('writes no byte when the row already holds the same reference', () => {
    const root = freshRoot('held');
    writeTrackerRef(root, writeOf(), seams('held-first'));
    const bytes = readRaw(root);
    const reordered = { url: null, externalId: '1', kind: 'local', opt: 0 };

    const result = writeTrackerRef(root, writeOf({ ref: reordered }), seams('held-again'));

    expect(result).toEqual({ path: storeFile(root), action: 'held', stored: ref() });
    expect(readRaw(root)).toEqual(bytes);
  });

  it('keeps another reference the row already holds, writing no byte, and answers the one it keeps', () => {
    const root = freshRoot('conflict');
    writeTrackerRef(root, writeOf(), seams('conflict-first'));
    const bytes = readRaw(root);

    const second = writeOf({ ref: ref({ externalId: '2' }) });
    const result = writeTrackerRef(root, second, seams('conflict-second'));

    expect(result).toEqual({ path: storeFile(root), action: 'conflict', stored: ref() });
    expect(readRaw(root)).toEqual(bytes);
  });

  it('takes the write lock before it looks the row up, even for a reference it holds', () => {
    const root = freshRoot('lock');
    writeTrackerRef(root, writeOf(), seams('lock'));
    const other = new Database(storeFile(root), { readwrite: true, create: false });
    try {
      other.run('BEGIN IMMEDIATE');
      // The store's open waits out its busy timeout for the lock before
      // it throws, so this case takes that long.
      expect(() => writeTrackerRef(root, writeOf())).toThrow(/database is locked/);
      other.run('ROLLBACK');
    } finally {
      other.close();
    }

    expect(writeTrackerRef(root, writeOf()).action).toBe('held');
  }, 15_000);

  it('keys the row by the session and the artifact byte for byte', () => {
    const root = freshRoot('keys');
    const otherSession = { ...DISPATCH, sessionId: 'cccc-3333' };

    const actions = [
      writeOf(),
      writeOf({ dispatch: otherSession, ref: ref({ externalId: '2' }) }),
      writeOf({ artifact: 'cannot find package', ref: ref({ externalId: '3' }) }),
      writeOf({ artifact: `${ARTIFACT} `, ref: ref({ externalId: '4' }) }),
    ].map((write, index) => writeTrackerRef(root, write, seams(`keys-${index}`)).action);

    expect(actions).toEqual(['inserted', 'inserted', 'inserted', 'inserted']);
    expect(rowsOf(root).map(({ session_id, artifact, tracker_ref }) => [session_id, artifact, tracker_ref]))
      .toEqual([
        ['bbbb-2222', ARTIFACT, localJson('1')],
        ['cccc-3333', ARTIFACT, localJson('2')],
        ['bbbb-2222', 'cannot find package', localJson('3')],
        ['bbbb-2222', `${ARTIFACT} `, localJson('4')],
      ]);
  });

  it('stores the reference in one key order, without its warning, with module and repo when given', () => {
    const root = freshRoot('stored-form');
    const filed = {
      warning: 'board placement failed',
      repo: 'open-tomato/rafa',
      module: 'auth',
      url: 'https://github.com/open-tomato/rafa/issues/7',
      externalId: '7',
      kind: 'github',
      opt: 260,
    };

    const result = writeTrackerRef(root, writeOf({ ref: filed }), seams('stored-form'));

    expect(columnOf(root, 'tracker_ref')).toEqual([
      '{"opt":260,"kind":"github","externalId":"7",'
        + '"url":"https://github.com/open-tomato/rafa/issues/7","module":"auth","repo":"open-tomato/rafa"}',
    ]);
    expect(Object.keys(result.stored)).toEqual(['opt', 'kind', 'externalId', 'url', 'module', 'repo']);
    expect(writeTrackerRef(root, writeOf({ ref: result.stored }), seams('stored-again')).action)
      .toBe('held');
  });

  it('answers back unchanged a reference holding a lone UTF-16 surrogate, which JSON escapes', () => {
    const root = freshRoot('surrogate');
    const lone = `ab${String.fromCharCode(0xd800)}`;

    writeTrackerRef(root, writeOf({ ref: ref({ externalId: lone }) }), seams('surrogate'));

    expect(columnOf(root, 'tracker_ref')).toEqual([localJson('ab\\ud800')]);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref({ externalId: lone }));
  });

  it('leaves a finding written after the reference under its session and artifact unstored', () => {
    const root = freshRoot('order');
    writeTrackerRef(root, writeOf(), seams('order-ref'));

    const later = writeFindings(
      root,
      { dispatch: DISPATCH, outcome: 'done', findings: [finding()] },
      seams('order-finding'),
    );

    expect([later.appended, later.skipped, later.rejected]).toEqual([0, 1, []]);
    expect(columnOf(root, 'trigger')).toEqual([null]);
  });

  it('inserts a row progress.txt renders as a bullet headed by its artifact', () => {
    const root = freshRoot('progress');
    writeTrackerRef(root, writeOf(), seams('progress'));

    expect(renderProgressText(readProgressFindings(root, 'phase-1')).text)
      .toBe(`- artifact: ${ARTIFACT}\n`);
  });

  it('refuses a write it cannot store before opening the store', () => {
    const lone = `x${String.fromCharCode(0xdc00)}`;
    const refusals: readonly (readonly [TrackerRefWrite, RegExp])[] = [
      [writeOf({ artifact: null as never }), /has no artifact/],
      [writeOf({ artifact: 7 as never }), /has an artifact that is 7, not a string/],
      [writeOf({ artifact: ' \t' }), /has an artifact that is blank/],
      [writeOf({ artifact: lone }), /has an artifact that holds a lone UTF-16 surrogate/],
      [writeOf({ dispatch: { ...DISPATCH, sessionId: '' } }), /tracker ref write has session id ""/],
      [writeOf({ outcome: 'passed' as never }), /tracker ref write has outcome "passed"/],
      [writeOf({ ref: null as never }), /has a reference that is null, not an object/],
      [writeOf({ ref: [] as never }), /has a reference that is an array, not an object/],
      [writeOf({ ref: ref({ opt: 1.5 }) }), /whose opt is 1.5, not a safe integer/],
      [writeOf({ ref: ref({ opt: '260' as never }) }), /whose opt is "260", not a safe integer/],
      [writeOf({ ref: ref({ kind: '' }) }), /whose kind is blank/],
      [writeOf({ ref: ref({ externalId: ' ' }) }), /whose externalId is blank/],
      [writeOf({ ref: ref({ externalId: 7 as never }) }), /whose externalId is 7, not a string/],
      [writeOf({ ref: ref({ url: undefined as never }) }), /whose url is undefined, not a string or null/],
      [writeOf({ ref: ref({ module: 7 as never }) }), /whose module is 7, not a string/],
      [writeOf({ ref: ref({ repo: null as never }) }), /whose repo is null, not a string/],
      [writeOf({ supersedes: null as never }), /supersedes a reference that is null, not an object/],
      [writeOf({ supersedes: ref({ kind: '' }) }), /supersedes a reference whose kind is blank/],
      [writeOf({ supersedes: { url: null, externalId: '1', kind: 'local', opt: 0 } }), /supersedes the reference it writes/],
    ];
    const existing = freshRoot('refused-existing');
    writeTrackerRef(existing, writeOf({ artifact: 'unrelated' }), seams('refused-existing'));
    const bytes = readRaw(existing);

    for (const [index, [write, pattern]] of refusals.entries()) {
      const absent = freshRoot(`refused-${index}`);
      expect(() => writeTrackerRef(absent, write)).toThrow(pattern);
      expect(() => writeTrackerRef(absent, write)).toThrow(/; nothing written$/);
      expect(existsSync(absent)).toBe(false);
      expect(() => writeTrackerRef(existing, write)).toThrow(pattern);
    }
    expect(readRaw(existing)).toEqual(bytes);
  });

  it('inserts a superseding reference from a later session as a row of its own, keeping the one it supersedes', () => {
    const root = freshRoot('supersede');
    writeTrackerRef(root, writeOf(), seams('supersede-1', '2026-09-15T10:00:00.000Z'));
    const [filed] = rowsOf(root);
    const superseding = writeOf({ dispatch: sessionOf('cccc-3333'), ref: ref({ externalId: '2' }), supersedes: ref() });

    const result = writeTrackerRef(root, superseding, seams('supersede-2', '2026-09-15T11:00:00.000Z'));

    expect(result).toEqual({ path: storeFile(root), action: 'inserted', stored: ref({ externalId: '2' }) });
    expect(rowsOf(root)[0]).toEqual(filed);
    expect(refsUnderArtifact(root)).toEqual([localJson('1'), localJson('2')]);
    expect(columnOf(root, 'session_id')).toEqual(['bbbb-2222', 'cccc-3333']);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref({ externalId: '2' }));
  });

  it('places a superseding write as any other when the session\'s row does not hold the superseded reference', () => {
    const root = freshRoot('supersede-placed');
    writeTrackerRef(root, writeOf(), seams('supersede-placed-0'));
    const later = sessionOf('cccc-3333');
    writeFindings(root, { dispatch: later, outcome: 'done', findings: [finding()] }, seams('supersede-placed-1'));
    const superseding = writeOf({ dispatch: later, ref: ref({ externalId: '2' }), supersedes: ref() });

    const actions = [superseding, superseding, writeOf({ ...superseding, ref: ref({ externalId: '3' }) })]
      .map((write, index) => writeTrackerRef(root, write, seams(`supersede-placed-${index + 2}`)).action);

    expect(actions).toEqual(['attached', 'held', 'conflict']);
    expect(refsUnderArtifact(root)).toEqual([localJson('1'), localJson('2')]);
  });

  it('refuses a superseding write in one session onto its own row holding the superseded reference, writing no byte', () => {
    const root = freshRoot('supersede-own');
    writeTrackerRef(root, writeOf(), seams('supersede-own-1', '2026-09-15T10:00:00.000Z'));
    const bytes = readRaw(root);
    const superseding = writeOf({ ref: ref({ externalId: '2' }), supersedes: ref() });

    const thrown = caught(() => writeTrackerRef(root, superseding, seams('supersede-own-2', '2026-09-15T11:00:00.000Z')));

    expect(thrown).toBeInstanceOf(SupersedeInSessionRefusal);
    expect(thrown).toMatchObject({ name: 'SupersedeInSessionRefusal', path: storeFile(root), seq: 1 });
    expect((thrown as Error).message)
      .toMatch(/tracker ref write supersedes the reference findings row 1 holds for this session and artifact, .*; nothing written$/);

    expect(readRaw(root)).toEqual(bytes);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref());
    // Controls: without `supersedes` the same write is the conflict it was,
    // a write refused for superseding itself is not of this class, and the
    // schema itself refuses the row a superseding insert would add.
    expect(writeTrackerRef(root, writeOf({ ref: ref({ externalId: '2' }) })).action).toBe('conflict');
    expect(caught(() => writeTrackerRef(root, writeOf({ supersedes: ref() })))).not.toBeInstanceOf(SupersedeInSessionRefusal);
    expect(() => plantRef(root, DISPATCH.sessionId, ARTIFACT, localJson('2')))
      .toThrow(/UNIQUE constraint failed: findings\.session_id, findings\.artifact/);
  });

  it('refuses a store past this schema version, writing no byte', () => {
    const root = freshRoot('past');
    writeTrackerRef(root, writeOf({ artifact: 'unrelated' }), seams('past'));
    rawRun(root, `PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    const bytes = readRaw(root);

    expect(() => writeTrackerRef(root, writeOf())).toThrow(/has a migration log and schema version/);
    expect(() => readTrackerRef(root, ARTIFACT)).toThrow(/has a migration log and schema version/);
    expect(readRaw(root)).toEqual(bytes);
  });

  it('brings a version-1 store forward before writing', () => {
    const root = freshRoot('from-v1');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 1));
    db.close();

    expect(writeTrackerRef(root, writeOf(), seams('from-v1')).action).toBe('inserted');
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref());
  });
});

describe('readTrackerRef', () => {
  it('answers null for a store that does not exist, creating nothing', () => {
    const root = freshRoot('absent');

    expect(readTrackerRef(root, ARTIFACT)).toBeNull();
    expect(existsSync(root)).toBe(false);
  });

  it('answers null while no row holds a reference under exactly that artifact', () => {
    const root = freshRoot('none');
    writeFindings(root, { dispatch: DISPATCH, outcome: 'done', findings: [finding()] }, seams('none'));
    writeTrackerRef(root, writeOf({ artifact: 'another artifact' }), seams('none-other'));

    expect(readTrackerRef(root, ARTIFACT)).toBeNull();
    expect(readTrackerRef(root, 'cannot find package')).toBeNull();
    expect(readTrackerRef(root, 'another artifact')).toEqual(ref());
  });

  it('answers the newest reference stored under the artifact across two sessions, whatever plan stored it', () => {
    const root = freshRoot('newest');
    const unfiled = { sessionId: 'aaaa-1111', planStub: 'phase-0', taskLine: 'An earlier task' };
    writeFindings(root, { dispatch: unfiled, outcome: 'done', findings: [finding()] }, seams('newest-0'));
    const firstFiler = { sessionId: 'cccc-3333', planStub: null, taskLine: 'A global task' };
    const first = writeOf({ dispatch: firstFiler, ref: ref({ externalId: '5' }) });
    writeTrackerRef(root, first, seams('newest-1', '2026-09-15T10:00:00.000Z'));
    writeTrackerRef(root, writeOf({ ref: ref({ externalId: '6' }) }), seams('newest-2', '2026-09-15T11:00:00.000Z'));

    expect(columnOf(root, 'tracker_ref')).toEqual([null, localJson('5'), localJson('6')]);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref({ externalId: '6' }));
  });

  it('orders by the write\'s time before the append order, so a row stamped earlier answers older', () => {
    const root = freshRoot('by-time');
    writeTrackerRef(root, writeOf({ ref: ref({ externalId: '5' }) }), seams('by-time-1', '2026-09-15T11:00:00.000Z'));
    const later = writeOf({ dispatch: sessionOf('cccc-3333'), ref: ref({ externalId: '6' }) });
    writeTrackerRef(root, later, seams('by-time-2', '2026-09-15T10:00:00.000Z'));

    expect(columnOf(root, 'tracker_ref')).toEqual([localJson('5'), localJson('6')]);
    expect(readTrackerRef(root, ARTIFACT)).toEqual(ref({ externalId: '5' }));
  });

  it('answers a reference written from outside in the stored form, which a write then holds', () => {
    const root = freshRoot('outside');
    writeTrackerRef(root, writeOf({ artifact: 'unrelated' }), seams('outside'));
    plantRef(root, DISPATCH.sessionId, ARTIFACT, '{"url":null,"warning":"x","externalId":"9","kind":"local","opt":3}');

    const answered = readTrackerRef(root, ARTIFACT);

    expect(answered).toEqual(ref({ opt: 3, externalId: '9' }));
    expect(Object.keys(answered ?? {})).toEqual(['opt', 'kind', 'externalId', 'url']);
    expect(writeTrackerRef(root, writeOf({ ref: ref({ opt: 3, externalId: '9' }) })).action).toBe('held');
  });

  it('throws on a stored reference that is not one, naming its row, and so does a write onto it', () => {
    const root = freshRoot('corrupt');
    writeTrackerRef(root, writeOf({ artifact: 'unrelated' }), seams('corrupt'));
    const planted: readonly (readonly [string, RegExp])[] = [
      ['local#9', /findings row 2 holds a tracker_ref that is not JSON/],
      ['[]', /findings row 3 holds a tracker_ref that is an array, not an object/],
      ['{"opt":0,"kind":"local","url":null}', /findings row 4 holds a tracker_ref whose externalId is undefined/],
    ];

    for (const [index, [text, pattern]] of planted.entries()) {
      const artifact = `corrupt artifact ${index}`;
      plantRef(root, DISPATCH.sessionId, artifact, text);
      expect(() => readTrackerRef(root, artifact)).toThrow(pattern);
      expect(() => writeTrackerRef(root, writeOf({ artifact }))).toThrow(pattern);
    }
  });

  it('answers one newest reference on both sides of a merge, where the append order answers two', () => {
    const storeA: PlantedStore = { storeId: 'store-a', refs: [
      { sessionId: 's-1', externalId: '1', at: '2026-09-15T10:00:00.000Z' },
      { sessionId: 's-3', externalId: '3', at: '2026-09-15T11:00:00.000Z' },
    ] };
    const storeB: PlantedStore = { storeId: 'store-b', refs: [
      { sessionId: 's-2', externalId: '2', at: '2026-09-15T11:00:00.000Z' },
    ] };

    const aTookB = mergedRoot('a-took-b', storeA, storeB);
    const bTookA = mergedRoot('b-took-a', storeB, storeA);

    const lastBySeq = 'SELECT tracker_ref FROM findings ORDER BY seq DESC LIMIT 1';
    expect(rawQuery(aTookB, lastBySeq)).toEqual([{ tracker_ref: localJson('2') }]);
    expect(rawQuery(bTookA, lastBySeq)).toEqual([{ tracker_ref: localJson('3') }]);
    for (const root of [aTookB, bTookA]) {
      expect(refsUnderArtifact(root).toSorted()).toEqual([localJson('1'), localJson('2'), localJson('3')]);
      expect(readTrackerRef(root, ARTIFACT)).toEqual(ref({ externalId: '2' }));
    }
  });

  it('refuses an artifact it cannot look up, opening nothing', () => {
    const refusals: readonly (readonly [unknown, RegExp])[] = [
      [null, /tracker ref read has no artifact/],
      [7, /tracker ref read has an artifact that is 7, not a string/],
      ['', /tracker ref read has an artifact that is blank/],
      [`x${String.fromCharCode(0xd800)}`, /tracker ref read has an artifact that holds a lone UTF-16 surrogate/],
    ];
    const root = freshRoot('refused-read');

    for (const [artifact, pattern] of refusals) {
      expect(() => readTrackerRef(root, artifact as string)).toThrow(pattern);
    }
    expect(existsSync(root)).toBe(false);
  });
});
