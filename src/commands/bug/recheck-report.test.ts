import type { RecheckReport, RecheckRow } from './recheck-report.js';

import { describe, expect, test } from 'bun:test';

import { recheckComment, renderRecheck } from './recheck-report.js';

const ROW: RecheckRow = {
  issue: 7,
  title: 't',
  verdict: 'gone',
  reference: { file: 'src/a.test.ts', pattern: null },
  runs: 3,
  failedRuns: null,
  reason: null,
  reproduce: null,
  commented: false,
};

function report(rows: readonly RecheckRow[], secretsLeftOut: readonly string[] = []): RecheckReport {
  return {
    rafa: '1.2.3',
    code: 'abc123-dirty',
    checkout: '/repo',
    secretsLeftOut,
    tracker: { kind: 'github', degraded: false, fallbackReason: null },
    rows,
  };
}

describe('renderRecheck', () => {
  test('the header names the rafa version, the code version and the checkout', () => {
    expect(renderRecheck(report([]))).toBe('rafa bug recheck at rafa 1.2.3, code abc123-dirty, checkout /repo');
  });

  test('a line names the variables left out when there are any', () => {
    const lines = renderRecheck(report([], ['A_TOKEN', 'B_KEY'])).split('\n');
    expect(lines[1]).toBe('left out of the environment: A_TOKEN, B_KEY');
  });

  test('one line per verdict', () => {
    const rows: RecheckRow[] = [
      ROW,
      { ...ROW, issue: 8, verdict: 'flaky', failedRuns: 1, reference: { file: 'b.test.ts', pattern: 'x y' } },
      { ...ROW, issue: 9, verdict: 'reproduces', runs: 1 },
      { ...ROW, issue: 10, verdict: 'stale', runs: 0, reason: 'src/a.test.ts is not in the checkout' },
      { ...ROW, issue: 11, verdict: 'skipped', runs: 0, reason: 'opened by eve, not trusted' },
      { ...ROW, issue: 12, verdict: 'manual', runs: 0, reference: null, reason: 'no Rerun section' },
    ];
    expect(renderRecheck(report(rows))
      .split('\n')
      .slice(1)).toEqual([
      '#7 gone src/a.test.ts (3 runs passed)',
      '#8 flaky b.test.ts -t "x y" (1 of 3 runs failed)',
      '#9 reproduces src/a.test.ts',
      '#10 stale src/a.test.ts is not in the checkout',
      '#11 skipped opened by eve, not trusted',
      '#12 manual no Rerun section',
    ]);
  });

  test('a manual row carries its reproduce text indented under it', () => {
    const row: RecheckRow = { ...ROW, verdict: 'manual', runs: 0, reference: null, reason: 'r', reproduce: 'step 1\nstep 2' };
    expect(renderRecheck(report([row]))
      .split('\n')
      .slice(1)).toEqual(['#7 manual r', '    step 1', '    step 2']);
  });
});

describe('recheckComment', () => {
  test('gone', () => {
    expect(recheckComment(ROW, report([ROW]))).toBe('gone at rafa 1.2.3, `abc123-dirty`: `src/a.test.ts` passed 3 runs');
  });

  test('flaky', () => {
    const row: RecheckRow = { ...ROW, verdict: 'flaky', failedRuns: 2, reference: { file: 'a.test.ts', pattern: 'p' } };
    expect(recheckComment(row, report([row]))).toBe('flaky at rafa 1.2.3, `abc123-dirty`: `a.test.ts -t "p"` failed 2 of 3 runs');
  });

  test('no comment on another verdict', () => {
    expect(recheckComment({ ...ROW, verdict: 'reproduces' }, report([]))).toBeNull();
  });
});
