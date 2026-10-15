/**
 * The text half of the core-package codemod (`core-package.ts`): reading
 * the specifiers, comments and string literals of a code file, and the
 * edits each step writes into a text. Every function here is pure over
 * the text handed in; which file is read and what a path becomes is
 * decided by `core-package.ts`.
 */
import { posix } from 'node:path';

import ts from 'typescript';

/** The note a re-export file of core carries. */
export const REEXPORT_NOTE = '#1090';

/** A line the codemod lists and leaves, or one it refuses. */
export interface SiteNote {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** What {@link readReexports} reads. */
export interface ReexportInput {
  readonly files: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly resolve: (specifier: string, from: string) => string | undefined;
}

/** The re-export files of step 3. */
export interface Reexports {
  /** Each pure re-export file, with the core file it names. */
  readonly deleted: ReadonlyMap<string, string>;
  /** Each trimmed file, with the core file its block names and the block's names. */
  readonly trimmed: ReadonlyMap<string, { readonly target: string; readonly names: ReadonlySet<string> }>;
  /** The trimmed files' edits: each of their re-export declarations removed. */
  readonly edits: ReadonlyMap<string, readonly Edit[]>;
  readonly refusals: readonly SiteNote[];
}

/** One path a rename changed. */
export interface RenamedPath {
  readonly from: string;
  readonly to: string;
}

/** A code file's extension, of any module kind. */
export const CODE_EXTENSION: RegExp = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The `.js` form of each TypeScript extension, as a specifier spells it. */
const JS_FOR_TS: Readonly<Record<string, string>> = { '.ts': '.js', '.tsx': '.jsx', '.mts': '.mjs', '.cts': '.cjs' };

/**
 * A path as prose writes it, opening with `src/`: not preceded by a word
 * character or by one and a `/`, so `packages/rafa/src/core/` is not one
 * and `../src/core/` is.
 */
const PATH_TOKEN = /(?<![\w@-])(?<![\w-]\/)src\/[\w.*/-]*/g;

/** A specifier written in a file, with the node that holds it. */
export interface SpecifierSite {
  readonly node: ts.StringLiteralLike;
  readonly declaration?: ts.ExportDeclaration | ts.ImportDeclaration;
}

/** One change to a text. */
export interface Edit {
  readonly pos: number;
  readonly end: number;
  readonly text: string;
}

/**
 * A relative specifier from one file to another, spelled as `original`
 * was: a `.js` form for a `.ts` target when it named `.js`, the target's
 * own extension when it named that, and none (nor a closing `/index`)
 * when it named none.
 *
 * @param from - The importing file's path.
 * @param target - The imported file's path.
 * @param original - The specifier as written before.
 * @returns The new specifier, opening with `./` or `../`.
 */
export function relativeSpecifier(from: string, target: string, original: string): string {
  const relative = posix.relative(posix.dirname(from), target);
  const path = relative.startsWith('.')
    ? relative
    : `./${relative}`;
  const extension = posix.extname(target);
  const named = posix.extname(original);
  if (named === extension || !CODE_EXTENSION.test(target)) {
    return path;
  }
  const bare = path.slice(0, -extension.length);
  if (named !== '' && JS_FOR_TS[extension] === named) {
    return `${bare}${named}`;
  }
  return bare.endsWith('/index') && !original.endsWith('index')
    ? bare.slice(0, -'/index'.length)
    : bare;
}

/**
 * Applies non-overlapping edits to a text.
 *
 * @param text - The text.
 * @param edits - The edits, in any order.
 * @returns The new text, or `undefined` when two edits overlap.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string | undefined {
  const sorted = [...edits].sort((a, b) => b.pos - a.pos);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > floor) {
      return undefined;
    }
    out = `${out.slice(0, edit.pos)}${edit.text}${out.slice(edit.end)}`;
    floor = edit.pos;
  }
  return out;
}

/**
 * Parses a code file with its parent nodes set, as JSX when its name says so.
 *
 * @param path - The file's path.
 * @param text - Its text.
 * @returns The parsed file.
 */
export function parseSource(path: string, text: string): ts.SourceFile {
  const kind = /\.[cm]?jsx?$/.test(path)
    ? ts.ScriptKind.JSX
    : path.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

/**
 * The 1-based line of a position.
 *
 * @param source - The parsed file.
 * @param pos - A position in it.
 * @returns Its line.
 */
export function lineOf(source: ts.SourceFile, pos: number): number {
  return source.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Every specifier a file writes, in source order.
 *
 * @param source - The parsed file.
 * @returns One site per specifier.
 */
export function specifierSites(source: ts.SourceFile): SpecifierSite[] {
  const sites: SpecifierSite[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      sites.push({ declaration: node, node: node.moduleSpecifier });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      sites.push({ node: node.moduleReference.expression });
    } else if (ts.isCallExpression(node) && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      sites.push({ node: node.arguments[0] });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      sites.push({ node: node.argument.literal });
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      sites.push({ node: node.name });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/**
 * The spans of a code file step 7 reads: every comment, and every string
 * or template literal that is not a specifier.
 *
 * @param source - The parsed file.
 * @param specifiers - The positions of its specifier literals.
 * @returns The spans, each once.
 */
export function proseSpans(source: ts.SourceFile, specifiers: ReadonlySet<number>): readonly (readonly [number, number])[] {
  const text = source.text;
  const spans = new Map<number, number>();
  const comments = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) spans.set(range.pos, range.end);
  };
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
      return;
    }
    comments(ts.getLeadingCommentRanges(text, node.pos));
    comments(ts.getTrailingCommentRanges(text, node.end));
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal && !specifiers.has(node.getStart(source))) {
      spans.set(node.getStart(source), node.end);
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...spans.entries()];
}

/**
 * The step 7 edits over one span of a text.
 *
 * @param text - The whole text.
 * @param span - The span to read.
 * @param rewrite - The token rewrite.
 * @returns One edit per core path in the span.
 */
export function tokenEdits(text: string, span: readonly [number, number], rewrite: (token: string) => string | undefined): Edit[] {
  const edits: Edit[] = [];
  const slice = text.slice(span[0], span[1]);
  for (const match of slice.matchAll(PATH_TOKEN)) {
    const token = match[0].replace(/\.+$/, '');
    const replaced = rewrite(token);
    if (replaced !== undefined && replaced !== token) {
      const pos = span[0] + (match.index ?? 0);
      edits.push({ end: pos + token.length, pos, text: replaced });
    }
  }
  return edits;
}

/**
 * The names a declaration takes: none for a bare `import '…'`, and
 * `undefined` when it binds a default, a namespace or `*`.
 *
 * @param declaration - An import or export declaration.
 * @returns Its named elements, or `undefined`.
 */
export function takenNames(declaration: ts.ExportDeclaration | ts.ImportDeclaration): readonly ts.ExportSpecifier[] | readonly ts.ImportSpecifier[] | undefined {
  if (ts.isExportDeclaration(declaration)) {
    return declaration.exportClause !== undefined && ts.isNamedExports(declaration.exportClause)
      ? declaration.exportClause.elements
      : undefined;
  }
  const clause = declaration.importClause;
  if (clause === undefined) {
    return [];
  }
  return clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements
    : undefined;
}

/**
 * The name an element takes from its module, before any `as`.
 *
 * @param element - A named import or export.
 * @returns The name.
 */
export function importedName(element: ts.ExportSpecifier | ts.ImportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

/**
 * The text of a declaration split in two: the names it keeps from its own
 * module, then the block's names from their core file, on a line of their
 * own. Each element keeps its text, an inline `type` and an `as` included.
 *
 * @param source - The parsed file.
 * @param declaration - The declaration to split.
 * @param keptSpecifier - The specifier the kept names are taken from.
 * @param block - The elements that move.
 * @param blockSpecifier - The specifier they move to.
 * @returns The two lines, joined by a line break.
 */
export function splitDeclaration(
  source: ts.SourceFile,
  declaration: ts.ExportDeclaration | ts.ImportDeclaration,
  keptSpecifier: string,
  block: readonly (ts.ExportSpecifier | ts.ImportSpecifier)[],
  blockSpecifier: string,
): string {
  const elements = takenNames(declaration) ?? [];
  const keyword = ts.isExportDeclaration(declaration)
    ? 'export'
    : 'import';
  const typeOnly = ts.isExportDeclaration(declaration)
    ? declaration.isTypeOnly
    : declaration.importClause?.isTypeOnly === true;
  const head = typeOnly
    ? `${keyword} type`
    : keyword;
  const line = (names: readonly (ts.ExportSpecifier | ts.ImportSpecifier)[], specifier: string): string => {
    const list = names.map((element) => element.getText(source)).join(', ');
    return `${head} { ${list} } from '${specifier}';`;
  };
  const kept = elements.filter((element) => !block.includes(element));
  return `${line(kept, keptSpecifier)}\n${line(block, blockSpecifier)}`;
}

/**
 * Step 8: the initializers of `CORE_FOLDERS` and `CORE_NAMED_FILES`.
 *
 * @param source - The parsed `core-moves.ts`.
 * @returns The edits and the names found.
 */
export function flipEdits(source: ts.SourceFile): { readonly edits: readonly Edit[]; readonly flipped: readonly string[] } {
  const wanted: Readonly<Record<string, string>> = { CORE_FOLDERS: '[CORE_SOURCE]', CORE_NAMED_FILES: '[]' };
  const edits: Edit[] = [];
  const flipped: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = ts.isIdentifier(declaration.name)
        ? declaration.name.text
        : '';
      const to = wanted[name];
      if (to !== undefined && declaration.initializer !== undefined) {
        edits.push({ end: declaration.initializer.end, pos: declaration.initializer.getStart(source), text: to });
        flipped.push(name);
      }
    }
  }
  return { edits, flipped: flipped.sort() };
}

