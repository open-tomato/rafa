/**
 * Tests for the Stack tools and Plan needs readings of `rafa doctor --deep`.
 *
 * One world is planted under this file's temporary directory: a
 * TypeScript project (a `tsconfig.json` at its root), a home holding a
 * user-only skill `symbols` whose description names `ts-symbols`, a rafa
 * entry with one skill of its own beside it, and one `PATH` directory
 * holding `ts-symbols`. A second project root holds no marker.
 *
 * Every reading is taken beside the one that flips it, so no row passes
 * only because every row reads alike:
 *
 *   - the stack is `ok` with the user source and `ts-symbols` on `PATH`,
 *     and `warn` without the user source, or with an empty `PATH`;
 *   - the plan's user-only agent is a row without the user source and
 *     none with it, while its project agent is never one;
 *   - a plan with nothing unmet is one `ok` row.
 */
import type { DeepNeedsSeams } from './doctor-deep-needs.js';
import type { ClaudeSettingSource } from '../config-sections.js';
import type { NeedsReading } from '../plan/needs.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readStackNeeds } from '../plan/needs.js';

import {
  PLAN_NEEDS_SECTION_TITLE,
  planNeedsSection,
  readDeepPlanNeeds,
  readDeepStackTools,
  STACK_TOOLS_SECTION_TITLE,
  stackToolsSection,
} from './doctor-deep-needs.js';
import { renderDeepSection } from './doctor-deep-row.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-needs-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const bareRoot = join(base, 'bare');
const runtime = join(base, 'runtime');
const binDir = join(base, 'bin');
const plansDir = join(projectRoot, '.rafa', 'plans');
const planPath = join(plansDir, 'PLAN-demo.md');
const metPlanPath = join(plansDir, 'PLAN-met.md');

