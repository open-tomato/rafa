/**
 * Tests for the triage report (`triage-report.ts`).
 *
 * {@link renderTriage} is pure and total, so every shape — assessed with
 * a conflict, assessed with a failing step and a log excerpt, already
 * assessed, waiting on a run, green, a comment posted, a comment edited,
 * a comment refused, `--no-comment`, a log that could not be read, no
 * checks at all with each workflow count — is
 * driven by calling it with a reading built here. Nothing in this file
 * spawns a process, reaches a provider or reads a clock.
 *
 * The readings are built from the REAL `classifyTriage` and
 * `readTriageRerun` rather than from hand-written assessment literals,
 * so a case that says "the report shows `conflict-lockfile`" is showing
 * a class the classifier actually reached from a pull request shape. The
 * one thing built by hand is the log evidence, which `readFailedLog`
 * already has its own cases for.
 */
import type { WorkflowCountReading } from './triage-read.js';
import type { TriageReading } from './triage-report.js';
import type { CheckRow, PullRequestComment, PullRequestDetail } from '../../pr/index.js';
import type { FailedLogEvidence } from '../../pr/triage/evidence.js';

import { describe, expect, it } from 'bun:test';

import { classifyTriage } from '../../pr/triage/classify.js';
import { TRIAGE_MARKER } from '../../pr/triage/comment.js';
import { buildFollowUpPrompt } from '../../pr/triage/follow-up.js';
import { readTriageRerun } from '../../pr/triage/rerun.js';

import { evidenceOf, noChecksLines, renderTriage, renderTriages, workflowCountOf } from './triage-report.js';

/** The head commit every reading is pinned to. */
const HEAD = '0badc0ffee1234567890abcdef1234567890abcd';

/** The fence a triage block opens with, spelled in parts so this file carries no block of its own. */
const FENCE = '```';

/** A pull request detail, filled from `over`. */
function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-20: pull request commands',
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: 'feat/rafa-20',
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: '',
    headRefOid: HEAD,
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...over,
  };
}

/** A check row as `parseChecks` answers one. */
function row(name: string, state: string): CheckRow {
  const outcome = ((): CheckRow['outcome'] => {
    if (state === 'SUCCESS') return 'pass';
    return state === 'FAILURE'
      ? 'fail'
      : 'pending';
  })();
  return { name, state, link: 'https://github.com/open-tomato/rafa/actions/runs/9006/job/1', outcome };
}

/** A stored triage comment carrying `block` as its `rafa:triage` block. */
function comment(block: readonly string[]): PullRequestComment {
  return {
    id: '77',
    author: { login: 'rafa-bot', isBot: false },
    body: [TRIAGE_MARKER, `${FENCE}rafa:triage`, ...block, FENCE, ''].join('\n'),
    updatedAt: '2026-09-18T12:30:00Z',
    url: 'https://github.com/open-tomato/rafa/pull/41#issuecomment-77',
  };
}

/** A block naming `head`, which is the pull request's own unless a case moves it. */
function storedBlock(head: string = HEAD, triageClass = 'conflict-lockfile'): readonly string[] {
  return [
    `head: "${head}"`,
    'at: "2026-09-18T12:00:00Z"',
    `class: "${triageClass}"`,
    'simple: true',
    'attempts: 1',
    'files: ["bun.lock"]',
  ];
}

/** A log evidence reading, as `readFailedLog` answers one. */
function evidence(over: Partial<FailedLogEvidence> = {}): FailedLogEvidence {
  return {
    jobs: ['gates'],
    step: { name: 'bunx eslint .', source: 'group-marker' },
    lines: ['src/a.ts', '  1:1  error  something', '##[error]Process completed with exit code 1.'],
    omitted: 0,
    total: 3,
    ...over,
  };
}

/** What one reading is built from. */
interface ReadingSeed {
  readonly detail?: PullRequestDetail;
  readonly rows?: readonly CheckRow[];
  readonly comment?: PullRequestComment | null;
  readonly noComment?: boolean;
  readonly conflictFiles?: readonly string[];
  readonly evidence?: FailedLogEvidence | undefined;
  readonly write?: TriageReading['write'];
  readonly writeProblem?: string | null;
  readonly logProblems?: readonly string[];
  readonly ignored?: TriageReading['ignored'];
  readonly unlinked?: readonly string[];
  readonly maxAttempts?: number;
  readonly workflows?: WorkflowCountReading | null;
}

