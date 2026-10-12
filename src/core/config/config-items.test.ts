/**
 * Tests for the item-shape readers of `config-items.ts`: a prerequisite
 * item on either tier and a module source.
 *
 * Every reader is driven directly, with no file, so a case names the
 * raw value it hands over. Three cases parse YAML first, because the
 * reading they pin is the parser's: a `__proto__` key in an item, a
 * `toString` key in an item, and a `constructor` key beside a kind.
 * These cases sat in `config-sections.test.ts` until the readers moved
 * here, and moved with them unchanged. The reader wrapping a list of
 * items, `listOf`, is driven there.
 */
import type { Reader, ValueAt } from './config-sections.js';

import { describe, expect, it } from 'bun:test';

import {
  MODULE_SOURCE_KINDS,
  moduleSource,
  optionalPrerequisite,
  PREREQUISITE_KINDS,
  requiredPrerequisite,
} from './config-items.js';

/** Where every case reads its value. */
const AT: ValueAt = { label: 'F: s', key: 's' };

/** The choices a prerequisite refusal lists. */
const KINDS = 'tool, env, service, lsp';

/** The problems `read` names for `raw`; empty when it accepts it. */
function problemsOf<T>(read: Reader<T>, raw: unknown): readonly string[] {
  return read(raw, AT).problems;
}

/** The value `read` accepts `raw` as. Fails the case on a refusal. */
function valueOf<T>(read: Reader<T>, raw: unknown): T {
  const reading = read(raw, AT);
  expect(reading.problems).toEqual([]);
  if (reading.value === undefined) throw new Error('accepted, with no value');
  return reading.value;
}

/** The first item of a one-item YAML list, as the parser returns it. */
function parsedItem(yaml: string): unknown {
  const [item] = Bun.YAML.parse(yaml) as unknown[];
  return item;
}

