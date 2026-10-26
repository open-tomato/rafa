/**
 * The three readings every facade test runs (#808, pass 2), each a
 * function with no process exit:
 *
 *   - export equality: {@link readFacadeExports} reads what a facade's
 *     `index.ts` exports, with the TypeScript checker over the root
 *     tsconfig's options, and {@link compareFacade} holds that list to the
 *     reading of `facade-names.ts`: a name missing, a name extra, and a
 *     name bound to another declaration;
 *   - the fresh-process load: {@link loadsFresh} imports a specifier in a
 *     new `bun` process, which runs no test preload, so an entry that only
 *     loads beside the suite's other modules is caught;
 *   - the workspace gates: {@link workspaceGates} runs the graph check and
 *     the references build from the root, the recipe of
 *     `src/tests/references-gate-spawned.test.ts`.
 *
 * The graph check and `tsc` are this repository's own, found from this
 * file's folder and never from the root they run over, so a planted root
 * runs the same tools as the live one. `tsc` is looked up as
 * `node_modules/.bin/tsc` in this folder and each folder above it, since a
 * worktree resolves its packages from the checkout that holds it.
 */

import type { FacadeNameKind, FacadeReading } from './facade-names';

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';

/** One name a facade entry exports, read off the declaration it resolves to. */
export interface FacadeExport {
  /** The name the entry exports. */
  readonly name: string;
  /** `value` when the declaration's symbol is a value, else `type`. */
  readonly kind: FacadeNameKind;
  /** The repository-relative file that declares it. */
  readonly declaredIn: string;
  /** The declaration's own name; differs from `name` for `default as x` of an `x` declared otherwise. */
  readonly declaredName: string;
  /** The declaration's start offset in `declaredIn`. */
  readonly position: number;
}

/** Where a name is declared and what it is, as both sides of a comparison read it. */
export interface FacadeBinding {
  readonly declaredIn: string;
  readonly kind: FacadeNameKind;
}

/** A name the reading and the entry both hold, bound to different declarations. */
export interface FacadeMisalignment {
  readonly name: string;
  /** The binding the reading asks for. */
  readonly expected: FacadeBinding;
  /** The binding the entry gives. */
  readonly actual: FacadeBinding;
}

/** How an entry's exports differ from a reading; all three empty when they match. */
export interface FacadeComparison {
  /** Names the reading has and the entry lacks, sorted. */
  readonly missing: readonly string[];
  /** Names the entry exports and no outside importer uses, sorted. */
  readonly extra: readonly string[];
  /** Names both hold whose declarations differ, sorted by name. */
  readonly misaligned: readonly FacadeMisalignment[];
}

/** What a fresh `bun` process said while importing one specifier. */
export interface FreshLoad {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Exit 0 and an empty stderr. */
  readonly green: boolean;
}

/** One gate run as a process. */
export interface GateRun {
  /** The command, as spawned. */
  readonly command: readonly string[];
  readonly exitCode: number;
  /** Whether the run was stopped at {@link SWEEP_TIMEOUT}. */
  readonly timedOut: boolean;
  /** Its stdout then its stderr, one entry per non-empty line. */
  readonly lines: readonly string[];
}

/** The two workspace gates over one root. */
export interface WorkspaceGates {
  /** `bun scripts/workspace/graph-check.ts`. */
  readonly graph: GateRun;
  /** `tsc --build tsconfig.references.json --pretty false`. */
  readonly references: GateRun;
}

/** This repository's graph check, run over whichever root the caller names. */
const GRAPH_CHECK = join(import.meta.dir, '..', 'workspace', 'graph-check.ts');

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @returns A negative, zero or positive number.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/** A file's path relative to the root, with `/`. */
function repoPath(root: string, fileName: string): string {
  return relative(root, fileName)
    .split(sep)
    .join('/');
}

/**
 * Reads the compiler options of a tsconfig.
 *
 * @throws When the config cannot be read or reports an error.
 */
function readCompilerOptions(root: string, tsconfig: string): ts.CompilerOptions {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, tsconfig), {}, host);
  if (parsed === undefined) {
    throw new Error(`${tsconfig}: the config could not be read`);
  }
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
    throw new Error(`${tsconfig}: ${messages.join('; ')}`);
  }
  return parsed.options;
}

/**
 * A declaration's own name: the identifier it declares, or for
 * `export default x` the name `x` refers to.
 */
function ownName(declaration: ts.Declaration, fallback: string): string {
  const name = ts.getNameOfDeclaration(declaration);
  if (name !== undefined && ts.isIdentifier(name)) {
    return name.text;
  }
  return ts.isExportAssignment(declaration) && ts.isIdentifier(declaration.expression)
    ? declaration.expression.text
    : fallback;
}

/**
 * Reads what a facade entry exports, each name resolved through its
 * aliases to the declaration it stands for.
 *
 * @param root - The repository root; the tsconfig and the paths answered
 *   are read relative to it.
 * @param entryPath - The entry, absolute or relative to the root
 *   (`packages/rafa-effort/index.ts`). It need not be in the tsconfig's
 *   files: the program is built with it as its one root file.
 * @param tsconfig - The tsconfig whose options the program takes, relative
 *   to the root; `tsconfig.json` by default.
 * @returns The exports, sorted by name, every path repository-relative
 *   with `/`.
 * @throws When the tsconfig cannot be read, the entry is not a module, or
 *   an export resolves to no declaration (a specifier that resolves to no
 *   file, or a name the file does not export).
 */
