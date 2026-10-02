/**
 * The pure readings of the `stretch` operator script: suspends, task
 * lines, test steps, session matching, home roots, causes and the merge
 * conditions. Every fixture is a line captured in stretch 1.
 */
import { describe, expect, it } from 'bun:test';

import { checkRows, homeRoot } from '../bundled/operators/scripts/data-check.js';
import { groupFilings, parseCauses } from '../bundled/operators/scripts/filings.js';
import { mergeRefusals, parsePrShow } from '../bundled/operators/scripts/guards.js';
import { matchSessions, parseTaskLines, stepTotals } from '../bundled/operators/scripts/readings.js';
import { summarise } from '../bundled/operators/scripts/stats.js';
import { sessionWindow } from '../bundled/operators/scripts/stretch-dir.js';
import { parseJournal, parsePmset, suspendedMinutes } from '../bundled/operators/scripts/suspends.js';
import { agentStatus, fired, runningLoops, transcriptSignals } from '../bundled/operators/scripts/watch.js';

/** The kernel log around stretch 1's overnight sleep. */
const JOURNAL = [
  '2026-10-01T22:30:35+02:00 host kernel: PM: suspend entry (s2idle)',
  '2026-10-01T22:34:33+02:00 host kernel: PM: suspend exit',
  '2026-10-01T23:09:18+02:00 host kernel: PM: suspend entry (s2idle)',
  '2026-10-02T09:34:59+02:00 host kernel: PM: suspend exit',
].join('\n');

/** Epoch milliseconds of an ISO time. */
const at = (iso: string): number => Date.parse(iso);

describe('suspends', () => {
  it('pairs each kernel suspend entry with its exit', () => {
    const suspends = parseJournal(JOURNAL);

    expect(suspends).toHaveLength(2);
    expect(suspendedMinutes(suspends, at('2026-10-01T21:08:56Z'), at('2026-10-02T07:39:41Z'))).toBeCloseTo(625.68, 1);
  });

  it('drops an exit with no entry before it, as at the start of a window', () => {
    expect(parseJournal('2026-10-01T22:00:16+02:00 host kernel: PM: suspend exit')).toEqual([]);
  });

  it('reads pmset Sleep and Wake lines', () => {
    const text = '2026-10-01 23:09:18 +0200 Sleep               \tEntering Sleep state\n2026-10-02 09:34:59 +0200 Wake                \tWake from Deep Idle';

    expect(parsePmset(text)).toEqual([{ from: at('2026-10-01T21:09:18Z'), to: at('2026-10-02T07:34:59Z') }]);
  });
});

describe('task lines and test steps', () => {
  const log = [
    'rafa· task 11/18 start "Move every isolating environment"',
    'rafa· task 11/18 done  631m  199k tokens',
    'rafa· task 11/21 blocked status: blocked',
    '--- restart 12:15',
  ].join('\n');

  it('reads done and blocked lines with their minutes', () => {
    expect(parseTaskLines(log)).toEqual([
      { index: 11, total: 18, outcome: 'done', minutes: 631 },
      { index: 11, total: 21, outcome: 'blocked', minutes: undefined },
    ]);
  });

  it('totals test steps by scope from their summaries', () => {
    const record = { steps: [
      { scope: 'full', summary: 'Ran 16542 tests across 825 files. [293.77s]' },
      { scope: 'affected', summary: 'Ran 3 tests. [1902000ms]' },
      { scope: 'affected', summary: 'no tests' },
    ] };

    expect(stepTotals([record])).toEqual({ full: { count: 1, minutes: 4.9 }, affected: { count: 2, minutes: 31.7 } });
  });

  it('takes the sleep out of the task session it fell in', () => {
    const lines = parseTaskLines('rafa· task 11/18 done  631m  199k tokens');
    const session = { from: at('2026-10-01T21:08:56Z'), to: at('2026-10-02T07:39:41Z') };
    const { tasks, matched } = matchSessions(lines, [session], parseJournal(JOURNAL));

    expect(matched).toBe(true);
    expect(tasks[0]?.awakeMinutes).toBeCloseTo(5.1, 1);
  });

  it('falls back to the line and says so when no session agrees with it', () => {
    const lines = parseTaskLines('rafa· task 1/2 done  9m  1k tokens');
    const { tasks, matched } = matchSessions(lines, [{ from: 0, to: 60_000 }], []);

    expect(matched).toBe(false);
    expect(tasks[0]?.awakeMinutes).toBe(9);
  });

  it('reads a session log window from its first and last timestamps', () => {
    expect(sessionWindow('{"timestamp":"2026-10-02T08:00:00Z"}\n{"x":1}\n{"timestamp":"2026-10-02T08:05:00Z"}')).toEqual({ from: at('2026-10-02T08:00:00Z'), to: at('2026-10-02T08:05:00Z') });
  });

  it('summarises with nearest-rank percentiles', () => {
    expect(summarise([1, 2, 3, 4, 10])).toEqual({ count: 5, sum: 20, mean: 4, p50: 3, p90: 10 });
    expect(summarise([])).toEqual({ count: 0, sum: 0, mean: 0, p50: 0, p90: 0 });
  });
});

