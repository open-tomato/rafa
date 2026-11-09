/**
 * The rafa-d2c add-on mounted the way a real invocation mounts it: a
 * planted project's `.rafa/config.yaml` names `addons/rafa-d2c` as a
 * `path` source on `allowList:`, `loadInvocationModules` loads it, and
 * `dispatch` routes `module exec @open-tomato/rafa-d2c <action>`.
 *
 * A module command finds its project from the working folder, as a real
 * `module exec` resolves none, so each case runs with the process inside
 * the planted project and moves back after.
 */
import type { OutputStream } from '@open-tomato/rafa/core/output';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadInvocationModules } from '@open-tomato/rafa/modules/load';

import { dispatch } from '../cli/dispatch.js';
import { renderHelp } from '../cli/help.js';
import { createRosterRegistry } from '../commands/index.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-d2c-mount-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ADDON = fileURLToPath(new URL('../../addons/rafa-d2c', import.meta.url));

/** A stream collecting what is written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return { stream: { write: (chunk) => chunks.push(chunk) > 0 }, text: () => chunks.join('') };
}

/** Plants a project enabling the add-on, with a local-dir store and an installed playwright-core; `runner` is its runner kind. */
function plantProject(runner: string): { root: string; home: string } {
  const scope = mkdtempSync(join(tempBase, 'project-'));
  const root = join(scope, 'root');
  const home = join(scope, 'home');
  for (const dir of [join(root, '.rafa'), join(root, 'packages', 'ui'), join(root, 'node_modules', 'playwright-core'), join(scope, 'store'), home]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(root, '.rafa', 'config.yaml'), `version: 1\nmodules:\n  - path: ${ADDON}\nallowList: ["@open-tomato/rafa-d2c"]\n`);
  writeFileSync(
    join(root, '.rafa', 'd2c.yaml'),
    `visual:\n  suite: { kind: storybook-jest, package: packages/ui, command: bun run test:visual }\n  runner: { kind: ${runner} }\n  store: { kind: local-dir, dir: ${join(scope, 'store')}, set: packages-ui }\n`,
  );
  writeFileSync(join(root, 'packages', 'ui', 'package.json'), '{"name":"ui"}');
  writeFileSync(join(root, 'node_modules', 'playwright-core', 'package.json'), '{"name":"playwright-core","version":"1.61.1"}');
  return { root, home };
}

/** Loads the project's modules and dispatches `words` from inside it. */
async function runIn(place: { root: string; home: string }, words: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const before = process.cwd();
  process.chdir(place.root);
  try {
    const modules = await loadInvocationModules({ cwd: place.root, home: place.home });
    const { exitCode } = await dispatch(words, {
      registry: createRosterRegistry({ off: [] }),
      renderHelp,
      modules: modules.commands,
      warnings: modules.warnings,
      env: { HOME: place.home },
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => new Date('2026-11-08T12:00:00.000Z'),
      cwd: place.root,
      home: place.home,
    });
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  } finally {
    process.chdir(before);
  }
}

describe('rafa-d2c mounted through module exec', () => {
  it('routes check by its bare action and exits 0 with the run line', async () => {
    const run = await runIn(plantProject('host'), ['module', 'exec', '@open-tomato/rafa-d2c', 'check']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('this run will seed');
  });

  it('a gap exits 1 and prints the gap', async () => {
    const run = await runIn(plantProject('container'), ['module', 'exec', '@open-tomato/rafa-d2c', 'check']);

    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('cut 2');
  });
});
