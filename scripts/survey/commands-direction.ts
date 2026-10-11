/**
 * The direction reading behind the commands-direction sweep: which files
 * outside `src/commands/` import a module inside it.
 *
 * The rule it measures: a non-test file outside `src/commands/` holds no
 * import whose target is inside `src/commands/`. Once that holds, no
 * feature package has to import the CLI package (epic #801's first
 * acceptance criterion). The split tasks that carried every library half
 * out of `src/commands/` brought the measured edge count to zero, so the
 * sweep now fails on any edge at all; there is no allow-list left to
 * compare against.
 *
 * Which files are read:
 *
 *   - every file handed in that `scripts/survey/files.ts` does not
 *     classify as `test`. A test-support file (a fixture, a fake, a helper
 *     under `src/tests/`) is read: it is not a test file;
 *   - less the files under `src/commands/` themselves;
 *   - less the two files of {@link EXEMPT_IMPORTERS}, exempt by name as
 *     the CLI's own layer.
 *
 * Which imports count: every specifier `ts.preProcessFile` finds in the
 * source text (`textImports`, `scripts/survey/import-graph.ts`), so a
 * static import, an `import type`, an `export … from` and a dynamic
 * `import()` are all read, with no difference made between an import that
 * runs and one only the type checker reads. An `import()` whose argument
 * is not a string literal names no specifier and is not seen; neither is
 * anything inside a comment or a string.
 *
 * Each specifier is resolved by the resolver handed in, and an edge is
 * answered when the target lies under `src/commands/`. A specifier that
 * resolves to nothing adds no edge and is not reported here: `tsc` is the
 * gate for an import that reaches no file.
 *
 * An edge is spelled `<importer path> -> <module path under src/commands/>`,
 * both paths repository-relative with no extension ({@link edgeLine}). Two
 * imports of one module from one file are one edge.
 */

import type { ResolveImport } from './import-graph';

import { classifyFile } from './files';
import { textImports } from './import-graph';

/** The folder no file outside it may import, with its closing `/`. */
export const COMMANDS_FOLDER = 'src/commands/';

/**
 * The files outside `src/commands/` that may import it, as the CLI's own
 * layer: the bin entry, which loads the command registry, and the body of
 * `rafa plan create`.
 */
export const EXEMPT_IMPORTERS: readonly string[] = ['src/plan.ts', 'src/rafa.ts'];

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
const EDGE_ARROW = ' -> ';

/** One import from a file outside `src/commands/` to a module inside it. */
export interface CommandsEdge {
  /** The importing file, repository-relative, with no extension. */
  readonly from: string;
  /** The imported module under `src/commands/`, repository-relative, with no extension. */
  readonly to: string;
}

/** What `readCommandsEdges` reads, all of it passed in as data. */
export interface CommandsEdgesInput {
  /** The files to consider, repository-relative; normally every tracked file in scope. */
  readonly files: readonly string[];
  /** The source text of each file. */
  readonly sources: ReadonlyMap<string, string>;
  /** The resolver for each specifier a file imports. */
  readonly resolve: ResolveImport;
}

/** What `readCommandsEdges` answers. */
export interface CommandsEdges {
  /** Every edge into `src/commands/`, sorted by line, free of duplicates. */
  readonly edges: readonly CommandsEdge[];
  /** The files whose imports were read, with their extension, sorted. */
  readonly read: readonly string[];
  /** The files of `EXEMPT_IMPORTERS` that were handed in and left unread, sorted. */
  readonly exempt: readonly string[];
  /** The files that should have been read and had no source text, sorted. */
  readonly missing: readonly string[];
}

/**
 * A path less its code extension: `src/plan/parse.ts` gives
 * `src/plan/parse`.
 *
 * @param path - A repository-relative path.
 * @returns The path with no extension.
 */
function withoutExtension(path: string): string {
  return path.replace(CODE_EXTENSION, '');
}

/**
 * The line an edge is spelled as: `<importer path> -> <module path under
 * src/commands/>`.
 *
 * @param edge - The edge.
 * @returns Its line.
 */
export function edgeLine(edge: CommandsEdge): string {
  return `${edge.from}${EDGE_ARROW}${edge.to}`;
}

/**
 * Whether a file is one whose imports the rule covers: not a test file,
 * not under `src/commands/`, and not exempt by name.
 *
 * @param path - A repository-relative path.
 * @returns `true` when its imports are read.
 */
function isCovered(path: string): boolean {
  return classifyFile(path) !== 'test' && !path.startsWith(COMMANDS_FOLDER) && !EXEMPT_IMPORTERS.includes(path);
}

/**
 * Reads every import edge from a non-test file outside `src/commands/`
 * into it (see the module note for which files and which imports). Pure:
 * the caller lists the files, reads their text and supplies the resolver.
 *
 * @param input - The files, their texts and a resolver.
 * @returns The edges, the files read, the exempt files left unread, and
 *   the files with no text.
 */
export function readCommandsEdges(input: CommandsEdgesInput): CommandsEdges {
  const files = [...new Set(input.files)].sort();
  const exempt = files.filter((path) => EXEMPT_IMPORTERS.includes(path));
  const covered = files.filter(isCovered);
  const read = covered.filter((path) => input.sources.has(path));
  const missing = covered.filter((path) => !input.sources.has(path));
  const byLine = new Map<string, CommandsEdge>();
  for (const path of read) {
    for (const specifier of textImports(input.sources.get(path) ?? '')) {
      const target = input.resolve(specifier, path);
      if (target === undefined || !target.startsWith(COMMANDS_FOLDER)) {
        continue;
      }
      const edge: CommandsEdge = { from: withoutExtension(path), to: withoutExtension(target) };
      byLine.set(edgeLine(edge), edge);
    }
  }
  const edges = [...byLine.keys()].sort().flatMap((line) => byLine.get(line) ?? []);
  return { edges, exempt, missing, read };
}