/** A reading as the command builds one, through the real rerun reader and classifier. */
function reading(seed: ReadingSeed = {}): TriageReading {
  const pull = seed.detail ?? detail();
  const rows = seed.rows ?? [row('gates', 'SUCCESS')];
  const rerun = readTriageRerun({
    comment: seed.comment ?? null,
    head: pull.headRefOid,
    rows,
    noComment: seed.noComment === true,
  });
  const attempts = rerun.block?.attempts ?? 0;
  const maxAttempts = seed.maxAttempts ?? 2;
  const logs = {
    readings: [],
    chosen: seed.evidence === undefined
      ? null
      : { runId: '9006', checks: ['gates'], evidence: seed.evidence },
    unlinked: seed.unlinked ?? [],
    problems: seed.logProblems ?? [],
  };
  if (!rerun.assesses) {
    return {
      detail: pull,
      rerun,
      ignored: seed.ignored ?? [],
      assessment: null,
      logs: null,
      workflows: null,
      conflict: null,
      prompt: null,
      write: null,
      writeProblem: null,
      attempts,
      maxAttempts,
    };
  }
  const assessment = classifyTriage({
    pr: pull,
    rows,
    step: seed.evidence?.step,
    conflictFiles: seed.conflictFiles ?? [],
    workflowCount: seed.workflows?.count ?? null,
  });
  return {
    detail: pull,
    rerun,
    ignored: seed.ignored ?? [],
    assessment,
    logs,
    workflows: seed.workflows ?? null,
    conflict: null,
    prompt: buildFollowUpPrompt({ pr: pull, assessment, evidence: seed.evidence }),
    write: seed.write ?? null,
    writeProblem: seed.writeProblem ?? null,
    attempts,
    maxAttempts,
  };
}

/** The lines of a rendered report, blank ones included. */
function linesOf(text: string): readonly string[] {
  return text.split('\n');
}

/** A comment as the port answers a written one. */
function written(action: 'posted' | 'edited'): TriageReading['write'] {
  return { action, comment: comment(storedBlock()) };
}

describe('the head line', () => {
  it('names the pull request, its branches and the head the triage is pinned to', () => {
    expect(linesOf(renderTriage(reading()))[0])
      .toBe('#41 rafa-20: pull request commands — feat/rafa-20 → main — head 0badc0f');
  });

  it('keeps the number alone when the title is blank', () => {
    expect(linesOf(renderTriage(reading({ detail: detail({ title: '  ' }) })))[0])
      .toBe('#41 — feat/rafa-20 → main — head 0badc0f');
  });
});

describe('a marker comment the trust check passed over', () => {
  it('prints its whole sentence under the re-run line, indented, and still prints the class', () => {
    const planted = reading({
      ignored: [{
        id: '77',
        url: 'https://github.com/open-tomato/rafa/pull/41#issuecomment-77',
        author: 'stranger',
        reason: 'the rafa:pr-triage comment ... was written by stranger, who has no write access to o/r;'
          + ' it was ignored and nothing in it was read',
      }],
    });

    const lines = linesOf(renderTriage(planted));

    expect(lines[1]).toBe(planted.rerun.headline);
    expect(lines[2]).toBe(
      '   the rafa:pr-triage comment ... was written by stranger, who has no write access to o/r;'
        + ' it was ignored and nothing in it was read',
    );
  });

  it('prints nothing of its own when no comment was passed over', () => {
    expect(renderTriage(reading())).not.toContain('was ignored');
  });
});

