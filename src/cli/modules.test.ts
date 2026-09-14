/**
 * Tests for importing module command entries (`src/cli/modules.ts`).
 *
 * The entry files are real: each case's files are written under a
 * temporary directory of this file's own, outside the repository, and
 * imported through the loader's default importer, so a syntax error is
 * Bun's own and not a stand-in. Every case holds its entry paths under
 * that directory. The file with a syntax error is the working file with
 * its closing bracket removed, so the working file is its control: the
 * same entry, loaded, beside the one that is skipped.
 *
 * Each warning is spelled in full but for the part Bun writes, which is
 * held to be present and not spelled, since its wording is Bun's to
 * change.
 *
 * Three mutations of `modules.ts` were driven on 2026-09-14, one run each
 * over the eight suites under `src/cli/`, with 326 pass before and after
 * and the module restored byte-identical (sha256), and each reddened at
 * least one case. An import failure swallowed, as open-tomato's autoload
 * swallows one, reddened 4, two of them in `dispatch.test.ts`. A relative
 * entry imported reddened 2, and a refused mount swallowed 1.
 */
import type { CommandRegistry } from './registry.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { importModuleEntry, loadModuleCommands } from './modules.js';
import { createCommandRegistry, mountKey } from './registry.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-modules-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A module source exporting one command per action, as a module entry does. */
function commandsSource(...actions: string[]): string {
  const commands = actions.map((action) => [
    '  {',
    `    name: "issue ${action}", subject: "issue", action: "${action}", summary: "${action}",`,
    `    description: "Runs ${action}.", args: [], flags: [], outputs: ["text"],`,
    `    examples: [{ cmd: "rafa module exec linear ${action}", note: "runs it" }],`,
    '    run: async () => {},',
    '  },',
  ].join('\n'));
  return ['export default [', ...commands, '];', ''].join('\n');
}

/** Writes a file under a directory of its own in the temporary base, answering its absolute path. */
function entryFile(name: string, source: string): string {
  const dir = mkdtempSync(join(tempBase, 'entry-'));
  const path = join(dir, name);
  writeFileSync(path, source);
  return path;
}

/** A registry with the subject the mounted commands name, and no command. */
function coreRegistry(): CommandRegistry {
  return createCommandRegistry({ subjects: [{ name: 'module', summary: 'modules' }], commands: [] });
}

describe('loading module command entries', () => {
  it('mounts the entries that load, and names in its warning each file that does not', async () => {
    const good = entryFile('commands.ts', commandsSource('next', 'peek'));
    const syntax = entryFile('commands.ts', commandsSource('next').replace('];', ''));
    const mapping = entryFile('commands.ts', 'export default { next: true };\n');
    const shapeless = entryFile('commands.ts', 'export default [{ subject: "issue" }];\n');
    const throwing = entryFile('commands.ts', 'throw new Error("no key at import\\nsecond line");\n');
    const second = entryFile('commands.ts', commandsSource('open'));
    const entries = [
      { name: 'linear', entry: good },
      { name: 'broken', entry: syntax },
      { name: 'mapping', entry: mapping },
      { name: 'shapeless', entry: shapeless },
      { name: 'throwing', entry: throwing },
      { name: 'relative', entry: 'modules/relative/commands.ts' },
      { name: 'linear', entry: second },
      { name: 'jira', entry: second },
    ];

    const { registry, warnings } = await loadModuleCommands(coreRegistry(), entries);

    for (const { entry } of entries.filter(({ name }) => name !== 'relative')) {
      expect(entry.startsWith(tempBase)).toBe(true);
    }
    expect(registry.mounts().map(({ name, entry }) => [name, entry])).toEqual([['linear', good], ['jira', second]]);
    expect(registry.actionsOf(mountKey('linear')).map(({ action }) => action)).toEqual(['next', 'peek']);
    expect(registry.actionsOf(mountKey('jira')).map(({ action }) => action)).toEqual(['open']);

    expect(warnings).toHaveLength(6);
    const [broken, ...rest] = warnings;
    const brokenPrefix = `module "broken": skipped ${JSON.stringify(syntax)}: import failed: `;
    expect(broken?.startsWith(brokenPrefix)).toBe(true);
    expect((broken ?? '').length).toBeGreaterThan(brokenPrefix.length);
    expect(rest).toEqual([
      `module "mapping": skipped ${JSON.stringify(mapping)}: its default export is a mapping, expected a list of commands`,
      `module "shapeless": skipped ${JSON.stringify(shapeless)}: command registry: module "shapeless": a command:`
        + ' action is undefined, expected a word with no space, no slash and no leading dash',
      `module "throwing": skipped ${JSON.stringify(throwing)}: import failed: no key at import`,
      'module "relative": skipped "modules/relative/commands.ts": expected an absolute path',
      `module "linear": skipped ${JSON.stringify(second)}: command registry: module "linear" is mounted twice`,
    ]);
  });

  it('answers the registry it was handed, with no warning, when no entry is named', async () => {
    const registry = coreRegistry();

    const loaded = await loadModuleCommands(registry, []);

    expect(loaded.registry).toBe(registry);
    expect(loaded.warnings).toEqual([]);
  });

  it('leaves the registry it was handed unmounted', async () => {
    const registry = coreRegistry();

    await loadModuleCommands(registry, [{ name: 'linear', entry: entryFile('commands.ts', commandsSource('next')) }]);

    expect(registry.mounts()).toEqual([]);
  });

  it('imports each absolute entry once through the importer it is handed, and never a relative one', async () => {
    const imported: string[] = [];
    const commands = await importModuleEntry(entryFile('commands.ts', commandsSource('next')));

    const loaded = await loadModuleCommands(
      coreRegistry(),
      [
        { name: 'linear', entry: '/modules/linear/commands.ts' },
        { name: 'relative', entry: 'relative/commands.ts' },
        { name: 'jira', entry: '/modules/jira/commands.ts' },
      ],
      async (entry) => {
        imported.push(entry);
        return commands;
      },
    );

    expect(imported).toEqual(['/modules/linear/commands.ts', '/modules/jira/commands.ts']);
    expect(loaded.registry.mounts().map(({ name }) => name)).toEqual(['linear', 'jira']);
  });

  it('names a module whose importer rejects with something that is not an error', async () => {
    const loaded = await loadModuleCommands(
      coreRegistry(),
      [{ name: 'linear', entry: '/modules/linear/commands.ts' }],
      () => Promise.reject(new Error('\n\nfirst line that holds text\nsecond')),
    );

    expect(loaded.warnings).toEqual([
      'module "linear": skipped "/modules/linear/commands.ts": import failed: first line that holds text',
    ]);
  });
});
