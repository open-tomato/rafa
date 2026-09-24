#!/usr/bin/env bun
/**
 * ts-symbols — TypeScript symbol queries for shell-only agents.
 *
 * Commands (positions are 1-based):
 *   ts-symbols outline <file>              exported + top-level symbols (one level of members)
 *   ts-symbols def     <file>:<line>:<col> definition location(s) of the symbol at a position
 *   ts-symbols refs    <file>:<line>:<col> references across the nearest tsconfig project
 *   ts-symbols type    <file>:<line>:<col> resolved type at a position (--full expands aliases)
 *
 * Flags: --json (structured output), --full (type: no-truncation expansion)
 * Exit codes: 0 results, 1 usage/error, 2 valid query but no results,
 * 3 no `typescript` package under the project root.
 *
 * The `typescript` package is the project's own, found from the project root
 * (the working directory) the way `tsc` is: see {@link loadTypeScript}.
 */
import type TypeScript from 'typescript';

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const USAGE = `usage: ts-symbols <command> <target> [--json]
  outline <file>               exported + top-level symbols with kinds and lines
  def     <file>:<line>:<col>  definition location of the symbol at position (1-based)
  refs    <file>:<line>:<col>  references across the nearest tsconfig project
  type    <file>:<line>:<col>  resolved type text at position (--full to expand)`;

const COMMANDS = new Set(['outline', 'def', 'refs', 'type']);

/** Exit code when the project root has no `typescript` package to load. */
const NO_TYPESCRIPT_EXIT = 3;

function fail(msg: string): never {
  console.error(`ts-symbols: ${msg}`);
  process.exit(1);
}

function noResults(msg: string): never {
  console.error(`ts-symbols: ${msg}`);
  process.exit(2);
}

interface Request {
  command: string;
  rawTarget: string;
  json: boolean;
  full: boolean;
}

/**
 * Read the command line, answering `help`, a missing target and an unknown
 * command here, so none of them needs a `typescript` package to be present.
 */
function readRequest(argv: string[]): Request {
  const json = argv.includes('--json');
  const full = argv.includes('--full');
  const args = argv.filter((a) => !a.startsWith('--'));
  const [command, rawTarget] = args;

  if (!command || command === 'help') {
    console.log(USAGE);
    process.exit(command
      ? 0
      : 1);
  }
  if (!rawTarget) fail(`missing target\n${USAGE}`);
  if (!COMMANDS.has(command)) fail(`unknown command "${command}"\n${USAGE}`);
  return { command, rawTarget, json, full };
}

/**
 * The nearest `node_modules/typescript` at or above `dir`, the directory
 * Node's resolution would settle on for a bare `typescript` from `dir`.
 */
function typescriptDirectory(dir: string): string | undefined {
  const candidate = path.join(dir, 'node_modules', 'typescript');
  if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  const parent = path.dirname(dir);
  return parent === dir
    ? undefined
    : typescriptDirectory(parent);
}

/**
 * Load the `typescript` package the project at `root` compiles with, or exit
 * 3 naming `root` when there is none.
 *
 * The walk is by hand, not a bare `import 'typescript'`: built into rafa's
 * `dist/bundled/bin/`, a bare specifier resolves from this file and so finds
 * rafa's own copy instead of the project's. Nor does it go through bun's
 * resolver (`createRequire(root)`): where no `node_modules` sits above `root`,
 * bun auto-installs, and in an empty temp directory it answered
 * `typescript@7.0.2` from `~/.bun/install/cache`. Requiring the absolute
 * directory found here installs nothing.
 */
function loadTypeScript(root: string): typeof TypeScript {
  const directory = typescriptDirectory(root);
  if (!directory) {
    console.error(`ts-symbols: no typescript under ${root}: add it to the project`);
    process.exit(NO_TYPESCRIPT_EXIT);
  }
  return createRequire(import.meta.url)(directory) as typeof TypeScript;
}

// Both run before anything below reads `ts`: a usage error is answered
// without a `typescript` package, and every later use finds `ts` loaded.
const request = readRequest(process.argv.slice(2));
const ts = loadTypeScript(process.cwd());

interface Target {
  file: string;
  line: number;
  col: number;
}

function parseTarget(raw: string): Target {
  const m = /^(.+):(\d+):(\d+)$/.exec(raw);
  if (!m || m[1] === undefined) fail(`expected <file>:<line>:<col> (1-based), got "${raw}"`);
  const file = path.resolve(m[1]);
  if (!ts.sys.fileExists(file)) fail(`file not found: ${file}`);
  return { file, line: Number(m[2]), col: Number(m[3]) };
}

