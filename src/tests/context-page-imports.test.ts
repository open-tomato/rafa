/**
 * The `context/` pages are pointed at, not imported.
 *
 * The whole saving of the AGENTS.md split rests on one property that
 * no other check in this tree can see. `CLAUDE.md` line 1 reads
 * `Refer to @AGENTS.md`, and that `@` prefix is the import form: the
 * harness inlines the referenced file into every turn, recursively.
 * A map that pointed at its pages the same way — `@context/gates.md`
 * rather than `` `context/gates.md` `` — would pull all of them back
 * in and save nothing, while looking exactly like a split. The map
 * would still be 80 lines, the pages would still be separate files,
 * every gate would still be green, and the per-turn cost would be
 * what it was before the split.
 *
 * Nothing else catches that. `gate:control-bytes` opens the file and
 * reads bytes. `eslint` reaches root-level markdown but has no rule
 * about `@`. `agents-split-accounting.test.ts` beside this file checks
 * the split's ARITHMETIC — that every source line landed on exactly
 * one page — and is deliberately fixture-driven so the live pages can
 * keep growing under it. It would pass unchanged against a map whose
 * every pointer was an import. This file is the other half: the live
 * maps, read as they are on disk, asked the one question the fixture
 * cannot be asked.
 *
 * ## Why the live files
 *
 * A fixture here would assert that a string this file wrote does not
 * contain a character this file also wrote. The subject IS the tree,
 * so the maps are derived from it — the repo-root `AGENTS.md` plus
 * every `packages/<pkg>/AGENTS.md` — and a map counts as SPLIT when a
 * `context/` directory sits beside it. Three do today and one
 * (`packages/ui`) does not; the derivation covers a fourth split the
 * day it lands rather than needing a name added here.
 *
 * ## Masking, and the trap in the obvious masker
 *
 * `@ar/ui` is a package scope, not a path, and it appears all over
 * these maps inside code spans, where the import form is not
 * evaluated. So the matcher masks code regions first. The trap is
 * that the obvious masker is per LINE, and a code span in this tree
 * routinely wraps: a line ending mid-span carries an odd number of
 * backticks, and a per-line masker pairs that closing backtick with
 * the next OPENING one, leaving the span's real content unmasked.
 * Measured over the maps and pages at the commit this landed, a
 * per-line masker reported 12 bare `@` tokens where a masker pairing
 * backtick runs across line breaks reports 5 — eight of the twelve
 * were the second half of a wrapped span. A guard built on the
 * per-line form would have had to carry eight exceptions, and an
 * exception list is where a real violation hides.
 *
 * ## The controls
 *
 * Every claim here is a ZERO, and a zero is what a dead needle also
 * answers. Three controls separate the two. The matcher is run over
 * the `CLAUDE.md` importers, where it MUST find the deliberate
 * `@AGENTS.md` — a real-tree positive control, not a synthetic one.
 * It is run over each live map with a pointer rewritten into the
 * import form in memory, where it must find the plant. And the masker
 * has its own case, since a masker that blanked everything would make
 * every other zero here vacuous.
 *
 * The pointer side carries the same shape. "No pointer is
 * `@`-prefixed" is satisfied by a map with no pointers at all, so
 * every split map is required to point at every one of its sibling
 * pages and to name no page that does not exist — a bijection, which
 * at the landing commit held on all three maps (5, 8 and 9 pages).
 *
 * ## The mutation grid
 *
 * Sixteen legs over this file's own helpers, each asked for case NAMES
 * through `--reporter=json` and restored from a captured copy; all
 * sixteen applied, fifteen reddened, the union covers all 13 cases and
 * the file came back bytes-identical.
 *
 * The reading worth keeping is what the FIRST pass found. Fourteen
 * solo legs covered 10 of 12 cases, and the two they missed were the
 * two this file exists for — the map-line and plain-path zeros. Both
 * are guarded by a PAIR of rules that shadow each other: the word
 * boundary means `` `@ar/ui` `` is never a candidate (its `@` follows a
 * backtick, not whitespace), and the mask means it would be dropped
 * even if it were. Break either alone and the zeros stay zero. Only
 * the compound leg — no word boundary AND ignore the mask — reddens
 * the map-line case, and it names which pair carries the claim where
 * two solo greens name nothing.
 *
 * `no-paragraph-reset` was the other green, and it was a real gap
 * rather than a shadowed one: no fixture violated the rule until the
 * dangling-opener case was written for it. Without the reset that
 * opener pairs with a stray backtick two lines down and masks the
 * reference between them, which blinds the matcher for the rest of the
 * file. It reddens that case alone now.
 *
 * `scan-fenced-lines` is the one leg still green, and it is a semantic
 * no-op rather than a hole: fenced rows are blanked at the return
 * whatever the pairing loop did with them, so the edit changes
 * bookkeeping no caller can observe.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A reference in the harness's import form: `@` at a word boundary. */
