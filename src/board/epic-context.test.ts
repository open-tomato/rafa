/**
 * Unit tests for `./epic-context.ts`: the one `gh` command the lookup
 * sends, the epic it answers, and each null with the warning it leaves
 * (or, for an issue outside any epic, the silence). Every `gh` answer is
 * planted; nothing spawns.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { sinkOutput } from '../tests/output-sinks.js';

import { EPIC_CONTEXT_LIMIT, epicContextArgs, readEpicContext } from './epic-context.js';

/** An epic body with a criteria section, an estimate and a checklist. */
const EPIC_BODY = [
  '## Acceptance criteria',
  '',
  '- `rafa roadmap` lists epics grouped by horizon.',
  '- The planner sees the epic.',
  '',
  '## Plan',
  '',
  'Estimate: two weeks',
  '',
  '- [ ] #245 the listing',
].join('\n');

/** The criteria {@link EPIC_BODY} holds, as the reader keeps them. */
const EPIC_CRITERIA = '- `rafa roadmap` lists epics grouped by horizon.\n- The planner sees the epic.';

/** One row as `gh issue list --json` writes it. */
function row(number: number, title: string, body: string): Record<string, unknown> {
  return {
    number,
    title,
    body,
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:epic' }, { name: 'epic:auth' }],
  };
}

/** A fake gh answering `result` to every call and recording each. */
function fakeGh(result: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve(result);
  };
  return { gh, calls };
}

/** A gh answering `rows` as JSON. */
function listing(rows: readonly unknown[]): ReturnType<typeof fakeGh> {
  return fakeGh({ ok: true, stdout: JSON.stringify(rows), stderr: '' });
}

/** An Output keeping its warnings. */
function capture(): { warnings: string[]; output: ReturnType<typeof sinkOutput> } {
  const warnings: string[] = [];
  return {
    warnings,
    output: sinkOutput({
      warn: (message) => {
        warnings.push(message);
      },
    }),
  };
}

describe('epicContextArgs', () => {
  it('lists type:epic issues carrying the slug, open and closed, with the board fields', () => {
    expect(epicContextArgs('auth')).toEqual([
      'issue', 'list',
      '--state', 'all',
      '--label', 'type:epic',
      '--label', 'epic:auth',
      '--limit', String(EPIC_CONTEXT_LIMIT),
      '--json', 'number,title,body,state,stateReason,labels',
    ]);
  });
});

describe('readEpicContext', () => {
  it('answers the one epic with its number, title and criteria after one gh command', async () => {
    const { gh, calls } = listing([row(244, 'Epics group issues', EPIC_BODY)]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['type:spec', 'epic:auth'], gh, output });

    expect(context).toEqual({ number: 244, title: 'Epics group issues', slug: 'auth', criteria: EPIC_CRITERIA });
    expect(calls).toEqual([epicContextArgs('auth')]);
    expect(warnings).toEqual([]);
  });

  it('answers an epic whose body has no criteria with criteria null and no warning', async () => {
    const { gh } = listing([row(244, 'Epics', 'Estimate: a week')]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toEqual({ number: 244, title: 'Epics', slug: 'auth', criteria: null });
    expect(warnings).toEqual([]);
  });

  it('answers null silently, sending nothing, for an issue with no epic label', async () => {
    const { gh, calls } = listing([row(244, 'Epics', EPIC_BODY)]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['type:spec', 'module:board'], gh, output });

    expect(context).toBeNull();
    expect(calls).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('answers null with a warning, sending nothing, for an issue carrying two epic labels', async () => {
    const { gh, calls } = listing([row(244, 'Epics', EPIC_BODY)]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth', 'epic:billing'], gh, output });

    expect(context).toBeNull();
    expect(calls).toEqual([]);
    expect(warnings).toEqual([
      'epic context: issue #250 carries 2 epic labels ("epic:auth", "epic:billing"); it is planned without an epic',
    ]);
  });

  it('reads one slug when the same epic label is listed twice', async () => {
    const { gh, calls } = listing([row(244, 'Epics', EPIC_BODY)]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth', 'epic:auth'], gh, output });

    expect(context?.number).toBe(244);
    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('answers null with a warning when no epic carries the label', async () => {
    const { gh } = listing([]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toBeNull();
    expect(warnings).toEqual([
      'epic context: issue #250 carries "epic:auth" but no "type:epic" issue does; it is planned without an epic',
    ]);
  });

  it('answers null with a warning naming every epic when two carry the label', async () => {
    const { gh } = listing([row(244, 'Epics', EPIC_BODY), row(301, 'Epics again', EPIC_BODY)]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toBeNull();
    expect(warnings).toEqual([
      'epic context: issue #250 carries "epic:auth" and 2 epics carry it (#244, #301); it is planned without an epic',
    ]);
  });

  it('answers null with a warning carrying what gh wrote when the command fails', async () => {
    const { gh } = fakeGh({ ok: false, stdout: '', stderr: 'HTTP 502\n' });
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith('epic context: gh issue list --state all --label type:epic --label epic:auth');
    expect(warnings[0]).toEndWith('failed (HTTP 502); issue #250 is planned without its epic');
  });

  it('answers null with a warning carrying the refusal when a row is missing a field', async () => {
    const { gh } = listing([{ number: 244, title: 'Epics', body: EPIC_BODY }]);
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('answered row 0 with state undefined');
    expect(warnings[0]).toEndWith('; issue #250 is planned without its epic');
  });

  it('answers null with a warning when gh writes output that is not JSON', async () => {
    const { gh } = fakeGh({ ok: true, stdout: 'not json', stderr: '' });
    const { warnings, output } = capture();

    const context = await readEpicContext({ issue: 250, labels: ['epic:auth'], gh, output });

    expect(context).toBeNull();
    expect(warnings[0]).toContain('wrote output that is not JSON');
  });
});
