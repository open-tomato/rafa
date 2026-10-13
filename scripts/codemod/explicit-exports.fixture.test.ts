import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { runCodemod } from './explicit-exports';

const ISOLATED_DECLARATIONS_CODE_PREFIX = 90;

const FIXTURE: Readonly<Record<string, string>> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
    include: ['src'],
  }),
  'src/core/command/index.ts': [
    'export interface RafaCommand {',
    '  readonly name: string;',
    '  readonly run: () => Promise<void>;',
    '}',
    '',
  ].join('\n'),
  'src/commands/factory.ts': [
    'import type { RafaCommand } from \'../core/command/index.js\';',
    '',
    'export function createPing(): RafaCommand {',
    '  return { name: \'ping\', run: async (): Promise<void> => {} };',
    '}',
    '',
  ].join('\n'),
  'src/commands/ping.ts': [
    'import { createPing } from \'./factory.js\';',
    '',
    'export default createPing();',
    '',
  ].join('\n'),
  'src/lib/values.ts': [
    'export const SIDES = Object.freeze([\'left\', \'right\'] as const);',
    'export type Side = typeof SIDES[number];',
    'export const PATTERN = /^left/;',
    'export const TARGET = [\'docs\', \'survey\'].join(\'/\');',
    '',
  ].join('\n'),
  'src/lib/refused.ts': [
    'function makeAny(): any {',
    '  return 1;',
    '}',
    '',
    'export const ANY = makeAny();',
    '',
  ].join('\n'),
};

const roots: string[] = [];

function plantFixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'explicit-exports-fixture-')));
  roots.push(root);
  for (const [path, text] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The TS90xx diagnostics of a program over `root` with `isolatedDeclarations`, as `file:code`. */
function isolatedDeclarationErrors(root: string): readonly string[] {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config;
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const options: ts.CompilerOptions = { ...parsed.options, declaration: true, isolatedDeclarations: true };
  const program = ts.createProgram(parsed.fileNames, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const others = diagnostics.filter((d) => Math.floor(d.code / 100) !== ISOLATED_DECLARATIONS_CODE_PREFIX);
  expect(others.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  return diagnostics.map((d) => `${d.file === undefined
    ? ''
    : d.file.fileName.slice(root.length + 1)}:${d.code}`);
}

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the codemod over a fixture folder', () => {
  it('annotates what it can, lists and leaves the refused export, and leaves tsc a TS90xx for that export only', () => {
    const root = plantFixture();
    const refusedBefore = readFileSync(join(root, 'src/lib/refused.ts'), 'utf8');
    expect(isolatedDeclarationErrors(root).length).toBeGreaterThan(1);

    const result = runCodemod({ root, folders: ['src'], dryRun: false });

    expect(result.refusals.map((r) => ({ file: r.file, line: r.line, name: r.name }))).toEqual([
      { file: 'src/lib/refused.ts', line: 5, name: 'ANY' },
    ]);
    expect(readFileSync(join(root, 'src/lib/refused.ts'), 'utf8')).toBe(refusedBefore);
    const ping = readFileSync(join(root, 'src/commands/ping.ts'), 'utf8');
    expect(ping).toContain('const command: RafaCommand = createPing();');
    expect(ping).toContain('export default command;');
    const values = readFileSync(join(root, 'src/lib/values.ts'), 'utf8');
    expect(values).toContain('SIDES: readonly [\'left\', \'right\']');
    expect(values).toContain('PATTERN: RegExp');
    expect(values).toContain('TARGET: string');
    expect(isolatedDeclarationErrors(root)).toEqual(['src/lib/refused.ts:9010']);
  });
});
