/**
 * Whether a text names documentation and nothing else: at least one path,
 * and every path it names a documentation one.
 *
 * A session that finds a stale page reports it, and until a report had a
 * field for that it went out as an out-of-scope bug. {@link namesOnlyDocs}
 * is the reading that tells such a bug from one about code, from the text
 * alone. It calls nothing and reads no tree: a path is documentation by
 * its name, whether or not a file sits there.
 *
 * The path reader under it is exported as {@link pathsNamedIn}: the kind
 * check (`./own-check.ts`) reads the files an entry names with it, so a
 * path is one thing to both readings.
 *
 * ## What counts as a path
 *
 * The text is cut at white space, commas, semicolons, quotes, brackets,
 * `=` and `|`; a piece then loses the full stop, colon, `!` or `?` that
 * ends its sentence and a `:12` or `:12:3` position. What is left is a
 * path when it is one of:
 *
 *   - a piece holding a `/` and a letter (`packages/rafa-pr/src/triage/triage.ts`,
 *     `context/`, `./docs/a.md`);
 *   - a bare file name ending in one of {@link FILE_EXTENSIONS}
 *     (`triage.ts`, `package.json`, `notes.md`);
 *   - the bare name `README` or `CHANGELOG`.
 *
 * A URL (a piece holding `://`) is not a path: it names a place outside
 * the tree. Neither is a dotted name with no file extension
 * (`TaskReport.staleDocs`, `Bun.file`, `e.g.`), nor a figure (`24/7`,
 * `2026/10/14`).
 *
 * A piece with one `/` and no extension is read as a path even when it is
 * prose (`and/or`, `push/pull`), because `src/triage` has the same shape.
 * The cost is on the safe side: such a text answers `false`, a bug counted
 * as naming code when it named only pages, never the reverse.
 *
 * Measured on 2026-10-14 over the 27 filed bodies
 * `packages/rafa/src/effort/store/machine-fault.test.ts` holds: five such pieces in
 * four bodies (`doc/behavior`, `app/dependabot`), none of them a folder,
 * and taking them out changed no body's answer. Three bodies answer `true` on their `what`, #33, #34
 * and #45, each a report of a stale page. The `artifact` of all three
 * quotes the page's sentence and names no path, so it answers `false`
 * alone: a caller holding both fields reads them as one text.
 *
 * ## What counts as documentation
 *
 * A path is documentation when any of these holds, a leading `./` set
 * aside first:
 *
 *   - its last segment ends in `.md` or `.mdx`, in any case;
 *   - its last segment is `README` or `CHANGELOG`, alone or before an
 *     extension (`README.txt`);
 *   - its first segment is `docs` or `context`.
 *
 * The folder rule reads the FIRST segment only: `docs/survey/a.csv` is
 * documentation, `src/docs/issue.ts` is code that happens to sit in a
 * folder of that name.
 */

/** The extensions that make a bare file name, one with no `/`, a path. */
const FILE_EXTENSIONS = [
  'cjs',
  'css',
  'csv',
  'html',
  'js',
  'json',
  'jsonc',
  'jsx',
  'lock',
  'md',
  'mdx',
  'mjs',
  'sh',
  'snap',
  'sql',
  'toml',
  'ts',
  'tsx',
  'txt',
  'yaml',
  'yml',
] as const;

/** What separates one piece of a text from the next. */
const SEPARATORS = /[\s,;'"`()<>[\]{}|=]+/;

/** A sentence's own punctuation after a piece, and a `:12` or `:12:3` position. */
const TRAILING = /(?::\d+){0,2}[.:!?]*$/;

/** A bare file name: no `/`, and one of {@link FILE_EXTENSIONS} at its end. */
const BARE_FILE = new RegExp(`^[\\w@.\\-]+\\.(?:${FILE_EXTENSIONS.join('|')})$`, 'i');

/** The names that are documentation with or without an extension. */
const DOC_NAME = /^(?:README|CHANGELOG)(?:\.[\w.-]+)?$/;

/** A page's own extension. */
const DOC_EXTENSION = /\.mdx?$/i;

/** The top-level folders that hold documentation alone. */
const DOC_FOLDERS: readonly string[] = ['docs', 'context'];

/** Whether `piece`, already trimmed, is a path; see the module note. */
function isPath(piece: string): boolean {
  if (piece.includes('://')) return false;
  if (piece.includes('/')) return /[A-Za-z]/.test(piece);
  return DOC_NAME.test(piece) || BARE_FILE.test(piece);
}

/** Whether `path` is a documentation one; see the module note. */
function isDocPath(path: string): boolean {
  const segments = path.replace(/^(?:\.\/)+/, '').split('/');
  const last = segments.filter((segment) => segment !== '').at(-1) ?? '';
  if (DOC_EXTENSION.test(last) || DOC_NAME.test(last)) return true;
  return segments.length > 1 && DOC_FOLDERS.includes(segments[0]!);
}

/**
 * The paths `text` names, in the order it names them, each as written
 * once its sentence's punctuation and any `:12` position are taken off;
 * see the module note for what counts as a path.
 */
export function pathsNamedIn(text: string): readonly string[] {
  return text
    .split(SEPARATORS)
    .map((piece) => piece.replace(TRAILING, ''))
    .filter(isPath);
}

/**
 * True when `text` names at least one path and every path it names is
 * documentation: a `.md` or `.mdx` file, something under `docs/` or
 * `context/`, a `README` or a `CHANGELOG`. A text naming no path answers
 * `false`, since nothing in it says what it is about.
 */
export function namesOnlyDocs(text: string): boolean {
  const paths = pathsNamedIn(text);
  return paths.length > 0 && paths.every(isDocPath);
}
