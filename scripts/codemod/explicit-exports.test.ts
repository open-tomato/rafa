import type { CodemodResult, Refusal } from './explicit-exports';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { main, reportLines, runCodemod, USAGE } from './explicit-exports';

/**
 * The config every planted project is built from. `types` is empty and
 * `lib` is named, so the program needs nothing but the compiler's own
 * library files and reads the same under any `node_modules`.
 */
const TSCONFIG = JSON.stringify({
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
});

const BARREL_PATH = 'src/core/command/index.ts';

function lines(...text: readonly string[]): string {
  return `${text.join('\n')}\n`;
}

/** The command barrel of a planted project: the one type the rewrite names. */
const BARREL = lines(
  'export interface RafaCommand {',
  '  readonly name: string;',
  '  readonly run: () => Promise<void>;',
  '}',
);

/** A factory with a declared return type, as most command modules have. */
const FACTORY = lines(
  'import type { RafaCommand } from \'../core/command/index.js\';',
  '',
  'export function createPing(): RafaCommand {',
  '  return { name: \'ping\', run: async (): Promise<void> => {} };',
  '}',
);

const PING = lines(
  '/** The ping command. */',
  'import { createPing } from \'./factory.js\';',
  '',
  '/** `rafa ping`. */',
  'export default createPing();',
);

const roots: string[] = [];

