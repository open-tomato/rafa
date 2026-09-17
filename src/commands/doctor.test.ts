/**
 * Tests for `rafa doctor` (`doctor.ts`): the preflight it checks and
 * prints for the config and a plan, the exit code a failed required item
 * gives, that it starts no run and stores no row, its refusals, the two
 * warnings beside the report, the `rafa <version>` line text mode opens
 * with, json mode, and the registered command spawned.
 *
 * ## The world
 *
 * Each in-process case plants a world under this file's own temporary
 * directory: a project whose `.rafa/config.yaml` holds the items the case
 * checks, a subdirectory of it the command runs from, and a home beside
 * it. The case dispatches a command made over seams of its own with that
 * working directory, that home and an environment of its own, whose
 * `PATH` is `~/.rafa/bin` of that home unless the case is about the
 * `PATH`. So no case reads the real home, and no variable this suite runs
 * under reaches a check.
 *
 * The probes run through the real runner unless a case records them, and
 * each is made of `sh` builtins (`exit`, `echo`), which need nothing on
 * the `PATH`. The clock seam answers 0, so every duration reads `0 ms` and
 * a line can be held whole.
 *
 * ## Spawned
 *
 * One case runs `bun src/rafa.ts doctor` in two scratch repositories
 * through `src/tests/cli-capture.ts`, whose child gets a scratch HOME and
 * a PATH of a `bin/` of its own and git's directory: one whose required
 * probe fails, and a control whose required probe passes. So the
 * registered command's own seams are read: `process.env`, the real probe
 * runner and its timeout.
 */
import type { DoctorResult, DoctorSeams } from './doctor.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { ProbeOptions } from '../preflight/run.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { version } from '../../package.json';
import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';
import { versionLine } from '../cli/version.js';
import { configFilePath } from '../config.js';
import { readLegacyStore } from '../effort/store/legacy.js';
import { writePreflightChecks } from '../effort/store/preflight.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { readBinPath } from '../project/bin-path.js';
import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

import doctorCommand, { createDoctorCommand, DEFAULT_DOCTOR_SEAMS, readPlanFlag } from './doctor.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** A required probe failing as a missing tool does. */
const MISSING_TOOL_PROBE = 'echo "sh: needed: not found" >&2; exit 127';

/** An optional probe failing as a tool waiting on a login does once its stdin is closed. */
const LOGIN_PROBE = 'echo "mgrep: login required" >&2; exit 3';

/** The seams of every in-process case not recording its probes: the real runner, with a clock that stands still. */
const STILL_CLOCK: DoctorSeams = { checks: { now: () => 0 } };

/** The line text mode opens with, before anything is checked. */
const VERSION_LINE = versionLine();

/** The head line of a world with no plan, for `checked`. */
function noPlanHead(checked: string): string {
  return `Preflight with no plan, none being at .rafa/plans/PLAN.md or PLAN.md: ${checked}, no run started.`;
}

/** A world a case runs `doctor` in. */
interface World {
  /** The project root. */
  readonly root: string;
  /** A subdirectory of the root, the working directory. */
  readonly sub: string;
  readonly home: string;
  /** `~/.rafa/bin` of the home: the PATH a case not about the PATH hands in. */
  readonly rafaBin: string;
  /** `~/.bun/bin` of the home. */
  readonly bunBin: string;
}

/** Plants a world whose project config is `version: 1` and the lines of `config`. */
function plantWorld(config: readonly string[] = []): World {
  const base = mkdtempSync(join(tempBase, 'world-'));
  const root = join(base, 'project');
  const sub = join(root, 'sub');
  const home = join(base, 'home');
  mkdirSync(sub, { recursive: true });
  mkdirSync(home);
  plantProjectConfig(root, ['version: 1', ...config, ''].join('\n'));
  return { root, sub, home, rafaBin: join(home, '.rafa', 'bin'), bunBin: join(home, '.bun', 'bin') };
}

