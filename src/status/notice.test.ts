/**
 * Tests for the since-last-command notice (`notice.ts`).
 *
 * Every case compares two snapshots built in memory; nothing touches the
 * disk. Each rule that answers "not new" sits beside one that answers
 * "new" over the same field, so a comparison that always answered one way
 * would fail a case. The combination table walks all sixteen subsets of
 * the four kinds of news and checks the command each line names.
 */
import type { SeenNews } from './notice.js';
import type { SeenSession, SeenSnapshot } from './seen.js';

import { describe, expect, it } from 'bun:test';

import {
  CLEANUP_COMMAND,
  compareSeen,
  newsLine,
  NOTICE_PREFIX,
  noticeLine,
  STATUS_COMMAND,
} from './notice.js';
import { SEEN_VERSION } from './seen.js';

/** A snapshot holding `parts`, empty elsewhere. */
function snapshot(parts: Partial<Omit<SeenSnapshot, 'version'>> = {}): SeenSnapshot {
  return {
    version: SEEN_VERSION,
    idleWorktrees: parts.idleWorktrees ?? [],
    mergedBranches: parts.mergedBranches ?? [],
    sessions: parts.sessions ?? {},
  };
}

/** One session as the snapshot holds it. */
function session(state: SeenSession['state'], blocked: readonly number[] = []): SeenSession {
  return { state, blocked };
}

/** The state every case starts from: one worktree, one branch, one running loop with line 4 blocked. */
const BASE = snapshot({
  idleWorktrees: ['/p/.claude/worktrees/old'],
  mergedBranches: ['feat/old'],
  sessions: { s1: session('running', [4]) },
});

/** News with nothing in it. */
const NOTHING: SeenNews = { idleWorktrees: [], mergedBranches: [], stoppedSessions: [], blockedSessions: [] };

describe('noticeLine with no previous snapshot', () => {
  it('answers null however much the reading holds, where the same reading against an empty snapshot is news', () => {
    const current = snapshot({
      idleWorktrees: ['/w/a'],
      mergedBranches: ['feat/a'],
      sessions: { s1: session('stopped', [3]) },
    });
    expect(noticeLine(null, current)).toBeNull();
    expect(noticeLine(snapshot(), current)).not.toBeNull();
  });
});

describe('noticeLine with nothing new', () => {
  it('answers null for a reading equal to the snapshot', () => {
    expect(noticeLine(BASE, snapshot({ ...BASE }))).toBeNull();
  });

  it('answers null when things only went away: a worktree removed, a branch deleted, a session gone, a block cleared', () => {
    expect(noticeLine(BASE, snapshot())).toBeNull();
    expect(noticeLine(BASE, snapshot({ ...BASE, sessions: { s1: session('running') } }))).toBeNull();
  });

  it('answers null for a session already stopped in the snapshot, and for one that went from running to paused', () => {
    const before = snapshot({ sessions: { a: session('stopped'), b: session('running'), c: session('done') } });
    const after = snapshot({ sessions: { a: session('done'), b: session('paused'), c: session('stopped') } });
    expect(noticeLine(before, after)).toBeNull();
  });

  it('answers null for a session new since the snapshot that holds no blocked line', () => {
    expect(noticeLine(BASE, snapshot({ ...BASE, sessions: { ...BASE.sessions, s2: session('running') } }))).toBeNull();
  });
});

