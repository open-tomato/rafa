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
 *   - a code file under it imports `@open-tomato/rafa` or
 *     `@open-tomato/rafa/<subpath>` while its `peerDependencies` do not
 *     name `@open-tomato/rafa`, so it would carry or miss the installed
 *     rafa instead of sharing it;
 *   - a code file under it imports `@open-tomato/rafa/<subpath>` whose
 *     `./<subpath>` is not a key of the root manifest's `exports`, or
 *     imports a private member by name: neither resolves once published.
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
 * @param imports - The member's scoped imports, per file, sorted by file.
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
