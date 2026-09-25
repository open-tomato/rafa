/**
 * Tests for the preflight `loop start` runs before any session
 * (`start/preflight.ts`), and for the notice it adds to every task prompt.
 *
 * {@link runStartPreflight} is driven over a temporary repo root with the
 * probe runner stubbed, so no case spawns a probe or waits on a timeout.
 * Its stored rows are read back from the SQLite store under that root, by
 * a query and through `readPreflightHalts`, and its lines through a sink
 * output set for the case and unset after it. Each halt sits beside a
 * control differing from it only in what the probe answered, the store
 * refusal beside the same run over a root whose store can be written, and
 * the unreadable PREREQUISITES file beside the same run with none there.
 *
 * The notice is read off `dispatchTask` with its session runner stubbed,
 * so the prompt read is the bytes a session would take on stdin, stamp
 * included.
 *
 * The roster cases plant their own home as well as their own root, and
 * hand both to the run, so a case that lost one would read this
 * machine's `~/.claude/agents`; the first of them asserts both resolve
 * under this file's scratch directory. Each reading that halts on a
 * missing agent or a colliding skill sits beside a control differing in
 * one thing only — the sources loaded, `tiers.rafa`, a `tiers.agents` or
 * `tiers.skills` entry, the project's definitions, the checkbox of the
 * line, or which of the plan and the tracker exists — so a check applied
 * to everything reddens the control. Every case but two leaves the rafa
 * entry out, so the tier sits beside this file under `bun test`
 * (`Bun.main`), where no `bundled/agents` or `bundled/skills` exists; the
 * two that hand an entry plant the tier they read.
 *
 * Twenty-nine mutations were driven against this file on 2026-09-15, 25
 * of `start/preflight.ts` and 4 of the notice in `start/dispatch.ts`, each
 * an exact string found once, the file run alone on a baseline of 14 pass
 * taken twice, and both modules restored sha256-identical. All but one
 * reddened a case at the first pass. The survivor, the store's clock seam
 * dropped, reddened once the halt case read the halt's `collectedAt`.
 *
 * The automatic items of the pull request provider are driven with the
 * `origin` probe stubbed, so no case here spawns git or reads this
 * checkout's remote: `drive` answers that probe with null unless a case
 * plants one, which is why every other case resolves `pr.provider:
 * none` and checks nothing extra. Each of those cases sits beside a
 * control differing in one thing only — the remote, the configured
 * provider, or what the `gh` probe answered. Three mutations of
 * `start/preflight.ts` were driven against them on 2026-09-18, the file
 * run alone on a baseline of 25 pass and restored sha256-identical: the
 * items appended to the required tier instead of prepended reddened 1
 * case, the `pr.provider: none` shortcut dropped reddened 1, and the
 * `readRemote` seam dropped reddened 5.
 *
 * The start-only tier is driven over a plan whose PREREQUISITES file
 * carries a `[start]` item, with the tracker beside it planted by the
 * case. Each reading sits beside a control differing in one thing only —
 * whether the tracker holds a ticked task, or which of the plan and the
 * tracker holds one. Five mutations of `start/preflight.ts` were driven
 * against them on 2026-09-20, the file run alone on a baseline of 29 pass
 * and restored sha256-identical: the tier dropped from the required list
 * reddened 4 cases, the `isFirstDispatch` reading inverted 4, the tier
 * moved ahead of the provider's automatic items 1, the skip lines not
 * printed 3, and the tracker dropped from the skip line 3.
 *
 * `start()` handing the preflight its settings and its plan, and handing
 * the lines on to each dispatch, is reached by no case here, since
 * `start()` spawns the CLI with no seam. It was read on the same day by
 * spawning `loop start` in scratch repositories under a stand-in `claude`,
 * with each of three strings of `src/start.ts` mutated in turn, and each
 * mutation changed the reading it aimed at.
 */
import type { TierPin } from '../config-sections.js';
import type { OptionalPrerequisiteItem, PrerequisiteItem } from '../config.js';
import type { StartPreflight, StartPreflightOptions, StartPreflightSettings } from './preflight.js';
import type { PrerequisiteSettings } from '../preflight/prerequisites-md.js';
import type { ProbeRun, ProbeRunner } from '../preflight/run.js';
import type { TaskInfo } from '../utils/tracker.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { classifyPromptContent } from '../effort/classify.js';
import { readPreflightHalts } from '../effort/store/preflight.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import {
  DEFAULT_GH_HOST,
  ghAuthItem,
  ghMissingMessage,
  ghOnPathItem,
  ghUnauthenticatedMessage,
} from '../pr/preflight-items.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { planStubFromPrompt } from '../utils/plan-stamp.js';
import { findNextTask, trackerPathFor } from '../utils/tracker.js';

import { buildTaskPrompt, dispatchTask } from './dispatch.js';
import { KNOWN_MISSING_SENTENCE, knownMissingNotice, runStartPreflight } from './preflight.js';
import { serveSession } from './serving.js';
import { setActivePlanStub } from './stamp.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-preflight-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The stub of the plan every planting runs. */
const STUB = 'demo';

/** The id every driven run is generated. */
const RUN_ID = 'run-0001';

/** The clock the stored rows are stamped from. */
const CLOCK = new Date('2026-09-15T10:00:00.000Z');

/** A required item with a probe. */
const BUN: PrerequisiteItem = Object.freeze({ kind: 'tool', name: 'bun', probe: 'bun --version' });

/** An optional item with a probe and a reason. */
const MGREP: OptionalPrerequisiteItem = Object.freeze({
  kind: 'tool',
  name: 'mgrep',
  probe: 'mgrep --version',
  reason: 'faster search; grep is the fallback',
});

/** The line announcing a run that checks one item. */
const CHECKING_ONE = `\n🛫 Preflight: checking 1 prerequisite item(s) under run ${RUN_ID}.`;

let rooted = 0;
let homed = 0;

/** A fresh repo root under this file's scratch directory, holding `.plans/`. */
function freshRoot(): string {
  rooted += 1;
  const root = join(tempRoot, `root-${rooted}`);
  mkdirSync(join(root, '.plans'), { recursive: true });
  return root;
}

/** The plan file a run under `root` executes. It need not exist. */
function planPathIn(root: string): string {
  return join(root, '.plans', `PLAN-${STUB}.md`);
}

/** The PREREQUISITES file of that plan. */
function prerequisitesPathIn(root: string): string {
  return join(root, '.plans', `PREREQUISITES-${STUB}.md`);
}

