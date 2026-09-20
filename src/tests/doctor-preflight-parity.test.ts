/**
 * `rafa doctor` and `rafa loop start` read the same items off the same
 * plan through two different modules (`commands/doctor.ts` merges them
 * itself; `start/preflight.ts` is what `loop start` calls), and
 * `doctor.test.ts` already drives every seam of that merge on its own.
 * What is untested there is the join: that the two REAL, spawned
 * commands, given one identical planted project, actually name the
 * identical required items in the identical order, rather than two
 * readings that happen to look alike on the seams a unit test chose to
 * drive.
 *
 * One scratch repository is planted, its `.rafa/config.yaml` naming one
 * configured REQUIRED item and one OPTIONAL item, and its
 * `PREREQUISITES-parity.md` naming one `[start]` item, with no tracker
 * beside the plan, so both commands read this as the plan's FIRST
 * DISPATCH (`preflight/first-dispatch.ts`). Both the configured required
 * item and the `[start]` item fail their probe, so both commands halt,
 * and a halt is the one place either names a required item at all:
 * `doctor` always prints a check line per item, but `loop start` prints
 * one only for a failed required item. The two halt messages are built
 * from the same `haltOf` (`preflight/run.ts`), so the two-space-indented
 * item lines inside each are compared directly, in order.
 *
 * The optional item, `spare`, is planted to pass, and is the control: a
 * full `doctor` report names every check, passing ones included, so
 * `spare` reaches its stdout; `loop start` prints no line at all for a
 * passing check, so `spare` reaches neither of its streams. Its presence
 * in one report and its absence from the other is what proves the two
 * reports are not simply the same text twice, so the required items
 * matching between them is a real reading and not an accident of two
 * documents that always agree.
 *
 * Neither command ever calls `claude`: a halted preflight stops `loop
 * start` before any session is dispatched, and `doctor` starts no run at
 * all. The scratch `PATH` carries no `claude` at all, so a case that
 * somehow reached a session would fail to resolve one rather than
 * silently calling the real thing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantProjectConfig } from './cli-capture.js';

/** The CLI entry each spawned case runs. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long a spawned run may take before it is killed, and a case that drives one. */
const KILL_AFTER_MS = 30_000;
const RUN_TIMEOUT = { timeout: 60_000 };

/** git's own directory, resolved once and appended to the scratch PATH. */
const GIT_DIR = (() => {
  const found = Bun.which('git');
  if (found === null) throw new Error('git is not on the PATH this suite runs under');
  return dirname(found);
})();

/** Runs git for the fixture's own setup, inheriting this process's environment. */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** The base directory every world of this file plants under. */
const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-parity-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** The configured required item's probe, failing as a missing tool does. */
const MISSING_TOOL_PROBE = 'echo "sh: needed: not found" >&2; exit 127';

/** The plan's `[start]` item's probe, failing as an unclean sibling checkout does. */
const START_PROBE = 'echo "sibling checkout unclean" >&2; exit 1';

/** The `.rafa/config.yaml` lines: one required item that fails, one optional item that passes. */
const CONFIG_LINES = [
  'version: 1',
  'prerequisites:',
  '  required:',
  '    - tool: needed',
  `      probe: '${MISSING_TOOL_PROBE}'`,
  '  optional:',
  '    - tool: spare',
  '      probe: \'exit 0\'',
  '',
];

/** The plan every world holds, one task, and the flag naming it. */
const PLAN_TEXT = '# Plan: parity\n\n- [ ] A task nothing should run for it\n';
const PLAN_FLAG = '--plan=.plans/PLAN-parity.md';

/** The PREREQUISITES file beside it, naming one failing `[start]` item. */
const PREREQUISITES_TEXT = `# Prerequisites\n\n- [ ] [start] Sibling clean: \`${START_PROBE}\`\n`;

/** One scratch repository both commands run in, planted fresh per case. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly path: string;
}

let planted = 0;

/**
 * Plants a git repository on its own feature branch, holding the plan,
 * its PREREQUISITES file and the config above, with no tracker beside
 * the plan, so both commands read a first dispatch; see the module note.
 */
function plantScratch(): Scratch {
  planted += 1;
  const root = join(scratchBase, `world-${planted}`);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  for (const dir of [repo, home, bin]) mkdirSync(dir, { recursive: true });

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'parity@example.test');
  git(repo, 'config', 'user.name', 'Rafa Parity');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', 'feat/doctor-parity');

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', 'PLAN-parity.md'), PLAN_TEXT, 'utf8');
  writeFileSync(join(repo, '.plans', 'PREREQUISITES-parity.md'), PREREQUISITES_TEXT, 'utf8');
  plantProjectConfig(repo, CONFIG_LINES.join('\n'));

  return { repo, home, path: [bin, GIT_DIR].join(delimiter) };
}

/** What one spawned run wrote, and how it ended. */
interface SpawnRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns `rafa <words>` in `scratch`, over its own PATH and HOME alone; see the module note. */
function runRafaIn(scratch: Scratch, words: readonly string[]): SpawnRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== null) throw new Error(`claude resolves to ${resolved}, and this suite plants no stand-in`);
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/**
 * The `  <kind> "<name>": <failure>` lines a halt names, in order: the
 * only lines of either command's stderr indented exactly two spaces, the
 * wrapper around each halt using none or three.
 */
function haltItemLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('  ') && !line.startsWith('   '));
}

/** The `[start]` item's line as `haltOf` words it, its name the whole raw description. */
const START_ITEM = JSON.stringify(`Sibling clean: \`${START_PROBE}\``);
const START_ITEM_LINE = `  tool ${START_ITEM}: probe \`${START_PROBE}\` exited 1: sibling checkout unclean`;

/** The configured required item's line, in the same shape. */
const REQUIRED_ITEM_LINE = `  tool "needed": probe \`${MISSING_TOOL_PROBE}\` exited 127: sh: needed: not found`;

describe('doctor and loop start over one planted project', () => {
  it(
    'name the same required items in the same order on a first dispatch, a planted optional item'
      + ' separating the two reports otherwise',
    () => {
      const scratch = plantScratch();

      const doctorRun = runRafaIn(scratch, ['doctor', PLAN_FLAG]);
      const loopRun = runRafaIn(scratch, ['loop', 'start', PLAN_FLAG, '--no-ci-wait']);

      expect(doctorRun.exitCode).toBe(1);
      expect(loopRun.exitCode).toBe(1);

      // Both halt naming the plan's [start] item ahead of the configured
      // required one, in that order, since both build the required tier
      // the same way: automatic items, then the start tier, then the
      // configured tier (`commands/doctor.ts`, `start/preflight.ts`).
      expect(haltItemLines(doctorRun.stderr)).toEqual([START_ITEM_LINE, REQUIRED_ITEM_LINE]);
      expect(haltItemLines(loopRun.stderr)).toEqual([START_ITEM_LINE, REQUIRED_ITEM_LINE]);

      // The control: `spare` passes, so `doctor`'s full report still
      // names it as a check line, while `loop start` prints no line at
      // all for a passing check. Its presence in one report and its
      // absence from the other proves the two reports are not the same
      // text, so the match above is a real reading of the two commands
      // and not an accident of documents that always agree.
      expect(doctorRun.stdout).toContain('optional tool "spare"');
      expect(loopRun.stdout).not.toContain('spare');
      expect(loopRun.stderr).not.toContain('spare');
    },
    RUN_TIMEOUT,
  );
});