describe('each kind of news alone', () => {
  it('names a worktree that went idle, touched before or absent before, and runs rafa cleanup', () => {
    const current = snapshot({ ...BASE, idleWorktrees: [...BASE.idleWorktrees, '/w/b', '/w/a'] });
    expect(compareSeen(BASE, current)).toEqual({ ...NOTHING, idleWorktrees: ['/w/a', '/w/b'] });
    expect(noticeLine(BASE, current)).toBe(`${NOTICE_PREFIX}2 worktrees went idle; run rafa cleanup`);
  });

  it('names a branch newly in Merged and runs rafa cleanup', () => {
    const current = snapshot({ ...BASE, mergedBranches: ['feat/new', ...BASE.mergedBranches] });
    expect(compareSeen(BASE, current)).toEqual({ ...NOTHING, mergedBranches: ['feat/new'] });
    expect(noticeLine(BASE, current)).toBe(`${NOTICE_PREFIX}1 merged branch left behind; run rafa cleanup`);
  });

  it('names a running or paused loop that now reads stopped or done and runs rafa status', () => {
    const before = snapshot({ sessions: { a: session('running'), b: session('paused') } });
    const after = snapshot({ sessions: { a: session('done'), b: session('stopped') } });
    expect(compareSeen(before, after)).toEqual({ ...NOTHING, stoppedSessions: ['a', 'b'] });
    expect(noticeLine(before, after)).toBe(`${NOTICE_PREFIX}2 loops stopped; run rafa status`);
  });

  it('names a loop holding a blocked line the snapshot did not hold for it, once however many lines, and runs rafa status', () => {
    const current = snapshot({ ...BASE, sessions: { s1: session('running', [4, 9, 12]) } });
    expect(compareSeen(BASE, current)).toEqual({ ...NOTHING, blockedSessions: ['s1'] });
    expect(noticeLine(BASE, current)).toBe(`${NOTICE_PREFIX}1 loop has a new blocked task; run rafa status`);
  });

  it('counts a session absent from the snapshot when it holds a blocked line', () => {
    const current = snapshot({ ...BASE, sessions: { ...BASE.sessions, s2: session('running', [7]) } });
    expect(compareSeen(BASE, current)).toEqual({ ...NOTHING, blockedSessions: ['s2'] });
  });

  it('counts a blocked line new to one session although another session held it', () => {
    const before = snapshot({ sessions: { a: session('running', [5]), b: session('running') } });
    const after = snapshot({ sessions: { a: session('running', [5]), b: session('running', [5]) } });
    expect(compareSeen(before, after)).toEqual({ ...NOTHING, blockedSessions: ['b'] });
  });

  it('reads a session id the snapshot lacks as absent, not as an inherited property', () => {
    const current = snapshot({ sessions: { toString: session('stopped', [2]) } });
    expect(compareSeen(snapshot(), current)).toEqual({ ...NOTHING, blockedSessions: ['toString'] });
  });
});

describe('every combination names the right command', () => {
  /** The four kinds, each with a news value of two items and its words. */
  const KINDS = [
    { key: 'idleWorktrees', words: '2 worktrees went idle', loop: false },
    { key: 'mergedBranches', words: '2 merged branches left behind', loop: false },
    { key: 'stoppedSessions', words: '2 loops stopped', loop: true },
    { key: 'blockedSessions', words: '2 loops have new blocked tasks', loop: true },
  ] as const;

  const subsets = Array.from({ length: 2 ** KINDS.length }, (_, mask) => KINDS.filter((_kind, bit) => (mask & (1 << bit)) !== 0));

  it('walks all sixteen subsets', () => {
    expect(subsets).toHaveLength(16);
  });

  for (const subset of subsets) {
    const name = subset.length === 0
      ? 'nothing'
      : subset.map((kind) => kind.key).join(' + ');
    it(`${name}`, () => {
      const news: SeenNews = { ...NOTHING, ...Object.fromEntries(subset.map((kind) => [kind.key, ['x', 'y']])) };
      const line = newsLine(news);
      if (subset.length === 0) {
        expect(line).toBeNull();
        return;
      }
      const command = subset.some((kind) => kind.loop)
        ? STATUS_COMMAND
        : CLEANUP_COMMAND;
      expect(line).toBe(`${NOTICE_PREFIX}${subset.map((kind) => kind.words).join(', ')}; run ${command}`);
      expect(line).not.toContain('\n');
    });
  }

  it('names rafa status through noticeLine when housekeeping and a stopped loop are new together', () => {
    const current = snapshot({
      idleWorktrees: [...BASE.idleWorktrees, '/w/a'],
      mergedBranches: [...BASE.mergedBranches, 'feat/a', 'feat/b'],
      sessions: { s1: session('stopped', [4]) },
    });
    expect(noticeLine(BASE, current)).toBe(
      `${NOTICE_PREFIX}1 worktree went idle, 2 merged branches left behind, 1 loop stopped; run rafa status`,
    );
  });
});
