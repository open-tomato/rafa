/**
 * An integration test for the stretch rules in `plan create --issue`:
 * a real `plan create` process, run in a scratch git repository over a
 * planted stretch folder (`.rafa/stretch/112/rules.md`) and one stub of
 * `gh`, with `RAFA_STRETCH_RULES` set as `rafa stretch item` sets it.
 *
 * Three readings, each over the snapshot the run leaves on disk:
 *
 *  - the rules land in the snapshot under `## Stretch rules`, after the
 *    local notes, and the planner is handed that exact file;
 *  - a `rules.md` that changed since the copy was saved rebuilds the
 *    copy as `notes-rebuilt`, without asking, and the plan already made
 *    is kept (the run then ends on the plan-already-there refusal, which
 *    comes after the snapshot is settled and leaves the plan alone);
 *  - with no `rules.md` (the value unset) the snapshot is the one the
 *    base writes, byte for byte.
 *
 * The planner is a fixture resolved through a registry handed to the
 * command, as `plan-board-integration.test.ts` does; `claude` never
 * runs, and a stand-in first on the PATH fails any run that reaches it.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { specPath } from '@open-tomato/rafa/board/naming';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';
import { snapshotText, SPEC_LABEL } from '@open-tomato/rafa-board/board/issue';
import { SPEC_READY_LABEL } from '@open-tomato/rafa-board/board/readiness';
import { stretchRulesLine } from '@open-tomato/rafa-board/board/snapshot-settle';
import { completeSpecBody } from '@open-tomato/rafa-board/tests/spec-bodies';

import { expectExit, plantProjectConfig } from './cli-capture.js';
import { hostToolDirs } from './stand-in-gh.js';

/** `src/`, where every module the probe imports lives. */
const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Where snapshots are written; a project's own default. */
const SPECS_DIR = '.rafa/specs';

/** The rules file, under the project root. */
const RULES_RELATIVE = join('.rafa', 'stretch', '112', 'rules.md');

const ISSUE_NUMBER = 60;
const TITLE = 'Rules in the snapshot';
const BODY = completeSpecBody(TITLE, 'Append the stretch rules to the snapshot.');
const FIRST_RULES = '- Close-out notes go into the main tracker.\n';
const CHANGED_RULES = '- Close-out notes go into the main tracker.\n- Every importer count gives two counts.\n';

/** The child: a fixture planner in place of core's, recording what it was handed. */
const PROBE = [
  'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { registerCoreAdapters } from ${JSON.stringify(join(SRC_DIR, 'adapter-registry.ts'))};`,
  `import { registerCoreConfigSections } from ${JSON.stringify(join(SRC_DIR, 'config-registry.ts'))};`,
  'registerCoreConfigSections();',
  'registerCoreAdapters();',
  `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, '..', 'packages', 'rafa', 'src', 'core', 'adapters', 'index.ts'))};`,
  `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
  `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, '..', 'packages', 'rafa', 'src', 'cli', 'registry.ts'))};`,
  `import declared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
  `import { CORE_REGISTRY } from ${JSON.stringify(join(SRC_DIR, 'commands', 'index.ts'))};`,
  `import { registryRoster } from ${JSON.stringify(join(SRC_DIR, '..', 'packages', 'rafa-board', 'src', 'commands', 'plan', 'refs-check.ts'))};`,
  `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
  `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
  '',
  'const [record, ...args] = process.argv.slice(2);',
  'const registry = createAdapterRegistry([{',
  '  port: "planner",',
  '  kind: "claude",',
  '  portVersion: 1,',
  '  create: (context) => ({',
  '    create: async (request) => {',
  '      const specContent = readFileSync(join(context.repoRoot, request.specPath), "utf8");',
  '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
  '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
  '      writeFileSync(',
  '        join(context.repoRoot, planPath),',
  '        "# Plan\\n\\n```rafa:plan\\nstub: " + request.stub + "\\n```\\n\\n- [ ] one task\\n",',
  '      );',
  '      writeFileSync(record, JSON.stringify({ specPath: request.specPath, specContent }));',
  '      return { planPath, prerequisitesPath: null };',
  '    },',
  '  }),',
  '}]);',
  'const command = wrapPhaseZeroCommand(declared, (words, root) => plan(words, root, registryRoster(CORE_REGISTRY), registry));',
  'const commands = createCommandRegistry({ subjects: [{ name: "plan", summary: "plans" }], commands: [command] });',
  'const { exitCode } = await dispatch(["plan", "create", ...args], { registry: commands });',
  'process.exitCode = exitCode;',
  '',
].join('\n');

