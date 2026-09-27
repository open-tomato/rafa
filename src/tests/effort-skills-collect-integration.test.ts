/**
 * The skills report's own JOIN, from a real dispatch to a real session
 * log to the collector to `rafa effort report --skills`.
 *
 * `report-skills.test.ts` and `report.test.ts` prove the report's logic
 * and its reading of the store against rows planted directly through the
 * store's own writers (`writeDispatch`, `writeTaskReport`,
 * `writeSkillInvocations`). Neither ever runs `rafa start` or
 * `rafa effort collect`, so neither proves that a real dispatch's
 * `dispatches` row and a real session log's `Skill` tool calls, read by
 * the real collector, land on the SAME session id and answer the SAME
 * signal a hand-planted fixture would. This file is that join.
 *
 * A fixture plan of two tasks runs under a stand-in `claude`, as
 * `task-report.test.ts` runs one. The first task's stand-in ALSO writes a
 * session log of its own beside the report it prints: an `enqueue` record
 * and one `assistant` record whose `message.content` holds three `Skill`
 * tool calls, at the exact path `rafa effort collect` derives from the
 * run's own `HOME` and the repository's real root
 * ({@link sessionLogDir}). Three of the plan's four offered skills are
 * called there; the fourth is offered and never called. The second task's
 * report carries a finding naming one called skill's failure string, so
 * the recurrence search — which only ever looks at a session's own and
 * LATER tasks — finds it from the first task's invocation and not from
 * nothing.
 *
 * `rafa effort collect` is then run for real, over the real log the
 * stand-in wrote, and only then is `rafa effort report --skills` asked
 * for the plan. What it reports for the four skills is being held to
 * `skillSignals`' own four names in one pass: `earning` for the skill
 * invoked with a failure string that never recurred, `ignored` for the
 * one never called, `recurring` for the one whose failure string recurred
 * in the later task, and `unmeasured` for the one invoked with no
 * failure string declared at all.
 *
 * The lesson signal is not carried by anything a session log holds — a
 * lesson is injected by the dispatch's own lesson pull, never by a tool
 * call — so it is added the way `report-skills.test.ts` adds every fact
 * row: a third row planted straight through `writeDispatch` and
 * `writeTaskReport`, under the same plan, offering a held lesson whose
 * `artifact` a directly written `plan_ci` row then fails. That keeps
 * this file's real pipeline to the part the plan text asks a session log
 * for, and the lesson and plan-CI rows to the seams the codebase already
 * uses for them elsewhere.
 */
import type { SkillsReport, SkillsReportArm } from '../effort/report-skills.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { sessionLogDir } from '../effort/collect.js';
import { SKILL_USE_CLI_VERSION } from '../effort/skill-use.js';
import { writeDispatch } from '../effort/store/dispatches.js';
import { writePlanCi } from '../effort/store/plan-ci.js';
import { writeTaskReport } from '../effort/store/reports.js';
import { ACTION_HEADING, CAUSE_HEADING } from '../schema/instinct.js';

import { plantProjectConfig } from './cli-capture.js';

/** The command every run executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** The plan's stub, and its tasks' fence. */
const STUB = 'skills-collect-loop';
const FENCE = '```';

/** The four skills the first task offers. */
const SKILL_EARNING = 'fixture-skill-a';
const SKILL_IGNORED = 'fixture-skill-b';
const SKILL_RECURRING = 'fixture-skill-c';
const SKILL_UNMEASURED = 'fixture-skill-d';

/** The failure strings the earning and recurring skills declare. */
const FAILURE_EARNING = 'FIXTURE-SKILL-A-NEVER-RECURS';
const FAILURE_RECURRING = 'FIXTURE-SKILL-C-RECURS';

/** The lesson planted straight through the store, and its check. */
const LESSON_ID = 'fixture-lesson-lint';
const FAILING_CHECK = 'lint / eslint';

/** The task lines, each carrying the marker its stand-in answers by. */
const INVOKE_TASK = `Invoke the fixture skills MARK-INVOKE  {skills=${[
  SKILL_EARNING,
  SKILL_IGNORED,
  SKILL_RECURRING,
  SKILL_UNMEASURED,
].join(',')}}`;
const FINDING_TASK = 'Report the fixture recurrence MARK-FINDING';

