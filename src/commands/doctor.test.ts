/**
 * Tests for `rafa doctor` (`doctor.ts`): the preflight it checks and
 * prints for the config and a plan, the exit code a failed required item
 * gives, that it starts no run and stores no row, its refusals, the three
 * warnings beside the report, the `rafa <version>` line text mode opens
 * with, the GitHub board rows and the fix they name, json mode, and the
 * registered command spawned.
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
 * ## The automatic items of the pull request provider
 *
 * Their cases drive both seams: the `origin` probe answers what the case
 * plants, and every shell probe is answered from a recorded table, so no
 * case here spawns git or `gh`. Every other case of this file leaves
 * `readRemote` at the runner's own, and each plants a world under a
 * temporary directory with no `origin`, which resolves `pr.provider:
 * none` and adds no item — which is why their held lines did not move.
 * Each provider case sits beside a control differing in one thing only:
 * the remote, the configured provider, or what the `gh` probe answered.
 *
 * Three mutations of `src/commands/doctor.ts` were driven against them
 * on 2026-09-18, each an exact string found once, the file run alone on
 * a baseline of 23 pass and restored sha256-identical: the items
 * appended to the required tier instead of prepended reddened 1 case,
 * the `pr.provider: none` shortcut dropped reddened 1, and the
 * `readRemote` seam dropped, which sends the probe to the real git in a
 * temporary directory, reddened 5.
 *
 * ## The board rows
 *
 * Their cases drive a third seam: the `gh` runner the rows are read
 * with is {@link fakeGh}, a recorded fake over one imaginary
 * repository, and {@link ghSeams} hands one to every case of the
 * provider too, since a `gh` provider now reads the board and the
 * runner's own seam spawns `gh`. So no case of this file spawns it. A
 * repository with no GitHub origin resolves `pr.provider: none`, reads
 * no board and opens no runner, which is why every other case of this
 * file kept its held lines.
 *
 * Two mutations of `src/commands/doctor.ts` were driven against them on
 * 2026-09-19, the file run alone on a baseline of 28 pass and restored
 * from a scratch copy verified with `shasum -c`: the `pr.provider: gh`
 * shortcut in the board check dropped, so every project reads a board,
 * reddened 8; the fix line dropped, so a board with gaps names no way
 * to fill them, reddened 3.
 *
 * ## The blocked issues
 *
 * The lines `./doctor-blocked.ts` contributes are driven through that
 * same fake, which answers the blocked listing from `blocked` and the
 * board listing from `known`. A fake left bare answers both with no
 * row, which is why every board case above holds its lines whole: a
 * board with no issue labelled `spec:blocked` prints none of these.
 *
 * One mutation of `src/commands/doctor.ts` was driven against them on
 * 2026-09-21, the file run alone on a baseline of 36 pass and restored
 * from a scratch copy verified by sha256: the blocked lines dropped
 * from what text mode prints reddened 2 cases.
 *
 * ## The deep sections
 *
 * `--deep`'s cases add {@link deepSeams} to the seams they already run
 * with: the session in the project root, the rafa tier under the home,
 * and a provider runner that answers nothing, so no case spawns `gh`
 * for it. What each section holds is `./doctor-deep.test.ts`'s; these
 * cases hold where the sections print, that they move no exit code, and
 * the json `deep`, each beside the same world run without the flag.
 *
 * Two mutations of `src/commands/doctor.ts` were driven against them on
 * 2026-09-24, the file run alone on a baseline of 49 pass and restored
 * from a scratch copy verified with `shasum -c`: the sections' lines dropped
 * from what text mode prints reddened 3 cases, and the reading moved
 * after the halt's refusal reddened 1.
 *
 * ## The plan's start-only items
 *
 * Their cases plant a plan, the PREREQUISITES file beside it holding one
 * `[start]` item, and, for a resume, the `PLAN_TRACKER-<stub>.md` beside
 * them, so the tier is read off a tracker of the case's own. Each sits
 * beside a control differing in that tracker alone: none at all for a
 * first dispatch, one whose every box is open for a run that dispatched
 * nothing that finished, and one holding a ticked task for a resume.
 *
 * Three mutations of `src/commands/doctor.ts` were driven against them
 * on 2026-09-20, the file run alone on a baseline of 32 pass and
 * restored from a scratch copy verified with `shasum -c`: the
 * `isFirstDispatch` reading dropped, so every run probes the tier,
 * reddened 4 cases; the tier dropped from the required list, as it was
 * before it was wired, reddened 4; and the line a resume prints dropped
 * reddened 2.
 *
 * ## The risk total
 *
 * A plan `--plan` names gets the risk-total line `loop start` prints
 * (`../start/risk-total.ts`). Its accounts are read over
 * {@link NO_ACCOUNT_RUNNERS}, which every seam set of this file carries,
 * so no case spawns git or `gh` for it; the environment a case hands in
 * is `PATH` alone, so no secret name of the suite's own is counted. Each
 * case sits beside a control: the default plan, which prints no line;
 * the same world with no `FAKE_TOKEN`, one note fewer; and runners that
 * answer beside runners that throw.
 *
 * Three mutations of `src/commands/doctor.ts` were driven against them
 * on 2026-09-23, the file run alone on a baseline of 43 pass and
 * restored from a scratch copy verified by sha256: the call dropped
 * reddened 7 cases; the `--plan` gate dropped, so the default plan
 * prints the line too, reddened 1; and the line moved after the board
 * rows reddened 1.
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
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { PrerequisiteItem } from '../config.js';
import type { ProbeOptions, ProbeRun } from '../preflight/run.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { version } from '../../package.json';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { ROADMAP_SETTING, ROADMAP_TITLE } from '../board/roadmap.js';
import { BOARD_LABELS, SPEC_TEMPLATE_PATH } from '../board/setup.js';
import { ROADMAP_ROW_NAME } from '../board/status.js';
import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';
import { versionLine } from '../cli/version.js';
import { configFilePath } from '../config.js';
import { readLegacyStore } from '../effort/store/legacy.js';
import { writePreflightChecks } from '../effort/store/preflight.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import {
  DEFAULT_GH_HOST,
  ghAuthItem,
  ghMissingMessage,
  ghOnPathItem,
} from '../pr/preflight-items.js';
import { readBinPath } from '../project/bin-path.js';
import { readPreInitDirs } from '../project/pre-init-dirs.js';
import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

import { BLOCKED_HEADING } from './doctor-blocked.js';
import { PLAN_NEEDS_SECTION_TITLE, STACK_TOOLS_SECTION_TITLE } from './doctor-deep-needs.js';
import { PROVIDERS_SECTION_TITLE } from './doctor-deep-providers.js';
import { SETTINGS_SECTION_TITLE } from './doctor-deep-settings.js';
import { ENVIRONMENT_SECTION_TITLE } from './doctor-deep.js';
import { readPreviousCopies } from './doctor-previous.js';
import doctorCommand, { createDoctorCommand, DEFAULT_DOCTOR_SEAMS, readDeepFlag, readPlanFlag } from './doctor.js';
import { BOARD_FIX, BOARD_HEADING } from './init-board.js';

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

/**
 * git with no `origin` and `gh` failing every call, for the plan's risk
 * total, so no case reads a real account. The line they give is held
 * below as {@link riskLine}.
 */
