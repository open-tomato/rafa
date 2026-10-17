/**
 * The workspace graph check: refuses a workspace member that the task
 * graph, the type references or the isolated linker cannot see whole.
 *
 * The members are the directories the root manifest's `workspaces` globs
 * name that hold a `package.json`. Each member is refused, one line per
 * reason, when:
 *
 *   - it has no script for a task the root `turbo.json` defines (`lint`,
 *     `check-types`, `test` today), so `turbo run` would skip it in
 *     silence. `check-types` is asked only of a member holding a
 *     `tsconfig.json`: a member with none (the two config packages) has
 *     no types for the task to check;
 *   - it holds a `tsconfig.json` that is not `composite`, or that the
 *     root solution file `tsconfig.references.json` does not reference,
 *     so `tsc --build` over the solution never builds it;
 *   - its `tsconfig.json` references omit a member it declares with a
 *     `workspace:` range whose own `tsconfig.json` is composite, so its
 *     build would read declarations nothing built first;
 *   - a `.ts`, `.mjs` or `.js` file under it holds a bare `@open-tomato/*`
 *     specifier naming a package its `dependencies`, `devDependencies` or
 *     `peerDependencies` do not, since bun links each member in isolation
 *     and the import only resolves through the root's links by accident.
 *     A specifier the `paths` map of `tsconfig.packages.json` resolves
 *     into a member names that member's package (`@open-tomato/rafa/store`
 *     names `@open-tomato/rafa-core`), and a member's own name is always
 *     declared. For a member with no `private: true`, a specifier naming
 *     `@open-tomato/rafa` names the root package, and the publish rules
 *     hold it in place of this one: in a file the member ships. One in a
 *     file it does not ship never leaves the repository, and no rule
 *     refuses it.
 *
 * A member with no `private: true`, which publishes, is refused on three
 * more counts, `scripts/workspace/publish-rules.ts`'s: an installed
 * dependency on a private member, an import of `@open-tomato/rafa` with no
 * peer on it, and an import that does not resolve once published. The two
 * import counts read only the files the member ships (its `files` list,
 * or with none every code file but its tests and root tool configs),
 * while the undeclared-import rule above reads every code file.
 *
 * Specifiers are those `ts.preProcessFile` finds, so `import type`,
 * `export … from`, a dynamic `import()` and a `require()` are read, and
 * nothing in a comment or a string is. `node_modules`, `.tsbuild`,
 * `.turbo` and `dist` folders are not walked.
 *
 * Usage, from the repository root (CI ring 1 runs it this way):
 *
 *   bun scripts/workspace/graph-check.ts [--root <dir>]
 *
 * It prints one line per member and exits 0 when every member holds, and
 * prints one line per reason and exits 1 otherwise. A root it cannot read
 * (no manifest, no `workspaces`, no member, no task in `turbo.json`) is a
 * refusal too, so a check that read nothing never passes.
 */
import type { FileImports } from './publish-rules';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

import { exportKeys, isPublishable, namesRootPackage, publishReasons, shippedImports } from './publish-rules';

/** The root file whose `tasks` keys every member must have a script for. */
export const TURBO_FILE = 'turbo.json';

/** The root solution file `tsc --build` builds every composite member from. */
export const SOLUTION_FILE = 'tsconfig.references.json';

/** The root tsconfig whose `paths` map resolves a core subpath to a member. */
export const PATHS_FILE = 'tsconfig.packages.json';

/** The task asked only of a member that holds a `tsconfig.json`. */
export const TYPED_TASK = 'check-types';

/** The scope whose bare specifiers must name a declared package. */
const SCOPE = '@open-tomato/';

/** The manifest fields a bare import may be declared in. */
const DECLARING_FIELDS: readonly string[] = ['dependencies', 'devDependencies', 'peerDependencies'];

/** Every field a `workspace:` dependency may be declared in. */
const WORKSPACE_FIELDS: readonly string[] = [...DECLARING_FIELDS, 'optionalDependencies'];

/** The files whose imports are read. */
const CODE_FILE = /\.(?:ts|mjs|js)$/;

/** The folders the import walk never enters. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', '.tsbuild', '.turbo', 'dist', '.git']);

/** `tsc`'s "no inputs were found", which says nothing of the graph. */
const NO_INPUTS_CODE = 18003;

