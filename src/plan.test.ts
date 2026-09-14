/**
 * Tests for `rafa plan` (`src/plan.ts`) generating its plan through the
 * Planner it resolves from the adapter registry.
 *
 * Each case runs the command in a child process, because the command
 * reads the git root of its working directory and the user scope's config
 * under the home. The child runs in a scratch git repository under this
 * file's temporary directory, with HOME a directory beside it. It imports
 * `src/plan.ts` and hands the command a registry holding a fixture
 * `planner/claude` in place of core's, and dispatches `plan create` as
 * `src/rafa.ts` does: the declaration of `src/commands/plan/create.ts`
 * wrapped around that call, run through `dispatch`, and the exit code it
 * answers set on the child. So a refusal and a rejection reach stderr in
 * text mode, and the terminal result in json mode, as they do behind the
 * terminal. The fixture spawns nothing: it writes what its context and
 * its request held, and the prompt its context's builder makes, to a
 * record file outside the repository, then answers or rejects as the case
 * names.
 *
 * First on the child's PATH is a stand-in `claude` that leaves a marker
 * and exits 97, and every case holds the marker absent. A command that
 * went around the registry to spawn a session would reach the stand-in,
 * not the real `claude`. Core's planner through core's registry runs in
 * `src/tests/package-build.test.ts`, from the build, under a stand-in
 * that keeps its prompt.
 *
 * Each rejection sits beside the case where the same fixture answers.
 *
 * Nine mutations of `plan.ts` were driven on 2026-09-14 over this file,
 * `src/adapters/planner/claude.test.ts` and
 * `src/adapters/registry.test.ts`, one run each, with 79 pass before and
 * after and the module restored byte-identical (sha256), and every one
 * reddened at least one case. The command resolving core's registry in
 * place of the one handed over reddened the five cases that reach the
 * planner. The run's sources replaced, the resolved spec path handed over
 * in place of `--spec`, and `.plans/` made by the command each reddened
 * the first case alone. The progress notes withheld, the prerequisites
 * line dropped, the plan-already-there refusal dropped and a rejection's
 * exit code ignored each reddened its own case alone. A rejection's
 * message dropped reddened both rejection cases.
 *
 * The json cases came when the command stopped calling `process.exit`.
 * Three mutations were driven on 2026-09-15 over this file and ten other
 * suites, one run each, with 387 pass before and after and every module
 * restored sha256-identical. A rejection's exit code ignored reddened the
 * text and the json rejection cases. The plan-ready line written at
 * `warn`, and the usage refusal thrown with no message, each reddened its
 * json case alone.
 */
import type { CliEvent } from './ports/index.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { buildPlanPrompt, readPlanFormat } from './plan.js';

/** This file's directory, `src/`, where the modules the probe imports sit. */
const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

/** The spec every scratch repository holds at `spec.md`. */
const SPEC = '# Spec: a command probe\n\nNothing to build.\n';

/** The spec content the fixture hands the context's builder. */
const FIXTURE_SPEC = 'the spec as the fixture hands it to the builder\n';

/** The `progress.txt` every scratch repository holds. */
const PROGRESS = 'a finding an earlier run left behind\n';

/** What the fixture planner does once asked for a plan. */
type Outcome = 'plan' | 'prerequisites' | 'session-failed' | 'other-rejection';

/**
 * The child: a registry holding the fixture planner, handed to the
 * command with the arguments after the record path and the outcome, and
 * the command dispatched as `src/rafa.ts` dispatches it; see the module
 * note.
 */