const NO_ACCOUNT_RUNNERS: NonNullable<DoctorSeams['riskRunners']> = () => ({
  git: () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' }),
  gh: () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' }),
});

/**
 * The risk total of a plan whose one open task names no tools, read over
 * {@link NO_ACCOUNT_RUNNERS} and an environment of `PATH` alone: the task
 * is the high, and the four account readings are the notes.
 */
function riskLine(plan: string): string {
  return `🛡  Risk: 1 high, 4 notes — rafa plan risk ${plan}`;
}

/** The seams of every in-process case not recording its probes: the real runner, with a clock that stands still. */
const STILL_CLOCK: DoctorSeams = { checks: { now: () => 0 }, riskRunners: NO_ACCOUNT_RUNNERS };

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

/** Writes `count` previous copies under `.rafa/specs/previous/` of `root`, the default `specs.dir`. */
function plantPrevious(root: string, count: number): void {
  const dir = join(root, '.rafa', 'specs', 'previous');
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(dir, `copy-${String(index)}.md`), 'rows', 'utf8');
  }
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

/** A GitHub `origin`, as git writes one for an ssh clone. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** A probe that passed, answering nothing on stderr. */
const PASSED: ProbeRun = { exitCode: 0, stderr: '', timedOut: false };

/** The probe of `item`, which every automatic item carries. */
function probeOf(item: PrerequisiteItem): string {
  const { probe } = item;
  if (probe === undefined) throw new Error(`${item.name} carries no probe`);
  return probe;
}

/** What the `gh` runner of a case answers: the labels and the issues of one imaginary repository. */
interface FakeRepo {
  readonly labels?: readonly string[];
  /** The open issues the roadmap search finds. */
  readonly issues?: readonly { number: number; title: string }[];
  /** The open issues labelled `spec:blocked`, with their bodies. */
  readonly blocked?: readonly { number: number; body: string }[];
  /** Every issue number the board holds, open and closed. */
  readonly known?: readonly number[];
}

/** Which reading a command is, since three of them are `gh issue list`. */
function routeOf(args: readonly string[]): string {
  const route = args.slice(0, 2).join(' ');
  if (route !== 'issue list') return route;
  if (args.includes('--label')) return 'issue list --label';
  if (args.includes('all')) return 'issue list --state all';
  return 'issue list --search';
}

/**
 * A `gh` runner over `repo`, answering the four commands the board rows
 * and the blocked issues read and failing every other, and the readings
 * it was asked for. So no case of this file spawns `gh`.
 */
