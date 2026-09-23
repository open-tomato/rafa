/**
 * Tests for the risk reading's entry.
 *
 * Every project is planted under a fresh temporary directory: the
 * repository, the home and the entry the rafa skill tier sits beside,
 * so nothing here reads this checkout's agents or the machine's
 * skills. git and `gh` are planted runners that answer and record.
 *
 * Each "reports nothing" case stands beside one the same reader
 * reports on: a ticked task beside the same line open, a budgeted
 * `Bash` beside an unbudgeted one, a `--force-with-lease` and a prose
 * mention in the same file as the `--force` that is reported.
 */

import type { RiskFinding, RiskPlan, RiskReport, RiskSeams } from './risk.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/git.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { parsePlan } from './parse.js';
import {
  agentTools,
  assessPlanRisk,
  displayPath,
  EVERY_TOOL,
  openTasks,
  RISK_FOOTER,
  renderRiskText,
  riskTotal,
  riskTotalLine,
  taskAccess,
} from './risk.js';

/** The fence marker, spelled once so no line below nests one. */
const FENCE = '```';

/** The planted world one case reads. */
interface World {
  readonly root: string;
  readonly repoRoot: string;
  readonly home: string;
  readonly entry: string;
  readonly ghCalls: string[];
}

let world: World;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'rafa-risk-'));
  const repoRoot = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  world = { root, repoRoot, home, entry: join(root, 'rafa', 'cli.js'), ghCalls: [] };
});

afterEach(() => {
  rmSync(world.root, { recursive: true, force: true });
});

/** Writes `text` at `path`, making its directory. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** An agent definition's text: frontmatter naming it, then `body`. */
function agentText(name: string, extra: readonly string[], body = ''): string {
  return ['---', `name: ${name}`, 'description: planted', ...extra, '---', '', body].join('\n');
}

/** Plants an agent definition under `root`'s `.claude/agents/`. */
function plantAgent(root: string, name: string, extra: readonly string[], body = ''): string {
  const path = join(root, '.claude', 'agents', `${name}.md`);
  plant(path, agentText(name, extra, body));
  return path;
}

/** Plants a skill's `SKILL.md` under a skills directory. */
function plantSkill(skillsDir: string, name: string, body: string): string {
  const path = join(skillsDir, name, 'SKILL.md');
  plant(path, ['---', `name: ${name}`, 'description: planted', '---', '', body].join('\n'));
  return path;
}

/** A plan holding `lines` under one stage. */
function planOf(lines: readonly string[]): RiskPlan {
  return { path: join(world.repoRoot, 'PLAN.md'), text: ['# Plan: planted', '', '# Stage: one', '', ...lines, ''].join('\n') };
}

/** The 1-based line `needle` first sits on in `text`. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`not planted: ${needle}`);
  return index + 1;
}

/** git with no `origin`, and `gh` that fails every call and records it. */
function seams(overrides: Partial<RiskSeams> = {}): RiskSeams {
  const git: GitRunner = () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' });
  const gh: GhRunner = (args) => {
    world.ghCalls.push(args.join(' '));
    return Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' });
  };
  return {
    repoRoot: world.repoRoot,
    home: world.home,
    settingSources: ['project', 'local'],
    environment: {},
    accounts: { prProvider: null, trackerDefault: 'markdown', trackerFallback: [] },
    runners: { git, gh },
    entry: world.entry,
    ...overrides,
  };
}

/** The findings of one kind. */
function ofKind(report: RiskReport, kind: RiskFinding['kind']): readonly RiskFinding[] {
  return report.findings.filter((finding) => finding.kind === kind);
}

describe('agentTools', () => {
  it('reads a comma list', () => {
    expect(agentTools({ tools: 'Read, Bash ,Grep' })).toEqual(['Read', 'Bash', 'Grep']);
  });

  it('reads a YAML list', () => {
    expect(agentTools({ tools: ['Read', 'Bash'] })).toEqual(['Read', 'Bash']);
  });

  it('answers null for no tools: line, and for one naming no tool', () => {
    expect(agentTools({ name: 'x' })).toBeNull();
    expect(agentTools({ tools: '' })).toBeNull();
    expect(agentTools({ tools: [] })).toBeNull();
  });
});

