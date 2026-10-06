/**
 * Tests for the project port's pure part (`port.ts`): the five template
 * fields, and finding fields and options by their exact names.
 *
 * ## The controls
 *
 *  - Every match is read beside a near miss that must NOT match: a name
 *    in another case, with a trailing space, or an option renamed. A
 *    lookup that folds case or trims fails.
 *  - Each mismatch is read beside the four other fields, which must still
 *    match, so a reader that gives up on the whole project fails.
 */
import type { Project, ProjectField } from './port.js';

import { describe, expect, it } from 'bun:test';

import {
  fieldByName,
  matchProjectFields,
  optionByName,
  PROJECT_FIELDS,
  PROJECT_PORT_PREFIX,
  ProjectPortError,
} from './port.js';
import { HORIZON_OPTIONS, STAGE_OPTIONS } from './rules.js';

/** A single-select field named `name` with `options`, ids by index. */
function select(name: string, options: readonly string[]): ProjectField {
  return { id: `F_${name}`, name, dataType: 'SINGLE_SELECT', options: options.map((option, index) => ({ id: `O${String(index)}`, name: option })) };
}

/** A field of `dataType` named `name`, with no options. */
function plain(name: string, dataType: string): ProjectField {
  return { id: `F_${name}`, name, dataType, options: null };
}

/** The template's five fields, behind a built-in one. */
function templateFields(): readonly ProjectField[] {
  return [
    plain('Title', 'TITLE'),
    select('Stage', STAGE_OPTIONS),
    select('Horizon', HORIZON_OPTIONS),
    plain('Rank', 'NUMBER'),
    plain('Blocked by', 'TEXT'),
    plain('Progress', 'TEXT'),
  ];
}

/** `fields` with the one named `name` replaced by `replacement`, or dropped when it is null. */
function replaced(name: string, replacement: ProjectField | null): Pick<Project, 'fields'> {
  return { fields: templateFields().flatMap((field) => field.name === name
    ? replacement === null
      ? []
      : [replacement]
    : [field]) };
}

describe('PROJECT_FIELDS', () => {
  it('names the five fields the template holds, by the names and types it answered', () => {
    expect(PROJECT_FIELDS.map(({ key, name, dataType }) => [key, name, dataType])).toEqual([
      ['stage', 'Stage', 'SINGLE_SELECT'],
      ['horizon', 'Horizon', 'SINGLE_SELECT'],
      ['rank', 'Rank', 'NUMBER'],
      ['blockedBy', 'Blocked by', 'TEXT'],
      ['progress', 'Progress', 'TEXT'],
    ]);
  });

  it('takes Stage\'s and Horizon\'s options from the rules, and gives the other three none', () => {
    expect(PROJECT_FIELDS.map(({ options }) => options)).toEqual([STAGE_OPTIONS, HORIZON_OPTIONS, [], [], []]);
  });
});

describe('fieldByName and optionByName', () => {
  it('finds nothing for a name in another case or with a trailing space', () => {
    const project = { fields: templateFields() };
    expect(fieldByName(project, 'stage')).toBeNull();
    expect(fieldByName(project, 'Stage ')).toBeNull();
    expect(fieldByName(project, 'Blocked By')).toBeNull();
  });

  it('finds the field named exactly so', () => {
    expect(fieldByName({ fields: templateFields() }, 'Blocked by')?.id).toBe('F_Blocked by');
  });

  it('finds no option on a field that is not a select, nor one in another case', () => {
    const [, stage] = templateFields();
    expect(optionByName(plain('Rank', 'NUMBER'), 'Done')).toBeNull();
    expect(stage === undefined
      ? 'no stage'
      : optionByName(stage, 'In Review')).toBeNull();
  });

  it('finds the option named exactly so', () => {
    expect(optionByName(select('Stage', STAGE_OPTIONS), 'In review')).toEqual({ id: 'O8', name: 'In review' });
  });

  it('answers the first of two fields sharing a name', () => {
    const project = { fields: [plain('Rank', 'NUMBER'), plain('Rank', 'TEXT')] };
    expect(fieldByName(project, 'Rank')?.dataType).toBe('NUMBER');
  });
});

describe('matchProjectFields', () => {
  it('reports a missing field by name and still matches the other four', () => {
    const match = matchProjectFields(replaced('Stage', null));
    expect(match.mismatched.map(({ template, problem, sentence }) => [template.name, problem, sentence])).toEqual([
      ['Stage', 'missing', 'The project has no field named "Stage".'],
    ]);
    expect(match.matched.map(({ template }) => template.name)).toEqual(['Horizon', 'Rank', 'Blocked by', 'Progress']);
  });

  it('reports a field renamed by case as missing', () => {
    const match = matchProjectFields(replaced('Blocked by', plain('Blocked By', 'TEXT')));
    expect(match.mismatched.map(({ template, problem }) => [template.name, problem])).toEqual([['Blocked by', 'missing']]);
  });

  it('reports a field of another type', () => {
    const match = matchProjectFields(replaced('Rank', plain('Rank', 'TEXT')));
    expect(match.mismatched.map(({ problem, sentence }) => [problem, sentence])).toEqual([
      ['type', 'The project\'s field "Rank" is TEXT, expected NUMBER.'],
    ]);
  });

  it('reports a select missing an option, naming each one it lacks, and skips the whole field', () => {
    const renamed = STAGE_OPTIONS.map((option) => option === 'In review'
      ? 'In Review'
      : option).filter((option) => option !== 'Cancelled');
    const match = matchProjectFields(replaced('Stage', select('Stage', renamed)));
    expect(match.mismatched.map(({ problem, missingOptions, sentence }) => [problem, missingOptions, sentence])).toEqual([
      ['options', ['In review', 'Cancelled'], 'The project\'s field "Stage" has no option "In review", "Cancelled".'],
    ]);
    expect(match.matched.map(({ template }) => template.key)).toEqual(['horizon', 'rank', 'blockedBy', 'progress']);
  });

  it('matches all five on the template, each select with its options by name', () => {
    const match = matchProjectFields({ fields: templateFields() });
    expect(match.mismatched).toEqual([]);
    expect(match.matched.map(({ template, field }) => [template.key, field.id])).toEqual([
      ['stage', 'F_Stage'],
      ['horizon', 'F_Horizon'],
      ['rank', 'F_Rank'],
      ['blockedBy', 'F_Blocked by'],
      ['progress', 'F_Progress'],
    ]);
    expect(match.matched[0]?.options.get('Waiting for approval')).toBe('O7');
    expect(match.matched[1]?.options.get('Now')).toBe('O2');
    expect(match.matched[2]?.options.size).toBe(0);
  });

  it('passes over an extra option and an extra field', () => {
    const fields = [...replaced('Horizon', select('Horizon', [...HORIZON_OPTIONS, 'Someday'])).fields, plain('Notes', 'TEXT')];
    const match = matchProjectFields({ fields });
    expect(match.mismatched).toEqual([]);
    expect(match.matched[1]?.options.has('Someday')).toBe(false);
  });
});

describe('ProjectPortError', () => {
  it('opens with the prefix and keeps what gh wrote', () => {
    const error = new ProjectPortError('gh api graphql failed', 'gh: rate limited');
    expect(error.message).toBe(`${PROJECT_PORT_PREFIX}: gh api graphql failed`);
    expect(error.detail).toBe('gh: rate limited');
    expect(error).toBeInstanceOf(Error);
  });
});