function fakeGh(repo: FakeRepo = {}): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    const route = routeOf(args);
    calls.push(route);
    const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'label list') return ok(JSON.stringify((repo.labels ?? []).map((name) => ({ name }))));
    if (route === 'issue list --search') return ok(JSON.stringify(repo.issues ?? []));
    if (route === 'issue list --label') return ok(JSON.stringify(repo.blocked ?? []));
    if (route === 'issue list --state all') {
      return ok(JSON.stringify((repo.known ?? []).map((number) => ({ number }))));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${route}` });
  };
  return { run, calls: () => calls };
}

/**
 * Seams whose `origin` probe is `readRemote`, whose shell probes are
 * answered from `answers`, a probe named by none of them passing, and
 * whose board rows are read over a bare repository unless `openGh`
 * names another. So no case of the provider spawns git, `gh` or a
 * shell.
 */
function ghSeams(
  readRemote: DoctorSeams['readRemote'],
  answers: Record<string, ProbeRun> = {},
  openGh: DoctorSeams['openGh'] = () => fakeGh().run,
): DoctorSeams {
  return {
    readRemote,
    openGh,
    riskRunners: NO_ACCOUNT_RUNNERS,
    checks: {
      now: () => 0,
      runProbe: (probe) => Promise.resolve(answers[probe] ?? PASSED),
    },
  };
}

/** The lines a bare board prints: every row missing, and the fix. */
function bareBoardLines(): string[] {
  return [
    BOARD_HEADING,
    ...BOARD_LABELS.map((label) => `  missing  label ${label.name}: the repository carries no label of that name`),
    `  missing  ${SPEC_TEMPLATE_PATH}: the repository carries no spec issue template`,
    `  missing  ${ROADMAP_ROW_NAME}: no open issue is titled ${ROADMAP_TITLE}`,
    `  missing  ${ROADMAP_SETTING}: the project config names no roadmap issue`,
    `Run ${BOARD_FIX} to set up 10 parts of the board this run did not find.`,
  ];
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
      riskLine('.plans/PLAN-probe.md'),
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

describe('the plan\'s start-only [start] items', () => {
  /** A `[start]` probe that fails, as a plan names the state a run begins from. */
  const START_PROBE = 'echo "sibling checkout unclean" >&2; exit 1';

  /**
   * That item as a line names it: the whole description, the probe
   * included, through the `JSON.stringify` the runner quotes a name
   * with, which escapes the quotes the probe itself carries.
   */
  const START_ITEM = JSON.stringify(`Sibling clean: \`${START_PROBE}\``);

  /** The PREREQUISITES text of a plan with one failing `[start]` item. */
  const START_PREREQUISITES = [
    '# Prerequisites',
    '',
    `- [ ] [start] Sibling clean: \`${START_PROBE}\``,
    '',
  ].join('\n');

  it('names a failed [start] item of the plan on a first dispatch, beside a control whose tracker already holds a ticked task', async () => {
    const dispatch = plantWorld();
    plant(dispatch.root, '.plans/PLAN-start.md', '# Plan\n\n- [ ] A task\n');
    plant(dispatch.root, '.plans/PREREQUISITES-start.md', START_PREREQUISITES);

    const resume = plantWorld();
    plant(resume.root, '.plans/PLAN-start.md', '# Plan\n\n- [ ] A task\n');
    plant(resume.root, '.plans/PREREQUISITES-start.md', START_PREREQUISITES);
    plant(resume.root, '.plans/PLAN_TRACKER-start.md', '# Plan\n\n- [x] A task\n');

    const first = await doctor(dispatch, ['--plan=.plans/PLAN-start.md']);
    const resumed = await doctor(resume, ['--plan=.plans/PLAN-start.md']);

    // A first dispatch has no tracker yet, so the plan's [start] item is
    // probed like any other required item, and its failure halts the run,
    // naming the item, its probe and its exit code with the stderr line.
    expect(first.exitCode).toBe(1);
    expect(first.stderr).toBe([
      'rafa doctor: preflight halted: 1 required item failed',
      `  tool ${START_ITEM}: probe \`${START_PROBE}\` exited 1: sibling checkout unclean`,
      'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
      '',
    ].join('\n'));
    expect(lines(first.stdout)).toContain(
      `  fail    required tool ${START_ITEM}, probe \`${START_PROBE}\`, 0 ms`,
    );

    // The control's tracker already holds a ticked task, so this is a
    // resume: the same [start] item is not this run's to probe, and its
    // failing probe never runs, never appears in the report and never
    // halts.
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stderr).toBe('');
    expect(resumed.stdout).not.toContain('Sibling clean');
  });

  /** A `[start]` probe that passes, for the cases about how the tier is read. */
  const CLEAN_PROBE = 'exit 0';

  /** The PREREQUISITES text of a plan with one passing `[start]` item. */
  const CLEAN_PREREQUISITES = [
    '# Prerequisites',
    '',
    `- [ ] [start] The sibling checkout is clean: \`${CLEAN_PROBE}\``,
    '',
  ].join('\n');

  /** That item as a check line of a report that probed it. */
  const CLEAN_LINE = `  pass    required tool "The sibling checkout is clean: \`${CLEAN_PROBE}\`",`
    + ` probe \`${CLEAN_PROBE}\`, 0 ms`;

  /** The plan every world below holds, as the line names it. */
  const PLAN_FLAG = '--plan=.plans/PLAN-start.md';

  /** A tracker of that plan holding one ticked task, which makes the next run a resume. */
  const TICKED_TRACKER = '# Plan\n\n- [x] A task\n';

  /** The head line of such a world, for `checked`. */
  function planHead(checked: string): string {
    return `Preflight for .plans/PLAN-start.md, with PREREQUISITES-start.md merged in: ${checked}, no run started.`;
  }

  /** A world holding that plan and `prerequisites`, with `tracker` beside them when one is given. */
  function plantPlanWorld(config: readonly string[] = [], tracker: string | null = null): World {
    const world = plantWorld(config);
    plant(world.root, '.plans/PLAN-start.md', '# Plan\n\n- [ ] A task\n');
    plant(world.root, '.plans/PREREQUISITES-start.md', CLEAN_PREREQUISITES);
    if (tracker !== null) plant(world.root, '.plans/PLAN_TRACKER-start.md', tracker);
    return world;
  }

  /** The line a resume writes for the items it passed over. */
  const SKIPPED_LINE = 'PLAN_TRACKER-start.md already holds a ticked task, so 1 start-only item of the plan'
    + ' went unchecked: rafa loop start probes that tier on a first dispatch alone.';

  it('names the tracker and how many start-only items a resume passed over, where a first dispatch checks them', async () => {
    const world = plantPlanWorld();
    const resume = plantPlanWorld([], TICKED_TRACKER);
    const untickedTracker = plantPlanWorld([], '# Plan\n\n- [ ] A task\n');

    const first = await doctor(world, [PLAN_FLAG]);
    const resumed = await doctor(resume, [PLAN_FLAG]);
    const unticked = await doctor(untickedTracker, [PLAN_FLAG]);

    expect(first.exitCode).toBe(0);
    expect(lines(first.stdout)).toEqual([
      VERSION_LINE,
      planHead('1 item checked'),
      CLEAN_LINE,
      'Preflight passed: rafa loop start would go on to its first session.',
      riskLine('.plans/PLAN-start.md'),
      aheadLine(world),
    ]);

    // The control has run before and ticked a task, so the item is not
    // this run's to probe: it is checked, counted and named nowhere but
    // the one line saying how many were passed over and what said so.
    expect(resumed.exitCode).toBe(0);
    expect(lines(resumed.stdout)).toEqual([
      VERSION_LINE,
      planHead('nothing to check'),
      SKIPPED_LINE,
      'Preflight passed: rafa loop start would go on to its first session.',
      riskLine('.plans/PLAN-start.md'),
      aheadLine(resume),
    ]);

    // A tracker whose every box is open is a run that dispatched nothing
    // that finished, which is a first dispatch still: the reading is the
    // tick, not the file being there.
    expect(lines(unticked.stdout)).toContain(CLEAN_LINE);
    expect(unticked.stdout).not.toContain('already holds a ticked task');
  });

  it('checks them between the provider items and the configured required tier, where a resume checks that tier alone', async () => {
    const world = plantPlanWorld(requiredTool('exit 0'));
    const resume = plantPlanWorld(requiredTool('exit 0'), TICKED_TRACKER);
    const seams = ghSeams(() => GITHUB_ORIGIN);
    const ghLines = [
      `  pass    required tool "gh", probe \`${probeOf(ghOnPathItem(DEFAULT_GH_HOST))}\`, 0 ms`,
      `  pass    required service "https://${DEFAULT_GH_HOST}", probe \`${probeOf(ghAuthItem(DEFAULT_GH_HOST))}\`, 0 ms`,
    ];

    const first = await doctor(world, [PLAN_FLAG], { seams });
    const resumed = await doctor(resume, [PLAN_FLAG], { seams });

    expect(first.exitCode).toBe(0);
    expect(lines(first.stdout).slice(1, 6)).toEqual([
      planHead('4 items checked, 2 of them for the pull request provider'),
      ...ghLines,
      CLEAN_LINE,
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
    ]);
    expect(first.stdout).not.toContain('already holds a ticked task');
    expect(resumed.exitCode).toBe(0);
    expect(lines(resumed.stdout).slice(1, 5)).toEqual([
      planHead('3 items checked, 2 of them for the pull request provider'),
      ...ghLines,
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
    ]);
    expect(lines(resumed.stdout)).toContain(SKIPPED_LINE);
  });

  it('gives the tier as json data, counting what a resume passed over beside the tracker that decided it', async () => {
    const world = plantPlanWorld();
    const resume = plantPlanWorld([], TICKED_TRACKER);
    const dataOf = (stdout: string): DoctorResult | undefined => {
      const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;
      return result?.data;
    };

    const first = await doctor(world, [PLAN_FLAG, '--output=json']);
    const resumed = await doctor(resume, [PLAN_FLAG, '--output=json']);

    expect(first.exitCode).toBe(0);
    expect(dataOf(first.stdout)?.startTier).toEqual({ checked: 1, skipped: 0, tracker: null });
    expect(dataOf(first.stdout)?.checks.map((check) => [check.tier, check.outcome])).toEqual([['required', 'pass']]);
    expect(resumed.exitCode).toBe(0);
    expect(dataOf(resumed.stdout)?.startTier).toEqual({ checked: 0, skipped: 1, tracker: 'PLAN_TRACKER-start.md' });
    expect(dataOf(resumed.stdout)?.checks).toEqual([]);
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

  it('refuses a malformed [auto] item by its line before any probe, as loop start would, beside the item written right', async () => {
    const world = plantWorld();
    plant(world.root, '.plans/PLAN-quoted.md', '# Plan\n');
    plant(world.root, '.plans/PREREQUISITES-quoted.md', '# Prerequisites\n\n- [ ] [auto] `exit 0` answers\n');
    plant(world.root, '.plans/PLAN-fine.md', '# Plan\n');
    plant(world.root, '.plans/PREREQUISITES-fine.md', '# Prerequisites\n\n- [ ] [auto] It answers: `exit 0`\n');

    const quoted = await doctor(world, ['--plan=.plans/PLAN-quoted.md'], { seams: NO_PROBE });
    const fine = await doctor(world, ['--plan=.plans/PLAN-fine.md']);

    expect(quoted.exitCode).toBe(1);
    expect(quoted.stderr).toStartWith('rafa doctor: PREREQUISITES-quoted.md holds 1 malformed [auto] or [start] item(s):'
      + ' no command ends the item after a final ": ".\n'
      + '  line 3 [auto]: `exit 0` answers\n');
    expect(quoted.stderr).toContain('rafa loop start would refuse here, before any probe.');
    expect(quoted.stderr).toEndWith('\nNothing was checked.\n');
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

  it('warns for a project whose plan.dir and specs.dir still name the pre-init directories, and not for one on the defaults', async () => {
    const overriding = plantWorld(['plan:', '  dir: .plans', 'specs:', '  dir: .specs']);
    const defaulting = plantWorld();
    const warning = readPreInitDirs({ planDir: '.plans', specsDir: '.specs' }).warning;

    const warned = await doctor(overriding);
    const quiet = await doctor(defaulting);

    expect(warning).not.toBeNull();
    expect(warned.exitCode).toBe(0);
    expect(lines(warned.stdout).at(-2)).toBe(`warn: ${warning}`);
    expect(lines(warned.stdout).at(-1)).toBe(aheadLine(overriding));
    expect(quiet.exitCode).toBe(0);
    expect(quiet.stdout).not.toContain('before it had defaults of its own');
    expect(quiet.stdout).not.toContain('warn: ');
  });

  it('warns for a project whose previous/ holds fifty-one previous copies, and not for one holding fifty', async () => {
    const warned = plantWorld();
    plantPrevious(warned.root, 51);
    const quiet = plantWorld();
    plantPrevious(quiet.root, 50);
    const warning = readPreviousCopies(warned.root, { specsDir: join('.rafa', 'specs') }).warning;

    const warnedRun = await doctor(warned);
    const quietRun = await doctor(quiet);

    expect(warning).not.toBeNull();
    expect(warnedRun.exitCode).toBe(0);
    expect(lines(warnedRun.stdout).at(-2)).toBe(`warn: ${warning}`);
    expect(lines(warnedRun.stdout).at(-1)).toBe(aheadLine(warned));
    expect(quietRun.exitCode).toBe(0);
    expect(quietRun.stdout).not.toContain('previous copies of issue specs');
    expect(quietRun.stdout).not.toContain('warn: ');
  });
});

describe('json mode', () => {
  it('gives the checks and every install reading as the result data, each warning as a log event, and no text line', async () => {
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
      preInitDirs: { found: [], warning: null },
    });
    expect(result?.data?.checks.map((check) => [check.tier, check.item.name, check.outcome])).toEqual([
      ['required', 'needed', 'pass'],
      ['optional', 'mgrep', 'fail'],
    ]);
  });

  it('carries the previous-copy count and warning in the result data', async () => {
    const world = plantWorld();
    plantPrevious(world.root, 51);
    const warning = readPreviousCopies(world.root, { specsDir: join('.rafa', 'specs') }).warning;

    const run = await doctor(world, ['--output=json']);
    const events = eventsOf(run.stdout);
    const result = events.find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;

    expect(run.exitCode).toBe(0);
    expect(events.filter((event) => event.type === 'log').map((event) => (event as { message?: string }).message))
      .toContain(warning);
    expect(result?.data?.previousCopies).toEqual({ count: 51, warning });
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

describe('the automatic items of the pull request provider', () => {
  it('checks gh on PATH and gh auth status ahead of the configured tier, where a repository with no GitHub origin checks neither', async () => {
    const world = plantWorld(requiredTool('exit 0'));
    const controlWorld = plantWorld(requiredTool('exit 0'));

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => null) });

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('3 items checked, 2 of them for the pull request provider'),
      `  pass    required tool "gh", probe \`${probeOf(ghOnPathItem(DEFAULT_GH_HOST))}\`, 0 ms`,
      `  pass    required service "https://${DEFAULT_GH_HOST}", probe \`${probeOf(ghAuthItem(DEFAULT_GH_HOST))}\`, 0 ms`,
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
      'Preflight passed: rafa loop start would go on to its first session.',
      ...bareBoardLines(),
      aheadLine(world),
    ]);
    expect(control.exitCode).toBe(0);
    expect(lines(control.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('1 item from the config checked'),
      '  pass    required tool "needed", probe `exit 0`, 0 ms',
      'Preflight passed: rafa loop start would go on to its first session.',
      aheadLine(controlWorld),
    ]);
  });

  it('asks about the host origin names, where a configured provider with no origin asks about github.com', async () => {
    const host = 'github.example.com';
    const world = plantWorld(['pr:', '  provider: gh']);
    const controlWorld = plantWorld(['pr:', '  provider: gh']);

    const run = await doctor(world, [], { seams: ghSeams(() => `https://${host}/open-tomato/rafa.git`) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => null) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toContain(`  pass    required service "https://${host}", probe \`${probeOf(ghAuthItem(host))}\`, 0 ms`);
    expect(control.exitCode).toBe(0);
    expect(lines(control.stdout)).toContain(
      `  pass    required service "https://${DEFAULT_GH_HOST}", probe \`${probeOf(ghAuthItem(DEFAULT_GH_HOST))}\`, 0 ms`,
    );
  });

  it('exits 1 with the item remedy when gh is absent, where the same repository with gh present exits 0', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();
    const missing = probeOf(ghOnPathItem(DEFAULT_GH_HOST));
    const failed = { exitCode: 1, stderr: `${ghMissingMessage(DEFAULT_GH_HOST)}\n`, timedOut: false };

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN, { [missing]: failed }) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => GITHUB_ORIGIN) });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe([
      'rafa doctor: preflight halted: 1 required item failed',
      `  tool "gh": probe \`${missing}\` exited 1: ${ghMissingMessage(DEFAULT_GH_HOST)}`,
      'rafa loop start would halt here, before any session. No run was started and nothing was stored.',
      '',
    ].join('\n'));
    expect(run.stderr).toContain('gh auth login --hostname github.com');
    expect(control.exitCode).toBe(0);
    expect(control.stderr).toBe('');
  });

  it('reads no origin at all under a configured pr.provider: none, where every other provider reads it once', async () => {
    const world = plantWorld(['pr:', '  provider: none']);
    const controlWorld = plantWorld();
    const reads: string[] = [];
    const readRemote = (dir: string): string => {
      reads.push(dir);
      return GITHUB_ORIGIN;
    };

    const run = await doctor(world, [], { seams: ghSeams(readRemote) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(readRemote) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toEqual([
      VERSION_LINE,
      noPlanHead('nothing to check'),
      'Preflight passed: rafa loop start would go on to its first session.',
      aheadLine(world),
    ]);
    expect(control.exitCode).toBe(0);
    expect(lines(control.stdout)[1]).toBe(noPlanHead('2 items checked, 2 of them for the pull request provider'));
    expect(reads).toEqual([controlWorld.root]);
  });

  it('counts the provider items in the json result, where a repository with no GitHub origin counts none', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();

    const run = await doctor(world, ['--output=json'], { seams: ghSeams(() => GITHUB_ORIGIN) });
    const control = await doctor(controlWorld, ['--output=json'], { seams: ghSeams(() => null) });
    const dataOf = (stdout: string): DoctorResult | undefined => {
      const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;
      return result?.data;
    };

    expect(run.exitCode).toBe(0);
    expect(dataOf(run.stdout)?.automatic).toBe(2);
    expect(dataOf(run.stdout)?.checks.map((check) => [check.tier, check.item.name])).toEqual([
      ['required', 'gh'],
      ['required', `https://${DEFAULT_GH_HOST}`],
    ]);
    expect(control.exitCode).toBe(0);
    expect(dataOf(control.stdout)?.automatic).toBe(0);
    expect(dataOf(control.stdout)?.checks).toEqual([]);
  });
});

