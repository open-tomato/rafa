/**
 * Tests for `rafa plan` (`src/plan.ts`) generating its plan through the
 * Planner it resolves from the adapter registry.
 *
 * Each case runs the command in a child process, because the dispatcher
 * resolves the project from its working directory and the command reads
 * the user scope's config under the home. The child runs in a scratch git
 * repository holding `.rafa/config.yaml` under this file's temporary
 * directory, with HOME a directory beside it. It imports
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
 * The wrapping drops one thing on purpose: the ENDING. The module's
 * default export is `endingWith(...)` (`src/next/ending.ts`), and
 * `wrapPhaseZeroCommand` replaces `run`, so the command the child
 * dispatches ends where `plan` ends and reads no state. That is what
 * keeps every case here from composing the real sources — `git` and
 * `gh` spawned in the scratch repository, for a line no case is about —
 * and leaves the ending to be held where it is driven,
 * `src/next/ending.test.ts`.
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
 * ## How far the board routes are driven here
 *
 * Second on the child's PATH beside the stand-in `claude` is a stand-in
 * `gh` that answers `gh issue view 20` and exits 1, naming the words,
 * for anything else. One case runs `--issue=20` through it whole: the
 * snapshot written under `specs.dir`, the planner handed that file and
 * the stub read off its name, and `issue: "20"` recorded in the plan the
 * fixture wrote (the `plan-written` outcome, which exists so there is a
 * file to stamp). So no case reaches GitHub, and a route that asked `gh`
 * for anything else would fail naming it.
 *
 * The other two board cases need no board at all: a line naming two
 * sources is refused before any read, and `--dry-run` stops before the
 * planner. `--next` is not driven here — its walk is three more `gh` and
 * `git` reads, driven over planted runners in
 * `src/board/plan-spec.test.ts` and end to end in the integration suite.
 *
 * That every `--spec` case is green is a reading of its own: the board
 * seams are built for every run (`src/board/plan-spec.ts`) and a file
 * route calls none of them, so a resolution that spawned `gh` eagerly
 * would redden this whole file.
 *
 * ## The readiness gate's cases
 *
 * Five outcomes drive the verdict `src/plan.ts` acts on. `not-ready`
 * writes BOTH files and answers a review that judged the spec not
 * ready, which is the one thing the gate cannot take the session's word
 * for: the case holds both files gone and the command exited 3, and the
 * `--skip-review` case holds the same outcome keeping them and the plan
 * recording `review: skipped`. `not-ready-rejection` is the ordinary
 * shape of that verdict, a session that wrote no plan, and is held to
 * exit 3 with the gaps rather than to the adapter's own message.
 * `absent-review` is the control that keeps the gate off a session that
 * FAILED: its review is `absent`, which is not ready either, and the
 * command must still end with the session's own exit code and message.
 * `missing-review` is the same absent reading on a session that
 * ANSWERED: the plan reads as written, so the command must exit 0, keep
 * it, warn exactly ONCE and record `review: missing`. That case counts
 * the warn lines rather than looking for one, because the reading it
 * holds is "the operator is told once", which a second warning would
 * break while every substring assertion still passed.
 *
 * The gaps are read out of a real `rafa:spec-review` block through
 * `parseSpecReview`, so no case asserts against a reading the parser
 * does not produce.
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
 *
 * ## The mutation record below predates one split
 *
 * Every mutation named here was driven while `src/plan.ts` still carried
 * the board routes, the gate wiring and the records. Three of those
 * pieces have since moved, each with its own suite:
 * `rejectedReview`, `generateOrExit` and the `recordMissingReview` call
 * to `src/commands/plan/review-gate.ts`, the three records to
 * `src/commands/plan/plan-record.ts`, and the route resolution with the
 * `--spec` candidate rule to `src/commands/plan/spec-route.ts`. The
 * `recordPlanIssue` call is still this module's. A rerun of one of those
 * mutations therefore edits the module that now holds it, and the cases
 * it reddens here are the ones named below.
 *
 * One mutation of `plan.ts` was driven on 2026-09-19 over this file, the
 * module restored from a scratch copy and verified with `shasum -c`: the
 * `recordPlanIssue` call dropped left 20 pass and 1 fail against 21 pass
 * either side — the `--issue` case, the only one that reads a plan a
 * board route wrote. The board flags declared and unread would redden
 * `src/commands/index.test.ts` instead, which is where that pairing is
 * held.
 *
 * One mutation of `plan.ts` was driven on 2026-09-20 over
 * `env -u CLAUDECODE bun test src/board/gate.test.ts src/plan.test.ts`,
 * the module restored from a scratch copy and verified with
 * `shasum -c`: the `recordMissingReview` call dropped left 41 pass and
 * 1 fail against 42 pass either side — the `missing-review` case, the
 * only one that reads a plan an unread review left standing.
 *
 * One mutation of `plan.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c`:
 * `rejectedReview` answering every review a rejection carries, rather
 * than the ones judged not ready, left 196 pass and 1 fail against 197
 * pass either side — the `absent-review` case, which then exited 3 with
 * the gate's refusal in place of the session's own failure. Four other
 * mutations driven the same day over `gate.ts` are recorded in
 * `src/board/gate.test.ts`; two of them redden cases in this file.
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

import { specPath } from './board/naming.js';
import { NOTICE_IDS, writeDismissed } from './notices/notices.js';
import { buildPlanPrompt, readPlanFormat, runBranchLine } from './plan.js';
import { plantProjectConfig } from './tests/cli-capture.js';
import { completeSpecBody } from './tests/spec-bodies.js';

/** This file's directory, `src/`, where the modules the probe imports sit. */
const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