const PROBE = [
  'import { writeFileSync } from "node:fs";',
  `import { ClaudePlannerError } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'planner', 'claude.ts'))};`,
  `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
  `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
  `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
  `import declared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
  `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
  `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
  '',
  'const [record, outcome, ...args] = process.argv.slice(2);',
  'const registry = createAdapterRegistry([{',
  '  port: "planner",',
  '  kind: "claude",',
  '  portVersion: 1,',
  '  create: (context) => ({',
  '    create: async (request) => {',
  '      writeFileSync(record, JSON.stringify({',
  '        repoRoot: context.repoRoot,',
  '        settingSources: context.settingSources,',
  '        request,',
  `        prompt: context.planPrompt(${JSON.stringify(FIXTURE_SPEC)}, request.stub),`,
  '      }));',
  '      if (outcome === "session-failed") throw new ClaudePlannerError("Plan generation failed (exit 3).", 3);',
  '      if (outcome === "other-rejection") throw new Error("the planner is unreachable");',
  '      return {',
  '        planPath: ".plans/PLAN-" + request.stub + ".md",',
  '        prerequisitesPath: outcome === "prerequisites" ? ".plans/PREREQUISITES-" + request.stub + ".md" : null,',
  '      };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words) => plan(words, registry));',
  'const commands = createCommandRegistry({ subjects: [{ name: "plan", summary: "plans" }], commands: [command] });',
  'const { exitCode } = await dispatch(["plan", "create", ...args], { registry: commands });',
  'process.exitCode = exitCode;',
  '',
].join('\n');

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-plan-command-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Everything one command run lives in. */
interface Scratch {
  /** The repository the command runs in. */
  readonly repo: string;
  /** Where the fixture writes what it was handed, outside the repository. */
  readonly record: string;
  /** Where the stand-in `claude` leaves its marker, outside the repository. */
  readonly spawned: string;
  readonly probe: string;
  readonly env: Record<string, string>;
}

