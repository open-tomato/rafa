/**
 * Tests for the `board.project.number` write
 * (`./init-board-project-setting.ts`): the shapes of config text the
 * edit covers, the ones it refuses, and the part a write off a project
 * root answers.
 *
 * The commented branch starts from the bytes `rafa init` writes,
 * `projectConfigText()`, so it is driven against the template that ships.
 * Every text an edit answers is parsed back through `parseConfigText`,
 * which is what a written file is read with, so a branch writing a line
 * that parses and means something else reddens here.
 *
 * The refusals are read beside a control: the same root, with a file the
 * edit covers, takes the write, so a refused part is not a write that
 * could never have happened.
 *
 * No case touches the real home or a real project: each root is a
 * directory under this file's own temporary root.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { projectNumberIn, withProjectNumber, writeProjectNumber } from './init-board-project-setting.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-project-number-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh project root holding `text` as its project config. */
function rootHolding(label: string, text: string): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

/** The project config under `root`, as written. */
function configOf(root: string): string {
  return readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8');
}

/** What `text` reads `board.project.number` as. */
function numberIn(text: string | null): number | null {
  if (text === null) throw new Error('the edit refused a text it was meant to cover');
  return parseConfigText(text, 'config.yaml').values.boardProjectNumber ?? null;
}

describe('withProjectNumber', () => {
  it('uncomments board, project and number in the config rafa init writes, keeping the rest commented', () => {
    const scaffold = projectConfigText();
    expect(numberIn(scaffold)).toBeNull();

    const text = withProjectNumber(scaffold, 6);

    expect(numberIn(text)).toBe(6);
    expect(text).toContain('\nboard:\n');
    expect(text).toContain('\n  project:\n');
    expect(text).toContain('\n    number: 6\n');
    expect(text).toContain('#     template: https://github.com/orgs/open-tomato/projects/6');
    expect(text).toContain('#   relationships: labels');
    expect(text).toContain('# roadmap:');
    expect(text).not.toContain('unset until rafa init --board --project');
    expect(text?.split('\n')).toHaveLength(scaffold.split('\n').length);
  });

  it('adds project and number under an uncommented board that holds neither', () => {
    const text = withProjectNumber('version: 1\nboard:\n  relationships: native\nroadmap:\n  issue: 31\n', 6);

    expect(text).toBe('version: 1\nboard:\n  project:\n    number: 6\n  relationships: native\nroadmap:\n  issue: 31\n');
    expect(numberIn(text)).toBe(6);
  });

  it('adds the number under an uncommented project that holds the template only', () => {
    const template = 'https://github.com/orgs/acme/projects/2';
    const text = withProjectNumber(`version: 1\nboard:\n  project:\n    template: ${template}\n`, 6);

    expect(text).toBe(`version: 1\nboard:\n  project:\n    number: 6\n    template: ${template}\n`);
    expect(parseConfigText(text ?? '', 'config.yaml').values.boardProjectTemplate).toBe(template);
  });

  it('replaces a number the project already holds, so the old one does not read back', () => {
    const text = withProjectNumber('version: 1\nboard:\n  project:\n    number: 3\n  trustedAuthors: []\n', 7);

    expect(text).toBe('version: 1\nboard:\n  project:\n    number: 7\n  trustedAuthors: []\n');
    expect(numberIn(text)).toBe(7);
  });

  it('leaves a number under another top-level key alone', () => {
    const text = withProjectNumber('version: 1\nboard:\n  project:\n    template: https://github.com/orgs/acme/projects/2\nother:\n    number: 3\n', 7);

    expect(text).toContain('other:\n    number: 3\n');
    expect(numberIn(text)).toBe(7);
  });

  it('appends the block to a file that names no board, commented or not', () => {
    const text = withProjectNumber('version: 1\n', 6);

    expect(text).toBe('version: 1\nboard:\n  project:\n    number: 6\n');
    expect(numberIn(text)).toBe(6);
  });

  it('refuses a board spelled as a flow mapping, rather than adding a second board key', () => {
    expect(withProjectNumber('version: 1\nboard: {relationships: native}\n', 6)).toBeNull();
  });

  it('refuses a project spelled as a flow mapping under an uncommented board', () => {
    expect(withProjectNumber('version: 1\nboard:\n  project: {number: 3}\n', 6)).toBeNull();
  });
});

describe('projectNumberIn', () => {
  it('reads the number a file names, and null for one that names none', () => {
    expect(projectNumberIn('version: 1\nboard:\n  project:\n    number: 6\n', 'config.yaml')).toBe(6);
    expect(projectNumberIn('version: 1\n', 'config.yaml')).toBeNull();
  });
});

describe('writeProjectNumber', () => {
  it('writes the number into the config rafa init wrote, and reports the part created', () => {
    const root = rootHolding('scaffold', projectConfigText());

    const part = writeProjectNumber(root, 6);

    expect(part).toEqual({
      kind: 'setting',
      name: 'board.project.number',
      outcome: 'created',
      detail: `${join(root, '.rafa', 'config.yaml')} now names project 6`,
    });
    expect(numberIn(configOf(root))).toBe(6);
  });

  it('reports a file already naming the number present, and writes no byte', () => {
    const text = 'version: 1\nboard:\n  project:\n    number: 6   # kept as written\n';
    const root = rootHolding('present', text);

    const part = writeProjectNumber(root, 6);

    expect(part.outcome).toBe('present');
    expect(configOf(root)).toBe(text);
  });

  it('refuses a board of a shape the edit does not cover, leaving the file as it was, where a covered one is written', () => {
    const refusedText = 'version: 1\nboard: {relationships: native}\n';
    const refusedRoot = rootHolding('flow', refusedText);
    const controlRoot = rootHolding('control', 'version: 1\nboard:\n  relationships: native\n');

    const refused = writeProjectNumber(refusedRoot, 6);
    const control = writeProjectNumber(controlRoot, 6);

    expect(refused.outcome).toBe('refused');
    expect(refused.detail).toContain('set board.project.number: 6 by hand');
    expect(configOf(refusedRoot)).toBe(refusedText);
    expect(control.outcome).toBe('created');
  });

  it('refuses an edit that would not read back as the number, leaving the file as it was', () => {
    const text = 'version: 1\nboard:\n    relationships: native\n';
    const root = rootHolding('indented', text);

    const part = writeProjectNumber(root, 6);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('was left as it was');
    expect(configOf(root)).toBe(text);
  });

  it('refuses a root with no project config', () => {
    const root = mkdtempSync(join(tempBase, 'missing-'));

    const part = writeProjectNumber(root, 6);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('could not be read');
  });
});
