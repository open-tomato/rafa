/**
 * The `src/learning/` boundary rule in `eslint.config.mjs`, read through
 * ESLint itself against scratch sources placed under `src/learning/`.
 *
 * Each scratch source is linted with `lintText` and a `filePath` inside
 * the library, so the root config's `files` globs and the import
 * resolver read it as a module of `src/learning/` without anything being
 * written into the tree. If a stray file were left behind, `eslint .`
 * would go red on it.
 *
 * A refusal read alone could be a false negative in the other direction:
 * a rule that refused every import would pass it. So each refusal sits
 * beside a control the rule must let through: the same `../config.js`
 * from outside the library, a sibling import inside it, and the two
 * built-ins the library does use.
 */
import type { Linter } from 'eslint';

import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dir, '..', '..');

const eslint = new ESLint({ cwd: ROOT });

/** Lints `source` as if it sat at `relativePath` under the repo root. */
async function messagesFor(
  relativePath: string,
  source: string,
): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(source, {
    filePath: join(ROOT, relativePath),
  });
  if (result === undefined) {
    throw new Error(`ESLint returned no result for ${relativePath}`);
  }
  return result.messages;
}

function ruleIds(messages: Linter.LintMessage[]): (string | null)[] {
  return messages.map((message) => message.ruleId);
}

const SCRATCH = 'src/learning/boundary-scratch.ts';

describe('the src/learning/ boundary rule', () => {
  test('refuses an import of ../config.js from src/learning/', async () => {
    const messages = await messagesFor(
      SCRATCH,
      'export { loadConfig } from \'../config.js\';\n',
    );

    expect(ruleIds(messages)).toEqual(['import/no-restricted-paths']);
    expect(messages[0]?.message).toContain(
      'src/learning/ imports nothing from the rest of src/.',
    );
  });

  test('lets the same import through outside src/learning/', async () => {
    const messages = await messagesFor(
      'src/plan/boundary-scratch.ts',
      'export { loadConfig } from \'../config.js\';\n',
    );

    expect(ruleIds(messages)).toEqual([]);
  });

  test('lets a sibling import inside src/learning/ through', async () => {
    const messages = await messagesFor(
      SCRATCH,
      'export { actionHash } from \'./identity.js\';\n',
    );

    expect(ruleIds(messages)).toEqual([]);
  });

  test('lets a parent import that stays in src/learning/ through', async () => {
    const messages = await messagesFor(
      'src/learning/testdata/boundary-scratch.ts',
      'export { actionHash } from \'../identity.js\';\n',
    );

    expect(ruleIds(messages)).toEqual([]);
  });

  test.each(['node:fs', 'node:fs/promises', 'fs', 'fs/promises'])(
    'refuses %s in src/learning/',
    async (name) => {
      const messages = await messagesFor(
        SCRATCH,
        `export { readFile } from '${name}';\n`,
      );

      expect(ruleIds(messages)).toEqual(['no-restricted-imports']);
      expect(messages[0]?.message).toContain(
        'src/learning/ touches no filesystem.',
      );
    },
  );

  test('lets node:crypto and bun:test through in src/learning/', async () => {
    const messages = await messagesFor(
      SCRATCH,
      [
        'export { createHash } from \'node:crypto\';',
        'export { expect } from \'bun:test\';',
        '',
      ].join('\n'),
    );

    expect(ruleIds(messages)).toEqual([]);
  });
});
