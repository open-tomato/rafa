/**
 * The image's drift guards: `packages/rafa-hub/Dockerfile` names its
 * build stage's copies by hand, so these cases hold them to the tree. The
 * workspace manifests it copies before the install must be every
 * workspace's, since a frozen install refuses a lockfile whose workspaces
 * are missing; and the packages whose folders it copies after the install
 * must be the hub's workspace closure, the members its `dependencies`
 * reach through `workspace:` specs, so the next hub import of a sibling
 * package fails here, not first in the image. The `hub-image` job of
 * `.github/workflows/verify.yml` builds the image only when a pull request
 * changes a path its `HUB_PATHS` names, so that list is held to the same
 * closure: each of its folders named, no other package's, the files the
 * image is built from at the root, and every file `bin.ts` reaches through
 * its run-time imports. The runtime stage's `ENV` names the `.ts` config
 * on the volume and its `HEALTHCHECK` runs `rafa-hub health`, the entry
 * the `CMD` runs. Each list and line has a control that proves the
 * comparison can fail.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HUB_DIR = 'packages/rafa-hub';
const MANIFEST = 'package.json';

/** The files the build stage copies from the root itself, which are neither a manifest of a workspace nor a package. */
const ROOT_FILES: readonly string[] = [MANIFEST, 'bun.lock', 'tsconfig.packages.json'];

/** The fields of a `package.json` these cases read. */
interface Manifest {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
}

function readManifest(dir: string): Promise<Manifest> {
  return Bun.file(join(ROOT, dir, MANIFEST)).json() as Promise<Manifest>;
}

/** The workspace folders the root manifest names, its `dir/*` globs expanded to the folders under `dir` holding a manifest. */
async function workspaceDirs(): Promise<string[]> {
  const { workspaces = [] } = await readManifest('.');

  return workspaces.flatMap((entry) => {
    if (!entry.endsWith('/*')) {
      return existsSync(join(ROOT, entry, MANIFEST))
        ? [entry]
        : [];
    }

    const parent = entry.slice(0, -'/*'.length);

    return readdirSync(join(ROOT, parent), { withFileTypes: true })
      .filter((child) => child.isDirectory() && existsSync(join(ROOT, parent, child.name, MANIFEST)))
      .map((child) => `${parent}/${child.name}`);
  }).sort();
}

/** The hub's folder and every workspace folder its production `dependencies` reach through `workspace:` specs, sorted. */
async function hubClosure(dirs: readonly string[]): Promise<string[]> {
  const manifests = await Promise.all(dirs.map(async (dir) => [dir, await readManifest(dir)] as const));
  const dirOf = new Map(manifests.map(([dir, manifest]) => [manifest.name, dir]));
  const manifestOf = new Map(manifests);
  const reached = new Set<string>();
  const pending = [HUB_DIR];

  while (pending.length > 0) {
    const dir = pending.pop() as string;

    if (reached.has(dir)) {
      continue;
    }

    reached.add(dir);

    const dependencies = Object.entries(manifestOf.get(dir)?.dependencies ?? {});

    for (const [name, spec] of dependencies) {
      const target = dirOf.get(name);

      if (spec.startsWith('workspace:') && target !== undefined) {
        pending.push(target);
      }
    }
  }

  return [...reached].sort();
}

/** The Dockerfile's lines, trimmed, backslash continuations joined. */
function joinedLines(dockerfile: string): string[] {
  return dockerfile.replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim());
}

/** The build stage's lines: from the first `FROM` up to the second, backslash continuations joined. */
function buildStage(dockerfile: string): string[] {
  const lines = joinedLines(dockerfile);
  const froms = lines.flatMap((line, index) => line.startsWith('FROM ')
    ? [index]
    : []);

  return lines.slice(froms[0], froms[1]);
}

/** The runtime stage's lines: from the last `FROM` to the end, backslash continuations joined. */
function runtimeStage(dockerfile: string): string[] {
  const lines = joinedLines(dockerfile);
  const froms = lines.flatMap((line, index) => line.startsWith('FROM ')
    ? [index]
    : []);

  return lines.slice(froms.at(-1));
}

