/**
 * Tests for the `local` Learning stub (`src/adapters/learning/local.ts`).
 *
 * Every directory is made under one temporary directory this file
 * creates and removes, and a case that names a path holds it under that
 * directory. No case writes under the repository or the home. What a
 * push stored is read off the disk, with the file names spelled here,
 * as well as through a pull.
 *
 * Each refusal sits beside a control that what it refused is otherwise
 * accepted: the refused payloads beside the boundaries they sit on, the
 * refused flag beside a flag the same adapter writes, the rejected pull
 * over a torn flag line beside the pull once the line is gone. Each
 * exclusion sits beside a record the same bundle does answer.
 *
 * Nineteen mutations of `local.ts` were driven on 2026-09-14 over this
 * file and `src/adapters/registry.test.ts`, one run each, with 101 pass
 * before and after and the module restored byte-identical (sha256), and
 * every one reddened at least one case:
 *
 *   - Each record answered as `same-action` reddened the decision case,
 *     the pushed-flagged case and the registry learning case. The status
 *     filter dropped reddened the pushed-flagged case alone, and the
 *     flags ignored the flag case and the unreadable-flag case.
 *   - An unreadable flag line skipped reddened the unreadable-flag case
 *     alone. No newline written ahead of a torn last line reddened the
 *     torn-line case alone. Every read failure answered as an empty file
 *     reddened the `ENOTDIR` case.
 *   - The payload check dropped reddened the seventeen push refusals and
 *     the batch case, and the flag check dropped the three flag refusals.
 *     An unknown id flagged reddened both unknown-id cases. A fractional
 *     usage count accepted reddened its refusal, and a confidence of 0.3
 *     refused the boundary case.
 *   - The record not copied on write reddened the push case dropping
 *     keys, and not copied on read the hand-written line case. An absent
 *     artifact kept as a key reddened both. Lines written newest first
 *     reddened five cases.
 *   - The files made at the root in place of `.rafa/instincts/` reddened
 *     the directory case and the registry learning case. A push of no
 *     instincts writing reddened its case. The active output read when
 *     the adapter is made reddened the active-output case alone, and the
 *     adapter unfrozen the frozen case.
 *
 * `sources` and `promoted_to` joined the record on 2026-09-25, with 45
 * pass. `sources` dropped by the copy reddened the optional-fields case
 * alone, and its check made to accept anything reddened its two
 * refusals alone.
 */
import type { LocalLearningOptions } from './local.js';
import type { InstinctRecord, Learning, Output, SyncPayload } from '../../ports/index.js';

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

import { setActiveOutput } from '../output/active.js';

import { createLocalLearning, localInstinctsDir } from './local.js';

/** The instant every adapter here is stamped from. */
const NOW = '2026-09-14T10:00:00.000Z';

/** The file pushed records land in. */
const INSTINCTS_FILE = 'instincts.ndjson';

/** The file flags land in. */
const FLAGS_FILE = 'flags.ndjson';

/** What every push refusal opens with. */
const PUSH_REFUSAL = 'local learning: refused to store a push: ';

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

