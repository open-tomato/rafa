/**
 * Holds the nested file shape to the registry, through the TypeScript
 * checker as `src/tests/entry-exports.test.ts` reads names: every leaf of
 * `ConfigShape` is a setting's file key and every setting's file key is a
 * leaf, and a nested object holding every setting type-checks against
 * `ConfigEntry`. It also holds `ConfigEntry`'s two merge forms, `false`
 * at a map id and `$replace` on a mapping, and the cases each refuses.
 *
 * One program serves every case, since building it type-checks all the
 * registry reaches: each case is a source file kept in memory beside
 * `src/config/index.ts`, importing it as a config module would, and is
 * read by its own diagnostics. Each refusal is a control: it proves the
 * acceptance beside it could have failed.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'bun:test';
import ts from 'typescript';

import { CONFIG_DEFAULTS, SETTING_NAMES, SETTINGS } from '../config-registry.js';

import { defaults } from './index.js';

const ROOT = resolve(import.meta.dir, '../..');

const INDEX = resolve(ROOT, 'src/config/index.ts');

/** A value its reader accepts, for each setting whose default is null and so absent from `defaults`. */
const SAMPLES: Readonly<Record<string, unknown>> = {
  'hub.url': 'https://hub.example.org',
  'hub.tokenSecret': 'rafa-hub-token',
  'pr.provider': 'gh',
  'pr.base': 'main',
  'board.project.number': 6,
  'roadmap.issue': 1,
};

/** The value at a dotted key of a nested object, or undefined. */
function valueAt(entry: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (at, segment) => typeof at === 'object' && at !== null
      ? (at as Record<string, unknown>)[segment]
      : undefined,
    entry,
  );
}

/** `pairs` as one nested object, dotted keys split. */
function nested(pairs: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    const path = key.split('.');
    const last = path.pop() ?? key;
    const parent = path.reduce<Record<string, unknown>>((at, segment) => {
      const next = (at[segment] ?? {}) as Record<string, unknown>;
      at[segment] = next;
      return next;
    }, root);
    parent[last] = value;
  }
  return root;
}

/** Every setting's file key with a value its reader accepts: its default as `defaults` spells it, or its sample. */
const EVERY_SETTING: readonly (readonly [string, unknown])[] = SETTING_NAMES.map((setting) => {
  const key = SETTINGS[setting].key;
  return [key, SAMPLES[key] ?? valueAt(defaults, key)] as const;
});

/** The deepest setting key, with its last segment misspelt: the control of the every-setting case. */
const MISSPELT = (() => {
  const deepest = [...EVERY_SETTING].sort(([a], [b]) => b.split('.').length - a.split('.').length)[0]![0];
  return `${deepest}X`;
})();

/** One case: a module importing the subpath, and whether it type-checks. */
interface Case {
  readonly name: string;
  readonly source: string;
}

/** A case declaring `value` as one `ConfigEntry`. */
function entryCase(name: string, value: string): Case {
  return {
    name,
    source: `import type { ConfigEntry } from './index.js';\n\nexport const entry: ConfigEntry = ${value};\n`,
  };
}

const ACCEPTED: readonly Case[] = [
  entryCase('every-setting', JSON.stringify(nested(EVERY_SETTING), null, 2)),
  entryCase('empty', '{}'),
  entryCase('naming-branch', '{ naming: { branch: \'work/{stub}\' } }'),
  entryCase('false-at-map-id', '{ logger: { modules: { board: false } }, tiers: { agents: { reviewer: false } } }'),
  entryCase('replace-on-map', '{ routing: { $replace: true, tests: \'tdd-guide\' } }'),
  entryCase('replace-on-namespace', '{ loop: { $replace: true, retries: 2 } }'),
  entryCase('false-as-value', '{ loop: { retries: false }, routing: { tests: false } }'),
  {
    name: 'define-config',
    source: [
      'import type { Config } from \'./index.js\';',
      '',
      'import { defaults, defineConfig } from \'./index.js\';',
      '',
      'export const viaDefine: Config = defineConfig([defaults, { naming: { branch: \'work/{stub}\' } }]);',
      'export const viaSatisfies = [{ pr: { base: \'main\' } }] satisfies Config;',
      '',
    ].join('\n'),
  },
];

/** A case `ConfigEntry` refuses, and a fragment of the refusal that names why. */
interface Refusal extends Case {
  readonly because: string;
}

/** `entryCase`, with the fragment its refusal holds. */
function refusedCase(name: string, value: string, because: string): Refusal {
  return { ...entryCase(name, value), because };
}

