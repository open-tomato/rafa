/**
 * A `skills=` name no tier holds, read end to end: `rafa plan validate`
 * and `rafa loop start` preflight each refuse a scratch plan whose task
 * line names one, naming that line, and `buildPlanPrompt` over a fixture
 * spec and a scratch skill tree carries the skill index after the
 * routing section. The unit seams live in `agents/roster.test.ts`,
 * `start/preflight.test.ts` and `plan.test.ts`; this file joins them
 * over the spawned CLI. A stand-in `claude` logs its calls so "nothing
 * was dispatched" is read off a file.
 */
import { execFileSync } from 'node:child_process';
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

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../config-load.js';
import {
  buildPlanPrompt,
  readPlanFormat,
  readPlanSkillIndex,
  ROUTING_HEADING,
  SKILL_INDEX_HEADING,
} from '../plan.js';

import { plantProjectConfig } from './cli-capture.js';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));
const RAFA_ENTRY = join(SRC_DIR, 'rafa.ts');
const KILL_AFTER_MS = 45_000;
const RUN_TIMEOUT = { timeout: 60_000 };

const GIT_DIR = (() => {
  const found = Bun.which('git');
  if (found === null) throw new Error('git is not on the PATH this suite runs under');
  return dirname(found);
})();

const STUB = 'skill-name-refusal';
const GHOST = 'skill-name-ghost';
const KNOWN = 'skill-name-known';

/** The plan: a served skill on line 3, the ghost on line 4. */
const PLAN_TEXT = [
  `# Plan: ${STUB}`,
  '',
  `- [ ] Write the tests  {skills=${KNOWN}}`,
  `- [ ] Write the code  {skills=${KNOWN},${GHOST}}`,
  '',
].join('\n');

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-name-refusal-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Writes a project-tier skill under `root`'s `.claude/skills/`. */
function plantSkill(root: string, name: string): void {
  const dir = join(root, '.claude', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, 'description: "Use when probing"', 'prevents: a probe gone astray', 'tags: [probe]', '---', '', 'The body.', ''].join('\n'),
  );
}

interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly calls: string;
  readonly path: string;
  readonly planFile: string;
}

/** One scratch repository on its feature branch, holding the plan, the known skill and a stand-in `claude`. */
function plantScratch(): Scratch {
  const repo = join(tempRoot, 'repo');
  const bin = join(tempRoot, 'bin');
  const home = join(tempRoot, 'home');
  const calls = join(tempRoot, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const claude = join(bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    '/bin/cat > "$calls/$n.prompt"',
    'echo "Done, and nothing to report."',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'loop@example.test');
  git(repo, 'config', 'user.name', 'Rafa Loop');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, 'checkout', '-q', '-b', `feat/${STUB}`);

  mkdirSync(join(repo, '.plans'), { recursive: true });
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN_TEXT, 'utf8');
  plantProjectConfig(repo);
  plantSkill(repo, KNOWN);

  return { repo, home, calls, path: [bin, GIT_DIR].join(delimiter), planFile: `.plans/PLAN-${STUB}.md` };
}

interface SpawnRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runRafa(scratch: Scratch, words: readonly string[]): SpawnRun {
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, ...words], {
    cwd: scratch.repo,
    env: { PATH: scratch.path, HOME: scratch.home },
    timeout: KILL_AFTER_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** What `unresolvedSkillLine` words for the ghost, asked for on line 4 only. */
const GHOST_LINE = `skill "${GHOST}" (line 4) cannot be served: skill ${GHOST} is held by no tier:`;

describe('a skills= name no tier holds, over a scratch plan and project', () => {
  it('is refused by plan validate, naming the line, and by loop start before any session', () => {
    const scratch = plantScratch();

    const validate = runRafa(scratch, ['plan', 'validate', scratch.planFile]);

    expect(validate.exitCode).toBe(1);
    expect(validate.stdout).toContain(`error: ${scratch.planFile}: ${GHOST_LINE}`);
    expect(validate.stdout).not.toContain(`skill "${KNOWN}"`);
    expect(validate.stderr).toContain('1 unresolvable skill');

    const start = runRafa(scratch, ['loop', 'start', `--plan=${scratch.planFile}`, '--no-ci-wait']);

    expect(start.exitCode).toBe(1);
    expect(start.stderr).toContain(`❌ Refusing to start: PLAN-${STUB}.md names 1 skill(s) no loaded tier resolves`);
    expect(start.stderr).toContain(GHOST_LINE);
    expect(start.stderr).not.toContain(`skill "${KNOWN}"`);
    expect(existsSync(join(scratch.calls, 'count'))).toBe(false);
  }, RUN_TIMEOUT);
});

describe('buildPlanPrompt over a fixture spec and a scratch skill tree', () => {
  it('carries the index of the scratch skills after the routing section and before the spec', () => {
    const root = join(tempRoot, 'prompt-repo');
    const home = join(tempRoot, 'prompt-home');
    for (const dir of [root, home]) mkdirSync(dir, { recursive: true });
    plantSkill(root, KNOWN);
    const { config } = loadConfig({ root, home });
    const index = readPlanSkillIndex(root, home, config, join(SRC_DIR, 'plan.ts'));
    const template = readFileSync(join(SRC_DIR, 'plan-prompt.md'), 'utf8');

    const prompt = buildPlanPrompt(template, readPlanFormat(SRC_DIR), '# Fixture spec\n', 'spec', '.rafa/plans', undefined, undefined, index);

    const line = `${KNOWN} — probe — a probe gone astray`;
    expect(index.split('\n')).toContain(line);
    expect(prompt).toContain(`\n${line}\n`);
    const at = prompt.indexOf(line);
    expect(prompt.indexOf(ROUTING_HEADING)).toBeLessThan(prompt.indexOf(SKILL_INDEX_HEADING));
    expect(prompt.indexOf(SKILL_INDEX_HEADING)).toBeLessThan(at);
    expect(at).toBeLessThan(prompt.indexOf('## Spec'));
  });
});
