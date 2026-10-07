import type { PromptSeams } from './prompt.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  BUNDLED_PROMPT,
  bundledPromptPath,
  defaultPromptSeams,
  engineerPrompt,
  engineerPromptFile,
  fillPrompt,
  isRafaCheckout,
  nodePromptFs,
  PROJECT_PROMPT,
  RAFA_PROMPT,
} from './prompt.js';

/** The default this repository ships, read where the build copies it from. */
const SHIPPED_DEFAULT = resolve(import.meta.dir, '..', 'bundled', 'stretch', 'engineer-prompt-default.md');

let scratch: string;
let entry: string;
let root: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-prompt-')));
  entry = join(scratch, 'pkg', 'dist', 'cli.js');
  root = join(scratch, 'project');
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, '');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function seams(): PromptSeams {
  return { fs: nodePromptFs, entry };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The installed package's default prompt, holding `text`. */
function installDefault(text = 'DEFAULT {{STRETCH}}\n'): string {
  const path = join(scratch, 'pkg', 'dist', BUNDLED_PROMPT);
  write(path, text);
  return path;
}

/** Makes `root` look like the rafa checkout, with its own prompt unless `prompt` is false. */
function plantRafaCheckout(options: { prompt?: boolean; name?: string } = {}): void {
  write(join(root, 'package.json'), JSON.stringify({ name: options.name ?? '@open-tomato/rafa', version: '9.9.9' }));
  write(join(root, 'src', 'rafa.ts'), '');
  if (options.prompt !== false) write(join(root, RAFA_PROMPT), 'RAFA {{STRETCH}}\n');
}

describe('the shipped default', () => {
  test('sits under src/bundled/, so the build copies it beside the entry', () => {
    const text = readFileSync(SHIPPED_DEFAULT, 'utf8');

    expect(text).toContain('{{STRETCH}}');
    expect(text).toContain('{{PREVIOUS}}');
  });

  test('fills to a first stretch with no placeholder and no previous report left', () => {
    const filled = fillPrompt(readFileSync(SHIPPED_DEFAULT, 'utf8'), 1);

    expect(filled).toContain('Start stretch 1.');
    expect(filled).not.toContain('{{');
    expect(filled).not.toContain('stretch/0');
    expect(filled).not.toContain('report.md');
  });
});

describe('bundledPromptPath', () => {
  test('is bundled/stretch/engineer-prompt-default.md beside the entry', () => {
    expect(bundledPromptPath(entry)).toBe(join(scratch, 'pkg', 'dist', 'bundled', 'stretch', 'engineer-prompt-default.md'));
  });

  test('follows a linked entry to the build it points at', () => {
    const link = join(scratch, 'bin-rafa');
    symlinkSync(entry, link);

    expect(bundledPromptPath(link)).toBe(bundledPromptPath(entry));
  });
});

describe('isRafaCheckout', () => {
  test('reads a root named @open-tomato/rafa that holds src/rafa.ts as the checkout', () => {
    plantRafaCheckout();

    expect(isRafaCheckout(root)).toBe(true);
  });

  test('reads a project of another name as no checkout', () => {
    plantRafaCheckout({ name: 'someone-else' });

    expect(isRafaCheckout(root)).toBe(false);
  });

  test('reads a root with rafa\'s name and no src/rafa.ts as no checkout', () => {
    plantRafaCheckout();
    rmSync(join(root, 'src'), { recursive: true });

    expect(isRafaCheckout(root)).toBe(false);
  });

  test('reads a root with no package.json, or one holding no JSON, as no checkout', () => {
    write(join(root, 'src', 'rafa.ts'), '');
    expect(isRafaCheckout(root)).toBe(false);

    write(join(root, 'package.json'), '{ not json');
    expect(isRafaCheckout(root)).toBe(false);

    write(join(root, 'package.json'), 'null');
    expect(isRafaCheckout(root)).toBe(false);
  });
});

describe('engineerPromptFile', () => {
  test('gives another project the bundled default, never a rafa prompt beside it', () => {
    write(join(root, RAFA_PROMPT), 'RAFA {{STRETCH}}\n');

    expect(engineerPromptFile(root, seams())).toEqual({ path: bundledPromptPath(entry), source: 'bundled' });
  });

  test('gives the rafa checkout its own prompt', () => {
    plantRafaCheckout();

    expect(engineerPromptFile(root, seams())).toEqual({ path: join(root, RAFA_PROMPT), source: 'rafa' });
  });

  test('gives the rafa checkout the default when its own prompt is not there', () => {
    plantRafaCheckout({ prompt: false });

    expect(engineerPromptFile(root, seams()).source).toBe('bundled');
  });

  test('prefers the project\'s own prompt, in the rafa checkout too', () => {
    plantRafaCheckout();
    write(join(root, PROJECT_PROMPT), 'MINE\n');

    expect(engineerPromptFile(root, seams())).toEqual({ path: join(root, PROJECT_PROMPT), source: 'project' });
  });
});

describe('fillPrompt', () => {
  test('writes the stretch and the one before it for every placeholder', () => {
    expect(fillPrompt('{{STRETCH}} after {{PREVIOUS}}, then {{STRETCH}} again', 4)).toBe('4 after 3, then 4 again');
  });

  test('drops each line naming {{PREVIOUS}} on a first stretch, and only there', () => {
    const text = 'Start {{STRETCH}}.\n\nRead {{PREVIOUS}}.\n\nCarry {{PREVIOUS}} too.\n\nGo.\n';

    expect(fillPrompt(text, 1)).toBe('Start 1.\n\nGo.\n');
    expect(fillPrompt(text, 2)).toBe('Start 2.\n\nRead 1.\n\nCarry 1 too.\n\nGo.\n');
  });

  test('squeezes a run of blank lines to one, as the script\'s cat -s does', () => {
    expect(fillPrompt('a\n\n\n\nb', 3)).toBe('a\n\nb');
    expect(fillPrompt('a\n \n\t\nb', 3)).toBe('a\n \nb');
  });

  test('leaves a text with no placeholder as it is', () => {
    expect(fillPrompt('Plain words.\n', 1)).toBe('Plain words.\n');
  });

  test('refuses a number that is no stretch number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => fillPrompt('x', bad)).toThrow('not a stretch number');
    }
  });
});

