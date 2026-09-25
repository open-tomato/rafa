/**
 * Tests for the `local` Learning adapter (`src/adapters/learning/local.ts`).
 *
 * Every directory is made under one temporary directory this file
 * creates and removes, and a case that names a path holds it under that
 * directory. No case writes under the repository or the home. What a
 * push did is read off the disk, the `.md` files through
 * `parseInstinct` and the push log line by line, with the file names
 * spelled here, as well as through the result it answered and a pull.
 *
 * Each refusal sits beside a control that what it refused is otherwise
 * accepted: the refused payloads beside the boundaries they sit on and
 * the same payload once mended, the refused flag beside a flag the same
 * adapter writes, the rejected pull over a torn flag line beside the
 * pull once the line is gone. A refused push is read as writing nothing
 * by the whole directory, every file's bytes, before and after.
 *
 * Six mutations of `local.ts` were driven on 2026-09-25 over this file,
 * one run each, with 59 pass before and the module restored
 * byte-identical (sha256) after, and every one reddened at least one
 * case: the removals skipped reddened the discarded case and the
 * later-id collapse case; an unchanged file rewritten reddened the
 * repeated-push case alone; the read-back check dropped reddened the
 * three read-back refusals and the batch case; no push-log line written
 * reddened nineteen cases; and each overwrite guard dropped reddened
 * its own refusal alone.
 */
import type { HeldDescription } from './held.js';
import type { DescribedInstinctRecord, LocalLearningOptions, PushLogLine } from './local.js';
import type { InstinctRecord, Learning, Output, SyncPayload } from '../../ports/index.js';
import type { Instinct } from '../../schema/instinct.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { actionHash } from '../../learning/index.js';
import { parseInstinct, writeInstinct } from '../../schema/instinct.js';
import { setActiveOutput } from '../output/active.js';

import { createLocalLearning, localInstinctsDir } from './local.js';

/** The instant every adapter here is stamped from. */
const NOW = '2026-09-14T10:00:00.000Z';

/** When every record here was first written, before {@link NOW}. */
const EARLIER = '2026-09-13T10:00:00.000Z';

/** The push log. */
const INSTINCTS_FILE = 'instincts.ndjson';

/** The file flags land in. */
const FLAGS_FILE = 'flags.ndjson';

/** What every push refusal opens with. */
const PUSH_REFUSAL = 'local learning: refused to store a push: ';

/** The trigger every record here is on, unless a case says otherwise. */
const TRIGGER = 'a test fails under the full suite and passes alone';

/** The action every record here takes, unless a case says otherwise. */
const ACTION = 'find the file that runs before it and the state it leaves';

/** A second action on {@link TRIGGER}. */
const RIVAL = 'rerun the suite until it passes';

/** What a `task-report` record's file says beside the merge fields. */
const DESCRIPTION: HeldDescription = {
  kind: 'gotcha',
  domain: 'testing',
  scope: 'project',
  source: 'task-report',
  evidence: [{ plan: 'rafa-25', task: 2, session: 'session-1', outcome: 'done' }],
  cause: 'an earlier file leaves state behind',
  projectId: null,
};

let tempDir = '';
let made = 0;

