/**
 * The published JavaScript build: the three `bun build` runs of the root
 * `build` script, each with every publishable workspace package left
 * external, and a guard that fails the build when a bundle holds a file
 * of one anyway.
 *
 * Usage, from the repository root (the `build` script runs it this way,
 * after `rm -rf dist` and before its `tsc` and `cp` segments):
 *
 *   bun scripts/build/bundle.ts [--root <dir>] [--out <dir>] [--no-externals]
 *
 * `--root` is the directory holding the root `package.json` and `src/`,
 * the working directory when none is given; `--out` is where the bundles
 * are written, relative to the root, `dist` when none is given.
 * `--no-externals` builds with no `--external` at all, so a test can make
 * the guard fail; the `build` script never passes it.
 *
 * The script:
 *
 *   1. reads the workspace with `readWorkspacePackages(root)` and refuses
 *      a root it cannot read, exit 1. A member whose manifest sets no
 *      `private: true` publishes on its own, so its name is passed as
 *      `--external <name>`, which bun applies to `<name>` and every
 *      `<name>/<subpath>` before it resolves the import: the bundle keeps
 *      the bare specifier. A private member (`@open-tomato/rafa-core`)
 *      stays bundled, as it was before this script;
 *   2. runs the three builds of {@link bundlesFor}: `src/rafa.ts` alone
 *      to `<out>/cli.js`, the five library entries under `src/` together
 *      with `--splitting --root=src` into `<out>/`, and the learning
 *      entry alone to `<out>/learning/index.js`. Each runs as
 *      `process.execPath build …` with its working directory at the root
 *      and `--metafile` pointed into a scratch directory, as
 *      `scripts/survey/import-graph.ts`'s `readMetafile` does. A build
 *      that exits non-zero fails the script with bun's own words;
 *   3. reads each metafile through {@link bundledPackageFiles}, which is
 *      pure. Bun keys each input by its path relative to the build's
 *      working directory (`packages/plugin/src/index.ts`) and records
 *      each import by the absolute path it reached, or by the bare
 *      specifier with `external: true` when it left the import out, so
 *      an external package's files never appear as inputs. Any finding
 *      fails the build, exit 1, with one line per finding
 *      ({@link findingLine}):
 *      `dist/cli.js bundles packages/plugin/src/index.ts of @scope/plugin, imported by src/plugins/load.ts`;
 *   4. prints one line per bundle naming the externals it was built
 *      with ({@link externalsLine}), and exits 0.
 */
import type { WorkspacePackage } from '@open-tomato/rafa-release';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import { publishableOf, readWorkspacePackages } from '@open-tomato/rafa-release';

/** Where the bundles are written, relative to the root, when `--out` names nothing. */
export const DEFAULT_OUT = 'dist';

/** The flag that skips the `--external` list; the tests alone pass it. */
export const NO_EXTERNALS_FLAG = '--no-externals';

/** The flags that take a value. */
const VALUE_FLAGS: readonly string[] = ['--root', '--out'];

/** The five library entries under `src/`, built together so their shared code sits in one set of chunks. */
export const LIBRARY_ENTRIES: readonly string[] = [
  'src/index.ts',
  'src/plan/index.ts',
  'src/effort/store/index.ts',
  'src/ports/index.ts',
  'src/config/index.ts',
];

/**
 * The entry of the root's `./learning` subpath, in the inventory package
 * since pass 4a (#808). It lies outside `src/`, so the `--root=src` of
 * the library build would write it outside `<out>/`; it imports nothing
 * but `node:crypto` and shares no code with the other entries, so it is
 * built alone to `<out>/learning/index.js` instead.
 */
export const LEARNING_ENTRY = 'packages/rafa-inventory/src/learning/index.ts';

/** One `bun build` run of the script. */
export interface BundleSpec {
  /** What the lines call it: the file it writes, or the directory for the library build. */
  readonly label: string;
  /** The `bun build` arguments, before the externals and the metafile. */
  readonly args: readonly string[];
}

/**
 * The three builds: the two in the order the `build` script ran them,
 * then the learning entry's.
 *
 * @param out - The output directory as the lines spell it: `dist`, or the
 *   `--out` value.
 * @param outPath - The same directory as `bun build` is handed it.
 * @returns The CLI bundle, the library build, then the learning bundle.
 */