describe('engineerPrompt', () => {
  test('reads and fills the file it chose, naming it', () => {
    const path = installDefault('Start stretch {{STRETCH}}.\nRead {{PREVIOUS}}.\n');

    expect(engineerPrompt(root, 1, seams())).toEqual({ kind: 'read', path, source: 'bundled', text: 'Start stretch 1.\n' });
    expect(engineerPrompt(root, 5, seams())).toEqual({
      kind: 'read',
      path,
      source: 'bundled',
      text: 'Start stretch 5.\nRead 4.\n',
    });
  });

  test('fills the project\'s own prompt over the default', () => {
    installDefault();
    write(join(root, PROJECT_PROMPT), 'MINE {{STRETCH}} after {{PREVIOUS}}\n');

    const reading = engineerPrompt(root, 2, seams());

    expect(reading.kind).toBe('read');
    expect(reading.kind === 'read' && reading.text).toBe('MINE 2 after 1\n');
  });

  test('reads a default missing from the install as missing, naming the path', () => {
    const reading = engineerPrompt(root, 1, seams());

    expect(reading).toEqual({
      kind: 'missing',
      path: bundledPromptPath(entry),
      source: 'bundled',
      reason: `${bundledPromptPath(entry)} is missing`,
    });
  });
});

describe('the real seams', () => {
  test('read the running entry', () => {
    expect(defaultPromptSeams().entry).toBe(Bun.main);
  });

  test('read a missing file as null and pass any other failure on', () => {
    expect(nodePromptFs.readText(join(scratch, 'absent.md'))).toBeNull();
    expect(() => nodePromptFs.readText(scratch)).toThrow();
    expect(nodePromptFs.exists(entry)).toBe(true);
  });
});
