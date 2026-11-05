/**
 * Tests for a stretch's rules file on its way into the snapshot: handed
 * to `resolveSpecSource` (`./spec-source.ts`) as a parameter, on to
 * `settleSpecSnapshot` (`./snapshot-settle.ts`) and the write, and named
 * by the snapshot line and the `--dry-run` line.
 *
 * Every case writes under a fresh temporary root and reads its issue off
 * a planted reader; nothing here reads the environment, since no module
 * this file drives does. Each line a run with rules prints is paired
 * with the same run handed none, which must print what the base printed
 * and write the snapshot the body alone writes.
 */
import type { SpecIssue, StretchRules } from './issue.js';
import type { SpecSourceResolution } from './spec-source.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { specPath } from '@open-tomato/rafa/board/naming';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { snapshotText, SPEC_LABEL } from './issue.js';
import { notesRebuiltLine, settleSpecSnapshot, stretchRulesLine } from './snapshot-settle.js';
import { describeIssue, dryRunLine, resolveSpecSource } from './spec-source.js';

/** Where `specs.dir` points: a relative setting, as configured. */
const SPECS_DIR = '.rafa/specs';

/** The issue every case plans from. */
const ISSUE: SpecIssue = Object.freeze({
  number: 1409,
  title: 'Stretch rules in the snapshot',
  body: '## What you get\n\nThe rules in every snapshot.\n',
  state: 'OPEN',
  labels: [SPEC_LABEL],
  author: 'octocat',
});

/** The snapshot's path under the root. */
const SAVED = specPath(SPECS_DIR, ISSUE.number, ISSUE.title);

/** The rules file as the caller read it. */
const RULES: StretchRules = Object.freeze({
  path: '.rafa/stretch/112/rules.md',
  text: '- Close-out notes go into the main tracker.\n',
});

/** The project root of one case; fresh per case. */
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-spec-source-rules-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An output keeping its info lines, and those lines. */
function capture(): { lines: string[]; output: ReturnType<typeof sinkOutput> } {
  const lines: string[] = [];
  return { lines, output: sinkOutput({ info: (line) => lines.push(line) }) };
}

/** Resolves `--issue` over the one planted issue, handed `rules` when given. */
function issueRun(
  output: ReturnType<typeof sinkOutput>,
  fields: { readonly rules?: StretchRules | null; readonly dryRun?: boolean } = {},
): Promise<SpecSourceResolution> {
  return resolveSpecSource({
    request: { kind: 'issue', issue: ISSUE.number },
    refresh: false,
    dryRun: fields.dryRun ?? false,
    repoRoot: root,
    specsDir: SPECS_DIR,
    findSpec: () => 'never',
    issues: () => Promise.resolve(ISSUE),
    output,
    ...fields.rules === undefined
      ? {}
      : { rules: fields.rules },
  });
}

/** What the snapshot holds now. */
function savedText(): string {
  return readFileSync(join(root, SAVED), 'utf8');
}

describe('resolveSpecSource handed a stretch rules file', () => {
  it('appends the rules to the snapshot and names the file in the snapshot line', async () => {
    const { lines, output } = capture();

    const resolution = await issueRun(output, { rules: RULES });

    expect(resolution.outcome).toBe('spec');
    expect(savedText()).toBe(snapshotText(ISSUE.body, null, RULES.text));
    expect(lines).toEqual([stretchRulesLine(RULES.path, SAVED)]);
    if (resolution.outcome !== 'spec') throw new Error('expected a spec');
    expect(resolution.spec.snapshot?.rules).toBe(RULES.path);
  });

  it('writes the snapshot the base writes and prints nothing when handed none, the control', async () => {
    const { lines, output } = capture();

    await issueRun(output, { rules: null });

    expect(savedText()).toBe(snapshotText(ISSUE.body, null));
    expect(lines).toEqual([]);
  });

  it('names the rules file on the --dry-run line and writes nothing', async () => {
    const { lines, output } = capture();

    const resolution = await issueRun(output, { rules: RULES, dryRun: true });

    expect(resolution).toEqual({ outcome: 'stopped', reason: 'dry-run' });
    expect(lines).toEqual([dryRunLine(describeIssue(ISSUE), RULES.path)]);
    expect(existsSync(join(root, SAVED))).toBe(false);
  });

  it('prints the base --dry-run line when handed none, and for rules holding nothing but whitespace', async () => {
    const none = capture();
    const blank = capture();

    await issueRun(none.output, { dryRun: true });
    await issueRun(blank.output, { rules: { path: RULES.path, text: '  \n' }, dryRun: true });

    expect(none.lines).toEqual([dryRunLine(describeIssue(ISSUE))]);
    expect(blank.lines).toEqual(none.lines);
  });

  it('spells the two lines as the plan names them', () => {
    expect(dryRunLine('issue #1409 "x"', RULES.path)).toBe(
      '🔎 --dry-run: would plan from issue #1409 "x", appending the stretch rules of'
      + ' .rafa/stretch/112/rules.md. Nothing was written.',
    );
    expect(dryRunLine('issue #1409 "x"')).toBe('🔎 --dry-run: would plan from issue #1409 "x". Nothing was written.');
    expect(stretchRulesLine(RULES.path, SAVED)).toBe(`stretch rules: appended .rafa/stretch/112/rules.md to ${SAVED}`);
  });
});

describe('settleSpecSnapshot handed a stretch rules file', () => {
  it('rebuilds a copy whose rules alone changed without asking, naming the rules file', async () => {
    const file = join(root, SAVED);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, snapshotText(ISSUE.body, null, '- an older rule'));
    const { lines, output } = capture();
    let asked = 0;

    const snapshot = await settleSpecSnapshot({
      repoRoot: root,
      specsDir: SPECS_DIR,
      issue: ISSUE,
      refresh: false,
      offerRefresh: () => {
        asked += 1;
        return Promise.resolve(false);
      },
      output,
      rules: RULES,
    });

    expect(snapshot.action).toBe('notes-rebuilt');
    expect(asked).toBe(0);
    expect(savedText()).toBe(snapshotText(ISSUE.body, null, RULES.text));
    expect(lines).toEqual([
      `stretch rules: ${RULES.path} changed since the saved copy`,
      notesRebuiltLine(SAVED, ISSUE.number, snapshot.previous ?? ''),
      stretchRulesLine(RULES.path, SAVED),
    ]);
  });

  it('leaves a copy already carrying the rules alone, still naming the rules file', async () => {
    const file = join(root, SAVED);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, snapshotText(ISSUE.body, null, RULES.text));
    const { lines, output } = capture();

    const snapshot = await settleSpecSnapshot({
      repoRoot: root,
      specsDir: SPECS_DIR,
      issue: ISSUE,
      refresh: false,
      output,
      rules: RULES,
    });

    expect(snapshot.action).toBe('unchanged');
    expect(lines).toEqual([stretchRulesLine(RULES.path, SAVED)]);
  });
});
