/**
 * The README's "Before you run it" table (`## Before you run it`) lists,
 * under "Command | Spends usage", one row per command whose `spends`
 * declaration is not null, spelled `rafa <words>` plus ` <flag>` for a
 * `with` declaration (`rafa pr triage --resolve`). This file proves the
 * table names exactly the spenders {@link describeRegistry} reports over
 * the core registry, both ways: a row the table has and the registry does
 * not, or a spender the registry has and the table does not, fails the
 * comparison.
 *
 * Its control removes the `rafa skill backfill --propose` row from a copy
 * of the README and asserts the comparison then fails, so a passing case
 * above is proof the table was actually checked and not merely present.
 */
import type { CommandSpend } from '../cli/spends.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { CORE_REGISTRY } from '../commands/index.js';

/** The repository root, read from this file's own location. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A command's declaration spelled as the README spells it: `rafa <words>`, plus ` <flag>` for a `with` declaration. */
function spelledCommand(words: string, spends: CommandSpend): string {
  const flag = spends.when === 'with'
    ? ` ${spends.flag}`
    : '';
  return `rafa ${words}${flag}`;
}

/** Every spender's command, spelled as the README spells it, across the whole document. */
function spendersOf(document: ReturnType<typeof describeRegistry>): string[] {
  return [
    ...document.subjects.flatMap((subject) => subject.actions
      .filter((action) => action.spends !== null)
      .map((action) => spelledCommand(`${subject.name} ${action.name}`, action.spends as CommandSpend))),
    ...document.commands
      .filter((command) => command.spends !== null)
      .map((command) => spelledCommand(command.name, command.spends as CommandSpend)),
  ];
}

/** The header line the table's `Command` column opens under, trimmed of the list item's leading spaces. */
const TABLE_HEADER = '| Command | Spends usage |';

/**
 * The Command column of the README's "Before you run it" table: one
 * entry per row, read between the header (with its `| --- | --- |`
 * separator) and the first line that is not a table row. Throws when
 * `readme` has no such table, so a case naming the wrong file fails loud
 * rather than comparing against an empty list.
 */
function readmeSpenders(readme: string): string[] {
  const lines = readme.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === TABLE_HEADER);
  if (headerIndex === -1) {
    throw new Error(`README has no "${TABLE_HEADER}" table`);
  }
  const rows: string[] = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const command = line.split('|')[1]?.trim().match(/^`(.+)`$/)?.[1];
    if (command === undefined) {
      throw new Error(`README table row is not a backtick-quoted command: "${line}"`);
    }
    rows.push(command);
  }
  return rows;
}

describe('the README\'s "Before you run it" table', () => {
  it('names exactly the spenders describeRegistry reports over the core registry', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const document = describeRegistry(CORE_REGISTRY, '1.0.0');

    expect(readmeSpenders(readme).sort()).toEqual(spendersOf(document).sort());
  });

  it('control: a row removed from a copy of the README fails the comparison', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const withoutBackfillRow = readme
      .split('\n')
      .filter((line) => !line.includes('`rafa skill backfill --propose`'))
      .join('\n');
    const document = describeRegistry(CORE_REGISTRY, '1.0.0');

    expect(readmeSpenders(withoutBackfillRow).sort()).not.toEqual(spendersOf(document).sort());
  });
});
