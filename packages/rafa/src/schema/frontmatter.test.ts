/**
 * Tests for the shared frontmatter reader and writer.
 *
 * Everything here is a literal string in and a literal string out: the
 * module reads no file and no directory, so there is no fixture tree
 * and no temporary directory.
 *
 * The promise this file exists to measure is BYTE identity, and byte
 * identity is only measured by comparing bytes. Every case that writes
 * a document asserts on the whole output string rather than on a parse
 * of it, and the documents carry the three things a line-splitting
 * rewrite silently destroys: CRLF terminators, a missing trailing
 * newline, and trailing whitespace inside the body. A reader that
 * split on `/\r?\n/` and joined on `\n` would pass a parse-based
 * assertion and redden here.
 *
 * Two readings about `Bun.YAML.stringify` are pinned directly against
 * the serialiser rather than only through the module, because they are
 * the reasons {@link renderFrontmatter} passes an indent and strips
 * trailing whitespace. If a future Bun emits block style by default,
 * or stops padding a list key, the pin reddens and says which
 * assumption moved instead of leaving a rewritten skill file to say
 * it.
 *
 * The unknown-key cases carry `user-invocable` and
 * `disable-model-invocation`, which are Claude Code's own keys and the
 * ones the schema must never eat. They pair with a case that changes
 * one known key, so "the unknown keys survived" is a reading from a
 * write that did change something.
 */
import { describe, expect, test } from 'bun:test';

import {
  FRONTMATTER_INDENT,
  mergeFrontmatter,
  readFrontmatter,
  readFrontmatterDocument,
  renderFrontmatter,
  updateFrontmatter,
  writeFrontmatter,
} from './frontmatter.js';

/** A document with a two-key block and a two-paragraph body. */
const SIMPLE = '---\nname: probe\neffort: low\n---\n# Heading\n\nBody text.\n';

describe('readFrontmatterDocument', () => {
  test('splits a document into its block, its body and its terminators', () => {
    const document = readFrontmatterDocument(SIMPLE);

    expect(document).not.toBeNull();
    expect(document?.data).toEqual({ name: 'probe', effort: 'low' });
    expect(document?.yaml).toBe('name: probe\neffort: low\n');
    expect(document?.body).toBe('# Heading\n\nBody text.\n');
    expect(document?.newline).toBe('\n');
    expect(document?.closingNewline).toBe('\n');
  });

  test('keeps a CRLF document CRLF in every part', () => {
    const text = '---\r\nname: probe\r\n---\r\n# Heading\r\n';
    const document = readFrontmatterDocument(text);

    expect(document?.data).toEqual({ name: 'probe' });
    expect(document?.yaml).toBe('name: probe\r\n');
    expect(document?.body).toBe('# Heading\r\n');
    expect(document?.newline).toBe('\r\n');
    expect(document?.closingNewline).toBe('\r\n');
  });

  test('records a closing fence that ends the file with no newline', () => {
    const document = readFrontmatterDocument('---\nname: probe\n---');

    expect(document?.data).toEqual({ name: 'probe' });
    expect(document?.closingNewline).toBe('');
    expect(document?.body).toBe('');
  });

  test('keeps a body that ends without a newline and one with trailing spaces', () => {
    expect(readFrontmatterDocument('---\nname: probe\n---\nno newline')?.body)
      .toBe('no newline');
    expect(readFrontmatterDocument('---\nname: probe\n---\nline   \n\n')?.body)
      .toBe('line   \n\n');
  });

  test('reads the block as the first fence closes it, not the last', () => {
    const document = readFrontmatterDocument('---\nname: probe\n---\nbody\n---\ntail\n');

    expect(document?.yaml).toBe('name: probe\n');
    expect(document?.body).toBe('body\n---\ntail\n');
  });

  test('refuses a text that opens with no fence or never closes one', () => {
    expect(readFrontmatterDocument('name: probe\n')).toBeNull();
    expect(readFrontmatterDocument('\n---\nname: probe\n---\n')).toBeNull();
    expect(readFrontmatterDocument('---\nname: probe\n')).toBeNull();
    expect(readFrontmatterDocument('---')).toBeNull();
    expect(readFrontmatterDocument('----\nname: probe\n----\n')).toBeNull();
  });

  test('refuses a block that is not a mapping, is empty, or will not parse', () => {
    expect(readFrontmatterDocument('---\n- one\n- two\n---\n')).toBeNull();
    expect(readFrontmatterDocument('---\n---\n')).toBeNull();
    expect(readFrontmatterDocument('---\ndescription: Probe: one literal\n---\n')).toBeNull();
  });
});