/** The spec every scratch repository holds at `spec.md`. */
const SPEC = '# Spec: a command probe\n\nNothing to build.\n';

/**
 * The issue the stand-in `gh` answers `issue view` with; the first of
 * the two board reads a case here makes, the other being the permission
 * lookup on its {@link ISSUE.author}. Its body fills every template
 * heading (`./tests/spec-bodies.ts`) and its author holds write access
 * on the stand-in, because the board route refuses an issue with an
 * untrusted author or a readiness gap before it snapshots one, and what
 * this case is about is the snapshot.
 */
const ISSUE = {
  number: 20,
  title: 'The board routes',
  body: completeSpecBody('Spec: the board routes', 'Nothing to build.'),
  author: 'octocat',
};

/** The spec content the fixture hands the context's builder. */
const FIXTURE_SPEC = 'the spec as the fixture hands it to the builder\n';

/** The `progress.txt` every scratch repository holds. */
const PROGRESS = 'a finding an earlier run left behind\n';

/** The session output the fixture reads its not-ready review out of. */
const NOT_READY_OUTPUT = [
  'I read the spec first.',
  '',
  '```rafa:spec-review',
  'verdict: not-ready',
  'gaps:',
  '  - heading: "Definition of done"',
  '    what: "no item says how the merge clean-up is verified"',
  '```',
  '',
].join('\n');

/** The plan the fixture writes when it writes one anyway; it carries a header to stamp. */
const WRITTEN_PLAN = [
  '# Plan: spec',
  '',
  '```rafa:plan',
  'stub: spec',
  '```',
  '',
  '- [ ] Do the thing',
  '',
].join('\n');

/** What the fixture planner does once asked for a plan. */
type Outcome =
  | 'plan'
  | 'prerequisites'
  | 'session-failed'
  | 'other-rejection'
  /** Writes both files and answers a review that judged the spec not ready. */
  | 'not-ready'
  /** Writes nothing and rejects as the adapter does, carrying that review. */
  | 'not-ready-rejection'
  /** Rejects with a failed session whose output held no review block. */
  | 'absent-review'
  /** Writes the plan, holding a header to stamp, and answers it with no review. */
  | 'plan-written';

