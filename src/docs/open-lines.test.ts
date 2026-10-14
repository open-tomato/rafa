/**
 * Tests for reading the open stale-docs lines.
 *
 * The listing runs over a fake answering a fixed set of open issues, so
 * each case names exactly which bodies the reader sees. Every case that
 * drops a line sits beside one that keeps it, varied in the one input,
 * so a reader that kept everything, or nothing, reddens.
 */
import type { OpenLinesTracker } from './open-lines.js';
import type { IssueRef, IssueType, OpenIssue } from '../ports/index.js';

import { describe, expect, it } from 'bun:test';

import { NO_LISTING_PROBLEM, NO_TRACKER_PROBLEM, readOpenStaleDocLines } from './open-lines.js';
import { STALE_DOCS_MARKER, staleDocsBody } from './release-issue.js';

/** A ref for the issue numbered `id`. */
function ref(id: string): IssueRef {
  return { opt: 0, kind: 'fake', externalId: id, url: null };
}

/** An open issue numbered `id`, titled `title`, holding `body`. */
function issue(id: string, title: string, body: string): OpenIssue {
  return { ref: ref(id), title, body, createdAt: null };
}

/** A fake answering `open` to the listing and recording each type asked for. */
function listing(open: readonly OpenIssue[]): { tracker: OpenLinesTracker; asked: IssueType[] } {
  const asked: IssueType[] = [];
  const tracker: OpenLinesTracker = {
    openIssues: async (type) => {
      asked.push(type);
      return [...open];
    },
  };
  return { tracker, asked };
}

const FIRST = issue('11', 'Release 1.4.0: update stale docs', [
  STALE_DOCS_MARKER,
  '',
  'Opening sentence.',
  '',
  '- [ ] context/triage.md:12: names three channels',
  '- [x] README.md: shows the old flag',
  '- [X] AGENTS.md: names seven fields',
  '- [ ] docs/release.md: settles twice',
].join('\n'));

const SECOND = issue('14', 'Release 1.5.0: update stale docs', staleDocsBody('- [ ] context/cli.md: lists no docs subject'));

describe('readOpenStaleDocLines', () => {
  it('reads the unticked items of a marked issue and leaves the ticked ones', async () => {
    const { tracker, asked } = listing([FIRST]);

    const read = await readOpenStaleDocLines(tracker);

    expect(asked).toEqual(['chore']);
    expect(read.problem).toBeNull();
    expect(read.lines.map((line) => line.text)).toEqual([
      'context/triage.md:12: names three channels',
      'docs/release.md: settles twice',
    ]);
    expect(read.count).toBe(2);
  });

  it('reads a line again once its item is unticked', async () => {
    const unticked = issue('11', FIRST.title, FIRST.body.replace('- [x] README.md', '- [ ] README.md'));

    const read = await readOpenStaleDocLines(listing([unticked]).tracker);

    expect(read.lines.map((line) => line.text)).toContain('README.md: shows the old flag');
    expect(read.count).toBe(3);
  });

  it('reads every open marked issue, each line carrying its own issue', async () => {
    const read = await readOpenStaleDocLines(listing([FIRST, SECOND]).tracker);

    expect(read.problem).toBeNull();
    expect(read.count).toBe(3);
    expect(read.lines.map((line) => [line.ref.externalId, line.title, line.text])).toEqual([
      ['11', FIRST.title, 'context/triage.md:12: names three channels'],
      ['11', FIRST.title, 'docs/release.md: settles twice'],
      ['14', SECOND.title, 'context/cli.md: lists no docs subject'],
    ]);
  });

  it('reads no line from an issue whose body lacks the marker, whatever its title', async () => {
    const unmarked = issue('20', FIRST.title, '- [ ] context/triage.md:12: names three channels');

    const read = await readOpenStaleDocLines(listing([unmarked, SECOND]).tracker);

    expect(read.lines.map((line) => line.ref.externalId)).toEqual(['14']);
    expect(read.count).toBe(1);
  });

  it('reads no line from an item with no text, nor from a line that is not an item', async () => {
    const body = [STALE_DOCS_MARKER, '- [ ] ', '- [ ]   ', '[ ] no dash', '- [ ]   kept: trimmed  '].join('\r\n');

    const read = await readOpenStaleDocLines(listing([issue('3', 'Release next: update stale docs', body)]).tracker);

    expect(read.lines.map((line) => line.text)).toEqual(['kept: trimmed']);
  });

  it('answers a count of zero and no problem when no marked issue is open', async () => {
    const read = await readOpenStaleDocLines(listing([]).tracker);

    expect(read).toEqual({ lines: [], count: 0, problem: null });
  });

  it('answers a one-line problem in place of a throw when the listing rejects', async () => {
    const tracker: OpenLinesTracker = {
      openIssues: async () => {
        throw new Error('gh: not logged in\nrun gh auth login');
      },
    };

    const read = await readOpenStaleDocLines(tracker);

    expect(read.lines).toEqual([]);
    expect(read.count).toBe(0);
    expect(read.problem).toBe('listing the open chore issues failed: gh: not logged in run gh auth login');
  });

  it('answers a problem when the tracker cannot list its open issues', async () => {
    const read = await readOpenStaleDocLines({});

    expect(read).toEqual({ lines: [], count: 0, problem: NO_LISTING_PROBLEM });
  });

  it('answers a problem when no tracker was resolved', async () => {
    const read = await readOpenStaleDocLines(null);

    expect(read).toEqual({ lines: [], count: 0, problem: NO_TRACKER_PROBLEM });
  });
});
