/**
 * Tests for `readPlanNeeds`, `readSpecNeeds` and the readings under them.
 *
 * One world is planted under this file's temporary directory: a
 * project, a home, a rafa entry and one `PATH` directory. The plan in
 * it names
 *
 *   - a project agent, `project-reviewer`;
 *   - a user-only agent, `user-reviewer`, under the home alone;
 *   - a missing skill, `absent-skill`, beside a present one,
 *     `fence-skill`, whose shell fence calls one program on `PATH`, one
 *     off it, and a function the body defines for itself;
 *   - an MCP tool with no server, `mcp__ghost__lookup`, beside one whose
 *     server `.mcp.json` declares, `mcp__linear__save_issue`;
 *   - a prerequisite program not on `PATH`, `zz-absent-program`, beside
 *     one that is, asked after with `command -v`.
 *
 * Every "missing" or "not visible" reading sits beside a control of the
 * same kind that reads the other way, and visibility is read under two
 * `settingSources`, so no reading passes only because every item reads
 * alike. A done task and a ticked prerequisite name items the reading
 * must leave out.
 *
 * The stack-tools cases plant one small TypeScript project each (a
 * `tsconfig.json`, a one-task plan, its own home and `PATH` directory),
 * so `ts-symbols` present, missing, and its skill only at user level
 * are each read beside the reading that flips them.
 */
import type { Need, NeedsReading, NeedsSeams } from './needs.js';
import type { ClaudeSettingSource } from '../config-sections.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  fencePrograms,
  isUnmet,
  mcpServerOfTool,
  probePrograms,
  programDirectory,
  readPlanNeeds,
  readSpecNeeds,
  STACK_TOOLS,
} from './needs.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-needs-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const binDir = join(base, 'bin');
const plansDir = join(projectRoot, '.rafa', 'plans');
const planPath = join(plansDir, 'PLAN-demo.md');

/** `loop.settingSources` without `user`: the config default. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** An agent definition. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

/** A skill whose body holds `body`. */
function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Runs the gates in order\ntags: [verification]\nstack: [agnostic]\n---\n\n${body}`;
}

const FENCE_BODY = [
  '# Gates',
  '',
  '```bash',
  'present-tool --check',
  'fence-absent run',
  'helper() { echo ok; }',
  'helper',
  '```',
  '',
].join('\n');

write(join(projectRoot, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
write(join(home, '.claude/agents/user-reviewer.md'), agent('user-reviewer'));
write(join(projectRoot, '.claude/skills/fence-skill/SKILL.md'), skill('fence-skill', FENCE_BODY));
write(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { linear: { command: 'linear-mcp' } } }));
write(join(runtime, 'cli.js'), '');

write(join(binDir, 'present-tool'), '#!/bin/sh\n');
chmodSync(join(binDir, 'present-tool'), 0o755);
write(join(binDir, 'not-executable'), '#!/bin/sh\n');
chmodSync(join(binDir, 'not-executable'), 0o644);

write(planPath, [
  '# Plan',
  '',
  '- [ ] Review with the project agent {agent=project-reviewer}',
  '- [ ] Review with the user agent {agent=user-reviewer}',
  '- [ ] Use two skills {skills=absent-skill,fence-skill}',
  '- [ ] Ask two servers {tools=mcp__ghost__lookup,mcp__linear__save_issue,Read}',
  '- [x] Finished work {agent=done-only-agent}',
  '- [BLOCKED] Blocked work {skills=blocked-skill}',
  '',
].join('\n'));

write(join(plansDir, 'PREREQUISITES-demo.md'), [
  '# Prerequisites',
  '',
  '## Checks [auto]',
  '',
  '- [ ] The absent program answers: `zz-absent-program --version`',
  '- [ ] The present tool is on PATH: `command -v present-tool`',
  '- [x] Already done: `ticked-program --version`',
  '',
].join('\n'));

/** The seams for this world under `settingSources`. */
function seams(settingSources: readonly ClaudeSettingSource[]): NeedsSeams {
  return { home, projectRoot, entry: join(runtime, 'cli.js'), pathDirs: [binDir], settingSources, modules: [] };
}