/** One workspace member and every reason it is refused. */
export interface MemberVerdict {
  /** The member's directory, relative to the root, `/` between segments. */
  readonly dir: string;
  /** The member's manifest name, or its directory when it has none. */
  readonly name: string;
  /** Why the member is refused; empty when it holds. */
  readonly reasons: readonly string[];
}

/** What the check read over one tree. */
export interface GraphReport {
  /** Refusals of the root itself: a file missing or unreadable, no member found. */
  readonly root: readonly string[];
  /** Every member, sorted by directory. */
  readonly members: readonly MemberVerdict[];
}

/** A member as read before its verdict. */
interface Member {
  readonly dir: string;
  readonly absolute: string;
  readonly name: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tsconfig: TsconfigReading | undefined;
}

/** A member's `tsconfig.json`, parsed with its `extends` chain. */
interface TsconfigReading {
  readonly composite: boolean;
  /** The absolute directories its `references` name. */
  readonly references: readonly string[];
  readonly errors: readonly string[];
}

/** One `paths` entry of `tsconfig.packages.json`, its target made absolute. */
interface PathAlias {
  readonly prefix: string;
  readonly suffix: string;
  readonly wildcard: boolean;
  readonly target: string;
}

/**
 * Reads a JSON file, comments allowed as in a tsconfig.
 *
 * @param file - The absolute path.
 * @returns The parsed value, or the reason it could not be read.
 */
function readJsonc(file: string): { readonly value?: unknown; readonly error?: string } {
  if (!existsSync(file)) {
    return { error: 'is missing' };
  }
  const read = ts.readConfigFile(file, ts.sys.readFile);
  return read.error === undefined
    ? { value: read.config as unknown }
    : { error: `does not parse: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}` };
}

/**
 * Narrows a value to a plain object.
 *
 * @param value - Any parsed JSON value.
 * @returns The value as a record, or an empty one when it is not an object.
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * The string values of a manifest field holding a name-to-range map.
 *
 * @param manifest - A parsed `package.json`.
 * @param fields - The fields to read.
 * @returns Every `[name, range]` pair the fields hold, in field order.
 */
function dependencyPairs(manifest: Readonly<Record<string, unknown>>, fields: readonly string[]): [string, string][] {
  return fields.flatMap((field) => Object.entries(asRecord(manifest[field]))
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
}

/**
 * The `workspaces` globs of a root manifest, in either of its two shapes.
 *
 * @param manifest - The root `package.json`.
 * @returns The globs, `!` exclusions included.
 */
function workspaceGlobs(manifest: Readonly<Record<string, unknown>>): string[] {
  const field = Array.isArray(manifest.workspaces)
    ? manifest.workspaces as unknown[]
    : asRecord(manifest.workspaces).packages;
  return Array.isArray(field)
    ? field.filter((glob): glob is string => typeof glob === 'string')
    : [];
}

/**
 * The member directories the globs name: each holding a `package.json`.
 *
 * @param root - The absolute root.
 * @param globs - The `workspaces` globs; one opening with `!` excludes.
 * @returns The directories relative to the root, sorted.
 */
function memberDirs(root: string, globs: readonly string[]): string[] {
  const scan = (glob: string): string[] => [...new Bun.Glob(`${glob.replace(/\/+$/, '')}/package.json`)
    .scanSync({ cwd: root, onlyFiles: true })]
    .map((file) => dirname(file)
      .split('\\')
      .join('/'));
  const excluded = new Set(globs.filter((glob) => glob.startsWith('!')).flatMap((glob) => scan(glob.slice(1))));
  const included = globs.filter((glob) => !glob.startsWith('!')).flatMap(scan);
  return [...new Set(included)].filter((dir) => !excluded.has(dir)).sort();
}

/**
 * Parses a member's `tsconfig.json`, following its `extends` chain.
 *
 * @param dir - The member's absolute directory.
 * @returns The reading, or `undefined` when the member holds no `tsconfig.json`.
 */
function readTsconfig(dir: string): TsconfigReading | undefined {
  const file = join(dir, 'tsconfig.json');
  if (!existsSync(file)) {
    return undefined;
  }
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error !== undefined) {
    return {
      composite: false,
      references: [],
      errors: [`tsconfig.json does not parse: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`],
    };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, file);
  return {
    composite: parsed.options.composite === true,
    references: (parsed.projectReferences ?? []).map((reference) => referencedDir(reference.path)),
    errors: parsed.errors
      .filter((error) => error.code !== NO_INPUTS_CODE)
      .map((error) => `tsconfig.json: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`),
  };
}

