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
import type { StaleDocsTracker } from '@open-tomato/rafa/core/services';
import type { IssueDraft, IssueEdit, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { SettleForecast } from '@open-tomato/rafa-release/release/forecast';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { escapeBlockerText } from '@open-tomato/rafa/core/plan';
import { staleDocLineText } from '@open-tomato/rafa/triage/stale-doc-line';
import { createLocalTracker } from '@open-tomato/rafa-board/adapters/tracker/local';
import {
  addStaleDocLine,
  bodyHoldsLine,
  DOC_UPDATE_TASK_PREFIX,
  docUpdateLineText,
  isUnreleasedVersion,
  NEXT_VERSION,
  NO_EDITABLE_TRACKER,
  olderFirst,
  STALE_DOCS_MARKER,
  staleDocLine,
  staleDocsBody,
  staleDocsTitle,
  staleDocsTitleVersion,
  staleDocsVersion,
  tickStaleDocLine,
} from '@open-tomato/rafa-release/docs/release-issue';

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

/** The `comment` and `transition` a fake answers when the case reads neither. */
const CLOSING: Pick<StaleDocsTracker, 'comment' | 'transition'> = {
  comment: async () => undefined,
  transition: async () => ({}),
};

/** What a counting fake was asked to write: each edit's issue id beside it, `<id>: <body>` and `<id> <state>`. */
interface Calls {
  created: IssueDraft[];
  edits: IssueEdit[];
  edited: string[];
  comments: string[];
  transitions: string[];
}

/**
 * A fake whose calls are counted, answering each listing with the next of
 * `listings` (the last again once they run out) and each create with
 * `createdRef`.
 */
function stagedTracker(listings: readonly (readonly OpenIssue[])[], createdRef: IssueRef = REF): Calls & {
  tracker: StaleDocsTracker;
} {
  const calls: Calls = { created: [], edits: [], edited: [], comments: [], transitions: [] };
  let listed = 0;
  const tracker: StaleDocsTracker = {
    openIssues: async () => {
      const open = listings[Math.min(listed, listings.length - 1)] ?? [];
      listed += 1;
      return [...open];
    },
    create: async (draft) => {
      calls.created.push(draft);
      return createdRef;
    },
    edit: async (ref, change) => {
      calls.edits.push(change);
      calls.edited.push(ref.externalId);
    },
    comment: async (ref, body) => {
      calls.comments.push(`${ref.externalId}: ${body}`);
    },
    transition: async (ref, state) => {
      calls.transitions.push(`${ref.externalId} ${state}`);
      return {};
    },
  };
  return { tracker, ...calls };
}

/** A fake whose calls are counted, answering `open` to every listing. */
function countingTracker(open: readonly OpenIssue[]): Calls & { tracker: StaleDocsTracker } {
  return stagedTracker([open]);
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
    const members = { create: fail('create'), comment: fail('comment'), transition: fail('transition') };
    return omit === 'edit'
      ? { ...members, openIssues: fail('openIssues') }
      : { ...members, edit: fail('edit') };
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
      tracker: { ...CLOSING, openIssues: async () => [], create: reject, edit: reject },
      version: '1.0.0',
      entry: PAGE,
    });
    const edited = await addStaleDocLine({
      tracker: { ...CLOSING, openIssues: async () => [marked], create: reject, edit: reject },
      version: '1.0.0',
      entry: PAGE,
    });

    expect(created.action === 'failed' && created.problem).toBe('creating the stale-docs issue failed: refused');
    expect(edited.action === 'failed' && edited.problem).toBe('editing the stale-docs issue failed: refused');
  });
});

/** A marked open issue of `version`, id `id`, created at `createdAt`, holding `entry`'s line. */
function chore(id: string, version: string, createdAt: string | null, entry = PAGE): OpenIssue {
  return {
    ref: { ...REF, externalId: id },
    title: staleDocsTitle(version),
    body: staleDocsBody(staleDocLine(entry)),
    createdAt,
  };
}