/** The one need of `kind` and `name`, failing the case when there is none. */
function needOf(reading: NeedsReading, kind: Need['kind'], name: string): Need {
  const need = reading.items.find((item) => item.kind === kind && item.name === name);
  if (need === undefined) throw new Error(`no ${kind} ${name} in ${JSON.stringify(reading.items.map((item) => item.name))}`);
  return need;
}

describe('readPlanNeeds', () => {
  it('reads the project agent as present, from the project, and visible to a run', async () => {
    const need = needOf(await readPlanNeeds(planPath, seams(WITHOUT_USER)), 'agent', 'project-reviewer');

    expect(need).toMatchObject({ status: 'present', source: 'project', state: 'enabled', visibleToLoop: true });
    expect(need.origins).toEqual([{ by: 'task', line: 3 }]);
  });

  it('reads the user-only agent as present and not visible without the user source', async () => {
    const need = needOf(await readPlanNeeds(planPath, seams(WITHOUT_USER)), 'agent', 'user-reviewer');

    expect(need).toMatchObject({ status: 'present', source: 'user', visibleToLoop: false });
    expect(isUnmet(need)).toBe(true);
  });

  it('reads the same user-only agent as visible once the user source is on', async () => {
    const need = needOf(await readPlanNeeds(planPath, seams(WITH_USER)), 'agent', 'user-reviewer');

    expect(need).toMatchObject({ status: 'present', source: 'user', visibleToLoop: true });
    expect(isUnmet(need)).toBe(false);
  });

  it('reads the missing skill as missing, beside the present one', async () => {
    const reading = await readPlanNeeds(planPath, seams(WITHOUT_USER));

    expect(needOf(reading, 'skill', 'absent-skill')).toMatchObject({
      status: 'missing', source: null, path: null, state: null, visibleToLoop: false,
    });
    expect(needOf(reading, 'skill', 'fence-skill')).toMatchObject({ status: 'present', source: 'project' });
  });

  it('reads the MCP tool with no server as missing, beside the configured one', async () => {
    const reading = await readPlanNeeds(planPath, seams(WITHOUT_USER));

    expect(needOf(reading, 'mcp', 'ghost')).toMatchObject({
      status: 'missing', scope: null, loadedFrom: null, visibleToLoop: false,
    });
    expect(needOf(reading, 'mcp', 'linear')).toMatchObject({
      status: 'present', scope: 'project', loadedFrom: 'project', visibleToLoop: true,
    });
  });

  it('reads the prerequisite program not on PATH as missing, beside the one a lookup asks after', async () => {
    const reading = await readPlanNeeds(planPath, seams(WITHOUT_USER));

    expect(needOf(reading, 'program', 'zz-absent-program')).toMatchObject({
      status: 'missing', directory: null, origins: [{ by: 'prerequisite', line: 5 }],
    });
    const present = needOf(reading, 'program', 'present-tool');
    expect(present).toMatchObject({ status: 'present', directory: binDir });
    expect(present.origins).toEqual([{ by: 'prerequisite', line: 6 }, { by: 'skill', skill: 'fence-skill' }]);
  });

  it('reads the declared skill\'s fence programs, leaving out the function it defines', async () => {
    const reading = await readPlanNeeds(planPath, seams(WITHOUT_USER));

    expect(needOf(reading, 'program', 'fence-absent')).toMatchObject({
      status: 'missing', origins: [{ by: 'skill', skill: 'fence-skill' }],
    });
    expect(reading.items.some((item) => item.name === 'helper')).toBe(false);
  });

  it('lists every open task\'s needs, blocked included, done and ticked left out, by kind then name', async () => {
    const reading = await readPlanNeeds(planPath, seams(WITHOUT_USER));

    expect(reading.items.map((item) => `${item.kind} ${item.name} ${item.status}`)).toEqual([
      'agent project-reviewer present',
      'agent user-reviewer present',
      'skill absent-skill missing',
      'skill blocked-skill missing',
      'skill fence-skill present',
      'mcp ghost missing',
      'mcp linear present',
      'program fence-absent missing',
      'program present-tool present',
      'program zz-absent-program missing',
    ]);
    expect(reading.stacks).toEqual([]);
    expect(reading.warnings).toEqual([]);
  });

  it('reads no prerequisites for a plan with no PREREQUISITES file', async () => {
    const lonePlan = join(base, 'lone', 'PLAN-lone.md');
    write(lonePlan, '- [ ] One task {agent=project-reviewer}\n');

    const reading = await readPlanNeeds(lonePlan, seams(WITHOUT_USER));

    expect(reading.items.map((item) => item.name)).toEqual(['project-reviewer']);
  });

  it('refuses a plan that is not there, naming its path', async () => {
    const absent = join(base, 'nowhere', 'PLAN-x.md');

    await expect(readPlanNeeds(absent, seams(WITHOUT_USER))).rejects.toThrow(`${absent}: no such file`);
  });

  it('refuses a PREREQUISITES path that is there and does not read, naming it', async () => {
    const dir = join(base, 'broken');
    write(join(dir, 'PLAN-broken.md'), '- [ ] One task {agent=project-reviewer}\n');
    mkdirSync(join(dir, 'PREREQUISITES-broken.md'));

    await expect(readPlanNeeds(join(dir, 'PLAN-broken.md'), seams(WITHOUT_USER)))
      .rejects.toThrow(`${join(dir, 'PREREQUISITES-broken.md')}: cannot be read`);
  });

  it('carries a reader\'s warning without dropping an item', async () => {
    const warnHome = join(base, 'warn-home');
    write(join(warnHome, '.claude.json'), '{ not json');

    const reading = await readPlanNeeds(planPath, { ...seams(WITHOUT_USER), home: warnHome });

    expect(reading.warnings.map((warning) => warning.path)).toEqual([join(warnHome, '.claude.json')]);
    expect(needOf(reading, 'mcp', 'linear').status).toBe('present');
  });
});