describe('a reading that assessed', () => {
  it('prints the class, whether it is simple, the attempts against the cap, and the evidence in order', () => {
    const conflicted = reading({
      detail: detail({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }),
      rows: [],
      conflictFiles: ['bun.lock'],
    });

    expect(linesOf(renderTriage(conflicted)).slice(2, 7)).toEqual([
      'conflict-lockfile — simple — attempts 0 of 2',
      '   Why: the head conflicts with the base on bun.lock',
      '   Conflicting files: bun.lock',
      '   Failing step: none named',
      '   Failing checks: none failing',
    ]);
  });

  it('names the failing step and the failing checks of a red pull request', () => {
    const red = reading({ rows: [row('gates', 'FAILURE')], evidence: evidence() });
    const lines = linesOf(renderTriage(red));

    expect(lines[2]).toBe('ci-lint — not simple — attempts 0 of 2');
    expect(lines).toContain('   Failing step: bunx eslint .');
    expect(lines).toContain('   Failing checks: gates');
    expect(lines).toContain('   Checks verdict: red');
  });

  it('quotes the log excerpt under a caption saying how much of the log it is', () => {
    const red = reading({
      rows: [row('gates', 'FAILURE')],
      evidence: evidence({ omitted: 97, total: 100 }),
    });

    expect(renderTriage(red)).toContain('   The last 3 lines of the failing job log, 97 earlier lines omitted of 100 in all.');
    expect(renderTriage(red)).toContain('      ##[error]Process completed with exit code 1.');
  });

  it('says the head merges cleanly where the class was not read from a conflict', () => {
    const red = reading({ rows: [row('gates', 'FAILURE')], evidence: evidence() });

    expect(linesOf(renderTriage(red))).toContain('   Conflicting files: none; the head merges cleanly');
  });

  it('names what no log could be read for, without hiding the class', () => {
    const red = reading({
      rows: [row('gates', 'FAILURE')],
      logProblems: ['the failing log of run 9006 could not be read: HTTP 403'],
      unlinked: ['ci/circle'],
    });
    const lines = linesOf(renderTriage(red));

    expect(lines[2]).toBe('ci-other — not simple — attempts 0 of 2');
    expect(lines).toContain('   the failing log of run 9006 could not be read: HTTP 403');
    expect(lines).toContain('   no Actions run is linked from ci/circle, so no log was read for it');
  });

  it('ends with the follow-up prompt, unindented, so it pastes into a session as it stands', () => {
    const text = renderTriage(reading({ rows: [row('gates', 'FAILURE')], evidence: evidence() }));
    const at = text.indexOf('Follow-up prompt:\n');

    expect(at).toBeGreaterThan(0);
    expect(text.slice(at + 'Follow-up prompt:\n'.length)).toStartWith('# Assessed pull request');
  });
});

describe('what the run wrote', () => {
  it('names a comment it posted, and one it edited, with the comment URL', () => {
    const posted = reading({ rows: [row('gates', 'FAILURE')], write: written('posted') });
    const edited = reading({ rows: [row('gates', 'FAILURE')], write: written('edited') });

    expect(renderTriage(posted)).toContain('Posted the triage comment: https://github.com/open-tomato/rafa/pull/41#issuecomment-77');
    expect(renderTriage(edited)).toContain('Edited the triage comment: https://github.com/open-tomato/rafa/pull/41#issuecomment-77');
  });

  it('reports a write that failed rather than hiding it, and still shows the class', () => {
    const refused = reading({ rows: [row('gates', 'FAILURE')], writeProblem: 'HTTP 403: resource not accessible' });
    const lines = linesOf(renderTriage(refused));

    expect(lines[2]).toBe('ci-other — not simple — attempts 0 of 2');
    expect(lines).toContain('The triage comment could not be written — HTTP 403: resource not accessible');
  });

  it('says no comment was written under --no-comment', () => {
    const quiet = reading({ rows: [row('gates', 'FAILURE')], noComment: true });

    expect(linesOf(renderTriage(quiet))).toContain('No comment was written.');
  });
});

describe('a reading that assessed nothing', () => {
  it('prints the already-assessed sentence and the stored triage, and no class line', () => {
    const stored = reading({ comment: comment(storedBlock()) });
    const lines = linesOf(renderTriage(stored));

    expect(lines[1]).toStartWith('already assessed at 2026-09-18T12:00:00Z');
    expect(lines[2]).toBe('   https://github.com/open-tomato/rafa/pull/41#issuecomment-77 — by rafa-bot');
    expect(lines[3]).toBe('   class conflict-lockfile — simple — attempts 1 — files bun.lock');
    expect(lines.join('\n')).not.toContain('Follow-up prompt:');
  });

  it('shows the old triage while a run is still going on a moved head', () => {
    const moved = reading({
      comment: comment(storedBlock('1111111111111111111111111111111111111111')),
      rows: [row('gates', 'IN_PROGRESS')],
    });
    const lines = linesOf(renderTriage(moved));

    expect(lines[1]).toContain('still running, so the triage from 2026-09-18T12:00:00Z stands');
    expect(lines[2]).toContain('issuecomment-77');
  });

  it('says a green pull request has nothing to triage, with no stored comment to show', () => {
    const green = reading({ rows: [row('gates', 'SUCCESS')] });
    const lines = linesOf(renderTriage(green));

    expect(lines[1]).toEndWith('so there is nothing to triage');
    expect(lines).toHaveLength(2);
  });

  it('names what the block reader objected to, so an unreadable stored block is visible', () => {
    const broken = reading({ comment: comment(['head: 0badc0ffee', 'attempts: "one"']) });

    expect(renderTriage(broken)).toContain('attempts is "one", not a whole number from 0');
  });
});

