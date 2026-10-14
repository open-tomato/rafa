/**
 * Tests for the release's stale-docs issue.
 *
 * The issue cases run over the real `local` tracker in a fresh temporary
 * directory, so a found issue, an appended body and a created one are
 * read back as the adapter writes them. The cases about which calls are
 * made run over a fake that counts each call, or fails the test on any.
 *
 * Each case that answers no write sits beside the one that does, varied
 * in the one input, so a module that never wrote, or always did, reddens.
 */
import type { StaleDocsTracker } from './release-issue.js';
import type { IssueDraft, IssueEdit, IssueRef, OpenIssue, Tracker } from '../ports/index.js';
import type { SettleForecast } from '../release/forecast.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker } from '../adapters/tracker/local.js';
import { escapeBlockerText } from '../utils/tracker.js';

import {
  addStaleDocLine,
  bodyHoldsLine,
  DOC_UPDATE_TASK_PREFIX,
  docUpdateLineText,
  NEXT_VERSION,
  NO_EDITABLE_TRACKER,
  STALE_DOCS_MARKER,
  staleDocLine,
  staleDocLineText,
  staleDocsBody,
  staleDocsTitle,
  staleDocsVersion,
  tickStaleDocLine,
} from './release-issue.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A `local` tracker over a fresh empty directory, removed after the file. */
function localTracker(): Tracker {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-stale-docs-issue-'));
  scratch.push(dir);
  return createLocalTracker({ issuesDir: dir, fallbackReason: null, now: () => '2026-10-14T00:00:00.000Z' });
}

/** Every open stale-docs issue the tracker holds. */
async function markedIssues(tracker: Tracker): Promise<OpenIssue[]> {
  const open = await tracker.openIssues?.('chore') ?? [];
  return open.filter((issue) => issue.body.includes(STALE_DOCS_MARKER));
}

const PAGE = { where: 'context/triage.md:12', what: 'names three channels' };
const OTHER = { where: 'README.md', what: 'shows the old flag' };

const REF: IssueRef = { opt: 0, kind: 'fake', externalId: '7', url: null };

/** A fake whose calls are counted, answering `open` to the listing. */
function countingTracker(open: readonly OpenIssue[]): {
  tracker: StaleDocsTracker;
  created: IssueDraft[];
  edits: IssueEdit[];
} {
  const created: IssueDraft[] = [];
  const edits: IssueEdit[] = [];
  const tracker: StaleDocsTracker = {
    openIssues: async () => [...open],
    create: async (draft) => {
      created.push(draft);
      return REF;
    },
    edit: async (_ref, change) => {
      edits.push(change);
    },
  };
  return { tracker, created, edits };
}

describe('the builders', () => {
  it('titles the issue for its version', () => {
    expect(staleDocsTitle('0.27.0')).toBe('Release 0.27.0: update stale docs');
  });

  it('writes an entry as one unticked item, and its place left out when it named none', () => {
    expect(staleDocLine(PAGE)).toBe('- [ ] context/triage.md:12: names three channels');
    expect(staleDocLine({ where: null, what: 'names three channels' })).toBe('- [ ] names three channels');
    expect(staleDocLine({ where: '  ', what: 'names three channels' })).toBe('- [ ] names three channels');
  });

  it('puts a multi-line entry on one line, so it opens no second item', () => {
    const text = staleDocLineText({ where: 'a.md', what: 'first\n- [ ] forged\u2028# heading\u0007' });
    expect(text).toBe('a.md: first - [ ] forged # heading');
    expect(text).not.toMatch(/[\n\r\u2028\u2029]/);
  });

  it('opens no HTML comment, so an entry neither hides the body nor forges the marker', () => {
    const text = staleDocLineText({ where: null, what: `says ${STALE_DOCS_MARKER} and <!-- more` });
    expect(text).not.toContain('<!--');
    expect(text).toBe('says <\\!-- rafa:stale-docs --> and <\\!-- more');
  });

  it('opens a new body with the marker above the item', () => {
    const body = staleDocsBody(staleDocLine(PAGE));
    expect(body.startsWith(`${STALE_DOCS_MARKER}\n`)).toBe(true);
    expect(body.trimEnd().endsWith(staleDocLine(PAGE))).toBe(true);
  });

  it('reads an item as held ticked or not, and no other text', () => {
    const body = '- [ ] a.md: one\n- [x] b.md: two\nplain b.md: three\n';
    expect(bodyHoldsLine(body, 'a.md: one')).toBe(true);
    expect(bodyHoldsLine(body, 'b.md: two')).toBe(true);
    expect(bodyHoldsLine(body, 'b.md: three')).toBe(false);
    expect(bodyHoldsLine(body, 'a.md: on')).toBe(false);
  });
});