/** The value the stage's `ENV` lines set for `name`, in `ENV name=value` form; the last line wins. */
function envValue(stage: readonly string[], name: string): string | undefined {
  const prefix = `ENV ${name}=`;

  return stage.filter((line) => line.startsWith(prefix))
    .at(-1)
    ?.slice(prefix.length);
}

/** The exec-form argument list `text` opens with, or `undefined` when it opens with no `[`. */
function execForm(text: string | undefined): string[] | undefined {
  return text?.startsWith('[')
    ? JSON.parse(text) as string[]
    : undefined;
}

/** The stage's `HEALTHCHECK` command, in exec form: the list after its `CMD` word. */
function healthCommand(stage: readonly string[]): string[] | undefined {
  const line = stage.find((each) => each.startsWith('HEALTHCHECK '));

  return execForm(line?.split(' CMD ')[1]);
}

/** The stage's `CMD`, in exec form; the last line wins. */
function startCommand(stage: readonly string[]): string[] | undefined {
  const line = stage.filter((each) => each.startsWith('CMD '))
    .at(-1);

  return execForm(line?.slice('CMD '.length));
}

/** The sources of the build stage's `COPY` lines from the build context, in order; a line's last word is its destination. */
function copiedSources(stage: readonly string[]): string[] {
  return stage
    .filter((line) => line.startsWith('COPY '))
    .map((line) => line.split(/\s+/).slice(1))
    .filter((words) => !words.some((word) => word.startsWith('--from=')))
    .flatMap((words) => words.filter((word) => !word.startsWith('--')).slice(0, -1));
}

function copiedManifests(sources: readonly string[]): string[] {
  return sources.filter((source) => source.endsWith(`/${MANIFEST}`)).sort();
}

function copiedPackages(sources: readonly string[]): string[] {
  return sources
    .filter((source) => !ROOT_FILES.includes(source) && !source.endsWith(`/${MANIFEST}`))
    .sort();
}

/** The `hub-image` job's changed-path step, by its `id`, and the environment variable holding its list. */
const PATHS_STEP = 'paths';
const PATHS_VARIABLE = 'HUB_PATHS';

/** The file the image runs, through its `rafa-hub` wrapper. */
const ENTRY = `${HUB_DIR}/src/bin.ts`;

/** The parts of the workflow file these cases read. */
interface Workflow {
  jobs?: Record<string, { steps?: { id?: string; env?: Record<string, string> }[] }>;
}