const IMPORT_REFERENCE = /(?:^|\s)(@\S+)/g;

/** A pointer at a `context/` page, with whatever character precedes it. */
const CONTEXT_POINTER = /(.?)((?:[\w./-]*\/)?context\/([\w.-]+\.md))/g;

interface AgentsMap {
  readonly path: string;
  readonly text: string;
  /** Sibling `context/` directory, when the map has been split. */
  readonly contextDir: string | null;
  readonly pages: readonly string[];
}

/**
 * Blank fenced blocks and inline code spans, preserving every character
 * position so a hit's line and column still point at the real source.
 *
 * Backtick runs are paired across line breaks within a paragraph, which
 * is what CommonMark does and what a per-line masker gets wrong. A blank
 * line ends the paragraph and so abandons any unclosed run.
 */
export function maskCodeRegions(text: string): string[] {
  const lines = text.split('\n');
  const chars = lines.map((line) => [...line]);
  const fenced = lines.map(() => false);

  let fence: string | null = null;
  for (const [index, line] of lines.entries()) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      const marker = opener?.[1] ?? '';
      fenced[index] = true;
      if (marker !== '' && marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (opener) {
      fence = opener[1] ?? null;
      fenced[index] = true;
    }
  }

  let open: { line: number; column: number; length: number } | null = null;
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    if (line.trim() === '') {
      open = null;
      continue;
    }
    for (const run of line.matchAll(/`+/g)) {
      const length = run[0].length;
      const start = run.index;
      if (open === null) {
        open = { line: index, column: start, length };
        continue;
      }
      if (length !== open.length) continue;
      for (let row = open.line; row <= index; row += 1) {
        const target = chars[row];
        if (target === undefined) continue;
        const from = row === open.line
          ? open.column
          : 0;
        const to = row === index
          ? start + length
          : target.length;
        for (let col = from; col < Math.min(to, target.length); col += 1) target[col] = ' ';
      }
      open = null;
    }
  }

  return chars.map((row, index) => (fenced[index]
    ? ''
    : row.join('')));
}

/** Every import-form reference surviving the mask, in source order. */
export function importReferences(
  text: string,
): { line: number; column: number; token: string }[] {
  const masked = maskCodeRegions(text);
  const found: { line: number; column: number; token: string }[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    for (const hit of line.matchAll(IMPORT_REFERENCE)) {
      const token = hit[1] ?? '';
      const column = hit.index + hit[0].length - token.length;
      if ((masked[index] ?? '').charAt(column) !== '@') continue;
      found.push({ line: index + 1, column: column + 1, token });
    }
  }
  return found;
}

/**
 * Every `context/` page reference in the RAW text.
 *
 * Raw and not masked on purpose: a pointer here is written INSIDE a code
 * span, so masking first would hide the very thing being counted.
 */
export function contextPointers(
  text: string,
): { line: number; target: string; page: string; atPrefixed: boolean }[] {
  const found: { line: number; target: string; page: string; atPrefixed: boolean }[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    for (const hit of line.matchAll(CONTEXT_POINTER)) {
      found.push({
        line: index + 1,
        target: hit[2] ?? '',
        page: hit[3] ?? '',
        atPrefixed: hit[1] === '@',
      });
    }
  }
  return found;
}

/** The repo-root map plus every package map, derived from the tree. */
export function findAgentsMaps(root: string): AgentsMap[] {
  const dirs = [root];
  const packages = join(root, 'packages');
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages).sort()) {
      const dir = join(packages, entry);
      if (statSync(dir).isDirectory()) dirs.push(dir);
    }
  }

  const maps: AgentsMap[] = [];
  for (const dir of dirs) {
    const path = join(dir, 'AGENTS.md');
    if (!existsSync(path)) continue;
    const contextDir = join(dir, 'context');
    const split = existsSync(contextDir) && statSync(contextDir).isDirectory();
    maps.push({
      path: path.slice(root.length),
      text: readFileSync(path, 'utf8'),
      contextDir: split
        ? contextDir
        : null,
      pages: split
        ? readdirSync(contextDir).filter((f) => f.endsWith('.md'))
          .sort()
        : [],
    });
  }
  return maps;
}

/** The files that DO use the import form, and so prove the matcher bites. */
function findImporters(root: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const dir of [root, ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p))]) {
    const path = join(dir, 'CLAUDE.md');
    if (existsSync(path)) found.push({ path: path.slice(root.length), text: readFileSync(path, 'utf8') });
  }
  return found;
}

const MAPS = findAgentsMaps(REPO_ROOT);
const SPLIT_MAPS = MAPS.filter((map) => map.contextDir !== null);

describe('the context/ pages are pointed at, never imported', () => {
  it('derives a non-empty map set with the root map split', () => {
    expect(MAPS.length).toBeGreaterThan(0);
    expect(SPLIT_MAPS.length).toBeGreaterThan(0);
    expect(MAPS.map((map) => map.path)).toContain('AGENTS.md');
    expect(SPLIT_MAPS.map((map) => map.path)).toContain('AGENTS.md');
  });

  it('carries no import-form reference on any map line', () => {
    const offenders = MAPS.flatMap((map) => importReferences(map.text).map((hit) => `${map.path}:${hit.line}:${hit.column} ${hit.token}`));
    expect(offenders).toEqual([]);
  });

  it('writes every context/ pointer as a plain path', () => {
    const imported = MAPS.flatMap((map) => contextPointers(map.text)
      .filter((pointer) => pointer.atPrefixed)
      .map((pointer) => `${map.path}:${pointer.line} @${pointer.target}`));
    expect(imported).toEqual([]);
  });

  it.each(SPLIT_MAPS.map((map) => [map.path, map] as const))(
    '%s points at every one of its pages and at no page that is missing',
    (_path, map) => {
      const targets = new Set(contextPointers(map.text).map((pointer) => pointer.page));
      expect(map.pages.length).toBeGreaterThan(0);
      expect([...targets].sort()).toEqual([...map.pages]);
    },
  );

  it('finds the deliberate import in the CLAUDE.md files it is aimed at', () => {
    const importers = findImporters(REPO_ROOT);
    expect(importers.length).toBeGreaterThan(0);
    for (const importer of importers) {
      const tokens = importReferences(importer.text).map((hit) => hit.token);
      expect(tokens).toContain('@AGENTS.md');
    }
  });

  it.each(SPLIT_MAPS.map((map) => [map.path, map] as const))(
    'reports a pointer rewritten into the import form in %s',
    (_path, map) => {
      // The plant and its expectation are both built from the sibling
      // page list on disk, so neither comes from a parser under test.
      const page = map.pages[0];
      const listed = `- \`context/${page}\``;
      expect(map.text.split(listed)).toHaveLength(2);
      const planted = map.text.replace(listed, `- @context/${page}`);
      expect(planted).not.toEqual(map.text);
      expect(importReferences(planted).map((hit) => hit.token)).toContain(`@context/${page}`);
      expect(contextPointers(planted).filter((pointer) => pointer.atPrefixed)).toHaveLength(1);
    },
  );

  it('masks a span without blinding the matcher beside it', () => {
    const text = ['Uses `@ar/ui` here and @context/gates.md there.', '', '```', '@fenced/one.md', '```'].join(
      '\n',
    );
    expect(importReferences(text).map((hit) => hit.token)).toEqual(['@context/gates.md']);
  });

  it('abandons an unclosed span at the blank line rather than masking on', () => {
    // Without the paragraph reset the dangling opener on line 1 pairs with
    // the stray backtick on line 3 and masks the reference between them,
    // which blinds the matcher for the rest of the file.
    const dangling = ['a `dangling span opener', '', '@after/the/blank.md and a ` closer'].join('\n');
    expect(importReferences(dangling).map((hit) => hit.token)).toEqual(['@after/the/blank.md']);
  });

  it('masks a code span that wraps across a line break', () => {
    const wrapped = ['a `span opening here', 'and @ar/web closing here` then @real/one.md', ''].join('\n');
    expect(importReferences(wrapped).map((hit) => hit.token)).toEqual(['@real/one.md']);
  });
});