const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill whose description says `description`. */
function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n\nRead each exit code.\n`;
}

/** An agent definition keyed by `name`. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

write(join(projectRoot, 'tsconfig.json'), '{}\n');
write(join(projectRoot, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
write(join(home, '.claude/agents/user-reviewer.md'), agent('user-reviewer'));
write(join(home, '.claude/skills/symbols/SKILL.md'), skill('symbols', 'Trace TypeScript symbols with ts-symbols'));
write(join(runtime, 'cli.js'), '');
write(join(runtime, 'bundled/skills/rafa-only/SKILL.md'), skill('rafa-only', 'A skill rafa ships'));
mkdirSync(bareRoot, { recursive: true });

write(join(binDir, 'ts-symbols'), '#!/bin/sh\n');
chmodSync(join(binDir, 'ts-symbols'), 0o755);

write(planPath, [
  '# Plan',
  '',
  '- [ ] Review with the project agent {agent=project-reviewer}',
  '- [ ] Review with the user agent {agent=user-reviewer}',
  '- [ ] Use two skills {skills=absent-skill,rafa-only}',
  '- [ ] Ask a server {tools=mcp__ghost__lookup}',
  '',
].join('\n'));

write(join(plansDir, 'PREREQUISITES-demo.md'), [
  '# Prerequisites',
  '',
  '## Checks [auto]',
  '',
  '- [ ] The absent program answers: `zz-absent-program --version`',
  '',
].join('\n'));

write(metPlanPath, '# Plan\n\n- [ ] Review with the project agent {agent=project-reviewer}\n');

/** The seams for this world. */
function seams(
  settingSources: readonly ClaudeSettingSource[],
  pathDirs: readonly string[] = [binDir],
  root: string | null = projectRoot,
): DeepNeedsSeams {
  return { home, projectRoot: root, entry: join(runtime, 'cli.js'), pathDirs, settingSources, modules: [] };
}

/** The Stack tools section of this world under `options`. */
async function stackSection(...options: Parameters<typeof seams>) {
  const at = seams(...options);
  return stackToolsSection(await readDeepStackTools(at), at);
}

describe('readDeepStackTools', () => {
  it('is readStackNeeds over the same seams', async () => {
    const at = seams(WITHOUT_USER);

    expect(await readDeepStackTools(at)).toEqual(await readStackNeeds(at));
  });
});

describe('stackToolsSection', () => {
  it('reads the stack as ok with the user skill loaded and ts-symbols on PATH', async () => {
    const section = await stackSection(WITH_USER);

    expect(section.title).toBe(STACK_TOOLS_SECTION_TITLE);
    expect(section.rows).toEqual([{
      status: 'ok',
      name: 'typescript',
      detail: `ts-symbols in ${binDir}; skill symbols visible to a run`,
    }]);
  });

  it('reads the user-only skill as a warn under project,local, with the stack hint as the fix', async () => {
    const at = seams(WITHOUT_USER);
    const reading = await readDeepStackTools(at);
    const [row] = stackToolsSection(reading, at).rows;

    expect(row).toMatchObject({
      status: 'warn',
      name: 'typescript',
      detail: `ts-symbols in ${binDir}; skill symbols not visible to a run`,
    });
    expect(row?.fix).toBe(reading.stacks[0]?.hint ?? 'no hint');
    expect(row?.fix).toContain('add `user` to loop.settingSources');
  });

  it('reads ts-symbols off PATH as a warn naming what to install', async () => {
    const [row] = (await stackSection(WITH_USER, [])).rows;

    expect(row).toMatchObject({
      status: 'warn',
      detail: 'ts-symbols not on PATH; skill symbols visible to a run',
    });
    expect(row?.fix).toContain('install `ts-symbols`');
  });

  it('reads a project root with no marker as one note naming the marker', async () => {
    const section = await stackSection(WITH_USER, [binDir], bareRoot);

    expect(section.rows).toEqual([{
      status: 'note',
      name: 'stack',
      detail: `none detected: no tsconfig.json at ${bareRoot}`,
    }]);
  });

  it('reads no project root as one note', async () => {
    const section = await stackSection(WITH_USER, [binDir], null);

    expect(section.rows).toEqual([{ status: 'note', name: 'stack', detail: 'no project root to read a stack from' }]);
  });

  it('renders each row and its fix through the shared row lines', async () => {
    const lines = renderDeepSection(await stackSection(WITHOUT_USER, []));

    expect(lines[0]).toBe('Stack tools:');
    expect(lines[1]).toBe('  warn  typescript: ts-symbols not on PATH; skill symbols not visible to a run');
    expect(lines[2]).toStartWith('        fix: typescript: install `ts-symbols`');
  });
});

describe('warning rows', () => {
  const reading: NeedsReading = {
    items: [],
    stacks: [],
    warnings: [{ path: '/a.json', reason: 'is not JSON' }, { path: '/b.md', reason: 'cannot be read' }],
  };

  it('adds each reader warning as a warn row after the stack rows', () => {
    const { rows } = stackToolsSection(reading, { projectRoot: null });

    expect(rows.map((row) => `${row.status} ${row.name}`)).toEqual(['note stack', 'warn /a.json', 'warn /b.md']);
  });

  it('leaves out the warnings another section already showed, and only those', () => {
    const shown = [{ path: '/a.json', reason: 'is not JSON' }, { path: '/b.md', reason: 'another reason' }];
    const { rows } = stackToolsSection(reading, { projectRoot: null }, shown);

    expect(rows.map((row) => row.name)).toEqual(['stack', '/b.md']);
  });

  it('adds them to the Plan needs section the same way', () => {
    const { rows } = planNeedsSection({ plan: 'p', needs: reading, refusal: null }, [reading.warnings[1] ?? { path: '', reason: '' }]);

    expect(rows.map((row) => `${row.status} ${row.name}`)).toEqual(['ok plan', 'warn /a.json']);
  });
});

describe('readDeepPlanNeeds', () => {
  it('carries the plan\'s needs and no refusal', async () => {
    const reading = await readDeepPlanNeeds(planPath, 'PLAN-demo.md', seams(WITHOUT_USER));

    expect(reading.refusal).toBeNull();
    expect(reading.plan).toBe('PLAN-demo.md');
    expect(reading.needs?.items.length).toBeGreaterThan(0);
  });

  it('carries a plan that is not there as a refusal rather than throwing', async () => {
    const absent = join(plansDir, 'PLAN-absent.md');
    const reading = await readDeepPlanNeeds(absent, 'PLAN-absent.md', seams(WITHOUT_USER));

    expect(reading).toEqual({ plan: 'PLAN-absent.md', needs: null, refusal: `${absent}: no such file` });
  });
});

describe('planNeedsSection', () => {
  /** The Plan needs rows of `path` under `settingSources`. */
  async function rowsOf(path: string, settingSources: readonly ClaudeSettingSource[]) {
    return planNeedsSection(await readDeepPlanNeeds(path, 'PLAN.md', seams(settingSources))).rows;
  }

  it('titles the section with the plan', async () => {
    const section = planNeedsSection(await readDeepPlanNeeds(metPlanPath, 'PLAN-met.md', seams(WITH_USER)));

    expect(section.title).toBe(`${PLAN_NEEDS_SECTION_TITLE} (PLAN-met.md)`);
  });

  it('keeps only the unmet needs, each a warn, under project,local', async () => {
    const rows = await rowsOf(planPath, WITHOUT_USER);

    expect(rows.every((row) => row.status === 'warn')).toBe(true);
    expect(rows.map((row) => row.name)).toEqual([
      'agent user-reviewer',
      'skill absent-skill',
      'skill rafa-only',
      'skill symbols',
      'mcp ghost',
      'program zz-absent-program',
    ]);
  });

  it('drops the user agent once the user source is loaded, keeping the rest', async () => {
    const names = (await rowsOf(planPath, WITH_USER)).map((row) => row.name);

    expect(names).not.toContain('agent user-reviewer');
    expect(names).not.toContain('skill symbols');
    expect(names).toContain('skill absent-skill');
  });

  it('names where each unmet need was named, and its fix', async () => {
    const rows = await rowsOf(planPath, WITHOUT_USER);
    const byName = new Map(rows.map((row) => [row.name, row]));

    expect(byName.get('agent user-reviewer')).toEqual({
      status: 'warn',
      name: 'agent user-reviewer',
      detail: 'user enabled, not visible to a run (task line 4)',
      fix: 'see the user agent user-reviewer in the Settings section',
    });
    expect(byName.get('skill absent-skill')).toMatchObject({
      detail: 'missing (task line 5)',
      fix: 'add the skill absent-skill under .claude/skills/ in this project',
    });
    expect(byName.get('skill rafa-only')).toMatchObject({
      detail: 'rafa enabled, not visible to a run (task line 5)',
      fix: 'add the skill rafa-only under .claude/skills/ in this project: a session is never handed a rafa skill',
    });
    expect(byName.get('mcp ghost')).toMatchObject({
      detail: 'missing (task line 6)',
      fix: 'declare the mcp server ghost in a scope loop.settingSources loads',
    });
    expect(byName.get('program zz-absent-program')).toMatchObject({
      detail: 'not on PATH (prerequisite line 5)',
      fix: 'install zz-absent-program on PATH',
    });
  });

  it('reads a plan with nothing unmet as one ok row', async () => {
    expect(await rowsOf(metPlanPath, WITH_USER)).toEqual([
      { status: 'ok', name: 'plan', detail: 'nothing it needs is missing or hidden from a run' },
    ]);
  });

  it('reads a refused plan as one warn row carrying the refusal', () => {
    const section = planNeedsSection({ plan: 'PLAN-x.md', needs: null, refusal: '/p/PLAN-x.md: no such file' });

    expect(section.rows).toEqual([{ status: 'warn', name: 'plan', detail: 'cannot be read: /p/PLAN-x.md: no such file' }]);
  });
});