describe('readSpecNeeds', () => {
  const specPath = join(base, 'specs', 'SPEC-demo.md');
  write(specPath, [
    '# Spec',
    '',
    'Route the review through project-reviewer.',
    'Its checks follow fence-skill, as fence-skill-v2 will later.',
    'Nothing here names the user-reviewers team.',
    '',
  ].join('\n'));

  it('marks each inventory name the text mentions as a whole word, at its first line', async () => {
    const reading = await readSpecNeeds(specPath, seams(WITHOUT_USER));

    expect(reading.items.map((item) => `${item.kind} ${item.name}`)).toEqual(['agent project-reviewer', 'skill fence-skill']);
    expect(needOf(reading, 'agent', 'project-reviewer')).toMatchObject({
      status: 'present', source: 'project', visibleToLoop: true, origins: [{ by: 'mentioned', line: 3 }],
    });
    expect(needOf(reading, 'skill', 'fence-skill').origins).toEqual([{ by: 'mentioned', line: 4 }]);
  });

  it('marks a user-only name the spec mentions as present and not visible to a run', async () => {
    const userSpec = join(base, 'specs', 'SPEC-user.md');
    write(userSpec, 'Hand it to user-reviewer.\n');

    const need = needOf(await readSpecNeeds(userSpec, seams(WITHOUT_USER)), 'agent', 'user-reviewer');

    expect(need).toMatchObject({ status: 'present', source: 'user', visibleToLoop: false });
  });

  it('refuses a spec that is not there, naming its path', async () => {
    const absent = join(base, 'specs', 'SPEC-none.md');

    await expect(readSpecNeeds(absent, seams(WITHOUT_USER))).rejects.toThrow(`${absent}: no such file`);
  });
});

describe('mcpServerOfTool', () => {
  it('takes the server segment up to the first double underscore', () => {
    expect(mcpServerOfTool('mcp__ghost__lookup')).toBe('ghost');
    expect(mcpServerOfTool('mcp__claude_ai_Linear__save_issue')).toBe('claude_ai_Linear');
    expect(mcpServerOfTool('mcp__bare')).toBe('bare');
  });

  it('answers null for a tool no MCP server provides', () => {
    expect(mcpServerOfTool('Read')).toBeNull();
    expect(mcpServerOfTool('mcp__')).toBeNull();
  });
});