export function bundlesFor(out: string, outPath: string): BundleSpec[] {
  const dir = out.replace(/\/+$/, '');
  return [
    {
      label: posix.join(dir, 'cli.js'),
      args: ['src/rafa.ts', '--target=bun', `--outfile=${join(outPath, 'cli.js')}`],
    },
    {
      label: `${dir}/`,
      args: [...LIBRARY_ENTRIES, '--target=bun', '--splitting', '--root=src', `--outdir=${outPath}`],
    },
    {
      label: posix.join(dir, 'learning', 'index.js'),
      args: [LEARNING_ENTRY, '--target=bun', `--outfile=${join(outPath, 'learning', 'index.js')}`],
    },
  ];
}

/** One import recorded under an input of a metafile. */
export interface BundleImport {
  /** The absolute path imported, or the specifier when bun left it out. */
  readonly path: string;
  /** Set when bun left the import out of the bundle. */
  readonly external?: boolean;
}

/** The part of a `bun build --metafile` file the guard reads. */
export interface BundleMetafile {
  /** Each input, keyed by its path relative to the build's working directory. */
  readonly inputs: Readonly<Record<string, { readonly imports: readonly BundleImport[] }>>;
}

/** A file of a publishable package that a bundle holds. */
export interface BundledPackageFile {
  /** The file, relative to the root, `/` between segments. */
  readonly file: string;
  /** The `name` of the package whose `dir` holds it. */
  readonly packageName: string;
  /** Every input importing it, relative to the root, sorted. */
  readonly importers: readonly string[];
}

/**
 * A metafile path made relative to the root, `/` between segments: an
 * absolute path is taken relative to `root`, any other is already
 * relative to it, the build's working directory.
 *
 * @param path - An input key or an import's `path`.
 * @param root - The root the build ran in.
 * @returns The root-relative path.
 */
export function rootRelative(path: string, root: string): string {
  const relativePath = isAbsolute(path)
    ? relative(root, path)
    : path;
  return relativePath.split(sep).join('/')
    .replace(/^(?:\.\/)+/, '');
}

/**
 * The files of publishable packages a bundle holds: one finding per
 * input whose path, made relative to `root`, sits under a publishable
 * member's `dir`, with every input whose `imports` name that path,
 * absolute or relative. A private member's files are never findings.
 *
 * @param metafile - A metafile of a build run in `root`.
 * @param packages - The workspace members, private ones included.
 * @param root - The root the build ran in, against which absolute paths
 *   are made relative.
 * @returns The findings, sorted by file.
 */
