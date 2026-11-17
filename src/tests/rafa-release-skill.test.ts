/**
 * The `rafa-release` skill's case table (the index in `SKILL.md`) and its
 * case files agree: every table row names a file that exists, every case
 * file opens with its own `case:` line and names, on its `Key:` line, a
 * reason or outcome the table holds, and no case file is left out of the
 * table. A planted copy of the skill proves each failure is caught.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

const SKILL_DIR = resolve(import.meta.dir, '../../.claude/skills/rafa-release');
const NON_CASE_FILES = new Set(['SKILL.md', 'tag.md', 'settle.md', 'publish.md']);
const TABLE_ROW = /^\| `([a-z-]+)` \| `([a-z]+)` \|/;

type TableRow = { readonly file: string; readonly key: string };

function readTable(dir: string): readonly TableRow[] {
  return readFileSync(join(dir, 'SKILL.md'), 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = TABLE_ROW.exec(line);
      return match
        ? [{ file: match[1]!, key: match[2]! }]
        : [];
    });
}

function problemsIn(dir: string): readonly string[] {
  const table = readTable(dir);
  const problems: string[] = [];
  if (table.length === 0) problems.push('the case table has no rows');
  const tableFiles = new Set(table.map((row) => row.file));
  for (const row of table) {
    let text: string;
    try {
      text = readFileSync(join(dir, `${row.file}.md`), 'utf8');
    } catch {
      problems.push(`${row.file}: the table names a file that is missing`);
      continue;
    }
    if (!text.startsWith(`---\ncase: ${row.file}\n---`)) {
      problems.push(`${row.file}: no frontmatter "case: ${row.file}" line`);
    }
    const keyLine = /^Key: .*$/m.exec(text)?.[0];
    if (!keyLine || !keyLine.includes(`\`${row.key}\``)) {
      problems.push(`${row.file}: no Key line naming \`${row.key}\``);
    }
  }
  for (const name of readdirSync(dir)) {
    if (NON_CASE_FILES.has(name) || !name.endsWith('.md')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const keyLine = /^Key: .*$/m.exec(text)?.[0] ?? '';
    const keyed = table.some((row) => keyLine.includes(`\`${row.key}\``));
    if (!tableFiles.has(name.slice(0, -3))) problems.push(`${name}: not in the case table`);
    else if (!keyed) problems.push(`${name}: names no reason or outcome of the table`);
  }
  return problems;
}

describe('the rafa-release skill', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function plant(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-release-skill-'));
    scratch.push(dir);
    cpSync(SKILL_DIR, dir, { recursive: true });
    return dir;
  }

  test('lists the ten cases, each with its file, and no problem', () => {
    expect(readTable(SKILL_DIR)).toHaveLength(10);
    expect(problemsIn(SKILL_DIR)).toEqual([]);
  });

  test('fails when the table names a file that is missing', () => {
    const dir = plant();
    rmSync(join(dir, 'tag-git.md'));
    expect(problemsIn(dir)).toContain('tag-git: the table names a file that is missing');
  });

  test('fails when a case file names no reason or outcome of the table', () => {
    const dir = plant();
    const path = join(dir, 'tag-branch.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^Key: .*$/m, 'Key: nothing here.'));
    expect(problemsIn(dir)).toContain('tag-branch: no Key line naming `branch`');
  });

  test('fails when a case file is left out of the table', () => {
    const dir = plant();
    writeFileSync(join(dir, 'tag-extra.md'), '---\ncase: tag-extra\n---\nKey: `extra`\n');
    expect(problemsIn(dir)).toContain('tag-extra.md: not in the case table');
  });

  test('fails when a case file opens with another case name', () => {
    const dir = plant();
    const path = join(dir, 'settle-pr.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('case: settle-pr', 'case: other'));
    expect(problemsIn(dir)).toContain('settle-pr: no frontmatter "case: settle-pr" line');
  });
});