/** A fresh home under this file's scratch directory, for the roster check. */
function freshHome(): string {
  homed += 1;
  const home = join(tempRoot, `home-${homed}`);
  mkdirSync(home, { recursive: true });
  return home;
}

/** Writes `<root>/.claude/agents/<name>.md` carrying that name as its frontmatter. */
function plantAgent(root: string, name: string): void {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\nThe agent body.\n`, 'utf8');
}

/**
 * A checklist routing two open tasks and one blocked one to agents, one
 * of them defined in the home alone and one nowhere at all.
 */
const TASKS_NAMING_AGENTS = [
  '# Stage: one',
  '',
  '- [ ] Write the tests  {agent=tdd-guide}',
  '- [ ] Ask the void  {agent=no-such-agent}',
  '- [x] Already ran  {agent=also-nowhere}',
  '- [BLOCKED] Ask again  {agent=no-such-agent}',
  '',
].join('\n');

/** The two tiers a run is configured with. */
function settingsOf(
  required: readonly PrerequisiteItem[],
  optional: readonly OptionalPrerequisiteItem[],
): PrerequisiteSettings {
  return { prerequisitesRequired: required, prerequisitesOptional: optional };
}

/** A probe run that exited in time with `exitCode` and `stderr`. */
function answered(exitCode: number, stderr = ''): ProbeRun {
  return { exitCode, stderr, timedOut: false };
}

/** What one driven preflight did. */
interface Driven {
  /** What it answered, or null when it refused. */
  readonly result: StartPreflight | null;
  /** What it threw, or null when it answered. */
  readonly refusal: CommandExit | null;
  /** Each probe run, as `<probe> in <cwd>`. */
  readonly probes: readonly string[];
  readonly info: readonly string[];
  readonly warn: readonly string[];
}

/**
 * Drives one preflight under `root`, each probe answered from `answers`,
 * with a sink output set and unset after it. `options` replaces any seam.
 */
async function drive(
  root: string,
  settings: StartPreflightSettings,
  answers: Readonly<Record<string, ProbeRun>>,
  options: Partial<StartPreflightOptions> = {},
): Promise<Driven> {
  const probes: string[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const runProbe: ProbeRunner = (probe, probeOptions) => {
    probes.push(`${probe} in ${probeOptions.cwd}`);
    const answer = answers[probe];
    if (answer === undefined) throw new Error(`no answer planted for ${probe}`);
    return Promise.resolve(answer);
  };

  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
    warn: (message) => {
      warn.push(message);
    },
  }));
  try {
    const result = await runStartPreflight({
      repoRoot: root,
      planPath: planPathIn(root),
      settings,
      checks: { runProbe, env: {} },
      newRunId: () => RUN_ID,
      now: () => CLOCK,
      // No case here reads this machine's `origin`: a case that wants one
      // plants it, and every other run resolves `pr.provider: none`.
      readRemote: () => null,
      ...options,
    });
    return { result, refusal: null, probes, info, warn };
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return { result: null, refusal: error, probes, info, warn };
  } finally {
    setActiveOutput(null);
  }
}

/** A stored preflight row, as far as these cases read one. */
interface StoredRow {
  readonly run_id: string;
  readonly position: number;
  readonly tier: string;
  readonly item: string;
  readonly outcome: string;
}

/** Every preflight row under `root`, in append order. */
function storedRows(root: string): StoredRow[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<StoredRow, []>('SELECT run_id, position, tier, item, outcome FROM preflight ORDER BY seq').all();
  } finally {
    db.close();
  }
}

describe('a preflight with nothing to check', () => {
  it('runs no probe, stores nothing and prints nothing, answering the run id and no known-missing line', async () => {
    const root = freshRoot();

    const run = await drive(root, settingsOf([], []), {});

    expect(run.refusal).toBeNull();
    expect(run.result?.runId).toBe(RUN_ID);
    expect(run.result?.report.checks).toEqual([]);
    expect(run.result?.reminders).toEqual([]);
    expect(run.result?.knownMissing).toEqual([]);
    expect([run.probes, run.info, run.warn]).toEqual([[], [], []]);
    // The passing run below writes this file, so its absence is a reading.
    expect(existsSync(sqliteStorePath(root))).toBe(false);
  });

  it('opens no store, so one that cannot be opened refuses nothing, where it refuses a run with a check', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    for (const planted of [root, controlRoot]) {
      mkdirSync(join(planted, '.rafa', 'effort'), { recursive: true });
      writeFileSync(sqliteStorePath(planted), 'not a database\n', 'utf8');
    }

    const run = await drive(root, settingsOf([], []), {});
    const control = await drive(controlRoot, settingsOf([BUN], []), { 'bun --version': answered(0) });

    expect(run.refusal).toBeNull();
    expect(run.result?.runId).toBe(RUN_ID);
    expect(control.refusal?.exitCode).toBe(1);
    expect(control.refusal?.message.startsWith(`❌ The preflight checks of run ${RUN_ID} could not be stored: `)).toBe(true);
  });
});

describe('a preflight whose required item passes', () => {
  it('runs the probe in the repo root, stores its row under the run id, halts nothing and says it passed', async () => {
    const root = freshRoot();

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([`bun --version in ${root}`]);
    expect(storedRows(root)).toEqual([
      { run_id: RUN_ID, position: 0, tier: 'required', item: 'bun', outcome: 'pass' },
    ]);
    expect(readPreflightHalts(root)).toEqual([]);
    expect(run.info).toEqual([CHECKING_ONE, '   Preflight passed.']);
    expect(run.warn).toEqual([]);
  });
});

describe('a preflight whose required item fails', () => {
  it('halts with exit code 1 naming the item, the probe, the exit code and the first stderr line, its rows stored and listed', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const settings = settingsOf([BUN], [MGREP]);

    const run = await drive(root, settings, {
      'bun --version': answered(127, '\nsh: bun: not found\nsecond line\n'),
      'mgrep --version': answered(0),
    });
    const control = await drive(controlRoot, settings, {
      'bun --version': answered(0),
      'mgrep --version': answered(0),
    });

    expect(run.result).toBeNull();
    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message).toBe([
      '❌ preflight halted: 1 required item failed',
      '  tool "bun": probe `bun --version` exited 127: sh: bun: not found',
      `   Nothing was dispatched. The checks are stored under run ${RUN_ID},`,
      '   and `rafa effort report` lists the halt.',
    ].join('\n'));
    // The optional item after the failed one was still checked and stored.
    expect(run.probes).toEqual([`bun --version in ${root}`, `mgrep --version in ${root}`]);
    expect(storedRows(root).map((row) => `${row.tier} ${row.item} ${row.outcome}`)).toEqual([
      'required bun fail',
      'optional mgrep pass',
    ]);
    expect(readPreflightHalts(root)).toMatchObject([{
      runId: RUN_ID,
      collectedAt: CLOCK.toISOString(),
      checks: 2,
      failed: [{ kind: 'tool', item: 'bun', probe: 'bun --version', outcome: 'fail' }],
    }]);
    expect(run.info).toEqual([CHECKING_ONE.replace('1 prerequisite', '2 prerequisite')]);

    expect(control.refusal).toBeNull();
    expect(control.result?.runId).toBe(RUN_ID);
    expect(readPreflightHalts(controlRoot)).toEqual([]);
    expect(storedRows(controlRoot)).toHaveLength(2);
  });
});

/** A PREREQUISITES file: a probed `auto` item, then an operator step for after the merge. */
const PREREQUISITES = [
  '# Prerequisites',
  '',
  '## Toolchain [auto]',
  '- [ ] [auto] Bun is installed: `bun --version`',
  '',
  '## Operator steps after the plan merges',
  '- [ ] Publish with `npm publish` once the close-out is green',
  '',
].join('\n');

/** The reminder lines {@link PREREQUISITES} is announced with. */
const REMINDER_LINES: readonly string[] = [
  `\n📌 PREREQUISITES-${STUB}.md names 1 step(s) the preflight does not check:`,
  '   line 7: Publish with `npm publish` once the close-out is green',
];

describe('the PREREQUISITES file of the plan', () => {
  it('halts on a failed probe of its auto item, never runs its human item, and prints that item as a reminder', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    writeFileSync(prerequisitesPathIn(root), PREREQUISITES, 'utf8');
    writeFileSync(prerequisitesPathIn(controlRoot), PREREQUISITES, 'utf8');

    const run = await drive(root, settingsOf([], []), { 'bun --version': answered(1, 'bun: broken') });
    const control = await drive(controlRoot, settingsOf([], []), { 'bun --version': answered(0) });

    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message).toContain('\n  tool "Bun is installed: `bun --version`": probe `bun --version` exited 1: bun: broken\n');
    expect(run.probes).toEqual([`bun --version in ${root}`]);
    expect(run.info).toEqual([...REMINDER_LINES, CHECKING_ONE]);

    expect(control.refusal).toBeNull();
    expect(control.probes).toEqual([`bun --version in ${controlRoot}`]);
    expect(control.result?.reminders).toEqual([
      { description: 'Publish with `npm publish` once the close-out is green', tag: 'human', line: 7 },
    ]);
    expect(control.info).toEqual([...REMINDER_LINES, CHECKING_ONE, '   Preflight passed.']);
  });

  it('refuses a malformed auto item by its line before any probe, where the file written right runs its probe', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const malformed = PREREQUISITES.replace(
      'Bun is installed: `bun --version`',
      '`@open-tomato/define-config` reachable (`npm view @open-tomato/define-config`)',
    );
    writeFileSync(prerequisitesPathIn(root), malformed, 'utf8');
    writeFileSync(prerequisitesPathIn(controlRoot), PREREQUISITES, 'utf8');

    const run = await drive(root, settingsOf([], []), {});
    const control = await drive(controlRoot, settingsOf([], []), { 'bun --version': answered(0) });

    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message.split('\n')).toEqual([
      `❌ Refusing to start: PREREQUISITES-${STUB}.md holds 1 malformed [auto] or [start] item(s):`
        + ' no command ends the item after a final ": ".',
      '     line 4 [auto]: `@open-tomato/define-config` reachable (`npm view @open-tomato/define-config`)',
      '   Write each as - [ ] uv installed: `uvx --version`, its one backticked span a complete command run as'
        + ' written; prove a tool is there with `<tool> --version`, `<tool> --help` or `which <tool>`.',
      '   Nothing was checked and nothing was dispatched.',
    ]);
    expect([run.probes, run.info]).toEqual([[], []]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);

    expect(control.refusal).toBeNull();
    expect(control.probes).toEqual([`bun --version in ${controlRoot}`]);
  });

  it('merges the file for its own plan alone, running nothing for a plan beside it', async () => {
    const root = freshRoot();
    writeFileSync(prerequisitesPathIn(root), PREREQUISITES, 'utf8');

    const run = await drive(root, settingsOf([], []), {}, { planPath: join(root, '.plans', 'PLAN-other.md') });

    expect(run.refusal).toBeNull();
    expect([run.probes, run.info, run.warn]).toEqual([[], [], []]);
  });
});

describe('an optional item that fails', () => {
  it('warns, answers its known-missing line and stores a failed row that halts nothing', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();

    const run = await drive(root, settingsOf([], [MGREP]), { 'mgrep --version': answered(1, 'mgrep: login required') });
    const control = await drive(controlRoot, settingsOf([], [MGREP]), { 'mgrep --version': answered(0) });

    expect(run.refusal).toBeNull();
    expect(run.result?.knownMissing).toEqual(['known-missing: mgrep (faster search; grep is the fallback)']);
    expect(run.warn).toHaveLength(1);
    expect(run.warn[0]).toContain('optional item tool "mgrep" failed: probe `mgrep --version` exited 1: mgrep: login required');
    expect(run.info).toEqual([
      CHECKING_ONE,
      '   Preflight passed; 1 optional item(s) named known-missing in every task prompt.',
    ]);
    expect(storedRows(root)).toEqual([
      { run_id: RUN_ID, position: 0, tier: 'optional', item: 'mgrep', outcome: 'fail' },
    ]);
    expect(readPreflightHalts(root)).toEqual([]);

    expect(control.result?.knownMissing).toEqual([]);
    expect(control.warn).toEqual([]);
    expect(control.info).toEqual([CHECKING_ONE, '   Preflight passed.']);
  });
});

describe('the order a preflight works in', () => {
  it('generates the run id before the first probe, and runs each probe in the repo root with the environment handed in', async () => {
    const root = freshRoot();
    const events: string[] = [];
    const runProbe: ProbeRunner = (probe, options) => {
      events.push(`${probe} in ${options.cwd} with MARK=${String(options.env.MARK)}`);
      return Promise.resolve(answered(0));
    };

    const run = await drive(root, settingsOf([BUN], []), {}, {
      checks: { runProbe, env: { MARK: 'seam' } },
      newRunId: () => {
        events.push('run id');
        return 'run-ordered';
      },
    });

    expect(run.refusal).toBeNull();
    expect(events).toEqual(['run id', `bun --version in ${root} with MARK=seam`]);
    expect(storedRows(root).map((row) => row.run_id)).toEqual(['run-ordered']);
  });
});

/** The probe of `item`, which every automatic item carries. */
function probeOf(item: PrerequisiteItem): string {
  const { probe } = item;
  if (probe === undefined) throw new Error(`${item.name} carries no probe`);
  return probe;
}

/** A GitHub `origin`, as git writes one for an ssh clone. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** An answer for each probe of the two automatic items of `host`, all passing. */
function ghAnswers(host: string): Record<string, ProbeRun> {
  return {
    [probeOf(ghOnPathItem(host))]: answered(0),
    [probeOf(ghAuthItem(host))]: answered(0),
  };
}

describe('the automatic items of the pull request provider', () => {
  it('checks gh on PATH and gh auth status ahead of the configured tier, where a repository with no GitHub origin checks neither', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const settings = settingsOf([BUN], []);
    const answers = { ...ghAnswers(DEFAULT_GH_HOST), 'bun --version': answered(0) };

    const run = await drive(root, settings, answers, { readRemote: () => GITHUB_ORIGIN });
    const control = await drive(controlRoot, settings, answers, { readRemote: () => null });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([
      `${probeOf(ghOnPathItem(DEFAULT_GH_HOST))} in ${root}`,
      `${probeOf(ghAuthItem(DEFAULT_GH_HOST))} in ${root}`,
      `bun --version in ${root}`,
    ]);
    expect(storedRows(root).map((row) => `${row.tier} ${row.item} ${row.outcome}`)).toEqual([
      'required gh pass',
      `required https://${DEFAULT_GH_HOST} pass`,
      'required bun pass',
    ]);
    expect(run.info[0]).toBe(`\n🛫 Preflight: checking 3 prerequisite item(s) under run ${RUN_ID}.`);
    expect(control.refusal).toBeNull();
    expect(control.probes).toEqual([`bun --version in ${controlRoot}`]);
  });

  it('asks about the host origin names, where a configured provider with no origin asks about github.com', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const host = 'github.example.com';
    const settings: StartPreflightSettings = { ...settingsOf([], []), prProvider: 'gh' };

    const run = await drive(root, settings, ghAnswers(host), {
      readRemote: () => `https://${host}/open-tomato/rafa.git`,
    });
    const control = await drive(controlRoot, settings, ghAnswers(DEFAULT_GH_HOST), { readRemote: () => null });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([
      `${probeOf(ghOnPathItem(host))} in ${root}`,
      `${probeOf(ghAuthItem(host))} in ${root}`,
    ]);
    expect(storedRows(root).map((row) => row.item)).toEqual(['gh', `https://${host}`]);
    expect(control.refusal).toBeNull();
    expect(storedRows(controlRoot).map((row) => row.item)).toEqual(['gh', `https://${DEFAULT_GH_HOST}`]);
  });

  it('halts the run when gh is absent, its remedy the failure, where the same run with gh present dispatches', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const settings = settingsOf([BUN], []);
    const missing = probeOf(ghOnPathItem(DEFAULT_GH_HOST));
    const answers = {
      ...ghAnswers(DEFAULT_GH_HOST),
      'bun --version': answered(0),
    };

    const run = await drive(root, settings, {
      ...answers,
      [missing]: answered(1, `${ghMissingMessage(DEFAULT_GH_HOST)}\n`),
    }, { readRemote: () => GITHUB_ORIGIN });
    const control = await drive(controlRoot, settings, answers, { readRemote: () => GITHUB_ORIGIN });

    expect(run.result).toBeNull();
    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message).toBe([
      '❌ preflight halted: 1 required item failed',
      `  tool "gh": probe \`${missing}\` exited 1: ${ghMissingMessage(DEFAULT_GH_HOST)}`,
      `   Nothing was dispatched. The checks are stored under run ${RUN_ID},`,
      '   and `rafa effort report` lists the halt.',
    ].join('\n'));
    expect(run.refusal?.message.includes('gh auth login --hostname github.com')).toBe(true);
    expect(control.refusal).toBeNull();
  });

  it('halts the run when gh is not authenticated for the remote host, naming that host in the remedy', async () => {
    const root = freshRoot();
    const host = 'github.com';
    const auth = probeOf(ghAuthItem(host));

    const run = await drive(root, settingsOf([], []), {
      ...ghAnswers(host),
      [auth]: answered(1, `${ghUnauthenticatedMessage(host)}\n`),
    }, { readRemote: () => GITHUB_ORIGIN });

    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message.split('\n')[1]).toBe(
      `  service "https://${host}": probe \`${auth}\` exited 1: ${ghUnauthenticatedMessage(host)}`,
    );
    expect(readPreflightHalts(root)).toMatchObject([{
      runId: RUN_ID,
      failed: [{ kind: 'service', item: `https://${host}`, outcome: 'fail' }],
    }]);
  });

  it('reads no origin at all under a configured pr.provider: none, where every other provider reads it once', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    const reads: string[] = [];
    const readRemote = (dir: string): string => {
      reads.push(dir);
      return GITHUB_ORIGIN;
    };

    const run = await drive(root, { ...settingsOf([], []), prProvider: 'none' }, {}, { readRemote });
    const control = await drive(controlRoot, { ...settingsOf([], []), prProvider: 'gh' }, ghAnswers(DEFAULT_GH_HOST), { readRemote });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([]);
    expect(control.refusal).toBeNull();
    expect(control.probes.length).toBe(2);
    expect(reads).toEqual([controlRoot]);
  });
});

