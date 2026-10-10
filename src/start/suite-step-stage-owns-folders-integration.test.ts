/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * `stageStepScope`'s `owns` answer (`../suite/scope.ts`'s module note)
 * through a real chain from the plan's `rafa:plan` header to a stand-in
 * `gh`, exactly as `runSuite` and the stand-in `claude` are real for
 * every other spawned fixture in this stage.
 *
 * The plan's header names issue #9 (`rafa:plan`'s `issue` field). The
 * stand-in `gh` answers `gh issue view 9 --json
 * number,title,body,state,labels,author` with a spec issue carrying
 * `epic:widgets`, and `gh issue list --state all --label type:epic
 * --label epic:widgets --limit 20 --json
 * number,title,body,state,stateReason,labels` with one epic, #50, whose
 * body's `Owns:` line names two folders, `alpha` and `beta`
 * (`readPlanOwns`, `../suite/owns.ts`). Neither is sent more than once:
 * `planOwnsReader` (`./suite-step.ts`) reads the chain once per run and
 * answers every later ask from what it already has. The stand-in also
 * answers `repo view`, plainly: the run sends it for the tracker's
 * preflight, which is not about `Owns:` at all. It answers `pr list`
 * too, which this run does not send: under `pr.provider: none` the
 * wrap-up looks up no pull request (`start/wrap-up.ts`).
 *
 * The plan's one stage has one task, so its commit is also its stage's
 * last: the stage step that follows is due (`dueStages`) and is not the
 * plan's last stage, so it runs as a genuine `stage` step and never
 * stands in for by the pre-wrap-up step the way a plan's LAST stage's
 * own does. A second, trailing stage with a second task both keeps one
 * task open so `dueStages` answers the first stage at all, and gives the
 * run somewhere to go once the first stage's step is taken.
 *
 * The task's own diff touches one file alone, `alpha/mod.ts`, a source
 * file under the `alpha` folder and not under `beta`. `stageStepScope`
 * answers the test files under the `Owns:` folders the diff touched —
 * `alpha`, never `beta`, which the diff never touches — plus every test
 * file a `tests.integration` glob matches by name alone, regardless of
 * which folder holds it: `shared/flow-integration.test.ts`, whose name
 * ends `-integration.test.ts`, one of `tests.integration`'s own defaults
 * (`../config-schema-tests.ts`), sitting under neither `Owns:` folder.
 *
 * The one assertion that matters reads the `stage` step back off the run
 * record's `steps` (`../loop/sessions.ts`): its `scope`, the raw path
 * list `stageStepScope` answered, is exactly `alpha/mod.test.ts` and
 * `shared/flow-integration.test.ts`, sorted, and its `command` (the argv
 * `bun test` was actually spawned with) names both and never
 * `beta/mod.test.ts`. Every step's `newFailures` stays empty throughout:
 * all three test files are, and stay, green.
 */
import type { CapturedRun } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { expectExit, plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';
import { hostToolDirs } from '../tests/stand-in-gh.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script templates below. */
const FENCE = '```';

/** How long the one spawned `loop start` run may take: several real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'suite-step-stage-owns-folders';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The spec issue the plan's `rafa:plan` header names. */
const SPEC_ISSUE = 9;

/** The epic the spec issue's `epic:` label names. */
const EPIC_ISSUE = 50;

/** The slug shared by the spec issue's `epic:` label and the epic's own. */
const EPIC_SLUG = 'widgets';

/** The first stage's only task: touches `alpha/mod.ts` alone. */
const TASK1 = 'Touch the alpha module alone, not beta';

/** The second stage's only task: keeps one task open once the first stage's step is due. */
const TASK2 = 'Write a harmless note, touching neither module';

/**
 * The plan: a `rafa:plan` header naming {@link SPEC_ISSUE}, then two
 * stages of one task each, so the first stage's step is due once its
 * only task commits, and the second stage keeps a task open for it to
 * run before.
 */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  `${FENCE}rafa:plan`,
  `issue: ${String(SPEC_ISSUE)}`,
  FENCE,
  '',
  '# Stage: touches alpha',
  '',
  `- [ ] ${TASK1}`,
  '',
  '# Stage: touches neither module',
  '',
  `- [ ] ${TASK2}`,
  '',
].join('\n');

