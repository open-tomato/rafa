/**
 * The survey's doc inventory: which files open with a module note, which
 * `{@link}`s cross from one cluster to another, and which concepts each
 * cluster's module notes name. Run from the repository root,
 * `bun scripts/survey/doc-inventory.ts` reads `docs/survey/import-graph.json`
 * and `docs/survey/concepts.json` and writes `docs/survey/doc-inventory.json`
 * and `docs/survey/doc-inventory.md`.
 *
 * A file's module note is the first `/** … *\/` comment ahead of its first
 * statement, when that comment documents the file rather than the
 * statement. It does when the file has no statement, when another comment
 * follows it before the statement, when a blank line follows it, when the
 * statement is an import or a re-export, or when it carries a
 * `@packageDocumentation` or `@module` tag. A `/** … *\/` sitting right on
 * the file's first declaration is that declaration's TSDoc, not a note.
 * Comments are read from a TypeScript parse, after a shebang line.
 *
 * Every `{@link}`, `{@linkcode}` and `{@linkplain}` in a file's `/** … *\/`
 * comments is read, wrapped links included. Its target is the text up to
 * the first blank or `|`, and resolves to a file one of three ways:
 *
 *   - `import('<specifier>').Name` resolves the specifier from the file;
 *   - a first segment (before `.`, `#` or `~`) the file imports, by name,
 *     default or namespace, or re-exports from another module (a barrel
 *     linking to a name it passes on), resolves that specifier;
 *   - a first segment the file declares at its top level is the file itself.
 *
 * A link that resolves to a file in the import graph lies `inside` its
 * cluster or `across` to another; one that resolves elsewhere (a package,
 * a file out of scope) or is a URL is `outside`; one bound to no import or
 * declaration (a global, a member named alone) is `unbound`. Only `across`
 * links are listed, one row per file, target and file reached with the
 * number of times it is written; the others are counted.
 *
 * Concepts come from `docs/survey/concepts.json`, each with the clusters
 * whose files' comments name it (any TSDoc, not only notes). A module note
 * names a concept when it holds one of the concept's terms, read the way
 * `concepts.ts` reads comments. A concept whose cluster holds no note that
 * names it is listed under that cluster: the cluster's files mention it
 * only below their notes.
 *
 * Clusters are taken from the `nodes` of `docs/survey/import-graph.json`,
 * not built again, so this inventory and the traces that cite cluster
 * names read the same cut. A tracked file the graph does not list is put
 * in the `unclustered` cluster and counted there.
 */

import type { FileKind } from './files';
import type { ResolveImport } from './import-graph';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { namesTerm, normalizeTerm } from './concepts';
import { classifyFile, coverageLine, listTrackedFiles } from './files';
import { OUTPUT_DIR, bunResolver, stableJson } from './import-graph';

/** The cluster a tracked file lies in when the import graph does not list it. */
export const UNCLUSTERED = 'unclustered';

/** How a `{@link}` lies against the cluster cut. */
export type LinkPlacement = 'across' | 'inside' | 'outside' | 'unbound';

/** One `{@link}` as read from a file, resolved or not. */
export interface LinkReading {
  /** The link's target as written, up to the first blank or `|`. */
  readonly target: string;
  /** The file the target resolves to, repository-relative, or `undefined`. */
  readonly file: string | undefined;
  /** `true` for a URL, which never resolves to a file. */
  readonly url: boolean;
}

/** What one file's comments give the inventory. */
export interface FileReading {
  /** The module note's text, normalized as `normalizeTerm` does, or `undefined`. */
  readonly note: string | undefined;
  /** Every `{@link}` in the file's `/** … *\/` comments, in source order. */
  readonly links: readonly LinkReading[];
}

/** One concept as `docs/survey/concepts.json` lists it, the fields read here. */
export interface InventoryConcept {
  /** The concept's normalized key. */
  readonly key: string;
  /** The concept's name as written. */
  readonly name: string;
  /** The normalized terms a comment must hold to name it. */
  readonly terms: readonly string[];
  /** The clusters whose files' comments name it. */
  readonly clusters: readonly string[];
}

