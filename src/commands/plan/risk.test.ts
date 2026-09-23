/**
 * Tests for `rafa plan risk` (`risk.ts`): the reading printed in both
 * modes, `--strict` over a plan with a `high` finding and over one
 * without, the plan named and the default plan, the refusals, and that
 * a planted secret's name is printed and its value is not.
 *
 * Each case dispatches in-process in a project of its own, beside an
 * empty home, with git answering that there is no `origin` and `gh`
 * failing every call, so no case reaches this repository's remote or
 * the network. The rafa skill tier is pointed at a directory under this
 * file's own, so no skill of this checkout is read.
 *
 * Every refusal or finding a case asserts sits beside a control that
 * differs in one thing: `--strict` refusing the plan whose open task may
 * use every tool is held beside the same flag passing the plan whose
 * task names `tools=Read`, and the secret's value missing from the
 * output is held beside its name being there, so the environment was
 * read at all.
 */
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { EVERY_TOOL, RISK_FOOTER } from '../../plan/risk.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createPlanRiskCommand, riskLine, riskPlanPath, strictRefusal } from './risk.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-risk-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** A plan whose one open task names no agent and no tools, so it may use every tool: one `high`. */
const EVERY_TOOL_PLAN = ['# Plan: open', '', '# Stage: one', '', '- [ ] Do the thing', ''].join('\n');

/** A plan whose one open task may use `Read` alone: no `high`. */
const NARROW_PLAN = ['# Plan: narrow', '', '# Stage: one', '', '- [ ] Read the thing  {tools=Read}', ''].join('\n');

/** The command, with git answering no `origin`, `gh` failing, and the rafa tier under this file's directory. */
const COMMAND: RafaCommand = createPlanRiskCommand({
  runners: () => ({
    git: () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' }),
    gh: () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' }),
  }),
  entry: join(tempBase, 'rafa', 'cli.js'),
});

/** A fresh project of this file's own, each `[path, text]` written under its root. */
function plantRiskProject(files: readonly (readonly [string, string])[]): { root: string; home: string } {
  const project = plantProject(mkdtempSync(join(tempBase, 'scope-')));
  for (const [path, text] of files) {
    mkdirSync(join(project.root, path, '..'), { recursive: true });
    writeFileSync(join(project.root, path), text, 'utf8');
  }
  return project;
}

/** Dispatches `plan risk` with `words` in `project`, under `env`. */
async function riskIn(
  project: { root: string; home: string },
  words: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(['plan', 'risk', ...words], SUBJECTS, [COMMAND], project, env);
}

/** An event as one string: `<level>:<message>` for a log, and its type for the rest. */
function labelOf(event: CliEvent): string {
  return event.type === 'log'
    ? `${event.level}:${event.message}`
    : event.type;
}