/** The `Owns:` folder the task's diff touches. */
const ALPHA_SOURCE_FILE = 'alpha/mod.ts';

/** The test file under {@link ALPHA_SOURCE_FILE}'s own folder. */
const ALPHA_TEST_FILE = 'alpha/mod.test.ts';

/** The `Owns:` folder the diff never touches; its test file must never run. */
const BETA_TEST_FILE = 'beta/mod.test.ts';

/** A test file outside both `Owns:` folders, matched by `tests.integration`'s own default glob. */
const INTEGRATION_TEST_FILE = 'shared/flow-integration.test.ts';

/** {@link ALPHA_SOURCE_FILE}'s seed source. */
const ALPHA_SOURCE = [
  'export function alpha(): string {',
  '  return \'alpha\';',
  '}',
  '',
].join('\n');

/** {@link ALPHA_TEST_FILE}'s source: imports {@link ALPHA_SOURCE_FILE}. */
const ALPHA_TEST_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { alpha } from \'./mod\';',
  '',
  'test(\'alpha works\', () => {',
  '  expect(alpha()).toBe(\'alpha\');',
  '});',
  '',
].join('\n');

/** `beta/mod.ts`'s seed source, never touched by this file's task. */
const BETA_SOURCE = [
  'export function beta(): string {',
  '  return \'beta\';',
  '}',
  '',
].join('\n');

/** {@link BETA_TEST_FILE}'s source: imports `beta/mod.ts`. */
const BETA_TEST_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  'import { beta } from \'./mod\';',
  '',
  'test(\'beta works\', () => {',
  '  expect(beta()).toBe(\'beta\');',
  '});',
  '',
].join('\n');

/** {@link INTEGRATION_TEST_FILE}'s source: self-contained, outside both `Owns:` folders. */
const INTEGRATION_TEST_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'flow stands alone\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

/** The flags every `loop start` in this file runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `pr.provider: none`, so the wrap-up's push costs no extra `gh` call. */
const CONFIG = 'pr:\n  provider: none\n';

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly claude: string;
  readonly gh: string;
  /** Where the stand-in `claude` keeps each call's count, arguments and prompt. */
  readonly calls: string;
  /** Where the stand-in `gh` logs each call it answered. */
  readonly ghLog: string;
  /** The PATH a spawned run gets: the stand-ins' `bin/`, git's own directory and the system tools' (`hostToolDirs`), then bun's own. */
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-stage-owns-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** `line` as a single-quoted POSIX shell word, any embedded `'` escaped. */
function shQuote(line: string): string {
  return `'${line.replace(/'/g, '\'\\\'\'')}'`;
}

/** `printf '%s\n' <line>` for each of `lines`, one per shell statement. */
function printLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `printf '%s\\n' ${shQuote(line)}`);
}