/** What the inventory is built from, all of it passed in as data. */
export interface DocInventoryInput {
  /** Each file read, with what its comments give. */
  readonly readings: ReadonlyMap<string, FileReading>;
  /** The cluster each file lies in, from the import graph's nodes. */
  readonly clusterOf: ReadonlyMap<string, string>;
  /** The concepts of `docs/survey/concepts.json`. */
  readonly concepts: readonly InventoryConcept[];
}

/** One file of the inventory. */
export interface InventoryFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly cluster: string;
  readonly moduleNote: boolean;
}

/** One `{@link}` from a file in one cluster to a file in another. */
export interface CrossClusterLink {
  readonly from: string;
  readonly fromCluster: string;
  /** How many times the file writes this link. */
  readonly occurrences: number;
  readonly target: string;
  readonly to: string;
  readonly toCluster: string;
}

/** One cluster of the inventory. */
export interface InventoryCluster {
  readonly name: string;
  /** Files read in the cluster. */
  readonly files: number;
  /** Files of kind `source` in the cluster. */
  readonly sources: number;
  /** Files of kind `source` with a module note. */
  readonly notedSources: number;
  /** Files of kind `source` with no module note, sorted. */
  readonly sourcesWithoutNote: readonly string[];
  /** Keys of the concepts some module note in the cluster names, sorted. */
  readonly conceptsInNotes: readonly string[];
  /** Keys of the concepts the cluster's files name but none of its notes, sorted. */
  readonly conceptsNotInNotes: readonly string[];
}

/** How many links fell in each placement. */
export type LinkCounts = Readonly<Record<LinkPlacement, number>>;

/** The inventory both outputs show. */
export interface DocInventory {
  /** Every file read, sorted by path. */
  readonly files: readonly InventoryFile[];
  /** Every cluster with a file read, sorted by name. */
  readonly clusters: readonly InventoryCluster[];
  /** Every link across a cluster cut, sorted. */
  readonly crossClusterLinks: readonly CrossClusterLink[];
  /** The links read, by placement. */
  readonly links: LinkCounts;
  /** The concept names, by key, for the summary. */
  readonly conceptNames: Readonly<Record<string, string>>;
  /** The files read, sorted. */
  readonly read: readonly string[];
}

