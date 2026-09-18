/**
 * No string or template literal under `src/` spells a command
 * `ralph <command>`.
 *
 * The binary is `rafa`, and a refusal or usage line naming the old
 * spelling sends a person to a command they do not have. The method is
 * still called ralph, so the tagline ({@link HELP_TAGLINE}) keeps the
 * word and is the one exempt literal; a comment or an identifier naming
 * it is no hit either, because the scan walks literals only.
 *
 * The planted literal in {@link PLANTED} is the control: this file is
 * excluded from the repository-wide scan, and a case scans this file on
 * its own and reads the plant back, so a scan that finds nothing
 * anywhere would fail here.
 */
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

import { HELP_TAGLINE } from '../cli/help.js';
import { CORE_REGISTRY } from '../commands/index.js';

/** The repository root, from this file. */
const REPO_ROOT = join(import.meta.dir, '..', '..');

/** This file, relative to `src/`: excluded from the repository scan, which it plants a hit in. */
const SELF = 'tests/user-facing-spelling.test.ts';

/** A literal naming a command under the old spelling, for the control. */
const PLANTED = 'Usage: ralph plan --spec=<spec-file>.md';

/**
 * Whether a literal is allowed to hold the word: the tagline names the
 * method, not a command, and a case asserting a help line carries it
 * whole.
 */
function isExempt(text: string): boolean {
  return text.includes(HELP_TAGLINE);
}

/** Every word the dispatcher routes on: a subject, its plural, an action, or an alias word. */
function commandWords(): ReadonlySet<string> {
  const words = new Set<string>();
  for (const subject of CORE_REGISTRY.subjects()) {
    words.add(subject.name);
    words.add(`${subject.name}s`);
  }
  for (const command of CORE_REGISTRY.commands({ includeHidden: true })) {
    words.add(command.subject);
    words.add(command.action);
  }
  for (const alias of CORE_REGISTRY.aliases()) {
    for (const word of alias.words) words.add(word);
  }
  return words;
}

/** Every string and template literal part in a source, with the line it opens on. */
function literalsOf(path: string, source: string): readonly (readonly [number, string])[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: (readonly [number, string])[] = [];
  const record = (node: ts.Node, text: string): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push([line + 1, text]);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) record(node, node.text);
    if (ts.isTemplateExpression(node)) {
      record(node.head, node.head.text);
      for (const span of node.templateSpans) record(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Each `ralph <command>` a source's literals hold, as
 * `<path>:<line>: ralph <word>`, in source order.
 */
export function oldSpellings(path: string, source: string, words: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const [line, text] of literalsOf(path, source)) {
    if (isExempt(text)) continue;
    for (const match of text.matchAll(/ralph ([a-z][a-z-]*)/g)) {
      const word = match[1] ?? '';
      if (words.has(word)) hits.push(`${path}:${line}: ralph ${word}`);
    }
  }
  return hits;
}

/** Every `.ts` file under `src/`, relative to `src/`, sorted. */
async function sourcePaths(): Promise<string[]> {
  const glob = new Bun.Glob('**/*.ts');
  const paths: string[] = [];
  for await (const path of glob.scan({ cwd: join(REPO_ROOT, 'src') })) paths.push(path);
  return paths.sort((a, b) => a.localeCompare(b));
}

describe('user-facing spelling', () => {
  test('no literal under src spells a command as ralph', async () => {
    const words = commandWords();
    const hits: string[] = [];
    for (const path of await sourcePaths()) {
      if (path === SELF) continue;
      const source = await Bun.file(join(REPO_ROOT, 'src', path)).text();
      hits.push(...oldSpellings(`src/${path}`, source, words));
    }
    expect(hits).toEqual([]);
  });

  test('the scan reads the planted literal in this file back', async () => {
    const source = await Bun.file(join(REPO_ROOT, 'src', SELF)).text();
    const hits = oldSpellings(`src/${SELF}`, source, commandWords());
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.endsWith(': ralph plan'))).toBe(true);
    expect(PLANTED).toContain('ralph plan');
  });

  test('a comment or an identifier naming the old spelling is no hit', () => {
    const source = [
      '// ralph plan is the old spelling.',
      '/** ralph effort report, in prose. */',
      'const ralph_plan_note = 1;',
      'export const note = ralph_plan_note;',
    ].join('\n');
    expect(oldSpellings('probe.ts', source, commandWords())).toEqual([]);
  });

  test('the tagline keeps the word', () => {
    const source = `export const tagline = ${JSON.stringify(HELP_TAGLINE)};`;
    expect(HELP_TAGLINE).toContain('ralph loop');
    expect(oldSpellings('probe.ts', source, commandWords())).toEqual([]);
  });
});
