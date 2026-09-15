/**
 * Tests for the Tracker port's closed unions as lists
 * (`src/adapters/tracker/issue-values.ts`).
 *
 * Each list is spelled here in full and in order, so a member dropped,
 * added or moved reddens its case.
 *
 * The module's other claim is one bun cannot check, since it runs this
 * file without checking a type: a record that drifts from its port
 * union fails `check-types`. So the module's text is copied to a
 * temporary directory outside the repository three times, as it is,
 * with a member dropped and with a member the union lacks, each copy
 * importing the ports entry by its absolute path, and the TypeScript
 * compiler reads the three under the options the root tsconfig gives
 * `check-types`. The unchanged copy must compile clean: the control that
 * a drifted copy is refused for its drift and not for being out of
 * place. Each plant is held to have changed the text it was planted in.
 *
 * Two mutations of the module were driven on 2026-09-14, with
 * `src/adapters/` at 242 pass before and after and the module restored
 * byte-identical (sha256). The types record without `adr` failed
 * `check-types` with TS1360 at the record, and the record naming `epic`
 * failed it with TS2353. Each reddened six cases: the list case, the
 * copies made from the drifted module, and the type refusals in
 * `local.test.ts`, whose messages list the members.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { ISSUE_PRIORITIES, ISSUE_STATES, ISSUE_TYPES } from './issue-values.js';

/** The repository root, whose tsconfig the compiler reads under. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The module the copies are made from. */
const MODULE = fileURLToPath(new URL('./issue-values.ts', import.meta.url));

/** The ports entry, as the module imports it, and as a copy outside the repository does. */
const PORTS_IMPORT = '../../ports/index.js';
const PORTS_ENTRY = fileURLToPath(new URL(PORTS_IMPORT, import.meta.url));

/** A member line of the types record, and what each plant puts in its place. */
const ADR_LINE = '  \'adr\': true,\n';
const LAST_TYPE_LINE = '  \'package-api\': true,\n';

/** TS1360: an expression does not satisfy the type it names, here by missing a member. */
const MISSING_MEMBER = 1360;

/** TS2353: an object literal names a property its type lacks. */
const UNKNOWN_MEMBER = 2353;

let tempDir = '';
let program: ts.Program | null = null;

/** The copies, by what was planted in them. */
const copies = { unchanged: '', dropped: '', added: '' };

/** The diagnostic codes the compiler reports for one copy. */
function diagnosticCodes(file: string): number[] {
  if (program === null) throw new Error('the program was never compiled');
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`the program holds no ${file}`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => diagnostic.code);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-issue-values-'));
  const original = readFileSync(MODULE, 'utf8').replace(PORTS_IMPORT, PORTS_ENTRY.replace(/\.ts$/, '.js'));
  const texts = {
    unchanged: original,
    dropped: original.replace(ADR_LINE, ''),
    added: original.replace(LAST_TYPE_LINE, `${LAST_TYPE_LINE}  'epic': true,\n`),
  };
  for (const [name, text] of Object.entries(texts)) {
    const file = join(tempDir, `${name}.ts`);
    writeFileSync(file, text);
    copies[name as keyof typeof copies] = file;
  }

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);
  program = ts.createProgram({ rootNames: Object.values(copies), options: parsed.options });
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('the issue value lists', () => {
  it.each([
    ['ISSUE_TYPES', ISSUE_TYPES, ['code', 'bug', 'spike', 'adr', 'chore', 'package-api']],
    ['ISSUE_PRIORITIES', ISSUE_PRIORITIES, ['urgent', 'high', 'medium', 'low']],
    [
      'ISSUE_STATES',
      ISSUE_STATES,
      ['backlog', 'todo', 'in-progress', 'in-review', 'done', 'released', 'cancelled'],
    ],
  ])('%s holds every member of its union, in the source order, frozen', (_name, list, members) => {
    const held: readonly string[] = [...list];

    expect(held).toEqual(members);
    expect(Object.isFrozen(list)).toBe(true);
  });
});

describe('a list drifting from its port union', () => {
  it('plants each drift in a copy of the module text', () => {
    const unchanged = readFileSync(copies.unchanged, 'utf8');

    expect(unchanged).toContain(ADR_LINE);
    expect(unchanged).toContain(PORTS_ENTRY.replace(/\.ts$/, '.js'));
    expect(readFileSync(copies.dropped, 'utf8')).not.toBe(unchanged);
    expect(readFileSync(copies.added, 'utf8')).not.toBe(unchanged);
  });

  it('compiles clean while unchanged, outside the repository', () => {
    expect(diagnosticCodes(copies.unchanged)).toEqual([]);
  });

  it('fails to compile with a member of the union missing', () => {
    expect(diagnosticCodes(copies.dropped)).toEqual([MISSING_MEMBER]);
  });

  it('fails to compile with a member the union lacks', () => {
    expect(diagnosticCodes(copies.added)).toEqual([UNKNOWN_MEMBER]);
  });
});