/** A PREREQUISITES file whose only item is a probed `[start]` one. */
const START_PREREQUISITES = [
  '# Prerequisites',
  '',
  '## Starting state [start]',
  '- [ ] The sibling checkout is clean: `git status --porcelain`',
  '',
].join('\n');

/** The one start-only item {@link START_PREREQUISITES} names. */
const CLEAN_CHECKOUT = 'The sibling checkout is clean: `git status --porcelain`';

/** Its probe. */
const CLEAN_PROBE = 'git status --porcelain';

/** The line a resume names one skipped start-only item with. */
function skipLine(name: string): string {
  return `⏭ start-only item tool ${JSON.stringify(name)} was not checked:`
    + ' it is probed on a first dispatch alone,'
    + ` and PLAN_TRACKER-${STUB}.md already holds a ticked task`;
}

/** Writes `content` to the tracker beside the plan under `root`. */
function plantTracker(root: string, content: string): void {
  writeFileSync(trackerPathFor(planPathIn(root)), content, 'utf8');
}

/** A fresh root carrying `prerequisites` for its plan. */
function rootWithPrerequisites(prerequisites: string): string {
  const root = freshRoot();
  writeFileSync(prerequisitesPathIn(root), prerequisites, 'utf8');
  return root;
}

describe('the start-only tier of the plan', () => {
  it('probes it ahead of the configured required tier on a first dispatch, where a tracker holding a ticked task skips it', async () => {
    const root = rootWithPrerequisites(START_PREREQUISITES);
    const resumedRoot = rootWithPrerequisites(START_PREREQUISITES);
    plantTracker(resumedRoot, '# Stage: one\n\n- [x] Already ran\n- [ ] Still to run\n');
    const settings = settingsOf([BUN], []);
    const answers = { [CLEAN_PROBE]: answered(0), 'bun --version': answered(0) };

    const first = await drive(root, settings, answers);
    const resumed = await drive(resumedRoot, settings, answers);

    expect(first.refusal).toBeNull();
    expect(first.probes).toEqual([`${CLEAN_PROBE} in ${root}`, `bun --version in ${root}`]);
    expect(storedRows(root).map((row) => `${row.tier} ${row.item} ${row.outcome}`)).toEqual([
      `required ${CLEAN_CHECKOUT} pass`,
      'required bun pass',
    ]);
    expect(first.info).toEqual([CHECKING_ONE.replace('1 prerequisite', '2 prerequisite'), '   Preflight passed.']);

    // The resume checks the configured tier alone: one item, one row, and the skip line.
    expect(resumed.refusal).toBeNull();
    expect(resumed.probes).toEqual([`bun --version in ${resumedRoot}`]);
    expect(storedRows(resumedRoot).map((row) => `${row.tier} ${row.item} ${row.outcome}`)).toEqual([
      'required bun pass',
    ]);
    expect(resumed.info).toEqual([`\n${skipLine(CLEAN_CHECKOUT)}`, CHECKING_ONE, '   Preflight passed.']);
    expect(resumed.warn).toEqual([]);
  });

  it('names every skipped item in one line of its own, where the same file on a first dispatch prints none', async () => {
    const second = 'The branch is fresh: `git rev-parse --abbrev-ref HEAD`';
    const prerequisites = START_PREREQUISITES.replace(
      `- [ ] ${CLEAN_CHECKOUT}\n`,
      `- [ ] ${CLEAN_CHECKOUT}\n- [ ] ${second}\n`,
    );
    const root = rootWithPrerequisites(prerequisites);
    const controlRoot = rootWithPrerequisites(prerequisites);
    plantTracker(root, '- [x] Already ran\n');
    const answers = { [CLEAN_PROBE]: answered(0), 'git rev-parse --abbrev-ref HEAD': answered(0) };

    const resumed = await drive(root, settingsOf([], []), answers);
    const control = await drive(controlRoot, settingsOf([], []), answers);

    expect(resumed.refusal).toBeNull();
    expect(resumed.info).toEqual([`\n${skipLine(CLEAN_CHECKOUT)}`, skipLine(second)]);
    // Nothing skipped is checked, counted, or stored, so no run line and no store at all.
    expect(resumed.probes).toEqual([]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);

    expect(control.info).toEqual([
      CHECKING_ONE.replace('1 prerequisite', '2 prerequisite'),
      '   Preflight passed.',
    ]);
    expect(control.probes).toEqual([
      `${CLEAN_PROBE} in ${controlRoot}`,
      `git rev-parse --abbrev-ref HEAD in ${controlRoot}`,
    ]);
  });

  it('reads the tracker and not the plan, a tracker whose every box is open being a first dispatch still', async () => {
    const root = rootWithPrerequisites(START_PREREQUISITES);
    // The plan keeps its boxes open whatever the run has done, and a tick
    // there is no reading: this one holds one and the tracker holds none.
    writeFileSync(planPathIn(root), '- [x] The plan was ticked by hand\n- [ ] Write it\n', 'utf8');
    plantTracker(root, '- [ ] Write it\n- [BLOCKED] Ask again\n');
    const answers = { [CLEAN_PROBE]: answered(0) };

    const open = await drive(root, settingsOf([], []), answers);
    // The control differs in one line of the tracker: the task now ticked.
    plantTracker(root, '- [x] Write it\n- [BLOCKED] Ask again\n');
    const ticked = await drive(root, settingsOf([], []), answers);

    expect(open.refusal).toBeNull();
    expect(open.probes).toEqual([`${CLEAN_PROBE} in ${root}`]);
    expect(open.info).toEqual([CHECKING_ONE, '   Preflight passed.']);
    expect(ticked.probes).toEqual([]);
    expect(ticked.info).toEqual([`\n${skipLine(CLEAN_CHECKOUT)}`]);
  });

  it('keeps the pull request provider automatic items ahead of it, and both ahead of the configured tier', async () => {
    const root = rootWithPrerequisites(START_PREREQUISITES);

    const run = await drive(root, settingsOf([BUN], []), {
      ...ghAnswers(DEFAULT_GH_HOST),
      [CLEAN_PROBE]: answered(0),
      'bun --version': answered(0),
    }, { readRemote: () => GITHUB_ORIGIN });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([
      `${probeOf(ghOnPathItem(DEFAULT_GH_HOST))} in ${root}`,
      `${probeOf(ghAuthItem(DEFAULT_GH_HOST))} in ${root}`,
      `${CLEAN_PROBE} in ${root}`,
      `bun --version in ${root}`,
    ]);
    expect(storedRows(root).map((row) => row.item)).toEqual([
      'gh',
      `https://${DEFAULT_GH_HOST}`,
      CLEAN_CHECKOUT,
      'bun',
    ]);
  });

  it('halts on a first dispatch when its probe fails, and lets a resume through with the skip line instead', async () => {
    const root = rootWithPrerequisites(START_PREREQUISITES);
    const resumedRoot = rootWithPrerequisites(START_PREREQUISITES);
    plantTracker(resumedRoot, '# Stage: one\n\n- [x] Already ran\n- [ ] Still to run\n');
    const settings = settingsOf([], []);
    const answers = { [CLEAN_PROBE]: answered(1, 'sh: not clean') };

    const first = await drive(root, settings, answers);
    const resumed = await drive(resumedRoot, settings, answers);

    expect(first.result).toBeNull();
    expect(first.refusal?.exitCode).toBe(1);
    expect(first.probes).toEqual([`${CLEAN_PROBE} in ${root}`]);
    expect(storedRows(root).map((row) => `${row.tier} ${row.item} ${row.outcome}`)).toEqual([
      `required ${CLEAN_CHECKOUT} fail`,
    ]);

    // The resume never runs the failing probe: it is skipped, not checked and failed.
    expect(resumed.refusal).toBeNull();
    expect(resumed.probes).toEqual([]);
    expect(existsSync(sqliteStorePath(resumedRoot))).toBe(false);
    expect(resumed.info).toEqual([`\n${skipLine(CLEAN_CHECKOUT)}`]);
    expect(resumed.warn).toEqual([]);
  });
});

