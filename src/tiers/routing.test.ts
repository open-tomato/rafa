/**
 * Tests for the routing defaults.
 *
 * The table is SPELLED here, row by row, from the spec, and never read
 * off {@link DEFAULT_ROUTES}, so a module that drops, renames or
 * reorders a row fails rather than agreeing with itself. The map is
 * then held to the list, and both are driven through the reader a
 * file's `routing` goes through, so a default the reader would refuse
 * fails here too. That case has a control: a table holding `true`,
 * which the same reader refuses.
 */
import type { ValueAt } from '../config-sections.js';

import { describe, expect, it } from 'bun:test';

import { mapOf } from '../config-schema.js';
import { routeTarget } from '../config-sections.js';
import { CONFIG_DEFAULTS } from '../config.js';

import { DEFAULT_ROUTES, DEFAULT_ROUTING } from './routing.js';

/** The spec's routing table, as rafa's defaults. */
const SPEC_TABLE: [string, string][] = [
  ['prose', 'doc-updater'],
  ['tests', 'tdd-guide'],
  ['repair', 'build-error-resolver'],
  ['review', 'code-reviewer'],
  ['implementation', 'loop-implementer'],
];

/** The reader `routing` is read through, as `config-schema.ts` builds it. */
const readRouting = mapOf(routeTarget, 'false or an agent name');

/** Where every reading here is labelled. */
const AT: ValueAt = { label: 'F: routing', key: 'routing' };

describe('DEFAULT_ROUTES', () => {
  it('holds the spec table, row for row and in order', () => {
    expect(DEFAULT_ROUTES.map((route) => [...route])).toEqual(SPEC_TABLE);
  });

  it('leaves the two user-level rows out', () => {
    const shapes = DEFAULT_ROUTES.map(([shape]) => shape);
    const agents = DEFAULT_ROUTES.map(([, agent]) => agent);

    expect(shapes).not.toContain('cleanup');
    expect(agents).not.toContain('refactor-cleaner');
    expect(agents).not.toContain('typescript-reviewer');
  });

  it('is frozen, the list and each row', () => {
    expect(Object.isFrozen(DEFAULT_ROUTES)).toBe(true);
    expect(DEFAULT_ROUTES.every((route) => Object.isFrozen(route))).toBe(true);
  });
});

describe('DEFAULT_ROUTING', () => {
  it('maps each shape of the list to its agent, in the list order', () => {
    expect([...DEFAULT_ROUTING]).toEqual(SPEC_TABLE);
  });

  it('is the routing every config resolves to when no layer names it', () => {
    expect(CONFIG_DEFAULTS.routing).toBe(DEFAULT_ROUTING);
  });

  it('reads back through the routing reader unchanged', () => {
    const reading = readRouting(Object.fromEntries(DEFAULT_ROUTING), AT);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toEqual(DEFAULT_ROUTING);
  });

  it('would fail that reading with a row the reader refuses, the control', () => {
    const reading = readRouting({ ...Object.fromEntries(DEFAULT_ROUTING), prose: true }, AT);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([
      'F: routing.prose is true, expected false or an agent name',
    ]);
  });
});
