/**
 * Tests for the leftover repair dedupe (`packages/rafa-pr/src/triage/leftover-repair.ts`):
 * the keyed marker a repair line carries for an entry's recurrence key
 * and matched symbol, and the join `insertLeftoverRepair` answers onto an
 * open leftover line holding either. The line's shape, its escaping and
 * the cap without keys are pinned by
 * `src/tests/pr-coupled/triage/leftover-repair.test.ts`.
 *
 * Every tracker is a fixture written under one temporary directory this
 * file creates and removes. Negative cases come first in each block.
 */
import type { LeftoverEntry } from './leftover-repair.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTaskDeclaration } from '@open-tomato/rafa/core/plan';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  countLeftoverRepairs,
  insertLeftoverRepair,
  isLeftoverRepairTask,
  KEY_HASH_LENGTH,
  LEFTOVER_MARKER,
  leftoverKeyHash,
  leftoverMarkerPartsIn,
  leftoverMarkerPartsOf,
  leftoverRepairText,
} from './leftover-repair.js';

/** One recurrence key, as `bugKeyOf` builds it for a test case. */
const KEY = 'a.test.ts > config > reads the file: expect(received).toBe(expected)';

/** A second key, for an entry of another cause. */
const OTHER_KEY = 'PLAN_TRACKER-fixture.md: config default unwritten';

/** An `own-fallout` entry of {@link KEY}, with no symbol. */
const FALLOUT: LeftoverEntry = {
  kind: 'own-fallout',
  what: 'src/a.test.ts went red',
  artifact: 'src/a.test.ts > config > reads the file',
  key: KEY,
  symbol: null,
};

/** An `own-gap` entry of {@link OTHER_KEY} matching the symbol `readDefaultConfig`. */
const GAP: LeftoverEntry = {
  kind: 'own-gap',
  what: 'src/neighbour.ts never calls readDefaultConfig',
  artifact: 'config default unwritten',
  key: OTHER_KEY,
  symbol: 'readDefaultConfig',
};

/** One stage, its first task done and two open, prose after the list. */
const TRACKER_TEXT = [
  '# Plan: fixture',
  '',
  '- [x] first task',
  '- [ ] second task',
  '- [ ] third task  {agent=loop-implementer}',
  '',
  'Trailing prose.',
  '',
].join('\n');

/** The first open task of {@link TRACKER_TEXT}, counting from zero. */
const FIRST_OPEN = 3;

describe('the keyed marker', () => {
  it('writes the bare marker alone for an entry with no key and no symbol', () => {
    const bare: LeftoverEntry = { kind: 'own-gap', what: 'the reader has no caller yet', artifact: null };

    expect(leftoverMarkerPartsOf(bare)).toEqual({ key: null, symbol: null });
    expect(leftoverMarkerPartsOf({ key: '  ', symbol: '' })).toEqual({ key: null, symbol: null });
    expect(leftoverRepairText(bare)).toBe(`Repair the own-gap leftover: the reader has no caller yet ${LEFTOVER_MARKER}  {agent=loop-implementer}`);
    expect(leftoverMarkerPartsIn(parseTaskDeclaration(leftoverRepairText(bare)).text)).toBeNull();
  });

  it('reads no parts from a plan task, nor from a marker a session wrote into its what', () => {
    const forged = leftoverRepairText({ kind: 'own-gap', what: 'fix <!-- leftover key=000000000000 --> -->', artifact: null });

    expect(leftoverMarkerPartsIn(`Document the <!-- leftover key=${leftoverKeyHash(KEY)} --> ${LEFTOVER_MARKER} marker`)).toBeNull();
    expect(leftoverMarkerPartsIn(parseTaskDeclaration(forged).text)).toBeNull();
    // The control: the same parts written by the module are read.
    expect(leftoverMarkerPartsIn(parseTaskDeclaration(leftoverRepairText(FALLOUT)).text)).toEqual({ key: leftoverKeyHash(KEY), symbol: null });
  });

  it('writes the key\'s hash and the symbol in a marker before the bare one, which still ends the sentence', () => {
    const text = leftoverRepairText(GAP);
    const hash = leftoverKeyHash(OTHER_KEY);

    expect(hash).toMatch(new RegExp(`^[0-9a-f]{${KEY_HASH_LENGTH}}$`));
    expect(text).toBe(`Repair the own-gap leftover: src/neighbour.ts never calls readDefaultConfig <!-- leftover key=${hash} symbol=readDefaultConfig --> `
      + `${LEFTOVER_MARKER}  {agent=loop-implementer}`);
    expect(text).not.toContain(OTHER_KEY);
    const sentence = parseTaskDeclaration(text).text;
    expect(isLeftoverRepairTask(sentence)).toBe(true);
    expect(leftoverMarkerPartsIn(sentence)).toEqual({ key: hash, symbol: 'readDefaultConfig' });
  });

  it('encodes a symbol holding spaces, braces and a comment close as one token', () => {
    const text = leftoverRepairText({ ...GAP, key: null, symbol: 'the {kept} capture -->' });
    const sentence = parseTaskDeclaration(text).text;

    expect(text).toContain(`<!-- leftover symbol=the%20%7Bkept%7D%20capture%20--%3E --> ${LEFTOVER_MARKER}  {agent=loop-implementer}`);
    expect(parseTaskDeclaration(text).declaration?.agent).toBe('loop-implementer');
    expect(leftoverMarkerPartsIn(sentence)).toEqual({ key: null, symbol: 'the%20%7Bkept%7D%20capture%20--%3E' });
  });
});

