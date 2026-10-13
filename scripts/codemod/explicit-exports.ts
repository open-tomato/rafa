/**
 * The explicit-exports codemod: writes the type annotations that
 * `isolatedDeclarations` asks for, from the types `tsc` infers.
 *
 * Usage, from the folder that holds `tsconfig.json`:
 *
 *   bun scripts/codemod/explicit-exports.ts <folder>…
 *   bun scripts/codemod/explicit-exports.ts --dry-run <folder>…
 *
 * Inside a workspace package the folder that holds `tsconfig.json` is
 * the package, so the script is named from there:
 * `bun ../../scripts/codemod/explicit-exports.ts src`.
 *
 * ## What it reads
 *
 * One program built from that `tsconfig.json`, with `declaration` and
 * `isolatedDeclarations` switched on over it. The compiler then names
 * every export it cannot write a declaration for with a TS90xx error,
 * and the checker of the same program prints the type each one has. So
 * a printed type is the one `tsc` infers, and never a guess from the
 * text. Only files of the program are read: a folder `tsconfig.json`
 * excludes holds none, and the run stops on it instead of reporting
 * that it had nothing to change.
 *
 * ## The two rewrites
 *
 * The default-export rewrite is for TS9037 in a file under a `commands`
 * folder. `export default <expr>;` becomes
 * `const command: RafaCommand = <expr>;` and `export default command;`.
 * When the file does not import `RafaCommand`, one `import type` line
 * for it is added, from the command barrel ({@link COMMAND_BARREL}) by
 * relative path. The line goes after the file's last `import type` line,
 * or before its first statement when it has none. ESLint's
 * `import/order` decides the final place, so lint the file afterwards.
 *
 * The value rewrite is for TS9010 (an exported variable), TS9011 (a
 * parameter), TS9012 (a property) and TS9007 (a function's return). It
 * writes `: <type>` after the name, or after the parameter list for a
 * return. The type is printed whole, with no truncation, and with single
 * quotes for string literals.
 *
 * A printed type is what the compiler infers, so a constant built from a
 * template of constants prints as its literal, such as
 * `'docs/survey/import-graph.json'`. Whether that export is better typed
 * as `string` is read by hand afterwards.
 *
 * ## What it refuses
 *
 * A refused export is listed with its file and line and is left as it
 * was, to be annotated by hand. The codemod refuses:
 *
 *   - a printed type that holds `any`;
 *   - a printed type that holds an `import('…')` type, which is how the
 *     checker prints a name the file does not import;
 *   - a printed type that holds an anonymous class;
 *   - a printed type that holds a name the file cannot reach, such as a
 *     type its own module does not export (see "Reach" below);
 *   - a function whose inferred return is a type predicate, which a
 *     printed return type would drop;
 *   - a default export outside a `commands` folder, one whose type is
 *     not assignable to `RafaCommand`, and one in a file that already
 *     uses the name `command` or gives `RafaCommand` another meaning;
 *   - every other TS90xx site, TS9017 and TS9018 among them, with the
 *     compiler's own message;
 *   - every TS90xx site of a file that holds an ordinary type error,
 *     since a type printed beside an error may be the error type.
 *
 * Reach is read twice. The name is looked up in the scope of the
 * export. Then the compiler's own word is taken: a site that carries a
 * second declaration error beside its TS90xx one, such as TS4023 (`has
 * or is using name … but cannot be named`), is refused with that error.
 * The second reading is what refuses a type its module does not export
 * in a file that declares another type of the same name, which the
 * lookup by name passes.
 *
 * A default export whose type is narrower than `RafaCommand` is
 * rewritten. A caller that read the narrower type then fails `tsc`
 * (TS2339 where it read a property `RafaCommand` does not have), and
 * the factory's declared return type is what a person fixes.
 *
 * ## Two runs
 *
 * `--dry-run` prints the same lines and writes no file. A second run
 * over the output of a first finds no TS90xx at a rewritten site, so it
 * changes nothing and lists the same refusals.
 *
 * Exit codes: 0 the run finished, whatever it refused; 2 the codemod
 * could not run (no folder named, an unknown flag, no `tsconfig.json`,
 * a config error, or a folder that holds no file of the program).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/** The command barrel, relative to the folder that holds `tsconfig.json`. */