function relPath(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..')
    ? file
    : rel;
}

// Fallback options when no tsconfig.json exists above the target file.
const LOOSE_OPTIONS: TypeScript.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

interface Project {
  service: TypeScript.LanguageService;
  configPath: string | undefined;
}

/**
 * Build a language service over the nearest tsconfig project. singleFile skips
 * config discovery (enough for syntax-only work like outline).
 */
function createProject(absFile: string, singleFile: boolean): Project {
  let configPath: string | undefined;
  let rootNames = [absFile];
  let options = LOOSE_OPTIONS;
  let projectDir = path.dirname(absFile);

  if (!singleFile) {
    configPath = ts.findConfigFile(path.dirname(absFile), ts.sys.fileExists, 'tsconfig.json');
    if (configPath) {
      projectDir = path.dirname(configPath);
      const jsonFile = ts.readJsonConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonSourceFileConfigFileContent(jsonFile, ts.sys, projectDir);
      options = parsed.options;
      rootNames = parsed.fileNames.slice();
      // The target may be excluded (e.g. tests excluded from type-gating) —
      // add it so the service can always answer for it.
      if (!rootNames.some((f) => path.resolve(f) === absFile)) rootNames.push(absFile);
    }
  }

  const host: TypeScript.LanguageServiceHost = {
    getScriptFileNames: () => rootNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: (file) => {
      const text = ts.sys.readFile(file);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => projectDir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return { service: ts.createLanguageService(host, ts.createDocumentRegistry()), configPath };
}

function sourceFileOf(project: Project, file: string): TypeScript.SourceFile {
  const program = project.service.getProgram();
  const fromProgram = program?.getSourceFile(file);
  if (fromProgram) return fromProgram;
  const text = ts.sys.readFile(file) ?? '';
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function offsetOf(sf: TypeScript.SourceFile, target: Target): number {
  try {
    return sf.getPositionOfLineAndCharacter(target.line - 1, target.col - 1);
  } catch {
    return fail(`position ${target.line}:${target.col} is outside ${relPath(target.file)}`);
  }
}

interface Loc {
  file: string;
  line: number;
  col: number;
  lineText: string;
}

function locOf(project: Project, file: string, start: number): Loc {
  const sf = sourceFileOf(project, file);
  const lc = sf.getLineAndCharacterOfPosition(start);
  const starts = sf.getLineStarts();
  const end = lc.line + 1 < starts.length
    ? starts[lc.line + 1]
    : sf.text.length;
  return {
    file,
    line: lc.line + 1,
    col: lc.character + 1,
    lineText: sf.text.slice(starts[lc.line], end).trim(),
  };
}

// ---------------------------------------------------------------- outline ---

interface OutlineItem {
  name: string;
  kind: string;
  line: number;
  col: number;
  exported: boolean;
  children?: OutlineItem[];
}

// Kinds whose members are worth listing; function/const children are object
// literals and closures — noise at outline granularity.
const CONTAINER_KINDS = new Set<string>(['class', 'interface', 'enum', 'module', 'type']);

function navToOutline(sf: TypeScript.SourceFile, node: TypeScript.NavigationTree, depth: number): OutlineItem {
  const span = node.nameSpan ?? node.spans[0];
  if (!span) fail(`no source span for symbol "${node.text}"`);
  const lc = sf.getLineAndCharacterOfPosition(span.start);
  const item: OutlineItem = {
    name: node.text,
    kind: node.kind,
    line: lc.line + 1,
    col: lc.character + 1,
    exported: node.kindModifiers.split(',').includes('export'),
  };
  if (depth > 0 && node.childItems?.length && CONTAINER_KINDS.has(node.kind)) {
    item.children = node.childItems
      .map((c) => navToOutline(sf, c, depth - 1))
      .sort((a, b) => a.line - b.line || a.col - b.col);
  }
  return item;
}

function printOutline(items: OutlineItem[], indent: string): void {
  for (const item of items) {
    const marker = item.exported
      ? 'export '
      : '';
    console.log(`${item.line}: ${indent}${marker}${item.kind} ${item.name}`);
    if (item.children) printOutline(item.children, indent + '  ');
  }
}

function cmdOutline(rawFile: string, json: boolean): void {
  const absFile = path.resolve(rawFile);
  if (!ts.sys.fileExists(absFile)) fail(`file not found: ${absFile}`);
  const project = createProject(absFile, true);
  const tree = project.service.getNavigationTree(absFile);
  const sf = sourceFileOf(project, absFile);
  const items = (tree.childItems ?? [])
    .filter((c) => c.kind !== ts.ScriptElementKind.alias) // skip import aliases
    .map((c) => navToOutline(sf, c, 1))
    .sort((a, b) => a.line - b.line || a.col - b.col);
  if (json) {
    console.log(JSON.stringify({ file: relPath(absFile), symbols: items }, null, 2));
    return;
  }
  if (items.length === 0) noResults(`no top-level symbols in ${relPath(absFile)}`);
  printOutline(items, '');
}

// -------------------------------------------------------------------- def ---

function cmdDef(target: Target, json: boolean): void {
  const project = createProject(target.file, false);
  const pos = offsetOf(sourceFileOf(project, target.file), target);
  const defs = project.service.getDefinitionAtPosition(target.file, pos) ?? [];
  if (defs.length === 0) noResults(`no definition found at ${relPath(target.file)}:${target.line}:${target.col}`);
  const rows = defs.map((d) => {
    const loc = locOf(project, d.fileName, d.textSpan.start);
    return { file: relPath(d.fileName), line: loc.line, col: loc.col, kind: d.kind, name: d.name, lineText: loc.lineText };
  });
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) console.log(`${r.file}:${r.line}:${r.col} ${r.kind} ${r.name} — ${r.lineText}`);
}

// ------------------------------------------------------------------- refs ---

function cmdRefs(target: Target, json: boolean): void {
  const project = createProject(target.file, false);
  const pos = offsetOf(sourceFileOf(project, target.file), target);
  const refs = project.service.getReferencesAtPosition(target.file, pos) ?? [];
  if (refs.length === 0) noResults(`no references found at ${relPath(target.file)}:${target.line}:${target.col}`);
  // isDefinition is unreliable from this API — mark defs by matching the
  // definition spans instead.
  const defSpans = new Set(
    (project.service.getDefinitionAtPosition(target.file, pos) ?? []).map((d) => `${d.fileName}:${d.textSpan.start}`),
  );
  const rows = refs
    .map((r) => {
      const loc = locOf(project, r.fileName, r.textSpan.start);
      const role = defSpans.has(`${r.fileName}:${r.textSpan.start}`)
        ? 'def'
        : r.isWriteAccess
          ? 'write'
          : 'use';
      return { file: relPath(r.fileName), line: loc.line, col: loc.col, role, lineText: loc.lineText };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) console.log(`${r.file}:${r.line}:${r.col} [${r.role}] ${r.lineText}`);
  console.error(`ts-symbols: ${rows.length} reference(s)${project.configPath
    ? ` in project ${relPath(project.configPath)}`
    : ' (no tsconfig found — searched target file and its imports only)'}`);
}

// ------------------------------------------------------------------- type ---

function tokenAt(sf: TypeScript.SourceFile, pos: number): TypeScript.Node {
  function descend(node: TypeScript.Node): TypeScript.Node {
    for (const child of node.getChildren(sf)) {
      if (pos >= child.getStart(sf) && pos < child.getEnd()) return descend(child);
    }
    return node;
  }
  return descend(sf);
}

function cmdType(target: Target, json: boolean, full: boolean): void {
  const project = createProject(target.file, false);
  const sf = sourceFileOf(project, target.file);
  const pos = offsetOf(sf, target);
  const info = project.service.getQuickInfoAtPosition(target.file, pos);
  if (!info) noResults(`no symbol at ${relPath(target.file)}:${target.line}:${target.col}`);

  const declared = ts.displayPartsToString(info.displayParts);
  const docs = ts.displayPartsToString(info.documentation ?? []);
  let expanded: string | undefined;
  if (full) {
    const program = project.service.getProgram();
    const checker = program?.getTypeChecker();
    if (checker) {
      const node = tokenAt(sf, pos);
      const type = checker.getTypeAtLocation(node);
      expanded = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
    }
  }
  if (json) {
    console.log(JSON.stringify({ kind: info.kind, declared, expanded, documentation: docs || undefined }, null, 2));
    return;
  }
  console.log(declared);
  if (expanded && expanded !== declared) console.log(`expanded: ${expanded}`);
  if (docs) console.log(`doc: ${docs.split('\n')[0]}`);
}

// ------------------------------------------------------------------- main ---

function main({ command, rawTarget, json, full }: Request): void {
  switch (command) {
    case 'outline':
      return cmdOutline(rawTarget, json);
    case 'def':
      return cmdDef(parseTarget(rawTarget), json);
    case 'refs':
      return cmdRefs(parseTarget(rawTarget), json);
    case 'type':
      return cmdType(parseTarget(rawTarget), json, full);
    default:
      fail(`unknown command "${command}"\n${USAGE}`);
  }
}

main(request);