/** A record with any field replaced. */
function instinct(overrides: Partial<InstinctRecord> = {}): InstinctRecord {
  return {
    id: 'instinct-1',
    trigger: 'a test fails under the full suite and passes alone',
    action: 'find the file that runs before it and the state it leaves',
    action_hash: 'a'.repeat(64),
    confidence: 0.5,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** A payload from one source. */
function payload(instincts: InstinctRecord[], sourceId = 'session-1'): SyncPayload {
  return { source_id: sourceId, instincts };
}

/** A local learning stub over `instinctsDir`, stamped from {@link NOW}, keeping each report in `warned`. */
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

/** Each line of a file under `dir`, parsed. */
function linesOf(dir: string, file: string): unknown[] {
  return readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
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
  it('answers each record as a new-trigger decision in payload order, merging nothing', async () => {
    const dir = freshDir('decisions');
    const learning = localLearning(dir);
    // One trigger, three records: under the spec's merge table the second
    // and first would be flagged (actions differ, confidences within 0.10)
    // and the third folded into the first (same action hash).
    const first = instinct({ id: 'a' });
    const second = instinct({ id: 'b', action: 'rerun it', action_hash: 'b'.repeat(64), confidence: 0.55 });
    const third = instinct({ id: 'c', confidence: 0.7, usage_count: 3 });

    const result = await learning.push(payload([first, second, third]));

    expect(result.discarded).toEqual([]);
    expect(result.decisions.map((decision) => decision.rule)).toEqual(['new-trigger', 'new-trigger', 'new-trigger']);
    expect(result.decisions.map((decision) => decision.incoming)).toEqual([first, second, third]);
    expect(result.decisions[0]?.incoming).toBe(first);
    expect(result.decisions.map((decision) => decision.produced)).toEqual([[first], [second], [third]]);
    expect((await learning.pullBlessed()).instincts).toEqual([first, second, third]);
  });

  it('stores nothing until a push, then each record with its source in the instincts file alone', async () => {
    const dir = freshDir('stored');
    const learning = localLearning(dir);
    expect(existsSync(dir)).toBe(false);

    await learning.push(payload([instinct({ id: 'a' }), instinct({ id: 'b' })], 'session-7'));

    expect(dir.startsWith(tempDir)).toBe(true);
    expect(readdirSync(dir)).toEqual([INSTINCTS_FILE]);
    expect(linesOf(dir, INSTINCTS_FILE)).toEqual([
      { source_id: 'session-7', instinct: instinct({ id: 'a' }) },
      { source_id: 'session-7', instinct: instinct({ id: 'b' }) },
    ]);
  });

  it('keeps every push, from every source, oldest first, two records under one id included', async () => {
    const dir = freshDir('unmerged');
    const learning = localLearning(dir);

    await learning.push(payload([instinct({ id: 'a' }), instinct({ id: 'b' })], 'session-1'));
    await learning.push(payload([instinct({ id: 'a', confidence: 0.9 })], 'session-2'));
    // A second adapter over the same directory reads what the first stored.
    const bundle = await localLearning(dir).pullBlessed();

    expect(bundle.instincts).toEqual([
      instinct({ id: 'a' }),
      instinct({ id: 'b' }),
      instinct({ id: 'a', confidence: 0.9 }),
    ]);
    expect(linesOf(dir, INSTINCTS_FILE).map((line) => (line as { source_id: string }).source_id))
      .toEqual(['session-1', 'session-1', 'session-2']);
  });

  it('writes no file and no directory for a push of no instincts', async () => {
    const dir = freshDir('empty-push');

    const result = await localLearning(dir).push(payload([]));

    expect(result).toEqual({ decisions: [], discarded: [] });
    expect(existsSync(dir)).toBe(false);
  });

  it('drops keys the port does not declare, and keeps an absent artifact absent', async () => {
    const dir = freshDir('fields');
    const learning = localLearning(dir);
    const extra = { ...instinct({ id: 'a' }), evidence: 'not a port field' } as InstinctRecord;
    const withArtifact = instinct({ id: 'b', artifact: 'Cannot find package' });

    const result = await learning.push(payload([extra, withArtifact]));
    const [first, second] = (await learning.pullBlessed()).instincts;

    expect(result.decisions[0]?.produced).toEqual([instinct({ id: 'a' })]);
    expect(Object.keys(result.decisions[0]?.produced[0] ?? {})).toEqual(Object.keys(instinct()));
    expect(readFileSync(join(dir, INSTINCTS_FILE), 'utf8')).not.toContain('evidence');
    expect(first).toEqual(instinct({ id: 'a' }));
    expect(Object.keys(first ?? {})).not.toContain('artifact');
    expect(second).toEqual(withArtifact);
  });

  it('keeps sources and promoted_to when a record carries them, in the port\'s order', async () => {
    const dir = freshDir('optional-fields');
    const learning = localLearning(dir);
    const carried = instinct({
      id: 'c',
      promoted_to: 'context/source.md',
      sources: ['session-1', 'session-2'],
      usage_count: 2,
    });

    const result = await learning.push(payload([carried]));
    const [held] = (await learning.pullBlessed()).instincts;

    expect(result.decisions[0]?.produced).toEqual([carried]);
    expect(held).toEqual(carried);
    expect(Object.keys(held ?? {})).toEqual([
      'id', 'trigger', 'action', 'action_hash', 'confidence', 'usage_count', 'sources',
      'signal', 'status', 'promoted_to', 'created_at', 'updated_at',
    ]);
    expect(Object.keys(instinct())).not.toContain('sources');
    expect(Object.keys(instinct())).not.toContain('promoted_to');
  });

  const refusals: [label: string, handed: unknown, problem: string][] = [
    ['a payload that is null', null, 'the payload is null, expected a mapping'],
    ['an empty source', { source_id: '', instincts: [] }, 'source_id is "" in the payload, expected a non-empty string'],
    ['no instinct list', { source_id: 's' }, 'instincts is undefined in the payload, expected a list'],
    ['instincts as a mapping', { source_id: 's', instincts: {} }, 'instincts is a mapping in the payload, expected a list'],
    ['a record that is null', payload([instinct(), null as unknown as InstinctRecord]), 'instincts[1] is null, expected a mapping'],
    ['an empty id', payload([instinct({ id: '' })]), 'id is "" in instincts[0], expected a non-empty string'],
    ['a trigger that is a number', payload([instinct({ trigger: 3 as unknown as string })]), 'trigger is 3 in instincts[0], expected a string'],
    ['a confidence below 0.3', payload([instinct({ confidence: 0.29 })]), 'confidence is 0.29 in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence above 0.9', payload([instinct({ confidence: 0.91 })]), 'confidence is 0.91 in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence that is NaN', payload([instinct({ confidence: Number.NaN })]), 'confidence is NaN in instincts[0], expected a number from 0.3 to 0.9'],
    ['a confidence written as text', payload([instinct({ confidence: '0.5' as unknown as number })]), 'confidence is "0.5" in instincts[0], expected a number from 0.3 to 0.9'],
    ['a negative usage count', payload([instinct({ usage_count: -1 })]), 'usage_count is -1 in instincts[0], expected a whole number from 0'],
    ['a fractional usage count', payload([instinct({ usage_count: 1.5 })]), 'usage_count is 1.5 in instincts[0], expected a whole number from 0'],
    ['sources that are one string', payload([instinct({ sources: 's' as unknown as string[] })]), 'sources is "s" in instincts[0], expected a list of non-empty strings when present'],
    ['sources holding an empty string', payload([instinct({ sources: ['s', ''] })]), 'sources is a list in instincts[0], expected a list of non-empty strings when present'],
    ['a promoted_to that is a number', payload([instinct({ promoted_to: 3 as unknown as string })]), 'promoted_to is 3 in instincts[0], expected a string when present'],
    ['an artifact that is null', payload([instinct({ artifact: null as unknown as string })]), 'artifact is null in instincts[0], expected a string when present'],
    ['a quiet signal', payload([instinct({ signal: 'quiet' as InstinctRecord['signal'] })]), 'signal is "quiet" in instincts[0], expected one of: loud, silent'],
    ['a retired status', payload([instinct({ status: 'retired' as InstinctRecord['status'] })]), 'status is "retired" in instincts[0], expected one of: active, flagged'],
    ['no updated_at', payload([{ ...instinct(), updated_at: undefined } as unknown as InstinctRecord]), 'updated_at is undefined in instincts[0], expected a string'],
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
      instinct({ id: 'low', confidence: 0.3 }),
      instinct({ id: 'high', confidence: 0.9 }),
      instinct({ id: 'unused', usage_count: 0 }),
      instinct({ id: 'artifact', artifact: '' }),
      instinct({ id: 'no-sources', sources: [] }),
      instinct({ id: 'promoted', promoted_to: '' }),
      instinct({ id: 'silent', signal: 'silent', trigger: '' }),
      instinct({ id: 'flagged', status: 'flagged' }),
    ];

    const result = await learning.push(payload(accepted));

    expect(result.decisions).toHaveLength(accepted.length);
    expect(linesOf(dir, INSTINCTS_FILE)).toHaveLength(accepted.length);
  });

  it('refuses a whole batch when one record in it is invalid, leaving the file byte-identical', async () => {
    const dir = freshDir('batch');
    const learning = localLearning(dir);
    await learning.push(payload([instinct({ id: 'held' })]));
    const before = readFileSync(join(dir, INSTINCTS_FILE));

    await expect(learning.push(payload([instinct({ id: 'fine' }), instinct({ confidence: 1 })])))
      .rejects.toThrow(`${PUSH_REFUSAL}confidence is 1 in instincts[1], expected a number from 0.3 to 0.9`);

    expect(readFileSync(join(dir, INSTINCTS_FILE)).equals(before)).toBe(true);
    expect(await blessedIds(learning)).toEqual(['held']);
  });
});