/** A directory of its own under this file's temporary directory, not yet on disk. */
function freshDir(name: string): string {
  made += 1;
  return join(tempDir, `${made}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-local-learning-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

/**
 * A described record with any field replaced, its `action_hash` that of
 * its action unless the case names one.
 */
function lesson(overrides: Partial<DescribedInstinctRecord> = {}): DescribedInstinctRecord {
  const record: DescribedInstinctRecord = {
    id: 'lesson-a',
    trigger: TRIGGER,
    action: ACTION,
    action_hash: '',
    confidence: 0.5,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: EARLIER,
    updated_at: EARLIER,
    description: DESCRIPTION,
    ...overrides,
  };
  return { ...record, action_hash: overrides.action_hash ?? actionHash(record.action) };
}

/** `record` without its description: the port's record alone. */
function bare(record: DescribedInstinctRecord): InstinctRecord {
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => key !== 'description')) as unknown as InstinctRecord;
}

/** A payload from one source. */
function payload(instincts: InstinctRecord[], sourceId = 'session-1'): SyncPayload {
  return { source_id: sourceId, instincts };
}

/** A local learning adapter over `instinctsDir`, stamped from {@link NOW}, keeping each report in `warned`. */
function localLearning(
  instinctsDir: string,
  warned: string[] = [],
  options: Partial<LocalLearningOptions> = {},
): Learning {
  return createLocalLearning({
    instinctsDir,
    now: () => NOW,
    warn: (message) => {
      warned.push(message);
    },
    ...options,
  });
}

/** Each line of the push log, parsed. */
function logOf(dir: string): PushLogLine[] {
  return readFileSync(join(dir, INSTINCTS_FILE), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as PushLogLine);
}

/** Each line of the flags file, parsed. */
function flagsOf(dir: string): unknown[] {
  return readFileSync(join(dir, FLAGS_FILE), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

/** The instinct `<id>.md` under `dir` holds, failing the case when it does not read. */
function heldFile(dir: string, id: string): Instinct {
  const parsed = parseInstinct(readFileSync(join(dir, `${id}.md`), 'utf8'));
  expect(parsed.issues).toEqual([]);
  return parsed.instinct!;
}

/** Every file under `dir` and its bytes, in name order: what a refusal must leave as it was. */
function snapshot(dir: string): [name: string, bytes: string][] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);
}

/** Writes `instinct` as `<file>` under `dir`, making the directory. */
function plant(dir: string, instinct: Instinct, file = `${instinct.id}.md`): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), writeInstinct(instinct));
}

/** A held `.md` instinct on {@link TRIGGER}, with any field replaced. */
function heldInstinct(overrides: Partial<Instinct> = {}): Instinct {
  const instinct: Instinct = {
    id: 'held-a',
    trigger: TRIGGER,
    kind: 'pattern',
    domain: 'workflow',
    confidence: 0.5,
    usageCount: 1,
    sources: [],
    artifact: null,
    signal: 'silent',
    scope: 'project',
    projectId: null,
    source: 'demoted',
    evidence: [],
    promotedTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    action: ACTION,
    cause: 'demoted from a page that no longer owns the subject',
    actionHash: '',
    ...overrides,
  };
  return { ...instinct, actionHash: actionHash(instinct.action) };
}

/** The ids a bundle answers, in order. */
async function blessedIds(learning: Learning): Promise<string[]> {
  return (await learning.pullBlessed()).instincts.map((record) => record.id);
}

/** An output that keeps each `warn` message and drops everything else. */
function warnOnlyOutput(warned: string[]): Output {
  const ignore = (): void => {};
  return {
    info: ignore,
    warn: (message) => {
      warned.push(message);
    },
    error: ignore,
    debug: ignore,
    emit: ignore,
    result: ignore,
  };
}

describe('localInstinctsDir', () => {
  it('answers .rafa/instincts under the repository root', () => {
    expect(localInstinctsDir('/work/repo')).toBe(join('/work/repo', '.rafa', 'instincts'));
  });
});

describe('push', () => {
  it('writes a record on a new trigger as <id>.md described by the payload, and logs its decision', async () => {
    const dir = freshDir('new-trigger');
    const pushed = lesson({ artifact: 'Cannot find package' });
    expect(existsSync(dir)).toBe(false);

    const result = await localLearning(dir).push(payload([pushed], 'session-7'));

    const produced = { ...bare(pushed), sources: ['session-7'], usage_count: 1 };
    expect(result).toEqual({
      decisions: [{ incoming: bare(pushed), rule: 'new-trigger', produced: [produced] }],
      discarded: [],
    });
    expect(Object.keys(result.decisions[0]!.incoming)).not.toContain('description');
    expect(readdirSync(dir).sort()).toEqual([INSTINCTS_FILE, 'lesson-a.md']);
    expect(heldFile(dir, 'lesson-a')).toEqual({
      ...DESCRIPTION,
      id: 'lesson-a',
      trigger: TRIGGER,
      confidence: 0.5,
      usageCount: 1,
      sources: ['session-7'],
      artifact: 'Cannot find package',
      signal: 'loud',
      promotedTo: null,
      createdAt: EARLIER,
      updatedAt: EARLIER,
      action: ACTION,
      actionHash: actionHash(ACTION),
    });
    expect(logOf(dir)).toEqual([{
      source_id: 'session-7',
      rule: 'new-trigger',
      incoming: pushed,
      produced: ['lesson-a'],
      discarded: [],
    }]);
  });

  it('keeps a discarded action in the push log while its file leaves the held set', async () => {
    const dir = freshDir('discarded');
    const learning = localLearning(dir);
    const low = lesson({ id: 'low', confidence: 0.5 });
    const high = lesson({ id: 'high', action: RIVAL, confidence: 0.8, created_at: NOW, updated_at: NOW });

    await learning.push(payload([low], 'session-1'));
    expect(readdirSync(dir).sort()).toEqual([INSTINCTS_FILE, 'low.md']);
    const result = await learning.push(payload([high], 'session-2'));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['higher-confidence']);
    expect(result.discarded.map((record) => record.id)).toEqual(['low']);
    expect(readdirSync(dir).sort()).toEqual(['high.md', INSTINCTS_FILE]);
    expect(heldFile(dir, 'high').sources).toEqual(['session-2']);
    const [pushedLow, displacing] = logOf(dir);
    expect(pushedLow).toEqual({
      source_id: 'session-1', rule: 'new-trigger', incoming: low, produced: ['low'], discarded: [],
    });
    expect(displacing).toEqual({
      source_id: 'session-2', rule: 'higher-confidence', incoming: high, produced: ['high'], discarded: ['low'],
    });
    expect(await blessedIds(learning)).toEqual(['high']);
  });

  it('writes both actions of a flagged pair, which read back flagged and are not answered by a pull', async () => {
    const dir = freshDir('flagged');
    const learning = localLearning(dir);

    await learning.push(payload([lesson({ id: 'first', confidence: 0.5 })], 'session-1'));
    const result = await learning.push(payload([
      lesson({ id: 'second', action: RIVAL, confidence: 0.55 }),
    ], 'session-2'));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['flagged']);
    expect(result.decisions[0]!.produced.map((record) => [record.id, record.status]))
      .toEqual([['second', 'flagged'], ['first', 'flagged']]);
    expect(readdirSync(dir).sort()).toEqual(['first.md', INSTINCTS_FILE, 'second.md']);
    expect(logOf(dir)[1]).toMatchObject({ rule: 'flagged', produced: ['second', 'first'], discarded: [] });
    expect(await blessedIds(learning)).toEqual([]);
  });

  it('collapses one action from two sessions into its earliest held file, which keeps its description', async () => {
    const dir = freshDir('same-action');
    const learning = localLearning(dir);
    const later = { ...DESCRIPTION, cause: 'a later wording of the cause', kind: 'pattern' as const };

    await learning.push(payload([lesson({ id: 'first' })], 'session-1'));
    const result = await learning.push(payload([
      lesson({ id: 'second', created_at: NOW, updated_at: NOW, description: later }),
    ], 'session-2'));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['same-action']);
    expect(readdirSync(dir).sort()).toEqual(['first.md', INSTINCTS_FILE]);
    const held = heldFile(dir, 'first');
    expect([held.usageCount, held.confidence, held.sources]).toEqual([2, 0.55, ['session-1', 'session-2']]);
    expect([held.kind, held.cause, held.updatedAt]).toEqual(['gotcha', DESCRIPTION.cause, NOW]);
    expect(logOf(dir)[1]).toMatchObject({ rule: 'same-action', produced: ['first'], discarded: [] });
  });

  it('removes a collapsed member filed under the later id, keeping the record under the earlier', async () => {
    const dir = freshDir('collapse-later-id');
    const learning = localLearning(dir);

    await learning.push(payload([lesson({ id: 'later', created_at: NOW, updated_at: NOW })], 'session-1'));
    await learning.push(payload([lesson({ id: 'earlier' })], 'session-2'));

    expect(readdirSync(dir).sort()).toEqual(['earlier.md', INSTINCTS_FILE]);
    expect(heldFile(dir, 'earlier').sources).toEqual(['session-1', 'session-2']);
  });

  it('leaves a file as it stands when a repeated push would write it again unchanged', async () => {
    const dir = freshDir('idempotent');
    const learning = localLearning(dir);
    await learning.push(payload([lesson()], 'session-1'));
    // Bytes `writeInstinct` never writes, so a rewrite would show.
    const path = join(dir, 'lesson-a.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n\n`);
    const before = readFileSync(path, 'utf8');

    const result = await learning.push(payload([lesson()], 'session-1'));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['same-action']);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(logOf(dir)).toHaveLength(2);

    // The control: a push that changes the record rewrites the file.
    await learning.push(payload([lesson()], 'session-2'));
    expect(readFileSync(path, 'utf8')).not.toBe(before);
    expect(heldFile(dir, 'lesson-a').usageCount).toBe(2);
  });

  it('merges against a demoted file as it is, leaving triggers the payload does not touch alone', async () => {
    const dir = freshDir('demoted');
    const demoted = heldInstinct();
    const elsewhere = heldInstinct({ id: 'elsewhere', trigger: 'a different trigger', action: RIVAL });
    plant(dir, demoted);
    plant(dir, elsewhere);
    const untouched = readFileSync(join(dir, 'elsewhere.md'), 'utf8');
    const learning = localLearning(dir);
    expect(await blessedIds(learning)).toEqual(['elsewhere', 'held-a']);

    const result = await learning.push(payload([lesson()], 'session-1'));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['same-action']);
    expect(readdirSync(dir).sort()).toEqual(['elsewhere.md', 'held-a.md', INSTINCTS_FILE]);
    const held = heldFile(dir, 'held-a');
    expect([held.source, held.kind, held.cause, held.evidence]).toEqual(['demoted', 'pattern', demoted.cause, []]);
    expect(held.sources).toEqual(['held-a', 'session-1']);
    expect(readFileSync(join(dir, 'elsewhere.md'), 'utf8')).toBe(untouched);
  });

  it('skips a file the schema refuses, reporting it through warn, and never writes over it', async () => {
    const dir = freshDir('unreadable');
    mkdirSync(dir, { recursive: true });
    const broken = join(dir, 'broken.md');
    writeFileSync(broken, 'no frontmatter here\n');
    const warned: string[] = [];
    const learning = localLearning(dir, warned);

    await learning.push(payload([lesson({ id: 'fine' })]));

    expect(readdirSync(dir).sort()).toEqual(['broken.md', 'fine.md', INSTINCTS_FILE]);
    expect(readFileSync(broken, 'utf8')).toBe('no frontmatter here\n');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toStartWith(`local learning: ${broken} is not a held instinct, so it was skipped: frontmatter: `);

    const before = snapshot(dir);
    await expect(learning.push(payload([lesson({ id: 'broken', trigger: 'another trigger' })])))
      .rejects.toThrow(`${PUSH_REFUSAL}it would overwrite ${broken}, which could not be read`);
    expect(snapshot(dir)).toEqual(before);
  });

  it('reports a skipped file through the output active when the report is made, when no warn is given', async () => {
    const dir = freshDir('active-output');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.md'), 'not an instinct\n');
    const learning = createLocalLearning({ instinctsDir: dir, now: () => NOW });
    const warned: string[] = [];

    setActiveOutput(warnOnlyOutput(warned));
    try {
      expect((await learning.pullBlessed()).instincts).toEqual([]);
    } finally {
      setActiveOutput(null);
    }
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${join(dir, 'broken.md')} is not a held instinct`);
  });

  it('writes no file and no directory for a push of no instincts', async () => {
    const dir = freshDir('empty-push');

    const result = await localLearning(dir).push(payload([]));

    expect(result).toEqual({ decisions: [], discarded: [] });
    expect(existsSync(dir)).toBe(false);
  });

  it('drops keys the port does not declare from the result and the log, a description apart', async () => {
    const dir = freshDir('fields');
    const extra = { ...lesson(), origin: 'not a port field' } as DescribedInstinctRecord;
    const description = { ...DESCRIPTION, extra: 'not a description field' } as HeldDescription;

    const result = await localLearning(dir).push(payload([{ ...extra, description } as InstinctRecord]));

    expect(Object.keys(result.decisions[0]!.incoming)).toEqual(Object.keys(bare(lesson())));
    expect(logOf(dir)[0]!.incoming).toEqual(lesson());
    expect(readFileSync(join(dir, INSTINCTS_FILE), 'utf8')).not.toContain('not a');
    expect(readFileSync(join(dir, 'lesson-a.md'), 'utf8')).not.toContain('not a');
  });

  const refusals: [label: string, handed: unknown, problem: string][] = [
    ['a payload that is null', null, 'the payload is null, expected a mapping'],
    ['an empty source', { source_id: '', instincts: [] }, 'source_id is "" in the payload, expected a non-empty string'],
    ['no instinct list', { source_id: 's' }, 'instincts is undefined in the payload, expected a list'],
    ['instincts as a mapping', { source_id: 's', instincts: {} }, 'instincts is a mapping in the payload, expected a list'],
    ['a record that is null', payload([lesson(), null as unknown as InstinctRecord]), 'instincts[1] is null, expected a mapping'],
    ['an empty id', payload([lesson({ id: '' })]), 'id is "" in instincts[0], expected a non-empty string'],
    ['a trigger that is a number', payload([lesson({ trigger: 3 as unknown as string })]), 'trigger is 3 in instincts[0], expected a string'],
    ['a confidence below 0.3', payload([lesson({ confidence: 0.29 })]), 'confidence is 0.29 in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence above 0.9', payload([lesson({ confidence: 0.91 })]), 'confidence is 0.91 in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence that is NaN', payload([lesson({ confidence: Number.NaN })]), 'confidence is NaN in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence written as text', payload([lesson({ confidence: '0.5' as unknown as number })]), 'confidence is "0.5" in instincts[0], expected a number from 0.3 to 0.9'],
    ['a negative usage count', payload([lesson({ usage_count: -1 })]), 'usage_count is -1 in instincts[0], expected a whole number from 0'],
    ['a fractional usage count', payload([lesson({ usage_count: 1.5 })]), 'usage_count is 1.5 in instincts[0], expected a whole number from 0'],
    ['sources that are one string', payload([lesson({ sources: 's' as unknown as string[] })]), 'sources is "s" in instincts[0], expected a list of non-empty strings when present'],
    ['sources holding an empty string', payload([lesson({ sources: ['s', ''] })]), 'sources is a list in instincts[0], expected a list of non-empty strings when present'],
    ['a promoted_to that is a number', payload([lesson({ promoted_to: 3 as unknown as string })]), 'promoted_to is 3 in instincts[0], expected a string when present'],
    ['an artifact that is null', payload([lesson({ artifact: null as unknown as string })]), 'artifact is null in instincts[0], expected a string when present'],
    ['a quiet signal', payload([lesson({ signal: 'quiet' as InstinctRecord['signal'] })]), 'signal is "quiet" in instincts[0], expected one of: loud, silent'],
    ['a retired status', payload([lesson({ status: 'retired' as InstinctRecord['status'] })]), 'status is "retired" in instincts[0], expected one of: active, flagged'],
    ['no updated_at', payload([{ ...lesson(), updated_at: undefined } as unknown as InstinctRecord]), 'updated_at is undefined in instincts[0], expected a string'],
    ['an action_hash not of its action', payload([lesson({ action_hash: 'a'.repeat(64) })]), `action_hash is "${'a'.repeat(64)}" in instincts[0], expected the sha256 of its trimmed, lower-cased action`],
    ['a description that is a list', payload([lesson({ description: [] as unknown as HeldDescription })]), 'instincts[0].description is a list, expected a mapping'],
    ['a description of an unknown kind', payload([lesson({ description: { ...DESCRIPTION, kind: 'hunch' as HeldDescription['kind'] } })]), 'kind is "hunch" in instincts[0].description, expected one of: gotcha, pattern, location, skill-suggestion'],
    ['evidence that is one mapping', payload([lesson({ description: { ...DESCRIPTION, evidence: {} as HeldDescription['evidence'] } })]), 'evidence is a mapping in instincts[0].description, expected a list of mappings'],
    ['no projectId', payload([lesson({ description: { ...DESCRIPTION, projectId: undefined as unknown as null } })]), 'projectId is undefined in instincts[0].description, expected a string or null'],
    ['a record on a new trigger with no description', payload([lesson({ description: undefined })]), 'lesson-a.md has no held member and no payload description to be written with'],
    ['an id that is no slug', payload([lesson({ id: 'Not A Slug' })]), 'Not A Slug.md would not read back: id: '],
    ['a task-report record with no evidence', payload([lesson({ description: { ...DESCRIPTION, evidence: [] } })]), 'lesson-a.md would not read back: evidence: '],
    ['a created_at that is a date alone', payload([lesson({ created_at: '2026-09-13' })]), 'lesson-a.md would not read back: created_at: '],
    ['two actions under one id', payload([lesson(), lesson({ action: RIVAL })]), 'two records would be written to lesson-a.md'],
  ];

  it.each(refusals)('refuses %s, writing nothing', async (_label, handed, problem) => {
    const dir = freshDir('refused');

    await expect(localLearning(dir).push(handed as SyncPayload)).rejects.toThrow(`${PUSH_REFUSAL}${problem}`);
    expect(existsSync(dir)).toBe(false);
  });

  it('accepts each boundary a refusal sits beside', async () => {
    const dir = freshDir('boundaries');
    const learning = localLearning(dir);
    const accepted = [
      lesson({ id: 'low', trigger: 't1', confidence: 0.3 }),
      lesson({ id: 'high', trigger: 't2', confidence: 0.9 }),
      lesson({ id: 'unused', trigger: 't3', usage_count: 0 }),
      lesson({ id: 'no-sources', trigger: 't4', sources: [] }),
      lesson({ id: 'silent', trigger: 't5', signal: 'silent' }),
      lesson({ id: 'flagged', trigger: 't6', status: 'flagged' }),
      lesson({ id: 'mixed-case', trigger: 't7', action: `  ${ACTION.toUpperCase()} `, action_hash: actionHash(ACTION) }),
      lesson({ id: 'no-evidence', trigger: 't8', description: { ...DESCRIPTION, source: 'imported', evidence: [] } }),
      lesson({ id: 'project', trigger: 't9', description: { ...DESCRIPTION, projectId: '0123456789ab' } }),
    ];

    const result = await learning.push(payload(accepted));

    expect(result.decisions).toHaveLength(accepted.length);
    expect(logOf(dir)).toHaveLength(accepted.length);
    expect(readdirSync(dir).filter((name) => name.endsWith('.md'))).toHaveLength(accepted.length);
  });

  it('refuses a whole batch when one record in it is refused, leaving every file byte-identical', async () => {
    const dir = freshDir('batch');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'held' })]));
    const before = snapshot(dir);
    const fine = lesson({ id: 'fine', trigger: 'another trigger' });

    await expect(learning.push(payload([fine, lesson({ confidence: 1 })])))
      .rejects.toThrow(`${PUSH_REFUSAL}confidence is 1 in instincts[1], expected a number from 0.3 to 0.9`);
    await expect(learning.push(payload([fine, lesson({ id: 'Bad Id', trigger: 'a third trigger' })])))
      .rejects.toThrow(`${PUSH_REFUSAL}Bad Id.md would not read back: id: `);
    await expect(learning.push(payload([fine, lesson({ id: 'bare', trigger: 'a third trigger', description: undefined })])))
      .rejects.toThrow(`${PUSH_REFUSAL}bare.md has no held member and no payload description to be written with`);
    expect(snapshot(dir)).toEqual(before);

    // The control: the same record pushed alone is stored.
    await learning.push(payload([fine]));
    expect(readdirSync(dir).sort()).toEqual(['fine.md', 'held.md', INSTINCTS_FILE]);
  });

  it('refuses a record that would overwrite a file holding another trigger', async () => {
    const dir = freshDir('overwrite');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'taken' })]));
    const before = snapshot(dir);

    await expect(learning.push(payload([lesson({ id: 'taken', trigger: 'another trigger' })])))
      .rejects.toThrow(`${PUSH_REFUSAL}it would overwrite ${join(dir, 'taken.md')}, which holds another trigger`);
    expect(snapshot(dir)).toEqual(before);
  });

  it('writes a record described by its held member without a payload description', async () => {
    const dir = freshDir('held-described');
    plant(dir, heldInstinct());

    await localLearning(dir).push(payload([lesson({ description: undefined })], 'session-1'));

    expect(heldFile(dir, 'held-a').sources).toEqual(['held-a', 'session-1']);
  });

  it('rejects when the directory path names a file, writing nothing', async () => {
    const path = freshDir('a-file');
    writeFileSync(path, 'not a directory\n');

    await expect(localLearning(path).push(payload([lesson()]))).rejects.toThrow('ENOTDIR');
    await expect(localLearning(path).pullBlessed()).rejects.toThrow('ENOTDIR');
    expect(readFileSync(path, 'utf8')).toBe('not a directory\n');
  });
});

describe('pullBlessed', () => {
  it('answers an empty bundle stamped now over a directory that does not exist, creating nothing', async () => {
    const dir = freshDir('absent');

    expect(await localLearning(dir).pullBlessed()).toEqual({ version: NOW, instincts: [] });
    expect(existsSync(dir)).toBe(false);
  });

  it('stamps the version when the bundle is made', async () => {
    const dir = freshDir('version');
    let reads = 0;
    const learning = localLearning(dir, [], {
      now: () => {
        reads += 1;
        return `2026-09-14T10:00:0${reads}.000Z`;
      },
    });

    expect((await learning.pullBlessed()).version).toBe('2026-09-14T10:00:01.000Z');
    expect((await learning.pullBlessed()).version).toBe('2026-09-14T10:00:02.000Z');
  });

  it('answers each held record as the library reads it, without the fields only the file carries', async () => {
    const dir = freshDir('read-fields');
    plant(dir, heldInstinct({ artifact: 'Cannot find package', sources: ['s1'] }));

    const [held] = (await localLearning(dir).pullBlessed()).instincts;

    expect(held).toEqual({
      id: 'held-a',
      trigger: TRIGGER,
      action: ACTION,
      action_hash: actionHash(ACTION),
      confidence: 0.5,
      usage_count: 1,
      sources: ['s1'],
      artifact: 'Cannot find package',
      signal: 'silent',
      status: 'active',
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:00:00.000Z',
    });
  });
});

describe('flag', () => {
  it('keeps a flagged id out of every later bundle, a record merged under it afterwards too', async () => {
    const dir = freshDir('flag');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'a' }), lesson({ id: 'b', trigger: 'another trigger' })]));
    expect(await blessedIds(learning)).toEqual(['a', 'b']);

    await learning.flag('a', 'wrong advice');
    expect(await blessedIds(learning)).toEqual(['b']);

    await learning.push(payload([lesson({ id: 'c' })], 'session-2'));
    expect(heldFile(dir, 'a').usageCount).toBe(2);
    expect(await blessedIds(localLearning(dir))).toEqual(['b']);
    expect(flagsOf(dir)).toEqual([{ id: 'a', reason: 'wrong advice', flagged_at: NOW }]);
  });

  it('rejects an id no held record carries, writing no flag', async () => {
    const dir = freshDir('flag-unknown');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'a' })]));

    await expect(learning.flag('missing', 'typo')).rejects.toThrow(
      `local learning: no instinct "missing" is held under ${dir}`,
    );
    expect(readdirSync(dir).sort()).toEqual(['a.md', INSTINCTS_FILE]);

    await learning.flag('a', 'control');
    expect(readdirSync(dir).sort()).toEqual(['a.md', FLAGS_FILE, INSTINCTS_FILE]);
  });

  it('rejects any id over a directory that does not exist, creating nothing', async () => {
    const dir = freshDir('flag-absent');

    await expect(localLearning(dir).flag('a', 'nothing held')).rejects.toThrow(
      `local learning: no instinct "a" is held under ${dir}`,
    );
    expect(existsSync(dir)).toBe(false);
  });

  const flagRefusals: [label: string, flag: () => [unknown, unknown], problem: string][] = [
    ['an empty id', () => ['', 'reason'], 'id is "" in the flag, expected a non-empty string'],
    ['a reason that is not a string', () => ['a', 3], 'reason is 3 in the flag, expected a string'],
  ];

  it.each(flagRefusals)('refuses %s, writing nothing', async (_label, flag, problem) => {
    const dir = freshDir('flag-refused');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'a' })]));
    const [id, reason] = flag();

    await expect(learning.flag(id as string, reason as string)).rejects.toThrow(
      `local learning: refused to write an invalid flag: ${problem}`,
    );
    expect(existsSync(join(dir, FLAGS_FILE))).toBe(false);
  });

  it('refuses a flag stamped with a clock reading no pull could read', async () => {
    const dir = freshDir('flag-clock');
    await localLearning(dir).push(payload([lesson({ id: 'a' })]));
    const learning = localLearning(dir, [], { now: () => 7 as unknown as string });

    await expect(learning.flag('a', 'reason')).rejects.toThrow(
      'local learning: refused to write an invalid flag: flagged_at is 7 in the flag, expected a string',
    );
    expect(existsSync(join(dir, FLAGS_FILE))).toBe(false);
  });
});

describe('a line that cannot be read', () => {
  it('rejects a pull over a flag line, and answers once the line is gone', async () => {
    const dir = freshDir('bad-flag');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'a' }), lesson({ id: 'b', trigger: 'another trigger' })]));
    await learning.flag('a', 'contradiction');
    const flagsPath = join(dir, FLAGS_FILE);
    const good = readFileSync(flagsPath, 'utf8');
    writeFileSync(flagsPath, `${good}{"id":"b","reason":"torn`);

    await expect(learning.pullBlessed()).rejects.toThrow(
      `local learning: line 2 of ${flagsPath} is not a flag, and a bundle skipping it could hold an instinct it flags: it is not JSON (`,
    );

    writeFileSync(flagsPath, `${good}{"id":"b","reason":3,"flagged_at":"${NOW}"}\n`);
    await expect(learning.pullBlessed()).rejects.toThrow(
      `local learning: line 2 of ${flagsPath} is not a flag, and a bundle skipping it could hold an instinct it flags: reason is 3 in the flag, expected a string`,
    );

    writeFileSync(flagsPath, good);
    expect(await blessedIds(learning)).toEqual(['b']);
  });

  it('writes a newline ahead of its own lines after a torn last line of the push log', async () => {
    const dir = freshDir('torn');
    const learning = localLearning(dir);
    await learning.push(payload([lesson({ id: 'a' })]));
    const path = join(dir, INSTINCTS_FILE);
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"source_id":"s","inc`);

    await learning.push(payload([lesson({ id: 'b', trigger: 'another trigger' })]));

    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines[1]).toBe('{"source_id":"s","inc');
    expect((JSON.parse(lines[2]!) as PushLogLine).produced).toEqual(['b']);
    expect(lines.at(-1)).toBe('');
  });
});

describe('the adapter', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(localLearning(freshDir('frozen')))).toBe(true);
  });
});
