/**
 * Tests for `src/commands/plan/bundled-check.ts`: the bundled items a
 * plan's still-to-run tasks edit, read against a project planted under a
 * temp root with its own `src/bundled/` and `.claude/` links, so no case
 * reads this checkout's bundle or this machine's `~/.claude`.
 *
 * `notePlanBundledEdits` is read over a `GeneratedPlan` whose plan IS on
 * disk under a planted project, as `store-check.test.ts` reads
 * `enforceStoreRules`, since the fixture planner `src/plan.test.ts`
 * resolves answers a path it never writes.
 *
 * Each case that answers nothing names, in the same plan or over the
 * same project, a path that does answer, so a reading that never looked
 * cannot pass for one that looked and found nothing.
 */
import type { BundledEdit } from './bundled-check.js';
import type { GeneratedPlan } from '@open-tomato/rafa/ports';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parsePrerequisites } from '@open-tomato/rafa/preflight/prerequisites-md';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findStoreRuleProblems } from '@open-tomato/rafa-run/plan/store-rules';

import { bundledEditLine, findBundledEdits, notePlanBundledEdits, writeTierPins } from './bundled-check.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-bundled-check-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** An agent definition carrying `name` in its frontmatter. */
function agentText(name: string): string {
  return `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\nBody.\n`;
}