export const COMMAND_BARREL = 'src/core/command/index.ts';

/** The type a default-exported command is annotated with. */
export const COMMAND_TYPE = 'RafaCommand';

/** The constant a default export is moved into. */
export const COMMAND_LOCAL = 'command';

/** The flag that prints the changes and writes no file. */
export const DRY_RUN_FLAG = '--dry-run';

/** What a wrong command line is answered with. */
export const USAGE: string = `Usage: bun scripts/codemod/explicit-exports.ts [${DRY_RUN_FLAG}] <folder>…`;

/** The kinds of change the codemod makes. */
export type RewriteKind = 'default-export' | 'import' | 'parameter' | 'property' | 'return' | 'variable';

/** One change, made or (under `--dry-run`) only planned. */
export interface Rewrite {
  /** The file, relative to the folder that holds `tsconfig.json`. */
  readonly file: string;
  /** The 1-based line the change starts on, in the file as it was read. */
  readonly line: number;
  readonly kind: RewriteKind;
  /** The text the change writes, short enough for one report line. */
  readonly summary: string;
}

/** One export the codemod left as it was. */
export interface Refusal {
  /** The file, relative to the folder that holds `tsconfig.json`. */
  readonly file: string;
  /** The 1-based line of the site the compiler named. */
  readonly line: number;
  /** The compiler's error code at the site, such as 9010. */
  readonly code: number;
  /** The export's name, or the start of the site's text when it has none. */
  readonly name: string;
  readonly reason: string;
}

/** What one run is asked to do. */
export interface CodemodOptions {
  /** The folder that holds `tsconfig.json`. */
  readonly root: string;
  /** The folders to rewrite, relative to `root` or absolute. */
  readonly folders: readonly string[];
  /** Plan the changes and write no file. */
  readonly dryRun: boolean;
}

/** What one run did. */
export interface CodemodResult {
  /** How many files of the program sit under the named folders. */
  readonly filesRead: number;
  readonly rewrites: readonly Rewrite[];
  readonly refusals: readonly Refusal[];
  /** The files a rewrite changed, or would change under `--dry-run`. */
  readonly changedFiles: readonly string[];
  readonly dryRun: boolean;
}

/** Where `main` writes: `out` for the report, `err` for why it could not run. */
export interface CodemodStreams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The run could not start or could not read what it was pointed at. */
export class CodemodError extends Error {}

/** The options the program is built with, over those of `tsconfig.json`. */
const FLAG_OPTIONS: ts.CompilerOptions = { declaration: true, isolatedDeclarations: true, noEmit: true };

/** How the checker writes a type: whole, single-quoted, `unique symbol` kept. */
const PRINT_FLAGS: ts.NodeBuilderFlags = ts.NodeBuilderFlags.NoTruncation
  | ts.NodeBuilderFlags.UseSingleQuotesForStringLiteralType
  | ts.NodeBuilderFlags.AllowUniqueESSymbolType;

/** Every meaning a name in scope can have; an import is an alias until resolved. */
const SCOPE_FLAGS: ts.SymbolFlags = ts.SymbolFlags.Type
  | ts.SymbolFlags.Value
  | ts.SymbolFlags.Namespace
  | ts.SymbolFlags.Alias;

/** How the checker spells an anonymous class where it cannot write a type node. */
const ANONYMOUS_CLASS = '(Anonymous class)';

/** The TS90xx codes, all of them `isolatedDeclarations` errors. */
const FIRST_ISOLATED_CODE = 9000;
const LAST_ISOLATED_CODE = 9099;

const DEFAULT_EXPORT_CODE = 9037;
const RETURN_CODE = 9007;
const ANNOTATION_CODES: ReadonlySet<number> = new Set([9010, 9011, 9012]);

/** How much of a site's text names it in a report line. */
const NAME_LENGTH = 40;

interface Edit {
  readonly pos: number;
  readonly end: number;
  readonly text: string;
}

/** The `RafaCommand` of the program: its symbol, and the type it declares. */
interface CommandType {
  readonly symbol: ts.Symbol;
  readonly type: ts.Type;
}

interface Run {
  readonly root: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly printer: ts.Printer;
  readonly commandType: CommandType | undefined;
}

