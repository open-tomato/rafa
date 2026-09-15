/**
 * Tests over the module seams `.specs/modules-and-addons.md` asks phase 1
 * to carry: a project's `.rafa/config.yaml` naming a module's `path`
 * source and its `allowList:`, run the same way `src/rafa.ts` does —
 * `loadInvocationModules` (`src/modules/load.ts`) first, then `dispatch`
 * (`src/cli/dispatch.ts`) over the core registry — so what a case reads
 * is what a real invocation would.
 *
 * `seam-fixture` (`src/modules/testdata/seam-fixture/`) is the
 * well-behaved fixture: a commands-only manifest one action,
 * `seam ping`, reached as `rafa module exec seam-fixture ping`. Its files
 * live in the tree because they must pass `tsc` and `eslint`, which read
 * every file under `src`. `port-mismatch` (`src/modules/testdata/
 * port-mismatch/`) is a `package.json` alone: its manifest states a
 * tracker port version core does not serve, so its entry files are never
 * resolved and need not exist. The module with a syntax error in its
 * commands entry cannot live in the tree for the same reason `tsc` and
 * `eslint` rule out an in-tree fixture with one, so that module is
 * written to a temporary directory of this file's own, outside the
 * repository, at run time.
 *
 * Each case plants a project of its own under that temporary directory —
 * `.rafa/config.yaml` naming `modules:` and `allowList:`, beside an empty
 * home — and dispatches through it, so no case reads another's config and
 * nothing here touches the real home.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { DescribeDocument } from '../cli/describe.js';
import type { ModuleListing } from '../commands/module/list.js';
import type { CliEvent, CliEventLog, CliEventResult } from '../ports/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatch } from '../cli/dispatch.js';
import { renderHelp } from '../cli/help.js';
import { CORE_REGISTRY } from '../commands/index.js';
import { loadInvocationModules } from '../modules/load.js';

/** A temporary directory of this file's own, holding one project per case. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-module-seams-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The well-behaved fixture module: a commands-only manifest with one action. */
const SEAM_FIXTURE = fileURLToPath(new URL('../modules/testdata/seam-fixture', import.meta.url));

/** The fixture whose manifest states a tracker port version core does not serve. */
const PORT_MISMATCH_FIXTURE = fileURLToPath(new URL('../modules/testdata/port-mismatch', import.meta.url));

/** A stream collecting what is written to it. */
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

/** A project a case planted: its root, holding `.rafa/config.yaml`, beside an empty home. */
interface PlantedProject {
  readonly root: string;
  readonly home: string;
}

/** Plants a project of its own under `tempBase`, its config text `configText`, beside an empty home. */
function plantProject(configText: string): PlantedProject {
  const scope = mkdtempSync(join(tempBase, 'project-'));
  const root = join(scope, 'root');
  const home = join(scope, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(root, '.rafa', 'config.yaml'), configText);
  return { root, home };
}

/** A config naming one `path` source at `location`, and `allowList:` as `allowList` names it, or left off for null. */
function configOf(location: string, allowList: readonly string[] | null): string {
  const allowLine = allowList === null
    ? ''
    : `allowList: [${allowList.join(', ')}]\n`;
  return `version: 1\nmodules:\n  - path: ${location}\n${allowLine}`;
}

/** What one run of `words` over `place` wrote, and how it ended. */
interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Loads the modules of `place` as `src/rafa.ts` does, then dispatches
 * `words` over the core registry with their command entries and
 * warnings, with streams and a clock of its own.
 */
async function runOver(words: readonly string[], place: PlantedProject): Promise<Run> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const modules = await loadInvocationModules({ cwd: place.root, home: place.home });
  const { exitCode } = await dispatch(words, {
    registry: CORE_REGISTRY,
    renderHelp,
    modules: modules.commands,
    warnings: modules.warnings,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    cwd: place.root,
    home: place.home,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

/** Every line of a json-mode stdout, parsed. */
function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as CliEvent);
}

/** The terminal result event of a json-mode run, throwing when there is none. */
function resultOf(stdout: string): CliEventResult {
  const last = eventsOf(stdout).at(-1);
  if (last?.type !== 'result') throw new Error(`expected a result event last, got ${JSON.stringify(last)}`);
  return last;
}

/** Every `log` event at `warn` level. */
function warningsOf(stdout: string): readonly CliEventLog[] {
  return eventsOf(stdout).filter((event): event is CliEventLog => event.type === 'log' && event.level === 'warn');
}

