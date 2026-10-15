/**
 * The core-config-sections sweep: no code file under `src/core/` imports a
 * `src/config-schema-*.ts` file, by any specifier `textImports` finds, and
 * `loadConfig` with no section registered refuses naming the registry.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import ts from 'typescript';

import { textImports } from '../../scripts/survey/import-graph.js';
import { SETTING_NAMES } from '../config-registry.js';
import { activeSettings, CORE_SECTION, EMPTY_CONFIG_REGISTRY, registerConfigSections, restoreConfigSections } from '../core/config/index.js';
import { loadConfig } from '../core/config/load.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const CORE_DIR = fileURLToPath(new URL('../core/', import.meta.url));
const SCHEMA_SPECIFIER = /(^|\/)config-schema-[^/]+?(\.[cm]?[jt]s)?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

function codeFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CODE_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('core imports no config-schema section', () => {
  const files = codeFilesUnder(CORE_DIR);

  it('reads the files of src/core/', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no import of a src/config-schema-*.ts file', () => {
    const offending = files.flatMap((file) => textImports(readFileSync(file, 'utf8'))
      .filter((specifier) => SCHEMA_SPECIFIER.test(specifier))
      .map((specifier) => `${file.slice(CORE_DIR.length)} imports ${specifier}`));
    expect(offending).toEqual([]);
  });

  it('matches every specifier form the pattern guards', () => {
    const text = [
      'import a from \'../../config-schema-hub.js\';',
      'import type { B } from \'../config-schema-logger\';',
      'export * from \'../../config-schema-tests.ts\';',
      'const c = await import(\'../../config-schema-errors.js\');',
      'const d = require(\'../../config-schema-issues.js\');',
    ].join('\n');
    expect(textImports(text).filter((s) => SCHEMA_SPECIFIER.test(s))).toHaveLength(5);
  });
});

/** A name a node declares or re-exports, which is no use of it. */
function isNaming(node: ts.Identifier): boolean {
  const { parent } = node;
  return (ts.isVariableDeclaration(parent) && parent.name === node)
    || ts.isImportSpecifier(parent)
    || ts.isExportSpecifier(parent);
}

/**
 * The identifiers a source uses and the string literals that are exactly
 * one name, as in a list of setting names; comments and the text of a longer
 * string contribute nothing, and neither does a declared or re-exported name.
 */
function namesUsedIn(source: string): Set<string> {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isNaming(node)) found.add(node.text);
    if (ts.isStringLiteralLike(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('core spells no setting name its own section does not define', () => {
  const foreign = SETTING_NAMES.filter((name) => !(name in CORE_SECTION.settings));

  it('has foreign setting names to look for', () => {
    expect(foreign).toContain('loggerModules');
  });

  it('uses none of them in a code file of src/core/ that is no test', () => {
    const offending = codeFilesUnder(CORE_DIR).filter((file) => !/\.test\.[cm]?[jt]sx?$/.test(file))
      .flatMap((file) => {
        const used = namesUsedIn(readFileSync(file, 'utf8'));
        return foreign.filter((name) => used.has(name)).map((name) => `${file.slice(CORE_DIR.length)} uses ${name}`);
      });
    expect(offending).toEqual([]);
  });

  it('reads a use and a bare name, and skips a comment, a longer string and a declaration', () => {
    const used = namesUsedIn('// c1\nconst d1 = \'sentence s1\'; const l1 = [\'n1\']; f(u1); export { x1 } from \'./m\';');
    expect([...used].sort()).toEqual(['./m', 'f', 'n1', 'sentence s1', 'u1']);
  });
});

describe('loadConfig with no section registered', () => {
  const saved = registerConfigSections([]);
  const scratch: string[] = [];
  afterEach(() => {
    restoreConfigSections(saved);
    for (const dir of scratch.splice(0)) rmSync(dir, { force: true, recursive: true });
  });

  it('rejects naming src/config-registry.ts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'core-sections-'));
    scratch.push(root);
    restoreConfigSections(EMPTY_CONFIG_REGISTRY);
    expect(Object.keys(activeSettings())).toEqual([]);
    await expect(loadConfig({ home: root, root } as never)).rejects.toThrow('src/config-registry.ts');
  });
});