const LINK = /\{@link(?:code|plain)?\s+([^}]*)\}/g;
const IMPORT_TARGET = /^import\(\s*(['"])(.+?)\1\s*\)/;
const URL_TARGET = /^[a-z][a-z0-9+.-]*:\/\//i;
const NOTE_TAG = /@(?:packageDocumentation|module)\b/;
const BLANK_LINE = /\n[ \t]*\r?\n/;

/**
 * Whether a comment range is a `/** … *\/` doc comment (and not `/**\/`).
 *
 * @param text - The file's text.
 * @param range - A comment range in it.
 * @returns `true` for a doc comment.
 */
function isDocComment(text: string, range: ts.CommentRange): boolean {
  return range.kind === ts.SyntaxKind.MultiLineCommentTrivia
    && text.startsWith('/**', range.pos)
    && range.end - range.pos > '/**/'.length;
}

/**
 * The text inside a doc comment: the delimiters and each line's leading
 * `*` dropped.
 *
 * @param body - The comment, `/**` to `*\/`.
 * @returns Its inner text, lines kept.
 */
function commentText(body: string): string {
  return body
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .replace(/^\s*\*/gm, '');
}

/**
 * The statements whose leading comment documents the file rather than
 * them: imports and re-exports.
 *
 * @param statement - A top-level statement.
 * @returns `true` when a comment just above it is the file's.
 */
function isFileLevelStatement(statement: ts.Statement): boolean {
  return ts.isImportDeclaration(statement)
    || ts.isImportEqualsDeclaration(statement)
    || (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined);
}

/**
 * Finds a file's module note, by the rule in the module note above.
 *
 * @param source - The parsed file.
 * @returns The note's raw comment, `/**` to `*\/`, or `undefined`.
 */
function findModuleNote(source: ts.SourceFile): string | undefined {
  const text = source.text;
  const first = source.statements[0];
  const ranges = ts.getLeadingCommentRanges(text, first?.pos ?? source.endOfFileToken.pos) ?? [];
  const index = ranges.findIndex((range) => isDocComment(text, range));
  const range = ranges[index];
  if (range === undefined) {
    return undefined;
  }
  const body = text.slice(range.pos, range.end);
  const next = ranges[index + 1]?.pos ?? first?.getStart(source) ?? text.length;
  const isNote = first === undefined
    || index < ranges.length - 1
    || BLANK_LINE.test(text.slice(range.end, next))
    || isFileLevelStatement(first)
    || NOTE_TAG.test(body);
  return isNote
    ? body
    : undefined;
}

/**
 * The names a file binds at its top level, each to where it lives: the
 * specifier of an import, or `null` for a declaration of the file's own.
 *
 * @param source - The parsed file.
 * @returns Each bound name with its specifier, or `null`.
 */
function topLevelBindings(source: ts.SourceFile): Map<string, string | null> {
  const bindings = new Map<string, string | null>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) {
        bindings.set(clause.name.text, specifier);
      }
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        bindings.set(named.name.text, specifier);
      } else if (named) {
        named.elements.forEach((element) => bindings.set(element.name.text, specifier));
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.exportClause;
      if (clause && ts.isNamespaceExport(clause)) {
        bindings.set(clause.name.text, specifier);
      } else if (clause) {
        clause.elements.forEach((element) => bindings.set(element.name.text, specifier));
      }
    } else if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations
        .filter((declaration) => ts.isIdentifier(declaration.name))
        .forEach((declaration) => bindings.set((declaration.name as ts.Identifier).text, null));
    } else if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement)
        || ts.isModuleDeclaration(statement))
      && statement.name !== undefined
      && ts.isIdentifier(statement.name)
    ) {
      bindings.set(statement.name.text, null);
    }
  }
  return bindings;
}

/**
 * The raw text of every doc comment in a parsed file, in source order.
 *
 * @param source - The parsed file.
 * @returns Each comment, `/**` to `*\/`.
 */
