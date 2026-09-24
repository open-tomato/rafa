/**
 * Spawned tests of `rafa plan needs`: `bun src/rafa.ts plan needs` run in a
 * scratch git repository with a HOME and a PATH of its own
 * (`cli-capture.ts`), so what it reads is what the case planted.
 *
 * The planted plan names a project agent, a user-only agent (under the
 * scratch HOME, which the default `loop.settingSources` leaves out), a
 * missing skill, a tool of an MCP server no file configures, and a
 * prerequisite program not on PATH. Each unmet reading sits beside a met
 * one in the same run, and the two flipping cases plant a plan whose
 * needs are all provided, and a TypeScript project with `ts-symbols` on
 * PATH, so a pass is not a command that prints nothing whatever it reads.
 */
import type { ScratchRepo } from './cli-capture.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-needs-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 60_000;

const PLAN = '.rafa/plans/PLAN-demo.md';

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Writes an executable program into the scratch PATH directory. */
function plantProgram(scratch: ScratchRepo, name: string): void {
  const file = join(scratch.bin, name);
  write(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
}

/** An agent definition. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

/** A skill definition; `body` is its text. */
function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Runs the gates in order\n---\n\n${body}\n`;
}

/** A scratch project with the plan of the module note planted. */
function plantNeedsProject(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  write(join(scratch.repo, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
  write(join(scratch.home, '.claude/agents/user-reviewer.md'), agent('user-reviewer'));
  write(join(scratch.repo, PLAN), [
    '# Plan: demo',
    '',
    '- [ ] Review with the project agent {agent=project-reviewer}',
    '- [ ] Review with the user agent {agent=user-reviewer}',
    '- [ ] Use a skill {skills=absent-skill}',
    '- [ ] Ask a server {tools=mcp__ghost__lookup,Read}',
    '',
  ].join('\n'));
  write(join(scratch.repo, '.rafa/plans/PREREQUISITES-demo.md'), [
    '# Prerequisites',
    '',
    '## Checks [auto]',
    '',
    '- [ ] The absent program answers: `zz-absent-program --version`',
    '- [ ] The present tool is on PATH: `command -v present-tool`',
    '',
  ].join('\n'));
  plantProgram(scratch, 'present-tool');
  return scratch;
}

/** The lines of `stdout` that name `word`. */
function linesNaming(stdout: string, word: string): string[] {
  return stdout.split('\n').filter((line) => line.includes(word));
}

describe('rafa plan needs, spawned', () => {
  it('--missing lists what a run would not have, and exits 1', () => {
    const scratch = plantNeedsProject();

    const run = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN, '--missing']);

    expect(run.exitCode).toBe(1);
    const userLine = linesNaming(run.stdout, 'user-reviewer');
    expect(userLine).toHaveLength(1);
    expect(userLine[0]).toContain('not visible to a run');
    expect(userLine[0]).toContain('user');
    expect(linesNaming(run.stdout, 'absent-skill')[0]).toContain('missing');
    expect(linesNaming(run.stdout, 'ghost')[0]).toContain('missing');
    expect(linesNaming(run.stdout, 'zz-absent-program')[0]).toContain('missing');
    // The controls: what a run has stays out of the list.
    expect(run.stdout).not.toContain('project-reviewer');
    expect(run.stdout).not.toContain('present-tool');
    expect(run.stderr).toContain('4 unmet needs');
  }, SPAWN_TIMEOUT);

  it('--missing prints nothing and exits 0 when all is provided', () => {
    const scratch = plantScratchRepo(tempBase);
    write(join(scratch.repo, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
    write(join(scratch.repo, PLAN), '# Plan: ok\n\n- [ ] Review {agent=project-reviewer}\n');
    write(join(scratch.repo, '.rafa/plans/PREREQUISITES-demo.md'), [
      '## Checks [auto]',
      '',
      '- [ ] The tool is on PATH: `command -v present-tool`',
      '',
    ].join('\n'));
    plantProgram(scratch, 'present-tool');

    const met = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN, '--missing']);
    // The control: the same plan without --missing lists the needs.
    const listed = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN]);

    expect(met).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('project-reviewer');
    expect(listed.stdout).toContain('present-tool');
  }, SPAWN_TIMEOUT);

  it('--source=project lists only the project items', () => {
    const scratch = plantNeedsProject();

    const run = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN, '--source=project']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('project-reviewer');
    for (const other of ['user-reviewer', 'absent-skill', 'ghost', 'zz-absent-program', 'present-tool']) {
      expect(run.stdout).not.toContain(other);
    }
  }, SPAWN_TIMEOUT);

  it('names ts-symbols for a TypeScript project without it on PATH, and exits 1', () => {
    const scratch = plantScratchRepo(tempBase);
    write(join(scratch.repo, 'tsconfig.json'), '{}\n');
    write(join(scratch.repo, '.claude/skills/symbols/SKILL.md'), skill('symbols', 'Use ts-symbols to find a definition.'));
    write(join(scratch.repo, PLAN), '# Plan: ts\n\n- [ ] Change the code\n');

    const missing = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN, '--missing']);
    plantProgram(scratch, 'ts-symbols');
    const provided = runRafa(scratch, scratch.repo, ['plan', 'needs', PLAN, '--missing']);

    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain('ts-symbols');
    expect(provided).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  }, SPAWN_TIMEOUT);
});