/** Plants a file where the store's directory goes, so no row can be written under `root`. */
function blockStore(root: string): string {
  const blocker = join(root, '.rafa', 'effort');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(blocker, 'not a directory\n', 'utf8');
  return blocker;
}

describe('a preflight whose rows the store refuses', () => {
  it('refuses with exit code 1 for a run whose checks passed, naming the store refusal', async () => {
    const root = freshRoot();
    const blocker = blockStore(root);

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) });

    expect(run.refusal?.exitCode).toBe(1);
    const [first, second, ...rest] = run.refusal?.message.split('\n') ?? [];
    expect(first?.startsWith(`❌ The preflight checks of run ${RUN_ID} could not be stored: `)).toBe(true);
    expect(first).toContain(blocker);
    expect(second).toBe('   Nothing was dispatched. Make the store writable, then run again.');
    expect(rest).toEqual([]);
    expect(run.info).toEqual([CHECKING_ONE]);
    // The same run under a root whose store can be written is the passing case above.
  });

  it('keeps the halt first for a run that halted, the store refusal in place of where the rows went', async () => {
    const root = freshRoot();
    const blocker = blockStore(root);

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(127, 'sh: bun: not found') });

    expect(run.refusal?.exitCode).toBe(1);
    const message = run.refusal?.message ?? '';
    expect(message.startsWith([
      '❌ preflight halted: 1 required item failed',
      '  tool "bun": probe `bun --version` exited 127: sh: bun: not found',
      `   Nothing was dispatched. The checks of run ${RUN_ID} were not stored: `,
    ].join('\n'))).toBe(true);
    expect(message).toContain(blocker);
    expect(message).not.toContain('lists the halt');
  });
});

