/**
 * Tests for the `--continue` decision prompt: where its two bundled
 * files are read, how the project criteria meet the base under each
 * mode, and what the rendered prompt holds.
 *
 * Every project file sits in a scratch directory under `tmpdir`, and
 * the bundled lookup is driven at a scratch module directory too, so a
 * case can take a bundled file away. The real templates are read by
 * one case each, so an edit that drops a slot fails here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  CONTINUE_CRITERIA_FILE,
  DECISION_PROMPT_FILE,
  DECISION_PROMPT_SLOTS,
  PROJECT_CRITERIA_HEADING,
  bundledCandidates,
  buildDecisionPrompt,
  readBundledFile,
  renderDecisionPrompt,
  resolveContinueCriteria,
} from './decision-prompt.js';

const scratch = mkdtempSync(join(tmpdir(), 'rafa-decision-prompt-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A fresh directory under the scratch root. */
function freshDir(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `src/start/`, where the module sits in a checkout. */
const START_DIR = import.meta.dir;

/** The base criteria as the checkout holds them. */
const BASE = readBundledFile(CONTINUE_CRITERIA_FILE, START_DIR);

/** A template carrying every slot once, in a known order. */
const TEMPLATE = DECISION_PROMPT_SLOTS.map((slot) => `${slot}=[{{${slot}}}]`).join('\n');

/** What every render case is built from. */
const INPUT = {
  plan: '.rafa/plans/rafa-9.md',
  task: { lineNum: 11, task: 'Add the gate check' },
  holds: ['the report holds its task: needs `.env.local`'],
  retriesLeft: 1,
  openTasks: [
    { lineNum: 11, task: 'Add the gate check' },
    { lineNum: 14, task: 'Write `.env.local` docs' },
  ],
  criteria: 'Prefer stop.',
};

describe('the bundled files', () => {
  it('looks beside the module first, then in its parent', () => {
    expect(bundledCandidates(DECISION_PROMPT_FILE, '/x/dist')).toEqual([
      join('/x/dist', DECISION_PROMPT_FILE),
      join('/x', DECISION_PROMPT_FILE),
    ]);
  });

  it('reads both from src/ in a checkout, one directory above the module', () => {
    expect(readBundledFile(DECISION_PROMPT_FILE, START_DIR)).toContain('{{criteria}}');
    expect(BASE).toContain('`retry`');
  });

  it('reads a file beside the module, as a build lays it out', () => {
    const dist = freshDir('dist-beside');
    writeFileSync(join(dist, CONTINUE_CRITERIA_FILE), 'beside\n');

    expect(readBundledFile(CONTINUE_CRITERIA_FILE, dist)).toBe('beside\n');
  });

  it('throws naming both paths when neither holds the file', () => {
    const empty = join(freshDir('no-bundle'), 'start');

    expect(() => readBundledFile(CONTINUE_CRITERIA_FILE, empty)).toThrow(
      `no file at ${join(empty, CONTINUE_CRITERIA_FILE)} or ${join(dirname(empty), CONTINUE_CRITERIA_FILE)}`,
    );
  });

  it('carries every slot in the real template', () => {
    const template = readBundledFile(DECISION_PROMPT_FILE, START_DIR);
    const missing = DECISION_PROMPT_SLOTS.filter((slot) => !template.includes(`{{${slot}}}`));

    expect(missing).toEqual([]);
  });
});

describe('resolveContinueCriteria', () => {
  it('answers the base alone under extend when the project file is missing', () => {
    const root = freshDir('extend-missing');

    expect(resolveContinueCriteria({ root, path: '.rafa/continue-criteria.md', mode: 'extend' }, START_DIR)).toEqual({
      ok: true,
      criteria: BASE.trimEnd(),
      project: null,
    });
  });

  it('appends the project file under the base under extend', () => {
    const root = freshDir('extend-present');
    mkdirSync(join(root, '.rafa'));
    writeFileSync(join(root, '.rafa', 'continue-criteria.md'), 'Never jump a docs task.\n');

    const reading = resolveContinueCriteria({ root, path: '.rafa/continue-criteria.md', mode: 'extend' }, START_DIR);

    expect(reading).toEqual({
      ok: true,
      criteria: `${BASE.trimEnd()}\n\n${PROJECT_CRITERIA_HEADING}\n\nNever jump a docs task.`,
      project: join(root, '.rafa', 'continue-criteria.md'),
    });
  });

  it('answers the base alone under extend when the project file is blank', () => {
    const root = freshDir('extend-blank');
    writeFileSync(join(root, 'c.md'), '  \n\n');

    expect(resolveContinueCriteria({ root, path: 'c.md', mode: 'extend' }, START_DIR)).toEqual({
      ok: true,
      criteria: BASE.trimEnd(),
      project: join(root, 'c.md'),
    });
  });

  it('answers the project file alone under replace', () => {
    const root = freshDir('replace-present');
    writeFileSync(join(root, 'c.md'), 'Always stop.\n');

    expect(resolveContinueCriteria({ root, path: 'c.md', mode: 'replace' }, START_DIR)).toEqual({
      ok: true,
      criteria: 'Always stop.',
      project: join(root, 'c.md'),
    });
  });

  it('reads an absolute path as written', () => {
    const elsewhere = freshDir('absolute');
    writeFileSync(join(elsewhere, 'abs.md'), 'Absolute.\n');

    const reading = resolveContinueCriteria({ root: freshDir('absolute-root'), path: join(elsewhere, 'abs.md'), mode: 'replace' }, START_DIR);

    expect(reading).toEqual({ ok: true, criteria: 'Absolute.', project: join(elsewhere, 'abs.md') });
  });

  it('refuses replace when the project file is missing, naming the key and the path', () => {
    const root = freshDir('replace-missing');

    expect(resolveContinueCriteria({ root, path: 'c.md', mode: 'replace' }, START_DIR)).toEqual({
      ok: false,
      refusal: `loop.continue.criteriaMode is replace, and loop.continue.criteria names no file at ${join(root, 'c.md')}`,
    });
  });

  it('refuses replace when the project file is blank', () => {
    const root = freshDir('replace-blank');
    writeFileSync(join(root, 'c.md'), '\n');

    expect(resolveContinueCriteria({ root, path: 'c.md', mode: 'replace' }, START_DIR)).toEqual({
      ok: false,
      refusal: `loop.continue.criteriaMode is replace, and ${join(root, 'c.md')} holds no criteria`,
    });
  });

  it('refuses a project path that is a directory, under either mode', () => {
    const root = freshDir('directory');
    mkdirSync(join(root, 'c.md'));

    for (const mode of ['extend', 'replace'] as const) {
      const reading = resolveContinueCriteria({ root, path: 'c.md', mode }, START_DIR);

      expect(reading.ok).toBe(false);
      const refusal = reading.ok
        ? ''
        : reading.refusal;

      expect(refusal).toStartWith(`loop.continue.criteria cannot be read at ${join(root, 'c.md')}: `);
    }
  });

  it('never reads the base under replace, so a missing bundle does not refuse it', () => {
    const root = freshDir('replace-no-bundle');
    writeFileSync(join(root, 'c.md'), 'Mine.\n');
    const noBundle = join(freshDir('replace-no-bundle-module'), 'start');

    expect(resolveContinueCriteria({ root, path: 'c.md', mode: 'replace' }, noBundle)).toEqual({
      ok: true,
      criteria: 'Mine.',
      project: join(root, 'c.md'),
    });
  });

  it('throws under extend when the bundled base is missing, naming both paths', () => {
    const noBundle = join(freshDir('extend-no-bundle'), 'start');

    expect(() => resolveContinueCriteria({ root: scratch, path: 'c.md', mode: 'extend' }, noBundle)).toThrow(CONTINUE_CRITERIA_FILE);
  });
});

describe('renderDecisionPrompt', () => {
  it('fills every slot, line numbers counted from one', () => {
    const rendered = renderDecisionPrompt(TEMPLATE, INPUT);

    expect(rendered).toBe([
      'plan=[.rafa/plans/rafa-9.md]',
      'line=[12]',
      'task=[```text\nAdd the gate check\n```]',
      'holds=[```text\nthe report holds its task: needs `.env.local`\n```]',
      'retriesLeft=[1]',
      'openTasks=[```text\nline 12: Add the gate check\nline 15: Write `.env.local` docs\n```]',
      'criteria=[Prefer stop.]',
    ].join('\n'));
  });

  it('fences text one backtick longer than its longest run', () => {
    const rendered = renderDecisionPrompt(TEMPLATE, {
      ...INPUT,
      task: { lineNum: 0, task: 'Quote ```js``` blocks' },
    });

    expect(rendered).toContain('task=[````text\nQuote ```js``` blocks\n````]');
  });

  it('says so when no hold and no open task is known', () => {
    const rendered = renderDecisionPrompt(TEMPLATE, { ...INPUT, holds: [], openTasks: [] });

    expect(rendered).toContain('holds=[(no reason was recorded)]');
    expect(rendered).toContain('openTasks=[(no open task is left)]');
  });

  it('inserts a slot spelled inside a value verbatim, in one pass', () => {
    const rendered = renderDecisionPrompt(TEMPLATE, { ...INPUT, criteria: 'Keep {{task}} and $& as written.' });

    expect(rendered).toContain('criteria=[Keep {{task}} and $& as written.]');
  });

  it('throws naming the first slot a template does not carry', () => {
    expect(() => renderDecisionPrompt(TEMPLATE.replace('{{holds}}', ''), INPUT)).toThrow('carries no {{holds}} slot');
  });
});

describe('the retry sections', () => {
  const SECTIONED = ['head', '<!-- retry -->', 'retry offered', '<!-- /retry -->', '<!-- no-retry -->', 'no retry left', '<!-- /no-retry -->', TEMPLATE].join('\n');

  it('keeps the retry section and drops the no-retry one while a retry is left, markers off', () => {
    const rendered = renderDecisionPrompt(SECTIONED, INPUT);

    expect(rendered.startsWith('head\nretry offered\nplan=[')).toBe(true);
    expect(rendered).not.toContain('no retry left');
    expect(rendered).not.toContain('<!--');
  });

  it('drops the retry section and keeps the no-retry one with no retry left', () => {
    const rendered = renderDecisionPrompt(SECTIONED, { ...INPUT, retriesLeft: 0 });

    expect(rendered.startsWith('head\nno retry left\nplan=[')).toBe(true);
    expect(rendered).not.toContain('retry offered');
  });
});

describe('buildDecisionPrompt', () => {
  it('renders the real template with nothing left unfilled', () => {
    const prompt = buildDecisionPrompt(INPUT, START_DIR);

    expect(prompt.startsWith('# Loop continue decision instructions')).toBe(true);
    expect(prompt).toContain('stopped at tracker line 12');
    expect(prompt).toContain('Prefer stop.');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).not.toContain('<!--');
  });

  it('offers retry while one is left, and offers none, its example included, with none left', () => {
    const offered = buildDecisionPrompt(INPUT, START_DIR);
    const spent = buildDecisionPrompt({ ...INPUT, retriesLeft: 0 }, START_DIR);

    expect(offered).toContain('- `retry`:');
    expect(offered).toContain('strategy: retry');
    expect(offered).not.toContain('`retry` is not offered');
    expect(spent).not.toContain('- `retry`:');
    expect(spent).not.toContain('strategy: retry');
    expect(spent).not.toContain('`approach`');
    expect(spent).not.toContain('\n\n\n');
    expect(offered).not.toContain('\n\n\n');
    expect(spent).toContain('`retry` is not offered');
  });
});
