/**
 * Tests for the away hop `loop start --roadmap` stamps on its session
 * record (`start/session.ts`): {@link openRunSession} with and without
 * `roadmap`, over a fresh project root per case holding the hop record
 * (`.rafa/hop.json`) and the position file a case plants.
 *
 * Every stamp sits beside a control differing in one thing: the same
 * files without `roadmap`, a home moved by hand, a record back home, no
 * position file, and a record that is no hop record. A key left out is
 * asserted with `Object.keys`, since bun's `toEqual` reads a key set to
 * undefined as a key left out.
 */
import type { RunSessionOptions } from './session.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { HopRecord } from '../next/hop-record.js';
import type { Place } from '../project/position.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { readSession } from '../loop/sessions.js';
import { hopFilePath, writeHopRecord } from '../next/hop-record.js';
import { hop, positionAt, rehome, writePositionFile } from '../project/position.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { openRunSession, readAwayHopStamp } from './session.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-session-hop-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let roots = 0;

/** A new, empty project root under {@link tempRoot}. */
function freshRoot(): string {
  roots += 1;
  const root = join(tempRoot, `root-${roots}`);
  mkdirSync(root);
  return root;
}

/** The id every opened session is given. */
const ID = 'session-0247';

/** A pid probe answering every pid alive. */
const ALIVE = (): boolean => true;

/** The keys a record without a hop holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

const HOME: Place = { board: 10, epic: 11 };
const AWAY: Place = { board: 20, epic: 21 };

/** The hop to C, #118 in epic 21 on board 20, from H, #210 at home. */
const AWAY_HOP: HopRecord = {
  kind: 'blocker',
  home: HOME,
  from: HOME,
  blocked: 210,
  target: 118,
  targetEpic: 21,
  targetBoard: 20,
  state: 'away',
  pullRequest: null,
  startedAt: '2026-09-28T10:00:00.000Z',
};

/** The options opening a `demo` session under `root`, with `overrides` laid over them. */
function options(root: string, overrides: Partial<RunSessionOptions> = {}): RunSessionOptions {
  return {
    repoRoot: root,
    planPath: join(root, '.rafa', 'plans', 'PLAN-demo.md'),
    planStub: 'demo',
    branch: 'feat/demo',
    seams: { newSessionId: () => ID, pid: 5151, now: () => new Date('2026-09-28T11:00:00.000Z'), isAlive: ALIVE },
    ...overrides,
  };
}

/** A root holding `record` and a position moved away from home by a hop, as `rafa next --roadmap` leaves it. */
function awayRoot(record: HopRecord = AWAY_HOP): string {
  const root = freshRoot();
  writeHopRecord(root, record);
  writePositionFile(root, hop(positionAt(HOME), AWAY));
  return root;
}

/** Opens a session under `root` with a sink output, and answers its stored record and each line written. */
function opened(root: string, overrides: Partial<RunSessionOptions>): { record: SessionRecord; lines: string[] } {
  const lines: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(`info:${message}`);
    },
    warn: (message) => {
      lines.push(`warn:${message}`);
    },
    error: (message) => {
      lines.push(`error:${message}`);
    },
  }));
  try {
    openRunSession(options(root, overrides));
  } finally {
    setActiveOutput(null);
  }
  return { record: readSession(root, ID, { isAlive: ALIVE }), lines };
}

describe('openRunSession under roadmap', () => {
  it('stamps the away hop as the record\'s hop, and prints nothing', () => {
    const { record, lines } = opened(awayRoot(), { roadmap: true });

    expect(record.hop).toEqual(AWAY_HOP);
    expect(Object.keys(record)).toEqual([...PLAIN_KEYS, 'hop']);
    expect(lines).toEqual([]);
  });

  it('leaves the hop key out without roadmap, over the same files', () => {
    const { record, lines } = opened(awayRoot(), {});

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(lines).toEqual([]);
  });

  it('leaves the hop key out with roadmap set to false', () => {
    expect(Object.keys(opened(awayRoot(), { roadmap: false }).record)).toEqual(PLAIN_KEYS);
  });

  it('stamps an away dry hop as it stamps a blocker hop', () => {
    const dry: HopRecord = { ...AWAY_HOP, kind: 'dry', blocked: null, target: null };

    expect(opened(awayRoot(dry), { roadmap: true }).record.hop).toEqual(dry);
  });

  it.each([
    ['waiting', 'waiting'],
    ['merged', 'merged'],
    ['halted', 'halted'],
  ] as const)('stamps nothing for a record back home %s', (_label, state) => {
    const { record } = opened(awayRoot({ ...AWAY_HOP, state }), { roadmap: true });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
  });

  it('stamps nothing for a stale record, whose home a switch by hand has moved', () => {
    const root = awayRoot();
    writePositionFile(root, rehome(hop(positionAt(HOME), AWAY), { board: 30, epic: 31 }));

    expect(Object.keys(opened(root, { roadmap: true }).record)).toEqual(PLAIN_KEYS);
  });

  it('stamps nothing with no position file to weigh the record against', () => {
    const root = freshRoot();
    writeHopRecord(root, AWAY_HOP);

    expect(Object.keys(opened(root, { roadmap: true }).record)).toEqual(PLAIN_KEYS);
  });

  it('stamps nothing and prints nothing with no hop record at all', () => {
    const root = freshRoot();
    writePositionFile(root, positionAt(HOME));

    const { record, lines } = opened(root, { roadmap: true });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(lines).toEqual([]);
  });

  it('warns in one line and stamps nothing for a file holding no hop record, and the run still opens', () => {
    const root = awayRoot();
    writeFileSync(hopFilePath(root), '{"kind":"blocker"}\n');

    const { record, lines } = opened(root, { roadmap: true });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(lines).toEqual([
      `warn:⚠️  --roadmap: no hop is stamped on the session record: ${hopFilePath(root)} does not hold a hop record`,
    ]);
  });
});

describe('readAwayHopStamp', () => {
  it('answers the record away and not stale, and null once the same record is back home', () => {
    const root = awayRoot();

    expect(readAwayHopStamp(root)).toEqual(AWAY_HOP);

    writeHopRecord(root, { ...AWAY_HOP, state: 'waiting', pullRequest: 301 });

    expect(readAwayHopStamp(root)).toBeNull();
  });
});
