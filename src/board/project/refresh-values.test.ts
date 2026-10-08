/**
 * Tests for the pure half of the refresh (`refresh-values.ts`):
 * `projectValuesOf` and `projectChangesOf`.
 *
 * The project's fields are the template's, matched by the real
 * `matchProjectFields`, and the epic's counts come off a literal listing
 * read with the real `readEpics`, so the cases hold the values to the
 * rules and the readers rather than to answers spelled again here.
 *
 * ## The controls
 *
 *  - The item holding every value already is read beside the same item
 *    holding nothing, which answers all five changes, so an empty answer
 *    proves the comparison and not a diff that finds nothing.
 *  - A clear is read beside the same null over an empty field, which
 *    answers none.
 *  - A field skipped for a renamed name is read beside the same project
 *    with the name kept, where that field's change is there.
 */
import type { IssueFacts } from './facts.js';
import type { MatchedField, Project, ProjectFieldValue, ProjectItem } from './port.js';
import type { ProjectValues, RefreshBoard } from './refresh-values.js';
import type { BoardIssue } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { readEpics } from '../epics.js';

import { matchProjectFields, PROJECT_FIELDS } from './port.js';
import { projectChangesOf, projectValuesOf } from './refresh-values.js';

/** The template's five fields as a project holds them, each option's id its name prefixed. */
function project(rename: Readonly<Record<string, string>> = {}): Project {
  return {
    owner: 'open-tomato',
    number: 6,
    id: 'PVT_test',
    title: 'rafa',
    url: 'https://github.com/orgs/open-tomato/projects/6',
    closed: false,
    public: true,
    fields: PROJECT_FIELDS.map((field) => ({
      id: `F_${field.key}`,
      name: rename[field.name] ?? field.name,
      dataType: field.dataType,
      options: field.options.length === 0
        ? null
        : field.options.map((name) => ({ id: `O_${name}`, name })),
    })),
  };
}

/** The fields of {@link project} matched against the template. */
function matched(rename: Readonly<Record<string, string>> = {}): readonly MatchedField[] {
  return matchProjectFields(project(rename)).matched;
}

/** An item holding `values`, by field name. */
function item(values: Readonly<Record<string, ProjectFieldValue>> = {}): ProjectItem {
  return {
    id: 'PVTI_1',
    archived: false,
    content: { kind: 'issue', number: 1, repository: 'open-tomato/rafa' },
    values: new Map(Object.entries(values)),
  };
}

/** Five values, every one set. */
const ALL_SET: ProjectValues = { stage: 'Ready', horizon: 'Now', rank: 3, blockedBy: '#7', progress: '1 / 2' };

/** An item holding exactly {@link ALL_SET}. */
const HOLDING_ALL: Readonly<Record<string, ProjectFieldValue>> = {
  'Stage': { kind: 'option', optionId: 'O_Ready', name: 'Ready' },
  'Horizon': { kind: 'option', optionId: 'O_Now', name: 'Now' },
  'Rank': { kind: 'number', number: 3 },
  'Blocked by': { kind: 'text', text: '#7' },
  'Progress': { kind: 'text', text: '1 / 2' },
};