/** The first task's report: done, offering nothing back beyond its work. */
const INVOKE_REPORT = [
  'Done: the fixture skills ran.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  'changes: []',
  FENCE,
  '',
].join('\n');

/** The second task's report: a finding naming the recurring skill's failure string. */
const FINDING_REPORT = [
  'Done: the recurrence shows up here.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'findings:',
  '  - trigger: "when the fixture task reruns"',
  '    kind: gotcha',
  `    what: "tsc refused it: ${FAILURE_RECURRING}"`,
  '    signal: loud',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  'changes: []',
  FENCE,
  '',
].join('\n');

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-skills-collect-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in a scratch repository, its own output kept off the test's. */
function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Writes an executable shell script. */
function writeScript(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
  chmodSync(path, 0o755);
}

/** A skill file under `.claude/skills/<name>/SKILL.md`, declaring `strings` when given any. */
function skillFile(name: string, strings: readonly string[] | null): string {
  const declared = strings === null
    ? []
    : ['failure_strings:', ...strings.map((string) => `  - ${JSON.stringify(string)}`)];
  return ['---', `name: ${name}`, 'description: a fixture skill', ...declared, '---', '', 'Body.', ''].join('\n');
}

/** A held lesson record of `id` under the project scope, its artifact `artifact`. */
function lessonFile(id: string, artifact: string): string {
  return [
    '---',
    `id: ${id}`,
    'trigger: when the fixture lint check fails',
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'usage_count: 3',
    `artifact: ${artifact}`,
    'signal: loud',
    'scope: project',
    'source: task-report',
    'evidence:',
    '  - plan: my-feature',
    '    outcome: blocked',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    'Run the fixture lint fix.',
    '',
    CAUSE_HEADING,
    'The fixture lint rule is unmet.',
    '',
  ].join('\n');
}

/**
 * The writer the stand-in `claude` hands its skill calls to: a small
 * script of its own, run through the very bun this suite runs under
 * (`process.execPath`), rather than a bare `bun` the scratch PATH below
 * does not resolve. It writes exactly the two records
 * `effort/session-log.ts` and `effort/skill-use.ts` read: an `enqueue`
 * naming the prompt's own first line, so `classify.ts` throws on
 * nothing, and one `assistant` record pinned at
 * {@link SKILL_USE_CLI_VERSION}, carrying one `Skill` tool call per name
 * given.
 */
function writerScript(): string {
  return [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { dirname } from "node:path";',
    '',
    'const [, , logFile, sessionId, branch, promptHead, skillsCsv] = process.argv;',
    'const skills = skillsCsv.split(",").filter((name) => name.length > 0);',
    '',
    'const enqueue = { type: "queue-operation", operation: "enqueue", content: promptHead };',
    'const assistant = {',
    '  type: "assistant",',
    '  timestamp: new Date().toISOString(),',
    '  gitBranch: branch,',
    '  entrypoint: "sdk-cli",',
    '  isSidechain: false,',
    '  effort: "xhigh",',
    `  version: ${JSON.stringify(SKILL_USE_CLI_VERSION)},`,
    '  sessionId,',
    '  message: {',
    '    model: "claude-opus-5",',
    '    content: skills.map((skill, index) => ({',
    '      type: "tool_use",',
    '      id: `toolu_fixture_${index}`,',
    '      name: "Skill",',
    '      input: { skill },',
    '    })),',
    '    usage: {',
    '      input_tokens: 10,',
    '      output_tokens: 5,',
    '      cache_creation_input_tokens: 0,',
    '      cache_read_input_tokens: 0,',
    '    },',
    '  },',
    '};',
    '',
    'mkdirSync(dirname(logFile), { recursive: true });',
    'writeFileSync(logFile, `${JSON.stringify(enqueue)}\\n${JSON.stringify(assistant)}\\n`, "utf8");',
    '',
  ].join('\n');
}

/**
 * The stand-in `claude`: parses its own `--session-id`, reads the prompt
 * off stdin, and answers by the task's marker. `MARK-INVOKE` writes the
 * session log through {@link writerScript} before printing its report, so
 * the log exists once the call itself has returned.
 */
