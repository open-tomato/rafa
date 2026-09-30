/**
 * Tests for the drift check (`drift.ts`): a ticked line still carrying a
 * stage label, a stage label with no claim branch, which checklists are
 * read, and what the check answers when the board or the branches could
 * not be read.
 *
 * Every "no finding" case has a control beside it: the same board with
 * the one input changed that makes it drift, so a check that could never
 * find anything fails the control rather than passing the case.
 */
import type { DriftBranches } from './drift.js';
import type { BoardIssue, BoardIssueState } from '../board/roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { checkDrift, checklistIssues, driftLines, findDrift } from './drift.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from './stale.js';

/** One row as the listing reads it. */
function row(number: number, labels: readonly string[], body = '', state: BoardIssueState = 'OPEN'): BoardIssue {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title: `Issue ${String(number)}`, body, state, stateReason, labels, type: typeOfLabels(labels), module: 'unassigned' };
}

/** A branch scan that read `refs` whole. */
function scanOf(refs: readonly string[], problems: readonly string[] = []): () => DriftBranches {
  return () => ({ refs, problems });
}

/** Every claim branch the cases below name, so no stage label is branchless unless a case says so. */
const ALL_BRANCHES = scanOf(['refs/heads/feat/rafa-12-a', 'refs/remotes/origin/feat/rafa-13-b', 'feat/rafa-14-c']);

describe('checklistIssues', () => {
  it('names every board and epic, open or closed, and the boards the caller adds, lowest first', () => {
    const issues = [
      row(9, ['type:roadmap']),
      row(4, ['type:epic'], '', 'CLOSED'),
      row(5, ['type:bug']),
      row(6, []),
    ];

    expect(checklistIssues(issues, [6, 9])).toEqual([4, 6, 9]);
    expect(checklistIssues(issues)).toEqual([4, 9]);
  });
});

describe('findDrift: ticked lines', () => {
  it('reports a ticked line whose issue is still labelled rafa:in-development, with the line and state', () => {
    const issues = [
      row(1, ['type:roadmap'], 'Intro\n- [ ] #13\n- [x] #12 done'),
      row(12, [IN_DEVELOPMENT_LABEL], '', 'CLOSED'),
      row(13, [IN_DEVELOPMENT_LABEL]),
    ];

    const report = findDrift({ issues, checklists: [1], branches: ALL_BRANCHES });

    expect(report.findings).toEqual([
      { kind: 'ticked-labelled', checklist: 1, lineNumber: 3, issue: 12, state: 'CLOSED', labels: [IN_DEVELOPMENT_LABEL] },
    ]);
    expect(report.notices).toEqual([]);
  });

  it('reports rafa:claimed too, and both labels when a failed swap left both', () => {
    const issues = [
      row(1, ['type:epic'], '- [x] #12\n- [X] #13'),
      row(12, [CLAIMED_LABEL]),
      row(13, [CLAIMED_LABEL, 'type:bug', IN_DEVELOPMENT_LABEL]),
    ];

    const report = findDrift({ issues, checklists: [1], branches: ALL_BRANCHES });

    expect(report.findings.map((finding) => [finding.issue, finding.labels])).toEqual([
      [12, [CLAIMED_LABEL]],
      [13, [IN_DEVELOPMENT_LABEL, CLAIMED_LABEL]],
    ]);
  });

  it('reports nothing for a ticked line with no stage label, and does for the same line labelled', () => {
    const clean = [row(1, ['type:roadmap'], '- [x] #12'), row(12, ['type:bug'], '', 'CLOSED')];
    const drifted = [row(1, ['type:roadmap'], '- [x] #12'), row(12, ['type:bug', CLAIMED_LABEL], '', 'CLOSED')];

    expect(findDrift({ issues: clean, checklists: [1], branches: ALL_BRANCHES }).findings).toEqual([]);
    expect(findDrift({ issues: drifted, checklists: [1], branches: ALL_BRANCHES }).findings).toHaveLength(1);
  });

  it('reports nothing for an unticked labelled line, and does once it is ticked', () => {
    const labelled = row(12, [IN_DEVELOPMENT_LABEL]);
    const unticked = findDrift({ issues: [row(1, ['type:roadmap'], '- [ ] #12'), labelled], checklists: [1], branches: ALL_BRANCHES });
    const ticked = findDrift({ issues: [row(1, ['type:roadmap'], '- [x] #12'), labelled], checklists: [1], branches: ALL_BRANCHES });

    expect(unticked.findings).toEqual([]);
    expect(ticked.findings).toHaveLength(1);
  });

  it('reads no line inside a fenced block, and reads it once the fence is gone', () => {
    const labelled = row(12, [IN_DEVELOPMENT_LABEL]);
    const fenced = findDrift({ issues: [row(1, ['type:roadmap'], '```\n- [x] #12\n```'), labelled], checklists: [1], branches: ALL_BRANCHES });
    const plain = findDrift({ issues: [row(1, ['type:roadmap'], '- [x] #12'), labelled], checklists: [1], branches: ALL_BRANCHES });

    expect(fenced.findings).toEqual([]);
    expect(plain.findings).toHaveLength(1);
  });

  it('reports one finding per checklist an issue is ticked on', () => {
    const issues = [
      row(1, ['type:roadmap'], '- [x] #12'),
      row(2, ['type:epic'], '- [x] #12'),
      row(12, [IN_DEVELOPMENT_LABEL]),
    ];

    const report = findDrift({ issues, checklists: [1, 2], branches: ALL_BRANCHES });

    expect(report.findings.map((finding) => finding.kind === 'ticked-labelled'
      ? finding.checklist
      : null)).toEqual([1, 2]);
  });

  it('answers a notice, not a finding, for a checklist or a ticked issue the listing does not hold', () => {
    const issues = [row(1, ['type:roadmap'], '- [x] #77')];

    const report = findDrift({ issues, checklists: [1, 3], branches: ALL_BRANCHES });

    expect(report.findings).toEqual([]);
    expect(report.notices).toEqual([
      '#77, ticked on #1, is not in the board listing, so it was not compared',
      '#3 is not in the board listing, so its checklist was not compared',
    ]);
  });
});

