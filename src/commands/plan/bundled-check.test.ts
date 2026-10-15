/**
 * Tests for `src/commands/plan/bundled-check.ts`: the bundled items a
 * plan's still-to-run tasks edit, read against a project planted under a
 * temp root with its own `src/bundled/` and `.claude/` links, so no case
 * reads this checkout's bundle or this machine's `~/.claude`.
 *
 * Each case that answers nothing names, in the same plan or over the
 * same project, a path that does answer, so a reading that never looked
 * cannot pass for one that looked and found nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { findBundledEdits } from './bundled-check.js';

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