/**
 * The child: a registry holding the fixture planner, handed to the
 * command with the arguments after the record path and the outcome, and
 * the command dispatched as `src/rafa.ts` dispatches it; see the module
 * note.
 */
const PROBE = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { parseSpecReview } from ${JSON.stringify(join(SRC_DIR, 'board', 'spec-review.ts'))};`,
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
  '        planDir: context.planDir,',
  '        settingSources: context.settingSources,',
  '        request,',
  `        prompt: context.planPrompt(${JSON.stringify(FIXTURE_SPEC)}, request.stub),`,
  '      }));',
  '      if (outcome === "session-failed") throw new ClaudePlannerError("Plan generation failed (exit 3).", 3);',
  '      if (outcome === "other-rejection") throw new Error("the planner is unreachable");',
  '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
  '      const prerequisitesPath = context.planDir + "/PREREQUISITES-" + request.stub + ".md";',
  `      const review = parseSpecReview(${JSON.stringify(NOT_READY_OUTPUT)});`,
  '      if (outcome === "absent-review") {',
  '        throw new ClaudePlannerError("Plan generation failed (exit 7).", 7, parseSpecReview("no block here"));',
  '      }',
  '      if (outcome === "not-ready-rejection") {',
  '        throw new ClaudePlannerError("The session finished but " + planPath + " was not created.", 1, review);',
  '      }',
  '      if (outcome === "missing-review") {',
  '        mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  `        writeFileSync(join(context.repoRoot, planPath), ${JSON.stringify(WRITTEN_PLAN)});`,
  '        return { planPath, prerequisitesPath: null, review: parseSpecReview("I wrote the plan and stopped.") };',
  '      }',
  '      if (outcome === "plan-written") {',
  '        mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  `        writeFileSync(join(context.repoRoot, planPath), ${JSON.stringify(WRITTEN_PLAN)});`,
  '        return { planPath, prerequisitesPath: null };',
  '      }',
  '      if (outcome === "not-ready") {',
  '        mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  `        writeFileSync(join(context.repoRoot, planPath), ${JSON.stringify(WRITTEN_PLAN)});`,
  '        writeFileSync(join(context.repoRoot, prerequisitesPath), "a prerequisite\\n");',
  '        return { planPath, prerequisitesPath, review };',
  '      }',
  '      return {',
  '        planPath,',
  '        prerequisitesPath: outcome === "prerequisites" ? prerequisitesPath : null,',
  '      };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words, root) => plan(words, root, registry));',
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
  // The standing notices have their own suite (`notices/notices.test.ts`);
  // these runs read a HOME that dismissed them, so each case reads the
  // command's own lines.
  writeDismissed(home, NOTICE_IDS);

  const spawned = join(root, 'spawned');
  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', `: > '${spawned}'`, 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  // The two board reads `--issue` makes, answered by a stand-in: the
  // issue, and check 0's permission lookup on the author who opened it
  // (`src/board/plan-spec.ts`). No case here reaches GitHub, and a
  // third read would exit 1 naming its words.
  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "20" ]; then',
    `  printf '%s' '${JSON.stringify({
      number: ISSUE.number,
      title: ISSUE.title,
      body: ISSUE.body,
      state: 'OPEN',
      labels: [{ name: 'type:spec' }, { name: 'spec:ready' }],
      author: { login: ISSUE.author },
    })}'`,
    '  exit 0',
    'fi',
    `if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/${ISSUE.author}/permission" ]; then`,
    `  printf '%s' '${JSON.stringify({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);

  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: repo });
  if (init.exitCode !== 0) throw new Error(`git init: ${init.stderr.toString()}`);
  writeFileSync(join(repo, 'spec.md'), SPEC, 'utf8');
  writeFileSync(join(repo, 'progress.txt'), PROGRESS, 'utf8');
  plantProjectConfig(repo);
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

/** The plans directory the config resolves when no file names one. */
const DEFAULT_PLAN_DIR = '.rafa/plans';

/** The prompt `buildPlanPrompt` makes of the source template and skill for the fixture spec. */
function expectedPrompt(progress: string | undefined, planDir: string = DEFAULT_PLAN_DIR): string {
  const template = readFileSync(join(SRC_DIR, 'plan-prompt.md'), 'utf8');
  return buildPlanPrompt(template, readPlanFormat(SRC_DIR), FIXTURE_SPEC, 'spec', planDir, progress);
}

/** The branch line the fixture's plan path earns, as both output cases read it. */
const BRANCH_LINE = '   Runs on feat/spec — started from the base branch, the run offers to create it.';

describe('the branch line printed under the Execute with hint', () => {
  it('names feat/ and the stub the plan path carries', () => {
    expect(runBranchLine('.rafa/plans/PLAN-rafa-49.md')).toBe(
      '   Runs on feat/rafa-49 — started from the base branch, the run offers to create it.',
    );
  });

  it('reads the stub off the file name, not the directory holding it', () => {
    expect(runBranchLine('/tmp/some-repo/.plans/PLAN-my-feature.md'))
      .toBe(runBranchLine('PLAN-my-feature.md'));
  });

  it('answers null for a plan whose name carries no stub, which loop start would name no branch for', () => {
    expect(runBranchLine('.rafa/plans/PLAN.md')).toBe(null);
  });
});

describe('rafa plan through the adapter registry', () => {
  it('resolves the claude planner with the run sources, plan.dir, the spec as --spec names it and the built prompt', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)).toEqual({
      repoRoot: realpathSync(scratch.repo),
      planDir: DEFAULT_PLAN_DIR,
      settingSources: ['project', 'local'],
      request: { specPath: 'spec.md', stub: 'spec' },
      prompt: expectedPrompt(undefined),
    });
    expect(run.stdout).toContain('📝 Generating .rafa/plans/PLAN-spec.md from spec.md...');
    expect(run.stdout).toContain('\n✅ Plan ready: .rafa/plans/PLAN-spec.md\n');
    expect(run.stdout).toContain(
      `▶ Execute with: rafa loop start --plan=.rafa/plans/PLAN-spec.md\n${BRANCH_LINE}\n`,
    );
    expect(run.stdout).not.toContain('Prerequisites detected');
    expect(run.stdout).not.toContain('Including findings');
    expect(existsSync(join(scratch.repo, '.rafa', 'plans'))).toBe(false);
    expect(existsSync(join(scratch.repo, '.plans'))).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('hands the planner the plan.dir a config names, and names the plan in it', () => {
    // Deliberate custom-directory fixture: configures `plan.dir` to `.plans` to verify the planner reads the custom setting.
    const scratch = plantScratch();
    plantProjectConfig(scratch.repo, 'version: 1\nplan:\n  dir: .plans\n');

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(expectedPrompt(undefined, '.plans')).not.toBe(expectedPrompt(undefined));
    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)).toMatchObject({ planDir: '.plans', prompt: expectedPrompt(undefined, '.plans') });
    expect(run.stdout).toContain('📝 Generating .plans/PLAN-spec.md from spec.md...');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('reads a spec the project root does not hold from specs.dir, and hands the planner that path', () => {
    const scratch = plantScratch();
    mkdirSync(join(scratch.repo, '.rafa', 'specs'), { recursive: true });
    writeFileSync(join(scratch.repo, '.rafa', 'specs', 'feature.md'), SPEC, 'utf8');

    const run = runPlan(scratch, 'plan', ['--spec=feature.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)['request']).toEqual({ specPath: join('.rafa', 'specs', 'feature.md'), stub: 'feature' });
    expect(run.stdout).toContain('📝 Generating .rafa/plans/PLAN-feature.md from feature.md...');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('reads the spec at the project root ahead of one of the same name under specs.dir', () => {
    const scratch = plantScratch();
    mkdirSync(join(scratch.repo, '.rafa', 'specs'), { recursive: true });
    writeFileSync(join(scratch.repo, '.rafa', 'specs', 'spec.md'), SPEC, 'utf8');

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(readRecord(scratch)['request']).toEqual({ specPath: 'spec.md', stub: 'spec' });
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('refuses a spec found neither at the project root nor under specs.dir, naming both paths', () => {
    const scratch = plantScratch();
    const repo = realpathSync(scratch.repo);

    const run = runPlan(scratch, 'plan', ['--spec=missing.md', '--no-progress']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `❌ Spec file not found: ${join(repo, 'missing.md')}, or ${join(repo, '.rafa', 'specs', 'missing.md')}\n`,
    );
    expect(existsSync(scratch.record)).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('snapshots the issue --issue names, plans from that file, and records the issue in the plan', () => {
    const scratch = plantScratch();
    const stub = 'rafa-20-board-routes';
    const snapshot = specPath('.rafa/specs', ISSUE.number, ISSUE.title);

    const run = runPlan(scratch, 'plan-written', ['--issue=20', '--no-progress']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(snapshot).toBe(`.rafa/specs/${stub}.md`);
    expect(readFileSync(join(scratch.repo, snapshot), 'utf8')).toBe(ISSUE.body);
    expect(readRecord(scratch)).toMatchObject({ request: { specPath: snapshot, stub } });
    const planned = readFileSync(join(scratch.repo, '.rafa', 'plans', `PLAN-${stub}.md`), 'utf8');
    expect(planned.split('\n').slice(2, 5)).toEqual(['```rafa:plan', 'stub: spec', 'issue: "20"']);
    expect(run.stdout).toContain(`🔖 .rafa/plans/PLAN-${stub}.md records issue: "20", the issue it was planned from.`);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('refuses a line naming two spec sources, asking for neither a plan nor a board read', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--issue=20', '--no-progress']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--spec and --issue each name a spec, and a run plans from one');
    expect(existsSync(scratch.record)).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('prints what it would plan from under --dry-run and asks the planner for nothing', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--dry-run', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('🔎 --dry-run: would plan from spec.md. Nothing was written.');
    expect(run.stdout).not.toContain('Generating');
    expect(existsSync(scratch.record)).toBe(false);
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
      '⚠️  Prerequisites detected: complete .rafa/plans/PREREQUISITES-spec.md before starting the loop.\n',
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

  it('moves the plan and the prerequisites written against a not-ready review aside, and exits 3', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'not-ready', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(3);
    expect(existsSync(join(scratch.repo, '.rafa', 'plans', 'PLAN-spec.md'))).toBe(false);
    expect(existsSync(join(scratch.repo, '.rafa', 'plans', 'PREREQUISITES-spec.md'))).toBe(false);
    expect(run.stdout).toContain('🗃  Moved .rafa/plans/PLAN-spec.md to .rafa/plans/rejected/PLAN-spec.md');
    expect(run.stdout).toContain(
      '🗃  Moved .rafa/plans/PREREQUISITES-spec.md to .rafa/plans/rejected/PREREQUISITES-spec.md',
    );
    expect(existsSync(join(scratch.repo, '.rafa', 'plans', 'rejected', 'PLAN-spec.md'))).toBe(true);
    expect(run.stdout).not.toContain('Plan ready');
    expect(run.stderr).toContain('❌ spec.md is not ready to plan from');
    expect(run.stderr).toContain('"Definition of done": no item says how the merge clean-up is verified');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('exits 3 on the rejection a session that judged the spec not ready leaves behind', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'not-ready-rejection', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain('❌ spec.md is not ready to plan from');
    expect(run.stderr).not.toContain('was not created');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('keeps the failure of a session whose output held no review block, rather than gating on it', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'absent-review', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(7);
    expect(run.stderr).toContain('\n❌ Plan generation failed (exit 7).\n');
    expect(run.stderr).not.toContain('not ready to plan from');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('keeps a plan whose session returned no review block, recording review: missing and warning once', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'missing-review', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    const plan = join(scratch.repo, '.rafa', 'plans', 'PLAN-spec.md');
    expect(readFileSync(plan, 'utf8')).toContain('stub: spec\nreview: missing\n```');
    expect(run.stdout).toContain(
      'warn: the session output holds no rafa:spec-review block;'
        + ' .rafa/plans/PLAN-spec.md reads as written, so the plan stands unreviewed',
    );
    expect(run.stdout.match(/^warn: /gmu)).toHaveLength(1);
    expect(run.stdout).toContain(
      '🔍 .rafa/plans/PLAN-spec.md records review: missing:'
        + ' the session returned no readable rafa:spec-review block.',
    );
    expect(run.stdout).toContain('✅ Plan ready: .rafa/plans/PLAN-spec.md');
    expect(run.stdout).not.toContain('not ready to plan from');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('keeps the plan under --skip-review and records review: skipped in its rafa:plan block', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'not-ready', ['--spec=spec.md', '--no-progress', '--skip-review']);

    expect(run.exitCode).toBe(0);
    const plan = join(scratch.repo, '.rafa', 'plans', 'PLAN-spec.md');
    expect(existsSync(plan)).toBe(true);
    expect(readFileSync(plan, 'utf8')).toContain('stub: spec\nreview: skipped\n```');
    expect(run.stdout).toContain('⏭  --skip-review: the spec was not reviewed, and .rafa/plans/PLAN-spec.md records review: skipped.');
    expect(run.stdout).toContain('✅ Plan ready: .rafa/plans/PLAN-spec.md');
    expect(run.stdout).not.toContain('not ready to plan from');
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('refuses a plan already there in plan.dir before asking the planner for one', () => {
    const scratch = plantScratch();
    mkdirSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true });
    writeFileSync(join(scratch.repo, '.rafa', 'plans', 'PLAN-spec.md'), 'an earlier plan\n', 'utf8');

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ .rafa/plans/PLAN-spec.md already exists — remove it or pass a different --stub.');
    expect(existsSync(scratch.record)).toBe(false);
    expect(existsSync(scratch.spawned)).toBe(false);
  }, 30_000);

  it('asks the planner for a plan when a plan of the stub sits in .plans and plan.dir is left at its default', () => {
    // Deliberate custom-directory fixture: plants `.plans/` to verify it is ignored when `plan.dir` is at its default `.rafa/plans`.
    const scratch = plantScratch();
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-spec.md'), 'a phase 0 plan\n', 'utf8');

    const run = runPlan(scratch, 'plan', ['--spec=spec.md', '--no-progress']);

    expect(run.exitCode).toBe(0);
    expect(existsSync(scratch.record)).toBe(true);
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

/** The refusal a line naming none of the three spec sources gets. */
const USAGE_REFUSAL = 'Usage: rafa plan create (--spec=<file>.md | --issue=<n> | --next[=<roadmap-issue>])\n'
  + '  [--stub=<name>] [--no-progress] [--refresh] [--dry-run] [--skip-review] [--no-comment]\n'
  + 'no spec was named: pass --spec=<file>.md, read against the project root or under specs.dir'
  + ' (.rafa/specs), --issue=<n> to plan from an issue, or --next to take the first undone line of the roadmap';

describe('rafa plan create in json mode', () => {
  it('writes each line as an info event between the start and the one result', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'prerequisites', ['--spec=spec.md', '--no-progress', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(eventsOf(run.stdout).map(labelOf)).toEqual([
      'start',
      'info:📝 Generating .rafa/plans/PLAN-spec.md from spec.md...',
      'info:\n✅ Plan ready: .rafa/plans/PLAN-spec.md',
      'info:⚠️  Prerequisites detected: complete .rafa/plans/PREREQUISITES-spec.md before starting the loop.',
      'info:▶ Execute with: rafa loop start --plan=.rafa/plans/PLAN-spec.md',
      `info:${BRANCH_LINE}`,
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

  it('refuses a line naming no spec source on stderr in text mode, and in the terminal result in json mode', () => {
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
