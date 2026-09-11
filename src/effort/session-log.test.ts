/**
 * Tests for the streaming session-log reader.
 *
 * Every case runs over a PLANTED fixture — either a log written into a
 * throwaway directory, or an in-memory line generator. Nothing here
 * reads the real session tree: those files carry prompt content, they
 * grow with every run, and a test keyed on them would assert a
 * snapshot rather than a behaviour.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  accumulateSessionStats,
  emptyUsageTotals,
  readLines,
  readSessionLog,
  sessionIdFromPath,
} from './session-log.js';

const IDENTITY = { sessionId: 'planted', filePath: '/planted/planted.jsonl' };

/** Usage counters for the fixture's first assistant turn. */
const USAGE_A = {
  input_tokens: 11,
  output_tokens: 22,
  cache_creation_input_tokens: 33,
  cache_read_input_tokens: 44,
  cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 3 },
  server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
  output_tokens_details: { thinking_tokens: 7 },
  service_tier: 'standard',
  iterations: [],
  speed: 'fast',
};

/** Usage counters for the fixture's second (sidechain) assistant turn. */
const USAGE_B = {
  input_tokens: 100,
  output_tokens: 200,
  cache_creation_input_tokens: 300,
  cache_read_input_tokens: 400,
  cache_creation: { ephemeral_1h_input_tokens: 250, ephemeral_5m_input_tokens: 50 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 5 },
  output_tokens_details: { thinking_tokens: 70 },
};

/**
 * A synthetic turn: the harness materialises an API error as an
 * assistant record whose counters are all zero and whose
 * output_tokens_details is null.
 */
const USAGE_SYNTHETIC = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  output_tokens_details: null,
};

const BRANCH = 'feat/q19-loop-economics';
const OTHER_BRANCH = 'chore/some-other-branch';

/**
 * The planted log, one entry per line.
 *
 * Three properties are deliberate and each is asserted below: the
 * LATEST record sits in the middle so file order is not the time span,
 * the two smallest timestamps disagree between lexical and instant
 * order, and two lines are unparseable in the two different ways a
 * line can be.
 */
const FIXTURE_LINES = [
  JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    timestamp: '2026-09-08T12:00:00.5Z',
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-08T12:00:02.000Z',
    gitBranch: BRANCH,
    entrypoint: 'sdk-cli',
    isSidechain: false,
    effort: 'xhigh',
    unknownFutureField: 'ignored',
    message: { model: 'claude-opus-5', usage: USAGE_A },
  }),
  '',
  '{not json',
  '[1, 2, 3]',
  JSON.stringify({
    type: 'user',
    timestamp: '2026-09-08T12:00:03.000Z',
    gitBranch: BRANCH,
    entrypoint: 'sdk-cli',
    isSidechain: false,
    message: { role: 'user', content: 'ok' },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-08T12:00:09.000Z',
    gitBranch: BRANCH,
    entrypoint: 'sdk-cli',
    isSidechain: true,
    effort: 'low',
    message: { model: 'claude-fable-5', usage: USAGE_B },
  }),
  JSON.stringify({
    type: 'attachment',
    timestamp: '2026-09-08T12:00:00.55Z',
    gitBranch: OTHER_BRANCH,
    entrypoint: 'claude-desktop',
    isSidechain: false,
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-08T12:00:05.000Z',
    gitBranch: BRANCH,
    entrypoint: 'sdk-cli',
    isSidechain: false,
    message: { model: '<synthetic>', usage: USAGE_SYNTHETIC },
  }),
  JSON.stringify({ type: 'last-prompt', leafUuid: 'abc' }),
];