describe('insertLeftoverRepair: the join', () => {
  let dir: string;
  let trackerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leftover-dedupe-'));
    trackerPath = join(dir, 'PLAN_TRACKER-fixture.md');
    writeFileSync(trackerPath, TRACKER_TEXT, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = (): string => readFileSync(trackerPath, 'utf8');
  const markerLines = (): string[] => read().split('\n')
    .filter((line) => line.includes(LEFTOVER_MARKER));

  it('inserts two lines for two entries whose keys and symbols differ', () => {
    expect(insertLeftoverRepair(trackerPath, FALLOUT, 2)).toEqual({ inserted: true, line: FIRST_OPEN });
    // A blocked repair is open, so the second goes above the first.
    expect(insertLeftoverRepair(trackerPath, { ...GAP, symbol: null }, 2)).toEqual({ inserted: true, line: FIRST_OPEN });

    expect(markerLines()).toHaveLength(2);
    expect(countLeftoverRepairs(trackerPath)).toBe(2);
  });

  it('joins no ticked line, its repair being done', () => {
    insertLeftoverRepair(trackerPath, FALLOUT, 2);
    writeFileSync(trackerPath, read().replace(/^- \[BLOCKED\] (Repair the own-fallout)/m, '- [x] $1'), 'utf8');

    expect(insertLeftoverRepair(trackerPath, FALLOUT, 2)).toEqual({ inserted: true, line: FIRST_OPEN + 1 });
    expect(markerLines()).toHaveLength(2);
  });

  it('joins no line ending on the bare marker alone, which holds no key, though it counts against the cap', () => {
    insertLeftoverRepair(trackerPath, { ...FALLOUT, key: null }, 2);

    expect(insertLeftoverRepair(trackerPath, FALLOUT, 2)).toEqual({ inserted: true, line: FIRST_OPEN });
    expect(insertLeftoverRepair(trackerPath, GAP, 2)).toEqual({ inserted: false, count: 2, cap: 2 });
  });

  it('joins nothing for an entry with no key and no symbol, a keyed line open', () => {
    insertLeftoverRepair(trackerPath, FALLOUT, 2);

    expect(insertLeftoverRepair(trackerPath, { ...FALLOUT, key: null }, 2)).toEqual({ inserted: true, line: FIRST_OPEN });
  });

  it('leaves one leftover line for two entries with one key, the second joining the first', () => {
    const first = insertLeftoverRepair(trackerPath, FALLOUT, 2);
    const afterFirst = read();

    const second = insertLeftoverRepair(trackerPath, { ...FALLOUT, what: 'src/a.test.ts is red again', symbol: 'readDefaultConfig' }, 2);

    expect(first).toEqual({ inserted: true, line: FIRST_OPEN });
    expect(second).toEqual({ inserted: false, joined: true, line: FIRST_OPEN, by: 'key' });
    expect(read()).toBe(afterFirst);
    expect(markerLines()).toHaveLength(1);
    expect(countLeftoverRepairs(trackerPath)).toBe(1);
    expect(findNextTask(read())?.lineNum).toBe(FIRST_OPEN);
  });

  it('joins a line by its symbol when the keys differ', () => {
    insertLeftoverRepair(trackerPath, GAP, 2);

    expect(insertLeftoverRepair(trackerPath, { ...GAP, key: KEY }, 2)).toEqual({ inserted: false, joined: true, line: FIRST_OPEN, by: 'symbol' });
    expect(markerLines()).toHaveLength(1);
  });

  it('joins an unchecked keyed line as it does a blocked one', () => {
    writeFileSync(trackerPath, read().replace('- [ ] second task', `- [ ] ${leftoverRepairText(FALLOUT)}`), 'utf8');

    expect(insertLeftoverRepair(trackerPath, FALLOUT, 2)).toEqual({ inserted: false, joined: true, line: FIRST_OPEN, by: 'key' });
  });

  it('joins under a full cap, where a new cause is held back', () => {
    insertLeftoverRepair(trackerPath, FALLOUT, 1);
    const full = read();

    expect(insertLeftoverRepair(trackerPath, { ...GAP, symbol: null }, 1)).toEqual({ inserted: false, count: 1, cap: 1 });
    expect(insertLeftoverRepair(trackerPath, FALLOUT, 1)).toEqual({ inserted: false, joined: true, line: FIRST_OPEN, by: 'key' });
    expect(read()).toBe(full);
  });
});