describe('the risk total', () => {
  /** A world holding a plan whose one open task names no tools. */
  function plantRiskWorld(config: readonly string[] = []): World {
    const world = plantWorld(config);
    plant(world.root, '.plans/PLAN-risk.md', '# Plan\n\n- [ ] A task\n');
    return world;
  }

  /** The line the plan above gives. */
  const RISK_LINE = riskLine('.plans/PLAN-risk.md');

  it('prints the line after the verdict and before the board rows for a plan --plan names, where the default plan prints none', async () => {
    const world = plantRiskWorld();
    const named = await doctor(world, ['--plan=.plans/PLAN-risk.md'], { seams: ghSeams(() => GITHUB_ORIGIN) });
    plant(world.root, '.rafa/plans/PLAN.md', '# Plan\n\n- [ ] A task\n');
    const unnamed = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN) });

    expect(named.exitCode).toBe(0);
    const out = lines(named.stdout);
    const verdict = out.indexOf('Preflight passed: rafa loop start would go on to its first session.');
    expect(verdict).toBeGreaterThan(0);
    expect(out.slice(verdict + 1, verdict + 3)).toEqual([RISK_LINE, BOARD_HEADING]);

    // The control resolves the default plan, which it checks, and prints
    // no risk line: `--plan` is how a plan asks for one.
    expect(unnamed.exitCode).toBe(0);
    expect(lines(unnamed.stdout)).toContain('Preflight for .rafa/plans/PLAN.md: 2 items checked, 2 of them for the pull request provider, no run started.');
    expect(unnamed.stdout).not.toContain('Risk:');
  });

  it('counts a secret-looking variable by its name and writes its value nowhere, in text or json', async () => {
    const world = plantRiskWorld();
    const env = { PATH: world.rafaBin, FAKE_TOKEN: 'abc123' };

    const text = await doctor(world, ['--plan=.plans/PLAN-risk.md'], { env });
    const json = await doctor(world, ['--plan=.plans/PLAN-risk.md', '--output=json'], { env });

    expect(lines(text.stdout)).toContain('🛡  Risk: 1 high, 5 notes — rafa plan risk .plans/PLAN-risk.md');
    expect(json.stdout).toContain('🛡  Risk: 1 high, 5 notes');
    for (const written of [text.stdout, text.stderr, json.stdout, json.stderr]) expect(written).not.toContain('abc123');
    expect([text.exitCode, json.exitCode]).toEqual([0, 0]);
  });

  it('gives the line as an info log event in json mode, with no text line and the result data as before', async () => {
    const world = plantRiskWorld();

    const run = await doctor(world, ['--plan=.plans/PLAN-risk.md', '--output=json']);

    expect(run.exitCode).toBe(0);
    const events = eventsOf(run.stdout);
    expect(events).toContainEqual(expect.objectContaining({ type: 'log', level: 'info', message: RISK_LINE }));
    expect(events.some((event) => event.type === 'result')).toBe(true);
    expect(run.stdout.split('\n').filter((line) => line.startsWith('🛡'))).toEqual([]);
  });

  it('prints the line for a halt too and leaves the exit code to the preflight', async () => {
    const world = plantRiskWorld(requiredTool(MISSING_TOOL_PROBE));

    const run = await doctor(world, ['--plan=.plans/PLAN-risk.md']);

    expect(run.exitCode).toBe(1);
    expect(lines(run.stdout)).toContain(RISK_LINE);
    expect(run.stderr).toStartWith('rafa doctor: preflight halted: 1 required item failed');
  });

  it('warns naming the plan when the reading throws and exits 0, beside a control whose reading answers', async () => {
    const world = plantRiskWorld();
    const throwing: DoctorSeams = {
      ...STILL_CLOCK,
      riskRunners: () => {
        throw new Error('planted reading failure');
      },
    };

    const run = await doctor(world, ['--plan=.plans/PLAN-risk.md'], { seams: throwing });
    const control = await doctor(world, ['--plan=.plans/PLAN-risk.md']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain('🛡');
    const planPath = join(world.root, '.plans', 'PLAN-risk.md');
    expect(lines(run.stdout)).toContain(`warn: ⚠️  Risk: could not read ${planPath} — planted reading failure`);
    expect(control.exitCode).toBe(0);
    expect(control.stdout).not.toContain('could not read');
    expect(lines(control.stdout)).toContain(RISK_LINE);
  });
});