/** One TS90xx error, with the node it names. */
interface Site {
  readonly sourceFile: ts.SourceFile;
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly message: string;
  readonly node: ts.Node;
  /** A declaration error of another family at the same place, as `TS4023: …`. */
  readonly unnameable: string | undefined;
}

/** The changes one site asks for. */
interface Planned {
  readonly edits: readonly Edit[];
  readonly rewrites: readonly Rewrite[];
}

/** A site's outcome: its changes, or the reason it was refused. */
type Step = Planned | string;

type Printed = { readonly text: string } | { readonly refused: string };

type Annotated = ts.VariableDeclaration | ts.ParameterDeclaration | ts.PropertyDeclaration;

type Returning = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

/** Whether a name is in scope with one of the meanings asked for. */
type Reach = (name: string, meaning: ts.SymbolFlags) => boolean;

interface FilePlan {
  readonly file: string;
  readonly fileName: string;
  readonly text: string;
  readonly edits: readonly Edit[];
  readonly rewrites: readonly Rewrite[];
  readonly refusals: readonly Refusal[];
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function isError(diagnostic: ts.Diagnostic): boolean {
  return diagnostic.category === ts.DiagnosticCategory.Error;
}

/** A diagnostic's first line, which is the sentence the compiler prints. */
function messageOf(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0] ?? '';
}

/** The symbol an import or a re-export stands for, or the symbol itself. */
function targetOf(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    return symbol;
  }
  return checker.getAliasedSymbol(symbol);
}

/** The names in scope at `at`, keyed by name; the checker lists the nearest first. */
function scopeAt(checker: ts.TypeChecker, at: ts.Node): ReadonlyMap<string, ts.Symbol> {
  return new Map(checker.getSymbolsInScope(at, SCOPE_FLAGS).map((symbol) => [symbol.name, symbol] as const));
}

function reachAt(checker: ts.TypeChecker, at: ts.Node): Reach {
  const scope = scopeAt(checker, at);
  return (name, meaning) => {
    const symbol = scope.get(name);
    return symbol !== undefined && (targetOf(checker, symbol).flags & meaning) !== 0;
  };
}

/** Builds the program of `root`'s `tsconfig.json` with the two flags on. */
function loadProgram(root: string): ts.Program {
  const configPath = join(root, 'tsconfig.json');
  if (!existsSync(configPath)) {
    throw new CodemodError(`No tsconfig.json in ${root}: run the codemod from the folder that holds one.`);
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, FLAG_OPTIONS, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new CodemodError(`Could not read ${configPath}: ${messageOf(diagnostic)}`);
    },
  });
  const configError = parsed?.errors.find(isError);
  if (parsed === undefined || configError !== undefined) {
    const said = configError === undefined
      ? 'the compiler read no config from it'
      : messageOf(configError);
    throw new CodemodError(`Could not read ${configPath}: ${said}`);
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const optionError = program.getOptionsDiagnostics().find(isError);
  if (optionError !== undefined) {
    throw new CodemodError(`Could not build the program of ${configPath}: ${messageOf(optionError)}`);
  }
  return program;
}

/** The `RafaCommand` the command barrel exports, when the program holds the barrel. */
function commandTypeOf(program: ts.Program, checker: ts.TypeChecker, root: string): CommandType | undefined {
  const barrel = program.getSourceFile(toPosix(resolve(root, COMMAND_BARREL)));
  const moduleSymbol = barrel && checker.getSymbolAtLocation(barrel);
  const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === COMMAND_TYPE);
  if (exported === undefined) {
    return undefined;
  }
  const symbol = targetOf(checker, exported);
  return { symbol, type: checker.getDeclaredTypeOfSymbol(symbol) };
}

/** The files of the program under the named folders, each folder holding at least one. */
function targetFiles(program: ts.Program, root: string, folders: readonly string[]): readonly ts.SourceFile[] {
  const sources = program.getSourceFiles().filter((file) => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file));
  const targets = folders.map((folder) => toPosix(resolve(root, folder)));
  const isUnder = (file: ts.SourceFile, target: string): boolean => file.fileName === target || file.fileName.startsWith(`${target}/`);
  const empty = targets.find((target) => !sources.some((file) => isUnder(file, target)));
  if (empty !== undefined) {
    const named = toPosix(relative(root, empty)) || '.';
    throw new CodemodError(`No file of the program is under ${named}: it does not exist or tsconfig.json excludes it, so nothing was read.`);
  }
  return sources.filter((file) => targets.some((target) => isUnder(file, target)));
}