describe('pullBlessed', () => {
  it('drops keys the port does not declare from a line written by hand', async () => {
    const dir = freshDir('read-fields');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, INSTINCTS_FILE), `${JSON.stringify({
      source_id: 's',
      origin: 'written by hand',
      instinct: { ...instinct({ id: 'a' }), evidence: 'not a port field' },
    })}\n`);

    const [held] = (await localLearning(dir).pullBlessed()).instincts;

    expect(held).toEqual(instinct({ id: 'a' }));
    expect(Object.keys(held ?? {})).toEqual(Object.keys(instinct()));
  });

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

  it('keeps a record pushed as flagged out of the bundle, and its active sibling in', async () => {
    const dir = freshDir('pushed-flagged');
    const learning = localLearning(dir);

    const result = await learning.push(payload([
      instinct({ id: 'active' }),
      instinct({ id: 'flagged', status: 'flagged' }),
    ]));

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['new-trigger', 'new-trigger']);
    expect(linesOf(dir, INSTINCTS_FILE)).toHaveLength(2);
    expect(await blessedIds(learning)).toEqual(['active']);
  });

  it('rejects when the directory path names a file, rather than answering an empty bundle', async () => {
    const path = freshDir('a-file');
    writeFileSync(path, 'not a directory\n');

    await expect(localLearning(path).pullBlessed()).rejects.toThrow('ENOTDIR');
    await expect(localLearning(path).push(payload([instinct()]))).rejects.toThrow();
  });
});