describe('probePrograms', () => {
  it('reads each part\'s first word, past a negation and an assignment', () => {
    expect(probePrograms('gh auth status && ! LANG=C git diff --quiet | wc -l; jq . || true')).toEqual([
      'gh', 'git', 'wc', 'jq',
    ]);
  });

  it('reads the program a lookup asks after, and not the lookup', () => {
    expect(probePrograms('command -v ts-symbols')).toEqual(['ts-symbols']);
    expect(probePrograms('which bun && type -p node')).toEqual(['bun', 'node']);
  });

  it('reads no program from a builtin or a path', () => {
    expect(probePrograms('test -f package.json')).toEqual([]);
    expect(probePrograms('./scripts/check.sh')).toEqual([]);
  });
});

describe('fencePrograms', () => {
  it('answers the fence commands the checker reads, less the body\'s own functions', () => {
    expect(fencePrograms(skill('fence-skill', FENCE_BODY))).toEqual(['present-tool', 'fence-absent']);
  });

  it('reads no program from a shell fence holding another language\'s code', () => {
    expect(fencePrograms('```bash\nconst x = run();\nnode x.js\n```\n')).toEqual([]);
    expect(fencePrograms('```bash\nnode x.js\n```\n')).toEqual(['node']);
  });
});

describe('programDirectory', () => {
  it('answers the first directory holding an executable file of that name', () => {
    const second = join(base, 'bin-second');
    write(join(second, 'present-tool'), '#!/bin/sh\n');
    chmodSync(join(second, 'present-tool'), 0o755);

    expect(programDirectory('present-tool', [join(base, 'no-such-dir'), binDir, second])).toBe(binDir);
  });

  it('answers null for a file with no exec bit, and for a name no directory holds', () => {
    expect(programDirectory('not-executable', [binDir])).toBeNull();
    expect(programDirectory('zz-absent-program', [binDir])).toBeNull();
  });
});

/** Where a planted TypeScript project puts the skill naming `ts-symbols`. */
type SkillPlace = 'project' | 'user' | 'both' | 'none';