describe('taskAccess', () => {
  it('gives every tool to an agent whose definition has no tools: line', () => {
    plantAgent(world.repoRoot, 'open-agent', ['model: opus']);
    const declaration = parsePlan(planOf(['- [ ] Do it  {agent=open-agent}']).text).tasks[0]?.declaration ?? null;

    const access = taskAccess(declaration, seams());

    expect(access.tools).toBeNull();
    expect(access.source).toBe('agent=open-agent has no tools: line');
    expect(access.model).toBe('opus');
  });

  it('gives every tool to an agent no definition answers for', () => {
    const declaration = parsePlan(planOf(['- [ ] Do it  {agent=ghost}']).text).tasks[0]?.declaration ?? null;

    const access = taskAccess(declaration, seams());

    expect(access.tools).toBeNull();
    expect(access.source).toBe('agent=ghost resolves to no definition');
  });

  it('takes an agent\'s tools: line over the task\'s own tools=', () => {
    plantAgent(world.repoRoot, 'reader', ['tools: Read, Grep']);
    const declaration = parsePlan(planOf(['- [ ] Do it  {agent=reader tools=Bash budget=2}']).text).tasks[0]?.declaration ?? null;

    const access = taskAccess(declaration, seams());

    expect(access.tools).toEqual(['Read', 'Grep']);
    expect(access.budget).toBe(2);
  });

  it('takes the task\'s tools= with no agent, and every tool with neither', () => {
    const declared = parsePlan(planOf(['- [ ] Do it  {tools=Read,Bash model=sonnet}']).text).tasks[0]?.declaration ?? null;

    expect(taskAccess(declared, seams())).toEqual({ tools: ['Read', 'Bash'], source: 'tools=', model: 'sonnet', budget: null });
    expect(taskAccess(null, seams()).tools).toBeNull();
  });

  it('reads a home agent only when the setting sources hold user', () => {
    plantAgent(world.home, 'homebody', ['tools: Read']);
    const declaration = parsePlan(planOf(['- [ ] Do it  {agent=homebody}']).text).tasks[0]?.declaration ?? null;

    expect(taskAccess(declaration, seams({ settingSources: ['user', 'project', 'local'] })).tools).toEqual(['Read']);
    expect(taskAccess(declaration, seams()).source).toBe('agent=homebody resolves to no definition');
  });
});

describe('openTasks', () => {
  it('keeps unchecked and blocked lines, the blocked one because the dispatcher resumes it first', () => {
    const model = parsePlan(planOf(['- [x] Ran', '- [ ] Waits', '- [BLOCKED] Stuck']).text);

    expect(openTasks(model.tasks, model.hiddenTasks).map((task) => task.text)).toEqual(['Waits', 'Stuck']);
  });
});

describe('assessPlanRisk: what each task may use', () => {
  it('reports an agent with no tools: line as a high every tool, with the task and its line', async () => {
    plantAgent(world.repoRoot, 'open-agent', []);
    const plan = planOf(['- [ ] Build the thing  {agent=open-agent}']);

    const report = await assessPlanRisk(plan, seams());

    expect(ofKind(report, 'tools')).toEqual([{
      level: 'high',
      kind: 'tools',
      text: `${EVERY_TOOL} — agent=open-agent has no tools: line; model the session default; no budget=`,
      task: 'Build the thing',
      file: 'PLAN.md',
      line: lineOf(plan.text, 'Build the thing'),
    }]);
  });

  it('reads no ticked task: the same line open is reported', async () => {
    const done = await assessPlanRisk(planOf(['- [x] Built  {agent=ghost}']), seams());
    const open = await assessPlanRisk(planOf(['- [ ] Built  {agent=ghost}']), seams());

    expect(ofKind(done, 'tools')).toEqual([]);
    expect(ofKind(open, 'tools').map((finding) => finding.level)).toEqual(['high']);
  });

  it('notes Bash with no budget=, and says nothing once a budget is declared', async () => {
    const unbudgeted = await assessPlanRisk(planOf(['- [ ] Run it  {tools=Read,Bash}']), seams());
    const budgeted = await assessPlanRisk(planOf(['- [ ] Run it  {tools=Read,Bash budget=3}']), seams());

    expect(ofKind(unbudgeted, 'tools').map((finding) => [finding.level, finding.text])).toEqual([
      ['note', 'Bash with no budget= — tools=: Read, Bash; model the session default'],
    ]);
    expect(ofKind(budgeted, 'tools')).toEqual([]);
  });

  it('notes an agent whose tools: line holds a ruled Bash', async () => {
    plantAgent(world.repoRoot, 'gitter', ['tools: ["Read", "Bash(git *)"]', 'model: haiku']);

    const report = await assessPlanRisk(planOf(['- [ ] Commit  {agent=gitter}']), seams());

    expect(ofKind(report, 'tools').map((finding) => [finding.level, finding.text])).toEqual([
      ['note', 'Bash with no budget= — agent=gitter: Read, Bash(git *); model haiku'],
    ]);
  });

  it('reports nothing for a narrow tool set', async () => {
    const report = await assessPlanRisk(planOf(['- [ ] Read it  {tools=Read,Grep}']), seams());

    expect(ofKind(report, 'tools')).toEqual([]);
  });
});

