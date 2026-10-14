/**
 * Tests for the Standard-Schema builder: what `schemaOf`'s `validate`
 * reads and answers over a merged mapping, and the `[path, schema]` list
 * `schemaSectionsOf` hands `createLoader`.
 *
 * The sections are `CORE_SECTION` and fixtures borrowing its setting
 * names, since a section's setting names are `RafaConfig` fields and a
 * made-up name would not compile. Every refusal read here sits beside a
 * value the same reader accepts, so a schema refusing everything fails
 * as surely as one refusing nothing. The list is driven through
 * define-config's own `validateSections` and through a real
 * `createLoader` over a scratch directory, so the path an issue reads
 * back at is the one the loader reports.
 */
import type { ConfigSection } from './section.js';
import type { StandardSchemaV1 } from '@open-tomato/define-config';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLoader, validateSections } from '@open-tomato/define-config';
import { describe, expect, it } from 'bun:test';

import { CORE_SECTION } from './core-section.js';
import { SCHEMA_VENDOR, schemaOf, schemaSectionsOf } from './standard-schema.js';

/** The refusal `plan.inject: later` reads back as. */
const INJECT_REFUSAL = 'plan.inject is "later", expected one of: full, stage, task';

/** Runs `schema` over `value`, holding that it answered synchronously. */
function run(schema: StandardSchemaV1, value: unknown): StandardSchemaV1.Result<unknown> {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('validate answered a Promise');
  return result;
}

/** A section defining `plan.inject` alone, read by `read`. */
function injectSection(read: NonNullable<ConfigSection['settings']['inject']>['read']): ConfigSection {
  return {
    package: 'fixture',
    settings: { inject: { key: 'plan.inject', read, cli: true } },
    defaults: { inject: 'stage' },
  };
}

describe('schemaOf', () => {
  it('answers a Standard Schema V1 schema with rafa as its vendor', () => {
    const props = schemaOf(CORE_SECTION)['~standard'];

    expect(props.version).toBe(1);
    expect(props.vendor).toBe(SCHEMA_VENDOR);
    expect(SCHEMA_VENDOR).toBe('rafa');
  });

  it('reads a refusal of plan.inject: later back as one issue at plan, inject', () => {
    const result = run(schemaOf(CORE_SECTION), { plan: { inject: 'later' } });

    expect(result.issues).toEqual([{ message: INJECT_REFUSAL, path: ['plan', 'inject'] }]);
  });

  it('answers the mapping it was handed, unchanged, when every reader accepts', () => {
    const merged = { plan: { inject: 'task', dir: 'plans' }, tracking: { specs: true } };

    const result = run(schemaOf(CORE_SECTION), merged);

    expect(result.issues).toBeUndefined();
    expect('value' in result
      ? result.value
      : undefined).toBe(merged);
  });

  it('answers one issue per refusal, in the order of the section\'s settings', () => {
    const merged = { tracking: { specs: 'yes' }, plan: { dir: '', inject: 'later' } };

    const result = run(schemaOf(CORE_SECTION), merged);

    expect(result.issues).toEqual([
      { message: INJECT_REFUSAL, path: ['plan', 'inject'] },
      { message: 'plan.dir is "", expected a directory path', path: ['plan', 'dir'] },
      { message: 'tracking.specs is "yes", expected true or false', path: ['tracking', 'specs'] },
    ]);
  });

  it('answers one issue per sentence when one reader refuses a value twice', () => {
    const section = injectSection(() => ({ value: undefined, problems: ['first', 'second'], extras: [] }));

    const result = run(schemaOf(section), { plan: { inject: 'later' } });

    expect(result.issues).toEqual([
      { message: 'first', path: ['plan', 'inject'] },
      { message: 'second', path: ['plan', 'inject'] },
    ]);
  });

  it('raises no issue for a reader\'s extras', () => {
    const extras = [{ key: 'plan.inject.stray', value: 1 }];
    const section = injectSection(() => ({ value: 'stage', problems: [], extras }));

    expect(run(schemaOf(section), { plan: { inject: 'stage' } }).issues).toBeUndefined();
  });

  it('reads only the keys of the section it was built from', () => {
    const section = injectSection(CORE_SECTION.settings.inject!.read);
    const merged = { plan: { dir: '' }, tracking: { specs: 'yes' } };

    expect(run(schemaOf(section), merged).issues).toBeUndefined();
    expect(run(schemaOf(CORE_SECTION), merged).issues).toHaveLength(2);
  });

  it('passes a key that is absent, null, or under a parent that is not a mapping', () => {
    const schema = schemaOf(CORE_SECTION);

    for (const merged of [undefined, null, {}, { plan: null }, { plan: { inject: null } }, { plan: 'later' }, 3]) {
      expect(run(schema, merged).issues).toBeUndefined();
    }
  });

  it('reads own keys alone, never one a prototype holds', () => {
    const inherited: unknown = Object.create({ plan: { inject: 'later' } });
    const parsed: unknown = JSON.parse('{"plan": {"inject": "later"}}');

    expect(run(schemaOf(CORE_SECTION), inherited).issues).toBeUndefined();
    expect(run(schemaOf(CORE_SECTION), parsed).issues).toHaveLength(1);
  });

  it('runs the readers at each call, never a reading held from the call before', () => {
    const schema = schemaOf(CORE_SECTION);

    expect(run(schema, { plan: { inject: 'later' } }).issues).toHaveLength(1);
    expect(run(schema, { plan: { inject: 'full' } }).issues).toBeUndefined();
  });
});

