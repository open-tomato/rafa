/**
 * Where each served project's rows are kept: one schema, `<prefix>_default`,
 * for a hub serving one project, and `<prefix>_<id>` per listed project
 * otherwise, with a request naming no project served in the first and
 * one naming a project not listed refused with the hub's line. A layout
 * the migrator could not take is refused before anything connects.
 */
import { describe, expect, it } from 'bun:test';

import { DEFAULT_SCHEMA_PREFIX, projectSchemaName, schemaLayout } from './hub-projects.js';

const ONE = { id: '1'.repeat(40), name: 'open-tomato/one' };
const TWO = { id: '2'.repeat(40), name: 'open-tomato/two' };
const UNLISTED = '3'.repeat(40);

describe('schemaLayout, a single-project hub', () => {
  it('serves every request in one schema, whatever project it names', () => {
    const layout = schemaLayout([]);
    expect(layout.first).toEqual({ id: 'default', schema: `${DEFAULT_SCHEMA_PREFIX}_default` });
    expect([layout.schemaOf(undefined), layout.schemaOf(UNLISTED)]).toEqual([layout.first, layout.first]);
  });

  it('reads the one default project as the same hub', () => {
    expect(schemaLayout([{ id: 'default', name: 'r' }], 'p').all).toEqual([{ id: 'default', schema: 'p_default' }]);
  });
});

describe('schemaLayout, listed projects', () => {
  const layout = schemaLayout([ONE, TWO], 'hub_t');

  it('keeps each project in a schema of its own, in listed order', () => {
    expect(layout.all.map(({ schema }) => schema)).toEqual([`hub_t_${ONE.id}`, `hub_t_${TWO.id}`]);
  });

  it('serves a request naming no project in the first listed one', () => {
    expect(layout.schemaOf(undefined)).toEqual(layout.first);
    expect(layout.schemaOf(TWO.id).id).toBe(TWO.id);
  });

  it('refuses a project not listed with the line naming hub.projects', () => {
    expect(() => layout.schemaOf(UNLISTED)).toThrow(`rafa-hub: project ${UNLISTED} is not served here; add it under hub.projects`);
  });

  it('refuses two projects that would share one schema', () => {
    expect(() => schemaLayout([{ id: 'ABC', name: 'a' }, { id: 'abc', name: 'b' }], 'p')).toThrow('share the schema p_abc');
  });
});

describe('projectSchemaName', () => {
  it('lower-cases the id under the prefix', () => {
    expect(projectSchemaName('p', 'ABC123')).toBe('p_abc123');
  });

  it('refuses a name the migrator would have to quote, or one past 63 characters', () => {
    expect(() => projectSchemaName('p', 'a-b')).toThrow('is no schema name');
    expect(() => projectSchemaName('a'.repeat(23), '1'.repeat(40))).toThrow('is no schema name');
    expect(projectSchemaName('a'.repeat(22), '1'.repeat(40))).toHaveLength(63);
  });
});