/** The paths the `hub-image` job's changed-path step names, one per line; a path ending in `/` names a folder. */
function hubPaths(workflow: string): string[] {
  const { jobs = {} } = Bun.YAML.parse(workflow) as Workflow;
  const step = jobs['hub-image']?.steps?.find((each) => each.id === PATHS_STEP);

  return (step?.env?.[PATHS_VARIABLE] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Whether `file`, from the root, lies under `paths` as the job's step reads them: in a folder named, or named itself. */
function covered(file: string, paths: readonly string[]): boolean {
  return paths.some((path) => path.endsWith('/')
    ? file.startsWith(path)
    : file === path);
}

/** The closure folders no path of `paths` names, whole or by a subpath. */
function unnamedFolders(closure: readonly string[], paths: readonly string[]): string[] {
  return closure.filter((dir) => !paths.some((path) => path.startsWith(`${dir}/`)));
}

/** The paths of `paths` inside a workspace folder that is not in `closure`. */
function pathsOutside(closure: readonly string[], paths: readonly string[], workspaces: readonly string[]): string[] {
  return paths.filter((path) => workspaces.some((dir) => path.startsWith(`${dir}/`))
    && !closure.some((dir) => path.startsWith(`${dir}/`)));
}

const TRANSPILER = new Bun.Transpiler({ loader: 'ts' });

/** A file whose imports are read; any other reached file (a JSON manifest) is a leaf. */
const SCRIPT = /\.(?:ts|js)$/;

/** A built-in module, which no folder holds. */
const BUILT_IN = /^(?:node:|bun)/;

/**
 * Every file under the root, outside `node_modules`, that `ENTRY` reaches
 * through its run-time imports, resolved as bun resolves them, `paths`
 * aliases included; type-only imports are erased before the run, so the
 * scan leaves them out.
 */
async function runtimeReach(): Promise<string[]> {
  const reached = new Set<string>();
  const pending = [join(ROOT, ENTRY)];

  while (pending.length > 0) {
    const file = pending.pop() as string;

    if (reached.has(file)) {
      continue;
    }

    reached.add(file);

    if (!SCRIPT.test(file)) {
      continue;
    }

    const source = (await Bun.file(file).text()).replace(/^#!.*/, '');

    for (const { path } of TRANSPILER.scanImports(source)) {
      if (BUILT_IN.test(path)) {
        continue;
      }

      const target = Bun.resolveSync(path, dirname(file));

      if (!target.includes('/node_modules/')) {
        pending.push(target);
      }
    }
  }

  return [...reached].map((file) => relative(ROOT, file)).sort();
}

const DOCKERFILE = await Bun.file(join(ROOT, HUB_DIR, 'Dockerfile')).text();
const WORKSPACES = await workspaceDirs();
const WORKSPACE_MANIFESTS = WORKSPACES.map((dir) => `${dir}/${MANIFEST}`).sort();
const WORKFLOW = await Bun.file(join(ROOT, '.github/workflows/verify.yml')).text();
const HUB_PATHS = hubPaths(WORKFLOW);

describe('the hub image\'s build stage', () => {
  it('copies the manifest of every workspace, and no other', () => {
    const copied = copiedManifests(copiedSources(buildStage(DOCKERFILE)));

    expect(copied).toEqual(WORKSPACE_MANIFESTS);
  });

  it('control: the workspaces read hold the hub and a named member, and a manifest line taken out reads short', () => {
    expect(WORKSPACES).toContain(HUB_DIR);
    expect(WORKSPACES).toContain('addons/rafa-d2c');

    const without = DOCKERFILE.replace('COPY addons/rafa-d2c/package.json addons/rafa-d2c/\n', '');

    expect(without).not.toBe(DOCKERFILE);
    expect(copiedManifests(copiedSources(buildStage(without))))
      .not.toEqual(WORKSPACE_MANIFESTS);
  });

  it('copies the folders of the hub\'s workspace closure, and no other', async () => {
    const copied = copiedPackages(copiedSources(buildStage(DOCKERFILE)));

    expect(copied).toEqual(await hubClosure(WORKSPACES));
  });

  it('control: the closure reaches core and the index through their names, and the index\'s line taken out reads short', async () => {
    const closure = await hubClosure(WORKSPACES);

    expect(closure).toEqual(expect.arrayContaining([HUB_DIR, 'packages/rafa', 'packages/rafa-index']));

    const without = DOCKERFILE.replace('COPY packages/rafa-index packages/rafa-index\n', '');

    expect(without).not.toBe(DOCKERFILE);
    expect(copiedPackages(copiedSources(buildStage(without)))).not.toEqual(closure);
  });

  it('installs from the lockfile over the manifests alone, before any package folder is copied', () => {
    const stage = buildStage(DOCKERFILE);
    const install = stage.findIndex((line) => line.startsWith('RUN bun install '));
    const before = copiedSources(stage.slice(0, install));
    const after = copiedSources(stage.slice(install));

    expect(stage[install]).toBe('RUN bun install --frozen-lockfile --production --ignore-scripts --filter=@open-tomato/rafa-hub');
    expect(before).toEqual(expect.arrayContaining([MANIFEST, 'bun.lock']));
    expect(copiedPackages(before)).toEqual([]);
    expect(copiedManifests(after)).toEqual([]);
    expect(copiedPackages(after).length).toBeGreaterThan(0);
  });
});

/** The config file the image names, on its volume. */
const IMAGE_CONFIG = '/data/rafa-hub.config.ts';

/** The image's entry, the wrapper on the `PATH`. */
const WRAPPER = 'rafa-hub';

describe('the hub image\'s runtime stage', () => {
  it('names the .ts config on the volume as RAFA_HUB_CONFIG', () => {
    expect(envValue(runtimeStage(DOCKERFILE), 'RAFA_HUB_CONFIG')).toBe(IMAGE_CONFIG);
  });

  it('control: the YAML file named instead reads as another value', () => {
    const yaml = DOCKERFILE.replace(`ENV RAFA_HUB_CONFIG=${IMAGE_CONFIG}\n`, 'ENV RAFA_HUB_CONFIG=/data/rafa-hub.yaml\n');

    expect(yaml).not.toBe(DOCKERFILE);
    expect(envValue(runtimeStage(yaml), 'RAFA_HUB_CONFIG')).toBe('/data/rafa-hub.yaml');
  });

  it('runs rafa-hub health as its health check, in exec form, through the wrapper the CMD runs', () => {
    const stage = runtimeStage(DOCKERFILE);

    expect(healthCommand(stage)).toEqual([WRAPPER, 'health']);
    expect(startCommand(stage)?.join(' ')).toContain(`exec ${WRAPPER}`);
  });

  it('control: the health check written in shell form, or as a bun script, reads as another command', () => {
    const exec = '  CMD ["rafa-hub", "health"]\n';
    const shell = DOCKERFILE.replace(exec, '  CMD rafa-hub health\n');
    const script = DOCKERFILE.replace(exec, '  CMD ["bun", "-e", "process.exit(0)"]\n');

    expect(shell).not.toBe(DOCKERFILE);
    expect(healthCommand(runtimeStage(shell))).toBeUndefined();
    expect(healthCommand(runtimeStage(script))).toEqual(['bun', '-e', 'process.exit(0)']);
  });
});

describe('the hub-image job\'s path list', () => {
  it('names every folder of the hub\'s workspace closure, and no other package\'s', async () => {
    const closure = await hubClosure(WORKSPACES);

    expect(HUB_PATHS.length).toBeGreaterThan(0);
    expect(unnamedFolders(closure, HUB_PATHS)).toEqual([]);
    expect(pathsOutside(closure, HUB_PATHS, WORKSPACES)).toEqual([]);
  });

  it('control: the index\'s folder taken out reads unnamed, and another package\'s added reads outside', async () => {
    const closure = await hubClosure(WORKSPACES);
    const without = hubPaths(WORKFLOW.replace('            packages/rafa-index/\n', ''));

    expect(without.length).toBe(HUB_PATHS.length - 1);
    expect(unnamedFolders(closure, without)).toEqual(['packages/rafa-index']);
    expect(pathsOutside(closure, [...HUB_PATHS, 'packages/rafa-board/'], WORKSPACES)).toEqual(['packages/rafa-board/']);
  });

  it('names the Dockerfile, the root files its build stage copies and the root .dockerignore', () => {
    const rootFiles = copiedSources(buildStage(DOCKERFILE)).filter((source) => ROOT_FILES.includes(source));

    expect(rootFiles.sort()).toEqual([...ROOT_FILES].sort());
    expect([`${HUB_DIR}/Dockerfile`, '.dockerignore', ...rootFiles].filter((file) => !covered(file, HUB_PATHS)))
      .toEqual([]);
  });

  it('covers every file bin.ts reaches through its run-time imports', async () => {
    const reach = await runtimeReach();

    expect(reach.filter((file) => !covered(file, HUB_PATHS))).toEqual([]);
  });

  it('control: the reach holds core\'s store and config, and core\'s folder taken out leaves them uncovered', async () => {
    const reach = await runtimeReach();
    const core = 'packages/rafa/src/core/';
    const without = HUB_PATHS.filter((path) => path !== core);

    expect(reach).toContain(ENTRY);
    expect(reach).toContain('packages/rafa/src/effort/store/index.ts');
    expect(reach.some((file) => file.startsWith(`${core}config/`))).toBe(true);
    expect(without.length).toBe(HUB_PATHS.length - 1);
    expect(reach.filter((file) => !covered(file, without)).length).toBeGreaterThan(0);
  });
});
