/**
 * Spawned tests for the four inventory commands, `rafa skill list`,
 * `rafa agent list`, `rafa skill show` and `rafa agent show`, run as
 * `bun src/rafa.ts` in a scratch repository with a HOME of its own.
 *
 * One planted tree serves every case: a project skill a home skill of the
 * same name is shadowed by, a home-only skill and a home-only agent (which
 * a loop under `settingSources: project,local` never resolves), and a
 * project skill switched off by `skillOverrides`. The refusals sit beside
 * controls that differ in the one word: a known source, a known name.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Two spawns a case may make, with headroom. */
const SPAWN_TIMEOUT = 60_000;

/** One row of a json listing, as far as these cases read it. */
interface Row {
  readonly name: string;
  readonly source: string;
  readonly state: string;
  readonly visibleToLoop: boolean;
}

function skillText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\ntags: [verification]\nstack: [typescript]\n---\n\n# ${name}\n\nRead each exit code.\n`;
}

function agentText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the work.\n`;
}

function plantFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** The scratch repository every case runs in, planted once. */
const scratch = plantScratchRepo(tempBase);
plantProjectConfig(scratch.repo, 'version: 1\nloop:\n  settingSources: project,local\n');
plantFile(join(scratch.repo, '.claude/skills/shared-skill/SKILL.md'), skillText('shared-skill', 'The project copy'));
plantFile(join(scratch.repo, '.claude/skills/switched-off/SKILL.md'), skillText('switched-off', 'Turned off by settings'));
plantFile(join(scratch.repo, '.claude/settings.json'), JSON.stringify({ skillOverrides: { 'switched-off': 'off' } }));
plantFile(join(scratch.home, '.claude/skills/shared-skill/SKILL.md'), skillText('shared-skill', 'The home copy'));
plantFile(join(scratch.home, '.claude/skills/user-only/SKILL.md'), skillText('user-only', 'Held by the home alone'));
plantFile(join(scratch.home, '.claude/agents/user-agent.md'), agentText('user-agent', 'A home agent'));
plantFile(join(scratch.repo, '.claude/agents/project-agent.md'), agentText('project-agent', 'A project agent'));

function run(words: readonly string[]) {
  return runRafa(scratch, scratch.repo, words);
}

/** The rows of the json result a listing ended with. */
function rowsOf(stdout: string, key: 'skills' | 'agents'): Row[] {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as unknown as {
    data: Record<string, Row[]>;
  };
  return result.data[key] ?? [];
}

describe('rafa skill list, spawned', () => {
  it('reports shadowed, user-only and switched-off skills', () => {
    const answer = run(['skill', 'list', '--output=json']);
    expect(answer.exitCode).toBe(0);
    const rows = rowsOf(answer.stdout, 'skills');

    const shadowed = rows.find((row) => row.name === 'shared-skill' && row.source === 'user');
    expect(shadowed?.state).toBe('shadowed-by:project');
    const winner = rows.find((row) => row.name === 'shared-skill' && row.source === 'project');
    expect(winner?.state).toBe('enabled');
    expect(winner?.visibleToLoop).toBe(true);

    const userOnly = rows.find((row) => row.name === 'user-only');
    expect(userOnly?.source).toBe('user');
    expect(userOnly?.state).toBe('enabled');
    expect(userOnly?.visibleToLoop).toBe(false);

    const off = rows.find((row) => row.name === 'switched-off');
    expect(off?.state).toBe('disabled:skillOverrides');
    expect(off?.visibleToLoop).toBe(false);
  }, SPAWN_TIMEOUT);

  it('--tier=project answers exactly what --source=project does', () => {
    const tier = run(['skill', 'list', '--tier=project', '--output=json']);
    const source = run(['skill', 'list', '--source=project', '--output=json']);
    expect(tier.exitCode).toBe(0);
    expect(source.exitCode).toBe(0);
    const tierRows = rowsOf(tier.stdout, 'skills');
    expect(tierRows.length).toBeGreaterThan(0);
    expect(tierRows.every((row) => row.source === 'project')).toBe(true);
    expect(tierRows).toEqual(rowsOf(source.stdout, 'skills'));
  }, SPAWN_TIMEOUT);

  it('exits 1 on an unknown --source and 0 on a known one', () => {
    const refused = run(['skill', 'list', '--source=nowhere']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout + refused.stderr).toContain('nowhere');
    expect(run(['skill', 'list', '--source=user']).exitCode).toBe(0);
  }, SPAWN_TIMEOUT);
});

describe('rafa agent list, spawned', () => {
  it('--hidden-from-loop names the user-only agent and not the project one', () => {
    const answer = run(['agent', 'list', '--hidden-from-loop', '--output=json']);
    expect(answer.exitCode).toBe(0);
    const names = rowsOf(answer.stdout, 'agents').map((row) => row.name);
    expect(names).toContain('user-agent');
    expect(names).not.toContain('project-agent');
  }, SPAWN_TIMEOUT);

  it('exits 1 on an unknown --source', () => {
    expect(run(['agent', 'list', '--source=nowhere']).exitCode).toBe(1);
  }, SPAWN_TIMEOUT);
});

describe('rafa skill show and agent show, spawned', () => {
  it('exit 1 on an unknown name and 0 on a known one', () => {
    expect(run(['skill', 'show', 'no-such-skill']).exitCode).toBe(1);
    expect(run(['skill', 'show', 'user-only']).exitCode).toBe(0);
    expect(run(['agent', 'show', 'no-such-agent']).exitCode).toBe(1);
    expect(run(['agent', 'show', 'user-agent']).exitCode).toBe(0);
  }, SPAWN_TIMEOUT);
});

describe('rafa describe, spawned', () => {
  it('lists all four commands', () => {
    const answer = run(['describe', '--output=json']);
    expect(answer.exitCode).toBe(0);
    const result = eventsOf(answer.stdout).find((event) => event.type === 'result') as unknown as {
      data: { subjects: { name: string; actions: { name: string }[] }[] };
    };
    const actionsOf = (subject: string): string[] => (result.data.subjects.find((entry) => entry.name === subject)?.actions ?? []).map((action) => action.name);
    expect(actionsOf('skill')).toEqual(expect.arrayContaining(['list', 'show']));
    expect(actionsOf('agent')).toEqual(expect.arrayContaining(['list', 'show']));
  }, SPAWN_TIMEOUT);
});
