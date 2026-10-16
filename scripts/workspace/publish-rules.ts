/**
 * The publish rules of the workspace graph check: what a member with no
 * `private: true` in its manifest, which npm publishes on its own, is
 * refused for. `scripts/workspace/graph-check.ts` calls
 * {@link publishReasons} for each such member; a private member is never
 * read here.
 *
 * A publishable member is refused, one line per reason, when:
 *
 *   - its `dependencies`, `peerDependencies` or `optionalDependencies`
 *     name a private member, which never publishes, so npm could not
 *     install it. `devDependencies` are not read: they never leave the
 *     repository;
 *   - a shipped code file imports `@open-tomato/rafa` or
 *     `@open-tomato/rafa/<subpath>` while its `peerDependencies` do not
 *     name `@open-tomato/rafa`, so it would carry or miss the installed
 *     rafa instead of sharing it;
 *   - a shipped code file imports `@open-tomato/rafa/<subpath>` whose
 *     `./<subpath>` is not a key of the root manifest's `exports`, or
 *     imports a private member by name: neither resolves once published.
 *
 * The two import rules read only the files the member ships, which
 * {@link shippedImports} keeps: an import in a file npm never packs never
 * reaches a consumer. With a `files` list, a file ships when an entry,
 * read relative to the member's directory, names it or a folder holding
 * it (`src`, `src/`, `./src`), or matches either as a `Bun.Glob`
 * (`src/*.ts`, `*.js`). An entry opening with `!` is skipped, so a
 * file it would exclude is still read. With no `files`, every code file
 * ships but a test file (a name holding `.test.`, or a folder of its path
 * named `__tests__`, `test` or `tests`) and a tool config at the member's
 * root (`*.config.{js,mjs,cjs,ts,mts,cts}`). npm's always-packed files
 * (`package.json`, `README*`, `LICENSE*`) are no code files, and the
 * targets of `main` and `bin` are not read: a file they name that `files`
 * leaves out is not read either.
 *
 * For a publishable member, `@open-tomato/rafa` and its subpaths name the
 * root package, the one npm installs, and not the member the `paths` map
 * of `tsconfig.packages.json` resolves them into.
 */

/** The root package: the one a publishable member imports rafa through. */
export const ROOT_PACKAGE = '@open-tomato/rafa';

/** The manifest fields npm installs with a published package. */
const INSTALLED_FIELDS: readonly string[] = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** The field that must name the root package once a member imports it. */
const PEER_FIELD = 'peerDependencies';

/** The bare scope every `@open-tomato/*` specifier opens with. */
const SCOPE_SEPARATOR = '/';

/** The manifest field listing what npm packs. */
const FILES_FIELD = 'files';

/** A test file's name, read when the manifest has no `files`. */
const TEST_FILE_NAME = /\.test\./;

/** The folders whose files are tests, read when the manifest has no `files`. */
const TEST_FOLDERS: ReadonlySet<string> = new Set(['__tests__', 'test', 'tests']);

/** A tool config at the member's root, read when the manifest has no `files`. */
const ROOT_TOOL_CONFIG = /^[^/]+\.config\.(?:js|mjs|cjs|ts|mts|cts)$/;

/** The opening of a `files` entry that excludes rather than names. */
const NEGATION = '!';

/** The separator of a member-relative path, as the rules read it. */
const PATH_SEPARATOR = '/';

/** The scoped specifiers one code file of a member imports. */
export interface FileImports {
  /** The file, relative to its member's directory. */
  readonly file: string;
  /** The `@open-tomato/*` specifiers it imports, each once, in file order. */
  readonly specifiers: readonly string[];
}

/**
 * Narrows a value to a plain object.
 *
 * @param value - Any parsed JSON value.
 * @returns The value as a record, or an empty one when it is not an object.
 */
function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Whether a manifest publishes: it holds no `private: true`.
 *
 * @param manifest - A parsed `package.json`.
 * @returns `true` when npm would publish the package.
 */
export function isPublishable(manifest: Readonly<Record<string, unknown>>): boolean {
  return manifest.private !== true;
}

/**
 * The entries of a manifest's `files`, each with its leading `./` and
 * trailing `/` dropped; `undefined` when the field is not a list.
 *
 * @param manifest - A parsed `package.json`.
 * @returns The entries that name files, `!` entries left out.
 */
function filesEntries(manifest: Readonly<Record<string, unknown>>): string[] | undefined {
  const field = manifest[FILES_FIELD];
  if (!Array.isArray(field)) {
    return undefined;
  }
  return field
    .filter((entry): entry is string => typeof entry === 'string' && !entry.startsWith(NEGATION))
    .map((entry) => entry.replace(/^(?:\.\/)+/, '').replace(/\/+$/, ''))
    .filter((entry) => entry !== '');
}

/**
 * Whether a file of a member is in the package npm publishes for it.
 *
 * @param manifest - The member's `package.json`.
 * @param file - The file, relative to the member's directory.
 * @returns `true` when the file ships.
 */
export function isShipped(manifest: Readonly<Record<string, unknown>>, file: string): boolean {
  const path = file.split('\\').join(PATH_SEPARATOR);
  const segments = path.split(PATH_SEPARATOR);
  const entries = filesEntries(manifest);
  if (entries !== undefined) {
    const named = segments.map((_, index) => segments.slice(0, index + 1).join(PATH_SEPARATOR));
    return entries.some((entry) => {
      const glob = new Bun.Glob(entry);
      return named.some((candidate) => candidate === entry || glob.match(candidate));
    });
  }
  const name = segments.at(-1) ?? path;
  return !TEST_FILE_NAME.test(name)
    && !segments.slice(0, -1).some((folder) => TEST_FOLDERS.has(folder))
    && !ROOT_TOOL_CONFIG.test(path);
}