function docCommentBodies(source: ts.SourceFile): string[] {
  const text = source.text;
  const seen = new Map<number, string>();
  const collect = (position: number): void => {
    for (const range of ts.getLeadingCommentRanges(text, position) ?? []) {
      if (isDocComment(text, range) && !seen.has(range.pos)) {
        seen.set(range.pos, text.slice(range.pos, range.end));
      }
    }
  };
  const visit = (node: ts.Node): void => {
    collect(node.pos);
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(source.endOfFileToken.pos);
  return [...seen].sort(([left], [right]) => left - right).map(([, body]) => body);
}

/**
 * Resolves one link target from the file it is written in.
 *
 * @param target - The target as written.
 * @param from - The file's repository-relative path.
 * @param bindings - The file's top-level bindings.
 * @param resolve - Resolves an import specifier from a file.
 * @returns The link as read.
 */
function resolveLink(
  target: string,
  from: string,
  bindings: ReadonlyMap<string, string | null>,
  resolve: ResolveImport,
): LinkReading {
  if (URL_TARGET.test(target)) {
    return { file: undefined, target, url: true };
  }
  const imported = IMPORT_TARGET.exec(target);
  if (imported) {
    return { file: resolve(imported[2] ?? '', from), target, url: false };
  }
  const name = target.split(/[.#~]/)[0] ?? '';
  const specifier = bindings.get(name);
  if (specifier === undefined) {
    return { file: undefined, target, url: false };
  }
  return {
    file: specifier === null
      ? from
      : resolve(specifier, from),
    target,
    url: false,
  };
}

/**
 * Reads one file's module note and `{@link}`s. Pure but for `resolve`.
 *
 * @param path - The file's repository-relative path; its extension picks the script kind.
 * @param text - The file's source text.
 * @param resolve - Resolves an import specifier from a file to a repository-relative path.
 * @returns The note's normalized text, or `undefined`, and every link.
 */
export function readDocFile(path: string, text: string, resolve: ResolveImport): FileReading {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const note = findModuleNote(source);
  const bindings = topLevelBindings(source);
  const links: LinkReading[] = [];
  for (const body of docCommentBodies(source)) {
    const inner = commentText(body).replace(/\s+/g, ' ');
    for (const match of inner.matchAll(LINK)) {
      const target = (match[1] ?? '').trim().split(/[\s|]/)[0] ?? '';
      if (target !== '') {
        links.push(resolveLink(target, path, bindings, resolve));
      }
    }
  }
  return {
    links,
    note: note === undefined
      ? undefined
      : normalizeTerm(commentText(note)),
  };
}

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
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

/**
 * Places one link against the cluster cut.
 *
 * @param link - The link as read.
 * @param fromCluster - The cluster of the file it is written in.
 * @param clusterOf - The cluster of each file in the graph.
 * @returns Where it lies, and the target's cluster when it has one.
 */
function placeLink(
  link: LinkReading,
  fromCluster: string,
  clusterOf: ReadonlyMap<string, string>,
): { placement: LinkPlacement; toCluster?: string } {
  if (link.url) {
    return { placement: 'outside' };
  }
  if (link.file === undefined) {
    return { placement: 'unbound' };
  }
  const toCluster = clusterOf.get(link.file);
  if (toCluster === undefined) {
    return { placement: 'outside' };
  }
  return toCluster === fromCluster
    ? { placement: 'inside', toCluster }
    : { placement: 'across', toCluster };
}

/**
 * Builds the inventory. Pure: the caller reads the files, the graph and
 * the concepts (see `main`).
 *
 * @param input - Each file's reading, each file's cluster, the concepts.
 * @returns The inventory, every list sorted.
 */
export function inventoryDocs(input: DocInventoryInput): DocInventory {
  const read = [...input.readings.keys()].sort();
  const clusterOfRead = (path: string): string => input.clusterOf.get(path) ?? UNCLUSTERED;
  const files: InventoryFile[] = read.map((path) => ({
    cluster: clusterOfRead(path),
    kind: classifyFile(path),
    moduleNote: input.readings.get(path)?.note !== undefined,
    path,
  }));
  const counts: Record<LinkPlacement, number> = { across: 0, inside: 0, outside: 0, unbound: 0 };
  const crossClusterLinks = new Map<string, CrossClusterLink>();
  for (const path of read) {
    const fromCluster = clusterOfRead(path);
    for (const link of input.readings.get(path)?.links ?? []) {
      const { placement, toCluster } = placeLink(link, fromCluster, input.clusterOf);
      counts[placement] += 1;
      if (placement === 'across' && link.file !== undefined && toCluster !== undefined) {
        const key = `${path}\0${link.target}\0${link.file}`;
        const occurrences = (crossClusterLinks.get(key)?.occurrences ?? 0) + 1;
        crossClusterLinks.set(key, { from: path, fromCluster, occurrences, target: link.target, to: link.file, toCluster });
      }
    }
  }
  const clusterNames = [...new Set(files.map((file) => file.cluster))].sort();
  const clusters = clusterNames.map((name) => {
    const members = files.filter((file) => file.cluster === name);
    const sources = members.filter((file) => file.kind === 'source');
    const notes = members
      .map((file) => input.readings.get(file.path)?.note)
      .filter((note): note is string => note !== undefined);
    const inNotes = input.concepts
      .filter((concept) => notes.some((note) => concept.terms.some((term) => namesTerm(note, term))))
      .map((concept) => concept.key);
    const inNotesSet = new Set(inNotes);
    return {
      conceptsInNotes: [...inNotes].sort(),
      conceptsNotInNotes: input.concepts
        .filter((concept) => concept.clusters.includes(name) && !inNotesSet.has(concept.key))
        .map((concept) => concept.key)
        .sort(),
      files: members.length,
      name,
      notedSources: sources.filter((file) => file.moduleNote).length,
      sources: sources.length,
      sourcesWithoutNote: sources.filter((file) => !file.moduleNote).map((file) => file.path),
    };
  });
  const across = [...crossClusterLinks]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, link]) => link);
  const conceptNames = Object.fromEntries(input.concepts.map((concept) => [concept.key, concept.name]));
  return { clusters, conceptNames, crossClusterLinks: across, files, links: counts, read };
}