/** Plants a project under a new temporary folder, with the config and the barrel unless `files` names them. */
function plant(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'explicit-exports-')));
  roots.push(root);
  const planted = { 'tsconfig.json': TSCONFIG, [BARREL_PATH]: BARREL, ...files };
  for (const [path, text] of Object.entries(planted)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function run(root: string, dryRun = false): CodemodResult {
  return runCodemod({ root, folders: ['src'], dryRun });
}

/** A refusal without its reason, which each case reads on its own. */
function placeOf(refusal: Refusal): Omit<Refusal, 'reason'> {
  return { file: refusal.file, line: refusal.line, code: refusal.code, name: refusal.name };
}

/** The one refusal a case expects, failing the case when there is another count. */
function onlyRefusal(result: CodemodResult): Refusal {
  const [refusal, ...rest] = result.refusals;
  if (refusal === undefined || rest.length > 0) {
    throw new Error(`Expected one refusal, got ${result.refusals.length}`);
  }
  return refusal;
}

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the default-export rewrite', () => {
  it('moves a default-exported factory call into an annotated constant and adds the import type line', () => {
    const root = plant({ 'src/commands/factory.ts': FACTORY, 'src/commands/ping.ts': PING });

    const result = run(root);

    expect(read(root, 'src/commands/ping.ts')).toBe(lines(
      '/** The ping command. */',
      'import type { RafaCommand } from \'../core/command/index.js\';',
      '',
      'import { createPing } from \'./factory.js\';',
      '',
      '/** `rafa ping`. */',
      'const command: RafaCommand = createPing();',
      'export default command;',
    ));
    expect(result.rewrites).toEqual([
      { file: 'src/commands/ping.ts', line: 2, kind: 'import', summary: 'import type { RafaCommand } from \'../core/command/index.js\';' },
      { file: 'src/commands/ping.ts', line: 5, kind: 'default-export', summary: 'const command: RafaCommand = …; export default command;' },
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.changedFiles).toEqual(['src/commands/ping.ts']);
  });

  it('adds no import line to a file that already imports the name', () => {
    const root = plant({
      'src/commands/ping.ts': lines(
        'import type { RafaCommand } from \'../core/command/index.js\';',
        '',
        'function createPing(): RafaCommand {',
        '  return { name: \'ping\', run: async (): Promise<void> => {} };',
        '}',
        '',
        'export default createPing();',
      ),
    });

    const result = run(root);

    expect(read(root, 'src/commands/ping.ts')).toBe(lines(
      'import type { RafaCommand } from \'../core/command/index.js\';',
      '',
      'function createPing(): RafaCommand {',
      '  return { name: \'ping\', run: async (): Promise<void> => {} };',
      '}',
      '',
      'const command: RafaCommand = createPing();',
      'export default command;',
    ));
    expect(result.rewrites.map((rewrite) => rewrite.kind)).toEqual(['default-export']);
  });

  it('puts the import line after the last import type line, by the path from a nested folder', () => {
    const root = plant({
      'src/commands/factory.ts': FACTORY,
      'src/commands/pr/seams.ts': 'export interface Seams {\n  readonly label: string;\n}\n',
      'src/commands/pr/close.ts': lines(
        'import type { Seams } from \'./seams.js\';',
        '',
        'import { createPing } from \'../factory.js\';',
        '',
        'export const SEAMS: Seams = { label: \'close\' };',
        '',
        'export default createPing();',
      ),
    });

    run(root);

    expect(read(root, 'src/commands/pr/close.ts')).toBe(lines(
      'import type { Seams } from \'./seams.js\';',
      'import type { RafaCommand } from \'../../core/command/index.js\';',
      '',
      'import { createPing } from \'../factory.js\';',
      '',
      'export const SEAMS: Seams = { label: \'close\' };',
      '',
      'const command: RafaCommand = createPing();',
      'export default command;',
    ));
  });

  it('rewrites a factory whose return type is inferred, and closes a statement that had no semicolon', () => {
    const root = plant({
      'src/commands/ping.ts': lines(
        'function createPing() {',
        '  return { name: \'ping\', run: async (): Promise<void> => {} };',
        '}',
        '',
        'export default createPing()',
      ),
    });

    run(root);

    expect(read(root, 'src/commands/ping.ts')).toBe(lines(
      'import type { RafaCommand } from \'../core/command/index.js\';',
      '',
      'function createPing() {',
      '  return { name: \'ping\', run: async (): Promise<void> => {} };',
      '}',
      '',
      'const command: RafaCommand = createPing();',
      'export default command;',
    ));
  });

  it('refuses a default export outside a commands folder and leaves the file as it was', () => {
    const source = lines('import { createPing } from \'../commands/factory.js\';', '', 'export default createPing();');
    const root = plant({ 'src/commands/factory.ts': FACTORY, 'src/modules/ping.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(placeOf(refusal)).toEqual({ file: 'src/modules/ping.ts', line: 3, code: 9037, name: 'createPing()' });
    expect(refusal.reason).toBe('the default export is outside a `commands` folder');
    expect(read(root, 'src/modules/ping.ts')).toBe(source);
  });

  it('refuses a default export whose type is not assignable to RafaCommand', () => {
    const source = lines('function createCount() {', '  return { name: 1 };', '}', '', 'export default createCount();');
    const root = plant({ 'src/commands/count.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(placeOf(refusal)).toEqual({ file: 'src/commands/count.ts', line: 5, code: 9037, name: 'createCount()' });
    expect(refusal.reason).toBe('the expression\'s type is not assignable to `RafaCommand`');
    expect(read(root, 'src/commands/count.ts')).toBe(source);
  });

  it('refuses a file that already uses the name command', () => {
    const source = lines(
      'import { createPing } from \'./factory.js\';',
      '',
      'const command = createPing();',
      '',
      'export const NAME: string = command.name;',
      '',
      'export default createPing();',
    );
    const root = plant({ 'src/commands/factory.ts': FACTORY, 'src/commands/ping.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(refusal.line).toBe(7);
    expect(refusal.reason).toBe('the file already uses the name `command`');
    expect(read(root, 'src/commands/ping.ts')).toBe(source);
  });

  it('refuses a file where RafaCommand names another type', () => {
    const source = lines(
      'import { createPing } from \'./factory.js\';',
      '',
      'interface RafaCommand {',
      '  readonly other: true;',
      '}',
      '',
      'export const OTHER: RafaCommand = { other: true };',
      '',
      'export default createPing();',
    );
    const root = plant({ 'src/commands/factory.ts': FACTORY, 'src/commands/ping.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(refusal.line).toBe(9);
    expect(refusal.reason).toBe('`RafaCommand` names something else in this file');
    expect(read(root, 'src/commands/ping.ts')).toBe(source);
  });

  it('refuses every default export when the barrel exports no RafaCommand', () => {
    const source = lines('function createPing() {', '  return { name: \'ping\' };', '}', '', 'export default createPing();');
    const root = plant({ [BARREL_PATH]: 'export const VERSION = 1;\n', 'src/commands/ping.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(refusal.reason).toBe('the program holds no `RafaCommand` exported from src/core/command/index.ts');
    expect(read(root, 'src/commands/ping.ts')).toBe(source);
  });
});

describe('the value rewrite', () => {
  const VALUES = lines(
    'import { joinPath } from \'./paths.js\';',
    '',
    'const BASE = \'docs\';',
    '',
    'export const GRAPH_PATH = `${BASE}/graph.json`;',
    'export const JOINED = joinPath(BASE, \'graph.json\');',
    'export const PATTERN = /^Phase 0/;',
    'export const KINDS = Object.freeze([\'gotcha\', \'pattern\'] as const);',
    'export type Kind = typeof KINDS[number];',
    'export const LIMIT = BASE.length * 2;',
    '',
    'export function label(kind: Kind, prefix = BASE) {',
    '  return joinPath(prefix, kind);',
    '}',
    '',
    'export const size = (text = BASE) => text.length;',
    '',
    'export class Unreachable extends Error {',
    '  override readonly name = BASE;',
    '  attempts? = LIMIT;',
    '}',
  );

  const PATHS = lines('export function joinPath(...parts: readonly string[]): string {', '  return parts.join(\'/\');', '}');

  it('writes the type the checker infers after a variable, a parameter, a property and a parameter list', () => {
    const root = plant({ 'src/lib/paths.ts': PATHS, 'src/lib/values.ts': VALUES });

    const result = run(root);

    expect(read(root, 'src/lib/values.ts')).toBe(lines(
      'import { joinPath } from \'./paths.js\';',
      '',
      'const BASE = \'docs\';',
      '',
      'export const GRAPH_PATH: \'docs/graph.json\' = `${BASE}/graph.json`;',
      'export const JOINED: string = joinPath(BASE, \'graph.json\');',
      'export const PATTERN: RegExp = /^Phase 0/;',
      'export const KINDS: readonly [\'gotcha\', \'pattern\'] = Object.freeze([\'gotcha\', \'pattern\'] as const);',
      'export type Kind = typeof KINDS[number];',
      'export const LIMIT: number = BASE.length * 2;',
      '',
      'export function label(kind: Kind, prefix: string = BASE): string {',
      '  return joinPath(prefix, kind);',
      '}',
      '',
      'export const size = (text: string = BASE): number => text.length;',
      '',
      'export class Unreachable extends Error {',
      '  override readonly name: \'docs\' = BASE;',
      '  attempts?: number | undefined = LIMIT;',
      '}',
    ));
    expect(result.refusals).toEqual([]);
    expect(result.rewrites.map(({ line, kind, summary }) => `${line} ${kind} ${summary}`)).toEqual([
      '5 variable GRAPH_PATH: \'docs/graph.json\'',
      '6 variable JOINED: string',
      '7 variable PATTERN: RegExp',
      '8 variable KINDS: readonly [\'gotcha\', \'pattern\']',
      '10 variable LIMIT: number',
      '12 return label(): string',
      '12 parameter prefix: string',
      '16 return size(): number',
      '16 parameter text: string',
      '19 property name: \'docs\'',
      '20 property attempts: number | undefined',
    ]);
  });

  it('changes nothing in a file whose exports the compiler can already write', () => {
    const source = lines(
      'export const NAME = \'ping\';',
      'export const PATTERN: RegExp = /^a/;',
      'export function double(count: number): number {',
      '  return count * 2;',
      '}',
    );
    const root = plant({ 'src/lib/plain.ts': source });

    const result = run(root);

    expect(result).toEqual({ filesRead: 2, rewrites: [], refusals: [], changedFiles: [], dryRun: false });
    expect(read(root, 'src/lib/plain.ts')).toBe(source);
  });

  it('reads only the files under the folders it is given', () => {
    const source = 'export const PATTERN = /^a/;\n';
    const root = plant({ 'src/first/a.ts': source, 'src/second/b.ts': source });

    const result = runCodemod({ root, folders: ['src/first'], dryRun: false });

    expect(result.filesRead).toBe(1);
    expect(result.changedFiles).toEqual(['src/first/a.ts']);
    expect(read(root, 'src/first/a.ts')).toBe('export const PATTERN: RegExp = /^a/;\n');
    expect(read(root, 'src/second/b.ts')).toBe(source);
  });
});

describe('the refusal list', () => {
  const SHAPES = lines(
    'export interface Shape {',
    '  readonly side: number;',
    '}',
    '',
    'interface Hidden {',
    '  readonly depth: number;',
    '}',
    '',
    'export function makeShape(): Shape {',
    '  return { side: 1 };',
    '}',
    '',
    'export function makeHidden(): Hidden {',
    '  return { depth: 1 };',
    '}',
    '',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
    'export function makeAny(): any {',
    '  return 1;',
    '}',
    '',
    'export const SIDES: readonly [\'left\', \'right\'] = [\'left\', \'right\'];',
  );

  const REFUSED = lines(
    'import { makeAny, makeHidden, makeShape, SIDES } from \'./shapes.js\';',
    '',
    'export const ANY = makeAny();',
    'export const SHAPE = makeShape();',
    'export const HIDDEN = makeHidden();',
    'export const INSTANCE = new (class {',
    '  readonly side = 2;',
    '})();',
    'export let COUNTS = [1, 2];',
    'export const ALL_SIDES = [...SIDES, \'top\'] as const;',
    'export const isLeft = (side: string) => side === \'left\';',
    'export const PATTERN = /^left/;',
  );

  it('lists each export it cannot write with its file and line, and rewrites the one beside them', () => {
    const root = plant({ 'src/lib/shapes.ts': SHAPES, 'src/lib/refused.ts': REFUSED });

    const result = run(root);

    expect(result.refusals.map(placeOf)).toEqual([
      { file: 'src/lib/refused.ts', line: 3, code: 9010, name: 'ANY' },
      { file: 'src/lib/refused.ts', line: 4, code: 9010, name: 'SHAPE' },
      { file: 'src/lib/refused.ts', line: 5, code: 9010, name: 'HIDDEN' },
      { file: 'src/lib/refused.ts', line: 6, code: 9010, name: 'INSTANCE' },
      { file: 'src/lib/refused.ts', line: 9, code: 9017, name: 'COUNTS' },
      { file: 'src/lib/refused.ts', line: 10, code: 9018, name: '...SIDES' },
      { file: 'src/lib/refused.ts', line: 11, code: 9007, name: 'isLeft' },
    ]);
    expect(result.refusals.map((refusal) => refusal.reason)).toEqual([
      'the printed type holds `any`',
      'the printed type holds an `import(\'…\')` type, for `Shape`, which the file does not import',
      'the file cannot reach the name `Hidden` of the printed type',
      'the printed type holds an anonymous class',
      'no rewrite for this site: Only const arrays can be inferred with --isolatedDeclarations.',
      'no rewrite for this site: Arrays with spread elements can\'t inferred with --isolatedDeclarations.',
      'the function returns a type predicate, which a printed return type would drop',
    ]);
    expect(result.rewrites.map((rewrite) => rewrite.summary)).toEqual(['PATTERN: RegExp']);
    expect(read(root, 'src/lib/refused.ts')).toBe(REFUSED.replace('PATTERN = ', 'PATTERN: RegExp = '));
    expect(read(root, 'src/lib/shapes.ts')).toBe(SHAPES);
  });

  it('refuses a type its module does not export where the file declares another type of the same name', () => {
    const source = lines(
      'import { makeHidden } from \'./shapes.js\';',
      '',
      'interface Hidden {',
      '  readonly label: string;',
      '}',
      '',
      'export const LOCAL: Hidden = { label: \'here\' };',
      'export const HIDDEN = makeHidden();',
    );
    const root = plant({ 'src/lib/shapes.ts': SHAPES, 'src/lib/shadow.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(placeOf(refusal)).toEqual({ file: 'src/lib/shadow.ts', line: 8, code: 9010, name: 'HIDDEN' });
    expect(refusal.reason).toStartWith('tsc reports a second error at this site, TS4023: Exported variable \'HIDDEN\' has or is using name \'Hidden\' from external module');
    expect(refusal.reason).toEndWith('but cannot be named.');
    expect(read(root, 'src/lib/shadow.ts')).toBe(source);
  });

  it('refuses every site of a file that holds a type error', () => {
    const source = lines('export const COUNT: number = \'one\';', 'export const PATTERN = /^a/;');
    const root = plant({ 'src/lib/broken.ts': source });

    const refusal = onlyRefusal(run(root));

    expect(placeOf(refusal)).toEqual({ file: 'src/lib/broken.ts', line: 2, code: 9010, name: 'PATTERN' });
    expect(refusal.reason).toBe('the file holds TS2322 on line 1, and a type printed beside an error may be wrong');
    expect(read(root, 'src/lib/broken.ts')).toBe(source);
  });
});

describe('--dry-run', () => {
  const MIXED: Readonly<Record<string, string>> = {
    'src/commands/factory.ts': FACTORY,
    'src/commands/ping.ts': PING,
    'src/lib/values.ts': lines('export const PATTERN = /^a/;', 'export let COUNTS = [1, 2];'),
  };

  it('plans the same rewrites as a real run and writes no file', () => {
    const root = plant(MIXED);

    const planned = run(root, true);

    expect(planned.changedFiles).toEqual(['src/commands/ping.ts', 'src/lib/values.ts']);
    expect(read(root, 'src/commands/ping.ts')).toBe(PING);
    expect(read(root, 'src/lib/values.ts')).toBe(MIXED['src/lib/values.ts'] ?? '');

    const written = run(root);

    expect(written).toEqual({ ...planned, dryRun: false });
    expect(read(root, 'src/commands/ping.ts')).not.toBe(PING);
    expect(read(root, 'src/lib/values.ts')).toBe(lines('export const PATTERN: RegExp = /^a/;', 'export let COUNTS = [1, 2];'));
  });

  it('prints each planned change, each refusal and the totals', () => {
    const root = plant(MIXED);

    expect(reportLines(run(root, true))).toEqual([
      'Read 4 files of the program.',
      'would rewrite src/commands/ping.ts:2 import type { RafaCommand } from \'../core/command/index.js\';',
      'would rewrite src/commands/ping.ts:5 const command: RafaCommand = …; export default command;',
      'would rewrite src/lib/values.ts:1 PATTERN: RegExp',
      'refused src/lib/values.ts:2 COUNTS (TS9017): no rewrite for this site: Only const arrays can be inferred with --isolatedDeclarations.',
      '3 rewrites in 2 files, 1 refused; dry run, nothing written.',
    ]);
    expect(reportLines(run(root)).at(-1)).toBe('3 rewrites in 2 files, 1 refused.');
    expect(reportLines(run(root))).toEqual([
      'Read 4 files of the program.',
      'refused src/lib/values.ts:2 COUNTS (TS9017): no rewrite for this site: Only const arrays can be inferred with --isolatedDeclarations.',
      '0 rewrites in 0 files, 1 refused.',
    ]);
  });
});

describe('a second run', () => {
  it('changes nothing in the output of a first run and lists the same refusals', () => {
    const files = [BARREL_PATH, 'src/commands/factory.ts', 'src/commands/ping.ts', 'src/lib/values.ts', 'src/lib/refused.ts'];
    const root = plant({
      'src/commands/factory.ts': FACTORY,
      'src/commands/ping.ts': PING,
      'src/lib/values.ts': lines(
        'const BASE = \'docs\';',
        'export const PATTERN = /^a/;',
        'export function label(prefix = BASE) {',
        '  return prefix.toUpperCase();',
        '}',
      ),
      'src/lib/refused.ts': lines('export let COUNTS = [1, 2];', 'export const INSTANCE = new (class {})();'),
    });

    const first = run(root);
    const afterFirst = files.map((file) => read(root, file));
    const second = run(root);

    expect(first.rewrites.map((rewrite) => rewrite.kind)).toEqual(['import', 'default-export', 'variable', 'return', 'parameter']);
    expect(first.refusals.map((refusal) => refusal.name)).toEqual(['COUNTS', 'INSTANCE']);
    expect(second.rewrites).toEqual([]);
    expect(second.changedFiles).toEqual([]);
    expect(second.refusals).toEqual(first.refusals);
    expect(files.map((file) => read(root, file))).toEqual(afterFirst);
  });
});

describe('main', () => {
  /** Runs `main` and answers its exit code with what it wrote to each stream. */
  function command(argv: readonly string[], cwd: string): { code: number; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, cwd, { out: (line) => out.push(line), err: (line) => err.push(line) });
    return { code, out, err };
  }

  it('answers 0 and prints the report, writing nothing under --dry-run', () => {
    const source = 'export const PATTERN = /^a/;\n';
    const root = plant({ 'src/lib/values.ts': source });

    const dry = command(['--dry-run', 'src'], root);

    expect(dry).toEqual({
      code: 0,
      out: ['Read 2 files of the program.', 'would rewrite src/lib/values.ts:1 PATTERN: RegExp', '1 rewrite in 1 file, 0 refused; dry run, nothing written.'],
      err: [],
    });
    expect(read(root, 'src/lib/values.ts')).toBe(source);

    const real = command(['src'], root);

    expect(real.code).toBe(0);
    expect(real.out).toEqual(['Read 2 files of the program.', 'rewrote src/lib/values.ts:1 PATTERN: RegExp', '1 rewrite in 1 file, 0 refused.']);
    expect(read(root, 'src/lib/values.ts')).toBe('export const PATTERN: RegExp = /^a/;\n');
  });

  it('answers 0 when it refuses an export, since a refusal is listed and not a failed run', () => {
    const root = plant({ 'src/lib/values.ts': 'export let COUNTS = [1, 2];\n' });

    const ran = command(['src'], root);

    expect(ran.code).toBe(0);
    expect(ran.out.at(-1)).toBe('0 rewrites in 0 files, 1 refused.');
  });

  it('answers 2 with the usage when no folder is named or a flag is unknown', () => {
    const root = plant({ 'src/lib/values.ts': 'export const PATTERN = /^a/;\n' });

    expect(command([], root)).toEqual({ code: 2, out: [], err: [USAGE] });
    expect(command(['--dry-run'], root)).toEqual({ code: 2, out: [], err: [USAGE] });
    expect(command(['--fix', 'src'], root)).toEqual({ code: 2, out: [], err: [USAGE] });
    expect(read(root, 'src/lib/values.ts')).toBe('export const PATTERN = /^a/;\n');
  });

  it('answers 2 for a folder that holds no file of the program, on disk or not', () => {
    const source = 'export const PATTERN = /^a/;\n';
    const root = plant({ 'src/lib/values.ts': source, 'packages/hub/values.ts': source });

    const absent = command(['nowhere'], root);
    const excluded = command(['src', 'packages/hub'], root);

    expect(absent.code).toBe(2);
    expect(absent.err).toEqual(['No file of the program is under nowhere: it does not exist or tsconfig.json excludes it, so nothing was read.']);
    expect(excluded.code).toBe(2);
    expect(excluded.err).toEqual(['No file of the program is under packages/hub: it does not exist or tsconfig.json excludes it, so nothing was read.']);
    expect(read(root, 'src/lib/values.ts')).toBe(source);
    expect(read(root, 'packages/hub/values.ts')).toBe(source);
  });

  it('answers 2 when the folder it runs from holds no tsconfig.json', () => {
    const root = plant({ 'src/lib/values.ts': 'export const PATTERN = /^a/;\n' });
    rmSync(join(root, 'tsconfig.json'));

    const ran = command(['src'], root);

    expect(ran.code).toBe(2);
    expect(ran.err).toEqual([`No tsconfig.json in ${root}: run the codemod from the folder that holds one.`]);
  });
});