describe('the evidence a reading carries', () => {
  it('answers the chosen log reading, and undefined when no log was read', () => {
    expect(evidenceOf(reading({ rows: [row('gates', 'FAILURE')], evidence: evidence() }))?.jobs).toEqual(['gates']);
    expect(evidenceOf(reading())).toBeUndefined();
  });
});

describe('several pull requests', () => {
  it('joins one report per pull request with a blank line between them', () => {
    const first = reading({ detail: detail({ number: 41 }) });
    const second = reading({ detail: detail({ number: 42 }) });

    expect(renderTriages([first, second])).toBe(`${renderTriage(first)}\n\n${renderTriage(second)}`);
  });

  it('answers the empty string for no pull request at all', () => {
    expect(renderTriages([])).toBe('');
  });
});

describe('a pull request that reports no checks at all', () => {
  const NO_WORKFLOW = 'nothing on GitHub has tested this branch; you are relying on the checks run locally';
  const WORKFLOWS_EXIST = 'CI may not have started (a path filter, a draft, Actions disabled, or it has not registered yet);'
    + ' this is probably not what you want';

  /** A zero-check reading whose workflow count read `count`. */
  function noChecks(workflows: WorkflowCountReading | null): TriageReading {
    return reading({ rows: [], workflows });
  }

  it('prints the class, the count, the no-workflow warning and the --skip-checks line --yes may answer', () => {
    const lines = linesOf(renderTriage(noChecks({ count: 0 })));
    const verdict = lines.indexOf('   Checks verdict: none');

    expect(lines[2]).toBe('no-checks — not simple — attempts 0 of 2');
    expect(lines).toContain('   Why: the head reports no checks at all; the repository defines 0 workflows;'
      + ' to merge it anyway, run rafa pr merge 41 --skip-checks');
    expect(verdict).toBeGreaterThan(0);
    expect(lines.slice(verdict + 1, verdict + 4)).toEqual([
      '   Workflows: The repository defines 0 workflows.',
      `   Warning: ${NO_WORKFLOW}`,
      '   To merge it anyway: rafa pr merge 41 --skip-checks (it asks first; --yes may answer it)',
    ]);
  });

  it('prints the workflows-exist warning and refuses --yes when one or more workflows exist', () => {
    const lines = linesOf(renderTriage(noChecks({ count: 3 })));

    expect(lines).toContain('   Workflows: The repository defines 3 workflows.');
    expect(lines).toContain(`   Warning: ${WORKFLOWS_EXIST}`);
    expect(lines).toContain('   To merge it anyway: rafa pr merge 41 --skip-checks'
      + ' (it asks first; --yes is refused, so a person must answer it)');
    expect(lines.join('\n')).not.toContain(NO_WORKFLOW);
  });

  it('reads an unreadable count, and a count never asked for, as workflows existing and never as none', () => {
    for (const workflows of [{ count: null }, null]) {
      const text = renderTriage(noChecks(workflows));

      expect(text).toContain('   Workflows: The repository\'s workflow count could not be read.');
      expect(text).toContain(`   Warning: ${WORKFLOWS_EXIST}`);
      expect(text).toContain('--yes is refused');
      expect(text).not.toContain(NO_WORKFLOW);
    }
  });

  it('prints none of the three lines for any other class', () => {
    const others = [
      reading(),
      reading({ rows: [row('gates', 'FAILURE')], evidence: evidence() }),
      reading({ rows: [row('gates', 'IN_PROGRESS')] }),
      reading({ detail: detail({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }), rows: [], conflictFiles: ['bun.lock'], workflows: { count: 0 } }),
    ];

    for (const other of others) {
      const text = renderTriage(other);

      expect(text).not.toContain('Workflows:');
      expect(text).not.toContain('To merge it anyway:');
      if (other.assessment !== null) expect(noChecksLines(other, other.assessment)).toEqual([]);
    }
    expect(others[3]?.assessment?.triageClass).toBe('conflict-lockfile');
  });

  it('answers the count the reading carries, null when unread, and undefined when never asked for', () => {
    expect(workflowCountOf(noChecks({ count: 2 }))).toBe(2);
    expect(workflowCountOf(noChecks({ count: null }))).toBeNull();
    expect(workflowCountOf(noChecks(null))).toBeUndefined();
  });
});