describe('the board rows', () => {
  it('prints a row per part and the fix over a bare board, where a board that is set up prints every row present', async () => {
    const bare = plantWorld();
    const ready = plantWorld(['roadmap:', '  issue: 31']);
    plant(ready.root, SPEC_TEMPLATE_PATH, '# Spec\n');
    const setUp = fakeGh({ labels: BOARD_LABELS.map((label) => label.name) });

    const run = await doctor(bare, [], { seams: ghSeams(() => GITHUB_ORIGIN) });
    const control = await doctor(ready, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, () => setUp.run) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout).slice(-13)).toEqual([...bareBoardLines(), aheadLine(bare)]);
    expect(control.exitCode).toBe(0);
    expect(lines(control.stdout).slice(-12)).toEqual([
      BOARD_HEADING,
      ...BOARD_LABELS.map((label) => `  present  label ${label.name}`),
      `  present  ${SPEC_TEMPLATE_PATH}`,
      `  present  ${ROADMAP_ROW_NAME}`,
      `  present  ${ROADMAP_SETTING}`,
      aheadLine(ready),
    ]);
    expect(setUp.calls()).toEqual(['label list', 'issue list --label']);
  });

  it('prints no row and opens no runner where the provider is not gh, where a gh provider opens one', async () => {
    const world = plantWorld(['pr:', '  provider: none']);
    const controlWorld = plantWorld();
    const opened: string[] = [];
    const openGh: DoctorSeams['openGh'] = (root) => {
      opened.push(root);
      return fakeGh().run;
    };

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, openGh) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, openGh) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).not.toContain(BOARD_HEADING);
    expect(lines(control.stdout)).toContain(BOARD_HEADING);
    expect(opened).toEqual([controlWorld.root]);
  });

  it('gives the rows as the board of the json result, where a repository with no GitHub board gives null', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();

    const run = await doctor(world, ['--output=json'], { seams: ghSeams(() => GITHUB_ORIGIN) });
    const control = await doctor(controlWorld, ['--output=json'], { seams: ghSeams(() => null) });
    const dataOf = (stdout: string): DoctorResult | undefined => {
      const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;
      return result?.data;
    };

    expect(run.exitCode).toBe(0);
    expect(dataOf(run.stdout)?.board?.rows.map((row) => [row.name, row.outcome])).toEqual([
      ...BOARD_LABELS.map((label) => [label.name, 'missing']),
      [SPEC_TEMPLATE_PATH, 'missing'],
      [ROADMAP_ROW_NAME, 'missing'],
      [ROADMAP_SETTING, 'missing'],
    ]);
    expect(dataOf(run.stdout)?.board?.roadmapIssue).toBe(null);
    expect(control.exitCode).toBe(0);
    expect(dataOf(control.stdout)?.board).toBe(null);
  });

  it('reports a row it could not read as unknown, where the same command answering reads it', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();
    const failing: DoctorSeams['openGh'] = () => (args) => Promise.resolve(args[0] === 'label'
      ? { ok: false, stdout: '', stderr: 'HTTP 401: Bad credentials' }
      : { ok: true, stdout: '[]', stderr: '' });

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, failing) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => GITHUB_ORIGIN) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toContain(
      '  unknown  label type:spec: board setup: gh label list --limit 100 --json name failed: HTTP 401: Bad credentials',
    );
    expect(lines(control.stdout)).toContain('  missing  label type:spec: the repository carries no label of that name');
  });

  it('prints the rows before a halt refusal and leaves the exit code to the preflight', async () => {
    const world = plantWorld(requiredTool(MISSING_TOOL_PROBE));

    const failed = { exitCode: 127, stderr: 'sh: needed: not found\n', timedOut: false };

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN, { [MISSING_TOOL_PROBE]: failed }) });

    expect(run.exitCode).toBe(1);
    expect(lines(run.stdout).slice(-13)).toEqual([...bareBoardLines(), aheadLine(world)]);
    expect(run.stderr).toContain('rafa loop start would halt here, before any session.');
  });
});