let tempDir = '';
let planted = 0;

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-stretch-rules-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A run of `git`, throwing what it wrote to stderr when it failed. */
function git(args: readonly string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

/** A JSON payload quoted for a single-quoted shell string. */
function shellQuoted(payload: unknown): string {
  return JSON.stringify(payload).replace(/'/gu, String.raw`'\''`);
}

/** Writes a stand-in `gh` answering the one planted issue and its author's trust. */
function writeGhStub(bin: string): void {
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${String(ISSUE_NUMBER)}" ]; then`,
    `  printf '%s' '${shellQuoted({
      number: ISSUE_NUMBER,
      title: TITLE,
      body: BODY,
      state: 'OPEN',
      labels: [SPEC_LABEL, SPEC_READY_LABEL].map((name) => ({ name })),
      author: { login: 'octocat' },
    })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "api" ] && [ "$2" = "repos/{owner}/{repo}/collaborators/octocat/permission" ]; then',
    `  printf '%s' '${shellQuoted({ permission: 'admin', role_name: 'admin' })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '  printf \'%s\' \'[]\'',
    '  exit 0',
    'fi',
    'echo "the stand-in gh was asked $*" >&2',
    'exit 1',
    '',
  ];
  const gh = join(bin, 'gh');
  writeFileSync(gh, lines.join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

interface Scratch {
  readonly root: string;
  readonly repo: string;
  readonly path: string;
  readonly home: string;
  readonly probe: string;
}

/** Plants a scratch repository with a bare origin, the stand-in `gh`, and a `claude` that must never run. */
function plantScratch(): Scratch {
  planted += 1;
  const root = join(tempDir, `run-${String(planted)}`);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  for (const dir of [repo, bin, home]) mkdirSync(dir, { recursive: true });

  const claude = join(bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'echo "the stand-in claude ran" >&2', 'exit 97', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
  writeGhStub(bin);

  git(['init', '-q', '.'], repo);
  const origin = join(root, 'origin.git');
  git(['init', '--bare', '-q', origin], root);
  git(['remote', 'add', 'origin', origin], repo);
  plantProjectConfig(repo, '');

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, PROBE, 'utf8');
  return { root, repo, path: [bin, ...hostToolDirs()].join(delimiter), home, probe };
}

/** Plants `.rafa/stretch/112/rules.md` with `text`, answering its absolute path. */
function plantRules(scratch: Scratch, text: string): string {
  const file = join(scratch.repo, RULES_RELATIVE);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/** Runs `plan create --issue` with `rules` as `RAFA_STRETCH_RULES`, or the value unset for null. */
function runPlan(scratch: Scratch, name: string, rules: string | null) {
  const record = join(scratch.root, `${name}.json`);
  const proc = Bun.spawnSync(
    [process.execPath, scratch.probe, record, `--issue=${String(ISSUE_NUMBER)}`, '--no-progress'],
    {
      cwd: scratch.repo,
      env: {
        TMPDIR: tmpdir(),
        PATH: scratch.path,
        ...scratchHomeEnv(scratch.home),
        ...(rules === null
          ? {}
          : { RAFA_STRETCH_RULES: rules }),
      },
    },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), record };
}

const SNAPSHOT = specPath(SPECS_DIR, ISSUE_NUMBER, TITLE);

/** The plan files the scratch repository holds, by name. */
function planFiles(scratch: Scratch): readonly string[] {
  const dir = join(scratch.repo, '.rafa', 'plans');
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith('PLAN-'))
      .sort()
    : [];
}

describe('plan create --issue over a planted stretch folder', () => {
  it('appends the stretch rules to the snapshot and hands the planner that exact file', () => {
    const scratch = plantScratch();
    const rulesFile = plantRules(scratch, FIRST_RULES);

    const run = runPlan(scratch, 'first', rulesFile);

    expectExit(run, 0, { ...scratch });
    const onDisk = readFileSync(join(scratch.repo, SNAPSHOT), 'utf8');
    expect(onDisk).toContain('## Stretch rules');
    expect(onDisk).toContain(FIRST_RULES.trim());
    expect(onDisk).toBe(snapshotText(BODY, null, FIRST_RULES));
    expect(run.stdout).toContain(stretchRulesLine(RULES_RELATIVE, SNAPSHOT));
    const record = JSON.parse(readFileSync(run.record, 'utf8')) as { specPath: string; specContent: string };
    expect(record).toEqual({ specPath: SNAPSHOT, specContent: onDisk });
  }, 30_000);

  it('rebuilds the snapshot as notes-rebuilt when rules.md changed, keeping the plan already made', () => {
    const scratch = plantScratch();
    const rulesFile = plantRules(scratch, FIRST_RULES);
    expectExit(runPlan(scratch, 'first', rulesFile), 0, { ...scratch });
    const plansBefore = planFiles(scratch);
    expect(plansBefore).toHaveLength(1);
    const planPath = join(scratch.repo, '.rafa', 'plans', plansBefore[0] as string);
    const planBefore = readFileSync(planPath, 'utf8');
    plantRules(scratch, CHANGED_RULES);

    const second = runPlan(scratch, 'second', rulesFile);

    // The snapshot is settled first; the plan-already-there refusal follows it.
    expectExit(second, 1, { ...scratch });
    expect(second.stdout).toContain('local notes changed; rebuilt');
    expect(second.stdout).toContain(SNAPSHOT);
    expect(second.stderr).toContain('already exists');
    expect(readFileSync(join(scratch.repo, SNAPSHOT), 'utf8')).toBe(snapshotText(BODY, null, CHANGED_RULES));
    expect(readdirSync(join(scratch.repo, SPECS_DIR, 'previous'))).toHaveLength(1);
    expect(planFiles(scratch)).toEqual(plansBefore);
    expect(readFileSync(planPath, 'utf8')).toBe(planBefore);
  }, 60_000);

  it('leaves the snapshot as the base writes it when there is no rules.md', () => {
    const scratch = plantScratch();

    const run = runPlan(scratch, 'plain', null);

    expectExit(run, 0, { ...scratch });
    const onDisk = readFileSync(join(scratch.repo, SNAPSHOT), 'utf8');
    expect(onDisk).toBe(snapshotText(BODY, null));
    expect(onDisk).not.toContain('## Stretch rules');
    expect(run.stdout).not.toContain('stretch rules:');
  }, 30_000);
});