describe('flag', () => {
  it('keeps a flagged id out of every later bundle, a record pushed under it afterwards too', async () => {
    const dir = freshDir('flag');
    const learning = localLearning(dir);
    await learning.push(payload([instinct({ id: 'a' }), instinct({ id: 'b' })]));
    expect(await blessedIds(learning)).toEqual(['a', 'b']);

    await learning.flag('a', 'contradicts b at near-equal confidence');
    expect(await blessedIds(learning)).toEqual(['b']);

    await learning.push(payload([instinct({ id: 'a', confidence: 0.9 }), instinct({ id: 'c' })], 'session-2'));
    expect(await blessedIds(localLearning(dir))).toEqual(['b', 'c']);
    expect(linesOf(dir, FLAGS_FILE)).toEqual([
      { id: 'a', reason: 'contradicts b at near-equal confidence', flagged_at: NOW },
    ]);
    expect(linesOf(dir, INSTINCTS_FILE)).toHaveLength(4);
  });

  it('rejects an id no held record carries, writing no flag', async () => {
    const dir = freshDir('flag-unknown');
    const learning = localLearning(dir);
    await learning.push(payload([instinct({ id: 'a' })]));

    await expect(learning.flag('missing', 'typo')).rejects.toThrow(
      `local learning: no instinct "missing" is held under ${dir}`,
    );
    expect(readdirSync(dir)).toEqual([INSTINCTS_FILE]);

    await learning.flag('a', 'control');
    expect(readdirSync(dir).sort()).toEqual([FLAGS_FILE, INSTINCTS_FILE]);
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
    await learning.push(payload([instinct({ id: 'a' })]));
    const [id, reason] = flag();

    await expect(learning.flag(id as string, reason as string)).rejects.toThrow(
      `local learning: refused to write an invalid flag: ${problem}`,
    );
    expect(readdirSync(dir)).toEqual([INSTINCTS_FILE]);
  });

  it('refuses a flag stamped with a clock reading no pull could read', async () => {
    const dir = freshDir('flag-clock');
    await localLearning(dir).push(payload([instinct({ id: 'a' })]));
    const learning = localLearning(dir, [], { now: () => 7 as unknown as string });

    await expect(learning.flag('a', 'reason')).rejects.toThrow(
      'local learning: refused to write an invalid flag: flagged_at is 7 in the flag, expected a string',
    );
    expect(readdirSync(dir)).toEqual([INSTINCTS_FILE]);
  });
});