describe('requiredPrerequisite', () => {
  it.each([...PREREQUISITE_KINDS])('reads an item keyed by %s, with no probe', (kind) => {
    expect(valueOf(requiredPrerequisite, { [kind]: 'x' })).toEqual({
      kind,
      name: 'x',
      probe: null,
    });
  });

  it('reads a probe, and answers the item frozen', () => {
    const item = valueOf(requiredPrerequisite, { tool: 'bun', probe: 'bun --version' });

    expect(item).toEqual({ kind: 'tool', name: 'bun', probe: 'bun --version' });
    expect(Object.isFrozen(item)).toBe(true);
  });

  it('reads a null probe as no probe', () => {
    expect(valueOf(requiredPrerequisite, { env: 'A', probe: null }).probe).toBeNull();
  });

  it('retains a reason and an unknown key as extras, never refusing them', () => {
    const reading = requiredPrerequisite({ env: 'A', reason: 'why', timeout: 30 }, AT);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toEqual({ kind: 'env', name: 'A', probe: null });
    expect(reading.extras).toEqual([
      { key: 's.reason', value: 'why' },
      { key: 's.timeout', value: 30 },
    ]);
  });

  it.each([
    ['a scalar', 'bun', '"bun"'],
    ['a list', ['bun'], 'a list'],
    ['null', null, 'null'],
  ])('refuses an item that is %s', (_label, raw, found) => {
    expect(problemsOf(requiredPrerequisite, raw)).toEqual([
      `F: s is ${found}, expected a mapping naming one of: ${KINDS}`,
    ]);
  });

  it('refuses an item naming none of the kinds', () => {
    expect(problemsOf(requiredPrerequisite, { probe: 'x' })).toEqual([
      `F: s names none of: ${KINDS}`,
    ]);
  });

  it.each([
    ['tool before env', { tool: 'a', env: 'B' }],
    ['env before tool', { env: 'B', tool: 'a' }],
  ])('refuses an item naming two kinds, written %s', (_label, raw) => {
    expect(problemsOf(requiredPrerequisite, raw)).toEqual([
      `F: s names tool and env, expected exactly one of: ${KINDS}`,
    ]);
  });

  it.each([
    ['null', null, 'null'],
    ['empty', '', '""'],
    ['a number', 3, '3'],
  ])('refuses a kind naming a value that is %s', (_label, raw, found) => {
    expect(problemsOf(requiredPrerequisite, { tool: raw })).toEqual([
      `F: s.tool is ${found}, expected a non-empty string`,
    ]);
  });

  it('answers no value beside a problem, whichever key the problem is on', () => {
    expect(requiredPrerequisite({ tool: '' }, AT).value).toBeUndefined();
    expect(requiredPrerequisite({ tool: 'bun', probe: 3 }, AT).value).toBeUndefined();
    expect(requiredPrerequisite({ tool: 'bun', probe: 'bun -v' }, AT).value).toBeDefined();
  });

  it('names every problem one item has', () => {
    expect(problemsOf(requiredPrerequisite, { tool: '', probe: 3 })).toEqual([
      'F: s.tool is "", expected a non-empty string',
      'F: s.probe is 3, expected a non-empty string',
    ]);
  });

  it('retains a __proto__ key as an extra, the parser keeping it as an own key', () => {
    const item = parsedItem('- __proto__: x\n  tool: bun\n');
    const reading = requiredPrerequisite(item, AT);

    expect(Object.hasOwn(item as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
    expect(reading.value).toEqual({ kind: 'tool', name: 'bun', probe: null });
    expect(reading.extras).toEqual([{ key: 's.__proto__', value: 'x' }]);
  });

  it('reads a toString key as no kind, though every mapping answers it to in', () => {
    const item = parsedItem('- toString: bun\n');

    expect('toString' in (item as object)).toBe(true);
    expect(problemsOf(requiredPrerequisite, item)).toEqual([`F: s names none of: ${KINDS}`]);
  });

  it('retains a constructor key beside a kind as an extra', () => {
    const reading = requiredPrerequisite(parsedItem('- constructor: a\n  env: B\n'), AT);

    expect(reading.value).toEqual({ kind: 'env', name: 'B', probe: null });
    expect(reading.extras).toEqual([{ key: 's.constructor', value: 'a' }]);
  });
});

describe('optionalPrerequisite', () => {
  it('reads a reason beside a probe', () => {
    const raw = { tool: 'mgrep', probe: 'mgrep --version', reason: 'faster search' };

    expect(valueOf(optionalPrerequisite, raw)).toEqual({
      kind: 'tool',
      name: 'mgrep',
      probe: 'mgrep --version',
      reason: 'faster search',
    });
  });

  it('reads a missing reason and a null one as no reason', () => {
    expect(valueOf(optionalPrerequisite, { lsp: 'typescript' }).reason).toBeNull();
    expect(valueOf(optionalPrerequisite, { lsp: 'typescript', reason: null }).reason).toBeNull();
  });

  it('refuses a reason that is not a string', () => {
    expect(problemsOf(optionalPrerequisite, { lsp: 'typescript', reason: 4 })).toEqual([
      'F: s.reason is 4, expected a non-empty string',
    ]);
  });
});

describe('moduleSource', () => {
  it.each([...MODULE_SOURCE_KINDS])('reads a %s source, with no ref', (kind) => {
    const source = valueOf(moduleSource, { [kind]: 'x' });

    expect(source).toEqual({ kind, location: 'x', ref: null });
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('reads a ref beside a github source', () => {
    expect(valueOf(moduleSource, { github: 'someone/rafa-obsidian', ref: 'v0.3.0' })).toEqual({
      kind: 'github',
      location: 'someone/rafa-obsidian',
      ref: 'v0.3.0',
    });
  });

  it.each(['npm', 'path'])('retains a ref beside a %s source as an extra', (kind) => {
    const reading = moduleSource({ [kind]: 'x', ref: 'v1' }, AT);

    expect(reading.value?.ref).toBeNull();
    expect(reading.extras).toEqual([{ key: 's.ref', value: 'v1' }]);
  });

  it('refuses a source naming two kinds, one naming none, and a ref that is no string', () => {
    const choices = 'npm, github, path';

    expect(problemsOf(moduleSource, { npm: 'a', path: 'b' })).toEqual([
      `F: s names npm and path, expected exactly one of: ${choices}`,
    ]);
    expect(problemsOf(moduleSource, {})).toEqual([`F: s names none of: ${choices}`]);
    expect(problemsOf(moduleSource, { github: 'a/b', ref: 2 })).toEqual([
      'F: s.ref is 2, expected a non-empty string',
    ]);
  });
});