describe('the release reading', () => {
  it('reads the version back off a stale-docs title, and none off another shape', () => {
    expect(staleDocsTitleVersion(staleDocsTitle('0.50.1'))).toBe('0.50.1');
    expect(staleDocsTitleVersion(staleDocsTitle(NEXT_VERSION))).toBe(NEXT_VERSION);
    expect(staleDocsTitleVersion('Release 0.50.1: update stale docs (old)')).toBeNull();
    expect(staleDocsTitleVersion('Docs to fix')).toBeNull();
  });

  it('reads a version above the newest tag, and next, as unreleased, and one at or below it as released', () => {
    expect(isUnreleasedVersion('0.50.1', '0.50.0')).toBe(true);
    expect(isUnreleasedVersion('0.50.0-rc.1', '0.49.1')).toBe(true);
    expect(isUnreleasedVersion(NEXT_VERSION, '0.50.0')).toBe(true);
    expect(isUnreleasedVersion('0.50.0', '0.50.0')).toBe(false);
    expect(isUnreleasedVersion('0.49.1', '0.50.0')).toBe(false);
    expect(isUnreleasedVersion('0.50.0-rc.1', '0.50.0')).toBe(false);
  });

  it('reads every version as unreleased with no tag, and none but next against a tag that is no version', () => {
    expect(isUnreleasedVersion('0.0.1', null)).toBe(true);
    expect(isUnreleasedVersion('soon', null)).toBe(false);
    expect(isUnreleasedVersion('9.0.0', 'garbage')).toBe(false);
    expect(isUnreleasedVersion(NEXT_VERSION, 'garbage')).toBe(true);
  });

  it('orders the earlier creation first, then the lower issue number', () => {
    const early = chore('13', '0.50.0', '2026-11-02T13:40:05Z');
    const late = chore('12', '0.50.0', '2026-11-02T13:40:08Z');
    expect(olderFirst(early, late)).toBeLessThan(0);
    expect(olderFirst(late, early)).toBeGreaterThan(0);
    expect(olderFirst({ ...late, createdAt: early.createdAt }, early)).toBeLessThan(0);
    expect(olderFirst({ ...early, createdAt: null }, { ...late, ref: { ...REF, externalId: '9' } })).toBeGreaterThan(0);
  });
});

describe('addStaleDocLine with a release reading', () => {
  it('appends to the open chore of the same title, though an older unreleased one is open', async () => {
    const older = chore('3', '0.50.1', '2026-11-01T00:00:00Z');
    const same = chore('5', '0.51.0', '2026-11-02T00:00:00Z');
    const fake = countingTracker([older, same]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: OTHER, newestRelease: '0.50.0' });

    expect(result).toEqual({ action: 'appended', title: staleDocsTitle('0.51.0'), ref: same.ref });
    expect(fake.edited).toEqual(['5']);
    expect(fake.edits).toEqual([{ body: `${same.body}${staleDocLine(OTHER)}\n` }]);
    expect(fake.created).toHaveLength(0);
  });

  it('retitles the open chore of a moved forecast in the edit that appends the line', async () => {
    const moved = chore('3', '0.50.1', '2026-11-01T00:00:00Z');
    const fake = countingTracker([moved]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: OTHER, newestRelease: '0.50.0' });

    expect(result).toEqual({
      action: 'appended',
      title: staleDocsTitle('0.51.0'),
      ref: moved.ref,
      retitledFrom: staleDocsTitle('0.50.1'),
    });
    expect(fake.edits).toEqual([{ title: staleDocsTitle('0.51.0'), body: `${moved.body}${staleDocLine(OTHER)}\n` }]);
    expect(fake.created).toHaveLength(0);
  });

  it('opens a second issue for the moved forecast with no release reading, the control for the retitle', async () => {
    const moved = chore('3', '0.50.1', '2026-11-01T00:00:00Z');
    const fake = countingTracker([moved]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: OTHER });

    expect(result.action).toBe('created');
    expect(fake.edits).toHaveLength(0);
  });

  it('retitles alone a moved chore that already holds the line', async () => {
    const moved = chore('3', NEXT_VERSION, null);
    const fake = countingTracker([moved]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: PAGE, newestRelease: null });

    expect(result).toEqual({
      action: 'held',
      title: staleDocsTitle('0.51.0'),
      ref: moved.ref,
      retitledFrom: staleDocsTitle(NEXT_VERSION),
    });
    expect(fake.edits).toEqual([{ title: staleDocsTitle('0.51.0') }]);
  });

  it('takes the oldest of the unreleased chores when none has the title', async () => {
    const younger = chore('8', '0.50.2', '2026-11-03T00:00:00Z');
    const oldest = chore('9', '0.50.1', '2026-11-01T00:00:00Z');
    const fake = countingTracker([younger, oldest]);

    await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: OTHER, newestRelease: '0.50.0' });

    expect(fake.edited).toEqual(['9']);
  });

  it('leaves a released chore alone and creates, its own exact title included', async () => {
    const released = chore('3', '0.50.0', '2026-11-01T00:00:00Z');
    const below = chore('2', '0.49.1', '2026-10-01T00:00:00Z');
    const fake = countingTracker([released, below]);

    const moved = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.1', entry: OTHER, newestRelease: '0.50.0' });
    const same = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.50.0' });

    expect([moved.action, same.action]).toEqual(['created', 'created']);
    expect(fake.edits).toHaveLength(0);
    expect(fake.transitions).toHaveLength(0);
  });

  it('retitles that chore once the newest tag is below its version, the control for the released case', async () => {
    const fake = countingTracker([chore('3', '0.50.0', '2026-11-01T00:00:00Z')]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.1', entry: OTHER, newestRelease: '0.49.1' });

    expect(result.action === 'appended' && result.retitledFrom).toBe(staleDocsTitle('0.50.0'));
    expect(fake.created).toHaveLength(0);
  });

  it('leaves a marked issue of a person\'s title alone', async () => {
    const person = { ...chore('3', '0.50.1', null), title: 'Docs to fix before 0.51.0' };
    const fake = countingTracker([person]);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.51.0', entry: OTHER, newestRelease: '0.50.0' });

    expect(result.action).toBe('created');
    expect(fake.edits).toHaveLength(0);
  });

  it('reads a newest tag that is no version as no reading, keeping the exact title', async () => {
    const moved = chore('3', '0.50.1', null);
    const same = chore('4', '0.51.0', null);

    const shifted = await addStaleDocLine({
      tracker: countingTracker([moved]).tracker,
      version: '0.51.0',
      entry: OTHER,
      newestRelease: 'garbage',
    });
    const exact = countingTracker([moved, same]);
    const kept = await addStaleDocLine({ tracker: exact.tracker, version: '0.51.0', entry: OTHER, newestRelease: 'garbage' });

    expect(shifted.action).toBe('created');
    expect(kept).toEqual({ action: 'appended', title: staleDocsTitle('0.51.0'), ref: same.ref });
  });

  it('retitles the issue on the local tracker, which then holds one issue of the new title', async () => {
    const tracker = localTracker();
    await addStaleDocLine({ tracker, version: '0.50.1', entry: PAGE, newestRelease: '0.50.0' });

    const result = await addStaleDocLine({ tracker, version: '0.51.0', entry: OTHER, newestRelease: '0.50.0' });

    expect(result.action).toBe('appended');
    const issues = await markedIssues(tracker);
    expect(issues.map((issue) => issue.title)).toEqual([staleDocsTitle('0.51.0')]);
    expect(issues[0]?.body).toContain(`${staleDocLine(PAGE)}\n${staleDocLine(OTHER)}\n`);
  });
});