describe('a PREREQUISITES file that cannot be read', () => {
  it('refuses with exit code 1 naming its path, having run no probe and stored nothing', async () => {
    const root = freshRoot();
    const controlRoot = freshRoot();
    mkdirSync(prerequisitesPathIn(root));

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) });
    const control = await drive(controlRoot, settingsOf([BUN], []), { 'bun --version': answered(0) });

    expect(run.refusal?.exitCode).toBe(1);
    const [first, second, third, ...rest] = run.refusal?.message.split('\n') ?? [];
    expect(first).toBe('❌ Refusing to start: the plan\'s prerequisites cannot be read.');
    expect(second?.startsWith(`   ${prerequisitesPathIn(root)}: cannot be read (`)).toBe(true);
    expect(third).toBe('   Nothing was checked and nothing was dispatched.');
    expect(rest).toEqual([]);
    expect([run.probes, run.info, run.warn]).toEqual([[], [], []]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);

    expect(control.refusal).toBeNull();
    expect(control.probes).toEqual([`bun --version in ${controlRoot}`]);
  });
});

describe('the agent roster check', () => {
  it('halts with exit code 1 naming each missing agent and its fix, having run no probe and stored nothing', async () => {
    const root = freshRoot();
    const home = freshHome();
    plantAgent(home, 'tdd-guide');
    writeFileSync(planPathIn(root), TASKS_NAMING_AGENTS, 'utf8');

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, {
      agents: { settingSources: ['project', 'local'], home },
    });
    // The control differs only in the sources, which bring the home into reach.
    const control = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, {
      agents: { settingSources: ['user', 'project', 'local'], home },
    });

    expect(run.refusal?.exitCode).toBe(1);
    expect(run.refusal?.message.split('\n')).toEqual([
      `❌ Refusing to start: PLAN-${STUB}.md names 2 agent(s) no loaded tier serves`
        + ' (loop.settingSources: project, local; tiers.rafa: on).',
      '   agent "tdd-guide" (line 3) cannot be dispatched: agent tdd-guide is held only by the user tier'
        + ` (${join(home, '.claude', 'agents', 'tdd-guide.md')}), which loop.settingSources (project, local) leaves out:`
        + ' add user to loop.settingSources, or run `rafa agent vendor tdd-guide`',
      '   agent "no-such-agent" (lines 4, 6) cannot be dispatched: agent no-such-agent is held by no tier:'
        + ' no project, rafa or user definition carries it, and it is no built-in agent',
      '   Nothing was checked and nothing was dispatched.',
    ]);
    expect([run.probes, run.info, run.warn]).toEqual([[], [], []]);
    expect(existsSync(sqliteStorePath(root))).toBe(false);

    // Under `user` only `no-such-agent` is left, so the halt is the roster's and not the sources'.
    expect(control.refusal?.message).toContain('names 1 agent(s) no loaded tier serves');
    expect(control.refusal?.message).not.toContain('"tdd-guide"');
    expect([root, home].every((planted) => planted.startsWith(tempRoot))).toBe(true);
  });

  it('lets a run through once the project defines every agent its open tasks name', async () => {
    const root = freshRoot();
    const home = freshHome();
    writeFileSync(planPathIn(root), TASKS_NAMING_AGENTS, 'utf8');
    for (const name of ['tdd-guide', 'no-such-agent']) plantAgent(root, name);

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, {
      agents: { settingSources: ['project', 'local'], home },
    });

    expect(run.refusal).toBeNull();
    expect(run.probes).toEqual([`bun --version in ${root}`]);
  });

  it('reads the tracker when one sits beside the plan, and the plan when none does', async () => {
    const root = freshRoot();
    const home = freshHome();
    plantAgent(root, 'in-the-project');
    writeFileSync(planPathIn(root), '- [ ] Write it  {agent=in-the-project}\n', 'utf8');

    const withoutTracker = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: ['project', 'local'], home },
    });

    writeFileSync(trackerPathFor(planPathIn(root)), '- [ ] Write it  {agent=only-in-the-tracker}\n', 'utf8');
    const withTracker = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: ['project', 'local'], home },
    });

    expect(withoutTracker.refusal).toBeNull();
    expect(withTracker.refusal?.exitCode).toBe(1);
    expect(withTracker.refusal?.message).toContain(`PLAN_TRACKER-${STUB}.md names 1 agent(s)`);
    expect(withTracker.refusal?.message).toContain('"only-in-the-tracker"');
  });

  it('passes over a ticked task, and a checklist that cannot be read', async () => {
    const root = freshRoot();
    const home = freshHome();
    const unreadable = freshRoot();
    writeFileSync(planPathIn(root), '- [x] Write it  {agent=already-ran}\n', 'utf8');

    const ticked = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: ['project', 'local'], home },
    });
    // No plan file at all: the absence is `start()`'s refusal, not this one's.
    const absent = await drive(unreadable, settingsOf([], []), {}, {
      agents: { settingSources: ['project', 'local'], home },
    });

    expect([ticked.refusal, absent.refusal]).toEqual([null, null]);

    // The control: the same line still to run does halt, so the two readings above are not vacuous.
    writeFileSync(planPathIn(root), '- [ ] Write it  {agent=already-ran}\n', 'utf8');
    const open = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: ['project', 'local'], home },
    });

    expect(open.refusal?.message).toContain('"already-ran"');
  });

  it('resolves the sources and the home the run was configured with, defaulting the sources to the config default', async () => {
    const root = freshRoot();
    const home = freshHome();
    plantAgent(home, 'tdd-guide');
    writeFileSync(planPathIn(root), '- [ ] Write the tests  {agent=tdd-guide}\n', 'utf8');

    const defaulted = await drive(root, settingsOf([], []), {}, { agents: { home } });
    const loadingUser = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: ['user'], home },
    });

    expect(CONFIG_DEFAULTS.settingSources).toEqual(['project', 'local']);
    expect(defaulted.refusal?.message).toContain('(loop.settingSources: project, local; tiers.rafa: on).');
    expect(defaulted.refusal?.message).toContain('run `rafa agent vendor tdd-guide`');
    expect(loadingUser.refusal).toBeNull();
  });

  it('resolves the tier switch, the pins and the rafa entry the run was configured with', async () => {
    const root = freshRoot();
    const home = freshHome();
    const entry = join(freshHome(), 'dist', 'cli.js');
    const bundled = join(entry, '..', 'bundled', 'agents');
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, 'from-rafa.md'), '---\nname: from-rafa\ndescription: Planted.\n---\nBody.\n', 'utf8');
    plantAgent(root, 'in-the-project');
    writeFileSync(planPathIn(root), '- [ ] Write it  {agent=in-the-project}\n- [ ] Test it  {agent=from-rafa}\n', 'utf8');
    const sources = ['project', 'local'] as const;

    const served = await drive(root, settingsOf([], []), {}, { agents: { settingSources: sources, home, entry } });
    const rafaOff = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: sources, tiersRafa: 'off', home, entry },
    });
    const switchedOff = await drive(root, settingsOf([], []), {}, {
      agents: { settingSources: sources, tiersAgents: new Map([['in-the-project', false]]), home, entry },
    });

    expect(served.refusal).toBeNull();
    expect(rafaOff.refusal?.message).toContain('names 1 agent(s) no loaded tier serves (loop.settingSources: project, local; tiers.rafa: off).');
    expect(rafaOff.refusal?.message).toContain('"from-rafa" (line 2)');
    expect(switchedOff.refusal?.message).toContain('"in-the-project" (line 1) cannot be dispatched:'
      + ' agent in-the-project is switched off by tiers.agents: { in-the-project: false }');
    expect(switchedOff.refusal?.message).not.toContain('"from-rafa"');
  });

  it('halts on a skills= name two loaded tiers hold with different contents, until a project pin chooses', async () => {
    const root = freshRoot();
    const home = freshHome();
    const entry = join(freshHome(), 'dist', 'cli.js');
    const rafa = join(entry, '..', 'bundled', 'skills', 'documentation', 'SKILL.md');
    const project = join(root, '.claude', 'skills', 'documentation', 'SKILL.md');
    for (const [path, body] of [[rafa, 'The rafa body.'], [project, 'The project body.']] as const) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, `---\nname: documentation\ndescription: Planted.\n---\n${body}\n`, 'utf8');
    }
    writeFileSync(planPathIn(root), '- [ ] Write it  {skills=documentation}\n', 'utf8');
    const agents = { settingSources: ['project', 'local'] as const, home, entry };
    const tierSettings = (pin: TierPin | null) => ({
      settingSources: ['project', 'local'] as const,
      tiersRafa: 'on' as const,
      tiersSkills: new Map<string, TierPin>(pin === null
        ? []
        : [['documentation', pin]]),
      tiersAgents: new Map<string, TierPin>(),
    });

    const collided = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, { agents });
    // Claude Code loads the project's skill over the served copy, so a
    // pin to rafa cannot settle the name, and the run still halts.
    const pinnedToRafa = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, {
      agents: { ...agents, tiersSkills: new Map([['documentation', 'rafa']]) },
    });
    const pinnedToProject = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(0) }, {
      agents: { ...agents, tiersSkills: new Map([['documentation', 'project']]) },
    });
    // Beside a missing agent the one refusal names both kinds.
    writeFileSync(planPathIn(root), '- [ ] Write it  {agent=no-such-agent skills=documentation}\n', 'utf8');
    const both = await drive(root, settingsOf([], []), {}, { agents });

    const heldBy = '   skill "documentation" (line 1) cannot be served: skill documentation is held by 2 loaded tiers'
      + ` with different contents: project ${project} and rafa ${rafa};`;
    const skillLine = `${heldBy} pin the tier that serves it: tiers.skills: { documentation: project }`;
    expect(collided.refusal?.exitCode).toBe(1);
    expect(collided.refusal?.message.split('\n')).toEqual([
      `❌ Refusing to start: PLAN-${STUB}.md names 1 skill(s) two loaded tiers hold with different contents`
        + ' (loop.settingSources: project, local; tiers.rafa: on).',
      skillLine,
      '   Nothing was checked and nothing was dispatched.',
    ]);
    expect(collided.probes).toEqual([]);
    expect(pinnedToRafa.refusal?.exitCode).toBe(1);
    expect(pinnedToRafa.refusal?.message.split('\n')[1]).toBe(`${heldBy} tiers.skills: { documentation: rafa } has no effect,`
      + ' because Claude Code always loads the project\'s .claude/skills/documentation and it outranks the rafa copy:'
      + ' a skill pin can only name project (tiers.skills: { documentation: project }),'
      + ' or delete or rename the project copy to let the rafa copy serve');
    expect(pinnedToRafa.probes).toEqual([]);
    // The control: a pin to project settles the name, and the run goes on to its probes.
    expect(pinnedToProject.refusal).toBeNull();
    expect(pinnedToProject.probes).toEqual([`bun --version in ${root}`]);
    // Under the rafa pin, the session is served no copy of the name.
    const setAside = serveSession({ root, run: RUN_ID, home, entry, settings: tierSettings('rafa') });
    expect(setAside.skills).toEqual([]);
    // With the project copy gone, the way out the refusal names, the same pin serves the rafa copy.
    rmSync(join(project, '..'), { recursive: true });
    const served = serveSession({ root, run: RUN_ID, home, entry, settings: tierSettings('rafa') });
    expect(served.skills.map((copy) => copy.name)).toEqual(['documentation']);
    expect(readFileSync(join(served.dir, '.claude', 'skills', 'documentation', 'SKILL.md'), 'utf8')).toContain('The rafa body.');
    expect(both.refusal?.message.split('\n').slice(0, 3)).toEqual([
      `❌ Refusing to start: PLAN-${STUB}.md names 1 agent(s) no loaded tier serves and 1 skill(s) two loaded`
        + ' tiers hold with different contents (loop.settingSources: project, local; tiers.rafa: on).',
      expect.stringContaining('   agent "no-such-agent" (line 1) cannot be dispatched:'),
      skillLine,
    ]);
  });

  it('halts on the roster before any probe runs, where the probe would halt the run too', async () => {
    const root = freshRoot();
    const home = freshHome();
    writeFileSync(planPathIn(root), '- [ ] Write it  {agent=no-such-agent}\n', 'utf8');

    const run = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(127, 'sh: bun: not found') }, {
      agents: { settingSources: ['project', 'local'], home },
    });
    // The control, with the plan naming no agent: the same probe halts the run.
    writeFileSync(planPathIn(root), '- [ ] Write it\n', 'utf8');
    const control = await drive(root, settingsOf([BUN], []), { 'bun --version': answered(127, 'sh: bun: not found') }, {
      agents: { settingSources: ['project', 'local'], home },
    });

    expect(run.refusal?.message).toContain('names 1 agent(s) no loaded tier serves');
    expect(run.probes).toEqual([]);
    expect(control.refusal?.message).toContain('preflight halted');
    expect(control.probes).toEqual([`bun --version in ${root}`]);
  });
});