/** The `describe --output=json` document's `module` subject actions naming `moduleName`, if any. */
function moduleActionsOf(document: DescribeDocument, moduleName: string): readonly string[] {
  const subject = document.subjects.find((held) => held.name === 'module');
  return (subject?.actions ?? []).filter((action) => action.module === moduleName).map((action) => action.name);
}

describe('a module allowList: names', () => {
  it('lists its action through describe --output=json and renders its module exec help with the core renderer', async () => {
    const place = plantProject(configOf(SEAM_FIXTURE, ['seam-fixture']));

    const described = await runOver(['describe', '--output=json'], place);
    const help = await runOver(['module', 'exec', 'seam-fixture', 'ping', '--help'], place);
    const ran = await runOver(['module', 'exec', 'seam-fixture', 'ping'], place);

    expect(described.exitCode).toBe(0);
    const document = resultOf(described.stdout).data as DescribeDocument;
    expect(moduleActionsOf(document, 'seam-fixture')).toEqual(['exec seam-fixture ping']);

    expect([help.exitCode, help.stderr]).toEqual([0, '']);
    expect(help.stdout).toStartWith('rafa module exec seam-fixture ping — answer pong\n');

    expect(ran).toEqual({ exitCode: 0, stdout: 'pong\n', stderr: '' });
  });
});

describe('a module left off allowList:', () => {
  it.each([
    ['allowList: names other modules alone', configOf(SEAM_FIXTURE, [])],
    ['allowList: is absent from the config', configOf(SEAM_FIXTURE, null)],
  ])('mounts nothing when %s, so describe lists no action for it and module exec refuses it', async (_label, configText) => {
    const place = plantProject(configText);

    const described = await runOver(['describe', '--output=json'], place);
    const refused = await runOver(['module', 'exec', 'seam-fixture', 'ping'], place);

    const document = resultOf(described.stdout).data as DescribeDocument;
    expect(moduleActionsOf(document, 'seam-fixture')).toEqual([]);
    expect(refused).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'rafa: no module "seam-fixture" is mounted; mounted: none\n',
    });
  });
});

describe('a module whose port version core does not serve', () => {
  it('is refused, naming both numbers', async () => {
    const place = plantProject(configOf(PORT_MISMATCH_FIXTURE, ['port-mismatch-fixture']));

    const listed = await runOver(['module', 'list', '--output=json'], place);

    expect(listed.exitCode).toBe(0);
    const problem = 'rafa.requires.ports.tracker is 99, but core serves tracker port version 1';
    const packageJson = join(PORT_MISMATCH_FIXTURE, 'package.json');
    expect(warningsOf(listed.stdout).map((event) => event.message)).toEqual([`module "port-mismatch-fixture": ${packageJson}: ${problem}`]);

    const modules = (resultOf(listed.stdout).data as { readonly modules: readonly ModuleListing[] }).modules;
    expect(modules[0]?.state).toBe('refused');
    expect(modules[0]?.problems.some((held) => held.endsWith(problem))).toBe(true);
  });
});

describe('a command entry with a syntax error', () => {
  it('is written to a temporary directory, warned about with its path while the roster loads', async () => {
    const moduleDir = mkdtempSync(join(tempBase, 'syntax-fixture-'));
    writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({
      name: 'syntax-fixture',
      version: '0.1.0',
      rafa: {
        manifestVersion: 1,
        types: ['commands'],
        provides: { commands: { entry: './commands.ts' } },
        requires: { rafa: '>=0.1 <1' },
      },
    }));
    const entry = join(moduleDir, 'commands.ts');
    writeFileSync(entry, [
      'export default [',
      '  {',
      '    name: "seam ping", subject: "seam", action: "ping", summary: "ping",',
      '    description: "ping.", args: [], flags: [], outputs: ["text"],',
      '    examples: [], run: async () => {},',
      '  },',
      // No closing "];": Bun's own parser throws for this, not a stand-in.
    ].join('\n'));
    const place = plantProject(configOf(moduleDir, ['syntax-fixture']));

    const listed = await runOver(['module', 'list', '--output=json'], place);

    const warnings = warningsOf(listed.stdout);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toStartWith(`module "syntax-fixture": skipped ${JSON.stringify(entry)}: import failed: `);

    const modules = (resultOf(listed.stdout).data as { readonly modules: readonly ModuleListing[] }).modules;
    expect(modules[0]).toMatchObject({ name: 'syntax-fixture', state: 'loaded', commands: entry, mounted: false });
  });
});