/**
 * The innermost node that holds `start` to `end`. An error's span is a
 * whole node at most sites, and a keyword of one at a few (the `class`
 * of a class expression), where this answers the node the keyword opens.
 */
function nodeAt(sourceFile: ts.SourceFile, start: number, end: number): ts.Node {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (node.getStart(sourceFile) > start || node.end < end) {
      return undefined;
    }
    return ts.forEachChild(node, visit) ?? node;
  };
  return visit(sourceFile) ?? sourceFile;
}

function descendants(node: ts.Node): readonly ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  return [node, ...children.flatMap(descendants)];
}

/** The first name of `a.b.c`, the one the file has to have in scope. */
function headOf(name: ts.EntityName): ts.Identifier {
  if (ts.isIdentifier(name)) {
    return name;
  }
  return headOf(name.left);
}

/** Why one node of a printed type cannot be written in the file, if it cannot. */
function nodeRefusal(node: ts.Node, declared: ReadonlySet<string>, reach: Reach): string | undefined {
  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    return 'the printed type holds `any`';
  }
  if (ts.isImportTypeNode(node)) {
    const named = node.qualifier === undefined
      ? 'a module'
      : `\`${headOf(node.qualifier).text}\``;
    return `the printed type holds an \`import('…')\` type, for ${named}, which the file does not import`;
  }
  if (ts.isTypeReferenceNode(node)) {
    const head = headOf(node.typeName);
    const meaning = head === node.typeName
      ? ts.SymbolFlags.Type
      : ts.SymbolFlags.Type | ts.SymbolFlags.Namespace;
    if (!declared.has(head.text) && !reach(head.text, meaning)) {
      return `the file cannot reach the name \`${head.text}\` of the printed type`;
    }
  }
  if (ts.isTypeQueryNode(node)) {
    const head = headOf(node.exprName);
    if (!reach(head.text, ts.SymbolFlags.Value | ts.SymbolFlags.Namespace)) {
      return `the file cannot reach the name \`${head.text}\` of the printed type`;
    }
  }
  return undefined;
}

/** The type `type` has at `at`, as the text of an annotation, or why it is refused. */
function printType(run: Run, type: ts.Type, at: ts.Node): Printed {
  const typeNode = run.checker.typeToTypeNode(type, at, PRINT_FLAGS);
  if (typeNode === undefined) {
    const text = run.checker.typeToString(type, at, ts.TypeFormatFlags.NoTruncation);
    return {
      refused: text.includes(ANONYMOUS_CLASS)
        ? 'the printed type holds an anonymous class'
        : `the checker writes no annotation for the type \`${text}\``,
    };
  }
  const nodes = descendants(typeNode);
  const declared = new Set(nodes.filter(ts.isTypeParameterDeclaration).map((parameter) => parameter.name.text));
  const reach = reachAt(run.checker, at);
  const refused = nodes.map((node) => nodeRefusal(node, declared, reach)).find((reason) => reason !== undefined);
  if (refused !== undefined) {
    return { refused };
  }
  return { text: run.printer.printNode(ts.EmitHint.Unspecified, typeNode, at.getSourceFile()) };
}

function noRewrite(site: Site): string {
  return `no rewrite for this site: ${site.message}`;
}

function isAnnotated(node: ts.Node): node is Annotated {
  return ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node);
}

function kindOf(declaration: Annotated): RewriteKind {
  if (ts.isVariableDeclaration(declaration)) {
    return 'variable';
  }
  return ts.isParameter(declaration)
    ? 'parameter'
    : 'property';
}

/** TS9010, TS9011 and TS9012: `: <type>` after the name the site belongs to. */
function planAnnotation(run: Run, site: Site): Step {
  const { node } = site;
  const declaration = ts.findAncestor(node, isAnnotated);
  if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.type !== undefined) {
    return noRewrite(site);
  }
  if (declaration.name !== node && declaration.initializer !== node) {
    return noRewrite(site);
  }
  const printed = printType(run, run.checker.getTypeAtLocation(declaration.name), declaration);
  if ('refused' in printed) {
    return printed.refused;
  }
  const optional = ts.isPropertyDeclaration(declaration)
    ? declaration.questionToken
    : undefined;
  const pos = (optional ?? declaration.name).end;
  const summary = `${declaration.name.text}: ${printed.text}`;
  return {
    edits: [{ pos, end: pos, text: `: ${printed.text}` }],
    rewrites: [{ file: site.file, line: site.line, kind: kindOf(declaration), summary }],
  };
}

