/**
 * Tests for `rafa plan needs` (`needs.ts`): the reading printed in both
 * modes, `--missing` over a plan with unmet needs and over one with
 * none, `--source`, a spec named by `--spec` and by `--issue`, the
 * default plan, the stack row, and the refusals.
 *
 * Each case dispatches in-process in a project of its own, beside a home
 * of its own, with `PATH` one directory of this file's own and the rafa
 * tier pointed at an empty directory, so no skill, agent or program of
 * this checkout or this machine is read. `--issue` resolves through a
 * planted route that records what it was handed, so no case reaches
 * GitHub.
 *
 * Every reading a case asserts sits beside a control that differs in
 * one thing: the user-only agent not visible under the default
 * `loop.settingSources` is held beside the same agent visible once
 * `user` is added, `--missing` refusing the planted plan beside it
 * printing nothing over a plan whose needs are all provided, and
 * `--source=project` dropping the user agent beside the full listing
 * holding it. The spawned end-to-end cases are
 * `src/tests/plan-needs.test.ts`'s.
 */
import type { PlanSpecOptions, PlanSpecResolution } from '../../board/plan-spec.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  createPlanNeedsCommand,
  labelOf,
  MET_MARK,
  needsPlanPath,
  originPhrase,
  originsPhrase,
  readNeedsSource,
  specRouteWords,
  UNMET_MARK,
} from './needs.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-needs-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** The `PATH` every case runs under: one directory holding `present-tool` alone. */
const BIN_DIR = join(tempBase, 'bin');

/** The rafa entry, beside which no `bundled/skills` or `bundled/agents` directory sits. */
const ENTRY = join(tempBase, 'rafa', 'cli.js');

/** The config a case wanting the user scope visible writes. */
const WITH_USER_CONFIG = 'version: 1\nloop:\n  settingSources: user, project, local\n';

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

write(ENTRY, '');
write(join(BIN_DIR, 'present-tool'), '#!/bin/sh\n');
chmodSync(join(BIN_DIR, 'present-tool'), 0o755);