/**
 * The inventory as `docs/survey/doc-inventory.json` holds it.
 *
 * @param inventory - The inventory.
 * @returns The JSON text: sorted keys, two-space indent, a closing newline.
 */
export function renderDocInventoryJson(inventory: DocInventory): string {
  return stableJson({
    clusters: inventory.clusters,
    crossClusterLinks: inventory.crossClusterLinks,
    files: inventory.files,
    links: inventory.links,
    read: inventory.read,
  });
}

/**
 * Escapes a pipe so a value stays in its markdown table cell.
 *
 * @param text - A cell's text.
 * @returns The text with every `|` escaped.
 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Counts the files of one kind, and those of them with a module note.
 *
 * @param files - The inventory's files.
 * @param kind - The kind counted.
 * @returns `<noted> of <all>`.
 */
function notedOf(files: readonly InventoryFile[], kind: FileKind): string {
  const ofKind = files.filter((file) => file.kind === kind);
  return `${ofKind.filter((file) => file.moduleNote).length} of ${ofKind.length}`;
}

/**
 * The inventory as `docs/survey/doc-inventory.md` holds it: the coverage
 * line, a summary, the source files with no module note by cluster, the
 * links across a cluster cut, and the concepts no note in their cluster
 * names.
 *
 * @param inventory - The inventory.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderDocInventoryMarkdown(inventory: DocInventory, tracked: readonly string[]): string {
  const { links } = inventory;
  const total = links.across + links.inside + links.outside + links.unbound;
  const missing = inventory.clusters.filter((cluster) => cluster.sourcesWithoutNote.length > 0);
  const allNoted = inventory.clusters.filter((cluster) => cluster.sources > 0 && cluster.sourcesWithoutNote.length === 0);
  const untagged = inventory.clusters.filter((cluster) => cluster.conceptsNotInNotes.length > 0);
  const placements = inventory.clusters.reduce((sum, cluster) => sum + cluster.conceptsNotInNotes.length, 0);
  const name = (key: string): string => cell(inventory.conceptNames[key] ?? key);
  const lines = [
    '# Doc inventory',
    '',
    coverageLine(inventory.read, tracked),
    '',
    `Module notes: ${notedOf(inventory.files, 'source')} source files, ${notedOf(inventory.files, 'test')} test files `
    + `and ${notedOf(inventory.files, 'test-support')} test-support files open with one. `
    + `\`{@link}\`s read: ${total}; ${links.inside} inside one cluster, ${links.across} across clusters, `
    + `${links.outside} to a URL or a file outside the graph, ${links.unbound} bound to no import or declaration `
    + `of their file. ${placements} concept placements are named by no module note in their cluster.`,
    '',
    '## Source files with no module note, by cluster',
    '',
    ...missing.flatMap((cluster) => [
      `### \`${cluster.name}\` (${cluster.sourcesWithoutNote.length} of ${cluster.sources} source files)`,
      '',
      ...cluster.sourcesWithoutNote.map((path) => `- \`${path}\``),
      '',
    ]),
    `Every source file has a module note in: ${allNoted.map((cluster) => `\`${cluster.name}\``).join(', ') || 'none'}.`,
    '',
    '## Links across clusters',
    '',
    `${inventory.crossClusterLinks.length} distinct links (file, target, file reached), ${links.across} written.`,
    '',
    '| From | Cluster | Link | Times | To | Cluster |',
    '| --- | --- | --- | --- | --- | --- |',
    ...inventory.crossClusterLinks.map((link) => `| \`${link.from}\` | \`${link.fromCluster}\` | \`${cell(link.target)}\` `
      + `| ${link.occurrences} | \`${link.to}\` | \`${link.toCluster}\` |`),
    '',
    '## Concepts no note in their cluster names',
    '',
    'A concept is placed in a cluster when a comment of one of its files names it (`concepts.json`); listed here when '
    + 'no module note of that cluster does.',
    '',
    ...untagged.flatMap((cluster) => [
      `### \`${cluster.name}\` (${cluster.conceptsNotInNotes.length}; ${cluster.conceptsInNotes.length} named in notes)`,
      '',
      ...cluster.conceptsNotInNotes.map((key) => `- ${name(key)}`),
      '',
    ]),
  ];
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Reads the cluster of each file from an import graph's JSON.
 *
 * @param json - `docs/survey/import-graph.json`, parsed.
 * @returns The cluster each listed file lies in.
 * @throws When the JSON has no `nodes` list of `{ path, cluster }`.
 */