describe('the known-missing notice', () => {
  it('answers nothing for no line, and the lines followed by the sentence otherwise', () => {
    const lines = ['known-missing: mgrep', 'known-missing: LINEAR_API_KEY (the tracker falls back to local)'];

    expect(knownMissingNotice([])).toEqual([]);
    expect(knownMissingNotice(lines)).toEqual([...lines, KNOWN_MISSING_SENTENCE]);
    expect(KNOWN_MISSING_SENTENCE).toContain('neither a bug to fix nor a credential to patch around');
    expect(KNOWN_MISSING_SENTENCE).not.toContain('\n');
  });
});

/** The task the notice cases dispatch. */
const TASK = 'A task the notice rides on';

/** The plan the notice cases dispatch from, ending in a newline as a plan file does. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK}\n`;

/** The PROMPT.md the notice cases dispatch with. */
const PROMPT = 'The prompt body.';

/** The task {@link PLAN} hands the loop first. */
function planTask(): TaskInfo {
  const task = findNextTask(PLAN);
  if (task === null) throw new Error('the notice plan holds no open task');
  return task;
}

/** Dispatches {@link TASK} under the plan stamp, `knownMissing` handed in when not undefined, and answers its prompt. */
async function promptFor(knownMissing: readonly string[] | undefined): Promise<string> {
  const prompts: string[] = [];
  setActivePlanStub(STUB);
  setActiveOutput(sinkOutput({}));
  try {
    const dispatch = await dispatchTask({
      taskInfo: planTask(),
      promptContent: PROMPT,
      planContent: PLAN,
      inject: 'full',
      repoRoot: tempRoot,
      home: join(tempRoot, 'home'),
      settingSources: ['project', 'local'],
      serving: null,
      run: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve({ exitCode: 0, stdout: '' });
      },
      ...(knownMissing === undefined
        ? {}
        : { knownMissing }),
    });
    expect(prompts).toEqual([dispatch.prompt]);
    return dispatch.prompt;
  } finally {
    setActivePlanStub(null);
    setActiveOutput(null);
  }
}

