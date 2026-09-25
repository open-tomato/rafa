/**
 * Tests for the readers `config-schema.ts` builds its settings from:
 * `mapOf`, and the named readers the settings are read through.
 *
 * Each refusal sits beside an accepting control of the same reader, as
 * `config-sections.test.ts` drives the value readers, so a reader that
 * refused everything would fail here rather than pass. Every refusal is
 * SPELLED, never built from the reader's own `expected` text, so a
 * reader whose wording drifts fails rather than agreeing with itself.
 */
import type { Reader, ValueAt } from './config-sections.js';

import { describe, expect, it } from 'bun:test';

import {
  directory,
  mapOf,
  releaseFile,
  routeTable,
  tierPins,
  trackerKind,
} from './config-readers.js';
import { flag, text } from './config-sections.js';

describe('mapOf', () => {
  /** Where every map case reads its value. */
  const at: ValueAt = { label: 'F: m', key: 'm' };

  /** A map of names to YAML booleans. */
  const flags = mapOf(flag, 'true or false');

  /** An inner reader that accepts null, and retains one extra per value. */
  const anything: Reader<unknown> = (raw, where) => ({
    value: raw,
    problems: [],
    extras: [{ key: `${where.key}.seen`, value: raw }],
  });

  it('accepts a mapping, answering a Map in the order written', () => {
    const reading = flags({ b: true, a: false }, at);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toBeInstanceOf(Map);
    expect([...(reading.value ?? [])]).toEqual([['b', true], ['a', false]]);
  });

  it('accepts an empty mapping as an empty Map', () => {
    expect(flags({}, at).value?.size).toBe(0);
  });

  it('refuses a list, a scalar and null, naming what it expected', () => {
    expect(flags(['a'], at)).toEqual({
      value: undefined,
      problems: ['F: m is a list, expected a mapping of names to true or false'],
      extras: [],
    });
    expect(flags('a', at).problems).toEqual([
      'F: m is "a", expected a mapping of names to true or false',
    ]);
    expect(flags(null, at).problems).toEqual([
      'F: m is null, expected a mapping of names to true or false',
    ]);
  });

  it('names every unusable value under its own name, and answers no value', () => {
    const reading = flags({ a: 'yes', b: true, c: 1 }, at);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([
      'F: m.a is "yes", expected true or false',
      'F: m.c is 1, expected true or false',
    ]);
  });

  it('refuses an empty or blank name beside an accepting control', () => {
    expect(flags({ '': true, ' ': false }, at).problems).toEqual([
      'F: m names "", expected a non-empty name',
      'F: m names " ", expected a non-empty name',
    ]);
    expect(flags({ ' a ': true }, at).value?.get(' a ')).toBe(true);
  });

  it('hands a null value to the inner reader rather than deciding for it', () => {
    expect(flags({ a: null }, at).problems).toEqual(['F: m.a is null, expected true or false']);
    expect(mapOf(anything, 'anything')({ a: null }, at).value?.get('a')).toBeNull();
  });

  it('carries the inner reader\'s extras, keyed under each name', () => {
    const reading = mapOf(anything, 'anything')({ a: 1, b: 2 }, at);

    expect(reading.extras).toEqual([
      { key: 'm.a.seen', value: 1 },
      { key: 'm.b.seen', value: 2 },
    ]);
  });

  it('keeps names an object would read off its prototype as ordinary names', () => {
    const raw: unknown = Bun.YAML.parse('__proto__: true\nconstructor: false\ntoString: true\n');
    const reading = mapOf(text('a name'), 'names')(raw, at);
    const names = flags(raw, at).value;

    expect(reading.problems).toEqual([
      'F: m.__proto__ is true, expected a name',
      'F: m.constructor is false, expected a name',
      'F: m.toString is true, expected a name',
    ]);
    expect([...(names ?? [])]).toEqual([
      ['__proto__', true],
      ['constructor', false],
      ['toString', true],
    ]);
    expect(names?.has('hasOwnProperty')).toBe(false);
  });

  it('answers a fresh Map on every read, so one caller cannot edit the next', () => {
    const first = flags({ a: true }, at).value;
    const second = flags({ a: true }, at).value;

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('the text readers the settings share', () => {
  /** Where every text case reads its value. */
  const at: ValueAt = { label: 'F: k', key: 'k' };

  /** Each reader, and the words its refusal names. */
  const READERS: readonly (readonly [string, Reader<string>, string])[] = [
    ['directory', directory, 'a directory path'],
    ['trackerKind', trackerKind, 'a tracker kind name'],
    ['releaseFile', releaseFile, 'a file path'],
  ];

  for (const [name, read, expected] of READERS) {
    it(`${name} keeps a string as written and refuses a blank one or a number`, () => {
      expect(read(' .rafa/x ', at)).toEqual({ value: ' .rafa/x ', problems: [], extras: [] });
      expect(read(' ', at).problems).toEqual([`F: k is " ", expected ${expected}`]);
      expect(read(1, at).problems).toEqual([`F: k is 1, expected ${expected}`]);
    });
  }
});

describe('tierPins', () => {
  /** Where every pin case reads its value. */
  const at: ValueAt = { label: 'F: tiers.skills', key: 'tiers.skills' };

  it('reads a map of names to false or a tier, in the order written', () => {
    const reading = tierPins({ 'tdd-guide': 'user', review: false }, at);

    expect(reading.problems).toEqual([]);
    expect([...(reading.value ?? [])]).toEqual([['tdd-guide', 'user'], ['review', false]]);
  });

  it('refuses true under its name, and a list for the map', () => {
    expect(tierPins({ a: true }, at).problems).toEqual([
      'F: tiers.skills.a is true, expected false or one of: project, rafa, user',
    ]);
    expect(tierPins(['a'], at).problems).toEqual([
      'F: tiers.skills is a list, expected a mapping of names to false or a tier',
    ]);
  });
});

describe('routeTable', () => {
  /** Where every routing case reads its value. */
  const at: ValueAt = { label: 'F: routing', key: 'routing' };

  it('reads a map of shapes to an agent name or false', () => {
    const reading = routeTable({ prose: 'doc-updater', tests: false }, at);

    expect(reading.problems).toEqual([]);
    expect([...(reading.value ?? [])]).toEqual([['prose', 'doc-updater'], ['tests', false]]);
  });

  it('refuses null under its shape, and a scalar for the map', () => {
    expect(routeTable({ prose: null }, at).problems).toEqual([
      'F: routing.prose is null, expected false or an agent name',
    ]);
    expect(routeTable('x', at).problems).toEqual([
      'F: routing is "x", expected a mapping of names to false or an agent name',
    ]);
  });
});