describe('the blocked issues', () => {
  it('names a labelled issue whose Blocked by line is missing, where one whose line reads is only counted', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();
    const faulted: DoctorSeams['openGh'] = () => fakeGh({ blocked: [{ number: 12, body: 'nothing here\n' }] }).run;
    const reading: DoctorSeams['openGh'] = () => fakeGh({
      blocked: [{ number: 12, body: 'Blocked by: #24\n' }],
      known: [12, 24],
    }).run;

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, faulted) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, reading) });

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout).slice(-3)).toEqual([
      BLOCKED_HEADING,
      `  #12 is labelled ${SPEC_BLOCKED_LABEL} and its body carries no "Blocked by:" line;`
        + ` name them as "Blocked by: #24 #26", or take the ${SPEC_BLOCKED_LABEL} label off`,
      aheadLine(world),
    ]);
    expect(control.exitCode).toBe(0);
    expect(lines(control.stdout).slice(-3)).toEqual([
      BLOCKED_HEADING,
      `  1 issue labelled ${SPEC_BLOCKED_LABEL}, naming 1 blocker this run could read`,
      aheadLine(controlWorld),
    ]);
  });

  it('prints no line at all for a board carrying no such issue, where one carrying it prints the heading', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();
    const carrying: DoctorSeams['openGh'] = () => fakeGh({ blocked: [{ number: 12, body: 'no line\n' }] }).run;

    const run = await doctor(world, [], { seams: ghSeams(() => GITHUB_ORIGIN) });
    const control = await doctor(controlWorld, [], { seams: ghSeams(() => GITHUB_ORIGIN, {}, carrying) });

    expect(lines(run.stdout)).not.toContain(BLOCKED_HEADING);
    expect(lines(control.stdout)).toContain(BLOCKED_HEADING);
  });

  it('gives the readings as the blocked of the json result, where a repository with no GitHub board gives null', async () => {
    const world = plantWorld();
    const controlWorld = plantWorld();
    const carrying: DoctorSeams['openGh'] = () => fakeGh({ blocked: [{ number: 12, body: 'no line\n' }] }).run;
    const dataOf = (stdout: string): DoctorResult | undefined => {
      const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;
      return result?.data;
    };

    const run = await doctor(world, ['--output=json'], { seams: ghSeams(() => GITHUB_ORIGIN, {}, carrying) });
    const control = await doctor(controlWorld, ['--output=json'], { seams: ghSeams(() => null) });

    expect(run.exitCode).toBe(0);
    expect(dataOf(run.stdout)?.blocked?.readings.map((read) => [read.issue, read.kind])).toEqual([[12, 'no-line']]);
    expect(dataOf(run.stdout)?.blocked?.faults.length).toBe(1);
    expect(dataOf(run.stdout)?.blocked?.problem).toBe(null);
    expect(control.exitCode).toBe(0);
    expect(dataOf(control.stdout)?.blocked).toBe(null);
  });
});