/**
 * Step 7's cluster map: every key and `outside` entry that names a moved
 * or parked file takes its path after the move, in place.
 *
 * @param text - The map's text.
 * @param finals - The path after the move of each moved and parked file.
 * @returns The new text and the paths renamed.
 */
export function renameClusterMap(text: string, finals: ReadonlyMap<string, string>): { readonly text: string; readonly renamed: readonly RenamedPath[] } {
  const map = JSON.parse(text) as { clusters?: Record<string, string>; outside?: string[] };
  const renamed: RenamedPath[] = [];
  const rename = (path: string): string => {
    const to = finals.get(path);
    if (to === undefined) {
      return path;
    }
    renamed.push({ from: path, to });
    return to;
  };
  const clusters = Object.fromEntries(Object.entries(map.clusters ?? {}).map(([path, cluster]) => [rename(path), cluster]));
  const outside = (map.outside ?? []).map(rename);
  const next = { ...map, ...(map.clusters === undefined
    ? {}
    : { clusters }), ...(map.outside === undefined
    ? {}
    : { outside }) };
  return { renamed, text: `${JSON.stringify(next, null, 2)}\n` };
}

/**
 * Reads the re-export files of step 3: the files outside core that carry
 * the note and declare `export … from` into core.
 *
 * @param input - The files, their texts and a resolver.
 * @param isCore - Whether a path is core.
 * @returns The deleted and trimmed files and their refusals.
 */
