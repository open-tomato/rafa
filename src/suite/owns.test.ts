/**
 * Unit tests for `./owns.ts`: a plan's `Owns:` folders read from its
 * `issue:` through the spec issue's epic, and each broken link answering
 * none with its reason. `gh` is a stand-in {@link GhRunner} answering
 * `issue view` and `issue list` from planted payloads; nothing spawns.
 * The found cases are the control that the reader can answer folders at
 * all, so a none elsewhere is the link under test and not a dead reader.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { epicContextArgs } from '../board/epic-context.js';

import { readPlanOwns } from './owns.js';

/** The spec issue every case plans from. */
const SPEC = 42;

/** The epic every found case reads. */
const EPIC = 257;

/** An epic body carrying an `Owns:` line. */
const OWNING_BODY = ['Owns: src/suite, ./src/board/', '', '## Acceptance criteria', '', '- green'].join('\n');

/** A `gh` answer written as JSON. */
function json(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** A failed `gh` answer. */
const FAILED: GhResult = { ok: false, stdout: '', stderr: 'HTTP 502' };

/** The spec issue as `gh issue view --json` writes it, carrying `labels`. */
function specView(labels: readonly string[]): GhResult {
  return json({
    number: SPEC,
    title: 'the spec',
    body: 'spec body',
    state: 'OPEN',
    labels: labels.map((name) => ({ name })),
    author: { login: 'someone' },
  });
}

/** One epic row as `gh issue list --json` writes it. */
function epicRow(number: number, body: string): Record<string, unknown> {
  return {
    number,
    title: `epic ${String(number)}`,
    body,
    state: 'OPEN',
    stateReason: '',
    labels: [{ name: 'type:epic' }, { name: 'epic:backlog-fixes' }],
  };
}

/** A stand-in gh answering `view` and `list`, recording every call. */
function standIn(view: GhResult, list: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve(args[1] === 'view'
      ? view
      : list);
  };
  return { gh, calls };
}

describe('readPlanOwns', () => {
  it('answers the epic\'s Owns: folders, normalised, after one view and one list', async () => {
    const { gh, calls } = standIn(specView(['type:spec', 'epic:backlog-fixes']), json([epicRow(EPIC, OWNING_BODY)]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toEqual({ owns: ['src/suite', 'src/board'], issue: SPEC, epic: EPIC });
    expect(calls).toEqual([
      ['issue', 'view', String(SPEC), '--json', 'number,title,body,state,labels,author'],
      epicContextArgs('backlog-fixes'),
    ]);
  });

  it('takes the issue written with a leading # and padding', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), json([epicRow(EPIC, OWNING_BODY)]));

    const answer = await readPlanOwns({ issue: ` #${String(SPEC)} `, gh });

    expect(answer.owns).toEqual(['src/suite', 'src/board']);
  });

  it('answers no-issue without sending gh when the plan names none', async () => {
    const { gh, calls } = standIn(specView([]), json([]));

    const answer = await readPlanOwns({ issue: null, gh });

    expect(answer).toEqual({ owns: null, reason: 'no-issue', detail: 'the plan names no issue' });
    expect(calls).toEqual([]);
  });

  it.each(['OPT-123', '0', '4.5', ''])('answers no-issue without sending gh for issue %p', async (issue) => {
    const { gh, calls } = standIn(specView([]), json([]));

    const answer = await readPlanOwns({ issue, gh });

    expect(answer.owns).toBeNull();
    expect(answer).toMatchObject({ reason: 'no-issue' });
    expect(calls).toEqual([]);
  });

  it('answers gh-failed when the issue view fails, sending no list', async () => {
    const { gh, calls } = standIn(FAILED, json([epicRow(EPIC, OWNING_BODY)]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'gh-failed' });
    expect(answer).toHaveProperty('detail', expect.stringContaining('HTTP 502'));
    expect(calls).toHaveLength(1);
  });

  it('answers gh-failed when the issue view answers another shape', async () => {
    const { gh } = standIn({ ok: true, stdout: 'not json', stderr: '' }, json([]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'gh-failed' });
  });

  it('answers gh-failed rather than rejecting when the runner itself throws', async () => {
    const gh: GhRunner = () => Promise.reject(new Error('spawn gh ENOENT'));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'gh-failed' });
  });

  it('answers no-epic, sending no list, when the spec issue carries no epic: label', async () => {
    const { gh, calls } = standIn(specView(['type:spec']), json([epicRow(EPIC, OWNING_BODY)]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toEqual({ owns: null, reason: 'no-epic', detail: 'issue #42 carries no "epic:" label' });
    expect(calls).toHaveLength(1);
  });

  it('answers no-epic when the spec issue carries two epic: labels', async () => {
    const { gh, calls } = standIn(specView(['epic:one', 'epic:two']), json([epicRow(EPIC, OWNING_BODY)]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'no-epic' });
    expect(answer).toHaveProperty('detail', expect.stringContaining('"epic:one", "epic:two"'));
    expect(calls).toHaveLength(1);
  });

  it('answers no-epic when no type:epic issue carries the slug', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), json([]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toEqual({
      owns: null,
      reason: 'no-epic',
      detail: 'no type:epic issue carries "epic:backlog-fixes"',
    });
  });

  it('answers no-epic when several epics carry the slug', async () => {
    const rows = [epicRow(EPIC, OWNING_BODY), epicRow(300, OWNING_BODY)];
    const { gh } = standIn(specView(['epic:backlog-fixes']), json(rows));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'no-epic' });
    expect(answer).toHaveProperty('detail', expect.stringContaining('#257, #300'));
  });

  it('answers gh-failed when the epic list fails', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), FAILED);

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'gh-failed' });
    expect(answer).toHaveProperty('detail', expect.stringContaining('HTTP 502'));
  });

  it('answers gh-failed when the epic list answers rows missing a field', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), json([{ number: EPIC }]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'gh-failed' });
  });

  it('answers no-owns-line when the epic body has no Owns: line', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), json([epicRow(EPIC, '## Acceptance criteria\n\n- green')]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toEqual({ owns: null, reason: 'no-owns-line', detail: 'epic #257 names no Owns: folder' });
  });

  it('answers no-owns-line when the Owns: line names no folder the board reader accepts', async () => {
    const { gh } = standIn(specView(['epic:backlog-fixes']), json([epicRow(EPIC, 'Owns: ../outside')]));

    const answer = await readPlanOwns({ issue: String(SPEC), gh });

    expect(answer).toMatchObject({ owns: null, reason: 'no-owns-line' });
  });
});
