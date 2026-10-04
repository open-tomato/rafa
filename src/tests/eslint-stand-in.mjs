#!/usr/bin/env bun
/**
 * The ESLint a spawned fixture repository resolves: planted at
 * `node_modules/.bin/eslint` inside the fixture, so `bunx eslint` runs it
 * from the repository itself and nothing outside the repository is read
 * (`task-gate-spawned.test.ts`). It answers the one rule that suite's
 * fixture configures, `jsonc/indent` at two spaces, in ESLint's own JSON
 * report shape (`filePath`, `messages`, `errorCount`, `warningCount`), and
 * exits 1 when a file holds an error and 0 otherwise.
 *
 * It reads no config and no flag: the files are the arguments that are
 * neither a flag nor the value after `--format`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDENT = 2;

/** The files named in `argv`, flags and the value of `--format` left out. */
function filesIn(argv) {
  const files = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--format') index += 1;
    else if (!argv[index].startsWith('--')) files.push(argv[index]);
  }
  return files;
}

/** How many of `chars` `text` holds. */
function count(text, chars) {
  return [...text].filter((char) => chars.includes(char)).length;
}

/** The `jsonc/indent` messages of one JSON file's text. */
function indentMessages(text) {
  const messages = [];
  let depth = 0;
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    const expected = INDENT * (depth - (/^[}\]]/.test(trimmed)
      ? 1
      : 0));
    const found = line.length - line.trimStart().length;
    if (found !== expected) {
      messages.push({
        ruleId: 'jsonc/indent',
        severity: 2,
        message: `Expected indentation of ${expected} spaces but found ${found}.`,
        line: index + 1,
        column: 1,
      });
    }
    depth += count(trimmed, '{[') - count(trimmed, '}]');
  });
  return messages;
}

const report = filesIn(process.argv.slice(2)).map((file) => {
  const messages = file.endsWith('.json')
    ? indentMessages(readFileSync(file, 'utf8'))
    : [];
  return { filePath: resolve(file), messages, errorCount: messages.length, warningCount: 0 };
});

process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.some((entry) => entry.errorCount > 0)
  ? 1
  : 0);