describe('a line that cannot be read', () => {
  it('skips an instinct line, reporting it through warn and answering the other lines', async () => {
    const dir = freshDir('bad-instinct');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, INSTINCTS_FILE);
    const held = (record: InstinctRecord): string => JSON.stringify({ source_id: 's', instinct: record });
    writeFileSync(path, [
      held(instinct({ id: 'a' })),
      'not json',
      held(instinct({ id: 'b', confidence: 1.2 })),
      JSON.stringify({ source_id: '', instinct: instinct({ id: 'c' }) }),
      JSON.stringify(['a list']),
      held(instinct({ id: 'd' })),
      '',
    ].join('\n'));
    const warned: string[] = [];

    expect(await blessedIds(localLearning(dir, warned))).toEqual(['a', 'd']);
    const opening = `local learning: line 2 of ${path} is not a held instinct, so it was skipped: it is not JSON (`;
    expect(warned).toHaveLength(4);
    expect(warned[0]?.startsWith(opening)).toBe(true);
    expect(warned.slice(1)).toEqual([
      `local learning: line 3 of ${path} is not a held instinct, so it was skipped: confidence is 1.2 in the instinct, expected a number from 0.3 to 0.9`,
      `local learning: line 4 of ${path} is not a held instinct, so it was skipped: source_id is "" in the line, expected a non-empty string`,
      `local learning: line 5 of ${path} is not a held instinct, so it was skipped: the line is a list, expected a mapping`,
    ]);
  });

  it('reports a skipped line through the output active when the report is made, when no warn is given', async () => {
    const dir = freshDir('active-output');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, INSTINCTS_FILE), 'not json\n');
    const learning = createLocalLearning({ instinctsDir: dir, now: () => NOW });
    const warned: string[] = [];

    setActiveOutput(warnOnlyOutput(warned));
    try {
      expect((await learning.pullBlessed()).instincts).toEqual([]);
    } finally {
      setActiveOutput(null);
    }
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`line 1 of ${join(dir, INSTINCTS_FILE)} is not a held instinct`);
  });

  it('rejects a pull over a flag line, and answers once the line is gone', async () => {
    const dir = freshDir('bad-flag');
    const learning = localLearning(dir);
    await learning.push(payload([instinct({ id: 'a' }), instinct({ id: 'b' })]));
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

  it('writes a newline ahead of its own line after a torn last line, so the record it pushes is read', async () => {
    const dir = freshDir('torn');
    const learning = localLearning(dir, []);
    await learning.push(payload([instinct({ id: 'a' })]));
    const path = join(dir, INSTINCTS_FILE);
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"source_id":"s","inst`);
    const warned: string[] = [];

    await learning.push(payload([instinct({ id: 'b' })]));

    expect(await blessedIds(localLearning(dir, warned))).toEqual(['a', 'b']);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`line 2 of ${path} is not a held instinct`);
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
  });
});

describe('the adapter', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(localLearning(freshDir('frozen')))).toBe(true);
  });
});