describe('assessPlanRisk: commands', () => {
  it('reports a skill fence\'s git push --force with file and line, and neither --force-with-lease nor prose', async () => {
    const body = [
      'Never git push --force in a sentence.',
      '',
      `${FENCE}bash`,
      'git push --force-with-lease origin main',
      'git push --force origin main',
      FENCE,
    ].join('\n');
    const path = plantSkill(join(world.repoRoot, '.claude', 'skills'), 'ship', body);
    const text = await Bun.file(path).text();

    const report = await assessPlanRisk(planOf(['- [ ] Ship it  {tools=Read skills=ship}']), seams());

    expect(ofKind(report, 'destructive')).toEqual([{
      level: 'high',
      kind: 'destructive',
      text: 'git push --force — git push --force origin main',
      file: '.claude/skills/ship/SKILL.md',
      line: lineOf(text, 'git push --force origin'),
    }]);
  });

  it('takes a skill from the first tier holding it: project, then rafa, then user', async () => {
    const force = `${FENCE}bash\ngit push --force\n${FENCE}`;
    const reset = `${FENCE}bash\ngit reset --hard\n${FENCE}`;
    const clean = `${FENCE}bash\ngit clean -fd\n${FENCE}`;
    plantSkill(join(world.root, 'rafa', 'skills'), 'both', force);
    plantSkill(join(world.home, '.claude', 'skills'), 'both', reset);
    plantSkill(join(world.home, '.claude', 'skills'), 'mine', clean);

    const report = await assessPlanRisk(planOf(['- [ ] Go  {tools=Read skills=both,mine,absent}']), seams());

    expect(ofKind(report, 'destructive').map((finding) => [finding.text, finding.file])).toEqual([
      ['git push --force — git push --force', join(world.root, 'rafa', 'skills', 'both', 'SKILL.md')],
      ['git clean -f — git clean -fd', '~/.claude/skills/mine/SKILL.md'],
    ]);
  });

  it('reads an agent file\'s fences once however many tasks name it', async () => {
    const path = plantAgent(world.repoRoot, 'wiper', ['tools: Bash'], `${FENCE}sh\nrm -rf build\n${FENCE}`);
    const text = await Bun.file(path).text();

    const report = await assessPlanRisk(planOf(['- [ ] One  {agent=wiper budget=1}', '- [ ] Two  {agent=wiper budget=1}']), seams());

    expect(ofKind(report, 'destructive').map((finding) => [finding.text, finding.file, finding.line])).toEqual([
      ['rm -rf — rm -rf build', '.claude/agents/wiper.md', lineOf(text, 'rm -rf build')],
    ]);
  });

  it('reads a task line\'s code spans and not its prose', async () => {
    const plan = planOf(['- [ ] Clean with `rm -rf dist` but never rm -rf / in prose  {tools=Read}']);

    const report = await assessPlanRisk(plan, seams());

    expect(ofKind(report, 'destructive')).toEqual([{
      level: 'high',
      kind: 'destructive',
      text: 'rm -rf — rm -rf dist',
      task: 'Clean with `rm -rf dist` but never rm -rf / in prose',
      file: 'PLAN.md',
      line: lineOf(plan.text, 'Clean with'),
    }]);
  });

  it('reads the plan\'s own shell fences and not a code span in its rafa blocks', async () => {
    const plan = planOf([
      `${FENCE}rafa:context`,
      'Never run `sudo rm -rf /` here.',
      FENCE,
      '',
      `${FENCE}bash`,
      'npm publish',
      FENCE,
    ]);

    const report = await assessPlanRisk(plan, seams());

    expect(ofKind(report, 'destructive').map((finding) => [finding.text, finding.line])).toEqual([
      ['npm publish — npm publish', lineOf(plan.text, 'npm publish')],
    ]);
  });

  it('reports a write outside the repository as high and a mention as a note', async () => {
    const plan = planOf([`${FENCE}bash`, 'cp dist/cli ~/bin/rafa', 'cat /etc/hosts', FENCE]);

    const report = await assessPlanRisk(plan, seams());

    expect(ofKind(report, 'outside-path').map((finding) => [finding.level, finding.text])).toEqual([
      ['high', '~/bin/rafa — written by cp dist/cli ~/bin/rafa'],
      ['note', '/etc/hosts — named in cat /etc/hosts'],
    ]);
  });
});