/** An agent definition. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

/** A skill with no shell fence. */
function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Runs the gates in order\n---\n\nRun the gates.\n`;
}

/** The plan naming a project agent, a user-only agent, a missing skill, an MCP tool with no server and a missing program. */
const NEEDY_PLAN = [
  '# Plan',
  '',
  '- [ ] Review with the project agent {agent=project-reviewer}',
  '- [ ] Review with the user agent {agent=user-reviewer}',
  '- [ ] Use a skill {skills=absent-skill}',
  '- [ ] Ask a server {tools=mcp__ghost__lookup}',
  '',
].join('\n');

/** Its PREREQUISITES file: one program off `PATH`, one on it. */
const NEEDY_PREREQUISITES = [
  '# Prerequisites',
  '',
  '## Checks [auto]',
  '',
  '- [ ] The absent program answers: `zz-absent-program --version`',
  '- [ ] The present tool is on PATH: `command -v present-tool`',
  '',
].join('\n');

/** A plan whose every need this machine provides. */
const PROVIDED_PLAN = [
  '# Plan',
  '',
  '- [ ] Review with the project agent {agent=project-reviewer}',
  '- [ ] Use the project skill {skills=project-skill}',
  '',
].join('\n');

/** A project of this file's own, with the world above planted in it and `[path, text]` files under its root. */
function plantNeedsProject(
  files: readonly (readonly [string, string])[],
  config?: string,
): { root: string; home: string } {
  const project = plantProject(mkdtempSync(join(tempBase, 'scope-')), config);
  write(join(project.root, '.claude/agents/project-reviewer.md'), agent('project-reviewer'));
  write(join(project.root, '.claude/skills/project-skill/SKILL.md'), skill('project-skill'));
  write(join(project.home, '.claude/agents/user-reviewer.md'), agent('user-reviewer'));
  for (const [path, text] of files) write(join(project.root, path), text);
  return project;
}

/** The planted plan and its PREREQUISITES, under `plan.dir`. */
const NEEDY_FILES = [
  ['.rafa/plans/PLAN-demo.md', NEEDY_PLAN],
  ['.rafa/plans/PREREQUISITES-demo.md', NEEDY_PREREQUISITES],
] as const;

/** Dispatches `plan needs` with `words` in `project` through `command`. */
async function needsIn(
  project: { root: string; home: string },
  words: readonly string[],
  command: RafaCommand = createPlanNeedsCommand({ entry: () => ENTRY, modules: {} }),
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(['plan', 'needs', ...words], SUBJECTS, [command], project, { PATH: BIN_DIR });
}

/** The row of `name` in a text listing, failing the case when there is none. */
function rowOf(stdout: string, name: string): string {
  const row = stdout.split('\n').find((line) => line.split(/\s+/).includes(name));
  if (row === undefined) throw new Error(`no row for ${name} in:\n${stdout}`);
  return row;
}

/** An event as one string: `<level>:<message>` for a log, and its type for the rest. */
function labelOfEvent(event: CliEvent): string {
  return event.type === 'log'
    ? `${event.level}:${event.message}`
    : event.type;
}

describe('rafa plan needs, over a plan in text mode', () => {
  it('lists each need with its mark, where it was found, whether a run sees it and where it was named, and exits 0', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md']);
    const lines = run.stdout.split('\n');

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(lines[0]).toBe('Needs of plan .rafa/plans/PLAN-demo.md (loop.settingSources: project, local):');
    expect(rowOf(run.stdout, 'project-reviewer')).toMatch(new RegExp(`^  ${MET_MARK} agent +project-reviewer +project +visible to a run +task line 3$`));
    expect(rowOf(run.stdout, 'user-reviewer')).toMatch(new RegExp(`^  ${UNMET_MARK} agent +user-reviewer +user +not visible to a run +task line 4$`));
    expect(rowOf(run.stdout, 'absent-skill')).toMatch(new RegExp(`^  ${UNMET_MARK} skill +absent-skill +missing +task line 5$`));
    expect(rowOf(run.stdout, 'ghost')).toMatch(new RegExp(`^  ${UNMET_MARK} mcp +ghost +missing +task line 6$`));
    expect(rowOf(run.stdout, 'zz-absent-program')).toMatch(new RegExp(`^  ${UNMET_MARK} program +zz-absent-program +missing +prerequisite line 5$`));
    expect(rowOf(run.stdout, 'present-tool')).toMatch(new RegExp(`^  ${MET_MARK} program +present-tool +${BIN_DIR} +prerequisite line 6$`));
    expect(lines.slice(-2)).toEqual(['6 needs, 4 unmet (missing, or not visible to a run)', '']);
  });

  it('marks the user-only agent visible once loop.settingSources holds user, where the case above reads it hidden', async () => {
    const project = plantNeedsProject(NEEDY_FILES, WITH_USER_CONFIG);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md']);

    expect(run.exitCode).toBe(0);
    expect(rowOf(run.stdout, 'user-reviewer')).toMatch(new RegExp(`^  ${MET_MARK} agent +user-reviewer +user +visible to a run`));
  });

  it('reads the default plan in plan.dir when none is named', async () => {
    const project = plantNeedsProject([['.rafa/plans/PLAN.md', PROVIDED_PLAN]]);
    const run = await needsIn(project, []);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe('Needs of plan .rafa/plans/PLAN.md (loop.settingSources: project, local):');
  });
});

describe('rafa plan needs --missing', () => {
  it('lists only the unmet needs, then exits 1 with the refusal on stderr', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--missing']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('❌ .rafa/plans/PLAN-demo.md: 4 unmet needs; --missing refuses a reading with any\n');
    expect(run.stdout).toContain('user-reviewer');
    expect(run.stdout).toContain('absent-skill');
    expect(run.stdout).toContain('ghost');
    expect(run.stdout).toContain('zz-absent-program');
    expect(run.stdout).not.toContain('project-reviewer');
    expect(run.stdout).not.toContain('present-tool');
  });

  it('prints nothing and exits 0 over a plan whose every need is provided', async () => {
    const project = plantNeedsProject([['.rafa/plans/PLAN-ok.md', PROVIDED_PLAN]]);
    const run = await needsIn(project, ['.rafa/plans/PLAN-ok.md', '--missing']);

    expect(run).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('refuses the plan read as its value when typed ahead of it, exit 1', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['--missing', '.rafa/plans/PLAN-demo.md']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--missing takes no value');
    expect(run.stderr).toContain('Type the plan first: rafa plan needs <plan> --missing');
  });

  it('writes each unmet row as an error event and no result data in json mode, exit 1', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--missing', '--output=json']);
    const events = eventsOf(run.stdout);
    const errors = events.map(labelOfEvent).filter((label) => label.startsWith('error:'));

    expect(run.exitCode).toBe(1);
    expect(errors).toHaveLength(4);
    expect(errors.some((label) => /user-reviewer +user +not visible to a run/.test(label))).toBe(true);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    expect(result !== undefined && 'data' in result
      ? result.data
      : undefined).toBeUndefined();
  });
});

describe('rafa plan needs --source', () => {
  it('keeps the agents and skills one source holds, where the full listing holds the user agent too', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const full = await needsIn(project, ['.rafa/plans/PLAN-demo.md']);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--source=project']);
    const rows = run.stdout.split('\n').filter((line) => line.startsWith(`  ${MET_MARK}`) || line.startsWith(`  ${UNMET_MARK}`));

    expect(full.stdout).toContain('user-reviewer');
    expect(run.exitCode).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('project-reviewer');
  });

  it('refuses a source written as none, exit 1', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--source=everywhere']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ --source is "everywhere", expected one of: project, rafa, user, plugin:<name>, addon:<name>');
  });
});

describe('rafa plan needs, in json mode', () => {
  it('gives the reading as the terminal result\'s data, the unmet count included', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--output=json']);
    const result = eventsOf(run.stdout).at(-1);
    const data = result?.type === 'result'
      ? result.data as { target: { kind: string; label: string }; items: { kind: string; name: string }[]; unmet: number }
      : undefined;

    expect(run.exitCode).toBe(0);
    expect(data?.target).toMatchObject({ kind: 'plan', label: '.rafa/plans/PLAN-demo.md' });
    expect(data?.items.map((item) => `${item.kind} ${item.name}`)).toEqual([
      'agent project-reviewer',
      'agent user-reviewer',
      'skill absent-skill',
      'mcp ghost',
      'program present-tool',
      'program zz-absent-program',
    ]);
    expect(data?.unmet).toBe(4);
  });
});

describe('rafa plan needs, over a spec', () => {
  it('reads --spec under specs.dir and lists the inventory names it mentions, marked mentioned', async () => {
    const project = plantNeedsProject([['.rafa/specs/feature.md', '# Feature\n\nHand the diff to project-reviewer.\n']]);
    const run = await needsIn(project, ['--spec=feature.md']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe('Needs of spec .rafa/specs/feature.md (loop.settingSources: project, local):');
    expect(rowOf(run.stdout, 'project-reviewer')).toContain('mentioned line 3');
    expect(run.stdout).not.toContain('user-reviewer');
  });

  it('refuses a --spec found nowhere, exit 1', async () => {
    const project = plantNeedsProject([]);
    const run = await needsIn(project, ['--spec=nowhere.md']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Spec file not found:');
  });

  it('resolves --issue through plan create\'s route, handed no offer, and reads the spec it answers', async () => {
    const project = plantNeedsProject([['.rafa/specs/issue-42.md', 'Uses user-reviewer.\n']]);
    const handed: PlanSpecOptions[] = [];
    const command = createPlanNeedsCommand({
      entry: () => ENTRY,
      modules: {},
      route: {
        resolve: (options): Promise<PlanSpecResolution> => {
          handed.push(options);
          return Promise.resolve({
            outcome: 'spec',
            spec: { path: '.rafa/specs/issue-42.md', kind: 'issue', source: '#42', issue: 42, read: null, snapshot: null },
            gate: null,
          });
        },
      },
    });
    const run = await needsIn(project, ['--issue=42'], command);

    expect(run.exitCode).toBe(0);
    expect(handed.map((options) => [options.request, options.dryRun, options.offerReady, options.offerRefresh])).toEqual([
      [{ kind: 'issue', issue: 42 }, false, null, null],
    ]);
    expect(rowOf(run.stdout, 'user-reviewer')).toContain('mentioned line 1');
  });
});

describe('rafa plan needs, over a TypeScript project', () => {
  it('names the stack tool missing from PATH and exits 1 under --missing, where a project with no tsconfig.json has no stack row', async () => {
    const withStack = plantNeedsProject([['tsconfig.json', '{}\n'], ['.rafa/plans/PLAN-ok.md', PROVIDED_PLAN]]);
    const withoutStack = plantNeedsProject([['.rafa/plans/PLAN-ok.md', PROVIDED_PLAN]]);
    const run = await needsIn(withStack, ['.rafa/plans/PLAN-ok.md', '--missing']);
    const control = await needsIn(withoutStack, ['.rafa/plans/PLAN-ok.md', '--missing']);

    expect(run.exitCode).toBe(1);
    expect(rowOf(run.stdout, 'ts-symbols')).toMatch(new RegExp(`^  ${UNMET_MARK} program +ts-symbols +missing +stack typescript$`));
    expect(run.stdout).toContain(`  ${UNMET_MARK} stack typescript: install \`ts-symbols\``);
    expect(control).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });
});

