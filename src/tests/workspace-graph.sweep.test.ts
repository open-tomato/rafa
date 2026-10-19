/**
 * The workspace-graph sweep: runs the graph check,
 * `scripts/workspace/graph-check.ts`, over the live tree, so the runner's
 * always-run sweeps refuse a workspace member that the turbo task graph,
 * the `tsc --build` solution file or the isolated linker cannot see whole
 * before CI ring 1 does.
 *
 * The check reads the tree at run time, so the `.sweep.test.ts` suffix is
 * what has `tests.alwaysRun` run it. Each refusal has a planted-tree
 * control in `scripts/workspace/graph-check.test.ts`; here, the members the
 * check read are held to the folders under `packages/` that hold a
 * manifest, so a reading that found no member cannot pass as a clean one.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { checkGraph, main } from '../../scripts/workspace/graph-check.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The folder the root manifest's one `workspaces` glob, `packages/*`, names. */
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** The folders under `packages/` that hold a manifest, as the check spells a member. */
function manifestFolders(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES_DIR, entry.name, 'package.json')))
    .map((entry) => `packages/${entry.name}`)
    .sort();
}

describe('the workspace graph of the live tree', () => {
  test('every member holds: the command exits 0 with one ok line per member', () => {
    const lines: string[] = [];

    const code = main(['--root', REPO_ROOT], (line) => lines.push(line));

    expect(lines.filter((line) => !line.endsWith(': ok'))).toEqual([]);
    expect(code).toBe(0);
    expect(lines).toHaveLength(manifestFolders().length);
  });

  test('control: the check read every folder under packages/ that holds a manifest', () => {
    const report = checkGraph(REPO_ROOT);

    expect(report.root).toEqual([]);
    expect(report.members.map((member) => member.dir)).toEqual(manifestFolders());
    expect(manifestFolders().length).toBeGreaterThan(0);
  });
});
