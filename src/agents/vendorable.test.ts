/**
 * Tests for the vendorable-agent scan `rafa init` warns from
 * (`vendorable.ts`).
 *
 * Every case plants its own `repo`, `home` and `plan.dir` under this
 * file's temporary directory, and the first case asserts the plan path
 * it answers resolves there: the second root is the real home in the
 * loop, and a case that lost a root would read this machine's
 * `~/.claude/agents` and pass on whatever it holds.
 *
 * The claim under test is a narrowing — only a missing name the home
 * defines is answered — so each narrowing case carries the control that
 * makes it fail: the same plan under the same roots with the one fact
 * changed (the definition present, the sources naming `user`, the task
 * ticked) answers the other way. A name the rafa tier holds is answered
 * neither served nor under `tiers.rafa: off`, and its control is a name
 * rafa does not ship, planted in the same home and answered. Each world
 * carries a rafa entry of its own, so the checkout's `src/bundled/agents`
 * is never the rafa tier a case reads.
 */
import type { ClaudeSettingSource } from '../config.js';
import type { TierSettings } from '../tiers/resolve.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config.js';

import { VENDOR_COMMAND } from './roster.js';
import { vendorableAgentLine, vendorableAgents, vendorableAgentWarnings } from './vendorable.js';

/** The sources a run with no config resolves to, leaving the user scope out. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];

/** Sources naming the user scope, so a home definition resolves. */
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Where `plan.dir` sits under a root, as the config's default has it. */
const PLAN_DIR = join('.rafa', 'plans');

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-vendorable-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** One case's world: a repo root, a home, a rafa entry, and nothing written yet. */
interface World {
  readonly repoRoot: string;
  readonly home: string;
  /** The entry whose `bundled/agents` is the rafa tier, so the checkout's own is never read. */
  readonly entry: string;
}

/** A fresh world under this file's temporary directory. */
function freshWorld(): World {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  return { repoRoot: join(base, 'repo'), home: join(base, 'home'), entry: join(base, 'dist', 'cli.js') };
}

/** Writes `<root>/.claude/agents/<name>.md` carrying that frontmatter `name`. */
function plantAgent(root: string, name: string): void {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), ['---', `name: ${name}`, '---', 'Body.', ''].join('\n'), 'utf8');
}

/** Writes `<repoRoot>/<PLAN_DIR>/<file>` with `lines`, and answers its path. */
function plantPlan(world: World, file: string, lines: readonly string[]): string {
  const dir = join(world.repoRoot, PLAN_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, [...lines, ''].join('\n'), 'utf8');
  return path;
}

/** The config defaults' tier settings under `sources`, with `changes` over them. */
function settingsFor(sources: readonly ClaudeSettingSource[], changes: Partial<TierSettings> = {}): TierSettings {
  return {
    settingSources: sources,
    tiersRafa: CONFIG_DEFAULTS.tiersRafa,
    tiersSkills: CONFIG_DEFAULTS.tiersSkills,
    tiersAgents: CONFIG_DEFAULTS.tiersAgents,
    ...changes,
  };
}

/** The scan's answer for `world` under `sources`. */
function scan(world: World, sources: readonly ClaudeSettingSource[] = WITHOUT_USER, changes: Partial<TierSettings> = {}) {
  return vendorableAgents({
    repoRoot: world.repoRoot,
    home: world.home,
    entry: world.entry,
    planDir: PLAN_DIR,
    settings: settingsFor(sources, changes),
  });
}