describe('addStaleDocLine converging after a create', () => {
  const OWN: IssueRef = { ...REF, externalId: '13' };
  const own = { ...chore('13', '0.50.0', '2026-11-02T13:40:08Z', OTHER), ref: OWN };
  const sibling = chore('12', '0.50.0', '2026-11-02T13:40:05Z');

  it('moves the line to the older sibling, then comments on and closes the new issue', async () => {
    const fake = stagedTracker([[], [own, sibling]], OWN);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.49.1' });

    expect(result).toEqual({ action: 'appended', title: staleDocsTitle('0.50.0'), ref: sibling.ref, duplicate: OWN });
    expect(fake.created).toHaveLength(1);
    expect(fake.edited).toEqual(['12']);
    expect(fake.edits).toEqual([{ body: `${sibling.body}${staleDocLine(OTHER)}\n` }]);
    expect(fake.comments).toEqual(['13: Duplicate of #12']);
    expect(fake.transitions).toEqual(['13 cancelled']);
  });

  it('keeps the new issue when the sibling is younger, the control for the close', async () => {
    const younger = chore('14', '0.50.0', '2026-11-02T13:40:11Z');
    const fake = stagedTracker([[], [own, younger]], OWN);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.49.1' });

    expect(result).toEqual({ action: 'created', title: staleDocsTitle('0.50.0'), ref: OWN });
    expect(fake.edits).toHaveLength(0);
    expect(fake.comments).toHaveLength(0);
    expect(fake.transitions).toHaveLength(0);
  });

  it('converges on a same-title sibling with no release reading, and on no other title', async () => {
    const sameTitle = stagedTracker([[], [own, sibling]], OWN);
    const otherTitle = stagedTracker([[], [own, chore('12', '0.49.2', '2026-11-02T13:40:05Z')]], OWN);

    const same = await addStaleDocLine({ tracker: sameTitle.tracker, version: '0.50.0', entry: OTHER });
    const other = await addStaleDocLine({ tracker: otherTitle.tracker, version: '0.50.0', entry: OTHER });

    expect(same.action === 'appended' && same.duplicate).toEqual(OWN);
    expect(other.action).toBe('created');
    expect(otherTitle.transitions).toHaveLength(0);
  });

  it('closes the new issue without an edit when the sibling already holds the line', async () => {
    const holding = chore('12', '0.50.0', '2026-11-02T13:40:05Z', OTHER);
    const fake = stagedTracker([[], [own, holding]], OWN);

    const result = await addStaleDocLine({ tracker: fake.tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.49.1' });

    expect(result).toEqual({ action: 'held', title: staleDocsTitle('0.50.0'), ref: holding.ref, duplicate: OWN });
    expect(fake.edits).toHaveLength(0);
    expect(fake.transitions).toEqual(['13 cancelled']);
  });

  it('leaves two racing wrap-ups one open issue holding both lines', async () => {
    const tracker = racingTracker();
    const [first, second] = await Promise.all([
      addStaleDocLine({ tracker, version: '0.50.0', entry: PAGE, newestRelease: '0.49.1' }),
      addStaleDocLine({ tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.49.1' }),
    ]);

    expect(tracker.creates()).toBe(2);
    const open = await tracker.openIssues('chore');
    expect(open.map((issue) => issue.ref.externalId)).toEqual(['1']);
    expect([PAGE, OTHER].filter((entry) => open[0]?.body.includes(staleDocLine(entry)))).toEqual([PAGE, OTHER]);
    expect([first.action, second.action].sort()).toEqual(['appended', 'created']);
    expect(tracker.comments()).toEqual(['2: Duplicate of #1']);
  });

  it('answers each failed step after the create, naming the issue created', async () => {
    const reject = (said: string) => async (): Promise<never> => {
      throw new Error(said);
    };
    const staged = (): StaleDocsTracker => stagedTracker([[], [own, sibling]], OWN).tracker;
    let listings = 0;
    const relist: StaleDocsTracker = {
      ...stagedTracker([[]], OWN).tracker,
      openIssues: async () => {
        listings += 1;
        if (listings > 1) throw new Error('gh: HTTP 502');
        return [];
      },
    };

    const answers = await Promise.all([
      relist,
      { ...staged(), edit: reject('edit refused') },
      { ...staged(), comment: reject('comment refused') },
      { ...staged(), transition: reject('close refused') },
    ].map((tracker) => addStaleDocLine({ tracker, version: '0.50.0', entry: OTHER, newestRelease: '0.49.1' })));

    expect(answers.map((answer) => answer.action === 'failed' && answer.problem)).toEqual([
      'listing the open chore issues after creating issue 13 failed: gh: HTTP 502',
      'editing the stale-docs issue failed: edit refused',
      'commenting on the duplicate issue 13 failed: comment refused',
      'closing the duplicate issue 13 failed: close refused',
    ]);
  });
});

/**
 * An in-memory tracker whose first two listings each wait until both
 * have started, so two callers list before either creates, as two
 * wrap-ups of parallel stretch loops did (#1412 and #1413).
 */
function racingTracker(): StaleDocsTracker & {
  openIssues: NonNullable<StaleDocsTracker['openIssues']>;
  creates: () => number;
  comments: () => string[];
} {
  const issues: { ref: IssueRef; title: string; body: string; createdAt: string; open: boolean }[] = [];
  const comments: string[] = [];
  let listings = 0;
  let bothListed: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => (bothListed = resolve));
  const byId = (ref: IssueRef) => {
    const found = issues.find((issue) => issue.ref.externalId === ref.externalId);
    if (found === undefined) throw new Error(`no issue ${ref.externalId}`);
    return found;
  };
  return {
    openIssues: async () => {
      listings += 1;
      if (listings === 2) bothListed();
      if (listings <= 2) await barrier;
      return issues.filter((issue) => issue.open).map(({ ref, title, body, createdAt }) => ({ ref, title, body, createdAt }));
    },
    create: async (draft) => {
      const number = issues.length + 1;
      const ref: IssueRef = { ...REF, externalId: String(number) };
      issues.push({ ref, title: draft.title, body: draft.body, createdAt: `2026-11-02T13:40:0${String(number)}Z`, open: true });
      return ref;
    },
    edit: async (ref, change) => {
      Object.assign(byId(ref), change);
    },
    comment: async (ref, body) => {
      comments.push(`${byId(ref).ref.externalId}: ${body}`);
    },
    transition: async (ref, state) => {
      byId(ref).open = state !== 'cancelled' && state !== 'done';
      return {};
    },
    creates: () => issues.length,
    comments: () => [...comments],
  };
}

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
      ...CLOSING,
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
      ...CLOSING,
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