/**
 * The directory a project reference names: the path itself, or the
 * folder of the `.json` file it names.
 *
 * @param path - An absolute reference path.
 * @returns The referenced project's directory.
 */
function referencedDir(path: string): string {
  return path.endsWith('.json')
    ? dirname(path)
    : resolve(path);
}

/**
 * The directories the root solution file references.
 *
 * @param root - The absolute root.
 * @returns The absolute directories, or the reason the file could not be read.
 */
function solutionDirs(root: string): { readonly dirs: ReadonlySet<string>; readonly error?: string } {
  const read = readJsonc(join(root, SOLUTION_FILE));
  if (read.error !== undefined) {
    return { dirs: new Set(), error: `${SOLUTION_FILE} ${read.error}` };
  }
  const references = asRecord(read.value).references;
  const paths = Array.isArray(references)
    ? references.map((entry) => asRecord(entry).path).filter((path): path is string => typeof path === 'string')
    : [];
  return { dirs: new Set(paths.map((path) => referencedDir(resolve(root, path)))) };
}

/**
 * The `paths` aliases of `tsconfig.packages.json`, each with its first
 * target made absolute. A missing file maps nothing.
 *
 * @param root - The absolute root.
 * @returns The aliases, longest prefix first, the order `tsc` tries them in.
 */
function pathAliases(root: string): PathAlias[] {
  const file = join(root, PATHS_FILE);
  const options = asRecord(asRecord(readJsonc(file).value).compilerOptions);
  const baseUrl = typeof options.baseUrl === 'string'
    ? resolve(dirname(file), options.baseUrl)
    : dirname(file);
  return Object.entries(asRecord(options.paths)).flatMap(([pattern, targets]) => {
    const first: unknown = Array.isArray(targets)
      ? targets[0]
      : undefined;
    if (typeof first !== 'string') {
      return [];
    }
    const star = pattern.indexOf('*');
    return [{
      prefix: star < 0
        ? pattern
        : pattern.slice(0, star),
      suffix: star < 0
        ? ''
        : pattern.slice(star + 1),
      wildcard: star >= 0,
      target: resolve(baseUrl, first),
    }];
  })
    .sort((left, right) => right.prefix.length - left.prefix.length);
}

/**
 * The package a bare `@open-tomato/*` specifier names: the member a
 * `paths` alias resolves it into, else its first two segments.
 *
 * @param specifier - A specifier opening with `@open-tomato/`.
 * @param aliases - The aliases of `tsconfig.packages.json`.
 * @param members - Every member.
 * @returns The package name a manifest must declare.
 */
function namedPackage(specifier: string, aliases: readonly PathAlias[], members: readonly Member[]): string {
  const alias = aliases.find((entry) => entry.wildcard
    ? specifier.startsWith(entry.prefix) && specifier.endsWith(entry.suffix)
      && specifier.length >= entry.prefix.length + entry.suffix.length
    : specifier === entry.prefix);
  const target = alias === undefined
    ? undefined
    : alias.target.replace('*', specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length));
  const owner = target === undefined
    ? undefined
    : members.find((member) => target === member.absolute || target.startsWith(`${member.absolute}/`));
  return owner?.name ?? specifier.split('/')
    .slice(0, 2)
    .join('/');
}

/**
 * Every code file under a member, skipping the folders no import is
 * written in.
 *
 * @param dir - The absolute directory to walk.
 * @returns The absolute paths of its `.ts`, `.mjs` and `.js` files, sorted.
 */
function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name)
        ? []
        : codeFiles(path);
    }
    return entry.isFile() && CODE_FILE.test(entry.name)
      ? [path]
      : [];
  })
    .sort();
}

/**
 * The bare `@open-tomato/*` specifiers each code file of a member imports.
 *
 * @param member - The member.
 * @returns One entry per code file, sorted by file, each specifier once.
 */