/** The function a TS9007 site names: the site itself, or the declaration it is the name of. */
function returningOf(node: ts.Node): Returning | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node;
  }
  return ts.isFunctionDeclaration(node.parent) && node.parent.name === node
    ? node.parent
    : undefined;
}

function functionName(declaration: Returning): string {
  const holder = ts.isFunctionDeclaration(declaration)
    ? declaration
    : declaration.parent;
  const name = ts.isFunctionDeclaration(holder) || ts.isVariableDeclaration(holder)
    ? holder.name
    : undefined;
  return name !== undefined && ts.isIdentifier(name)
    ? name.text
    : '(function)';
}

/** TS9007: `: <type>` after the parameter list. */
function planReturn(run: Run, site: Site): Step {
  const declaration = returningOf(site.node);
  const signature = declaration && run.checker.getSignatureFromDeclaration(declaration);
  const paren = declaration?.getChildren(site.sourceFile).find((child) => child.kind === ts.SyntaxKind.CloseParenToken);
  if (declaration === undefined || signature === undefined || paren === undefined || declaration.type !== undefined) {
    return noRewrite(site);
  }
  if (run.checker.getTypePredicateOfSignature(signature) !== undefined) {
    return 'the function returns a type predicate, which a printed return type would drop';
  }
  const printed = printType(run, run.checker.getReturnTypeOfSignature(signature), declaration);
  if ('refused' in printed) {
    return printed.refused;
  }
  const summary = `${functionName(declaration)}(): ${printed.text}`;
  return {
    edits: [{ pos: paren.end, end: paren.end, text: `: ${printed.text}` }],
    rewrites: [{ file: site.file, line: site.line, kind: 'return', summary }],
  };
}