/** The stamp {@link promptFor} closes a prompt with. */
const STAMP = `<!-- ralph:plan=${STUB} -->`;

/** The prompt the loop built for {@link TASK} before the preflight existed, stamp aside. */
const PROMPT_BEFORE = [
  `Your scoped task is: ${TASK}`,
  'Consider tasks listed above this one in the plan checklist as completed. Do not re-evaluate or re-do them. Focus only on the scoped task.',
  '',
  PROMPT,
  PLAN,
].join('\n');

describe('a task prompt dispatched after a preflight', () => {
  it('closes with the known-missing lines and the sentence after the plan text and before the stamp, its first line the task key', async () => {
    const lines = ['known-missing: mgrep (faster search; grep is the fallback)', 'known-missing: LINEAR_API_KEY'];

    const prompt = await promptFor(lines);

    expect(prompt).toBe(`${PROMPT_BEFORE}\n${lines[0]}\n${lines[1]}\n${KNOWN_MISSING_SENTENCE}\n${STAMP}`);
    expect(prompt.split('\n')[0]).toBe(`Your scoped task is: ${TASK}`);
    expect(classifyPromptContent(prompt)).toBe('task');
    expect(planStubFromPrompt(prompt)).toBe(STUB);
  });

  it('is the prompt built before the preflight existed when nothing is known-missing, left out or empty', async () => {
    expect(await promptFor(undefined)).toBe(`${PROMPT_BEFORE}\n${STAMP}`);
    expect(await promptFor([])).toBe(`${PROMPT_BEFORE}\n${STAMP}`);
    expect(buildTaskPrompt(TASK, PROMPT, PLAN)).toBe(PROMPT_BEFORE);
    expect(buildTaskPrompt(TASK, PROMPT, PLAN, [])).toBe(PROMPT_BEFORE);
  });
});
