/**
 * Tests for the `docs` channel of `rafa epic close` (`close-docs.ts`):
 * which criterion is one, and what a failed check of one stores and
 * writes, over a fixture store in a temp directory and a `local` tracker
 * under it.
 *
 * ## The controls
 *
 * - The criterion naming a source file beside a page answers false, so
 *   the page-only criterion's true is the predicate's reading and not
 *   every criterion's.
 * - The tracker with `openIssues` and `edit` creates the issue, so the
 *   tracker with neither answering `kept` with no call is the tracker's
 *   doing.
 */
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readStaleDocsForPlan } from '@open-tomato/rafa/store/stale-docs';

import { createLocalTracker } from '../../adapters/tracker/local.js';
import { staleDocsTitle } from '../../docs/release-issue.js';

import { docsOnlyWhat, isDocsOnlyCriterion, routeDocsOnlyFailure } from './close-docs.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-close-docs-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A criterion page-only, as `splitCriteria` would cut it. */
const PAGE_ONLY: EpicCriterion = { number: 1, text: '- `context/triage.md` names the four channels.', placeholder: false };

/** A criterion naming a source file beside the page. */
const WITH_SOURCE: EpicCriterion = { number: 2, text: '- `src/triage/triage.ts` and `context/triage.md` agree on the channels.', placeholder: false };

/** A fresh project root. */
function freshRoot(): string {
  return mkdtempSync(join(tempBase, 'case-'));
}

/** The open `chore` issues of `tracker`, which a `local` tracker always lists. */
function openChore(tracker: Tracker): Promise<OpenIssue[]> {
  if (tracker.openIssues === undefined) throw new Error('the local tracker lists no open issues');
  return tracker.openIssues('chore');
}

describe('isDocsOnlyCriterion', () => {
  it('is true for a criterion naming only a page', () => {
    expect(isDocsOnlyCriterion(PAGE_ONLY)).toBe(true);
  });

  it('is false for a criterion naming a source file beside a page, and for one naming no path', () => {
    expect(isDocsOnlyCriterion(WITH_SOURCE)).toBe(false);
    expect(isDocsOnlyCriterion({ number: 3, text: '- `rafa epics` shows one epic\'s issues.', placeholder: false })).toBe(false);
  });
});

describe('routeDocsOnlyFailure', () => {
  it('stores one unsettled row with no plan stub and opens the stale-docs issue with the line', async () => {
    const root = freshRoot();
    const issuesDir = join(root, '.rafa', 'issues');
    const tracker = createLocalTracker({ issuesDir, fallbackReason: null });

    const lines = await routeDocsOnlyFailure({
      repoRoot: root, epic: 46, criterion: PAGE_ONLY, sessionId: 'session-2', tracker,
      version: () => '1.4.0', redact: (text) => text,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.warn).toBe(false);
    expect(lines[0]?.text).toContain(`opened local issue 1, ${staleDocsTitle('1.4.0')}, with the line.`);
    const open = await openChore(tracker);
    expect(open.map((issue) => issue.title)).toEqual([staleDocsTitle('1.4.0')]);
    expect(open[0]?.body).toContain(`- [ ] ${docsOnlyWhat(46, PAGE_ONLY)}`);
    const rows = readStaleDocsForPlan(root, null);
    expect(rows.map((row) => [row.kind, row.planStub, row.where, row.what, row.sessionId, row.taskLine, row.outcome])).toEqual([
      ['unsettled', null, null, docsOnlyWhat(46, PAGE_ONLY), 'session-2', 'rafa epic close 46', 'failed'],
    ]);
  });

  it('keeps the line with a warning when the tracker cannot list and edit, calling nothing, and still stores the row', async () => {
    const root = freshRoot();
    const calls: string[] = [];
    const tracker = { create: () => { calls.push('create'); return Promise.reject(new Error('not called')); } };

    const lines = await routeDocsOnlyFailure({
      repoRoot: root, epic: 46, criterion: PAGE_ONLY, sessionId: 's', tracker,
      version: () => 'next', redact: (text) => text,
    });

    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.warn).toBe(true);
    expect(lines[0]?.text).toContain(`not added to ${staleDocsTitle('next')}`);
    expect(lines[0]?.text).toContain(docsOnlyWhat(46, PAGE_ONLY));
    expect(readStaleDocsForPlan(root, null)).toHaveLength(1);
  });

  it('writes the redacted text into both the row and the line', async () => {
    const root = freshRoot();
    const issuesDir = join(root, '.rafa', 'issues');
    const tracker = createLocalTracker({ issuesDir, fallbackReason: null });

    await routeDocsOnlyFailure({
      repoRoot: root, epic: 46, criterion: PAGE_ONLY, sessionId: 's', tracker,
      version: () => '1.4.0', redact: (text) => text.replace('four', '[REDACTED]'),
    });

    expect(readStaleDocsForPlan(root, null)[0]?.what).toContain('[REDACTED] channels');
    const [issue] = await openChore(tracker);
    expect(issue?.body).toContain('[REDACTED] channels');
    expect(issue?.body).not.toContain('four channels');
    expect(readdirSync(issuesDir)).toHaveLength(1);
  });
});
