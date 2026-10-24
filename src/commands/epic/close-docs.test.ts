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
 *
 * ## The stale-docs line service
 *
 * `routeDocsOnlyFailure` adds its line through
 * `activeServices().addStaleDocLine`, core's service registry, which the
 * preload has filled with the real set. The stubbed case registers
 * `{ ...activeServices(), addStaleDocLine: stub }`, keeps what that call
 * answered and puts it back in `afterEach`; the unregistered case puts
 * the set to none for its body and back after. The stub answers `held`,
 * which the real function answers for no fresh issue, so its line tells
 * it from the real one.
 */
import type { EpicCriterion } from '../../epic/verify-plan.js';
import type { AddStaleDocLineOptions, RafaServices } from '@open-tomato/rafa/core/services';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { activeServices, registerServices, restoreServices } from '@open-tomato/rafa/core/services';
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

describe('routeDocsOnlyFailure, the stale-docs line service', () => {
  /** The set the stubbed setup replaced, put back after each case; undefined when none was set up. */
  let replaced: RafaServices | null | undefined;

  afterEach(() => {
    if (replaced !== undefined) restoreServices(replaced);
    replaced = undefined;
  });

  /** Registers a recording `addStaleDocLine` over the active set, answering `held`; see the stage's stubbed setup. */
  function stubAddLine(): readonly AddStaleDocLineOptions[] {
    const calls: AddStaleDocLineOptions[] = [];
    const stub: RafaServices['addStaleDocLine'] = (options) => {
      calls.push(options);
      return Promise.resolve({
        action: 'held',
        ref: { opt: 7, kind: 'local', externalId: '7', url: null },
        title: 'the stubbed issue',
      });
    };
    replaced = registerServices({ ...activeServices(), addStaleDocLine: stub });
    return calls;
  }

  it('calls the registered addStaleDocLine once with the tracker, the version and the entry', async () => {
    const calls = stubAddLine();
    const root = freshRoot();
    const tracker = createLocalTracker({ issuesDir: join(root, '.rafa', 'issues'), fallbackReason: null });

    const lines = await routeDocsOnlyFailure({
      repoRoot: root, epic: 46, criterion: PAGE_ONLY, sessionId: 's', tracker,
      version: () => '1.4.0', redact: (text) => text,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tracker).toBe(tracker);
    expect(calls[0]?.version).toBe('1.4.0');
    expect(calls[0]?.entry).toEqual({ where: null, what: docsOnlyWhat(46, PAGE_ONLY) });
    expect(lines.map((line) => line.text)).toEqual([
      'Criterion 1: names only documentation, so no bug is filed; local issue 7, the stubbed issue, already holds the line.',
    ]);
    // The stub answered for the real function, so the tracker opened nothing.
    expect(await openChore(tracker)).toEqual([]);
    expect(readStaleDocsForPlan(root, null)).toHaveLength(1);
  });

  it('writes a warning naming addStaleDocLine and the root while no service is registered, and still stores the row', async () => {
    const root = freshRoot();
    const tracker = createLocalTracker({ issuesDir: join(root, '.rafa', 'issues'), fallbackReason: null });
    const held = registerServices({ ...activeServices() });
    restoreServices(null);
    let lines: Awaited<ReturnType<typeof routeDocsOnlyFailure>>;
    try {
      lines = await routeDocsOnlyFailure({
        repoRoot: root, epic: 46, criterion: PAGE_ONLY, sessionId: 's', tracker,
        version: () => '1.4.0', redact: (text) => text,
      });
    } finally {
      restoreServices(held);
    }

    expect(lines).toEqual([{
      text: 'Criterion 1: not added to the stale-docs issue: service registry: no service is registered:'
        + ' call registerCoreServices() from src/service-registry.ts before calling addStaleDocLine',
      warn: true,
    }]);
    expect(await openChore(tracker)).toEqual([]);
    expect(readStaleDocsForPlan(root, null)).toHaveLength(1);
  });
});