export function bundledPackageFiles(
  metafile: BundleMetafile,
  packages: readonly WorkspacePackage[],
  root: string,
): BundledPackageFile[] {
  const publishable = publishableOf(packages);
  const inputs = Object.entries(metafile.inputs).map(([key, input]) => ({
    file: rootRelative(key, root),
    imported: input.imports
      .filter((imported) => imported.external !== true)
      .map((imported) => rootRelative(imported.path, root)),
  }));
  return inputs
    .flatMap(({ file }) => {
      const owner = publishable.find((member) => file === member.dir || file.startsWith(`${member.dir}/`));
      if (owner === undefined) return [];
      const importers = inputs
        .filter((input) => input.imported.includes(file))
        .map((input) => input.file);
      return [{ file, packageName: owner.name, importers: [...new Set(importers)].sort() }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

/**
 * The line a finding fails the build with.
 *
 * @param label - The bundle's label.
 * @param finding - One finding of {@link bundledPackageFiles}.
 * @returns `<label> bundles <file> of <name>, imported by <importers>`.
 */
export function findingLine(label: string, finding: BundledPackageFile): string {
  const importers = finding.importers.length > 0
    ? finding.importers.join(', ')
    : 'no input';
  return `${label} bundles ${finding.file} of ${finding.packageName}, imported by ${importers}`;
}

/**
 * The line a bundle built clean prints.
 *
 * @param label - The bundle's label.
 * @param externals - The package names passed as `--external`.
 * @returns `<label> built with externals: <names>`, or `none`.
 */
export function externalsLine(label: string, externals: readonly string[]): string {
  const names = externals.length > 0
    ? externals.join(', ')
    : 'none';
  return `${label} built with externals: ${names}`;
}

/** What the arguments ask for, or the sentence refusing them. */
export type BundleArgs =
  | { readonly ok: true; readonly root: string; readonly out: string; readonly externals: boolean }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads the script's arguments.
 *
 * @param args - The arguments after the script path.
 * @param cwd - The root when `--root` names none.
 * @returns The root, the output directory as given, and whether the
 *   externals are passed; or the problem for an unknown argument or a
 *   flag with no value.
 */
export function parseBundleArgs(args: readonly string[], cwd: string): BundleArgs {
  const values = new Map<string, string>();
  let externals = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === NO_EXTERNALS_FLAG) {
      externals = false;
      continue;
    }
    if (!VALUE_FLAGS.includes(arg)) return { ok: false, problem: `unknown argument ${arg}` };
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, problem: `${arg} needs a value` };
    values.set(arg, value);
    index += 1;
  }
  return { ok: true, root: values.get('--root') ?? cwd, out: values.get('--out') ?? DEFAULT_OUT, externals };
}

/** True for a value shaped as {@link BundleMetafile}. */
function isMetafile(value: unknown): value is BundleMetafile {
  if (typeof value !== 'object' || value === null) return false;
  const inputs = (value as { inputs?: unknown }).inputs;
  if (typeof inputs !== 'object' || inputs === null) return false;
  return Object.values(inputs).every((input: unknown) => typeof input === 'object' && input !== null
    && Array.isArray((input as { imports?: unknown }).imports));
}

/** One build's outcome: its metafile, or bun's words for why it failed. */
type BuildRun =
  | { readonly ok: true; readonly metafile: BundleMetafile }
  | { readonly ok: false; readonly problem: string };

/** Runs one build in `root` and reads the metafile it wrote at `metafilePath`. */
function runBuild(
  spec: BundleSpec,
  externals: readonly string[],
  root: string,
  metafilePath: string,
): BuildRun {
  const build = Bun.spawnSync(
    [
      process.execPath,
      'build',
      ...spec.args,
      ...externals.flatMap((name) => ['--external', name]),
      `--metafile=${metafilePath}`,
    ],
    { cwd: root, stderr: 'pipe', stdout: 'pipe' },
  );
  if (build.exitCode !== 0) {
    const said = build.stderr.toString().trim() || build.stdout.toString().trim();
    return { ok: false, problem: `${spec.label}: bun build exited ${build.exitCode}: ${said}` };
  }
  const parsed: unknown = JSON.parse(readFileSync(metafilePath, 'utf8'));
  return isMetafile(parsed)
    ? { ok: true, metafile: parsed }
    : { ok: false, problem: `${spec.label}: ${metafilePath} is no metafile` };
}

/**
 * The command: builds every bundle in the root, guards each, and writes
 * the lines.
 *
 * @param args - The arguments after the script path.
 * @param write - Where each line goes.
 * @returns The exit code: 0 when every bundle built and holds no file of
 *   a publishable package, 1 otherwise.
 */
export function main(args: readonly string[], write: (line: string) => void): number {
  const parsed = parseBundleArgs(args, process.cwd());
  if (!parsed.ok) {
    write(`bundle: ${parsed.problem}`);
    return 1;
  }
  const root = resolve(parsed.root);
  const workspace = readWorkspacePackages(root);
  if (!workspace.ok) {
    write(`bundle: ${workspace.problem}`);
    return 1;
  }
  const externals = parsed.externals
    ? publishableOf(workspace.packages).map((member) => member.name)
    : [];
  const realRoot = realpathSync.native(root);
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-bundle-'));
  try {
    const failures: string[] = [];
    const specs = bundlesFor(parsed.out, resolve(root, parsed.out));
    for (const [index, spec] of specs.entries()) {
      const built = runBuild(spec, externals, root, join(scratch, `${index}.json`));
      if (!built.ok) {
        failures.push(built.problem);
        break;
      }
      const findings = bundledPackageFiles(built.metafile, workspace.packages, realRoot);
      failures.push(...findings.map((finding) => findingLine(spec.label, finding)));
    }
    const lines = failures.length > 0
      ? failures
      : specs.map((spec) => externalsLine(spec.label, externals));
    for (const line of lines) {
      write(line);
    }
    return failures.length > 0
      ? 1
      : 0;
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), (line) => console.log(line)));
}