describe('vendorableAgents', () => {
  it('answers an agent a plan names that only the home defines, with its vendor command', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    const plan = plantPlan(world, 'PLAN.md', ['- [ ] Write the module {agent=tdd-guide}']);

    expect(scan(world)).toEqual([
      { plan, name: 'tdd-guide', lines: [1], fix: `${VENDOR_COMMAND} tdd-guide` },
    ]);
    expect(plan.startsWith(tempBase)).toBe(true);
  });

  it('says nothing about a name no user definition carries', () => {
    const world = freshWorld();
    plantPlan(world, 'PLAN.md', ['- [ ] Write the module {agent=ghost-agent}']);

    expect(scan(world)).toEqual([]);

    plantAgent(world.home, 'ghost-agent');
    expect(scan(world).map((agent) => agent.name)).toEqual(['ghost-agent']);
  });

  it('says nothing when the project defines the name itself', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantAgent(world.repoRoot, 'tdd-guide');
    plantPlan(world, 'PLAN.md', ['- [ ] Write the module {agent=tdd-guide}']);

    expect(scan(world)).toEqual([]);
    expect(scan({ ...world, repoRoot: join(world.repoRoot, 'elsewhere') })).toEqual([]);
  });

  it('says nothing about a name the rafa tier holds, served or unloaded by tiers.rafa: off', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantAgent(world.home, 'rust-reviewer');
    const bundled = join(world.entry, '..', 'bundled', 'agents');
    mkdirSync(bundled, { recursive: true });
    writeFileSync(
      join(bundled, 'tdd-guide.md'),
      ['---', 'name: tdd-guide', 'description: Writes the tests first.', '---', 'Body.', ''].join('\n'),
      'utf8',
    );
    plantPlan(world, 'PLAN.md', [
      '- [ ] Write the module {agent=tdd-guide}',
      '- [ ] Review the crate {agent=rust-reviewer}',
    ]);

    expect(scan(world).map((agent) => agent.name)).toEqual(['rust-reviewer']);
    expect(scan(world, WITHOUT_USER, { tiersRafa: 'off' }).map((agent) => agent.fix)).toEqual([`${VENDOR_COMMAND} rust-reviewer`]);
  });

  it('says nothing when the sources load the user scope, where the name resolves', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantPlan(world, 'PLAN.md', ['- [ ] Write the module {agent=tdd-guide}']);

    expect(scan(world, WITH_USER)).toEqual([]);
    expect(scan(world, WITHOUT_USER).map((agent) => agent.name)).toEqual(['tdd-guide']);
  });

  it('reads a blocked task and passes over a ticked one', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantPlan(world, 'PLAN.md', [
      '- [x] Done already {agent=tdd-guide}',
      '- [BLOCKED] Still to run {agent=tdd-guide}',
    ]);

    expect(scan(world)).toMatchObject([{ name: 'tdd-guide', lines: [2] }]);
  });

  it('answers each plan under plan.dir, sorted by file name, and no subdirectory', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantAgent(world.home, 'code-reviewer');
    plantPlan(world, 'b-plan.md', ['- [ ] Second {agent=code-reviewer}']);
    plantPlan(world, 'a-plan.md', ['- [ ] First {agent=tdd-guide}']);
    plantPlan(world, 'notes.txt', ['- [ ] Not markdown {agent=tdd-guide}']);
    const nested = join(world.repoRoot, PLAN_DIR, 'old');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'c-plan.md'), '- [ ] Nested {agent=tdd-guide}\n', 'utf8');

    expect(scan(world).map((agent) => [agent.plan, agent.name])).toEqual([
      [join(world.repoRoot, PLAN_DIR, 'a-plan.md'), 'tdd-guide'],
      [join(world.repoRoot, PLAN_DIR, 'b-plan.md'), 'code-reviewer'],
    ]);
  });

  it('answers nothing, and throws nothing, for a plan.dir that is not there', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');

    expect(scan(world)).toEqual([]);
  });

  it('takes an absolute plan.dir as it is', () => {
    const world = freshWorld();
    plantAgent(world.home, 'tdd-guide');
    plantPlan(world, 'PLAN.md', ['- [ ] Write the module {agent=tdd-guide}']);
    const absolute = join(world.repoRoot, PLAN_DIR);

    const found = vendorableAgents({
      repoRoot: world.repoRoot,
      home: world.home,
      entry: world.entry,
      planDir: absolute,
      settings: settingsFor(WITHOUT_USER),
    });

    expect(found.map((agent) => agent.plan)).toEqual([join(absolute, 'PLAN.md')]);
  });
});

describe('vendorableAgentLine', () => {
  it('shows the plan under the root, its lines and the fix', () => {
    const line = vendorableAgentLine(
      { plan: '/repo/.rafa/plans/PLAN.md', name: 'tdd-guide', lines: [4, 9], fix: `${VENDOR_COMMAND} tdd-guide` },
      '/repo',
    );

    expect(line).toBe('.rafa/plans/PLAN.md (lines 4, 9) routes to agent "tdd-guide",'
      + ' which resolves only in ~/.claude/agents: run `rafa agent vendor tdd-guide`');
  });

  it('leaves a plan outside the root absolute, and words one line as one', () => {
    const line = vendorableAgentLine(
      { plan: '/elsewhere/PLAN.md', name: 'tdd-guide', lines: [4], fix: `${VENDOR_COMMAND} tdd-guide` },
      '/repo',
    );

    expect(line.startsWith('/elsewhere/PLAN.md (line 4) routes to')).toBe(true);
  });
});

describe('vendorableAgentWarnings', () => {
  it('writes no line at all when nothing is vendorable', () => {
    expect(vendorableAgentWarnings([], '/repo')).toEqual([]);
  });

  it('heads the lines with the vendor command and indents one line per use', () => {
    const lines = vendorableAgentWarnings(
      [{ plan: '/repo/.rafa/plans/PLAN.md', name: 'tdd-guide', lines: [4], fix: `${VENDOR_COMMAND} tdd-guide` }],
      '/repo',
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`\`${VENDOR_COMMAND} <name>\``);
    expect(lines[0]).toContain('1 agent use(s)');
    expect(lines[1]).toBe('  .rafa/plans/PLAN.md (line 4) routes to agent "tdd-guide",'
      + ' which resolves only in ~/.claude/agents: run `rafa agent vendor tdd-guide`');
  });
});