/** The section heads `--deep` prints, in order, without a plan `--plan` names, whose Plan needs head carries it. */
const DEEP_HEADS = [
  `${ENVIRONMENT_SECTION_TITLE}:`,
  `${SETTINGS_SECTION_TITLE}:`,
  `${PROVIDERS_SECTION_TITLE}:`,
  `${STACK_TOOLS_SECTION_TITLE}:`,
];

/** `seams` with the `--deep` reading's own; see the module note. */
function deepSeams(world: World, seams: DoctorSeams): DoctorSeams {
  return {
    ...seams,
    sessionCwd: () => world.root,
    openProviderGh: () => () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' }),
    inventory: { entry: () => join(world.home, 'runtime', 'cli.js') },
  };
}

/** The section heads of `stdout`, in the order they print. */
function deepHeads(stdout: string): string[] {
  const heads = new Set(DEEP_HEADS);
  return lines(stdout).filter((line) => heads.has(line) || line.startsWith(`${PLAN_NEEDS_SECTION_TITLE} (`));
}

/** The result data of a json-mode run. */
function resultData(stdout: string): DoctorResult | undefined {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: DoctorResult } | undefined;
  return result?.data;
}

describe('the deep sections', () => {
  it('prints every section after the blocked issues and before the install line, where no --deep prints none', async () => {
    const world = plantWorld();
    const carrying: DoctorSeams['openGh'] = () => fakeGh({ blocked: [{ number: 12, body: 'no line\n' }] }).run;
    const seams = deepSeams(world, ghSeams(() => GITHUB_ORIGIN, {}, carrying));

    const run = await doctor(world, ['--deep'], { seams });
    const control = await doctor(world, [], { seams });

    const printed = lines(run.stdout);
    expect(run.exitCode).toBe(0);
    expect(deepHeads(run.stdout)).toEqual(DEEP_HEADS);
    expect(printed.indexOf(BLOCKED_HEADING)).toBeGreaterThan(-1);
    expect(printed.indexOf(`${ENVIRONMENT_SECTION_TITLE}:`)).toBeGreaterThan(printed.indexOf(BLOCKED_HEADING));
    expect(printed.at(-1)).toBe(aheadLine(world));
    expect(control.exitCode).toBe(0);
    expect(deepHeads(control.stdout)).toEqual([]);
    expect(lines(control.stdout).at(-1)).toBe(aheadLine(world));
  });

  it('prints the sections before a halt\'s refusal and leaves the exit code to the preflight', async () => {
    const world = plantWorld(requiredTool(MISSING_TOOL_PROBE));
    const seams = deepSeams(world, STILL_CLOCK);

    const run = await doctor(world, ['--deep'], { seams });
    const control = await doctor(world, [], { seams });

    expect(run.exitCode).toBe(1);
    expect(control.exitCode).toBe(1);
    expect(deepHeads(run.stdout)).toEqual(DEEP_HEADS);
    expect(run.stderr).toContain('rafa loop start would halt here');
    expect(deepHeads(control.stdout)).toEqual([]);
  });

  it('adds Plan needs for a plan --plan names, where the default plan adds none', async () => {
    const world = plantWorld();
    const plan = '.rafa/plans/PLAN-deep.md';
    plant(world.root, plan, '# Plan\n\n- [ ] Review it {agent=absent-reviewer}\n');
    const seams = deepSeams(world, STILL_CLOCK);

    const named = await doctor(world, ['--deep', `--plan=${plan}`], { seams });
    const fallback = await doctor(world, ['--deep'], { seams });

    expect(named.exitCode).toBe(0);
    expect(deepHeads(named.stdout)).toEqual([...DEEP_HEADS, `${PLAN_NEEDS_SECTION_TITLE} (${plan}):`]);
    expect(fallback.exitCode).toBe(0);
    expect(deepHeads(fallback.stdout)).toEqual(DEEP_HEADS);
  });

  it('gives the reading as the deep of the json result, where no --deep gives null', async () => {
    const world = plantWorld();
    const seams = deepSeams(world, STILL_CLOCK);

    const run = await doctor(world, ['--deep', '--output=json'], { seams });
    const control = await doctor(world, ['--output=json'], { seams });

    const deep = resultData(run.stdout)?.deep;
    expect(run.exitCode).toBe(0);
    expect(deep?.projectRoot).toBe(world.root);
    expect(deep?.cwd).toBe(world.root);
    expect(deep?.plan).toBe(null);
    expect([deep?.environment.title, deep?.settings.title, deep?.providers.title, deep?.stackTools.title])
      .toEqual([ENVIRONMENT_SECTION_TITLE, SETTINGS_SECTION_TITLE, PROVIDERS_SECTION_TITLE, STACK_TOOLS_SECTION_TITLE]);
    expect(deep?.planNeeds).toBe(null);
    expect(deepHeads(run.stdout)).toEqual([]);
    expect(control.exitCode).toBe(0);
    expect(resultData(control.stdout)?.deep).toBe(null);
  });

  it('reads --deep as a switch, and refuses it holding a value, checking nothing, beside the bare flag', async () => {
    const world = plantWorld();
    const seams = deepSeams(world, STILL_CLOCK);

    const refused = await doctor(world, ['--deep=yes'], { seams });
    const bare = await doctor(world, ['--deep'], { seams });

    expect(readDeepFlag(undefined)).toBe(false);
    expect(readDeepFlag(false)).toBe(false);
    expect(readDeepFlag(true)).toBe(true);
    expect(readDeepFlag('true')).toBe(true);
    expect(() => readDeepFlag('.rafa/plans/PLAN-a.md')).toThrow('--deep takes no value');
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('rafa doctor: --deep takes no value, and read "yes" as one');
    expect(refused.stderr).toContain('Nothing was checked.');
    expect(deepHeads(refused.stdout)).toEqual([]);
    expect(bare.exitCode).toBe(0);
  });
});

describe('the registered command', () => {
  it('runs over the runner seams of its own, which are the runner defaults', () => {
    expect(DEFAULT_DOCTOR_SEAMS.checks).toEqual({});
    expect(doctorCommand).toMatchObject({ subject: 'doctor', action: 'doctor', outputs: ['text', 'json'] });
    expect(doctorCommand.needsProject).toBeUndefined();
    expect(doctorCommand.flags.map((flag) => flag.name)).toEqual(['plan', 'deep']);
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

  it('spawned with --plan=, prints the risk total line for the named plan', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(join(scratch.repo, '.plans'), { recursive: true });
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-risk.md'), '# Plan\n\n- [ ] A task\n', 'utf8');

    const run = runRafa(scratch, scratch.repo, ['doctor', '--plan=.plans/PLAN-risk.md']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('🛡  Risk: ');
    expect(run.stdout).toContain('— rafa plan risk .plans/PLAN-risk.md');
  }, SPAWN_TIMEOUT);
});
