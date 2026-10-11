import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_BUG_TITLE,
  isPrintable,
  parseTitle,
  parseTitleTemplate,
  renderTitle,
  templateProblem,
  TitleTemplateError,
  titleRoundTrips,
} from './title.js';

/** A template a monorepo would set: the project in brackets ahead of the default. */
const WITH_PROJECT = '?([${project}] )?(${module}?( - ${action}): )${summary}';

describe('what a title template prints', () => {
  it.each([
    ['loop', true],
    [' x ', true],
    ['unknown', false],
    [' unknown ', false],
    ['', false],
    ['  ', false],
    [null, false],
    [undefined, false],
    [{ name: 'loop' }, false],
    [3, false],
  ])('reads %p as printable: %p', (value, expected) => {
    expect(isPrintable(value)).toBe(expected);
  });

  it.each([
    [{ module: 'loop', action: 'start', summary: 'resume does not find the worktree branch' }, 'loop - start: resume does not find the worktree branch'],
    [{ module: 'loop', action: 'unknown', summary: 'x fails' }, 'loop: x fails'],
    [{ module: 'loop', action: null, summary: 'x fails' }, 'loop: x fails'],
    [{ module: 'unknown', action: 'start', summary: 'x fails' }, 'x fails'],
    [{ summary: 'x fails' }, 'x fails'],
  ])('renders %p with the default template as %p', (values, title) => {
    expect(renderTitle(DEFAULT_BUG_TITLE, values)).toBe(title);
  });

  it('renders a nested group only inside a rendered outer group, and the project group on its own', () => {
    expect(renderTitle(WITH_PROJECT, { project: 'api', module: 'auth', action: 'login', summary: 'refresh token is not rotated' }))
      .toBe('[api] auth - login: refresh token is not rotated');
    expect(renderTitle(WITH_PROJECT, { project: 'api', summary: 'x' })).toBe('[api] x');
  });

  it('keeps a ")" outside every group as text', () => {
    expect(renderTitle('${summary} (bug)', { summary: 'x' })).toBe('x (bug)');
  });

  it('prints a value without the space around it', () => {
    expect(renderTitle(DEFAULT_BUG_TITLE, { module: ' loop ', summary: ' x fails ' })).toBe('loop: x fails');
  });
});

describe('a title read back', () => {
  it.each([
    ['loop - start: resume does not find it', { module: 'loop', action: 'start', summary: 'resume does not find it' }],
    ['loop: a - b: c', { module: 'loop', summary: 'a - b: c' }],
    ['cli-gap - pr show: has no field', { module: 'cli-gap', action: 'pr show', summary: 'has no field' }],
    ['Fix thing — context', { summary: 'Fix thing — context' }],
    ['src/a.test.ts > case fails: expected 1', { summary: 'src/a.test.ts > case fails: expected 1' }],
  ])('reads %p as %p', (title, values) => {
    expect(parseTitle(DEFAULT_BUG_TITLE, title)).toEqual(values);
  });

  it('reads the project of a template that names one', () => {
    expect(parseTitle(WITH_PROJECT, '[api] auth - login: refresh token is not rotated'))
      .toEqual({ project: 'api', module: 'auth', action: 'login', summary: 'refresh token is not rotated' });
  });

  it('answers null for a title the template cannot hold', () => {
    expect(parseTitle('[${project}] ${summary}', 'no bracket here')).toBeNull();
    expect(parseTitle(DEFAULT_BUG_TITLE, '   ')).toBeNull();
  });

  it('round-trips a record whose summary holds ": ", and says no when the summary reads as a module', () => {
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { module: 'loop', action: 'start', summary: 'a: b' })).toBe(true);
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { module: 'unknown', summary: 'error: x failed' })).toBe(false);
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { module: 'unknown', summary: 'Error: x failed' })).toBe(true);
  });

  it('says no for values that print nothing', () => {
    expect(titleRoundTrips(DEFAULT_BUG_TITLE, { module: 'loop' })).toBe(false);
  });
});

describe('a template checked', () => {
  it.each([DEFAULT_BUG_TITLE, WITH_PROJECT, '${summary}', '?([${type}] )${summary}'])('accepts %p', (template) => {
    expect(templateProblem(template)).toBeNull();
  });

  it.each([
    ['${summary', 'never closed'],
    ['?(${module}: ${summary}', 'never closed'],
    ['${modul}: ${summary}', 'names no variable'],
    ['${summary} ${module}', '${summary} must be the last variable'],
    ['?(${summary})', 'outside every ?( ) group'],
    ['${module}: ${module}: ${summary}', 'appears twice'],
    ['?(${project})${summary}', 'does not read back'],
    ['${module}', '${summary} must be the last variable'],
    // Outside a group a variable left out still prints its brackets, and `[] x` reads back as nothing.
    ['[${type}] ${summary}', 'does not read back'],
  ])('refuses %p, saying %p', (template, said) => {
    expect(templateProblem(template)).toContain(said);
  });

  it('throws a TitleTemplateError from the parser, where templateProblem answers a sentence', () => {
    expect(() => parseTitleTemplate('${nope}')).toThrow(TitleTemplateError);
    expect(templateProblem('${nope}')).toBe('${nope} names no variable, expected one of: type, project, projectType, module, action, summary');
  });
});