function scopedImports(member: Member): FileImports[] {
  return codeFiles(member.absolute).map((file) => ({
    file: relative(member.absolute, file),
    specifiers: [...new Set(ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles
      .map((imported) => imported.fileName)
      .filter((specifier) => specifier.startsWith(SCOPE)))],
  }));
}

/**
 * The reasons a member's bare `@open-tomato/*` imports refuse it: one per
 * undeclared package, naming each file that imports it. A publishable
 * member's imports of the root package are the publish rules' to hold,
 * in the files it ships; in the others they are not read.
 *
 * @param member - The member.
 * @param imports - The member's scoped imports, from {@link scopedImports}.
 * @param aliases - The aliases of `tsconfig.packages.json`.
 * @param members - Every member.
 * @returns The reasons, sorted by package.
 */
function importReasons(
  member: Member,
  imports: readonly FileImports[],
  aliases: readonly PathAlias[],
  members: readonly Member[],
): string[] {
  const declared = new Set([member.name, ...dependencyPairs(member.manifest, DECLARING_FIELDS).map(([name]) => name)]);
  const publishable = isPublishable(member.manifest);
  const undeclared = new Map<string, string[]>();
  for (const { file, specifiers } of imports) {
    for (const specifier of specifiers.filter((entry) => !publishable || !namesRootPackage(entry))) {
      const name = namedPackage(specifier, aliases, members);
      if (!declared.has(name)) {
        undeclared.set(name, [...undeclared.get(name) ?? [], `${file} (${specifier})`]);
      }
    }
  }
  return [...undeclared.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, files]) => `imports ${name}, which no dependency field declares: ${files.join(', ')}`);
}

/**
 * The reasons a member's scripts refuse it: one per task with no script.
 *
 * @param member - The member.
 * @param tasks - The task names of the root `turbo.json`.
 * @returns The reasons, in task order.
 */
function scriptReasons(member: Member, tasks: readonly string[]): string[] {
  const scripts = asRecord(member.manifest.scripts);
  return tasks
    .filter((task) => task !== TYPED_TASK || member.tsconfig !== undefined)
    .filter((task) => typeof scripts[task] !== 'string' || (scripts[task] as string).trim() === '')
    .map((task) => `no "${task}" script for the ${TURBO_FILE} task`);
}

/**
 * The reasons a member's `tsconfig.json` refuses it.
 *
 * @param member - The member.
 * @param solution - The directories the solution file references.
 * @param members - Every member.
 * @returns The reasons; none for a member with no `tsconfig.json`.
 */
function tsconfigReasons(member: Member, solution: ReadonlySet<string>, members: readonly Member[]): string[] {
  const config = member.tsconfig;
  if (config === undefined) {
    return [];
  }
  const composite = config.composite
    ? []
    : ['tsconfig.json is not composite'];
  const listed = solution.has(member.absolute)
    ? []
    : [`tsconfig.json is missing from ${SOLUTION_FILE}`];
  const references = new Set(config.references);
  const omitted = dependencyPairs(member.manifest, WORKSPACE_FIELDS)
    .filter(([, range]) => range.startsWith('workspace:'))
    .flatMap(([name]) => members.filter((other) => other.name === name && other !== member))
    .filter((other) => other.tsconfig?.composite === true && !references.has(other.absolute))
    .map((other) => `tsconfig.json references omit ${other.name} (${other.dir}), a declared workspace dependency`);
  return [...config.errors, ...composite, ...listed, ...[...new Set(omitted)]];
}

/**
 * Reads one member's manifest and `tsconfig.json`.
 *
 * @param root - The absolute root.
 * @param dir - The member's directory, relative to the root.
 * @returns The member, with the reason its manifest is unreadable if it is.
 */
function readMember(root: string, dir: string): { readonly member: Member; readonly error?: string } {
  const absolute = resolve(root, dir);
  const read = readJsonc(join(absolute, 'package.json'));
  const manifest = asRecord(read.value);
  const name = typeof manifest.name === 'string'
    ? manifest.name
    : dir;
  const member = { dir, absolute, name, manifest, tsconfig: readTsconfig(absolute) };
  return read.error === undefined
    ? { member }
    : { member, error: `package.json ${read.error}` };
}

