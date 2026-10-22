/**
 * Tests for the documentation-only reading (`packages/rafa/src/triage/doc-only.ts`).
 *
 * The module is pure — a text in, a boolean out — so every case is a
 * literal. A reading that answered `false` for everything would pass each
 * negative case here, and one that answered `true` for everything each
 * positive one, so the negatives are paired: each takes a text that
 * answers `true` and changes the one thing the case is about.
 */
import { describe, expect, it } from 'bun:test';

import { namesOnlyDocs, pathsNamedIn } from './doc-only.js';

describe('namesOnlyDocs', () => {
  it('answers true for each kind of documentation path alone', () => {
    const texts = [
      'context/triage.md still lists three channels',
      'the guide in docs/guide.mdx is out of date',
      'docs/ has no page for the release issue',
      'context/ names a command that was removed',
      'docs/survey/answers.csv has a stale header',
      'README names a flag that no longer exists',
      'CHANGELOG has no entry for 0.4.0',
      'README.txt is stale',
      'AGENTS.md is over its line cap',
      'notes.MD is stale',
    ];
    for (const text of texts) {
      expect([text, namesOnlyDocs(text)]).toEqual([text, true]);
    }
  });

  it('answers true when every one of several paths is documentation', () => {
    expect(namesOnlyDocs('README.md and context/cli.md disagree with docs/CUTOVER.md')).toBe(true);
  });

  it('answers false for a text naming no path', () => {
    expect(namesOnlyDocs('the page says three channels')).toBe(false);
    expect(namesOnlyDocs('')).toBe(false);
    // The same sentence, with the page named: the path is what turns it.
    expect(namesOnlyDocs('context/triage.md says three channels')).toBe(true);
  });

  it('answers false for a text mixing a source path with a page', () => {
    expect(namesOnlyDocs('context/triage.md says three channels, src/triage/triage.ts has four')).toBe(false);
    expect(namesOnlyDocs('triage.ts disagrees with README.md')).toBe(false);
    // The page alone, the source path gone, answers true.
    expect(namesOnlyDocs('context/triage.md says three channels, the code has four')).toBe(true);
  });

  it('answers false for a .test.ts path, with a slash and bare', () => {
    expect(namesOnlyDocs('packages/rafa/src/triage/doc-only.test.ts fails under the full suite')).toBe(false);
    expect(namesOnlyDocs('doc-only.test.ts fails under the full suite')).toBe(false);
    expect(namesOnlyDocs('README.md is right, doc-only.test.ts is not')).toBe(false);
  });

  it('reads the folder rule on the first segment only', () => {
    expect(namesOnlyDocs('src/docs/issue.ts writes the wrong title')).toBe(false);
    expect(namesOnlyDocs('src/context/page.ts drops a line')).toBe(false);
    expect(namesOnlyDocs('./docs/guide.txt is stale')).toBe(true);
    // A page is one by its extension wherever it sits.
    expect(namesOnlyDocs('src/docs/NOTES.md is stale')).toBe(true);
  });

  it('reads a path through its quotes, its position and the sentence around it', () => {
    expect(namesOnlyDocs('see `context/triage.md:12:3`.')).toBe(true);
    expect(namesOnlyDocs('stale: (README.md), "docs/guide.md"; CHANGELOG.')).toBe(true);
    expect(namesOnlyDocs('see `src/start.ts:12`.')).toBe(false);
    expect(namesOnlyDocs('README.md,src/start.ts')).toBe(false);
  });

  it('does not take a URL, a dotted name or a figure for a path', () => {
    const page = 'README.md is stale';
    const notPaths = [
      'https://github.com/open-tomato/rafa/blob/main/src/start.ts',
      'TaskReport.staleDocs',
      'Bun.file',
      'e.g.',
      '24/7',
      '2026/10/14',
      'v1.2.3',
    ];
    for (const piece of notPaths) {
      // Alone it names no path; beside a page it leaves the page alone.
      expect([piece, namesOnlyDocs(piece)]).toEqual([piece, false]);
      expect([piece, namesOnlyDocs(`${page} (${piece})`)]).toEqual([piece, true]);
    }
  });

  it('reads a one-slash piece of prose as a path, so the text answers false', () => {
    // The documented limit: `and/or` has the shape of `src/triage`.
    expect(namesOnlyDocs('README.md and/or CHANGELOG.md are stale')).toBe(false);
    expect(namesOnlyDocs('README.md and CHANGELOG.md are stale')).toBe(true);
  });
});

describe('pathsNamedIn', () => {
  it('answers no path for a text naming none', () => {
    expect(pathsNamedIn('the page says three channels')).toEqual([]);
    expect(pathsNamedIn('')).toEqual([]);
  });

  it('answers every path in the order the text names them, punctuation and position taken off', () => {
    const text = 'see `src/start.ts:12`, then README.md and ./docs/guide.md:3:1.';

    expect(pathsNamedIn(text)).toEqual(['src/start.ts', 'README.md', './docs/guide.md']);
  });

  it('answers no URL, dotted name or figure, the path beside them kept', () => {
    const text = 'https://example.invalid/src/a.ts TaskReport.staleDocs 24/7 v1.2.3 src/a.ts';

    expect(pathsNamedIn(text)).toEqual(['src/a.ts']);
  });
});