export function readFacadeExports(root: string, entryPath: string, tsconfig = 'tsconfig.json'): FacadeExport[] {
  const realRoot = realpathSync(root);
  const entry = resolve(realRoot, entryPath);
  const program = ts.createProgram([entry], readCompilerOptions(realRoot, tsconfig));
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(entry);
  const module = file === undefined
    ? undefined
    : checker.getSymbolAtLocation(file);
  if (module === undefined) {
    throw new Error(`${entryPath}: not a module the program holds`);
  }
  const exports = checker.getExportsOfModule(module).map((symbol): FacadeExport => {
    const target = symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
    const declaration = target.declarations?.[0];
    if (declaration === undefined) {
      throw new Error(`${entryPath}: the export ${symbol.getName()} resolves to no declaration`);
    }
    return {
      declaredIn: repoPath(realRoot, declaration.getSourceFile().fileName),
      declaredName: ownName(declaration, symbol.getName()),
      kind: (target.flags & ts.SymbolFlags.Value) === 0
        ? 'type'
        : 'value',
      name: symbol.getName(),
      position: declaration.getStart(),
    };
  });
  return exports.sort((left, right) => compareText(left.name, right.name));
}

/**
 * Holds an entry's exports to a reading. Pure.
 *
 * Two bindings differ when their declaring file or their kind differs:
 * the reading names a declaration by its file, and a facade that exports
 * a name of the right file under the wrong kind does not stand for it.
 *
 * @param reading - The reading of `readFacadeNames`.
 * @param exports - The entry's exports, as {@link readFacadeExports}
 *   answers them.
 * @returns The names missing, the names extra and the names misaligned,
 *   each sorted.
 */
export function compareFacade(reading: FacadeReading, exports: readonly FacadeExport[]): FacadeComparison {
  const exported = new Map(exports.map((item) => [item.name, item]));
  const read = new Set(reading.names.map((name) => name.name));
  const missing: string[] = [];
  const misaligned: FacadeMisalignment[] = [];
  for (const name of reading.names) {
    const found = exported.get(name.name);
    if (found === undefined) {
      missing.push(name.name);
    } else if (found.declaredIn !== name.declaredIn || found.kind !== name.kind) {
      misaligned.push({
        actual: { declaredIn: found.declaredIn, kind: found.kind },
        expected: { declaredIn: name.declaredIn, kind: name.kind },
        name: name.name,
      });
    }
  }
  const extra = exports.map((item) => item.name).filter((name) => !read.has(name));
  return {
    extra: extra.sort(compareText),
    misaligned: misaligned.sort((left, right) => compareText(left.name, right.name)),
    missing: missing.sort(compareText),
  };
}

/**
 * Imports a specifier in a fresh `bun` process, which loads no test
 * preload and no module the caller holds.
 *
 * @param specifier - What `import()` is given: an absolute path, or a
 *   package name resolved from `cwd`.
 * @param cwd - The folder the process runs in.
 * @returns The exit code and both outputs; `green` is exit 0 with an
 *   empty stderr. A run stopped at {@link SWEEP_TIMEOUT} is not green.
 */
export function loadsFresh(specifier: string, cwd: string): FreshLoad {
  const run = Bun.spawnSync([process.execPath, '-e', `await import(${JSON.stringify(specifier)})`], {
    cwd,
    timeout: SWEEP_TIMEOUT,
  });
  const stderr = run.stderr.toString();
  return {
    exitCode: run.exitCode,
    green: run.exitCode === 0 && stderr === '' && run.exitedDueToTimeout !== true,
    stderr,
    stdout: run.stdout.toString(),
  };
}

/**
 * Finds `node_modules/.bin/tsc` in a folder or the nearest folder above it.
 *
 * @param from - The folder the walk starts in.
 * @returns The absolute path of `tsc`.
 * @throws When no folder up to the filesystem root holds one.
 */
export function findTsc(from: string): string {
  let folder = resolve(from);
  for (;;) {
    const candidate = join(folder, 'node_modules', '.bin', 'tsc');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(folder);
    if (parent === folder) {
      throw new Error(`no node_modules/.bin/tsc in ${from} or any folder above it`);
    }
    folder = parent;
  }
}

/** Runs one gate from the root and reads its lines. */
function runGate(command: readonly string[], cwd: string): GateRun {
  const run = Bun.spawnSync([...command], { cwd, timeout: SWEEP_TIMEOUT });
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  return {
    command,
    exitCode: run.exitCode,
    lines: output.split('\n').filter((line) => line.trim() !== ''),
    timedOut: run.exitedDueToTimeout === true,
  };
}

/**
 * Runs the graph check and the references build from a root, each under
 * {@link SWEEP_TIMEOUT}.
 *
 * @param root - The repository root both run from.
 * @returns Each gate's command, exit code and output lines; both green is
 *   exit 0 for each.
 * @throws When this repository holds no `tsc` (see {@link findTsc}).
 */
export function workspaceGates(root: string): WorkspaceGates {
  const tsc = findTsc(import.meta.dir);
  return {
    graph: runGate([process.execPath, GRAPH_CHECK], root),
    references: runGate([tsc, '--build', 'tsconfig.references.json', '--pretty', 'false'], root),
  };
}