/**
 * The task names of the root `turbo.json`: each `tasks` key that names
 * no single package (`<package>#<task>`).
 *
 * @param root - The absolute root.
 * @returns The task names, or the reason none could be read.
 */
function turboTasks(root: string): { readonly tasks: readonly string[]; readonly error?: string } {
  const read = readJsonc(join(root, TURBO_FILE));
  if (read.error !== undefined) {
    return { tasks: [], error: `${TURBO_FILE} ${read.error}` };
  }
  const tasks = Object.keys(asRecord(asRecord(read.value).tasks)).filter((task) => !task.includes('#'));
  return tasks.length === 0
    ? { tasks, error: `${TURBO_FILE} defines no task` }
    : { tasks };
}

/**
 * Runs every check over the tree at `root`.
 *
 * @param root - The repository root: the directory of the root `package.json`.
 * @returns The root's refusals and each member's verdict.
 */
export function checkGraph(root: string): GraphReport {
  const absoluteRoot = resolve(root);
  const rootManifest = readJsonc(join(absoluteRoot, 'package.json'));
  const globs = workspaceGlobs(asRecord(rootManifest.value));
  const turbo = turboTasks(absoluteRoot);
  const solution = solutionDirs(absoluteRoot);
  const readings = memberDirs(absoluteRoot, globs).map((dir) => readMember(absoluteRoot, dir));
  const members = readings.map((reading) => reading.member);
  const aliases = pathAliases(absoluteRoot);
  const privateNames = new Set(members.filter((member) => !isPublishable(member.manifest)).map((member) => member.name));
  const keys = exportKeys(asRecord(rootManifest.value));
  const rootReasons = [
    ...rootManifest.error === undefined
      ? []
      : [`package.json ${rootManifest.error}`],
    ...rootManifest.error === undefined && globs.length === 0
      ? ['package.json names no workspaces glob']
      : [],
    ...globs.length > 0 && members.length === 0
      ? [`the workspaces globs (${globs.join(', ')}) name no member`]
      : [],
    ...turbo.error === undefined
      ? []
      : [turbo.error],
    ...solution.error === undefined
      ? []
      : [solution.error],
  ];
  return {
    root: rootReasons,
    members: readings.map(({ member, error }) => {
      const imports = scopedImports(member);
      return {
        dir: member.dir,
        name: member.name,
        reasons: [
          ...error === undefined
            ? []
            : [error],
          ...scriptReasons(member, turbo.tasks),
          ...tsconfigReasons(member, solution.dirs, members),
          ...importReasons(member, imports, aliases, members),
          ...error === undefined && isPublishable(member.manifest)
            ? publishReasons(member.manifest, shippedImports(member.manifest, imports), privateNames, keys)
            : [],
        ],
      };
    }),
  };
}

/**
 * Whether a report refuses nothing.
 *
 * @param report - A report of {@link checkGraph}.
 * @returns `true` when the root and every member hold.
 */
export function graphHolds(report: GraphReport): boolean {
  return report.root.length === 0 && report.members.every((member) => member.reasons.length === 0);
}

/**
 * The lines a report prints: the root's refusals, then one line per
 * member that holds and one per reason of each member that does not.
 *
 * @param report - A report of {@link checkGraph}.
 * @returns The lines, in report order.
 */
export function renderReport(report: GraphReport): string[] {
  return [
    ...report.root.map((reason) => `root: ${reason}`),
    ...report.members.flatMap((member) => member.reasons.length === 0
      ? [`${member.dir} (${member.name}): ok`]
      : member.reasons.map((reason) => `${member.dir} (${member.name}): ${reason}`)),
  ];
}

/**
 * The command: checks the tree at `--root` (the working directory when
 * none is given) and writes the report.
 *
 * @param args - The arguments after the script path.
 * @param write - Where each line goes.
 * @returns The exit code: 0 when the graph holds, 1 otherwise.
 */
export function main(args: readonly string[], write: (line: string) => void): number {
  const flag = args.indexOf('--root');
  const root = flag >= 0 && args[flag + 1] !== undefined
    ? args[flag + 1] as string
    : process.cwd();
  const report = checkGraph(root);
  for (const line of renderReport(report)) {
    write(line);
  }
  return graphHolds(report)
    ? 0
    : 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), (line) => console.log(line)));
}