export function clustersFromGraph(json: unknown): Map<string, string> {
  const nodes = (json as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    throw new TypeError('import-graph.json has no nodes list; run bun scripts/survey/import-graph.ts first');
  }
  return new Map(nodes.map((node: { cluster?: unknown; path?: unknown }) => {
    if (typeof node.path !== 'string' || typeof node.cluster !== 'string') {
      throw new TypeError(`import-graph.json has a node without a path and a cluster: ${JSON.stringify(node)}`);
    }
    return [node.path, node.cluster];
  }));
}

/**
 * Reads the concepts from a concept map's JSON.
 *
 * @param json - `docs/survey/concepts.json`, parsed.
 * @returns The concepts, the fields the inventory reads.
 * @throws When the JSON has no `concepts` list of the expected shape.
 */
export function conceptsFromMap(json: unknown): InventoryConcept[] {
  const concepts = (json as { concepts?: unknown }).concepts;
  if (!Array.isArray(concepts)) {
    throw new TypeError('concepts.json has no concepts list; run bun scripts/survey/concepts.ts first');
  }
  return concepts.map((concept: Partial<InventoryConcept>) => {
    if (typeof concept.key !== 'string' || !Array.isArray(concept.terms) || !Array.isArray(concept.clusters)) {
      throw new TypeError(`concepts.json has a concept without a key, terms and clusters: ${JSON.stringify(concept)}`);
    }
    return { clusters: concept.clusters, key: concept.key, name: concept.name ?? concept.key, terms: concept.terms };
  });
}

/**
 * Reads the repository at `root`, the import graph and the concept map
 * under `docs/survey/`, and writes both outputs there.
 *
 * @param root - The repository root.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string): Promise<string[]> {
  const tracked = listTrackedFiles(root);
  const clusterOf = clustersFromGraph(await Bun.file(join(root, OUTPUT_DIR, 'import-graph.json')).json());
  const concepts = conceptsFromMap(await Bun.file(join(root, OUTPUT_DIR, 'concepts.json')).json());
  const resolve = bunResolver(root);
  const readings = new Map<string, FileReading>();
  for (const path of tracked.all) {
    readings.set(path, readDocFile(path, await Bun.file(join(root, path)).text(), resolve));
  }
  const inventory = inventoryDocs({ clusterOf, concepts, readings });
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/doc-inventory.json`;
  const markdownPath = `${OUTPUT_DIR}/doc-inventory.md`;
  writeFileSync(join(root, jsonPath), renderDocInventoryJson(inventory));
  writeFileSync(join(root, markdownPath), renderDocInventoryMarkdown(inventory, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    for (const path of await main(process.cwd())) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