/** Config lines naming one required tool checked by `probe`. */
function requiredTool(probe: string): string[] {
  return ['prerequisites:', '  required:', '    - tool: needed', `      probe: '${probe}'`];
}

/** Writes `text` to `path` under `root`, making its directory. */
function plant(root: string, path: string, text = 'rows'): void {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

/** What one dispatch wrote, and its exit code. */
interface DoctorRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
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

/** How a case dispatches: the seams, and the environment, `PATH` of the world's `~/.rafa/bin` when left out. */
interface DoctorOptions {
  readonly seams?: DoctorSeams;
  readonly env?: Readonly<Record<string, string>>;
}

/** Dispatches `rafa doctor` with `words` in `world`; see the module note. */
async function doctor(world: World, words: readonly string[] = [], options: DoctorOptions = {}): Promise<DoctorRun> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(['doctor', ...words], {
    registry: createCommandRegistry({ subjects: [], commands: [createDoctorCommand(options.seams ?? STILL_CLOCK)] }),
    env: options.env ?? { PATH: world.rafaBin },
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-15T12:00:00.000Z'),
    cwd: world.sub,
    home: world.home,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

/** The lines of `text`, the final newline dropped. */
function lines(text: string): string[] {
  return text.trimEnd().split('\n');
}

/** Every path under `root`, sorted. */
function pathsUnder(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .sort((a, b) => a.localeCompare(b));
}

/** The line text mode ends with when the `PATH` order holds. */
function aheadLine(world: World): string {
  return `${world.rafaBin} is on PATH, and ${world.bunBin} is not ahead of it.`;
}

describe('the preflight it prints', () => {
  it('prints each check of the config items and the verdict, and exits 0 when only an optional item fails', async () => {
    const world = plantWorld([
      ...requiredTool('exit 0'),
      '  optional:',
      '    - tool: mgrep',
      `      probe: '${LOGIN_PROBE}'`,
      '      reason: "faster search; grep is the fallback"',
    ]);

    const run = await doctor(world);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toEqual([
      VERSION_LINE,
      `warn: preflight: optional item tool "mgrep" failed: probe \`${LOGIN_PROBE}\` exited 3: mgrep: login required;`
        + ' the run goes on, and each task prompt names it known-missing',
      noPlanHead('2 items from the config checked'),
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
      `  fail    optional tool "mgrep", probe \`${LOGIN_PROBE}\`, 0 ms`,
      'Preflight passed: rafa loop start would go on, naming 1 optional item known-missing in every task prompt:',
      '  known-missing: mgrep (faster search; grep is the fallback)',
      aheadLine(world),
    ]);
  });

  it('exits 1 for a failed required item, naming it, its probe, its exit code and stderr line, beside a passing control', async () => {
    const failing = plantWorld(requiredTool(MISSING_TOOL_PROBE));
    const passing = plantWorld(requiredTool('exit 0'));

    const failed = await doctor(failing);
    const passed = await doctor(passing);

    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toBe([
      'rafa doctor: preflight halted: 1 required item failed',
      `  tool "needed": probe \`${MISSING_TOOL_PROBE}\` exited 127: sh: needed: not found`,
      'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
      '',
    ].join('\n'));
    expect(lines(failed.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('1 item from the config checked'),
      `  fail    required tool "needed", probe \`${MISSING_TOOL_PROBE}\`, 0 ms`,
      aheadLine(failing),
    ]);
    expect(passed.exitCode).toBe(0);
    expect(passed.stderr).toBe('');
    expect(lines(passed.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('1 item from the config checked'),
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
      'Preflight passed: rafa loop start would go on to its first session.',
      aheadLine(passing),
    ]);
  });

  it('leaves every path under the project as it was for a halt, where storing a run adds the store file', async () => {
    const world = plantWorld(requiredTool(MISSING_TOOL_PROBE));
    const before = pathsUnder(world.root);

    const run = await doctor(world);
    const after = pathsUnder(world.root);
    writePreflightChecks(world.root, {
      runId: 'control-run',
      checks: [{
        tier: 'required',
        item: { kind: 'tool', name: 'needed', probe: 'exit 0' },
        outcome: 'pass',
        durationMs: 0,
        failure: null,
      }],
    });

    expect(run.exitCode).toBe(1);
    expect(after).toEqual(before);
    expect(existsSync(sqliteStorePath(world.root))).toBe(true);
    expect(pathsUnder(world.root)).not.toEqual(before);
  });

  it('runs each probe in the project root from a deeper directory, with the environment and the timeout it is handed', async () => {
    const world = plantWorld([
      'prerequisites:',
      '  required:',
      '    - tool: recorded',
      '      probe: the recorded probe',
      '  optional:',
      '    - env: RAFA_DOCTOR_MARKER',
    ]);
    const seen: [string, ProbeOptions][] = [];
    const seams: DoctorSeams = {
      checks: {
        now: () => 0,
        timeoutMs: 250,
        runProbe: async (probe, options) => {
          seen.push([probe, options]);
          return { exitCode: 0, stderr: '', timedOut: false };
        },
      },
    };

    const marked = await doctor(world, [], { seams, env: { PATH: world.rafaBin, RAFA_DOCTOR_MARKER: 'set' } });
    const unmarked = await doctor(world, [], { seams, env: { PATH: world.rafaBin } });

    expect(seen.map(([probe, options]) => [probe, options.cwd, options.timeoutMs, options.env['RAFA_DOCTOR_MARKER']])).toEqual([
      ['the recorded probe', world.root, 250, 'set'],
      ['the recorded probe', world.root, 250, undefined],
    ]);
    expect(lines(marked.stdout)).toContain('  pass    optional env "RAFA_DOCTOR_MARKER", presence check, 0 ms');
    expect(lines(unmarked.stdout)).toContain('  fail    optional env "RAFA_DOCTOR_MARKER", presence check, 0 ms');
    expect(lines(unmarked.stdout)).toContain('  known-missing: RAFA_DOCTOR_MARKER');
    expect([marked.exitCode, unmarked.exitCode]).toEqual([0, 0]);
  });

  it('merges the PREREQUISITES file of the plan --plan names and lists its other steps, where no plan merges none', async () => {
    const world = plantWorld();
    plant(world.root, '.plans/PLAN-probe.md', '# Plan\n\n- [ ] A task\n');
    plant(world.root, '.plans/PREREQUISITES-probe.md', [
      '# Prerequisites',
      '',
      '- [ ] [auto] The probe answers: `exit 0`',
      '- [ ] [human] Publish with `npm publish`',
      '',
    ].join('\n'));

    const named = await doctor(world, ['--plan=.plans/PLAN-probe.md']);
    const unnamed = await doctor(world);

    expect(named.stderr).toBe('');
    expect(named.exitCode).toBe(0);
    expect(lines(named.stdout)).toEqual([
      VERSION_LINE,
      'Preflight for .plans/PLAN-probe.md, with PREREQUISITES-probe.md merged in: 1 item checked, no run started.',
      '  pass    required tool "The probe answers: `exit 0`", probe `exit 0`, 0 ms',
      'PREREQUISITES-probe.md names 1 step the preflight does not check:',
      '  line 4: Publish with `npm publish`',
      'Preflight passed: rafa loop start would go on to its first session.',
      aheadLine(world),
    ]);
    expect(lines(unnamed.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('nothing to check'),
      'Preflight passed: rafa loop start would go on to its first session.',
      aheadLine(world),
    ]);
  });

  it('checks the default plan when one is there, naming it with no PREREQUISITES file, since PLAN.md carries no stub', async () => {
    const world = plantWorld(requiredTool('exit 0'));
    plant(world.root, '.rafa/plans/PLAN.md', '# Plan\n\n- [ ] A task\n');
    plant(world.root, '.rafa/plans/PREREQUISITES-.md', '- [ ] [auto] Never read: `exit 1`\n');

    const run = await doctor(world);

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout).slice(0, 3)).toEqual([
      VERSION_LINE,
      'Preflight for .rafa/plans/PLAN.md: 1 item checked, no run started.',
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
    ]);
  });

  it('opens with the running build\'s version, which json mode writes as no line at all', async () => {
    const world = plantWorld(requiredTool('exit 0'));

    const text = await doctor(world);
    const json = await doctor(world, ['--output=json']);

    expect(VERSION_LINE).toBe(`rafa ${version}`);
    expect(lines(text.stdout)[0]).toBe(VERSION_LINE);
    expect(json.stdout).not.toContain(VERSION_LINE);
    expect(json.exitCode).toBe(0);
  });
});

describe('its refusals', () => {
  /** Seams whose runner throws, so a refusal is seen to check nothing. */
  const NO_PROBE: DoctorSeams = {
    checks: {
      runProbe: async () => {
        throw new Error('a probe ran where none was expected');
      },
    },
  };

  it('refuses a positional word, a --plan with no file and a --plan naming no file, checking nothing, beside a plan it reads', async () => {
    const world = plantWorld(requiredTool('exit 0'));
    plant(world.root, '.plans/PLAN-there.md', '# Plan\n');

    const positional = await doctor(world, ['extra'], { seams: NO_PROBE });
    const empty = await doctor(world, ['--plan='], { seams: NO_PROBE });
    const absent = await doctor(world, ['--plan=.plans/PLAN-absent.md'], { seams: NO_PROBE });
    const control = await doctor(world, ['--plan=.plans/PLAN-there.md']);

    expect([positional.exitCode, empty.exitCode, absent.exitCode, control.exitCode]).toEqual([1, 1, 1, 0]);
    expect(positional.stderr).toBe(
      'rafa doctor: expected no argument, got 1: extra; name a plan with --plan=<file>\nNothing was checked.\n',
    );
    expect(empty.stderr).toBe('rafa doctor: --plan needs a file: --plan=<file>\nNothing was checked.\n');
    expect(absent.stderr).toBe(`rafa doctor: no plan file at ${join(world.root, '.plans', 'PLAN-absent.md')}\nNothing was checked.\n`);
    expect(lines(control.stdout)[1]).toBe('Preflight for .plans/PLAN-there.md: 1 item checked, no run started.');
  });

  it('refuses a plan path it cannot check, one under a file, checking nothing, beside that file', async () => {
    const world = plantWorld(requiredTool('exit 0'));
    plant(world.root, '.plans/PLAN-file.md', '# Plan\n');
    const path = join(world.root, '.plans', 'PLAN-file.md', 'PLAN-x.md');

    const under = await doctor(world, ['--plan=.plans/PLAN-file.md/PLAN-x.md'], { seams: NO_PROBE });
    const control = await doctor(world, ['--plan=.plans/PLAN-file.md']);

    expect(under.exitCode).toBe(1);
    expect(under.stderr).toStartWith(`rafa doctor: the plan at ${path} cannot be checked (ENOTDIR`);
    expect(under.stderr).toEndWith(')\nNothing was checked.\n');
    expect(control.exitCode).toBe(0);
  });

  it('reads --plan as a file, and refuses a flag holding none', () => {
    expect(readPlanFlag(undefined)).toBeNull();
    expect(readPlanFlag('.plans/PLAN-a.md')).toBe('.plans/PLAN-a.md');
    expect(() => readPlanFlag('')).toThrow('rafa doctor: --plan needs a file: --plan=<file>');
    expect(() => readPlanFlag(true)).toThrow('rafa doctor: --plan needs a file: --plan=<file>');
  });

  it('refuses a config loadConfig refuses and still warns about the install, beside a config it reads', async () => {
    const refused = plantWorld(['store: nonesuch']);
    const control = plantWorld(['store: sqlite']);
    const env = { PATH: refused.bunBin };

    const run = await doctor(refused, [], { seams: NO_PROBE, env });
    const read = await doctor(control, [], { env: { PATH: control.bunBin } });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe([
      'rafa doctor: the config cannot be used:',
      `  ${configFilePath(refused.root)}: store is "nonesuch", expected one of: sqlite, ndjson`,
      'Nothing was checked.',
      '',
    ].join('\n'));
    expect(lines(run.stdout)).toEqual([VERSION_LINE, `warn: ${readBinPath(refused.bunBin, refused.home).warning}`]);
    expect(read.exitCode).toBe(0);
    expect(lines(read.stdout)[1]).toBe(noPlanHead('nothing to check'));
  });

  it('refuses a PREREQUISITES file that cannot be read, naming it, beside one it reads', async () => {
    const world = plantWorld();
    plant(world.root, '.plans/PLAN-broken.md', '# Plan\n');
    mkdirSync(join(world.root, '.plans', 'PREREQUISITES-broken.md'));
    plant(world.root, '.plans/PLAN-fine.md', '# Plan\n');
    plant(world.root, '.plans/PREREQUISITES-fine.md', '- [ ] [auto] Fine: `exit 0`\n');

    const broken = await doctor(world, ['--plan=.plans/PLAN-broken.md'], { seams: NO_PROBE });
    const fine = await doctor(world, ['--plan=.plans/PLAN-fine.md']);

    expect(broken.exitCode).toBe(1);
    expect(broken.stderr).toStartWith('rafa doctor: the plan\'s prerequisites cannot be read:\n'
      + `  ${join(world.root, '.plans', 'PREREQUISITES-broken.md')}: cannot be read (`);
    expect(broken.stderr).toEndWith('\nNothing was checked.\n');
    expect(fine.exitCode).toBe(0);
  });
});

describe('the warnings beside the report', () => {
  it('warns for a store left under .ralph/effort beside the empty .rafa/effort init writes, and not for a moved one', async () => {
    const left = plantWorld();
    plant(left.root, '.ralph/effort/effort.sqlite');
    mkdirSync(join(left.root, '.rafa', 'effort'));
    const moved = plantWorld();
    plant(moved.root, '.ralph/effort/effort.sqlite');
    plant(moved.root, '.rafa/effort/effort.sqlite');

    const warned = await doctor(left);
    const quiet = await doctor(moved);
    const warning = readLegacyStore(left.root).warning;

    expect(warning).not.toBeNull();
    expect(warned.exitCode).toBe(0);
    expect(lines(warned.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('nothing to check'),
      'Preflight passed: rafa loop start would go on to its first session.',
      `warn: ${warning}`,
      aheadLine(left),
    ]);
    expect(quiet.exitCode).toBe(0);
    expect(quiet.stdout).not.toContain('holds an effort store');
  });

  it('warns when ~/.rafa/bin is missing from PATH or behind ~/.bun/bin, and says the order holds when it is ahead', async () => {
    const world = plantWorld();
    const behindPath = [world.bunBin, world.rafaBin].join(delimiter);

    const behind = await doctor(world, [], { env: { PATH: behindPath } });
    const missing = await doctor(world, [], { env: { PATH: world.bunBin } });
    const ahead = await doctor(world, [], { env: { PATH: [world.rafaBin, world.bunBin].join(delimiter) } });

    expect([behind.exitCode, missing.exitCode, ahead.exitCode]).toEqual([0, 0, 0]);
    expect(lines(behind.stdout).at(-1)).toBe(`warn: ${readBinPath(behindPath, world.home).warning}`);
    expect(lines(behind.stdout).at(-1)).toContain('is on PATH after');
    expect(lines(missing.stdout).at(-1)).toBe(`warn: ${readBinPath(world.bunBin, world.home).warning}`);
    expect(lines(missing.stdout).at(-1)).toContain('is not on PATH');
    expect(lines(ahead.stdout).at(-1)).toBe(aheadLine(world));
    expect(ahead.stdout).not.toContain('warn: ');
  });
});

describe('json mode', () => {
  it('gives the checks and both readings as the result data, each warning as a log event, and no text line', async () => {
    const world = plantWorld([
      ...requiredTool('exit 0'),
      '  optional:',
      '    - tool: mgrep',
      `      probe: '${LOGIN_PROBE}'`,
    ]);
    plant(world.root, '.ralph/effort/sessions.ndjson');

    const run = await doctor(world, ['--output=json'], { env: { PATH: world.bunBin } });
    const events = eventsOf(run.stdout);
    const result = events.find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'log', 'log', 'result']);
    expect(events.filter((event) => event.type === 'log').map((event) => (event as { level?: string }).level))
      .toEqual(['warn', 'warn', 'warn']);
    expect(result?.data).toMatchObject({
      root: world.root,
      plan: null,
      prerequisitesFile: null,
      knownMissing: ['known-missing: mgrep'],
      reminders: [],
      binPath: { state: 'missing', rafaBin: world.rafaBin },
      legacyStore: { legacyFiles: ['sessions.ndjson'], storeFiles: [] },
    });
    expect(result?.data?.checks.map((check) => [check.tier, check.item.name, check.outcome])).toEqual([
      ['required', 'needed', 'pass'],
      ['optional', 'mgrep', 'fail'],
    ]);
  });

  it('ends a halt with the command_exit error naming the failed item and no data, where a pass gives data', async () => {
    const failing = plantWorld(requiredTool(MISSING_TOOL_PROBE));

    const run = await doctor(failing, ['--output=json']);
    const result = eventsOf(run.stdout).find((event) => event.type === 'result') as {
      data?: unknown;
      error?: { code?: string; message?: string };
    } | undefined;

    expect(run.exitCode).toBe(1);
    expect(result?.data).toBeUndefined();
    expect(result?.error?.code).toBe('command_exit');
    expect(result?.error?.message).toStartWith('rafa doctor: preflight halted: 1 required item failed\n  tool "needed": probe');
  });
});

