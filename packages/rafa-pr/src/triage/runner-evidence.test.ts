/**
 * Tests for the runner's evidence (`runner-evidence.ts`) over a temporary
 * `.rafa/runs` tree. A reader that answers nothing passes every "must not
 * match" case, so each keeps a control: the same tree or line, the sha or
 * shape changed, answering the capture or the repair.
 *
 * The capture's text is the shape `packages/rafa/src/suite/run.ts` keeps,
 * a file header then bun's `(fail)` lines; the repair line is the one
 * `repairTaskText` (`packages/rafa-run/src/start/suite-blocker.ts`) and
 * `insertTrackerTask` write, its commit shown to 12 characters.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { captureHolding, readKeptCaptures, stepRepairFor } from './runner-evidence.js';

/** The head the captures are read for. */
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** An earlier commit of the plan. */
const PLAN_COMMIT = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';

/** A commit neither the head nor the plan's: another plan's run in the same checkout. */
const OTHER_SHA = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';

/** The session folder the captures sit in. */
const SESSION = '215c5255-0ea2-4a52-bed3-d57183223087';

/** A red capture's text, as `suiteOutputText` keeps it. */
const CAPTURE = [
  'packages/rafa-pr/src/triage/own-check.test.ts:',
  'error: expect(received).toBe(expected)',
  '(fail) checkKind > reads a red case as fallout [3.00ms]',
  '(fail) checkKind > reads a green case as bug',
  ' 2 fail',
].join('\n');