/** A skill file carrying `name` in its frontmatter. */
function skillText(name: string): string {
  return `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
}

/**
 * A fresh project: two bundled agents and two bundled skills under
 * `src/bundled/`, a reference file deep in `dev-planner`, and under
 * `.claude/` a link to `doc-updater.md`, a plain `scout.md`, a dangling
 * `gone.md` and a link to the `dev-planner` folder.
 */
function plantProject(): string {
  const root = mkdtempSync(join(tempBase, 'project-'));
  const agents = join(root, 'src', 'bundled', 'agents');
  const skills = join(root, 'src', 'bundled', 'skills');
  mkdirSync(agents, { recursive: true });
  for (const name of ['doc-updater', 'loop-implementer']) writeFileSync(join(agents, `${name}.md`), agentText(name));
  for (const name of ['dev-planner', 'git-workflow']) {
    mkdirSync(join(skills, name, 'references'), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), skillText(name));
  }
  writeFileSync(join(skills, 'dev-planner', 'references', 'tasks.md'), 'Reference.\n');

  const claudeAgents = join(root, '.claude', 'agents');
  const claudeSkills = join(root, '.claude', 'skills');
  mkdirSync(claudeAgents, { recursive: true });
  mkdirSync(claudeSkills, { recursive: true });
  symlinkSync('../../src/bundled/agents/doc-updater.md', join(claudeAgents, 'doc-updater.md'));
  symlinkSync('../../src/bundled/agents/missing.md', join(claudeAgents, 'gone.md'));
  writeFileSync(join(claudeAgents, 'scout.md'), agentText('scout'));
  symlinkSync('../../src/bundled/skills/dev-planner', join(claudeSkills, 'dev-planner'));
  return root;
}

/** A plan of one stage whose checklist is `lines`. */
function planOf(...lines: string[]): string {
  return ['# Plan', '', '# Stage: one', '', ...lines, ''].join('\n');
}

/** The line, counting from one, of the first task line in {@link planOf}. */
const FIRST_TASK = 5;

const project = plantProject();

describe('findBundledEdits over a planted project', () => {
  it('names an agent file named directly, with the agents pin', () => {
    const plan = planOf('- [ ] Rewrite `src/bundled/agents/doc-updater.md` to read the changes fragment');

    expect(findBundledEdits(plan, { repoRoot: project })).toEqual([{
      kind: 'agent',
      name: 'doc-updater',
      path: 'src/bundled/agents/doc-updater.md',
      lines: [FIRST_TASK],
      pinLine: 'tiers.agents: { doc-updater: project }',
    }]);
  });

  it('names a skill folder named through its .claude/skills link, with the skills pin', () => {
    const plan = planOf('- [ ] Teach `.claude/skills/dev-planner` the bundled-item note');

    expect(findBundledEdits(plan, { repoRoot: project })).toEqual([{
      kind: 'skill',
      name: 'dev-planner',
      path: '.claude/skills/dev-planner',
      lines: [FIRST_TASK],
      pinLine: 'tiers.skills: { dev-planner: project }',
    }]);
  });

  it('names the skill a SKILL.md deep in a bundled skill belongs to, and a reference file beside it', () => {
    const plan = planOf(
      '- [ ] Edit `src/bundled/skills/git-workflow/SKILL.md` to name the pin',
      '- [ ] Edit `.claude/skills/dev-planner/references/tasks.md` for the same',
    );

    expect(findBundledEdits(plan, { repoRoot: project }).map(({ kind, name, lines }) => ({ kind, name, lines })))
      .toEqual([
        { kind: 'skill', name: 'git-workflow', lines: [FIRST_TASK] },
        { kind: 'skill', name: 'dev-planner', lines: [FIRST_TASK + 1] },
      ]);
  });

  it('answers nothing for a plan naming no bundled item, and the same plan with one such line answers it', () => {
    const none = [
      '- [ ] Add `src/commands/plan/bundled-check.ts` and run `bun test src/commands/plan/`',
      '- [ ] Read `src/bundled/skills/<name>/SKILL.md` and `~/.claude/agents/doc-updater.md` for the shape',
      '- [ ] Name `src/bundled/agents/missing.md`, which no file holds yet',
    ];

    expect(findBundledEdits(planOf(...none), { repoRoot: project })).toEqual([]);
    expect(findBundledEdits(planOf(...none, '- [ ] Edit `src/bundled/agents/loop-implementer.md`'), { repoRoot: project })
      .map(({ name }) => name)).toEqual(['loop-implementer']);
  });

  it('names every item of a root named whole, sorted by name, each with the path as typed', () => {
    const plan = planOf('- [ ] Sweep `src/bundled/agents/` and `src/bundled/skills` for the old pin wording');

    expect(findBundledEdits(plan, { repoRoot: project }).map(({ kind, name, path }) => ({ kind, name, path }))).toEqual([
      { kind: 'agent', name: 'doc-updater', path: 'src/bundled/agents/' },
      { kind: 'agent', name: 'loop-implementer', path: 'src/bundled/agents/' },
      { kind: 'skill', name: 'dev-planner', path: 'src/bundled/skills' },
      { kind: 'skill', name: 'git-workflow', path: 'src/bundled/skills' },
    ]);
  });

  it('names nothing for a plain file under .claude/agents/, where the linked file beside it is named', () => {
    const plan = planOf('- [ ] Edit `.claude/agents/scout.md` and `.claude/agents/doc-updater.md`');

    expect(findBundledEdits(plan, { repoRoot: project }).map(({ name, path }) => ({ name, path }))).toEqual([
      { name: 'doc-updater', path: '.claude/agents/doc-updater.md' },
    ]);
  });

  it('names nothing for a dangling link under .claude/agents/, where the live link beside it is named', () => {
    const plan = planOf('- [ ] Edit `.claude/agents/gone.md`', '- [ ] Edit `.claude/agents/doc-updater.md`');

    expect(findBundledEdits(plan, { repoRoot: project }).map(({ name, lines }) => ({ name, lines }))).toEqual([
      { name: 'doc-updater', lines: [FIRST_TASK + 1] },
    ]);
  });

  it('reads no ticked line, where the same text unticked and blocked is read', () => {
    const text = 'Rewrite `src/bundled/agents/doc-updater.md`';

    expect(findBundledEdits(planOf(`- [x] ${text}`), { repoRoot: project })).toEqual([]);
    expect(findBundledEdits(planOf(`- [ ] ${text}`), { repoRoot: project }).map(({ name }) => name))
      .toEqual(['doc-updater']);
    expect(findBundledEdits(planOf(`- [BLOCKED] ${text}`), { repoRoot: project }).map(({ name }) => name))
      .toEqual(['doc-updater']);
  });

  it('answers one edit for one name on two lines, under two spellings, with the first path typed and both lines', () => {
    const plan = planOf(
      '- [ ] Rewrite `src/bundled/agents/doc-updater.md`',
      '- [ ] Unrelated `src/plan.ts` change',
      '- [ ] Proofread `.claude/agents/doc-updater.md` and `src/bundled/agents/doc-updater.md` again',
    );

    expect(findBundledEdits(plan, { repoRoot: project })).toEqual([{
      kind: 'agent',
      name: 'doc-updater',
      path: 'src/bundled/agents/doc-updater.md',
      lines: [FIRST_TASK, FIRST_TASK + 2],
      pinLine: 'tiers.agents: { doc-updater: project }',
    }]);
  });

  it('answers nothing for a project with no bundle, where the planted project answers the same plan', () => {
    const bare = mkdtempSync(join(tempBase, 'bare-'));
    const plan = planOf('- [ ] Rewrite `src/bundled/agents/doc-updater.md`');

    expect(findBundledEdits(plan, { repoRoot: bare })).toEqual([]);
    expect(findBundledEdits(plan, { repoRoot: project })).toHaveLength(1);
  });
});

/** A pin edit for `name`, as {@link findBundledEdits} answers one. */
function pinEdit(kind: 'agent' | 'skill', name: string): BundledEdit {
  return {
    kind,
    name,
    path: `src/bundled/${kind}s/${name}`,
    lines: [FIRST_TASK],
    pinLine: `tiers.${kind}s: { ${name}: project }`,
  };
}

const PLAN_FILE = 'PLAN-rafa-1101-spec-plan-validate-names.md';

const EDITS = [pinEdit('agent', 'doc-updater'), pinEdit('skill', 'dev-planner')];

/** A fresh path in its own folder where no prerequisites file sits yet. */
function freshPrerequisitesPath(): string {
  return join(mkdtempSync(join(tempBase, 'prereq-')), 'PREREQUISITES-x.md');
}

describe('writeTierPins', () => {
  it('creates the file with its heading lines and one human item per edit, each with no probe', () => {
    const path = freshPrerequisitesPath();
    expect(existsSync(path)).toBe(false);

    expect(writeTierPins(path, PLAN_FILE, EDITS)).toEqual(EDITS);

    const text = readFileSync(path, 'utf8');
    expect(text.split('\n').slice(0, 3)).toEqual(['# Prerequisites', '', '## Tier pins [human]']);
    const items = parsePrerequisites(text);
    expect(items.map(({ tag, probe }) => ({ tag, probe }))).toEqual([
      { tag: 'human', probe: null },
      { tag: 'human', probe: null },
    ]);
    expect(items[0]?.description).toContain('`tiers.agents: { doc-updater: project }`');
    expect(items[0]?.description).toContain(PLAN_FILE);
    expect(items[1]?.description).toContain('`tiers.skills: { dev-planner: project }`');
  });

  it('changes nothing on a second call over the same edits, where a new edit is still written', () => {
    const path = freshPrerequisitesPath();
    writeTierPins(path, PLAN_FILE, EDITS);
    const first = readFileSync(path, 'utf8');

    expect(writeTierPins(path, PLAN_FILE, EDITS)).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(first);

    const added = pinEdit('agent', 'loop-implementer');
    expect(writeTierPins(path, PLAN_FILE, [...EDITS, added])).toEqual([added]);
    const items = parsePrerequisites(readFileSync(path, 'utf8'));
    expect(items).toHaveLength(3);
    expect(items[2]?.description).toContain('`tiers.agents: { loop-implementer: project }`');
  });

  it('writes one item for one pin handed twice in a call', () => {
    const path = freshPrerequisitesPath();
    const edit = pinEdit('agent', 'doc-updater');

    expect(writeTierPins(path, PLAN_FILE, [edit, edit])).toEqual([edit]);
    expect(parsePrerequisites(readFileSync(path, 'utf8'))).toHaveLength(1);
  });

  it('leaves an existing [auto] section untouched and adds the human section after it', () => {
    const path = freshPrerequisitesPath();
    const autoSection = [
      '# Prerequisites',
      '',
      '## Effort store [auto]',
      '- [ ] The installed rafa can read the live store: `rafa effort schema --check`',
      '',
    ].join('\n');
    writeFileSync(path, autoSection);

    writeTierPins(path, PLAN_FILE, EDITS);

    const text = readFileSync(path, 'utf8');
    expect(text.startsWith(autoSection)).toBe(true);
    const items = parsePrerequisites(text);
    expect(items.map(({ tag, probe }) => ({ tag, probe }))).toEqual([
      { tag: 'auto', probe: 'rafa effort schema --check' },
      { tag: 'human', probe: null },
      { tag: 'human', probe: null },
    ]);
  });

  it('writes under an existing Tier pins section, ahead of the section after it', () => {
    const path = freshPrerequisitesPath();
    writeFileSync(path, [
      '# Prerequisites',
      '',
      '## Tier pins [human]',
      '- [ ] Pin it: `tiers.agents: { doc-updater: project }`',
      '',
      '## Checks [auto]',
      '- [ ] Bun is installed: `bun --version`',
      '',
    ].join('\n'));

    expect(writeTierPins(path, PLAN_FILE, EDITS).map(({ name }) => name)).toEqual(['dev-planner']);

    const text = readFileSync(path, 'utf8');
    expect(text.match(/## Tier pins \[human\]/gu)).toHaveLength(1);
    expect(parsePrerequisites(text).map(({ tag, probe, description }) => ({ tag, probe, pin: description.includes('dev-planner') })))
      .toEqual([
        { tag: 'human', probe: null, pin: false },
        { tag: 'human', probe: null, pin: true },
        { tag: 'auto', probe: 'bun --version', pin: false },
      ]);
  });

  it('creates no file when there is nothing to write', () => {
    const path = freshPrerequisitesPath();

    expect(writeTierPins(path, PLAN_FILE, [])).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });
});

describe('findBundledEdits then writeTierPins over a planted project', () => {
  it('lands both pins in one file under one heading and leaves the store rules answering nothing', () => {
    const plan = planOf(
      '- [ ] Rewrite `src/bundled/agents/doc-updater.md` to read the changes fragment',
      '- [ ] Teach the planner in `.claude/skills/dev-planner` a new step',
    );
    const path = freshPrerequisitesPath();

    const edits = findBundledEdits(plan, { repoRoot: project });
    expect(edits.map(({ name }) => name).sort()).toEqual(['dev-planner', 'doc-updater']);
    expect(writeTierPins(path, PLAN_FILE, edits)).toHaveLength(2);

    const text = readFileSync(path, 'utf8');
    expect(text.match(/^## /gmu)).toEqual(['## ']);
    expect(text.match(/## Tier pins \[human\]/gu)).toHaveLength(1);
    expect(text).toContain('`tiers.agents: { doc-updater: project }`');
    expect(text).toContain('`tiers.skills: { dev-planner: project }`');
    expect(parsePrerequisites(text).map(({ tag, probe }) => ({ tag, probe }))).toEqual([
      { tag: 'human', probe: null },
      { tag: 'human', probe: null },
    ]);
    expect(findStoreRuleProblems({ plan, prerequisites: text, prerequisitesName: PLAN_FILE })).toEqual([]);
  });
});

describe('bundledEditLine', () => {
  it('names the file, every line, the item, the path as typed and the pin, where a one-line edit names one line', () => {
    const edit: BundledEdit = {
      kind: 'skill',
      name: 'dev-planner',
      path: '.claude/skills/dev-planner',
      lines: [5, 9],
      pinLine: 'tiers.skills: { dev-planner: project }',
    };

    expect(bundledEditLine('plans/PLAN-x.md', edit)).toBe(
      'plans/PLAN-x.md:5,9: a task edits the bundled skill `dev-planner` (`.claude/skills/dev-planner`);'
        + ' each clone that merges it needs the pin `tiers.skills: { dev-planner: project }`',
    );
    expect(bundledEditLine('plans/PLAN-x.md', { ...edit, lines: [5] })).toStartWith('plans/PLAN-x.md:5: a task');
  });
});

/** The plan `plan create` answers in {@link plantPlan}. */
const DEMO_PLAN = 'plans/PLAN-demo.md';

/** The prerequisites file beside {@link DEMO_PLAN}. */
const DEMO_PREREQUISITES = 'plans/PREREQUISITES-demo.md';

/** A plan editing the bundled agent `doc-updater`. */
const EDITING_PLAN = planOf('- [ ] Rewrite `src/bundled/agents/doc-updater.md` to read the changes fragment');

/** A fresh project holding {@link DEMO_PLAN} as `plan`, and {@link DEMO_PREREQUISITES} as `prerequisites` when given. */
function plantPlan(plan: string, prerequisites: string | null): { root: string; generated: GeneratedPlan } {
  const root = plantProject();
  mkdirSync(join(root, 'plans'));
  writeFileSync(join(root, DEMO_PLAN), plan);
  if (prerequisites !== null) writeFileSync(join(root, DEMO_PREREQUISITES), prerequisites);
  const prerequisitesPath = prerequisites === null
    ? null
    : DEMO_PREREQUISITES;
  return { root, generated: { planPath: DEMO_PLAN, prerequisitesPath } };
}

/** What `notePlanBundledEdits` answered over `generated` under `root`, with the lines it wrote. */
function note(root: string, generated: GeneratedPlan): { answered: GeneratedPlan; info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  const output = sinkOutput({ info: (line) => info.push(line), warn: (line) => warn.push(line) });
  return { answered: notePlanBundledEdits(root, generated, output), info, warn };
}

describe('notePlanBundledEdits over the plan rafa plan create generated', () => {
  it('writes the pin into the derived file when the planner answered none, naming it, and a second run adds nothing', () => {
    const { root, generated } = plantPlan(EDITING_PLAN, null);

    const first = note(root, generated);

    expect(first.info).toEqual([
      `ℹ️  ${DEMO_PLAN}:${FIRST_TASK}: a task edits the bundled agent \`doc-updater\``
        + ' (`src/bundled/agents/doc-updater.md`); each clone that merges it needs the pin'
        + ` \`tiers.agents: { doc-updater: project }\`, written to ${DEMO_PREREQUISITES} as a [human] prerequisite.`,
    ]);
    expect(first.warn).toEqual([]);
    expect(first.answered).toEqual({ planPath: DEMO_PLAN, prerequisitesPath: DEMO_PREREQUISITES });
    const text = readFileSync(join(root, DEMO_PREREQUISITES), 'utf8');
    expect(text).toStartWith('# Prerequisites\n');
    expect(parsePrerequisites(text).map(({ tag, probe, description }) => ({ tag, probe, description }))).toEqual([
      { tag: 'human', probe: null, description: expect.stringContaining('`tiers.agents: { doc-updater: project }`') },
    ]);

    const second = note(root, first.answered);

    expect(second.info).toHaveLength(1);
    expect(second.info[0]).toEndWith(`, already held by ${DEMO_PREREQUISITES}.`);
    expect(readFileSync(join(root, DEMO_PREREQUISITES), 'utf8')).toBe(text);
  });

  it('adds the pin to the prerequisites file the planner wrote and keeps its lines', () => {
    const planned = '# Prerequisites\n\n## Store [auto]\n'
      + '- [ ] The installed rafa can read and write the live store: `rafa effort schema --check`\n';
    const { root, generated } = plantPlan(EDITING_PLAN, planned);

    const { answered, info } = note(root, generated);

    expect(answered).toBe(generated);
    expect(info).toHaveLength(1);
    expect(info[0]).toEndWith(`, written to ${DEMO_PREREQUISITES} as a [human] prerequisite.`);
    const text = readFileSync(join(root, DEMO_PREREQUISITES), 'utf8');
    expect(text).toStartWith(planned);
    expect(parsePrerequisites(text).map(({ tag }) => tag)).toEqual(['auto', 'human']);
  });

  it('prints nothing and writes nothing for a plan naming no bundled item', () => {
    const { root, generated } = plantPlan(planOf('- [ ] Add a `plan_ci` column reader to the report'), null);

    const { answered, info, warn } = note(root, generated);

    expect(answered).toBe(generated);
    expect([...info, ...warn]).toEqual([]);
    expect(existsSync(join(root, DEMO_PREREQUISITES))).toBe(false);
  });

  it('returns quietly on a plan not on disk, where the same plan on disk is noted', () => {
    const { root, generated } = plantPlan(EDITING_PLAN, null);
    const absent: GeneratedPlan = { planPath: 'plans/PLAN-absent.md', prerequisitesPath: null };

    const { answered, info, warn } = note(root, absent);

    expect(answered).toBe(absent);
    expect([...info, ...warn]).toEqual([]);
    expect(existsSync(join(root, 'plans', 'PREREQUISITES-absent.md'))).toBe(false);
    expect(note(root, generated).info).toHaveLength(1);
  });
});
