/**
 * Tests for `rafa module list` (`list.ts`).
 *
 * Each case plants a project of its own under a temporary directory of
 * this file's own, beside an empty home, and modules as real directories
 * there. The invocation runs as `src/rafa.ts` runs it: the modules loaded
 * for the project first (`src/modules/load.ts`), then dispatched over the
 * core registry with their command entries and warnings, so `mounted` is
 * read off the registry the dispatcher really mounted. The manifests are
 * held to rafa 0.1.0 through the manifest seams, handed to the loader and
 * to the command alike.
 */
import type { OutputStream } from '../../adapters/output/stream.js';
import type { ModuleLoadSeams } from '../../modules/load.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { PORT_VERSIONS } from '../../adapters/registry.js';
import { dispatch } from '../../cli/dispatch.js';
import { createCommandRegistry } from '../../cli/registry.js';
import { loadInvocationModules } from '../../modules/load.js';
import { eventsOf, plantProject } from '../../tests/cli-capture.js';
import { CORE_COMMANDS, CORE_SUBJECTS } from '../index.js';

import { createModuleListCommand, renderModuleList } from './list.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-module-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The seams every load runs with. */
const SEAMS: ModuleLoadSeams = { manifest: { rafaVersion: '0.1.0', portVersions: PORT_VERSIONS } };

/** A command entry exporting one working command. */
const COMMANDS_SOURCE = [
  'export default [{',
  '  name: "demo hello", subject: "demo", action: "hello", summary: "say hello", description: "Says hello.",',
  '  args: [], flags: [], outputs: ["text"], needsProject: false,',
  '  examples: [{ cmd: "rafa module exec demo hello", note: "says hello" }],',
  '  run: async (context) => { context.output.info("hello from demo"); },',
  '}];',
  '',
].join('\n');

/** Writes a module directory providing a `demo` tracker and `commandsSource` as its command entry. */
function plantModule(name: string, commandsSource: string = COMMANDS_SOURCE): string {
  const dir = mkdtempSync(join(tempBase, 'module-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.3.0',
    rafa: {
      manifestVersion: 1,
      types: ['tracker', 'commands'],
      provides: { tracker: { kind: name, entry: './tracker.ts' }, commands: { entry: './commands.ts' } },
      requires: { rafa: '>=0.1 <1', ports: { tracker: 1 } },
    },
  }));
  writeFileSync(join(dir, 'tracker.ts'), 'export default () => ({});\n');
  writeFileSync(join(dir, 'commands.ts'), commandsSource);
  return dir;
}

/** A stream of its own, and the text written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/** Dispatches `rafa <words>` from a project holding `configText`, loading its modules first as `src/rafa.ts` does. */
async function run(configText: string, words: readonly string[]) {
  const project = plantProject(mkdtempSync(join(tempBase, 'project-')), configText);
  mkdirSync(project.home, { recursive: true });
  const loaded = await loadInvocationModules({ cwd: project.root, home: project.home }, SEAMS);
  const commands = CORE_COMMANDS.map((command) => command.subject === 'module' && command.action === 'list'
    ? createModuleListCommand(SEAMS)
    : command);
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(words, {
    registry: createCommandRegistry({ subjects: CORE_SUBJECTS, commands }),
    modules: loaded.commands,
    warnings: loaded.warnings,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    cwd: project.root,
    home: project.home,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

describe('rafa module list', () => {
  it('says no module is configured when modules: is empty', async () => {
    const result = await run('version: 1\n', ['module', 'list']);

    expect(result).toEqual({ exitCode: 0, stdout: 'No modules configured.\n', stderr: '' });
  });

  it('lists a loaded module with its adapter and mounted commands, a disabled one and a refused npm source', async () => {
    const demo = plantModule('demo');
    const other = plantModule('other');
    const config = [
      'version: 1',
      'modules:',
      `  - path: ${demo}`,
      `  - path: ${other}`,
      '  - npm: "@open-tomato/rafa-linear"',
      'allowList: [demo]',
      '',
    ].join('\n');

    const result = await run(config, ['module', 'list']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe([
      'Modules:',
      `  demo 0.3.0: loaded, enabled; types tracker, commands; from path ${demo}`,
      '    adapter: tracker/demo',
      `    commands: ${join(demo, 'commands.ts')} (mounted)`,
      `  other 0.3.0: disabled, disabled; types tracker, commands; from path ${other}`,
      '  @open-tomato/rafa-linear (no version): disabled, disabled; types no types read; from npm @open-tomato/rafa-linear',
      '    problem: npm source "@open-tomato/rafa-linear" is refused: phase 1 loads path sources alone, and installing a package or a repository is phase 7\'s',
      '',
    ].join('\n'));
  });

  it('gives the modules as the result data in json mode, each with mounted', async () => {
    const demo = plantModule('demo');

    const result = await run(`version: 1\nmodules:\n  - path: ${demo}\nallowList: [demo]\n`, ['module', 'list', '--output=json']);

    expect(result.exitCode).toBe(0);
    const events = eventsOf(result.stdout);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toEqual({
      type: 'result',
      ok: true,
      data: {
        modules: [{
          at: 'modules[0]',
          source: { kind: 'path', location: demo, ref: null },
          name: 'demo',
          version: '0.3.0',
          directory: demo,
          types: ['tracker', 'commands'],
          enabled: true,
          state: 'loaded',
          adapters: ['tracker/demo'],
          commands: join(demo, 'commands.ts'),
          problems: [],
          mounted: true,
        }],
      },
      ts: '2026-09-15T12:00:00.000Z',
    });
  });

  it('reads a loaded module whose command entry the dispatcher skipped as not mounted, the warning naming the file', async () => {
    const broken = plantModule('broken', COMMANDS_SOURCE.replace('}];', '}'));
    const control = plantModule('control');
    const config = `version: 1\nmodules:\n  - path: ${broken}\n  - path: ${control}\nallowList: [broken, control]\n`;

    const result = await run(config, ['module', 'list']);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines[0]).toStartWith(`warn: module "broken": skipped "${join(broken, 'commands.ts')}": import failed: `);
    expect(lines).toContain(`    commands: ${join(broken, 'commands.ts')} (not mounted)`);
    expect(lines).toContain(`    commands: ${join(control, 'commands.ts')} (mounted)`);
  });

  it('refuses an argument, and a config that cannot be used, with exit code 1', async () => {
    const argument = await run('version: 1\n', ['module', 'list', 'demo']);
    const config = await run('version: 1\nallowList: 3\n', ['module', 'list']);

    expect(argument.exitCode).toBe(1);
    expect(argument.stderr).toBe('❌ Expected no argument, got 1: demo\nUsage: rafa module list\n');
    expect(config.exitCode).toBe(1);
    expect(config.stdout).toBe('');
    expect(config.stderr).toStartWith('❌ rafa module list: the config cannot be used:\n  ');
  });
});

describe('renderModuleList', () => {
  it('names a github source with its ref, and a module with no name by where the config gives it', () => {
    const lines = renderModuleList({
      modules: [{
        at: 'modules[2]',
        source: { kind: 'github', location: 'someone/rafa-obsidian', ref: 'v0.3.0' },
        name: null,
        version: null,
        directory: null,
        types: [],
        enabled: false,
        state: 'disabled',
        adapters: [],
        commands: null,
        problems: [],
        mounted: false,
      }],
    });

    expect(lines).toEqual(['Modules:', '  modules[2] (no version): disabled, disabled; types no types read; from github someone/rafa-obsidian@v0.3.0']);
  });
});