const REFUSED: readonly Refusal[] = [
  refusedCase('every-setting-misspelt', JSON.stringify(nested([
    ...EVERY_SETTING.filter(([key]) => `${key}X` !== MISSPELT),
    [MISSPELT, valueAt(defaults, MISSPELT.slice(0, -1))],
  ]), null, 2), `'"${MISSPELT.split('.').pop()}"' does not exist`),
  refusedCase('unknown-key', '{ plan: { injec: \'stage\' } }', '\'injec\' does not exist'),
  refusedCase('wrong-value', '{ store: \'mysql\' }', 'Type \'"mysql"\' is not assignable'),
  refusedCase('false-at-named-key', '{ plan: { inject: false } }', 'Type \'false\' is not assignable'),
  refusedCase('replace-on-scalar', '{ plan: { inject: { $replace: true } } }', 'Type \'{ $replace: true; }\' is not assignable'),
  refusedCase('replace-on-list', '{ tracker: { fallback: { $replace: true } } }', '\'$replace\' does not exist'),
  refusedCase('replace-not-true', '{ loop: { $replace: false, retries: 2 } }', 'Type \'false\' is not assignable to type \'true\''),
  refusedCase('true-at-map-id', '{ logger: { modules: { board: true } } }', 'Type \'true\''),
  {
    name: 'define-config-misspelt',
    source: 'import { defineConfig } from \'./index.js\';\n\nexport const config = defineConfig([{ naming: { brunch: \'x\' } }]);\n',
    because: '\'brunch\' does not exist',
  },
];

/** A case's path: a file beside the subpath's index, so `./index.js` resolves as it would there. */
function casePath(name: string): string {
  return resolve(ROOT, `src/config/__case-${name}.ts`);
}

/** The program over the subpath and every case, built once. */
function buildProgram(cases: readonly Case[]): ts.Program {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error('tsconfig.json did not parse');
  const sources = new Map(cases.map((one) => [casePath(one.name), one.source]));
  const host = ts.createCompilerHost(parsed.options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (path) => sources.has(path) || fileExists.call(host, path);
  host.readFile = (path) => sources.get(path) ?? readFile.call(host, path);
  host.getSourceFile = (path, language, ...rest) => {
    const text = sources.get(path);
    return text === undefined
      ? getSourceFile.call(host, path, language, ...rest)
      : ts.createSourceFile(path, text, language);
  };
  return ts.createProgram([INDEX, ...sources.keys()], parsed.options, host);
}

/** The messages `program` reports for one case. */
function diagnosticsOf(program: ts.Program, name: string): string[] {
  const file = program.getSourceFile(casePath(name));
  if (file === undefined) throw new Error(`not in program: ${name}`);
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map(
    (diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
  );
}

/** True when `type` is a namespace of the shape: a mapping with named keys alone, no list and no keyed map. */
function isNamespace(checker: ts.TypeChecker, type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Object) !== 0
    && !checker.isArrayType(type)
    && !checker.isTupleType(type)
    && checker.getIndexInfosOfType(type).length === 0
    && type.getCallSignatures().length === 0
    && checker.getPropertiesOfType(type).length > 0;
}

/** Every leaf of `ConfigShape`, dotted, read off the program's checker. */
function shapeLeaves(program: ts.Program): string[] {
  const checker = program.getTypeChecker();
  const index = program.getSourceFile(INDEX);
  if (index === undefined) throw new Error('src/config/index.ts is not in the program');
  const module = checker.getSymbolAtLocation(index);
  if (module === undefined) throw new Error('src/config/index.ts is not a module');
  const exported = checker.getExportsOfModule(module).find((symbol) => symbol.name === 'ConfigShape');
  if (exported === undefined) throw new Error('src/config/index.ts exports no ConfigShape');
  const declared = (exported.flags & ts.SymbolFlags.Alias) === 0
    ? exported
    : checker.getAliasedSymbol(exported);
  const walk = (type: ts.Type, above: string): string[] => checker.getPropertiesOfType(type).flatMap((property) => {
    const key = above === ''
      ? property.name
      : `${above}.${property.name}`;
    const value = checker.getTypeOfSymbol(property);
    return isNamespace(checker, value)
      ? walk(value, key)
      : [key];
  });
  return walk(checker.getDeclaredTypeOfSymbol(declared), '').sort();
}

describe('the nested file shape against the registry', () => {
  let program: ts.Program;
  const settingKeys = SETTING_NAMES.map((setting) => SETTINGS[setting].key);

  beforeAll(() => {
    program = buildProgram([...ACCEPTED, ...REFUSED]);
  }, 60_000);

  test('every leaf of ConfigShape is a setting\'s file key, and every setting\'s file key is a leaf', () => {
    const leaves = shapeLeaves(program);
    expect(leaves).toContain('board.project.writePauseMs');
    expect(leaves).toContain('routing');
    expect(leaves).toContain('naming.branch');
    expect(leaves).toEqual([...settingKeys].sort());
  });

  test('each setting whose default is null has a sample, and its reader accepts it', () => {
    const nullDefaults = SETTING_NAMES.filter((setting) => CONFIG_DEFAULTS[setting] === null);
    expect(nullDefaults.map((setting) => SETTINGS[setting].key).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const setting of nullDefaults) {
      const { key, read } = SETTINGS[setting];
      expect({ key, problems: read(SAMPLES[key], { label: key, key }).problems }).toEqual({ key, problems: [] });
    }
  });

  test('the misspelt control renames a key the every-setting case holds', () => {
    expect(settingKeys).toContain(MISSPELT.slice(0, -1));
    expect(settingKeys).not.toContain(MISSPELT);
  });

  for (const { name } of ACCEPTED) {
    test(`ConfigEntry accepts the ${name} case`, () => {
      expect(diagnosticsOf(program, name)).toEqual([]);
    });
  }

  for (const { name, because } of REFUSED) {
    test(`ConfigEntry refuses the ${name} case`, () => {
      const messages = diagnosticsOf(program, name);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(because);
    });
  }
});
