/**
 * The paths a code line builds, read for step 6 of `pass-moves.ts`: the
 * lines a move breaks without touching an import, left to the move task.
 *
 * A line builds a repository path in one of three ways, each read from
 * its quoted literals and none from a value computed at run time:
 *
 * - from `import.meta`, as `new URL('./x', import.meta.url)` and
 *   `join(import.meta.dir, '..', 'x')` build one ({@link metaPaths});
 * - from a folder constant the file binds earlier, itself from
 *   `import.meta` or from another such constant, as
 *   `join(SRC_DIR, 'cli', 'registry.ts')` builds one;
 * - as a relative string that is no import specifier, read from the
 *   file's own folder, as `moduleUrl('../tests/output-sinks.ts')` and a
 *   table row `['../issue/list.js', …]` name one.
 *
 * The third reads every `./` and `../` literal, so it may name a path the
 * line never loads (a fixture's name in a scratch folder); the caller
 * keeps only the paths that name a tracked file or folder.
 */
import { posix } from 'node:path';

/** A line that reaches `import.meta`'s path. */
export const IMPORT_META_PATH: RegExp = /import\.meta\.(?:dir|dirname|url|path)\b/;

/** A quoted literal on one line, with no interpolation. */
const QUOTED_LITERAL = /(['"`])((?:(?!\1)[^\\$]|\\.)*)\1/g;

/** A literal a `join` of path segments takes. */
const PATH_SEGMENT = /^[\w.@/-]+$/;

/** A literal read from the file's folder. */
const RELATIVE = /^\.\.?\//;

/** A line that binds a name, read for a folder constant. */
const BINDING = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/;

/** A line of a comment, whose literals load nothing. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** The TypeScript form of each extension a specifier spells a code file with. */
const TS_FORM: Readonly<Record<string, string>> = { '.cjs': '.cts', '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts' };

/** A path a line builds, beside the file it is built from. */
export interface BuiltPath {
  /** The repository-relative path, with no closing `/`. */
  readonly path: string;
  /**
   * The file whose place the path is read from: the line's own file, or
   * the module that exports the folder constant it joins onto.
   */
  readonly anchor: string;
}

/** One line that builds a path, with the paths it builds. */
export interface BuiltLine {
  /** The line's number, from 1. */
  readonly line: number;
  /** The line's text, trimmed. */
  readonly text: string;
  /** The paths, each once. */
  readonly paths: readonly BuiltPath[];
}

/** What {@link builtPaths} reads of one file. */
export interface FilePaths {
  /** The lines that build at least one path, in line order. */
  readonly lines: readonly BuiltLine[];
  /** The folder constants the file exports, by name, for its importers. */
  readonly exported: ReadonlyMap<string, BuiltPath>;
}

/** How {@link builtPaths} reads a file beyond its text. */
export interface BuiltPathsOptions {
  /**
   * Whether a literal on a line (numbered from 1) is an import specifier,
   * which step 3 rewrites and this reading leaves.
   */
  readonly isSpecifier: (line: number, literal: string) => boolean;
  /** The folder constants the file imports, by the name it binds. */
  readonly imported?: ReadonlyMap<string, BuiltPath>;
}

function literalsOf(line: string): readonly string[] {
  return [...line.matchAll(QUOTED_LITERAL)].map((match) => match[2] ?? '');
}

function trimSlash(path: string): string {
  return path.replace(/\/$/, '');
}

/** The literals joined onto a base, when every one is a path segment. */
function joinedOnto(base: string, literals: readonly string[]): readonly string[] {
  return literals.length > 0 && literals.every((literal) => PATH_SEGMENT.test(literal))
    ? [posix.join(base, ...literals)]
    : [];
}

/**
 * The paths one line builds from `import.meta`, read from its quoted
 * literals: each opening with `./` or `../`, as `new URL('./x', import.meta.url)`
 * names it, and all of them joined, as `join(import.meta.dir, '..', 'x')`
 * names it. A line that splits its call is not read.
 *
 * @param file - The file's path.
 * @param line - The line's text.
 * @returns The repository-relative paths, none with a closing `/`.
 */
export function metaPaths(file: string, line: string): readonly string[] {
  if (!IMPORT_META_PATH.test(line)) {
    return [];
  }
  const folder = posix.dirname(file);
  const literals = literalsOf(line);
  const urls = literals.filter((literal) => RELATIVE.test(literal)).map((literal) => posix.join(folder, literal));
  return [...new Set([...urls, ...joinedOnto(folder, literals)].map(trimSlash))];
}

/** A binding that exports its name. */
const EXPORTED = /^\s*export\s/;

function escapeName(name: string): string {
  return name.replace(/\$/g, '\\$');
}

/** The folder constants a line names, by the paths they hold. */
function constantsNamed(constants: ReadonlyMap<string, BuiltPath>, line: string, bound: string | undefined): readonly BuiltPath[] {
  return [...constants].filter(([name]) => name !== bound && new RegExp(`(?<![\\w$.])${escapeName(name)}(?![\\w$])`).test(line))
    .map(([, held]) => held);
}

/**
 * The path a binding with no path literal holds: the file's folder from
 * `import.meta` alone, as `dirname(fileURLToPath(import.meta.url))` and
 * `import.meta.dir` hold it, or the constant it copies.
 */
function heldBare(literals: readonly string[], meta: boolean, own: BuiltPath, named: readonly BuiltPath[]): BuiltPath | undefined {
  if (literals.length > 0) return undefined;
  return meta
    ? own
    : named[0];
}

/** The paths one line builds, each read from where it is anchored. */
function linePaths(file: string, content: string, literals: readonly string[], named: readonly BuiltPath[]): readonly BuiltPath[] {
  const meta = IMPORT_META_PATH.test(content);
  const own = (path: string): BuiltPath => ({ anchor: file, path: trimSlash(path) });
  const fromMeta = meta
    ? metaPaths(file, content).map(own)
    : [];
  const fromConstants = named.flatMap((base) => joinedOnto(base.path, literals).map((path) => ({ anchor: base.anchor, path: trimSlash(path) })));
  const relative = meta || named.length > 0
    ? []
    : literals.filter((literal) => RELATIVE.test(literal)).map((literal) => own(posix.join(posix.dirname(file), literal)));
  const seen = new Set<string>();
  return [...fromMeta, ...fromConstants, ...relative].filter((item) => !seen.has(item.path) && seen.add(item.path));
}

/**
 * Every line of a code file that builds a repository path, by the three
 * readings of this module, and the folder constants it exports.
 *
 * @param file - The file's path.
 * @param text - Its text.
 * @param options - The specifier test and the constants it imports.
 * @returns The lines, in line order, and the exported constants.
 */
export function builtPaths(file: string, text: string, options: BuiltPathsOptions): FilePaths {
  const constants = new Map<string, BuiltPath>(options.imported ?? []);
  const exported = new Map<string, BuiltPath>();
  const lines: BuiltLine[] = [];
  text.split('\n').forEach((content, index) => {
    if (COMMENT_LINE.test(content)) return;
    const line = index + 1;
    const literals = literalsOf(content).filter((literal) => !options.isSpecifier(line, literal));
    const bound = BINDING.exec(content)?.[1];
    const meta = IMPORT_META_PATH.test(content);
    const named = constantsNamed(constants, content, bound);
    const paths = linePaths(file, content, literals, named);
    if (bound !== undefined && (meta || named.length > 0)) {
      const held = paths[0] ?? heldBare(literals, meta, { anchor: file, path: posix.dirname(file) }, named);
      if (held !== undefined) {
        constants.set(bound, held);
        if (EXPORTED.test(content)) exported.set(bound, held);
      }
    }
    if (paths.length > 0) lines.push({ line, paths, text: content.trim() });
  });
  return { exported, lines };
}

/** A named import, across lines: its bindings and its specifier. */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;

/** One name a file imports by name, with the specifier it comes from. */
export interface NamedImport {
  /** The name the module exports. */
  readonly name: string;
  /** The name the file binds it to. */
  readonly local: string;
  readonly specifier: string;
}

/**
 * The names a file imports by name, `type` bindings apart, read for the
 * folder constants a helper exports.
 *
 * @param text - The file's text.
 * @returns Each binding with its specifier, in source order.
 */
export function namedImports(text: string): readonly NamedImport[] {
  return [...text.matchAll(NAMED_IMPORT)].flatMap((match) => (match[1] ?? '').split(',')
    .map((binding) => binding.trim())
    .filter((binding) => binding !== '' && !binding.startsWith('type '))
    .map((binding) => {
      const [name = '', local = name] = binding.split(/\s+as\s+/);
      return { local, name, specifier: match[3] ?? '' };
    }));
}

/**
 * A path and its TypeScript form, as a specifier-shaped literal names a
 * code file by its `.js` form.
 *
 * @param path - The path a line builds.
 * @returns The path, then its TypeScript form when it differs.
 */
export function codeForms(path: string): readonly string[] {
  const extension = posix.extname(path);
  const ts = TS_FORM[extension];
  return ts === undefined
    ? [path]
    : [path, `${path.slice(0, -extension.length)}${ts}`];
}

/**
 * Where a path a file builds lands once the file moves and keeps its
 * text: the same way from the file's new folder.
 *
 * @param file - The file's path before the move.
 * @param final - Its path after the move.
 * @param path - The path the line builds before the move.
 * @returns The path the same line builds after it.
 */
export function shiftedPath(file: string, final: string, path: string): string {
  return posix.join(posix.dirname(final), posix.relative(posix.dirname(file), path));
}

/**
 * Every tracked file of a set and every folder above one, for the
 * question "does this path name something".
 *
 * @param files - The repository-relative file paths.
 * @returns The files and their folders, none with a closing `/`.
 */
export function pathTree(files: Iterable<string>): ReadonlySet<string> {
  const tree = new Set<string>();
  for (const file of files) {
    tree.add(file);
    for (let folder = posix.dirname(file); folder !== '.' && !tree.has(folder); folder = posix.dirname(folder)) tree.add(folder);
  }
  return tree;
}
