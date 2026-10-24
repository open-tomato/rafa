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
 *
 * A second `describe` emits the declarations of the build's two passes in
 * memory, core's (`packages/rafa/tsconfig.types.json`, which holds the
 * section files since the third decouple item, rafa-1325) and then
 * `tsconfig.config-types.json`'s over `src/config/index.ts`, and checks a
 * probe in a program that reads those `.d.ts` files and TypeScript's lib
 * alone: a consumer of the published subpath sees
 * `ConfigShape['hub']['url']` as `string`, and a key the hub namespace
 * lacks is refused there.
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
  'loop.worktreeSetup': 'bun install --frozen-lockfile',
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

/** The messages `program` reports for one of its files. */
function messagesOf(program: ts.Program, file: ts.SourceFile): string[] {
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map(
    (diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
  );
}

/** The messages `program` reports for one case. */
function diagnosticsOf(program: ts.Program, name: string): string[] {
  const file = program.getSourceFile(casePath(name));
  if (file === undefined) throw new Error(`not in program: ${name}`);
  return messagesOf(program, file);
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

/** Where the in-memory declarations are written: a path nothing on disk holds. */
const EMITTED = resolve(ROOT, '__emitted');

/**
 * The `paths` of `tsconfig.config-types.json`, each target under `dist/`
 * pointed at {@link EMITTED} instead: how the second pass, and a consumer
 * through the root's `exports`, reach the package's own subpaths.
 */
function emittedPaths(paths: ts.MapLike<string[]>): ts.MapLike<string[]> {
  return Object.fromEntries(Object.entries(paths).map(([key, targets]) => [
    key,
    targets.map((target) => resolve(EMITTED, target.replace(/^\.\/dist\//, ''))),
  ]));
}

/** A config file's options, its declarations written under {@link EMITTED} from `rootDir`. */
function parsePass(config: string, rootDir: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, config),
    { declarationDir: EMITTED, rootDir: resolve(ROOT, rootDir) },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error(`${config} did not parse`);
  return parsed;
}

/** A compiler host that reads `files` first and the disk after them. */
function overlayHost(options: ts.CompilerOptions, files: ReadonlyMap<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile, directoryExists } = host;
  host.fileExists = (path) => files.has(path) || fileExists.call(host, path);
  host.readFile = (path) => files.get(path) ?? readFile.call(host, path);
  host.getSourceFile = (path, language, ...rest) => {
    const text = files.get(path);
    return text === undefined
      ? getSourceFile.call(host, path, language, ...rest)
      : ts.createSourceFile(path, text, language);
  };
  host.directoryExists = (path) => [...files.keys()].some((file) => file.startsWith(`${path}/`))
    || (directoryExists?.call(host, path) ?? false);
  return host;
}

/** One pass's declarations, added to `emitted` by their path under {@link EMITTED}. */
function emitPass(program: ts.Program, emitted: Map<string, string>): void {
  const result = program.emit(undefined, (path, text) => emitted.set(path, text), undefined, true);
  if (result.emitSkipped) throw new Error('the declaration emit was skipped');
}

/**
 * The declarations the build's two passes emit, as the build runs them:
 * core's first, then `tsconfig.config-types.json`'s over
 * `src/config/index.ts`, reading the first pass's output where the build
 * reads `dist/`. Each is kept in memory by its path under {@link EMITTED}
 * rather than written.
 */
function emitDeclarations(): ReadonlyMap<string, string> {
  const emitted = new Map<string, string>();
  const core = parsePass('packages/rafa/tsconfig.types.json', 'packages/rafa/src');
  emitPass(ts.createProgram(core.fileNames, core.options), emitted);
  const config = parsePass('tsconfig.config-types.json', 'src');
  const options = { ...config.options, paths: emittedPaths(config.options.paths ?? {}) };
  emitPass(ts.createProgram([INDEX], options, overlayHost(options, emitted)), emitted);
  return emitted;
}

/** The second pass's own-subpath map over {@link EMITTED}, which the probe resolves through. */
const PROBE_PATHS = emittedPaths(parsePass('tsconfig.config-types.json', 'src').options.paths ?? {});

/**
 * A probe module beside the emitted `config/index.d.ts`, checked in a
 * program that reads the emitted declarations and TypeScript's own lib
 * files and nothing else: no source file, no `node_modules` package.
 */
function probeEmitted(emitted: ReadonlyMap<string, string>, source: string): ts.Program {
  const probe = resolve(EMITTED, 'config/__probe.ts');
  const files = new Map([...emitted, [probe, source]]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    types: [],
    paths: PROBE_PATHS,
  };
  const host = ts.createCompilerHost(options);
  const libDir = host.getDefaultLibLocation?.() ?? '';
  const { fileExists, readFile, getSourceFile } = host;
  const isLib = (path: string): boolean => libDir !== '' && path.startsWith(libDir);
  host.fileExists = (path) => files.has(path) || (isLib(path) && fileExists.call(host, path));
  host.readFile = (path) => files.get(path) ?? (isLib(path)
    ? readFile.call(host, path)
    : undefined);
  host.getSourceFile = (path, language, ...rest) => {
    const text = files.get(path);
    if (text !== undefined) return ts.createSourceFile(path, text, language);
    return isLib(path)
      ? getSourceFile.call(host, path, language, ...rest)
      : undefined;
  };
  host.directoryExists = (path) => isLib(path)
    || [...files.keys()].some((file) => file.startsWith(`${path}/`));
  return ts.createProgram([probe], options, host);
}

/** A probe naming the type at `ConfigShape['hub'][key]` as its exported `Probe` alias. */
function hubProbe(key: string): string {
  return `import type { ConfigShape } from './index.js';\n\nexport type Probe = ConfigShape['hub']['${key}'];\n`;
}

/** The probe's messages, and the type its exported `Probe` alias names. */
function readProbe(program: ts.Program): { readonly messages: string[]; readonly type: string } {
  const file = program.getSourceFile(resolve(EMITTED, 'config/__probe.ts'));
  if (file === undefined) throw new Error('the probe is not in its program');
  const messages = messagesOf(program, file);
  const checker = program.getTypeChecker();
  const alias = file.statements.find(ts.isTypeAliasDeclaration);
  if (alias === undefined) throw new Error('the probe declares no type alias');
  return { messages, type: checker.typeToString(checker.getTypeAtLocation(alias.name)) };
}

describe('the nested file shape in the emitted declarations', () => {
  let emitted: ReadonlyMap<string, string>;

  beforeAll(() => {
    emitted = emitDeclarations();
  }, 60_000);

  test('the emit writes the subpath\'s declaration and the hub section\'s, in memory', () => {
    expect(emitted.has(resolve(EMITTED, 'config/index.d.ts'))).toBe(true);
    expect(emitted.has(resolve(EMITTED, 'config-schema-hub.d.ts'))).toBe(true);
  });

  test('ConfigShape[\'hub\'][\'url\'] reads as string from the emitted files alone', () => {
    const probe = readProbe(probeEmitted(emitted, hubProbe('url')));
    expect(probe).toEqual({ messages: [], type: 'string' });
  });

  test('the control: a key the emitted hub namespace lacks is refused there', () => {
    const probe = readProbe(probeEmitted(emitted, hubProbe('urlX')));
    expect(probe.messages).toHaveLength(1);
    expect(probe.messages[0]).toContain('\'urlX\'');
  });
});
