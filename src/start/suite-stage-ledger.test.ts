/**
 * The stage ledger of `start/suite-stage-ledger.ts`, over real tracker
 * and ledger files under a temporary directory: where the ledger sits,
 * which stages are due, how it reads and how it is added to. The steps
 * that write it are driven in `suite-step.test.ts`.
 *
 * Every claim that a ledger reads as empty or adds nothing is paired
 * with a case where the same call, handed a whole file or a new stage,
 * answers one.
 */
import type { StageLedgerEntry } from './suite-stage-ledger.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';

import { sinkOutput } from '../tests/output-sinks.js';

import {
  addToLedger,
  completeStages,
  dueStages,
  readStageLedger,
  STAGE_LEDGER_VERSION,
  stageLedgerPathFor,
} from './suite-stage-ledger.js';

const HEAD = 'head1111';

/** Two stages: the first finished, the second with its task open. */
const TRACKER = [
  '# Plan: fixture',
  '',
  '# Stage: One',
  '',
  '- [x] first task',
  '- [x] second task',
  '',
  '# Stage: Two',
  '',
  '- [ ] third task',
  '- [ ] fourth task',
  '',
].join('\n');

const ONE: StageLedgerEntry = { stage: 0, name: 'One', commit: HEAD, via: 'step' };
const TWO: StageLedgerEntry = { stage: 1, name: 'Two', commit: null, via: 'baseline' };

let dir: string;
let trackerPath: string;
let warnings: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-stage-ledger-'));
  mkdirSync(join(dir, '.rafa', 'plans'), { recursive: true });
  trackerPath = join(dir, '.rafa', 'plans', 'PLAN_TRACKER-fixture.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  warnings = [];
  setActiveOutput(sinkOutput({ warn: (message) => warnings.push(message) }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('dueStages', () => {
  it('answers a finished stage while a task is open, and nothing once the ledger names it', () => {
    expect(dueStages(TRACKER, [])).toEqual([{ stage: 0, name: 'One' }]);
    expect(dueStages(TRACKER, [{ stage: 0, name: 'One', commit: HEAD, via: 'step' }])).toEqual([]);
  });

  it('does not answer a stage holding a blocked task', () => {
    expect(dueStages(TRACKER.replace('- [x] second task', '- [BLOCKED] second task'), [])).toEqual([]);
  });

  it('answers no stage once no task is open: the pre-wrap-up step stands in for the last one', () => {
    expect(dueStages(TRACKER.replaceAll('- [ ]', '- [x]'), [])).toEqual([]);
  });

  it('takes an entry for a moved or renamed stage as another stage', () => {
    expect(dueStages(TRACKER, [{ stage: 0, name: 'Renamed', commit: HEAD, via: 'step' }])).toHaveLength(1);
  });
});

describe('stageLedgerPathFor', () => {
  it('sits beside the tracker, named from its stub', () => {
    expect(stageLedgerPathFor('/p/PLAN_TRACKER-foo.md')).toBe('/p/SUITE_STAGES-foo.json');
    expect(stageLedgerPathFor('/p/PLAN.md')).toBe('/p/SUITE_STAGES.json');
    expect(existsSync(stageLedgerPathFor(trackerPath))).toBe(false);
  });
});

describe('completeStages', () => {
  it('answers a stage whose every task is ticked, and not one with an open task', () => {
    expect(completeStages(TRACKER)).toEqual([{ stage: 0, name: 'One' }]);
    expect(completeStages(TRACKER.replaceAll('- [ ]', '- [x]'))).toHaveLength(2);
  });

  it('does not answer a stage holding no task', () => {
    expect(completeStages(TRACKER.replace('- [x] first task\n- [x] second task\n', ''))).toEqual([]);
  });
});

describe('readStageLedger', () => {
  it('reads a missing file as empty, with no warning', () => {
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reads a whole file\'s entries', () => {
    const path = stageLedgerPathFor(trackerPath);
    writeFileSync(path, JSON.stringify({ version: STAGE_LEDGER_VERSION, stages: [ONE, TWO] }), 'utf8');
    expect(readStageLedger(path)).toEqual([ONE, TWO]);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['not JSON', 'nope'],
    ['version 2, expected 1', JSON.stringify({ version: 2, stages: [ONE] })],
    ['field stages is missing or malformed', JSON.stringify({ version: 1, stages: [{ stage: 'zero' }] })],
  ])('reads a file that does not read as empty, warning %s', (reason, text) => {
    const path = stageLedgerPathFor(trackerPath);
    writeFileSync(path, text, 'utf8');
    expect(readStageLedger(path)).toEqual([]);
    expect(warnings).toEqual([`⚠️  SUITE_STAGES-fixture.json does not read (${reason}); every finished stage's step is taken again.`]);
  });
});

describe('addToLedger', () => {
  it('writes the file at the version read, adding a stage once', () => {
    addToLedger(trackerPath, [ONE]);
    addToLedger(trackerPath, [ONE, TWO]);
    const path = stageLedgerPathFor(trackerPath);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: STAGE_LEDGER_VERSION, stages: [ONE, TWO] });
  });

  it('writes nothing for no stage', () => {
    addToLedger(trackerPath, []);
    expect(existsSync(stageLedgerPathFor(trackerPath))).toBe(false);
  });

  it('warns and goes on when the file cannot be written', () => {
    mkdirSync(stageLedgerPathFor(trackerPath));
    expect(() => addToLedger(trackerPath, [ONE])).not.toThrow();
    expect(warnings.at(-1)).toStartWith('⚠️  Could not write SUITE_STAGES-fixture.json (');
  });
});
