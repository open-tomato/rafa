/**
 * Tests for the stale-docs reading of `rafa release status`
 * (`status-stale-docs.ts`): the count over a tracker, the cell it
 * renders to, a reader that throws, and the system's own reader over a
 * `local` tracker in a temporary directory.
 *
 * Every count case sits beside its control: an unmarked issue beside a
 * marked one, a ticked line beside an open one, so a reader counting
 * everything, or nothing, reddens. The system reader is driven with
 * `tracker.default: local`, so no case runs `gh`.
 */
import type { IssueDraft, OpenIssue } from '@open-tomato/rafa/ports';
import type { StaleDocsProject, StaleDocsReader } from '@open-tomato/rafa-release/commands/release/status-stale-docs';
import type { OpenLinesTracker } from '@open-tomato/rafa-release/docs/open-lines';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir } from '@open-tomato/rafa-board/adapters/tracker/local';
import {
  readStaleDocs,
  readStaleDocsSafely,
  staleDocsCell,
  staleDocsProblem,
  staleDocsReadingOf,
} from '@open-tomato/rafa-release/commands/release/status-stale-docs';
import { STALE_DOCS_MARKER, staleDocsBody } from '@open-tomato/rafa-release/docs/release-issue';

import { plantProject } from '../../../cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-stale-docs-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The tracker settings landing on `local` alone. */
const LOCAL = { trackerDefault: 'local', trackerFallback: ['local'] } as const;

/** An open chore issue numbered `id` holding `body`. */
function issue(id: string, body: string): OpenIssue {
  return { ref: { opt: 0, kind: 'fake', externalId: id, url: null }, title: 'Release 1.2.0: update stale docs', body, createdAt: null };
}

/** A tracker listing `open`. */
function listing(open: readonly OpenIssue[]): OpenLinesTracker {
  return { openIssues: async () => [...open] };
}

/** A body holding the marker and `items`. */
function marked(...items: readonly string[]): string {
  return [STALE_DOCS_MARKER, '', ...items].join('\n');
}

/** A chore draft holding `body`. */
function choreDraft(body: string): IssueDraft {
  return {
    opt: 0,
    title: 'Release 1.2.0: update stale docs',
    body,
    type: 'chore',
    module: 'docs',
    priority: null,
    project: null,
    blockedBy: [],
  };
}

describe('staleDocsReadingOf', () => {
  it('counts the open lines of marked issues, leaving ticked lines and unmarked issues out', async () => {
    const tracker = listing([
      issue('3', marked('- [ ] context/a.md: one', '- [x] context/b.md: settled', '- [ ] two')),
      issue('4', '- [ ] an unmarked chore item'),
      issue('5', marked('- [ ] README.md: three')),
    ]);

    const reading = await staleDocsReadingOf(tracker);

    expect(reading).toEqual({ count: 3, problem: null });
  });

  it('reads zero as a count, not as a problem', async () => {
    const reading = await staleDocsReadingOf(listing([issue('3', marked('- [x] settled'))]));

    expect(reading).toEqual({ count: 0, problem: null });
  });

  it('answers no count and a problem for a listing that rejects, and for no tracker', async () => {
    const rejecting: OpenLinesTracker = {
      openIssues: async () => {
        throw new Error('gh: HTTP 502\nretry later');
      },
    };

    const failed = await staleDocsReadingOf(rejecting);
    const none = await staleDocsReadingOf(null);

    expect(failed.count).toBeNull();
    expect(failed.problem).toBe('listing the open chore issues failed: gh: HTTP 502 retry later');
    expect(none.count).toBeNull();
    expect(none.problem).not.toBeNull();
  });
});

describe('staleDocsCell', () => {
  it('writes the nothing word at zero, a count above it, and null when unread', () => {
    expect(staleDocsCell({ count: 0, problem: null }, 'none')).toBe('none');
    expect(staleDocsCell({ count: 1, problem: null }, 'none')).toBe('1 open line');
    expect(staleDocsCell({ count: 4, problem: null }, 'none')).toBe('4 open lines');
    expect(staleDocsCell({ count: null, problem: 'x' }, 'none')).toBeNull();
  });

  it('says a problem in one sentence naming the stale-docs lines', () => {
    expect(staleDocsProblem('no tracker')).toBe('the stale-docs lines could not be read: no tracker');
  });
});

describe('readStaleDocsSafely', () => {
  it('keeps a reader that throws as a problem rather than rejecting', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'version: 1\n');
    const throwing: StaleDocsReader = () => {
      throw new Error('the tracker \nbroke');
    };

    const reading = await readStaleDocsSafely(throwing, project, LOCAL);

    expect(reading).toEqual({ count: null, problem: 'the tracker broke' });
  });

  it('hands a reader that answers through unchanged, which is the control for that', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'version: 1\n');
    const asked: StaleDocsProject[] = [];
    const answering: StaleDocsReader = async (found) => {
      asked.push(found);
      return { count: 2, problem: null };
    };

    const reading = await readStaleDocsSafely(answering, project, LOCAL);

    expect(reading).toEqual({ count: 2, problem: null });
    expect(asked).toEqual([project]);
  });
});

describe('readStaleDocs, the system reader', () => {
  it('counts the open lines the local tracker holds, through the chain', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'version: 1\n');
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
    await tracker.create(choreDraft(staleDocsBody('- [ ] context/a.md: one\n- [x] context/b.md: two\n- [ ] three')));
    await tracker.create(choreDraft('- [ ] not a stale-docs issue'));

    const reading = await readStaleDocs(project, LOCAL);

    expect(reading).toEqual({ count: 2, problem: null });
  });

  it('reads none on a local tracker holding no issue', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'version: 1\n');

    const reading = await readStaleDocs(project, LOCAL);

    expect(reading).toEqual({ count: 0, problem: null });
  });

  it('answers a problem when the chain lands nowhere', async () => {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'version: 1\n');

    const reading = await readStaleDocs(project, { trackerDefault: 'linear', trackerFallback: [] });

    expect(reading.count).toBeNull();
    expect(reading.problem).toStartWith('no tracker can be read: ');
  });
});