/** The repair line a red task step at {@link HEAD} inserts. */
const TASK_REPAIR_LINE = '- [BLOCKED] Repair the red task step at commit a1b2c3d4e5f6  {agent=build-error-resolver}  <!-- repairs: second task -->  <!-- blocked: the blocker -->';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runner-evidence-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The suite folder of `session`, created. */
function suiteDir(session: string = SESSION): string {
  const dir = join(root, '.rafa', 'runs', session, 'suite');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a kept capture of step `step` at `sha`, answering its path. */
function keep(step: string, sha: string, text: string = CAPTURE, session: string = SESSION): string {
  const file = join(suiteDir(session), `${step}.${sha}.red.output.txt`);
  writeFileSync(file, text);
  return file;
}

/** A tracker holding `lines` under one stage heading. */
function tracker(lines: readonly string[]): string {
  return ['# Plan', '', '## Stage: one', '', '- [x] first task', ...lines, '- [ ] second task', ''].join('\n');
}

describe('readKeptCaptures keeps the head and the plan\'s commits', () => {
  it('reads a capture at the head with its cases, the timing taken off', () => {
    const file = keep('task', HEAD);
    expect(readKeptCaptures(root, { head: HEAD, commits: null })).toEqual({
      captures: [{
        file,
        step: 'task',
        sha: HEAD,
        cases: ['checkKind > reads a red case as fallout', 'checkKind > reads a green case as bug'],
      }],
      problems: [],
    });
  });

  it('reads a capture at one of the plan\'s commits with no head', () => {
    keep('stage', PLAN_COMMIT);
    const read = readKeptCaptures(root, { head: null, commits: [HEAD, PLAN_COMMIT] });
    expect(read.captures.map((capture) => [capture.step, capture.sha])).toEqual([['stage', PLAN_COMMIT]]);
  });

  it('reads a step name holding dashes and compares the sha in lower case', () => {
    keep('task-alone-1', HEAD);
    const read = readKeptCaptures(root, { head: HEAD.toUpperCase(), commits: [] });
    expect(read.captures.map((capture) => capture.step)).toEqual(['task-alone-1']);
  });

  it('orders the captures by session folder then file name', () => {
    keep('task', HEAD, CAPTURE, 'b-session');
    keep('stage', PLAN_COMMIT, CAPTURE, 'a-session');
    keep('pre-wrap-up', HEAD, CAPTURE, 'a-session');
    const read = readKeptCaptures(root, { head: HEAD, commits: [PLAN_COMMIT] });
    expect(read.captures.map((capture) => `${capture.file.split('/').at(-3)}/${capture.step}`))
      .toEqual(['a-session/pre-wrap-up', 'a-session/stage', 'b-session/task']);
  });
});

describe('readKeptCaptures leaves a capture at another sha', () => {
  it('does not read a capture at a sha neither the head nor the plan\'s', () => {
    keep('task', OTHER_SHA);
    expect(readKeptCaptures(root, { head: HEAD, commits: [PLAN_COMMIT] })).toEqual({ captures: [], problems: [] });
  });

  it('does not read a capture whose sha only opens with the head\'s', () => {
    keep('task', `${HEAD.slice(0, 39)}0`);
    expect(readKeptCaptures(root, { head: HEAD, commits: null }).captures).toEqual([]);
  });

  it('control: the same tree read for that sha answers the capture', () => {
    keep('task', OTHER_SHA);
    expect(readKeptCaptures(root, { head: OTHER_SHA, commits: null }).captures.map((capture) => capture.sha))
      .toEqual([OTHER_SHA]);
  });
});

describe('readKeptCaptures reads only kept captures', () => {
  it('leaves the step\'s plain output text, its JUnit file and a short sha', () => {
    const dir = suiteDir();
    writeFileSync(join(dir, 'task.output.txt'), CAPTURE);
    writeFileSync(join(dir, 'task.junit.xml'), '<testsuites/>');
    writeFileSync(join(dir, `task.${HEAD.slice(0, 12)}.red.output.txt`), CAPTURE);
    writeFileSync(join(dir, `${HEAD}.red.output.txt`), CAPTURE);
    expect(readKeptCaptures(root, { head: HEAD, commits: null }).captures).toEqual([]);
  });

  it('leaves a capture outside a session\'s suite folder', () => {
    mkdirSync(join(root, '.rafa', 'runs', SESSION), { recursive: true });
    writeFileSync(join(root, '.rafa', 'runs', SESSION, `task.${HEAD}.red.output.txt`), CAPTURE);
    writeFileSync(join(root, '.rafa', 'runs', `${SESSION}.json`), '{}');
    expect(readKeptCaptures(root, { head: HEAD, commits: null }).captures).toEqual([]);
  });

  it('answers a capture holding no (fail) line with no cases', () => {
    keep('task', HEAD, ' 1 error\nRan 3 tests across 1 file.');
    expect(readKeptCaptures(root, { head: HEAD, commits: null }).captures.map((capture) => capture.cases)).toEqual([[]]);
  });
});

describe('readKeptCaptures reads an absent reading as no capture', () => {
  it('answers nothing and no problem with no .rafa/runs folder', () => {
    expect(readKeptCaptures(root, { head: HEAD, commits: [PLAN_COMMIT] })).toEqual({ captures: [], problems: [] });
  });

  it('answers nothing and no problem for a session folder with no suite folder', () => {
    mkdirSync(join(root, '.rafa', 'runs', SESSION), { recursive: true });
    expect(readKeptCaptures(root, { head: HEAD, commits: null })).toEqual({ captures: [], problems: [] });
  });

  it('answers nothing when neither the head nor the commits were read', () => {
    keep('task', HEAD);
    expect(readKeptCaptures(root, { head: null, commits: null })).toEqual({ captures: [], problems: [] });
  });

  it('names a suite folder it cannot read and still reads the others', () => {
    keep('task', HEAD, CAPTURE, 'a-session');
    const locked = suiteDir('b-session');
    chmodSync(locked, 0o000);
    try {
      const read = readKeptCaptures(root, { head: HEAD, commits: null });
      if (process.getuid?.() === 0) {
        expect(read.problems).toEqual([]);
        return;
      }
      expect(read.captures.map((capture) => capture.step)).toEqual(['task']);
      expect(read.problems).toHaveLength(1);
      expect(read.problems[0]).toStartWith(`the folder ${locked} could not be read: `);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

describe('captureHolding', () => {
  it('answers the first capture holding the case', () => {
    keep('task', HEAD, '(fail) other > case');
    keep('task', PLAN_COMMIT);
    const { captures } = readKeptCaptures(root, { head: HEAD, commits: [PLAN_COMMIT] });
    expect(captureHolding(captures, 'checkKind > reads a red case as fallout')?.sha).toBe(PLAN_COMMIT);
  });

  it('answers null for a case no capture holds, and for a name off by its timing', () => {
    keep('task', HEAD);
    const { captures } = readKeptCaptures(root, { head: HEAD, commits: null });
    expect(captureHolding(captures, 'checkKind > reads an absent case')).toBeNull();
    expect(captureHolding(captures, 'checkKind > reads a red case as fallout [3.00ms]')).toBeNull();
  });
});

describe('stepRepairFor reads the repairTaskText line', () => {
  it('answers the blocked repair line a red task step at the commit inserted', () => {
    const content = tracker([TASK_REPAIR_LINE]);
    expect(stepRepairFor(content, HEAD)).toEqual({
      line: 5,
      text: 'Repair the red task step at commit a1b2c3d4e5f6',
      kind: 'task',
      shown: 'a1b2c3d4e5f6',
    });
  });

  it('answers a ticked stage and pre-wrap-up repair, the last one when several match', () => {
    const content = tracker([
      '- [x] Repair the red stage step at commit a1b2c3d4e5f6  {agent=build-error-resolver}',
      '- [ ] Repair the red pre-wrap-up step at commit a1b2c3d  {agent=build-error-resolver}',
    ]);
    expect(stepRepairFor(content, HEAD)).toMatchObject({ line: 6, kind: 'pre-wrap-up', shown: 'a1b2c3d' });
  });

  it('answers null for a repair at another commit', () => {
    expect(stepRepairFor(tracker([TASK_REPAIR_LINE]), OTHER_SHA)).toBeNull();
  });

  it('answers null for a commit shown shorter than seven digits, or unread', () => {
    const content = tracker([
      '- [ ] Repair the red task step at commit a1b2c3  {agent=build-error-resolver}',
      '- [ ] Repair the red task step at commit (unread)  {agent=build-error-resolver}',
    ]);
    expect(stepRepairFor(content, HEAD)).toBeNull();
  });

  it('answers null for a leftover repair and a step of another kind', () => {
    const content = tracker([
      `- [ ] Repair the own-fallout leftover: commit ${HEAD.slice(0, 12)} <!-- leftover -->  {agent=build-error-resolver}`,
      '- [ ] Repair the red suite step at commit a1b2c3d4e5f6  {agent=build-error-resolver}',
    ]);
    expect(stepRepairFor(content, HEAD)).toBeNull();
  });

  it('control: the line read for the capture\'s commit in upper case answers it', () => {
    expect(stepRepairFor(tracker([TASK_REPAIR_LINE]), HEAD.toUpperCase())?.line).toBe(5);
  });
});
