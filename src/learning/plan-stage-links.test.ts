import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { pairBugFixes } from '@open-tomato/rafa-inventory/report/bug-fix-pairs';

import { readPlanStageLinks } from './plan-stage-links.js';

/** A plan whose header names its stub, with a linked stage and a fenced example. */
const HEADED_PLAN = [
  '# Plan: Headed',
  '',
  '```rafa:plan',
  'stub: rafa-77-headed',
  '```',
  '',
  '# Stage: Sweep',
  '',
  '- [ ] Sweep the lint warnings  {agent=loop-implementer}',
  '',
  '# Stage: Fix',
  '',
  '```rafa:stage-context',
  'This stage fixes #12, filed by a sweep.',
  '```',
  '',
  'An example of a task line, fenced:',
  '',
  '```markdown',
  '- [ ] Fix #12 in the example',
  '```',
  '',
  '- [ ] Guard the reader against #12  {agent=loop-implementer effort=low}',
  '- [BLOCKED] Document the guard <!-- blocked: waiting on review -->',
  '',
].join('\n');

/** A plan with no header: its stub comes from its file name. */
const UNHEADED_PLAN = [
  '# Plan: Unheaded',
  '',
  '# Stage: Only',
  '',
  '- [x] Do the one thing',
  '',
].join('\n');

let plansDir = '';

beforeEach(async () => {
  plansDir = await mkdtemp(join(tmpdir(), 'plan-stage-links-'));
});

afterEach(async () => {
  await rm(plansDir, { recursive: true, force: true });
});

/** Writes `files` into the fixture directory. */
async function writePlans(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(plansDir, name), body);
  }
}

/** Reads the fixture directory, collecting the warnings. */
async function readCollecting(): Promise<{ links: Awaited<ReturnType<typeof readPlanStageLinks>>; warnings: string[] }> {
  const warnings: string[] = [];
  const links = await readPlanStageLinks(plansDir, { warn: (message) => warnings.push(message) });
  return { links, warnings };
}

describe('readPlanStageLinks — what is not read', () => {
  test('a directory that does not exist answers no links and no warning', async () => {
    const warnings: string[] = [];
    const links = await readPlanStageLinks(join(plansDir, 'absent'), { warn: (message) => warnings.push(message) });
    expect(links).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('a fenced example line is no task, though parsePlan reads it fence-blind', async () => {
    await writePlans({ 'PLAN-rafa-77-headed.md': HEADED_PLAN });
    const { links } = await readCollecting();
    const fix = links.find((link) => link.stage === 'Fix');
    expect(fix?.tasks).not.toContain('Fix #12 in the example');
    // Control: the same fixture's line does read as a task once its fence is gone.
    await writePlans({ 'PLAN-rafa-77-headed.md': HEADED_PLAN.replace('```markdown\n', '').replace('example\n```', 'example') });
    const unfenced = (await readCollecting()).links.find((link) => link.stage === 'Fix');
    expect(unfenced?.tasks).toContain('Fix #12 in the example');
  });

  test('tracker files and other names are not read', async () => {
    await writePlans({
      'PLAN_TRACKER-rafa-77-headed.md': HEADED_PLAN,
      'NOTES.md': UNHEADED_PLAN,
      'PLAN-only.txt': UNHEADED_PLAN,
    });
    const { links, warnings } = await readCollecting();
    expect(links).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('a file that fails to parse is passed over with one warning, the others read', async () => {
    await writePlans({
      'PLAN-broken.md': '# Stage: Open\n\n```rafa:stage-context\nNever closed, names #12\n\n- [ ] A task it swallows\n',
      'PLAN-unheaded-plan.md': UNHEADED_PLAN,
    });
    await mkdir(join(plansDir, 'PLAN-a-directory.md'));
    const { links, warnings } = await readCollecting();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('PLAN-a-directory.md');
    expect(warnings[1]).toContain('PLAN-broken.md');
    expect(warnings[1]).toContain('never closed');
    expect(links.map((link) => link.stub)).toEqual(['unheaded-plan']);
  });

  test('a file whose header and name give no stub is passed over with one warning', async () => {
    await writePlans({ 'PLAN-has space.md': UNHEADED_PLAN });
    const { links, warnings } = await readCollecting();
    expect(links).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no stub');
  });
});

describe('readPlanStageLinks — what is read', () => {
  test('one link per stage, with the header stub, the stage context and the tracker-free task lines', async () => {
    await writePlans({ 'PLAN-rafa-77-headed.md': HEADED_PLAN, 'PLAN-unheaded-plan.md': UNHEADED_PLAN });
    const { links, warnings } = await readCollecting();
    expect(warnings).toEqual([]);
    expect(links).toEqual([
      {
        stub: 'rafa-77-headed',
        stage: 'Sweep',
        context: null,
        tasks: ['Sweep the lint warnings  {agent=loop-implementer}'],
      },
      {
        stub: 'rafa-77-headed',
        stage: 'Fix',
        context: 'This stage fixes #12, filed by a sweep.',
        tasks: ['Guard the reader against #12  {agent=loop-implementer effort=low}', 'Document the guard'],
      },
      { stub: 'unheaded-plan', stage: 'Only', context: null, tasks: ['Do the one thing'] },
    ]);
  });

  test('the header stub wins over the file name', async () => {
    await writePlans({ 'PLAN-some-other-name.md': HEADED_PLAN });
    const { links } = await readCollecting();
    expect(new Set(links.map((link) => link.stub))).toEqual(new Set(['rafa-77-headed']));
  });

  test('the links join a bug through the stage context naming #12, past the fenced example', async () => {
    await writePlans({ 'PLAN-rafa-77-headed.md': HEADED_PLAN });
    const { links } = await readCollecting();
    const line = 'Guard the reader against #12  {agent=loop-implementer effort=low}';
    const answer = pairBugFixes({
      bugs: [{
        id: 'bug-1',
        sessionId: 'filing',
        planStub: 'rafa-5-sweep',
        taskLine: 'Sweep the readers',
        artifact: 'PLAN_TRACKER-rafa-5-sweep.md: reader crashes',
        trackerRef: { kind: 'github', externalId: '12', url: null },
        outcome: 'done',
        collectedAt: '2026-11-01T00:00:00.000Z',
      }],
      outOfScope: [],
      resolved: [],
      reports: [{
        sessionId: 'fixing',
        planStub: 'rafa-77-headed',
        taskLine: line,
        outcome: 'done',
        collectedAt: '2026-11-02T00:00:00.000Z',
      }],
    }, links, new Date('2026-11-07T00:00:00.000Z'));
    expect(answer.unpaired).toEqual([]);
    expect(answer.pairs).toHaveLength(1);
    expect(answer.pairs[0]?.lesson.action).toBe('Guard the reader against #12');
  });
});