export function readReexports(input: ReexportInput, isCore: (path: string) => boolean): Reexports {
  const deleted = new Map<string, string>();
  const trimmed = new Map<string, { readonly target: string; readonly names: ReadonlySet<string> }>();
  const edits = new Map<string, readonly Edit[]>();
  const refusals: SiteNote[] = [];
  for (const file of input.files) {
    const text = input.sources.get(file);
    if (isCore(file) || !CODE_EXTENSION.test(file) || text === undefined || !text.includes(REEXPORT_NOTE)) {
      continue;
    }
    const source = parseSource(file, text);
    const intoCore = source.statements.filter((statement): statement is ts.ExportDeclaration => {
      if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined || !ts.isStringLiteral(statement.moduleSpecifier)) {
        return false;
      }
      const landed = input.resolve(statement.moduleSpecifier.text, file);
      return landed !== undefined && isCore(landed);
    });
    if (intoCore.length === 0) {
      continue;
    }
    const targets = new Set(intoCore.map((statement) => input.resolve((statement.moduleSpecifier as ts.StringLiteral).text, file) ?? ''));
    const names = intoCore.flatMap((statement) => [...(takenNames(statement) ?? [])].map((element) => element.name.text));
    if (targets.size !== 1 || intoCore.some((statement) => takenNames(statement) === undefined)) {
      refusals.push({ file, line: lineOf(source, intoCore[0]!.getStart(source)), text: 're-exports more than one core file, or `*`' });
      continue;
    }
    const target = [...targets][0]!;
    if (intoCore.length === source.statements.length) {
      deleted.set(file, target);
      continue;
    }
    trimmed.set(file, { names: new Set(names), target });
    edits.set(file, intoCore.map((statement) => ({ end: statement.end, pos: statement.getFullStart(), text: '' })));
  }
  return { deleted, edits, refusals, trimmed };
}
