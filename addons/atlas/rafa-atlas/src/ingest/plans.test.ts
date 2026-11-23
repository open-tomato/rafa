/**
 * Tests for `plans.ts`: `readPlans` counts a plan's tasks from its
 * tracker when it has one and from the plan otherwise, reads a stub the
 * store names with no file as `missing` with null counts, and reads only
 * the folder's top level. Each reading that could pass for the wrong
 * reason has a control beside it. The plan folders are planted in a
 * tmpdir; no real plan is read.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { DEFAULT_PLAN_DIR, issueNumberOfHeader, readPlans } from './plans.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-plans-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A plan document with `issue` in its header (none when null) and one task line per entry of `boxes`. */
function planText(stub: string, issue: string | null, boxes: readonly string[]): string {
  const header = ['```rafa:plan', `stub: ${stub}`, ...(issue === null
    ? []
    : [`issue: ${JSON.stringify(issue)}`]), '```'];
  const tasks = boxes.map((box, index) => `- ${box} Task ${index + 1}`);
  return [`# Plan: ${stub}`, '', ...header, '', '## Stage one', '', ...tasks, ''].join('\n');
}

/** A plan folder under the suite's scope holding `files`, each a name and its text. */
function folderWith(name: string, files: Readonly<Record<string, string>>): string {
  const dir = join(scope, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}

describe('readPlans, tracker and plan counts', () => {
  it('counts a plan with a tracker from the tracker, the copy the loop ticks', () => {
    const dir = folderWith('tracked', {
      'PLAN-alpha.md': planText('alpha', '42', ['[ ]', '[ ]', '[ ]', '[ ]']),
      'PLAN_TRACKER-alpha.md': planText('alpha', '42', ['[x]', '[x]', '[BLOCKED]', '[ ]']),
    });

    expect(readPlans({ planDir: dir })).toEqual([{
      stub: 'alpha',
      source: 'tracker',
      path: join(dir, 'PLAN_TRACKER-alpha.md'),
      issueNumber: 42,
      tasks: { total: 4, done: 2, blocked: 1, open: 1 },
    }]);
  });

  it('control: the plan beside the tracker counts no task done, so a read of the plan would show', () => {
    const dir = join(scope, 'tracked');

    expect(readFileSync(join(dir, 'PLAN-alpha.md'), 'utf8')).not.toContain('[x]');
  });

  it('counts a plan with no tracker from the plan', () => {
    const dir = folderWith('untracked', { 'PLAN-beta.md': planText('beta', '#7', ['[x]', '[ ]', '[ ]']) });

    expect(readPlans({ planDir: dir })).toEqual([{
      stub: 'beta',
      source: 'plan',
      path: join(dir, 'PLAN-beta.md'),
      issueNumber: 7,
      tasks: { total: 3, done: 1, blocked: 0, open: 2 },
    }]);
  });

  it('reads a tracker with no plan beside it as tracker', () => {
    const dir = folderWith('tracker-only', { 'PLAN_TRACKER-gamma.md': planText('gamma', null, ['[x]']) });

    const [reading] = readPlans({ planDir: dir });

    expect(reading?.source).toBe('tracker');
    expect(reading?.tasks).toEqual({ total: 1, done: 1, blocked: 0, open: 0 });
    expect(reading?.issueNumber).toBeNull();
  });
});

describe('readPlans, a missing plan', () => {
  it('marks a store stub with no file missing, its counts and issue null, beside the folder plans in stub order', () => {
    const dir = folderWith('with-missing', { 'PLAN-mid.md': planText('mid', '3', ['[x]']) });

    const readings = readPlans({ planDir: dir, stubs: ['zulu', 'mid', 'alpha'] });

    expect(readings.map((reading) => [reading.stub, reading.source])).toEqual([['alpha', 'missing'], ['mid', 'plan'], ['zulu', 'missing']]);
    expect(readings[0]).toEqual({ stub: 'alpha', source: 'missing', path: null, issueNumber: null, tasks: null });
  });

  it('control: the same stub with a plan file reads plan, so missing comes from the absent file', () => {
    const dir = folderWith('missing-control', { 'PLAN-alpha.md': planText('alpha', null, []) });

    expect(readPlans({ planDir: dir, stubs: ['alpha'] }).map((reading) => reading.source)).toEqual(['plan']);
  });

  it('reads every handed stub missing when the folder does not exist', () => {
    expect(readPlans({ planDir: join(scope, 'no-such-folder'), stubs: ['a', 'b'] }).map((reading) => reading.source))
      .toEqual(['missing', 'missing']);
  });

  it('reads a handed stub no plan stamp can carry as missing, looking for no file outside the folder', () => {
    const dir = folderWith('escape', {});
    writeFileSync(join(scope, 'PLAN-x.md'), planText('x', null, ['[x]']));

    expect(readPlans({ planDir: dir, stubs: ['../x'] })).toEqual([{ stub: '../x', source: 'missing', path: null, issueNumber: null, tasks: null }]);
  });
});

describe('readPlans, what the folder holds besides plans', () => {
  it('reads only the top level, and no file of another name', () => {
    const dir = folderWith('noise', {
      'PLAN-top.md': planText('top', null, ['[ ]']),
      'CLOSEOUT-top.md': 'notes',
      'SUITE_BASELINE-top.md': 'baseline',
    });
    mkdirSync(join(dir, 'done'));
    writeFileSync(join(dir, 'done', 'PLAN-archived.md'), planText('archived', null, ['[x]']));

    expect(readPlans({ planDir: dir }).map((reading) => reading.stub)).toEqual(['top']);
  });

  it('control: the archived plan reads when its folder is the one handed', () => {
    expect(readPlans({ planDir: join(scope, 'noise', 'done') }).map((reading) => reading.stub)).toEqual(['archived']);
  });

  it('names core\'s default plan folder', () => {
    expect(DEFAULT_PLAN_DIR).toBe(join('.rafa', 'plans'));
  });
});

describe('issueNumberOfHeader', () => {
  it('reads a GitHub number with or without its hash, and null for another tracker\'s key or none', () => {
    expect(issueNumberOfHeader('1234')).toBe(1234);
    expect(issueNumberOfHeader('#1234')).toBe(1234);
    expect(issueNumberOfHeader('OPT-123')).toBeNull();
    expect(issueNumberOfHeader(null)).toBeNull();
  });
});