/** A scratch repository holding the spec and `progress.txt`, beside the probe and the stand-in. */
function plantScratch(): Scratch {
  planted += 1;
  const root = join(tempDir, `run-${planted}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const spawned = join(root, 'spawned');
  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', `: > '${spawned}'`, 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: repo });
  if (init.exitCode !== 0) throw new Error(`git init: ${init.stderr.toString()}`);
  writeFileSync(join(repo, 'spec.md'), SPEC, 'utf8');
  writeFileSync(join(repo, 'progress.txt'), PROGRESS, 'utf8');
  const probe = join(root, 'probe.ts');
  writeFileSync(probe, PROBE, 'utf8');

  const git = Bun.which('git');
  if (git === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(process.execPath), dirname(git)].join(delimiter);
  const resolved = Bun.which('claude', { PATH: path });
  if (resolved !== claude) throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);

  return { repo, record: join(root, 'record.json'), spawned, probe, env: { PATH: path, HOME: home } };
}

/** What one command run did. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the command in `scratch` with the fixture acting out `outcome`. */
function runPlan(scratch: Scratch, outcome: Outcome, args: readonly string[]): CommandRun {
  const proc = Bun.spawnSync(
    [process.execPath, scratch.probe, scratch.record, outcome, ...args],
    { cwd: scratch.repo, env: scratch.env },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** What the fixture recorded. */
function readRecord(scratch: Scratch): Record<string, unknown> {
  return JSON.parse(readFileSync(scratch.record, 'utf8')) as Record<string, unknown>;
}

/** The prompt `buildPlanPrompt` makes of the source template and skill for the fixture spec. */
function expectedPrompt(progress: string | undefined): string {
  const template = readFileSync(join(SRC_DIR, 'plan-prompt.md'), 'utf8');
  return buildPlanPrompt(template, readPlanFormat(SRC_DIR), FIXTURE_SPEC, 'spec', progress);
}

describe('rafa plan through the adapter registry', () => {
  it('resolves the claude planner with the run sources, the spec as --spec names it and the built prompt', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)).toEqual({
      repoRoot: realpathSync(scratch.repo),
      settingSources: ['project', 'local'],
      request: { specPath: 'spec.md', stub: 'spec' },
      prompt: expectedPrompt(undefined),
    });
    expect(run.stdout).toContain('📝 Generating .plans/PLAN-spec.md from spec.md...');
    expect(run.stdout).toContain('\n✅ Plan ready: .plans/PLAN-spec.md\n');
    expect(run.stdout).toContain('▶ Execute with: bun src/rafa.ts start --plan=.plans/PLAN-spec.md\n');
    expect(run.stdout).not.toContain('Prerequisites detected');
    expect(run.stdout).not.toContain('Including findings');
    expect(existsSync(join(scratch.repo, '.plans'))).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('hands the planner a prompt holding progress.txt when --no-progress is not given', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plan', ['--spec=spec.md']);

    expect(expectedPrompt(PROGRESS)).not.toBe(expectedPrompt(undefined));
    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)['prompt']).toBe(expectedPrompt(PROGRESS));
    expect(run.stdout).toContain('📎 Including findings from progress.txt (disable with --no-progress).');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('prints the prerequisites path the planner answers', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'prerequisites', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      '⚠️  Prerequisites detected: complete .plans/PREREQUISITES-spec.md before starting the loop.\n',
    );
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('prints a claude planner rejection and exits with the exit code it carries', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'session-failed', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain('\n❌ Plan generation failed (exit 3).\n');
    expect(run.stdout).not.toContain('Plan ready');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('exits 1 on a rejection of any other kind, printing its message', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'other-rejection', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('\n❌ the planner is unreachable\n');
    expect(run.stdout).not.toContain('Plan ready');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('refuses a plan already there before asking the planner for one', () => {
    const scratch = plantScratch();
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-spec.md'), 'an earlier plan\n', 'utf8');

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ .plans/PLAN-spec.md already exists — remove it or pass a different --stub.');
    expect(existsSync(scratch.record)).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);
});

/** The events a json run wrote, one per line, each parsed. */
function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as CliEvent);
}

/** An event as a case reads it: `<level>:<message>` for a log, its type for any other. */
function labelOf(event: CliEvent): string {
  return event.type === 'log'
    ? `${event.level}:${event.message}`
    : event.type;
}

/** The refusal a line with no `--spec` gets. */
const USAGE_REFUSAL = 'Usage: ralph plan --spec=<spec-file>.md [--stub=<name>] [--no-progress]\n'
  + 'Specs live in specs/ (trackable follow-ups) or .specs/ (untracked, sensitive).';

describe('rafa plan create in json mode', () => {
  it('writes each line as an info event between the start and the one result', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'prerequisites', ['--spec=spec.md', '--no-progress', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(eventsOf(run.stdout).map(labelOf)).toEqual([
      'start',
      'info:📝 Generating .plans/PLAN-spec.md from spec.md...',
      'info:\n✅ Plan ready: .plans/PLAN-spec.md',
      'info:⚠️  Prerequisites detected: complete .plans/PREREQUISITES-spec.md before starting the loop.',
      'info:▶ Execute with: bun src/rafa.ts start --plan=.plans/PLAN-spec.md',
      'result',
    ]);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('carries a claude planner rejection and its exit code in the terminal result, writing nothing to stderr', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'session-failed', ['--spec=spec.md', '--no-progress', '--output=json']);

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toBe('');
    const events = eventsOf(run.stdout);
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: false,
      error: { code: 'command_exit', message: '\n❌ Plan generation failed (exit 3).' },
    });
  }, 30_000);

  it('refuses a line with no --spec on stderr in text mode, and in the terminal result in json mode', () => {
    const scratch = plantScratch();

    const text = runPlan(scratch, 'plan', []);
    const json = runPlan(scratch, 'plan', ['--output=json']);

    expect([text.exitCode, text.stdout, text.stderr]).toEqual([1, '', `${USAGE_REFUSAL}\n`]);
    expect([json.exitCode, json.stderr]).toEqual([1, '']);
    expect(eventsOf(json.stdout).map(labelOf)).toEqual(['start', 'result']);
    expect(eventsOf(json.stdout)[1]).toMatchObject({ ok: false, error: { code: 'command_exit', message: USAGE_REFUSAL } });
    expect(existsSync(scratch.record)).toBe(false);
  }, 30_000);
});