describe('schemaSectionsOf', () => {
  it('answers one pair per section, in order, each at the empty path', () => {
    const fixture = injectSection(CORE_SECTION.settings.inject!.read);

    const pairs = schemaSectionsOf([CORE_SECTION, fixture]);

    expect(pairs.map(([path]) => path)).toEqual([[], []]);
    expect(pairs.map(([, schema]) => schema['~standard'].vendor)).toEqual([SCHEMA_VENDOR, SCHEMA_VENDOR]);
    expect(Object.isFrozen(pairs)).toBe(true);
  });

  it('answers an empty list for no sections', () => {
    expect(schemaSectionsOf([])).toEqual([]);
  });

  it('reads back through validateSections at the key path, once per section refusing', () => {
    const fixture = injectSection(CORE_SECTION.settings.inject!.read);
    const pairs = schemaSectionsOf([CORE_SECTION, fixture]);

    expect(validateSections({ plan: { inject: 'later' } }, pairs)).toEqual([
      { level: 'error', code: 'schema', path: ['plan', 'inject'], message: INJECT_REFUSAL },
      { level: 'error', code: 'schema', path: ['plan', 'inject'], message: INJECT_REFUSAL },
    ]);
    expect(validateSections({ plan: { inject: 'task' } }, pairs)).toEqual([]);
  });

  it('is the schema createLoader takes: a file refusing plan.inject reads back at plan, inject', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-standard-schema-'));
    try {
      writeFileSync(join(dir, 'later.json'), JSON.stringify({ plan: { inject: 'later' } }));
      writeFileSync(join(dir, 'task.json'), JSON.stringify({ plan: { inject: 'task' } }));
      const schema = schemaSectionsOf([CORE_SECTION]);
      const loaderOf = (name: string) => createLoader({
        lookup: [name],
        layers: [{ layer: 'project', dir }],
        schema,
      });

      const refused = await loaderOf('later.json').load(dir);
      const accepted = await loaderOf('task.json').load(dir);

      const schemaDiagnostics = (diagnostics: readonly { code: string }[]) => diagnostics
        .filter((diagnostic) => diagnostic.code === 'schema');
      expect(schemaDiagnostics(refused.diagnostics)).toEqual([
        expect.objectContaining({ level: 'error', path: ['plan', 'inject'], message: INJECT_REFUSAL }),
      ]);
      expect(schemaDiagnostics(accepted.diagnostics)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
