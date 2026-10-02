import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import { ESLint } from 'eslint';

import { FIXTURE_INDENT, serializeFixture } from './extract-scoring-fixture.js';

/**
 * The fixture serializer of `scripts/extract-scoring-fixture.ts`: the text
 * it writes passes the `jsonc/indent` rule `eslint.base.mjs` applies to
 * `.json` files, and both fixture files under `src/triage/testdata/` are
 * held in exactly that text. No case runs the extract itself, which reads
 * the live board with `gh`.
 */

const ROOT = resolve(import.meta.dir, '..');
const eslint = new ESLint({ cwd: ROOT });

/** The fixture files kept in the serializer's form. */
const FIXTURE_FILES = [
  'src/triage/testdata/scoring.json',
  'src/triage/testdata/scoring-causes.json',
];

/** A small value with nesting on every level the fixtures use. */
const SAMPLE = { repo: 'o/r', filings: [{ issue: 1, tags: ['a', 'b'] }] };

/** The `jsonc/indent` messages ESLint answers for `text` linted as a fixture file. */
async function indentMessages(text: string): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath: resolve(ROOT, FIXTURE_FILES[0] ?? '') });
  if (result === undefined) throw new Error('ESLint returned no result');
  return result.messages
    .filter((message) => message.ruleId === 'jsonc/indent')
    .map((message) => message.message);
}

describe('serializeFixture', () => {
  it('writes JSON at two spaces, closed by one newline', () => {
    expect(FIXTURE_INDENT).toBe(2);
    expect(serializeFixture(SAMPLE)).toBe(`${JSON.stringify(SAMPLE, null, 2)}\n`);
  });

  it('answers text jsonc/indent accepts', async () => {
    expect(await indentMessages(serializeFixture(SAMPLE))).toEqual([]);
  });

  it('is refused at the old one-space indent, the control', async () => {
    const messages = await indentMessages(`${JSON.stringify(SAMPLE, null, 1)}\n`);
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('the fixture files under src/triage/testdata/', () => {
  for (const path of FIXTURE_FILES) {
    it(`holds ${path} in the serializer's text`, async () => {
      const text = await Bun.file(resolve(ROOT, path)).text();
      expect(text).toBe(serializeFixture(JSON.parse(text)));
    });
  }
});