/** The `rafa:report` block a call answers with, `status` and `feedback` its own. */
function reportLines(status: 'done' | 'blocked', feedback: string): readonly string[] {
  return [
    `${feedback}.`,
    '',
    `${FENCE}rafa:report`,
    `status: ${status}`,
    `feedback: "${feedback}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
    '',
  ];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number.
 *
 *   1. Appends a harmless comment to {@link ALPHA_SOURCE_FILE} alone,
 *      changing no behaviour {@link ALPHA_TEST_FILE} asserts on.
 *   2. Writes a new `NOTES.md`, touching neither module.
 *   3. The wrap-up's own session, once the tracker holds no task left:
 *      writes nothing, since `preserveProgress` never reads its output
 *      with no lesson to promote, which this scratch repository never
 *      holds.
 */
function standInClaudeScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    'if [ "$n" -eq 1 ]; then',
    `  printf '%s\\n' '// touched by task 1, behaviour unchanged' >> ${ALPHA_SOURCE_FILE}`,
    ...printLines(reportLines('done', 'touched the alpha module alone')),
    'elif [ "$n" -eq 2 ]; then',
    '  printf \'%s\\n\' \'Notes for task 2.\' > NOTES.md',
    ...printLines(reportLines('done', 'wrote a harmless note, touching neither module')),
    'else',
    ...printLines(reportLines('done', 'wrap-up: nothing left to preserve')),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * The spec issue as `gh issue view --json` writes it: carries
 * {@link EPIC_SLUG}'s `epic:` label, the one `readPlanOwns` follows to
 * the epic.
 */
const SPEC_VIEW_JSON = JSON.stringify({
  number: SPEC_ISSUE,
  title: 'the spec',
  body: 'spec body',
  state: 'OPEN',
  labels: [{ name: 'type:spec' }, { name: `epic:${EPIC_SLUG}` }],
  author: { login: 'someone' },
});

/**
 * The one epic row `gh issue list --json` writes: its body's `Owns:`
 * line names two folders, `alpha` and `beta`.
 */
const EPIC_LIST_JSON = JSON.stringify([{
  number: EPIC_ISSUE,
  title: 'Widgets epic',
  body: 'Owns: alpha, beta\n\n## Acceptance criteria\n\n- green',
  state: 'OPEN',
  stateReason: '',
  labels: [{ name: 'type:epic' }, { name: `epic:${EPIC_SLUG}` }],
}]);

/**
 * The stand-in `gh`: answers the two commands `readPlanOwns` sends —
 * `issue view` for the spec issue, `issue list` for its epic — from
 * which this file's own assertion reads back whether each ran exactly
 * once. The run also sends `repo view` (the tracker's own preflight),
 * not about `Owns:` folders at all, and answered plainly; `pr list` is
 * answered the same way, though under `pr.provider: none` the wrap-up
 * sends none. Every call, of any kind, is logged. Any call outside these four exits
 * 1 naming it, so an unplanned `gh` reach in this run fails loudly
 * rather than silently.
 */
function standInGhScript(ghLog: string): string {
  return [
    '#!/bin/sh',
    `log='${ghLog}'`,
    'printf \'%s\\n\' "$1 $2" >> "$log"',
    'case "$1 $2" in',
    '  "issue view")',
    `    printf '%s' ${shQuote(SPEC_VIEW_JSON)}`,
    '    ;;',
    '  "issue list")',
    `    printf '%s' ${shQuote(EPIC_LIST_JSON)}`,
    '    ;;',
    '  "repo view")',
    '    printf \'{"nameWithOwner": "example/repo", "visibility": "PUBLIC"}\'',
    '    ;;',
    '  "pr list")',
    '    printf \'[]\'',
    '    ;;',
    '  *)',
    '    echo "unplanned gh call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml` (`pr.provider: none`),
 * {@link PLAN} at `.plans/PLAN-<stub>.md`, and, in its seed commit,
 * {@link ALPHA_SOURCE_FILE}, {@link ALPHA_TEST_FILE}, `beta/mod.ts`,
 * {@link BETA_TEST_FILE} and {@link INTEGRATION_TEST_FILE}. The stand-ins
 * `claude` and `gh` are written to `bin/`. `.plans/`, `.rafa/` and
 * `progress.txt` are gitignored, as a real project's are.
 */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  const claude = join(bin, 'claude');
  writeFileSync(claude, standInClaudeScript(calls), 'utf8');
  chmodSync(claude, 0o755);

  const ghLog = join(root, 'gh.log');
  const gh = join(bin, 'gh');
  writeFileSync(gh, standInGhScript(ghLog), 'utf8');
  chmodSync(gh, 0o755);

  const scratch: Scratch = {
    repo,
    home,
    claude,
    gh,
    calls,
    ghLog,
    path: [bin, ...hostToolDirs(), dirname(bunBinary)].join(delimiter),
  };

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'alpha'));
  mkdirSync(join(repo, 'beta'));
  mkdirSync(join(repo, 'shared'));
  writeFileSync(join(repo, ALPHA_SOURCE_FILE), ALPHA_SOURCE, 'utf8');
  writeFileSync(join(repo, ALPHA_TEST_FILE), ALPHA_TEST_SOURCE, 'utf8');
  writeFileSync(join(repo, 'beta/mod.ts'), BETA_SOURCE, 'utf8');
  writeFileSync(join(repo, BETA_TEST_FILE), BETA_TEST_SOURCE, 'utf8');
  writeFileSync(join(repo, INTEGRATION_TEST_FILE), INTEGRATION_TEST_SOURCE, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo, CONFIG);

  return scratch;
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): CapturedRun {
  const resolvedClaude = Bun.which('claude', { PATH: scratch.path });
  if (resolvedClaude !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolvedClaude)}, not the stand-in`);
  }
  const resolvedGh = Bun.which('gh', { PATH: scratch.path });
  if (resolvedGh !== scratch.gh) {
    throw new Error(`gh resolves to ${String(resolvedGh)}, not the stand-in`);
  }
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: RUN_TIMEOUT_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The call count the stand-in `claude` has recorded so far, or `0` before any call. */
function callCount(scratch: Scratch): number {
  try {
    return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
  } catch {
    return 0;
  }
}

/** Every call the stand-in `gh` logged, blank lines dropped. */
function ghCalls(scratch: Scratch): readonly string[] {
  try {
    return readFileSync(scratch.ghLog, 'utf8').split('\n')
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

describe('a stage step over a plan whose epic Owns: two folders', () => {
  it('runs the changed folder\'s tests and the integration tier, and not the other folder\'s tests', () => {
    const scratch = plant();
    const run = runLoopStart(scratch);

    expectExit(run, 0, { ...scratch });
    // Two task sessions and the wrap-up's own: three real Claude calls,
    // none of them retried.
    expect(callCount(scratch)).toBe(3);

    const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
    const tracker = readFileSync(trackerPath, 'utf8');
    expect(tracker).toContain(`- [x] ${TASK1}`);
    expect(tracker).toContain(`- [x] ${TASK2}`);
    expect(tracker).not.toContain('[BLOCKED]');

    // readPlanOwns sent exactly one issue view and one issue list, never
    // asked again: planOwnsReader answers every later ask from what it
    // already read. The other gh call this run sent (repo view) is none
    // of `Owns:`'s own and left out of this count.
    const ownsCalls = ghCalls(scratch).filter((call) => call === 'issue view' || call === 'issue list');
    expect(ownsCalls).toEqual(['issue view', 'issue list']);

    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    const steps = record.steps ?? [];

    // Baseline, the first stage's one task step, that stage's own stage
    // step (due once its only task, also its last, commits), the second
    // stage's one task step, and the pre-wrap-up step standing in for
    // the second (and last) stage's own.
    expect(steps.map((step) => step.kind)).toEqual([
      'baseline',
      'task',
      'stage',
      'task',
      'pre-wrap-up',
    ]);

    for (const step of steps) expect(step.newFailures).toEqual([]);

    const stageStep = steps.find((step) => step.kind === 'stage');
    if (stageStep === undefined) throw new Error('no stage step was recorded at all');

    // The raw path list stageStepScope answered: alpha's own test file,
    // the folder the diff touched, and the integration tier's test file,
    // outside either Owns: folder — never beta's, the folder the diff
    // never touched.
    expect(stageStep.scope).toEqual([ALPHA_TEST_FILE, INTEGRATION_TEST_FILE]);
    expect(Array.isArray(stageStep.scope)).toBe(true);

    // The argv bun test was actually spawned with names both files
    // (Bun's own `./` prefix on a relative path) and never beta's.
    expect(stageStep.command.some((arg) => arg.endsWith(ALPHA_TEST_FILE))).toBe(true);
    expect(stageStep.command.some((arg) => arg.endsWith(INTEGRATION_TEST_FILE))).toBe(true);
    expect(stageStep.command.some((arg) => arg.endsWith(BETA_TEST_FILE))).toBe(false);
    expect(stageStep.summary).toContain('across 2 file');
  }, CASE_TIMEOUT_MS);
});