describe('staleDocsVersion', () => {
  const settles: SettleForecast = {
    kind: 'settles',
    strategy: 'semver-by-level',
    baseVersion: '0.26.3',
    waiting: ['a'],
    version: '0.27.0',
    bump: 'minor',
    section: '',
    sentence: 'settles as the next minor, 0.27.0',
  };

  it('names the forecast version when one settles', () => {
    expect(staleDocsVersion({ releaseEnabled: true, forecast: settles, versionFileValue: '0.26.3' })).toBe('0.27.0');
  });

  it('names the patch bump of the version file when the forecast names none', () => {
    const none: SettleForecast[] = [
      { kind: 'none', strategy: 'semver-by-level', sentence: '' },
      { kind: 'empty', sentence: '' },
      { kind: 'failed', strategy: 'semver-by-level', sentence: '' },
    ];
    for (const forecast of [...none, null]) {
      expect(staleDocsVersion({ releaseEnabled: true, forecast, versionFileValue: '0.26.3' })).toBe('0.26.4');
    }
  });

  it('names next when release is off, whatever the forecast says', () => {
    expect(staleDocsVersion({ releaseEnabled: false, forecast: settles, versionFileValue: '0.26.3' })).toBe(NEXT_VERSION);
  });

  it('names next when neither the forecast nor the version file names a version', () => {
    expect(staleDocsVersion({ releaseEnabled: true, forecast: null, versionFileValue: null })).toBe(NEXT_VERSION);
    expect(staleDocsVersion({ releaseEnabled: true, forecast: null, versionFileValue: 'unknown' })).toBe(NEXT_VERSION);
  });
});

describe('addStaleDocLine over a local tracker', () => {
  it('creates one issue for the first line, and a second line reaches the same issue', async () => {
    const tracker = localTracker();

    const first = await addStaleDocLine({ tracker, version: '0.27.0', entry: PAGE });
    const second = await addStaleDocLine({ tracker, version: '0.27.0', entry: OTHER });

    expect(first.action).toBe('created');
    expect(second.action).toBe('appended');
    const issues = await markedIssues(tracker);
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue?.title).toBe('Release 0.27.0: update stale docs');
    expect(second.action === 'appended' && second.ref.externalId).toBe(issue?.ref.externalId ?? '');
    expect(issue?.body).toContain(`${staleDocLine(PAGE)}\n${staleDocLine(OTHER)}\n`);
  });

  it('adds a repeated line once, writing nothing the second time', async () => {
    const tracker = localTracker();
    await addStaleDocLine({ tracker, version: '0.27.0', entry: PAGE });

    const repeated = await addStaleDocLine({ tracker, version: '0.27.0', entry: { ...PAGE } });

    expect(repeated.action).toBe('held');
    const [issue] = await markedIssues(tracker);
    expect(issue?.body.split(staleDocLine(PAGE))).toHaveLength(2);
  });

  it('opens a second issue for another version, leaving the first as it was', async () => {
    const tracker = localTracker();
    await addStaleDocLine({ tracker, version: '0.26.4', entry: PAGE });

    const shifted = await addStaleDocLine({ tracker, version: '0.27.0', entry: OTHER });

    expect(shifted.action).toBe('created');
    const titles = [...(await markedIssues(tracker)).map((issue) => issue.title)].sort();
    expect(titles).toEqual(['Release 0.26.4: update stale docs', 'Release 0.27.0: update stale docs']);
  });
});