/** The `import type` line for `RafaCommand`, placed as the module note says. */
function importEdit(sourceFile: ts.SourceFile, root: string): Edit {
  const fromFile = relative(dirname(sourceFile.fileName), resolve(root, COMMAND_BARREL));
  const dotted = fromFile.startsWith('.')
    ? fromFile
    : `./${fromFile}`;
  const line = `import type { ${COMMAND_TYPE} } from '${toPosix(dotted).replace(/\.ts$/, '.js')}';`;
  const lastTypeImport = sourceFile.statements
    .filter((statement) => ts.isImportDeclaration(statement) && statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
    .at(-1);
  if (lastTypeImport !== undefined) {
    return { pos: lastTypeImport.end, end: lastTypeImport.end, text: `\n${line}` };
  }
  const pos = sourceFile.statements[0]?.getStart(sourceFile) ?? 0;
  return { pos, end: pos, text: `${line}\n\n` };
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** TS9037: the default export moves into an annotated constant. */
function planDefaultExport(run: Run, site: Site): Step {
  const { sourceFile, file, node } = site;
  const statement = node.parent;
  if (!ts.isExportAssignment(statement) || statement.isExportEquals === true || statement.expression !== node) {
    return noRewrite(site);
  }
  const folders = file.split('/').slice(0, -1);
  if (!folders.includes('commands')) {
    return 'the default export is outside a `commands` folder';
  }
  if (run.commandType === undefined) {
    return `the program holds no \`${COMMAND_TYPE}\` exported from ${COMMAND_BARREL}`;
  }
  if (!run.checker.isTypeAssignableTo(run.checker.getTypeAtLocation(node), run.commandType.type)) {
    return `the expression's type is not assignable to \`${COMMAND_TYPE}\``;
  }
  const scope = scopeAt(run.checker, sourceFile);
  if (scope.has(COMMAND_LOCAL)) {
    return `the file already uses the name \`${COMMAND_LOCAL}\``;
  }
  const imported = scope.get(COMMAND_TYPE);
  if (imported !== undefined && targetOf(run.checker, imported) !== run.commandType.symbol) {
    return `\`${COMMAND_TYPE}\` names something else in this file`;
  }
  const start = statement.getStart(sourceFile);
  const closing = sourceFile.text[statement.end - 1] === ';'
    ? ''
    : ';';
  const moved: readonly Edit[] = [
    { pos: start, end: node.getStart(sourceFile), text: `const ${COMMAND_LOCAL}: ${COMMAND_TYPE} = ` },
    { pos: statement.end, end: statement.end, text: `${closing}\nexport default ${COMMAND_LOCAL};` },
  ];
  const summary = `const ${COMMAND_LOCAL}: ${COMMAND_TYPE} = …; export default ${COMMAND_LOCAL};`;
  const rewrite: Rewrite = { file, line: site.line, kind: 'default-export', summary };
  if (imported !== undefined) {
    return { edits: moved, rewrites: [rewrite] };
  }
  const added = importEdit(sourceFile, run.root);
  return {
    edits: [added, ...moved],
    rewrites: [{ file, line: lineOf(sourceFile, added.pos), kind: 'import', summary: added.text.trim() }, rewrite],
  };
}

function planSite(run: Run, site: Site): Step {
  if (site.code === DEFAULT_EXPORT_CODE) {
    return planDefaultExport(run, site);
  }
  if (site.code === RETURN_CODE) {
    return planReturn(run, site);
  }
  return ANNOTATION_CODES.has(site.code)
    ? planAnnotation(run, site)
    : noRewrite(site);
}

/** A site's plan, refused when the compiler says a second thing about the same place. */
function stepOf(run: Run, site: Site): Step {
  const step = planSite(run, site);
  if (typeof step === 'string' || site.unnameable === undefined) {
    return step;
  }
  return `tsc reports a second error at this site, ${site.unnameable}`;
}

/** The name a refusal is listed under: the declaration's, or the start of the site's text. */
function siteName(site: Site): string {
  const declaration = ts.findAncestor(site.node, isAnnotated);
  if (declaration !== undefined && (declaration.name === site.node || declaration.initializer === site.node)) {
    return declaration.name.getText(site.sourceFile);
  }
  const text = site.node.getText(site.sourceFile).split('\n')[0] ?? '';
  return text.length > NAME_LENGTH
    ? `${text.slice(0, NAME_LENGTH)}…`
    : text;
}

function isIsolated(diagnostic: ts.Diagnostic): boolean {
  return diagnostic.code >= FIRST_ISOLATED_CODE && diagnostic.code <= LAST_ISOLATED_CODE;
}

/** The TS90xx errors of one file, each with the node it names. */
function sitesOf(run: Run, sourceFile: ts.SourceFile, file: string): readonly Site[] {
  const all = run.program.getDeclarationDiagnostics(sourceFile).filter(isError);
  const others = all.filter((diagnostic) => !isIsolated(diagnostic));
  return all.filter(isIsolated).map((diagnostic) => {
    const start = diagnostic.start ?? 0;
    const other = others.find((candidate) => candidate.start === diagnostic.start);
    return {
      sourceFile,
      file,
      line: lineOf(sourceFile, start),
      code: diagnostic.code,
      message: messageOf(diagnostic),
      node: nodeAt(sourceFile, start, start + (diagnostic.length ?? 0)),
      unnameable: other && `TS${other.code}: ${messageOf(other)}`,
    };
  });
}

function planFile(run: Run, sourceFile: ts.SourceFile): FilePlan {
  const file = toPosix(relative(run.root, sourceFile.fileName));
  const base = { file, fileName: sourceFile.fileName, text: sourceFile.text };
  const sites = sitesOf(run, sourceFile, file);
  if (sites.length === 0) {
    return { ...base, edits: [], rewrites: [], refusals: [] };
  }
  const broken = [...run.program.getSyntacticDiagnostics(sourceFile), ...run.program.getSemanticDiagnostics(sourceFile)].find(isError);
  const fileRefusal = broken && `the file holds TS${broken.code} on line ${lineOf(sourceFile, broken.start ?? 0)}, and a type printed beside an error may be wrong`;
  const steps = sites.map((site) => fileRefusal ?? stepOf(run, site));
  const planned = steps.filter((step) => typeof step !== 'string');
  const refusals = sites.flatMap((site, index): readonly Refusal[] => {
    const step = steps[index];
    return typeof step === 'string'
      ? [{ file, line: site.line, code: site.code, name: siteName(site), reason: step }]
      : [];
  });
  const edits = new Map(planned.flatMap((step) => step.edits).map((edit) => [`${edit.pos}:${edit.end}:${edit.text}`, edit] as const));
  return { ...base, edits: [...edits.values()], rewrites: planned.flatMap((step) => step.rewrites), refusals };
}

/** `text` with every edit made, the last position first so that none moves another. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((a, b) => b.pos - a.pos || b.end - a.end)
    .reduce((current, edit) => current.slice(0, edit.pos) + edit.text + current.slice(edit.end), text);
}

function byPlace<T extends { readonly file: string; readonly line: number }>(a: T, b: T): number {
  return a.file.localeCompare(b.file) || a.line - b.line;
}

/**
 * Runs the codemod over `options.folders` of the program of
 * `options.root`'s `tsconfig.json`, and writes the changed files unless
 * `options.dryRun` is set.
 *
 * @throws {CodemodError} when there is no `tsconfig.json`, it cannot be
 *   read, or a named folder holds no file of the program.
 */
export function runCodemod(options: CodemodOptions): CodemodResult {
  const root = resolve(options.root);
  const program = loadProgram(root);
  const checker = program.getTypeChecker();
  const run: Run = {
    root,
    program,
    checker,
    printer: ts.createPrinter({ removeComments: true }),
    commandType: commandTypeOf(program, checker, root),
  };
  const plans = targetFiles(program, root, options.folders).map((sourceFile) => planFile(run, sourceFile));
  const changed = plans.filter((plan) => plan.edits.length > 0);
  if (!options.dryRun) {
    changed.forEach((plan) => {
      writeFileSync(plan.fileName, applyEdits(plan.text, plan.edits));
    });
  }
  return {
    filesRead: plans.length,
    rewrites: plans.flatMap((plan) => plan.rewrites).sort(byPlace),
    refusals: plans.flatMap((plan) => plan.refusals).sort(byPlace),
    changedFiles: changed.map((plan) => plan.file).sort((a, b) => a.localeCompare(b)),
    dryRun: options.dryRun,
  };
}

function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${count} ${noun}s`;
}

/**
 * The lines a run prints: how many files it read, one line per rewrite,
 * one per refusal with its file and line, and the totals. Under
 * `--dry-run` a rewrite reads `would rewrite` and the last line says
 * that nothing was written.
 */
export function reportLines(result: CodemodResult): readonly string[] {
  const verb = result.dryRun
    ? 'would rewrite'
    : 'rewrote';
  const totals = `${counted(result.rewrites.length, 'rewrite')} in ${counted(result.changedFiles.length, 'file')}, ${result.refusals.length} refused`;
  return [
    `Read ${counted(result.filesRead, 'file')} of the program.`,
    ...result.rewrites.map((rewrite) => `${verb} ${rewrite.file}:${rewrite.line} ${rewrite.summary}`),
    ...result.refusals.map((refusal) => `refused ${refusal.file}:${refusal.line} ${refusal.name} (TS${refusal.code}): ${refusal.reason}`),
    result.dryRun
      ? `${totals}; dry run, nothing written.`
      : `${totals}.`,
  ];
}

/**
 * The command line: `[--dry-run] <folder>…`, run against the
 * `tsconfig.json` of `cwd`. Answers the exit code: 0 when the run
 * finished, 2 when it could not run.
 */
export function main(argv: readonly string[], cwd: string, streams: CodemodStreams): number {
  const flags = argv.filter((argument) => argument.startsWith('--'));
  const folders = argv.filter((argument) => !argument.startsWith('--'));
  if (folders.length === 0 || flags.some((flag) => flag !== DRY_RUN_FLAG)) {
    streams.err(USAGE);
    return 2;
  }
  try {
    const result = runCodemod({ root: cwd, folders, dryRun: flags.includes(DRY_RUN_FLAG) });
    reportLines(result).forEach((line) => {
      streams.out(line);
    });
    return 0;
  } catch (error) {
    if (!(error instanceof CodemodError)) {
      throw error;
    }
    streams.err(error.message);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), process.cwd(), {
    out: (line) => {
      console.log(line);
    },
    err: (line) => {
      console.error(line);
    },
  }));
}