describe('the registered command', () => {
  it('runs over the runner seams of its own, which are the runner defaults', () => {
    expect(DEFAULT_DOCTOR_SEAMS.checks).toEqual({});
    expect(doctorCommand).toMatchObject({ subject: 'doctor', action: 'doctor', outputs: ['text', 'json'] });
    expect(doctorCommand.needsProject).toBeUndefined();
    expect(doctorCommand.flags.map((flag) => flag.name)).toEqual(['plan']);
  });

  it('spawned, checks through the real runner under the process environment, exiting 1 for a failed required probe', () => {
    const failing = plantScratchRepo(tempBase);
    plantProjectConfig(failing.repo, ['version: 1', ...requiredTool(MISSING_TOOL_PROBE), ''].join('\n'));
    const passing = plantScratchRepo(tempBase);
    plantProjectConfig(passing.repo, [
      'version: 1',
      ...requiredTool('exit 0'),
      '  optional:',
      '    - env: RAFA_DOCTOR_MARKER',
      '',
    ].join('\n'));

    const failed = runRafa(failing, failing.repo, ['doctor']);
    const passed = runRafa(passing, passing.repo, ['doctor'], { RAFA_DOCTOR_MARKER: 'set' });

    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain(`  tool "needed": probe \`${MISSING_TOOL_PROBE}\` exited 127: sh: needed: not found\n`);
    expect(passed.stderr).toBe('');
    expect(passed.exitCode).toBe(0);
    expect(passed.stdout).toContain('\n  pass    optional env "RAFA_DOCTOR_MARKER", presence check, ');
    expect(passed.stdout).toContain('\nPreflight passed: rafa loop start would go on to its first session.\n');
    expect(passed.stdout).toContain(`\nwarn: ${join(passing.home, '.rafa', 'bin')} is not on PATH;`);
  }, SPAWN_TIMEOUT);
});