describe('readFrontmatter', () => {
  test('answers the block a document opens with, in document key order', () => {
    expect(readFrontmatter(SIMPLE)).toEqual({ name: 'probe', effort: 'low' });
    expect(Object.keys(readFrontmatter(SIMPLE) ?? {})).toEqual(['name', 'effort']);
  });

  test('answers null for every text the document reader refuses', () => {
    expect(readFrontmatter('name: probe\n')).toBeNull();
    expect(readFrontmatter('---\nname: probe\n')).toBeNull();
    expect(readFrontmatter('---\n- one\n---\n')).toBeNull();
  });
});

describe('Bun.YAML.stringify, the two shapes the writer depends on', () => {
  test('emits flow style with no indent and block style with one', () => {
    const data = { name: 'probe', tags: ['a', 'b'] };

    expect(Bun.YAML.stringify(data)).toBe('{name: probe,tags: [a,b]}');
    expect(Bun.YAML.stringify(data, null, FRONTMATTER_INDENT))
      .toBe('name: probe\ntags: \n  - a\n  - b');
  });

  test('escapes a newline inside a scalar rather than opening a block scalar', () => {
    expect(Bun.YAML.stringify({ multi: 'one\ntwo' }, null, FRONTMATTER_INDENT))
      .toBe('multi: "one\\ntwo"');
  });
});

describe('renderFrontmatter', () => {
  test('writes one key per line with no trailing whitespace', () => {
    const rendered = renderFrontmatter({ name: 'probe', tags: ['a', 'b'], empty: [] });

    expect(rendered).toBe('name: probe\ntags:\n  - a\n  - b\nempty:\n  []');
    expect(rendered.split('\n').filter((line) => /[ \t]$/.test(line))).toEqual([]);
  });

  test('renders a value that ends in a space quoted, so stripping keeps it', () => {
    const rendered = renderFrontmatter({ s: 'trail ' });

    expect(rendered).toBe('s: "trail "');
    expect(Bun.YAML.parse(rendered)).toEqual({ s: 'trail ' });
  });

  test('parses back to what it was given, key order included', () => {
    const data = {
      name: 'probe',
      description: 'Probe: one literal',
      tags: ['a', 'b'],
      'user-invocable': true,
      count: 3,
      nested: { a: 1 },
      nothing: null,
    };
    const parsed = Bun.YAML.parse(renderFrontmatter(data));

    expect(parsed).toEqual(data);
    expect(Object.keys(parsed as Record<string, unknown>)).toEqual(Object.keys(data));
  });

  test('separates lines with the newline it was given', () => {
    expect(renderFrontmatter({ name: 'probe', effort: 'low' }, '\r\n'))
      .toBe('name: probe\r\neffort: low');
  });
});

describe('mergeFrontmatter', () => {
  test('keeps an existing key in place and appends a new one', () => {
    const data = { name: 'probe', description: 'one', 'user-invocable': true };
    const merged = mergeFrontmatter(data, { description: 'two', stack: ['kotlin'] });

    expect(Object.keys(merged)).toEqual(['name', 'description', 'user-invocable', 'stack']);
    expect(merged['description']).toBe('two');
    expect(merged['stack']).toEqual(['kotlin']);
  });

  test('removes a key whose change is undefined', () => {
    const merged = mergeFrontmatter({ name: 'probe', effort: 'low' }, { effort: undefined });

    expect(Object.keys(merged)).toEqual(['name']);
    expect(mergeFrontmatter({ name: 'probe' }, { missing: undefined }))
      .toEqual({ name: 'probe' });
  });

  test('appends new keys in the order the changes name them', () => {
    expect(Object.keys(mergeFrontmatter({ name: 'probe' }, { stack: [], tags: [] })))
      .toEqual(['name', 'stack', 'tags']);
  });

  test('mutates neither argument', () => {
    const data = { name: 'probe', effort: 'low' };
    const changes = { effort: 'high', stack: ['go'] };
    mergeFrontmatter(data, changes);

    expect(data).toEqual({ name: 'probe', effort: 'low' });
    expect(changes).toEqual({ effort: 'high', stack: ['go'] });
  });
});