function standInClaude(options: {
  bunPath: string;
  writerPath: string;
  logDir: string;
  invokeReportPath: string;
  findingReportPath: string;
  invokedSkills: readonly string[];
}): string {
  const { bunPath, writerPath, logDir, invokeReportPath, findingReportPath, invokedSkills } = options;
  return [
    '#!/bin/sh',
    'sessionId=""',
    'prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "--session-id" ]; then sessionId="$arg"; fi',
    '  prev="$arg"',
    'done',
    'prompt=$(/bin/cat)',
    'head=$(printf \'%s\\n\' "$prompt" | /usr/bin/head -n 1)',
    'case "$head" in',
    '  *MARK-INVOKE*)',
    '    branch=$(git rev-parse --abbrev-ref HEAD)',
    `    /bin/mkdir -p '${logDir}'`,
    `    '${bunPath}' '${writerPath}' '${logDir}/'"$sessionId"'.jsonl' "$sessionId" "$branch" "$head" '${invokedSkills.join(',')}'`,
    `    /bin/cat '${invokeReportPath}'`,
    '    ;;',
    '  *MARK-FINDING*)',
    `    /bin/cat '${findingReportPath}'`,
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

/** The stand-in `gh`: refuses every call, as the tracker chain's fallback expects. */
function standInGh(): string {
  return '#!/bin/sh\necho "gh stand-in: not logged in" >&2\nexit 1\n';
}

/** Everything one scratch run lives in. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly path: string;
}

let planted = 0;

/** A scratch repository on a feature branch, holding the fixture plan and its skills. */
function plantScratch(): Scratch {
  planted += 1;
  const root = join(tempRoot, `run-${planted}`);
  const repoPath = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repoPath, bin, home]) mkdirSync(dir, { recursive: true });
  const repo = realpathSync(repoPath);

  const logDir = sessionLogDir(repo, home);
  const writerPath = join(bin, 'write-session-log.mjs');
  writeFileSync(writerPath, writerScript(), 'utf8');

  const invokeReportPath = join(root, 'invoke-report.md');
  const findingReportPath = join(root, 'finding-report.md');
  writeFileSync(invokeReportPath, INVOKE_REPORT, 'utf8');
  writeFileSync(findingReportPath, FINDING_REPORT, 'utf8');

  writeScript(join(bin, 'claude'), standInClaude({
    bunPath: process.execPath,
    writerPath,
    logDir,
    invokeReportPath,
    findingReportPath,
    invokedSkills: [SKILL_EARNING, SKILL_RECURRING, SKILL_UNMEASURED],
  }));
  writeScript(join(bin, 'gh'), standInGh());

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'loop@example.test');
  git(repo, 'config', 'user.name', 'Rafa Loop');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', `feat/${STUB}`);
  plantProjectConfig(repo);

  for (const [name, strings] of [
    [SKILL_EARNING, [FAILURE_EARNING]],
    [SKILL_IGNORED, null],
    [SKILL_RECURRING, [FAILURE_RECURRING]],
    [SKILL_UNMEASURED, null],
  ] as const) {
    const path = join(repo, '.claude', 'skills', name, 'SKILL.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, skillFile(name, strings), 'utf8');
  }

  mkdirSync(join(repo, '.plans'));
  const plan = [`# Plan: ${STUB}`, '', `- [ ] ${INVOKE_TASK}`, `- [ ] ${FINDING_TASK}`, ''];
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), plan.join('\n'), 'utf8');

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  return { repo, home, path: [bin, dirname(gitBinary)].join(delimiter) };
}

/** What one spawned run did. */
interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one rafa command inside the scratch repository. */
function run(scratch: Scratch, args: readonly string[]): CommandRun {
  const spawned = Bun.spawnSync(
    [process.execPath, RAFA_ENTRY, ...args],
    { cwd: scratch.repo, env: { PATH: scratch.path, HOME: scratch.home }, timeout: 60_000 },
  );
  return {
    exitCode: spawned.exitCode,
    stdout: spawned.stdout.toString(),
    stderr: spawned.stderr.toString(),
  };
}