describe('rafa plan needs, refusing the line', () => {
  it('refuses a plan beside --spec, exit 1', async () => {
    const project = plantNeedsProject(NEEDY_FILES);
    const run = await needsIn(project, ['.rafa/plans/PLAN-demo.md', '--spec=feature.md']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ .rafa/plans/PLAN-demo.md and --spec=feature.md each name what to read; give one');
  });

  it('refuses --spec beside --issue through the route\'s own refusal, exit 1', async () => {
    const project = plantNeedsProject([]);
    const run = await needsIn(project, ['--spec=feature.md', '--issue=4']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--spec and --issue each name a spec');
  });

  it('refuses a named plan that is no file, and no default plan, exit 1', async () => {
    const project = plantNeedsProject([]);
    const named = await needsIn(project, ['.rafa/plans/PLAN-none.md']);
    const unnamed = await needsIn(project, []);

    expect(named.exitCode).toBe(1);
    expect(named.stderr).toContain('❌ Plan file not found:');
    expect(unnamed.exitCode).toBe(1);
    expect(unnamed.stderr).toContain('❌ No plan named, and no default plan at');
  });
});

describe('the readers under the command', () => {
  it('hands --spec and --issue on as the route reads them, bare when given no value, and null for neither', () => {
    expect(specRouteWords({ spec: 'a.md' })).toEqual(['--spec=a.md']);
    expect(specRouteWords({ issue: '7' })).toEqual(['--issue=7']);
    expect(specRouteWords({ spec: true })).toEqual(['--spec']);
    expect(specRouteWords({ missing: true })).toBeNull();
  });

  it('labels a path under the root relative to it, and one outside it as given', () => {
    expect(labelOf('/p', '/p/.rafa/plans/PLAN.md')).toBe('.rafa/plans/PLAN.md');
    expect(labelOf('/p', '/elsewhere/PLAN.md')).toBe('/elsewhere/PLAN.md');
  });

  it('words each origin as a phrase', () => {
    expect([
      originPhrase({ by: 'task', line: 3 }),
      originPhrase({ by: 'prerequisite', line: 5 }),
      originPhrase({ by: 'skill', skill: 'gates' }),
      originPhrase({ by: 'mentioned', line: 2 }),
      originPhrase({ by: 'stack', stack: 'typescript' }),
    ]).toEqual(['task line 3', 'prerequisite line 5', 'skill gates', 'mentioned line 2', 'stack typescript']);
  });

  it('groups the origins of one kind in reading order, a lone one read as its own phrase', () => {
    expect(originsPhrase([
      { by: 'task', line: 3 },
      { by: 'skill', skill: 'gates' },
      { by: 'task', line: 9 },
      { by: 'skill', skill: 'lint' },
      { by: 'stack', stack: 'typescript' },
    ])).toBe('task lines 3, 9; skills gates, lint; stack typescript');
    expect(originsPhrase([{ by: 'prerequisite', line: 5 }])).toBe('prerequisite line 5');
  });

  it('reads --source as a source shape, null when absent, and refuses a bare flag', () => {
    expect(readNeedsSource(undefined)).toBeNull();
    expect(readNeedsSource('plugin:alpha')).toBe('plugin:alpha');
    expect(() => readNeedsSource(true)).toThrow(CommandExit);
  });

  it('refuses a default plan at neither place, naming both', () => {
    const root = mkdtempSync(join(tempBase, 'bare-'));
    expect(() => needsPlanPath(root, '.rafa/plans', null)).toThrow(`${join(root, '.rafa/plans/PLAN.md')} or ${join(root, 'PLAN.md')}`);
  });
});
