/**
 * The risk total `loop start` prints ahead of the notices
 * (`start/risk-total.ts`), and where `start.ts` calls it.
 *
 * git and `gh` are planted runners: git has no `origin` and `gh` fails,
 * so the reading spawns nothing. The output is a recording one, so a
 * case reads which level each line went to.
 *
 * Where the call sits in `start.ts` is read off the source with
 * TypeScript, as `start.test.ts` reads the wrap-up branch, because
 * `start()` spawns the real CLI with no seam. A planted source with the
 * two calls the other way round is the control that proves the reader
 * reports the order it finds rather than a fixed one.
 */
import type { RiskTotalInput, RiskTotalSeams } from './risk-total.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { CliEvent, Output } from '../ports/index.js';
import type { GitRunner } from '../pr/git.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { announceRiskTotal, readRiskTotalLine } from './risk-total.js';

/** One line the recording output was handed, with its level. */
interface Recorded {
  readonly level: 'info' | 'warn' | 'error' | 'debug';
  readonly message: string;
}

/** An output that records every line and event. */
function recordingOutput(): { output: Output; lines: Recorded[]; events: CliEvent[] } {
  const lines: Recorded[] = [];
  const events: CliEvent[] = [];
  const output: Output = {
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
    debug: (message) => lines.push({ level: 'debug', message }),
    emit: (event) => events.push(event),
    result: () => undefined,
  };
  return { output, lines, events };
}

let root: string;
let repoRoot: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-risk-total-'));
  repoRoot = join(root, 'repo');
  home = join(root, 'home');
  mkdirSync(join(repoRoot, '.rafa', 'plans'), { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Plants a plan holding `lines` under one stage; answers its absolute path. */
function plantPlan(lines: readonly string[]): string {
  const path = join(repoRoot, '.rafa', 'plans', 'PLAN-x.md');
  writeFileSync(path, ['# Plan: planted', '', '# Stage: one', '', ...lines, ''].join('\n'));
  return path;
}

/** The input for the plan at `planPath`, under `environment`. */
function inputFor(planPath: string, environment: Record<string, string> = {}): RiskTotalInput {
  return {
    repoRoot,
    home,
    planPath,
    config: { settingSources: ['project', 'local'], prProvider: null, trackerDefault: 'markdown', trackerFallback: [] },
    environment,
  };
}

/** git with no `origin`, and `gh` that fails every call. */
function plantedSeams(output?: Output): RiskTotalSeams {
  const git: GitRunner = () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' });
  const gh: GhRunner = () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' });
  return { runners: () => ({ git, gh }), output };
}

describe('readRiskTotalLine', () => {
  it('counts an open task with no tools as high, and names the plan repository-relative', async () => {
    const plan = plantPlan(['- [ ] Do the thing']);
    const line = await readRiskTotalLine(inputFor(plan), plantedSeams());
    expect(line).toMatch(/^🛡 {2}Risk: 1 high, \d+ notes? — rafa plan risk \.rafa\/plans\/PLAN-x\.md$/);
  });

  it('counts no high for a plan whose only task is done: the control for the case above', async () => {
    const plan = plantPlan(['- [x] Did the thing']);
    const line = await readRiskTotalLine(inputFor(plan), plantedSeams());
    expect(line).toMatch(/^🛡 {2}Risk: 0 high, /);
  });

  it('counts a secret-looking variable by name and never prints its value', async () => {
    const plan = plantPlan(['- [x] Did the thing']);
    const without = await readRiskTotalLine(inputFor(plan), plantedSeams());
    const withSecret = await readRiskTotalLine(inputFor(plan, { FAKE_TOKEN: 'abc123' }), plantedSeams());
    const notes = (line: string): number => Number(/, (\d+) notes?/.exec(line)?.[1]);
    expect(notes(withSecret)).toBe(notes(without) + 1);
    expect(withSecret).not.toContain('abc123');
  });
});

describe('announceRiskTotal', () => {
  it('writes the total at info and nothing else', async () => {
    const plan = plantPlan(['- [ ] Do the thing']);
    const { output, lines, events } = recordingOutput();
    await announceRiskTotal(inputFor(plan), plantedSeams(output));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.message).toStartWith('🛡  Risk: 1 high, ');
    expect(events).toEqual([]);
  });

  it('warns and does not throw when the reading throws', async () => {
    const missing = join(repoRoot, '.rafa', 'plans', 'PLAN-gone.md');
    const { output, lines } = recordingOutput();
    await announceRiskTotal(inputFor(missing), plantedSeams(output));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.message).toStartWith(`⚠️  Risk: could not read ${missing} — `);
    expect(lines[0]?.message).toContain('ENOENT');
  });
});

/** Whether `statement` declares the function `start`. */
function isStartDeclaration(statement: ts.Statement): statement is ts.FunctionDeclaration {
  return ts.isFunctionDeclaration(statement) && statement.name?.text === 'start';
}

/** The names of the calls in `start()`'s body, in source order. */
function startCalls(source: string): readonly string[] {
  const file = ts.createSourceFile('start.ts', source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) names.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  const start = file.statements.find(isStartDeclaration);
  if (start?.body === undefined) throw new Error('no start() in the source');
  visit(start.body);
  return names;
}

/** Where `name` first sits in `calls`, refusing a name that is not there. */
function firstAt(calls: readonly string[], name: string): number {
  const index = calls.indexOf(name);
  if (index === -1) throw new Error(`no call to ${name}`);
  return index;
}

describe('where start.ts announces the total', () => {
  it('calls announceRiskTotal after the branch guard and before requireNoticesAnswered', () => {
    const calls = startCalls(readFileSync(join(import.meta.dir, '..', 'start.ts'), 'utf8'));
    expect(firstAt(calls, 'guardRunBranch')).toBeLessThan(firstAt(calls, 'announceRiskTotal'));
    expect(firstAt(calls, 'announceRiskTotal')).toBeLessThan(firstAt(calls, 'requireNoticesAnswered'));
  });

  it('reads the planted reverse order as reversed: the control for the case above', () => {
    const planted = [
      'export default async function start(): Promise<void> {',
      '  await requireNoticesAnswered();',
      '  await announceRiskTotal({});',
      '}',
    ].join('\n');
    const calls = startCalls(planted);
    expect(firstAt(calls, 'requireNoticesAnswered')).toBeLessThan(firstAt(calls, 'announceRiskTotal'));
  });
});