/** The `data` of a spawned command's last json-mode event. */
function resultDataOf(stdout: string): unknown {
  const events = stdout.trimEnd().split('\n')
    .map((line) => JSON.parse(line) as { type: string; data?: unknown });
  const last = events.at(-1);
  if (last?.type !== 'result') throw new Error(`stdout ends with no result event: ${stdout}`);
  return last.data;
}

/** Plants the lesson-only fact row, its plan CI reading and its held instinct record. */
function plantLessonRow(repo: string): void {
  const dispatch = { sessionId: 'fixture-lesson-session', planStub: STUB, taskLine: 'Hold the fixture lesson' };
  writeDispatch(repo, {
    ...dispatch,
    declaration: null,
    flags: [],
    resolver: 'planner',
    skillsOffered: [],
    lessonsOffered: [LESSON_ID],
  });
  writeTaskReport(repo, { dispatch, outcome: 'done', report: { status: 'done', skillsUsed: [] } });
  writePlanCi(repo, {
    planStub: STUB,
    pr: 1,
    headSha: 'a'.repeat(40),
    verdict: 'red',
    failing: [FAILING_CHECK],
    readAt: '2026-09-27T12:00:00.000Z',
  });
  const instinctPath = join(repo, '.rafa', 'instincts', `${LESSON_ID}.md`);
  mkdirSync(dirname(instinctPath), { recursive: true });
  writeFileSync(instinctPath, lessonFile(LESSON_ID, FAILING_CHECK), 'utf8');
}

/** An arm's skill by name, or undefined. */
function skillOf(arm: SkillsReportArm | undefined, name: string) {
  return arm?.skills.find((skill) => skill.name === name);
}

describe('a fixture plan run under the stand-in claude, collected, then reported by --skills', () => {
  it('holds each of the four skills to its own signal, and the lesson to injected-recurring', () => {
    const scratch = plantScratch();

    const started = run(scratch, ['start', `--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait']);
    expect(started.exitCode, `${started.stdout}${started.stderr}`).toBe(0);

    const collected = run(scratch, ['effort', 'collect']);
    expect(collected.exitCode, `${collected.stdout}${collected.stderr}`).toBe(0);
    expect(collected.stdout).toContain('sessions  1 logs, 0 outside window, 0 already stored, 1 read, 0 failed, +1 rows');
    expect(collected.stdout).toContain('skills    1 appended sessions, 0 already counted, 1 read, 0 unknown, 0 failed, +3 rows');

    plantLessonRow(scratch.repo);

    const reported = run(scratch, ['effort', 'report', '--skills', `--plan=${STUB}`, '--output=json']);
    expect(reported.exitCode, `${reported.stdout}${reported.stderr}`).toBe(0);
    const report = resultDataOf(reported.stdout) as SkillsReport;

    expect(report.plans).toHaveLength(1);
    const [plan] = report.plans;
    expect(plan?.planStub).toBe(STUB);
    expect(plan?.sessions).toBe(3);
    expect(plan?.planCi?.failing).toEqual([FAILING_CHECK]);

    expect(plan?.resolvers.map(({ resolver }) => resolver)).toEqual(['planner']);
    const [arm] = plan?.resolvers ?? [];

    const earning = skillOf(arm, SKILL_EARNING);
    const ignored = skillOf(arm, SKILL_IGNORED);
    const recurring = skillOf(arm, SKILL_RECURRING);
    const unmeasured = skillOf(arm, SKILL_UNMEASURED);

    expect(earning).toMatchObject({ offered: 1, invoked: 1, signal: 'earning' });
    expect(ignored).toMatchObject({ offered: 1, invoked: 0, signal: 'ignored' });
    expect(recurring).toMatchObject({ offered: 1, invoked: 1, signal: 'recurring' });
    expect(recurring?.matches.map(({ string, source }) => [string, source]))
      .toEqual([[FAILURE_RECURRING, 'finding']]);
    expect(unmeasured).toMatchObject({ offered: 1, invoked: 1, signal: 'unmeasured' });

    expect(arm?.lessons.map(({ id, artifact, signal }) => [id, artifact, signal]))
      .toEqual([[LESSON_ID, FAILING_CHECK, 'injected-recurring']]);
  }, 90_000);
});