/**
 * The imports of the files a member ships, the ones its publish rules read.
 *
 * @param manifest - The member's `package.json`.
 * @param imports - The member's scoped imports, per file.
 * @returns The entries of shipped files, in their order.
 */
export function shippedImports(manifest: Readonly<Record<string, unknown>>, imports: readonly FileImports[]): FileImports[] {
  return imports.filter(({ file }) => isShipped(manifest, file));
}

/**
 * Whether a specifier names the root package, bare or by a subpath.
 *
 * @param specifier - A bare import specifier.
 * @returns `true` for `@open-tomato/rafa` and `@open-tomato/rafa/<subpath>`.
 */
export function namesRootPackage(specifier: string): boolean {
  return specifier === ROOT_PACKAGE || specifier.startsWith(`${ROOT_PACKAGE}${SCOPE_SEPARATOR}`);
}

/**
 * The subpath keys of a root manifest's `exports`: each key of its
 * subpath map, or `.` alone when `exports` is a string or a map of
 * conditions. A manifest with no `exports` exports no key.
 *
 * @param rootManifest - The root `package.json`.
 * @returns The keys, `.` and `./<subpath>` spelled as the manifest spells them.
 */
export function exportKeys(rootManifest: Readonly<Record<string, unknown>>): string[] {
  const field = rootManifest.exports;
  if (typeof field === 'string') {
    return ['.'];
  }
  const keys = Object.keys(recordOf(field));
  if (keys.length === 0) {
    return [];
  }
  return keys.every((key) => key.startsWith('.'))
    ? keys
    : ['.'];
}

/**
 * Whether an `exports` key, a `*` pattern allowed, names a subpath.
 *
 * @param key - A key of the root manifest's `exports`.
 * @param subpath - The subpath a specifier asks for, `.` or `./<subpath>`.
 * @returns `true` when the key resolves the subpath.
 */
function keyMatches(key: string, subpath: string): boolean {
  const star = key.indexOf('*');
  if (star < 0) {
    return key === subpath;
  }
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return subpath.length > prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix);
}

/**
 * The reasons a member's installed dependency fields refuse it: one per
 * field entry naming a private member.
 *
 * @param manifest - The member's `package.json`.
 * @param privateNames - The names of every private member.
 * @returns The reasons, in field order, then in the field's own order.
 */
function dependencyReasons(manifest: Readonly<Record<string, unknown>>, privateNames: ReadonlySet<string>): string[] {
  return INSTALLED_FIELDS.flatMap((field) => Object.keys(recordOf(manifest[field]))
    .filter((name) => privateNames.has(name))
    .map((name) => `depends on ${name} in ${field}, which is private and never publishes`));
}

/**
 * The reason a member imports the root package with no peer: one line
 * naming every file and specifier that does.
 *
 * @param manifest - The member's `package.json`.
 * @param imports - The member's scoped imports, per file.
 * @returns The reason, or none when the peer is named or nothing imports the root.
 */
function peerReasons(manifest: Readonly<Record<string, unknown>>, imports: readonly FileImports[]): string[] {
  if (Object.hasOwn(recordOf(manifest[PEER_FIELD]), ROOT_PACKAGE)) {
    return [];
  }
  const importing = imports.flatMap(({ file, specifiers }) => specifiers
    .filter(namesRootPackage)
    .map((specifier) => `${file} (${specifier})`));
  return importing.length === 0
    ? []
    : [`imports ${ROOT_PACKAGE}, which ${PEER_FIELD} does not name: ${importing.join(', ')}`];
}

/**
 * The reason one specifier does not resolve once the member is
 * published: a root subpath the root `exports` lack, or a private member.
 *
 * @param specifier - A scoped specifier.
 * @param keys - The keys of the root manifest's `exports`.
 * @param privateNames - The names of every private member.
 * @returns The ending of the reason's line, or `undefined` when the specifier resolves.
 */
function unresolvedEnding(specifier: string, keys: readonly string[], privateNames: ReadonlySet<string>): string | undefined {
  if (namesRootPackage(specifier)) {
    const subpath = `.${specifier.slice(ROOT_PACKAGE.length)}`;
    return keys.some((key) => keyMatches(key, subpath))
      ? undefined
      : `whose ${subpath} the root package.json exports do not name`;
  }
  const named = [...privateNames].find((name) => specifier === name || specifier.startsWith(`${name}${SCOPE_SEPARATOR}`));
  return named === undefined
    ? undefined
    : `which names ${named}, a private member that never publishes`;
}

/**
 * Every reason a publishable member is refused, in rule order: its
 * installed dependencies on private members, its imports of the root
 * package with no peer, then each import that does not resolve once
 * published.
 *
 * @param manifest - The member's `package.json`.
 * @param imports - The scoped imports of the files the member ships, from {@link shippedImports}, sorted by file.
 * @param privateNames - The names of every private member.
 * @param keys - The keys of the root manifest's `exports`, from {@link exportKeys}.
 * @returns The reasons; empty when the member may publish.
 */
export function publishReasons(
  manifest: Readonly<Record<string, unknown>>,
  imports: readonly FileImports[],
  privateNames: ReadonlySet<string>,
  keys: readonly string[],
): string[] {
  const unresolved = imports.flatMap(({ file, specifiers }) => specifiers.flatMap((specifier) => {
    const ending = unresolvedEnding(specifier, keys, privateNames);
    return ending === undefined
      ? []
      : [`${file} imports ${specifier}, ${ending}`];
  }));
  return [...dependencyReasons(manifest, privateNames), ...peerReasons(manifest, imports), ...unresolved];
}
