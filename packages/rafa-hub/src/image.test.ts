/**
 * The image's drift guards: `packages/rafa-hub/Dockerfile` names its
 * build stage's copies by hand, so these cases hold them to the tree. The
 * workspace manifests it copies before the install must be every
 * workspace's, since a frozen install refuses a lockfile whose workspaces
 * are missing; and the packages whose folders it copies after the install
 * must be the hub's workspace closure, the members its `dependencies`
 * reach through `workspace:` specs, so the next hub import of a sibling
 * package fails here, not first in the image. Each list has a control
 * that proves the comparison can fail.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

/** The build stage's lines: from the first `FROM` up to the second, backslash continuations joined. */
function buildStage(dockerfile: string): string[] {
  const lines = dockerfile.replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim());
  const froms = lines.flatMap((line, index) => line.startsWith('FROM ')
    ? [index]
    : []);

  return lines.slice(froms[0], froms[1]);
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

const DOCKERFILE = await Bun.file(join(ROOT, HUB_DIR, 'Dockerfile')).text();
const WORKSPACES = await workspaceDirs();
const WORKSPACE_MANIFESTS = WORKSPACES.map((dir) => `${dir}/${MANIFEST}`).sort();

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