describe('writeFrontmatter', () => {
  test('reproduces a document it was given no data for, byte for byte', () => {
    for (const text of [
      SIMPLE,
      '---\r\nname: probe\r\n---\r\nbody   \r\n',
      '---\nname: probe\n---',
      '---\nname: probe\n---\nno newline',
      '---\nname: probe\n---\nbody\n---\ntail\n',
    ]) {
      const document = readFrontmatterDocument(text);
      expect(document).not.toBeNull();
      expect(writeFrontmatter(document!)).toBe(text);
    }
  });

  test('renders the data it was given and leaves the body alone', () => {
    const document = readFrontmatterDocument(SIMPLE);

    expect(writeFrontmatter(document!, { name: 'probe', effort: 'high' }))
      .toBe('---\nname: probe\neffort: high\n---\n# Heading\n\nBody text.\n');
  });

  test('writes the block in the document newline and keeps the body CRLF', () => {
    const document = readFrontmatterDocument('---\r\nname: probe\r\n---\r\n# Heading\r\n');

    expect(writeFrontmatter(document!, { name: 'probe', effort: 'high' }))
      .toBe('---\r\nname: probe\r\neffort: high\r\n---\r\n# Heading\r\n');
  });

  test('adds no newline to a body that ended without one', () => {
    const document = readFrontmatterDocument('---\nname: probe\n---\nno newline');

    expect(writeFrontmatter(document!, { name: 'renamed' }))
      .toBe('---\nname: renamed\n---\nno newline');
  });
});

describe('updateFrontmatter', () => {
  test('keeps unknown keys and their order while changing a known one', () => {
    const text = [
      '---',
      'name: probe',
      'user-invocable: true',
      'description: one',
      'disable-model-invocation: false',
      '---',
      '# Body',
      '',
    ].join('\n');

    expect(updateFrontmatter(text, { description: 'two' })).toBe([
      '---',
      'name: probe',
      'user-invocable: true',
      'description: two',
      'disable-model-invocation: false',
      '---',
      '# Body',
      '',
    ].join('\n'));
  });

  test('appends a key the document did not carry', () => {
    expect(updateFrontmatter(SIMPLE, { stack: ['kotlin'] }))
      .toBe('---\nname: probe\neffort: low\nstack:\n  - kotlin\n---\n# Heading\n\nBody text.\n');
  });

  test('removes a key whose change is undefined', () => {
    expect(updateFrontmatter(SIMPLE, { effort: undefined }))
      .toBe('---\nname: probe\n---\n# Heading\n\nBody text.\n');
  });

  test('leaves a body with CRLF, no trailing newline and trailing spaces untouched', () => {
    const text = '---\r\nname: probe\r\n---\r\nline one   \r\nline two';
    const written = updateFrontmatter(text, { stack: ['go'] });

    expect(written).toBe('---\r\nname: probe\r\nstack:\r\n  - go\r\n---\r\nline one   \r\nline two');
    expect(written?.slice(written.indexOf('---\r\n', 4) + 5)).toBe('line one   \r\nline two');
  });

  test('answers null for a text carrying no frontmatter to change', () => {
    expect(updateFrontmatter('# Body only\n', { stack: ['go'] })).toBeNull();
    expect(updateFrontmatter('---\nname: probe\n', { stack: ['go'] })).toBeNull();
  });

  test('round trips a written document back to the data it was written from', () => {
    const data = { name: 'probe', tags: ['a', 'b'], 'user-invocable': true };
    const written = updateFrontmatter(SIMPLE, data);

    expect(readFrontmatter(written ?? '')).toEqual({ effort: 'low', ...data });
  });
});