/** What `run` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

describe('rafa plan risk, in text mode', () => {
  it('prints the high group, the note group, the total and the footer, and exits 0 over a plan with a high', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);
    const run = await riskIn(project, ['plans/open.md']);
    const lines = run.stdout.split('\n');

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(lines[0]).toBe('Risk reading of plans/open.md');
    expect(lines).toContain('high (1)');
    expect(run.stdout).toContain(`  ${'tools'.padEnd('outside-path'.length)}  ${EVERY_TOOL} — no agent= and no tools=`);
    expect(run.stdout).toContain('plans/open.md:5 — Do the thing');
    expect(lines.slice(-3)).toEqual([
      '🛡  Risk: 1 high, 4 notes — rafa plan risk plans/open.md',
      RISK_FOOTER,
      '',
    ]);
  });

  it('exits 1 under --strict over a plan with a high, the whole report printed first and the refusal on stderr', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);
    const plain = await riskIn(project, ['plans/open.md']);
    const strict = await riskIn(project, ['plans/open.md', '--strict']);

    expect(strict).toEqual({
      exitCode: 1,
      stdout: plain.stdout,
      stderr: '❌ plans/open.md: 1 high finding; --strict refuses a plan with any\n',
    });
  });

  it('exits 0 under --strict over a plan with no high, where the plan above is refused', async () => {
    const project = plantRiskProject([['plans/narrow.md', NARROW_PLAN]]);
    const run = await riskIn(project, ['plans/narrow.md', '--strict']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.stdout.split('\n').slice(2, 4)).toEqual(['high (0)', '  none']);
    expect(run.stdout).toContain('🛡  Risk: 0 high, 4 notes — rafa plan risk plans/narrow.md');
  });
});

describe('rafa plan risk, in json mode', () => {
  it('gives the reading as the data of the one result event, and exits 0', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);
    const run = await riskIn(project, ['plans/open.md', '--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map(labelOf)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: { plan: 'plans/open.md', total: { high: 1, note: 4 } },
    });
  });

  it('writes each high as an error event and fails the result under --strict, exiting 1', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);
    const run = await riskIn(project, ['plans/open.md', '--strict', '--output=json']);
    const events = eventsOf(run.stdout);

    expect(run.exitCode).toBe(1);
    expect(events.map(labelOf)).toEqual([
      'start',
      `error:plans/open.md:5: tools: ${EVERY_TOOL} — no agent= and no tools=; model the session default; no budget=`,
      'result',
    ]);
    expect(events[2]).toMatchObject({
      type: 'result',
      ok: false,
      error: { code: 'command_exit', message: '❌ plans/open.md: 1 high finding; --strict refuses a plan with any' },
    });
  });
});

describe('the plan read', () => {
  it('reads the default plan in plan.dir when the line names none', async () => {
    const project = plantRiskProject([['.rafa/plans/PLAN.md', EVERY_TOOL_PLAN]]);
    const run = await riskIn(project, []);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe(`Risk reading of ${join('.rafa', 'plans', 'PLAN.md')}`);
  });

  it('refuses a line naming no plan where there is no default plan, naming both places looked at', () => {
    const root = mkdtempSync(join(tempBase, 'empty-'));

    expect(exitOf(() => riskPlanPath(root, '.rafa/plans', null))).toEqual({
      exitCode: 1,
      message: `❌ No plan named, and no default plan at ${join(root, '.rafa', 'plans', 'PLAN.md')} or ${join(root, 'PLAN.md')}`
        + '\nUsage: rafa plan risk [<plan>] [--strict]',
    });
  });

  it('refuses a plan named that is no file, and two plans, with exit code 1', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);

    expect(await riskIn(project, ['plans/missing.md'])).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `❌ Plan file not found: ${join(project.root, 'plans', 'missing.md')}\n`,
    });
    expect(await riskIn(project, ['plans/open.md', 'plans/open.md'])).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ Expected at most one argument, got 2: plans/open.md plans/open.md\nUsage: rafa plan risk [<plan>] [--strict]\n',
    });
  });

  it('refuses --strict typed ahead of the plan, which the parser reads as its value', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);

    expect(await riskIn(project, ['--strict', 'plans/open.md'])).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ --strict takes no value, and read "plans/open.md" as one. Type the plan first: rafa plan risk <plan> --strict\n',
    });
  });
});

describe('secrets', () => {
  it('names a credential-bearing variable and prints no value of it, in either mode', async () => {
    const project = plantRiskProject([['plans/open.md', EVERY_TOOL_PLAN]]);
    const env = { FAKE_TOKEN: 'abc123' };
    const text = await riskIn(project, ['plans/open.md'], env);
    const json = await riskIn(project, ['plans/open.md', '--output=json'], env);

    for (const run of [text, json]) {
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('FAKE_TOKEN');
      expect(`${run.stdout}${run.stderr}`).not.toContain('abc123');
    }
  });
});

describe('the lines the command words', () => {
  it('writes a finding with its file and line, with its file alone, and with neither', () => {
    expect(riskLine({ level: 'high', kind: 'destructive', text: 'git push --force', file: 'a.md', line: 3 }))
      .toBe('a.md:3: destructive: git push --force');
    expect(riskLine({ level: 'high', kind: 'destructive', text: 'rm -rf /', file: 'a.md' })).toBe('a.md: destructive: rm -rf /');
    expect(riskLine({ level: 'note', kind: 'secret', text: 'FAKE_TOKEN' })).toBe('secret: FAKE_TOKEN');
  });

  it('counts the high findings in the --strict refusal', () => {
    expect(strictRefusal({ plan: 'p.md', total: { high: 2, note: 0 }, findings: [] }))
      .toBe('❌ p.md: 2 high findings; --strict refuses a plan with any');
  });
});