/** A TypeScript project under its own directory, and the seams and plan to read it with. */
function typescriptWorld(
  label: string,
  { onPath, skillAt }: { readonly onPath: boolean; readonly skillAt: SkillPlace },
): { readonly plan: string; readonly seams: (sources: readonly ClaudeSettingSource[]) => NeedsSeams } {
  const root = join(base, `ts-${label}`);
  const tsHome = join(root, 'home');
  const tsProject = join(root, 'project');
  const tsBin = join(root, 'bin');
  const plan = join(tsProject, '.rafa', 'plans', 'PLAN-ts.md');

  write(join(tsProject, 'tsconfig.json'), '{}\n');
  write(plan, '- [ ] One task {agent=project-reviewer}\n');
  write(join(tsProject, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
  mkdirSync(tsBin, { recursive: true });
  if (onPath) {
    write(join(tsBin, 'ts-symbols'), '#!/bin/sh\n');
    chmodSync(join(tsBin, 'ts-symbols'), 0o755);
  }
  const symbolSkill = skill('ts-symbols-for-agents', 'Trace a symbol with `ts-symbols refs <name>`, never grep.\n');
  if (skillAt === 'project' || skillAt === 'both') {
    write(join(tsProject, '.claude/skills/ts-symbols-for-agents/SKILL.md'), symbolSkill);
  }
  if (skillAt === 'user' || skillAt === 'both') {
    write(join(tsHome, '.claude/skills/ts-symbols-for-agents/SKILL.md'), symbolSkill);
  }
  write(join(tsProject, '.claude/skills/unrelated/SKILL.md'), skill('unrelated', 'Mentions ts-symbols-v2 only.\n'));

  return {
    plan,
    seams: (sources) => ({
      home: tsHome,
      projectRoot: tsProject,
      entry: join(runtime, 'cli.js'),
      pathDirs: [tsBin],
      settingSources: sources,
      modules: [],
    }),
  };
}

describe('the stack-tools table', () => {
  it('holds the TypeScript row, marked by tsconfig.json and naming ts-symbols', () => {
    expect(STACK_TOOLS.map((tool) => [tool.stack, tool.markers, tool.program])).toEqual([
      ['typescript', ['tsconfig.json'], 'ts-symbols'],
    ]);
  });

  it('reads ts-symbols on PATH and a project skill naming it as met', async () => {
    const world = typescriptWorld('present', { onPath: true, skillAt: 'project' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITHOUT_USER));

    const origin = { by: 'stack', stack: 'typescript' };
    expect(needOf(reading, 'program', 'ts-symbols')).toMatchObject({ status: 'present', origins: [origin] });
    expect(needOf(reading, 'skill', 'ts-symbols-for-agents')).toMatchObject({
      status: 'present', source: 'project', visibleToLoop: true, origins: [origin],
    });
    expect(reading.stacks).toEqual([{
      stack: 'typescript',
      marker: join(base, 'ts-present', 'project', 'tsconfig.json'),
      program: 'ts-symbols',
      skill: 'ts-symbols-for-agents',
      met: true,
      hint: null,
    }]);
    expect(reading.items.filter(isUnmet)).toEqual([]);
  });

  it('reads ts-symbols off PATH as missing, with a hint naming what to install', async () => {
    const world = typescriptWorld('missing', { onPath: false, skillAt: 'project' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITHOUT_USER));

    const program = needOf(reading, 'program', 'ts-symbols');
    expect(program).toMatchObject({ status: 'missing', directory: null });
    expect(isUnmet(program)).toBe(true);
    expect(reading.stacks[0]).toMatchObject({ met: false, skill: 'ts-symbols-for-agents' });
    expect(reading.stacks[0]?.hint).toBe(`typescript: ${STACK_TOOLS[0]?.install}`);
  });

  it('reads the skill present only at user level as present and not visible to a run', async () => {
    const world = typescriptWorld('user-skill', { onPath: true, skillAt: 'user' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITHOUT_USER));

    const need = needOf(reading, 'skill', 'ts-symbols-for-agents');
    expect(need).toMatchObject({ status: 'present', source: 'user', visibleToLoop: false });
    expect(isUnmet(need)).toBe(true);
    expect(reading.stacks[0]?.met).toBe(false);
    expect(reading.stacks[0]?.hint).toBe(
      'typescript: make the skill `ts-symbols-for-agents` (user source) visible to a run: '
      + 'move it under .claude/skills/ in this project, or add `user` to loop.settingSources',
    );
  });

  it('reads the same user-level skill as met once the user source is on', async () => {
    const world = typescriptWorld('user-skill-on', { onPath: true, skillAt: 'user' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITH_USER));

    expect(needOf(reading, 'skill', 'ts-symbols-for-agents')).toMatchObject({ source: 'user', visibleToLoop: true });
    expect(reading.stacks[0]).toMatchObject({ met: true, hint: null });
  });

  it('reads a project skill beside the user-level one as met', async () => {
    const world = typescriptWorld('both', { onPath: true, skillAt: 'both' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITHOUT_USER));

    expect(needOf(reading, 'skill', 'ts-symbols-for-agents')).toMatchObject({ source: 'project', visibleToLoop: true });
    expect(reading.stacks[0]).toMatchObject({ met: true, hint: null });
  });

  it('adds no skill item when no skill names ts-symbols as a whole word, and says so in the hint', async () => {
    const world = typescriptWorld('no-skill', { onPath: true, skillAt: 'none' });

    const reading = await readPlanNeeds(world.plan, world.seams(WITHOUT_USER));

    expect(reading.items.filter((item) => item.kind === 'skill')).toEqual([]);
    expect(reading.stacks[0]).toMatchObject({
      skill: null,
      met: false,
      hint: 'typescript: add a skill naming `ts-symbols` under .claude/skills/ in this project',
    });
  });

  it('reads no stack for a spec, even in a TypeScript project', async () => {
    const world = typescriptWorld('spec', { onPath: false, skillAt: 'none' });
    const spec = join(base, 'ts-spec', 'SPEC.md');
    write(spec, 'Route it through project-reviewer.\n');

    const reading = await readSpecNeeds(spec, world.seams(WITHOUT_USER));

    expect(reading.stacks).toEqual([]);
    expect(reading.items.map((item) => item.name)).toEqual(['project-reviewer']);
  });
});
