/**
 * An integration test for `assessPlanRisk` (`src/plan/risk.ts`) over a
 * planted project on real disk: a real agent definition, a real skill's
 * `SKILL.md`, and a real plan file, read through the actual seams
 * (`parsePlan`, `findAgentDefinition`, `resolveSkillTiers`,
 * `readBodyCommands`) rather than through fixtures handed to a single
 * pure module. Each pure reading (patterns, commands, secrets,
 * accounts) has its own unit tests beside its module; this file is the
 * SEAM across them: one project, one `assessPlanRisk` call, the
 * findings a real run would print.
 *
 * The project plants two things at once, so the case proves both the
 * positive and the negative it sits beside:
 *
 * - An agent with no `tools:` line, named by an open task: reported
 *   `high`, "every tool".
 * - A skill's fenced `git push --force`: reported `high`, with the
 *   skill file and its line — beside a `--force-with-lease` line and a
 *   prose mention of the same words, in the SAME fence and file,
 *   neither of which is reported.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RiskFinding, RiskSeams } from '../plan/risk.js';
import type { GitRunner } from '../pr/git.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { assessPlanRisk, EVERY_TOOL } from '../plan/risk.js';

/** The fence marker, spelled once so no line below nests one. */
const FENCE = '```';

/** The planted project one case reads. */
interface Project {
  readonly root: string;
  readonly repoRoot: string;
  readonly home: string;
}

let project: Project;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'rafa-plan-risk-'));
  const repoRoot = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  project = { root, repoRoot, home };
});

afterEach(() => {
  rmSync(project.root, { recursive: true, force: true });
});

/** Writes `text` at `path`, making its directory. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** git with no `origin`, and `gh` that fails every call. */
function seams(overrides: Partial<RiskSeams> = {}): RiskSeams {
  const git: GitRunner = () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' });
  const gh: GhRunner = () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' });
  return {
    repoRoot: project.repoRoot,
    home: project.home,
    settingSources: ['project', 'local'],
    environment: {},
    accounts: { prProvider: null, trackerDefault: 'markdown', trackerFallback: [] },
    runners: { git, gh },
    entry: join(project.root, 'rafa', 'cli.js'),
    ...overrides,
  };
}

/** The findings of one kind. */
function ofKind(findings: readonly RiskFinding[], kind: RiskFinding['kind']): readonly RiskFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

/** The 1-based line `needle` first sits on in `text`. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`not planted: ${needle}`);
  return index + 1;
}

describe('assessPlanRisk: a planted project', () => {
  it('reports the open agent\'s every tool and the skill\'s git push --force, and nothing for --force-with-lease or the prose mention', async () => {
    const agentPath = join(project.repoRoot, '.claude', 'agents', 'open-agent.md');
    plant(agentPath, ['---', 'name: open-agent', 'description: planted, with no tools line', '---', ''].join('\n'));

    const skillBody = [
      'Never git push --force from prose alone.',
      '',
      `${FENCE}bash`,
      'git push --force-with-lease origin main',
      'git push --force origin main',
      FENCE,
      '',
    ].join('\n');
    const skillPath = join(project.repoRoot, '.claude', 'skills', 'ship', 'SKILL.md');
    plant(skillPath, ['---', 'name: ship', 'description: planted', '---', '', skillBody].join('\n'));
    const skillText = await Bun.file(skillPath).text();

    const planPath = join(project.repoRoot, 'PLAN.md');
    const planText = [
      '# Plan: planted',
      '',
      '# Stage: one',
      '',
      '- [ ] Ship the release  {agent=open-agent skills=ship}',
      '',
    ].join('\n');
    plant(planPath, planText);

    const report = await assessPlanRisk({ path: planPath, text: planText }, seams());

    expect(ofKind(report.findings, 'tools')).toEqual([{
      level: 'high',
      kind: 'tools',
      text: `${EVERY_TOOL} — agent=open-agent has no tools: line; model the session default; no budget=`,
      task: 'Ship the release',
      file: 'PLAN.md',
      line: lineOf(planText, 'Ship the release'),
    }]);

    expect(ofKind(report.findings, 'destructive')).toEqual([{
      level: 'high',
      kind: 'destructive',
      text: 'git push --force — git push --force origin main',
      file: '.claude/skills/ship/SKILL.md',
      line: lineOf(skillText, 'git push --force origin'),
    }]);

    expect(report.total).toEqual({ high: 2, note: 4 });
  });
});