/** Yields planted lines one at a time, as a stream reader would. */
async function* fromLines(lines: readonly string[]): AsyncGenerator<string> {
  for (const line of lines) {
    yield line;
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-effort-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * Writes a planted log and returns its path. The last line carries no
 * trailing newline and two lines end CRLF, which is what a log being
 * appended to by a live session looks like.
 */
function plantLog(name: string, lines: readonly string[]): string {
  const path = join(tempRoot, name);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

describe('sessionIdFromPath', () => {
  it('takes the row key from the basename, never from a record', () => {
    expect(sessionIdFromPath('/logs/9f3c-1111.jsonl')).toBe('9f3c-1111');
  });

  it('leaves a name that is not a log alone', () => {
    expect(sessionIdFromPath('/logs/notes.txt')).toBe('notes.txt');
  });
});

describe('accumulateSessionStats over the planted log', () => {
  it('counts every line as parsed or unparsed, and nothing else', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.lineCount).toBe(9);
    expect(row.recordCount).toBe(7);
    expect(row.unparsedLineCount).toBe(2);
    expect(row.recordCount + row.unparsedLineCount).toBe(row.lineCount);
  });

  it('bins records by type and counts assistant turns', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.recordTypeCounts).toEqual({
      'queue-operation': 1,
      assistant: 3,
      user: 1,
      attachment: 1,
      'last-prompt': 1,
    });
    expect(row.assistantRecordCount).toBe(3);
  });

  it('sums every usage counter across all three nesting levels', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.usage).toEqual({
      inputTokens: 111,
      outputTokens: 222,
      cacheCreationInputTokens: 333,
      cacheReadInputTokens: 444,
      ephemeral1hInputTokens: 280,
      ephemeral5mInputTokens: 53,
      webSearchRequests: 1,
      webFetchRequests: 7,
      thinkingTokens: 77,
    });
  });

  it('reads branch, entrypoint and sidechain off the record top level', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.gitBranchCounts).toEqual({ [BRANCH]: 4, [OTHER_BRANCH]: 1 });
    expect(row.entrypointCounts).toEqual({ 'sdk-cli': 4, 'claude-desktop': 1 });
    expect(row.sidechainRecordCount).toBe(1);
  });

  it('histograms top-level effort, which a synthetic turn omits', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    // Two DISTINCT values on purpose: a fold that bumped a constant
    // key, or read the field off `message`, answers one key or none
    // while every other count in the row stays right.
    expect(row.effortCounts).toEqual({ xhigh: 1, low: 1 });
    // Three assistant records, one of them synthetic and effortless.
    expect(row.assistantRecordCount).toBe(3);
  });

  it('histograms message.model, synthetic turns included', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.modelCounts).toEqual({
      'claude-opus-5': 1,
      'claude-fable-5': 1,
      '<synthetic>': 1,
    });
  });

  it('spans time by instant, not by file order or string order', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    // The latest record sits mid-file, so last-seen would answer the
    // synthetic turn at 12:00:05.
    expect(row.lastTimestamp).toBe('2026-09-08T12:00:09.000Z');
    // '.55Z' sorts BEFORE '.5Z' as a string and after it as an instant,
    // so a lexical min would answer the attachment record here.
    expect(row.firstTimestamp).toBe('2026-09-08T12:00:00.5Z');
  });

  it('carries the identity it was handed and no message content', async () => {
    const row = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);

    expect(row.sessionId).toBe('planted');
    expect(row.filePath).toBe('/planted/planted.jsonl');
    expect(JSON.stringify(row)).not.toContain('unknownFutureField');
    expect(JSON.stringify(row)).not.toContain('leafUuid');
  });
});

describe('accumulateSessionStats edge cases', () => {
  it('returns a zeroed row for an empty source', async () => {
    const row = await accumulateSessionStats(fromLines([]), IDENTITY);

    expect(row.lineCount).toBe(0);
    expect(row.recordCount).toBe(0);
    expect(row.usage).toEqual(emptyUsageTotals());
    expect(row.firstTimestamp).toBeNull();
    expect(row.lastTimestamp).toBeNull();
  });

  it('does not share counters between two rows', async () => {
    const first = await accumulateSessionStats(fromLines(FIXTURE_LINES), IDENTITY);
    const second = await accumulateSessionStats(fromLines([]), IDENTITY);

    expect(first.usage.inputTokens).toBe(111);
    expect(second.usage.inputTokens).toBe(0);
    expect(second.recordTypeCounts).toEqual({});
  });

  it('bins a record with no type under unknown', async () => {
    const lines = [JSON.stringify({ timestamp: '2026-09-08T12:00:00.000Z' })];
    const row = await accumulateSessionStats(fromLines(lines), IDENTITY);

    expect(row.recordTypeCounts).toEqual({ unknown: 1 });
    expect(row.assistantRecordCount).toBe(0);
  });

  it('ignores a timestamp that is not a date', async () => {
    const lines = [JSON.stringify({ type: 'user', timestamp: 'not-a-date' })];
    const row = await accumulateSessionStats(fromLines(lines), IDENTITY);

    expect(row.recordCount).toBe(1);
    expect(row.firstTimestamp).toBeNull();
  });

  it('reads a counter that is not a number as zero', async () => {
    const usage = { input_tokens: null, output_tokens: '9', cache_read_input_tokens: 5 };
    const lines = [JSON.stringify({ type: 'assistant', message: { usage } })];
    const row = await accumulateSessionStats(fromLines(lines), IDENTITY);

    expect(row.usage.inputTokens).toBe(0);
    expect(row.usage.outputTokens).toBe(0);
    expect(row.usage.cacheReadInputTokens).toBe(5);
  });

  it('tolerates a message with neither model nor usage', async () => {
    const lines = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } })];
    const row = await accumulateSessionStats(fromLines(lines), IDENTITY);

    expect(row.modelCounts).toEqual({});
    expect(row.usage).toEqual(emptyUsageTotals());
  });

  it('keeps the row bounded by cardinality rather than record count', async () => {
    const template = {
      type: 'assistant',
      entrypoint: 'sdk-cli',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1 } },
    };
    const lines: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const branch = i % 2 === 0
        ? BRANCH
        : OTHER_BRANCH;
      lines.push(JSON.stringify({ ...template, gitBranch: branch }));
    }

    const row = await accumulateSessionStats(fromLines(lines), IDENTITY);

    expect(row.recordCount).toBe(5_000);
    expect(row.usage.inputTokens).toBe(5_000);
    // Two branch keys and one model key for five thousand records: the
    // row grows with DISTINCT VALUES, never with session length.
    expect(Object.keys(row.gitBranchCounts)).toHaveLength(2);
    expect(Object.keys(row.entrypointCounts)).toHaveLength(1);
    expect(Object.keys(row.modelCounts)).toHaveLength(1);
  });
});