/** One listing row, its type read from its labels. */
function row(number: number, labels: readonly string[], fields: Partial<Pick<BoardIssue, 'body' | 'state' | 'stateReason'>> = {}): BoardIssue {
  return {
    number,
    title: `#${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: '',
  };
}

/** The facts of an open issue with `labels` and no pull request. */
function facts(number: number, labels: readonly string[]): IssueFacts {
  return { number, state: 'OPEN', stateReason: null, labels, pullRequests: [] };
}

describe('projectValuesOf', () => {
  /** Epic #20 with two members, one closed; #10 ranked and waiting on #7. */
  const LISTING: readonly BoardIssue[] = [
    row(20, ['type:epic', 'epic:alpha', 'horizon:now'], { body: '- [ ] #21\n- [ ] #22\n' }),
    row(21, ['type:spec', 'epic:alpha']),
    row(22, ['type:spec', 'epic:alpha'], { state: 'CLOSED', stateReason: 'COMPLETED' }),
  ];
  const BOARD: RefreshBoard = {
    ranks: new Map([[10, 1], [20, 2]]),
    epics: new Map(readEpics({ issues: LISTING, claims: new Set(), today: new Date(2026, 9, 6) }).epics.map((epic) => [epic.number, epic])),
    blockersOf: (issue) => (issue === 10
      ? { kind: 'blocked', issue, blockers: [{ number: 7, repository: null, state: 'OPEN' }] }
      : { kind: 'none', issue }),
  };

  it('gives an issue no Horizon or Progress, its Stage off the labels, its Rank and its open blocker', () => {
    expect(projectValuesOf(facts(10, ['type:spec', 'spec:ready']), BOARD)).toEqual({
      stage: 'Ready',
      horizon: null,
      rank: 1,
      blockedBy: '#7',
      progress: null,
    });
  });

  it('gives an epic no Stage, its Horizon off its label and its Progress as readEpics counted it', () => {
    expect(projectValuesOf(facts(20, ['type:epic', 'epic:alpha', 'horizon:now']), BOARD)).toEqual({
      stage: null,
      horizon: 'Now',
      rank: 2,
      blockedBy: null,
      progress: '1 / 2',
    });
  });

  it('gives an issue on no line no Rank, beside the ranked one above', () => {
    expect(projectValuesOf(facts(99, ['type:spec']), BOARD).rank).toBeNull();
  });
});

describe('projectChangesOf: only the values that differ', () => {
  it('answers no change for an item already holding every value', () => {
    expect(projectChangesOf(1, item(HOLDING_ALL), ALL_SET, matched())).toEqual([]);
  });

  it('answers a set per field, in the template\'s order, for an item holding nothing', () => {
    const changes = projectChangesOf(1, item(), ALL_SET, matched());

    expect(changes.map(({ name, from, to }) => [name, from, to])).toEqual([
      ['Stage', null, 'Ready'],
      ['Horizon', null, 'Now'],
      ['Rank', null, '3'],
      ['Blocked by', null, '#7'],
      ['Progress', null, '1 / 2'],
    ]);
    expect(changes.map(({ write }) => write)).toEqual([
      { kind: 'set', itemId: 'PVTI_1', fieldId: 'F_stage', value: { kind: 'option', optionId: 'O_Ready' } },
      { kind: 'set', itemId: 'PVTI_1', fieldId: 'F_horizon', value: { kind: 'option', optionId: 'O_Now' } },
      { kind: 'set', itemId: 'PVTI_1', fieldId: 'F_rank', value: { kind: 'number', number: 3 } },
      { kind: 'set', itemId: 'PVTI_1', fieldId: 'F_blockedBy', value: { kind: 'text', text: '#7' } },
      { kind: 'set', itemId: 'PVTI_1', fieldId: 'F_progress', value: { kind: 'text', text: '1 / 2' } },
    ]);
  });

  it('answers the one field that differs, naming what it held and what it gets', () => {
    const changes = projectChangesOf(1, item(HOLDING_ALL), { ...ALL_SET, stage: 'Claimed', rank: 4 }, matched());

    expect(changes.map(({ issue, field, from, to }) => [issue, field, from, to])).toEqual([
      [1, 'stage', 'Ready', 'Claimed'],
      [1, 'rank', '3', '4'],
    ]);
  });

  it('clears a field the item holds a value in when the rule gives none, and writes nothing over an empty one', () => {
    const none: ProjectValues = { ...ALL_SET, blockedBy: null };

    expect(projectChangesOf(1, item(HOLDING_ALL), none, matched())).toEqual([{
      issue: 1,
      field: 'blockedBy',
      name: 'Blocked by',
      from: '#7',
      to: null,
      write: { kind: 'clear', itemId: 'PVTI_1', fieldId: 'F_blockedBy' },
    }]);
    const withoutBlocker = Object.fromEntries(Object.entries(HOLDING_ALL).filter(([name]) => name !== 'Blocked by'));
    expect(projectChangesOf(1, item(withoutBlocker), none, matched())).toEqual([]);
  });

  it('overwrites a value of another kind than the field\'s, so a hand-written text in Rank is set back to the number', () => {
    const changes = projectChangesOf(1, item({ ...HOLDING_ALL, Rank: { kind: 'text', text: '3' } }), ALL_SET, matched());

    expect(changes.map(({ field, write }) => [field, write.kind])).toEqual([['rank', 'set']]);
  });

  it('compares a single select by the option\'s id, not its shown name', () => {
    const stale = { ...HOLDING_ALL, Stage: { kind: 'option', optionId: 'O_old', name: 'Ready' } as const };

    expect(projectChangesOf(1, item(stale), ALL_SET, matched()).map(({ field }) => field)).toEqual(['stage']);
  });

  it('skips a field the project renamed and still compares the other four', () => {
    const renamed = projectChangesOf(1, item(), ALL_SET, matched({ Progress: 'Done count' }));
    const kept = projectChangesOf(1, item(), ALL_SET, matched());

    expect(renamed.map(({ field }) => field)).toEqual(['stage', 'horizon', 'rank', 'blockedBy']);
    expect(kept.map(({ field }) => field)).toContain('progress');
  });
});
