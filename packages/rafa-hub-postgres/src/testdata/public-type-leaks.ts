/**
 * What the public types of an entry file name: every export of it followed
 * through each type its declaration names, for `../public-types.test.ts`.
 *
 * The reading is made over declarations, not sources: a first program
 * emits the `.d.ts` text of every source file in memory, and a second
 * program reads that text in the source's place. A function body naming a
 * type is then no part of the reading. The repository's
 * `isolatedDeclarations` has every exported type written out, so none is
 * left to infer; an export without one fails the emit, and the reading
 * throws.
 *
 * Each name a declaration holds is resolved to what declares it. A
 * declaration of Drizzle's packages or of `bun-types`' `sql.d.ts` is a
 * leak; one of the repository is followed in turn, as are the deprecated
 * aliases `bun-types` keeps beside; any other (TypeScript's own library,
 * another package) is left there, its type arguments being names of the
 * declaration that holds them. A name that resolves to nothing throws, so
 * an import the program cannot read never passes as clean.
 */
import ts from 'typescript';

/** The library a leaked type comes from. */
export type LeakedLibrary = 'drizzle' | 'Bun.sql';

/** One name of a banned declaration an export reaches. */
export interface TypeLeak {
  /** The export of the entry whose types reach the name. */
  readonly exportName: string;
  /** The banned declaration's name. */
  readonly typeName: string;
  readonly library: LeakedLibrary;
}

/** What one entry file's exports name. */
export interface PublicTypeReading {
  /** The entry's export names, sorted. */
  readonly exports: readonly string[];
  /** The names of the declarations followed, sorted and distinct. */
  readonly reached: readonly string[];
  readonly leaks: readonly TypeLeak[];
}

/** The path parts that mark a declaration file as one of a banned library. */
const BANNED: readonly { readonly part: RegExp; readonly library: LeakedLibrary }[] = [
  { part: /\/node_modules\/drizzle-(?:orm|kit)\//, library: 'drizzle' },
  { part: /\/bun-types\/sql\.d\.ts$/, library: 'Bun.sql' },
];

/** Files outside the repository that only alias banned types, so are followed. */
const FOLLOWED_OUTSIDE = /\/bun-types\/deprecated\.d\.ts$/;

/** The name a node refers to another declaration by, if it does. */
function referencedName(node: ts.Node): ts.Node | undefined {
  if (ts.isTypeReferenceNode(node)) return node.typeName;
  if (ts.isExpressionWithTypeArguments(node)) return node.expression;
  if (ts.isTypeQueryNode(node)) return node.exprName;
  if (ts.isComputedPropertyName(node)) return node.expression;
  if (ts.isImportTypeNode(node)) {
    if (node.qualifier !== undefined) return node.qualifier;
    return ts.isLiteralTypeNode(node.argument)
      ? node.argument.literal
      : node.argument;
  }
  return undefined;
}

/** Whether a class member is private, so no part of the public type. */
function isPrivateMember(node: ts.Node): boolean {
  if (!ts.isClassElement(node)) return false;
  const isPrivateName = node.name !== undefined && ts.isPrivateIdentifier(node.name);
  return isPrivateName || (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private) !== 0;
}

/** Follows one export, collecting what it reaches into `reached` and `leaks`. */
function followExport(
  program: ts.Program,
  root: ts.Symbol,
  reached: Set<string>,
  leaks: TypeLeak[],
): void {
  const checker = program.getTypeChecker();
  const visited = new Set<ts.Node>();

  const follow = (symbol: ts.Symbol): void => {
    const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
    const declarations = target.declarations ?? [];
    if (declarations.length === 0) {
      throw new Error(`public types: "${symbol.name}", reached from ${root.name}, resolves to no declaration`);
    }
    for (const declaration of declarations) enter(target, declaration);
  };

  const enter = (symbol: ts.Symbol, declaration: ts.Declaration): void => {
    if (visited.has(declaration)) return;
    visited.add(declaration);
    const source = declaration.getSourceFile();
    const banned = BANNED.find(({ part }) => part.test(source.fileName));
    if (banned !== undefined) {
      leaks.push({ exportName: root.name, typeName: symbol.name, library: banned.library });
      return;
    }
    const outside = program.isSourceFileDefaultLibrary(source) || source.fileName.includes('/node_modules/');
    if (outside && !FOLLOWED_OUTSIDE.test(source.fileName)) return;
    // A whole module, as `export * as name` and `typeof import()` name one.
    if (ts.isSourceFile(declaration)) {
      checker.getExportsOfModule(symbol).forEach(follow);
      return;
    }
    reached.add(symbol.name);
    walk(declaration);
  };

  const walk = (node: ts.Node): void => {
    if (isPrivateMember(node)) return;
    const name = referencedName(node);
    // `as const` is no reference, and `globalThis` has no declaration.
    if (name !== undefined && !['const', 'globalThis'].includes(name.getText())) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol === undefined) {
        throw new Error(`public types: "${name.getText()}", reached from ${root.name}, does not resolve`);
      }
      follow(symbol);
    }
    ts.forEachChild(node, walk);
  };

  follow(root);
}

/** The compiler options of `tsconfig`, set to emit declarations in memory. */
function declarationOptions(tsconfig: string): ts.CompilerOptions {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error(`public types: ${tsconfig} did not parse`);
  return {
    ...parsed.options,
    composite: false,
    incremental: false,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    outDir: undefined,
    rootDir: undefined,
    tsBuildInfoFile: undefined,
  };
}

/** The `.d.ts` text of every source file of `program`, by the source's path; nothing is written to disk. */
function declarationTexts(program: ts.Program): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  const result = program.emit(undefined, (_path, text, _bom, _onError, sources) => {
    for (const source of sources ?? []) texts.set(source.fileName, text);
  }, undefined, true);
  if (result.diagnostics.length > 0) {
    const messages = result.diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    throw new Error(`public types: the declarations did not emit: ${messages.join('; ')}`);
  }
  return texts;
}

/** A program over `files` in which each source file reads as its declarations. */
function declarationProgram(files: readonly string[], options: ts.CompilerOptions): ts.Program {
  const texts = declarationTexts(ts.createProgram([...files], options));
  const host = ts.createCompilerHost(options, true);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language, onError, createNew) => {
    const text = texts.get(fileName);
    return text === undefined
      ? readSource(fileName, language, onError, createNew)
      : ts.createSourceFile(fileName, text, language, true);
  };
  return ts.createProgram([...files], options, host);
}

/** What the exports of `file` name, read in `program`. */
function readEntry(program: ts.Program, file: string): PublicTypeReading {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) throw new Error(`public types: ${file} is no module of the program`);
  const exported = checker.getExportsOfModule(moduleSymbol);
  const reached = new Set<string>();
  const leaks: TypeLeak[] = [];
  for (const symbol of exported) followExport(program, symbol, reached, leaks);
  return {
    exports: exported.map((symbol) => symbol.name).sort(),
    reached: [...reached].sort(),
    leaks,
  };
}

/**
 * Reads the public types of each of `files` under the compiler options of
 * `tsconfig`.
 *
 * @returns Each file's reading, by the path given.
 * @throws When the config does not parse, a declaration does not emit, a
 * file is no module or a name resolves to nothing.
 */
export function readPublicTypes(tsconfig: string, files: readonly string[]): ReadonlyMap<string, PublicTypeReading> {
  const program = declarationProgram(files, declarationOptions(tsconfig));
  return new Map(files.map((file) => [file, readEntry(program, file)]));
}