describe('readLines', () => {
  it('splits CRLF and yields a final line with no trailing newline', async () => {
    const path = plantLog('crlf.jsonl', []);
    writeFileSync(path, 'a\r\nb\nc', 'utf8');

    const seen: string[] = [];
    for await (const line of readLines(path)) {
      seen.push(line);
    }

    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('stops pulling when the consumer breaks out early', async () => {
    const path = plantLog('early.jsonl', ['one', 'two', 'three']);

    const seen: string[] = [];
    for await (const line of readLines(path)) {
      seen.push(line);
      break;
    }

    expect(seen).toEqual(['one']);
  });
});

describe('streaming discipline', () => {
  /**
   * A whole-file slurp passes every behavioural case in this file: the
   * rows come out identical, and nothing a caller can observe separates
   * the two readers. Measured — swapping the stream for a readFileSync
   * split left all of them green. Bounded memory is the one property
   * this module exists for, so it is pinned at the source level, which
   * is the only leg that discriminates without mocking node:fs.
   */
  it('reads through a stream and never slurps a whole log', () => {
    const source = readFileSync(new URL('session-log.ts', import.meta.url), 'utf8');

    expect(source).toContain('createReadStream');
    expect(source).toContain('createInterface');
    expect(source).not.toMatch(/readFile(Sync)?\s*\(/);
  });
});

describe('readSessionLog', () => {
  it('agrees with the accumulator over the same planted lines', async () => {
    const path = plantLog('11112222-3333-4444-5555-666677778888.jsonl', FIXTURE_LINES);
    const fromDisk = await readSessionLog(path);
    const inMemory = await accumulateSessionStats(fromLines(FIXTURE_LINES), {
      sessionId: '11112222-3333-4444-5555-666677778888',
      filePath: path,
    });

    expect(fromDisk).toEqual(inMemory);
  });

  it('derives the session id from the log filename', async () => {
    const path = plantLog('aaaabbbb-cccc-dddd-eeee-ffff00001111.jsonl', FIXTURE_LINES);
    const row = await readSessionLog(path);

    expect(row.sessionId).toBe('aaaabbbb-cccc-dddd-eeee-ffff00001111');
    expect(row.filePath).toBe(path);
  });

  it('reads a log spanning many stream chunks', async () => {
    const padding = 'x'.repeat(512);
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(JSON.stringify({
        type: 'assistant',
        gitBranch: BRANCH,
        entrypoint: 'sdk-cli',
        padding,
        message: { model: 'claude-opus-5', usage: { output_tokens: 2 } },
      }));
    }
    const path = plantLog('chunked.jsonl', lines);
    const row = await readSessionLog(path);

    // Well past the 64 KiB default stream chunk, so the reader had to
    // stitch records across chunk boundaries.
    expect(lines.join('\n').length).toBeGreaterThan(64 * 1024);
    expect(row.recordCount).toBe(400);
    expect(row.usage.outputTokens).toBe(800);
  });

  it('counts a half-written trailing line instead of throwing', async () => {
    const path = plantLog('partial.jsonl', [
      JSON.stringify({ type: 'user', timestamp: '2026-09-08T12:00:00.000Z' }),
      '{"type":"assis',
    ]);
    const row = await readSessionLog(path);

    expect(row.recordCount).toBe(1);
    expect(row.unparsedLineCount).toBe(1);
  });
});