describe('addStaleDocLine finding the issue', () => {
  const marked: OpenIssue = {
    ref: REF,
    title: staleDocsTitle('0.27.0'),
    body: staleDocsBody(staleDocLine(PAGE)),
    createdAt: null,
  };

  it('appends below the last item, the body otherwise as it was', async () => {
    const fake = countingTracker([marked]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.27.0', entry: OTHER });

    expect(result.action).toBe('appended');
    expect(fake.created).toHaveLength(0);
    expect(fake.edits).toEqual([{ body: `${marked.body}${staleDocLine(OTHER)}\n` }]);
  });

  it('holds a line the issue already has ticked, writing nothing', async () => {
    const ticked = { ...marked, body: marked.body.replace('- [ ]', '- [x]') };
    const fake = countingTracker([ticked]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.27.0', entry: PAGE });

    expect(result.action).toBe('held');
    expect(fake.edits).toHaveLength(0);
    expect(fake.created).toHaveLength(0);
  });

  it('takes no issue without the marker, even under the exact title', async () => {
    const unmarked = { ...marked, body: staleDocLine(PAGE) };
    const fake = countingTracker([unmarked]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.27.0', entry: PAGE });

    expect(result.action).toBe('created');
    expect(fake.edits).toHaveLength(0);
    expect(fake.created.map((draft) => [draft.type, draft.title])).toEqual([['chore', staleDocsTitle('0.27.0')]]);
  });

  it('takes no marked issue under a title that is not exactly the title', async () => {
    const near = { ...marked, title: `${staleDocsTitle('0.27.0')} (old)` };
    const fake = countingTracker([near]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.27.0', entry: OTHER });

    expect(result.action).toBe('created');
    expect(fake.edits).toHaveLength(0);
  });
});

describe('addStaleDocLine with no tracker to hold the issue', () => {
  /** A fake missing `omit`, whose every member fails the test when called. */
  function refusingTracker(omit: 'edit' | 'openIssues'): StaleDocsTracker {
    const fail = (member: string) => async (): Promise<never> => {
      throw new Error(`the tracker's ${member} was called`);
    };
    const create = fail('create');
    return omit === 'edit'
      ? { create, openIssues: fail('openIssues') }
      : { create, edit: fail('edit') };
  }

  it('keeps the line and calls nothing on a tracker with no edit', async () => {
    const result = await addStaleDocLine({ tracker: refusingTracker('edit'), version: '0.27.0', entry: PAGE });

    expect(result).toEqual({ action: 'kept', title: staleDocsTitle('0.27.0'), reason: NO_EDITABLE_TRACKER });
  });

  it('keeps the line on a tracker that cannot list its open issues', async () => {
    const result = await addStaleDocLine({ tracker: refusingTracker('openIssues'), version: '0.27.0', entry: PAGE });

    expect(result.action).toBe('kept');
  });

  it('keeps the line when no tracker resolved', async () => {
    const result = await addStaleDocLine({ tracker: null, version: 'next', entry: PAGE });

    expect(result.action).toBe('kept');
  });

  it('creates through a tracker holding every member, the control for the kept cases', async () => {
    const fake = countingTracker([]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.27.0', entry: PAGE });

    expect(result.action).toBe('created');
    expect(fake.created).toHaveLength(1);
  });
});

describe('addStaleDocLine when a call rejects', () => {
  it('answers the failed listing on one line, creating nothing', async () => {
    const fake = countingTracker([]);
    const tracker: StaleDocsTracker = {
      ...fake.tracker,
      openIssues: async () => {
        throw new Error('gh: HTTP 502\nretry later');
      },
    };

    const result = await addStaleDocLine({ tracker, version: '0.27.0', entry: PAGE });

    expect(result).toEqual({
      action: 'failed',
      title: staleDocsTitle('0.27.0'),
      problem: 'listing the open chore issues failed: gh: HTTP 502 retry later',
    });
    expect(fake.created).toHaveLength(0);
  });

  it('answers a failed create or edit rather than throwing', async () => {
    const reject = async (): Promise<never> => {
      throw new Error('refused');
    };
    const marked: OpenIssue = { ref: REF, title: staleDocsTitle('1.0.0'), body: STALE_DOCS_MARKER, createdAt: null };

    const created = await addStaleDocLine({
      tracker: { openIssues: async () => [], create: reject, edit: reject },
      version: '1.0.0',
      entry: PAGE,
    });
    const edited = await addStaleDocLine({
      tracker: { openIssues: async () => [marked], create: reject, edit: reject },
      version: '1.0.0',
      entry: PAGE,
    });

    expect(created.action === 'failed' && created.problem).toBe('creating the stale-docs issue failed: refused');
    expect(edited.action === 'failed' && edited.problem).toBe('editing the stale-docs issue failed: refused');
  });
});

describe('docUpdateLineText', () => {
  it('reads the escaped line back off a doc-update task, as its issue holds it', () => {
    const line = 'a.md:3: says <!-- old --> and\nmore';
    expect(docUpdateLineText(`${DOC_UPDATE_TASK_PREFIX}${escapeBlockerText(line)}`)).toBe(line);
  });

  it('reads no line off a task of any other shape, or one naming none', () => {
    expect(docUpdateLineText('Wire the loop')).toBeNull();
    expect(docUpdateLineText(`${DOC_UPDATE_TASK_PREFIX}  `)).toBeNull();
  });
});

describe('tickStaleDocLine over a local tracker', () => {
  /** A tracker holding one issue with the page and the other line, and that issue's id. */
  async function seeded(): Promise<{ tracker: Tracker; issue: string }> {
    const tracker = localTracker();
    const first = await addStaleDocLine({ tracker, version: '1.4.0', entry: PAGE });
    await addStaleDocLine({ tracker, version: '1.4.0', entry: OTHER });
    if (first.action !== 'created') throw new Error(`seeding answered ${first.action}`);
    return { tracker, issue: first.ref.externalId };
  }

  it('ticks the done task\'s line, leaving the other line open', async () => {
    const { tracker, issue } = await seeded();

    const result = await tickStaleDocLine({ tracker, issue, text: staleDocLineText(PAGE) });

    expect(result.action).toBe('ticked');
    const [held] = await markedIssues(tracker);
    expect(held?.body).toContain(`- [x] ${staleDocLineText(PAGE)}`);
    expect(held?.body).toContain(staleDocLine(OTHER));
    expect(held?.body).not.toContain(staleDocLine(PAGE));
  });

  it('answers absent and writes nothing for a line no longer in the body', async () => {
    const { tracker, issue } = await seeded();
    const [before] = await markedIssues(tracker);

    const result = await tickStaleDocLine({ tracker, issue, text: 'gone.md: was removed by hand' });

    expect(result.action).toBe('absent');
    const [after] = await markedIssues(tracker);
    expect(after?.body).toBe(before?.body ?? '');
  });

  it('answers absent for a line already ticked, so a second tick writes nothing', async () => {
    const { tracker, issue } = await seeded();
    await tickStaleDocLine({ tracker, issue, text: staleDocLineText(PAGE) });

    const again = await tickStaleDocLine({ tracker, issue, text: staleDocLineText(PAGE) });

    expect(again.action).toBe('absent');
  });

  it('answers no-issue for an id no open marked issue has', async () => {
    const { tracker } = await seeded();

    const result = await tickStaleDocLine({ tracker, issue: '999', text: staleDocLineText(PAGE) });

    expect(result).toEqual({ action: 'no-issue', issue: '999' });
  });
});

describe('tickStaleDocLine over a counting fake', () => {
  const body = `${STALE_DOCS_MARKER}\r\n\r\n- [ ] a.md: one\r\n  - [ ] b.md: two\r\n`;
  const open: OpenIssue = { ref: REF, title: staleDocsTitle('1.4.0'), body, createdAt: null };

  it('ticks only the box, the indent and line endings as they were', async () => {
    const { tracker, edits } = countingTracker([open]);

    const result = await tickStaleDocLine({ tracker, issue: '7', text: 'b.md: two' });

    expect(result).toEqual({ action: 'ticked', ref: REF });
    expect(edits).toEqual([{ body: `${STALE_DOCS_MARKER}\r\n\r\n- [ ] a.md: one\r\n  - [x] b.md: two\r\n` }]);
  });

  it('takes no issue of the id without the marker', async () => {
    const { tracker, edits } = countingTracker([{ ...open, body: '- [ ] b.md: two\n' }]);

    const result = await tickStaleDocLine({ tracker, issue: '7', text: 'b.md: two' });

    expect(result.action).toBe('no-issue');
    expect(edits).toEqual([]);
  });

  it('calls nothing on a tracker with no edit, or when none resolved', async () => {
    const calls: string[] = [];
    const tracker: StaleDocsTracker = {
      openIssues: async () => {
        calls.push('openIssues');
        return [open];
      },
      create: async () => {
        calls.push('create');
        return REF;
      },
    };

    expect(await tickStaleDocLine({ tracker, issue: '7', text: 'b.md: two' }))
      .toEqual({ action: 'untracked', reason: NO_EDITABLE_TRACKER });
    expect(await tickStaleDocLine({ tracker: null, issue: '7', text: 'b.md: two' }))
      .toEqual({ action: 'untracked', reason: NO_EDITABLE_TRACKER });
    expect(calls).toEqual([]);
  });

  it('answers a failed listing or edit on one line rather than throwing', async () => {
    const listing: StaleDocsTracker = {
      openIssues: () => Promise.reject(new Error('gh: rate\nlimited')),
      create: async () => REF,
      edit: async () => undefined,
    };
    const editing: StaleDocsTracker = { ...listing, openIssues: async () => [open], edit: () => Promise.reject(new Error('denied')) };

    const listed = await tickStaleDocLine({ tracker: listing, issue: '7', text: 'b.md: two' });
    const edited = await tickStaleDocLine({ tracker: editing, issue: '7', text: 'b.md: two' });

    expect(listed).toEqual({ action: 'failed', problem: 'listing the open chore issues failed: gh: rate limited' });
    expect(edited).toEqual({ action: 'failed', problem: 'editing the stale-docs issue failed: denied' });
  });
});
