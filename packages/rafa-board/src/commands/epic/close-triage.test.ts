/**
 * Tests for the filing of `rafa epic close` (`close-triage.ts`): the
 * report a failed check is filed as, with its recurrence key, and the
 * line a filed bug is reported with. Filing through the whole command,
 * over a tracker, is driven by `./close.test.ts`.
 */
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { CheckAnswered } from '../../epic/verify-run.js';

import { bugKeyOf } from '@open-tomato/rafa/triage/bug-key';
import { describe, expect, it } from 'bun:test';

import { splitCriteria } from '../../epic/verify-plan.js';

import { bugLine, closeTriageFile, failedCheckArtifact, failedCheckReport } from './close-triage.js';

/** Epic #40's two criteria, as its body writes them. */
const CRITERION_1 = '- `rafa roadmap` shows each epic with its state.';
const CRITERION_2 = '- `rafa epics` shows one epic\'s issues.';

/** The commit a check ran against. */
const COMMIT = 'abc1234def';

/** One criterion by its text, as `splitCriteria` cuts #40's section. */
function criterionOf(text: string): EpicCriterion {
  const found = splitCriteria(`${CRITERION_1}\n${CRITERION_2}`).find((each) => each.text === text);
  if (found === undefined) throw new Error(`no criterion ${text}`);
  return found;
}

describe('failedCheckReport', () => {
  it('is one public bug and no blocker, its artifact the epic and criterion on one line', () => {
    const criterion = criterionOf(CRITERION_2);
    const failure: CheckAnswered = {
      kind: 'answered',
      check: { kind: 'check', criterion, check: 'Run rafa epics' },
      sessionId: 's',
      result: 'fail',
      evidence: 'it printed nothing',
    };

    const report = failedCheckReport(40, failure, COMMIT);

    expect(report.blockers).toEqual([]);
    expect(report.outOfScopeBugs).toHaveLength(1);
    expect(report.outOfScopeBugs[0]?.security).toBe(false);
    expect(report.outOfScopeBugs[0]?.module).toBe('epic');
    expect(report.outOfScopeBugs[0]?.action).toBe('close');
    expect(report.outOfScopeBugs[0]?.reproduce).toBe('rafa epic close 40');
    expect(report.outOfScopeBugs[0]?.cause).toBeNull();
    expect(report.outOfScopeBugs[0]?.what).toBe(`Epic #40 acceptance criterion 2 fails against main: ${CRITERION_2}`);
    expect(report.outOfScopeBugs[0]?.artifact).toBe(failedCheckArtifact(40, criterion));
    expect(report.feedback).toContain(`Evidence, against commit ${COMMIT}:\nit printed nothing`);
    expect(bugKeyOf(closeTriageFile('/r', 40), failedCheckArtifact(40, criterion))).toBe(`epic-40-close: epic # acceptance criterion: ${CRITERION_2}`);
  });
});

describe('bugLine', () => {
  it('warns that a row routed by its kind was not filed, and notes a filed one', () => {
    const criterion = criterionOf(CRITERION_2);
    const row = { index: 0, channel: 'public', ref: null, foundBy: null, stored: null, problem: null } as const;

    const routed = bugLine(criterion, { ...row, action: 'pr-body' });
    const filed = bugLine(criterion, { ...row, action: 'filed' });

    expect(routed).toEqual({ text: 'Criterion 2: not filed: routed to pr-body by its kind.', warn: true });
    expect(filed).toEqual({ text: 'Criterion 2: filed on the public tracker as an issue.', warn: false });
  });
});
