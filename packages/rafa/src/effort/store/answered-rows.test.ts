/**
 * `answeredRows`, the read-time rewrite both backends' `read` passes
 * its parsed rows through. The backends' own suites hold the rewrite on
 * a stored row; this one holds what the function does to its input.
 */
import type { CommitEffortRow, SessionEffortRow } from './types.js';

import { describe, expect, it } from 'bun:test';

import { answeredRows } from './answered-rows.js';

const OLD = {
  sessionId: 'old-0001',
  filePath: '/home/alice/.claude/projects/-home-alice-repo/old-0001.jsonl',
} as unknown as SessionEffortRow;
const FRESH = {
  sessionId: 'fresh-0002',
  filePath: '-home-alice-repo/fresh-0002.jsonl',
} as unknown as SessionEffortRow;
const TEMPLATE = { sessionId: 'template-session' } as SessionEffortRow;

describe('answeredRows', () => {
  it('rewrites an old absolute filePath into a copy, input untouched', () => {
    const input = [OLD];
    const [answered] = answeredRows('sessions', input);

    expect(answered?.filePath).toBe('-home-alice-repo/old-0001.jsonl');
    expect(answered).not.toBe(OLD);
    expect(OLD.filePath)
      .toBe('/home/alice/.claude/projects/-home-alice-repo/old-0001.jsonl');
  });

  it('answers a row it leaves alone as the same object', () => {
    const [fresh, template] = answeredRows('sessions', [FRESH, TEMPLATE]);

    expect(fresh).toBe(FRESH);
    expect(template).toBe(TEMPLATE);
    expect(Object.keys(template ?? {})).toEqual(['sessionId']);
  });

  it('passes commit rows through in a fresh array', () => {
    const commit = { sha: 'deadbeef', filePath: '/home/a/.claude/projects/x/y' } as unknown as CommitEffortRow;
    const input = [commit];
    const answered = answeredRows('commits', input);

    expect(answered).toEqual([commit]);
    expect(answered[0]).toBe(commit);
    expect(answered).not.toBe(input);
  });
});