describe('findDrift: stage labels with no claim branch', () => {
  it('reports every labelled issue no branch names, lowest first, open and closed', () => {
    const issues = [
      row(40, [CLAIMED_LABEL], '', 'CLOSED'),
      row(12, [IN_DEVELOPMENT_LABEL]),
      row(30, [CLAIMED_LABEL]),
      row(50, ['type:bug']),
    ];

    const report = findDrift({ issues, checklists: [], branches: ALL_BRANCHES });

    expect(report.findings).toEqual([
      { kind: 'label-without-branch', issue: 30, state: 'OPEN', labels: [CLAIMED_LABEL] },
      { kind: 'label-without-branch', issue: 40, state: 'CLOSED', labels: [CLAIMED_LABEL] },
    ]);
  });

  it('counts a local branch, a remote-tracking ref and a remote head alike as a claim branch', () => {
    const issues = [row(12, [CLAIMED_LABEL]), row(13, [CLAIMED_LABEL]), row(14, [CLAIMED_LABEL])];

    expect(findDrift({ issues, checklists: [], branches: ALL_BRANCHES }).findings).toEqual([]);
    expect(findDrift({ issues, checklists: [], branches: scanOf(['refs/heads/feat/rafa-12-a']) }).findings
      .map((finding) => finding.issue)).toEqual([13, 14]);
  });

  it('does not read feat/rafa-120 as a branch of #12', () => {
    const issues = [row(12, [CLAIMED_LABEL])];

    const report = findDrift({ issues, checklists: [], branches: scanOf(['refs/heads/feat/rafa-120-x', 'refs/heads/fix/rafa-12-x']) });

    expect(report.findings.map((finding) => finding.issue)).toEqual([12]);
  });

  it('never asks for the branches when no issue carries a stage label, and asks once when one does', () => {
    let asked = 0;
    const branches = (): DriftBranches => {
      asked += 1;
      return { refs: [], problems: [] };
    };

    findDrift({ issues: [row(12, ['type:bug'])], checklists: [], branches });
    expect(asked).toBe(0);

    findDrift({ issues: [row(12, [CLAIMED_LABEL]), row(13, [CLAIMED_LABEL])], checklists: [], branches });
    expect(asked).toBe(1);
  });

  it('reports no branchless label while the scan saw only part of the branches, and names the problem', () => {
    const issues = [row(12, [CLAIMED_LABEL])];

    const partial = findDrift({ issues, checklists: [], branches: scanOf([], ['the branches on origin could not be read']) });
    const whole = findDrift({ issues, checklists: [], branches: scanOf([]) });

    expect(partial.findings).toEqual([]);
    expect(partial.notices).toEqual([
      'the branches on origin could not be read; so no stage label was reported as having no claim branch',
    ]);
    expect(whole.findings).toHaveLength(1);
  });
});

describe('checkDrift', () => {
  it('reads the listing and compares every board and epic checklist on it', async () => {
    const issues = [
      row(1, ['type:roadmap'], '- [x] #2'),
      row(2, ['type:epic'], '- [x] #12'),
      row(3, [], '- [x] #13'),
      row(12, [IN_DEVELOPMENT_LABEL]),
      row(13, [IN_DEVELOPMENT_LABEL]),
    ];
    const listing = (): Promise<readonly BoardIssue[]> => Promise.resolve(issues);

    const labelled = await checkDrift({ listing, branches: ALL_BRANCHES });
    const withDefault = await checkDrift({ listing, boards: [3], branches: ALL_BRANCHES });

    expect(labelled.findings.map((finding) => finding.issue)).toEqual([12]);
    expect(withDefault.findings.map((finding) => finding.issue)).toEqual([12, 13]);
  });

  it('answers the rejection as its one notice when the listing rejects, and never asks for branches', async () => {
    let asked = false;
    const report = await checkDrift({
      listing: () => Promise.reject(new Error('gh: HTTP 502')),
      branches: () => {
        asked = true;
        return { refs: [], problems: [] };
      },
    });

    expect(report).toEqual({ findings: [], notices: ['the board could not be read, so no drift was checked: gh: HTTP 502'] });
    expect(asked).toBe(false);
  });
});

describe('driftLines', () => {
  it('prints each finding, then each notice, prefixed', () => {
    const issues = [
      row(1, ['type:roadmap'], '- [x] #12\n- [x] #77'),
      row(12, [IN_DEVELOPMENT_LABEL], '', 'CLOSED'),
      row(30, [CLAIMED_LABEL]),
    ];

    const lines = driftLines(findDrift({ issues, checklists: [1], branches: ALL_BRANCHES }));

    expect(lines).toEqual([
      'claim drift: #12 is ticked on #1 (line 1) but still labelled rafa:in-development (closed)',
      'claim drift: #30 is labelled rafa:claimed (open) but no feat/rafa-30-* claim branch names it',
      'claim drift: #77, ticked on #1, is not in the board listing, so it was not compared',
    ]);
  });

  it('prints nothing for a report with nothing in it', () => {
    expect(driftLines({ findings: [], notices: [] })).toEqual([]);
  });
});