describe('data-check', () => {
  const rows = [
    { filePath: '/Users/one/.claude/projects/x/a.jsonl', lastTimestamp: '2026-09-29T08:51:22Z' },
    { filePath: '/home/two/.claude/projects/x/b.jsonl', lastTimestamp: '2026-09-26T20:11:24Z' },
  ];

  it('splits rows by home directory', () => {
    expect(homeRoot('/Users/one/.claude/x')).toBe('/Users/one');
    expect(homeRoot('C:\\Users\\three\\x')).toBe('C:\\Users\\three');
    expect(homeRoot('/srv/x')).toBe('other');
  });

  it('answers not usable when this machine has nothing in the window, and names the mix', () => {
    const check = checkRows(rows, '/home/two', at('2026-10-01T00:00:00Z'));

    expect(check.usable).toBe(false);
    expect(check.reasons[0]).toContain('newest is 2026-09-26T20:11:24Z');
    expect(check.reasons[1]).toContain('2 home directories are mixed');
  });

  it('answers usable when this machine has rows in the window', () => {
    expect(checkRows(rows, '/Users/one', at('2026-09-29T00:00:00Z')).usable).toBe(true);
  });
});

describe('filings', () => {
  const causes = parseCauses(JSON.stringify([
    { cause: 'native-pickers', kept: 581, pattern: 'branchClaimFor' },
    { cause: 'status-nogit', kept: 342, pattern: 'status\\.test\\.ts' },
  ]));

  it('groups a filing under the one cause it matches, reading the What block', () => {
    const groups = groupFilings([
      { number: 654, title: 'relation-readings tests fail', body: '## What\n\n```\nreadings.branchClaimFor is not a function\n```' },
      { number: 651, title: 'src/commands/status.test.ts fails', body: '' },
    ], causes);

    expect(groups.byCause).toEqual([
      { cause: 'native-pickers', kept: 581, filings: [654] },
      { cause: 'status-nogit', kept: 342, filings: [651] },
    ]);
    expect(groups.unmatched).toEqual([]);
  });

  it('leaves a filing matching two causes or none to the agent', () => {
    const groups = groupFilings([
      { number: 652, title: '28 tests fail: branchClaimFor and status.test.ts', body: '' },
      { number: 653, title: 'rafa epic close keys a failed criterion', body: '' },
    ], causes);

    expect(groups.unmatched.map((filing) => [filing.number, filing.causes])).toEqual([[652, ['native-pickers', 'status-nogit']], [653, []]]);
  });

  it('refuses a causes entry with a field missing', () => {
    expect(() => parseCauses('[{"cause":"x","pattern":"y"}]')).toThrow('entry 1 needs cause, kept and pattern');
  });
});

describe('merge conditions', () => {
  const show = '{"type":"start"}\n{"type":"result","data":{"detail":{"state":"open","headRefName":"feat/rafa-628-pr-base","baseRefName":"main","mergeStateStatus":"CLEAN"}}}';

  it('reads the pull request from the result line', () => {
    expect(parsePrShow(show)?.baseRefName).toBe('main');
    expect(parsePrShow('not json')).toBeUndefined();
  });

  it('names every condition that fails', () => {
    const detail = parsePrShow(show);

    expect(detail && mergeRefusals(detail, 'feat/rafa-628-pr-base', 'stretch/1', { clean: false, branch: 'stretch/1' })).toEqual([
      'its base is main, not stretch/1',
      'the main checkout has uncommitted changes',
    ]);
  });
});

describe('watch signals', () => {
  const base = { at: 0, agent: 'busy', agentQuietMinutes: 1, denials: 0, topError: undefined, hook: [], log: 'l', events: 0, lastLine: 'rafa· task 1/2 start "x"', loopQuietMinutes: 1, loops: ['rafa-486'] };
  const thresholds = { waitMinutes: 5, quietMinutes: 30, repeats: 3 };

  it('reads the engineer by session id, gone when absent', () => {
    expect(agentStatus('[{"sessionId":"a","status":"waiting"}]', 'a')).toBe('waiting');
    expect(agentStatus('[]', 'a')).toBe('gone');
  });

  it('counts denials and the most repeated error result', () => {
    const line = JSON.stringify({ message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1' }] } });
    const signals = transcriptSignals(`${line}\n${line}\nPermission for this action was denied by the Claude Code auto mode classifier.`);

    expect(signals).toEqual({ denials: 1, topError: { text: 'Exit code 1', count: 2 } });
  });

  it('reads the running loops from rafa loop list', () => {
    expect(runningLoops('{"type":"result","data":{"sessions":[{"session":{"planStub":"rafa-486","state":"running"}}]}}')).toEqual(['rafa-486']);
  });

  it('fires on a new event line, a gone agent with a loop live, and a loop that ended', () => {
    expect(fired(base, { ...base, events: 1, lastLine: 'rafa· pr #648 opened' }, thresholds)).toEqual(['loop event: rafa· pr #648 opened']);
    expect(fired(base, { ...base, agent: 'gone' }, thresholds)).toEqual(['agent busy → gone', 'agent gone, loop still running: rafa-486']);
    expect(fired(base, { ...base, loops: [] }, thresholds)).toEqual(['loop ended: rafa-486']);
  });

  it('fires on awake quiet time, a long wait and a repeated error at their thresholds', () => {
    expect(fired(base, { ...base, loopQuietMinutes: 30 }, thresholds)).toEqual(['loop quiet 30 min awake']);
    expect(fired({ ...base, agent: 'waiting' }, { ...base, agent: 'waiting', agentQuietMinutes: 6 }, thresholds)).toEqual(['agent waiting 6 min']);
    expect(fired(base, { ...base, topError: { text: 'e', count: 3 } }, thresholds)).toEqual(['same error 3× in the agent\'s thread']);
  });
});