describe('assessPlanRisk: accounts and secrets', () => {
  it('always carries the four account notes', async () => {
    const report = await assessPlanRisk(planOf([]), seams());

    expect(ofKind(report, 'account').map((finding) => finding.level)).toEqual(['note', 'note', 'note', 'note']);
    expect(ofKind(report, 'account')[0]?.text).toBe('push remote: no origin remote, so the loop\'s push would fail');
  });

  it('names FAKE_TOKEN and carries abc123 nowhere, in the report, its json or its text', async () => {
    const report = await assessPlanRisk(planOf([]), seams({ environment: { FAKE_TOKEN: 'abc123', PATH: '/bin' } }));
    const json = JSON.stringify(report);
    const text = renderRiskText(report);

    expect(ofKind(report, 'secret').map((finding) => [finding.level, finding.text])).toEqual([
      ['note', 'FAKE_TOKEN — matches *_TOKEN'],
    ]);
    expect(json).toContain('FAKE_TOKEN');
    expect(text).toContain('FAKE_TOKEN');
    expect(json).not.toContain('abc123');
    expect(text).not.toContain('abc123');
  });
});

describe('assessPlanRisk: the report', () => {
  it('orders findings by kind and totals them by level', async () => {
    plantAgent(world.repoRoot, 'open-agent', [], `${FENCE}bash\nsudo make install\n${FENCE}`);

    const report = await assessPlanRisk(
      planOf(['- [ ] Go  {agent=open-agent}']),
      seams({ environment: { API_KEY: 'x' } }),
    );

    expect(report.findings.map((finding) => finding.kind)).toEqual([
      'tools', 'destructive', 'account', 'account', 'account', 'account', 'secret',
    ]);
    expect(report.total).toEqual({ high: 2, note: 5 });
    expect(report.plan).toBe('PLAN.md');
  });

  it('asks gh nothing when no tracker or provider files through it', async () => {
    await assessPlanRisk(planOf([]), seams());

    expect(world.ghCalls).toEqual([]);
  });
});

describe('riskTotal', () => {
  it('counts each level', () => {
    const findings: RiskFinding[] = [
      { level: 'high', kind: 'tools', text: 'a' },
      { level: 'note', kind: 'secret', text: 'b' },
      { level: 'note', kind: 'account', text: 'c' },
    ];

    expect(riskTotal(findings)).toEqual({ high: 1, note: 2 });
  });
});

describe('riskTotalLine', () => {
  it('reads as the spec spells it', () => {
    expect(riskTotalLine({ plan: '.rafa/plans/PLAN-x.md', total: { high: 2, note: 6 } }))
      .toBe('🛡  Risk: 2 high, 6 notes — rafa plan risk .rafa/plans/PLAN-x.md');
  });

  it('says one note in the singular', () => {
    expect(riskTotalLine({ plan: 'P.md', total: { high: 0, note: 1 } })).toBe('🛡  Risk: 0 high, 1 note — rafa plan risk P.md');
  });
});

describe('renderRiskText', () => {
  const report: RiskReport = {
    plan: 'PLAN.md',
    total: { high: 1, note: 1 },
    findings: [
      { level: 'note', kind: 'secret', text: 'GH_TOKEN — matches *_TOKEN' },
      { level: 'high', kind: 'destructive', text: 'sudo — sudo x', file: 'a/SKILL.md', line: 4 },
    ],
  };

  it('prints high before note, each finding with its place, then the total and the footer', () => {
    expect(renderRiskText(report).split('\n')).toEqual([
      'Risk reading of PLAN.md',
      '',
      'high (1)',
      '  destructive   sudo — sudo x',
      '                a/SKILL.md:4',
      '',
      'note (1)',
      '  secret        GH_TOKEN — matches *_TOKEN',
      '',
      '🛡  Risk: 1 high, 1 note — rafa plan risk PLAN.md',
      RISK_FOOTER,
    ]);
  });

  it('says none for an empty level and cuts a long task short', () => {
    const task = 'x'.repeat(100);
    const text = renderRiskText({
      plan: 'P.md',
      total: { high: 0, note: 1 },
      findings: [{ level: 'note', kind: 'tools', text: 'Bash with no budget=', task, file: 'P.md', line: 3 }],
    });

    expect(text).toContain('high (0)\n  none\n');
    expect(text).toContain(`P.md:3 — ${'x'.repeat(71)}…`);
    expect(text).not.toContain(task);
  });
});

describe('displayPath', () => {
  it('shows a repository path relative, a home path under ~ and anything else absolute', () => {
    const roots = { repoRoot: '/home/dev/repo', home: '/home/dev' };

    expect(displayPath('/home/dev/repo/.claude/agents/a.md', roots)).toBe('.claude/agents/a.md');
    expect(displayPath('PLAN.md', roots)).toBe('PLAN.md');
    expect(displayPath('/home/dev/.claude/skills/s/SKILL.md', roots)).toBe('~/.claude/skills/s/SKILL.md');
    expect(displayPath('/opt/rafa/skills/s/SKILL.md', roots)).toBe('/opt/rafa/skills/s/SKILL.md');
  });
});
