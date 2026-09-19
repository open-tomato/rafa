/**
 * The spec issue template (`src/board/templates/spec.md`) is the
 * document `src/board/readiness.ts` checks a body against, and the two
 * are tracked apart: the template is a package asset, copied into
 * `dist/templates/` by the build (`./package-build.test.ts`) and written
 * into a project's `.github/ISSUE_TEMPLATE/` by `rafa init --board`,
 * while the headings it carries live in code as
 * {@link TEMPLATE_HEADINGS}. Nothing but this file holds the two
 * together, so an author editing one and not the other ships a template
 * whose sections the gate does not recognise — a body filled in exactly
 * as asked, refused for every heading being missing.
 *
 * So the live claims here are all about the FILE as tracked:
 *
 *  - its front matter labels the issue `type:spec`, which is what
 *    `src/board/issue.ts` refuses an issue for not carrying
 *    ({@link SPEC_LABEL}), read through `Bun.YAML.parse` rather than a
 *    substring search, so `type:spec` appearing anywhere else in the
 *    body cannot satisfy it;
 *  - its headings are {@link TEMPLATE_HEADINGS}, in that order and with
 *    nothing else at their level. Order is not checked by the gate
 *    (`readiness.ts` says why), and it is checked here, because the
 *    order is what the author reads down;
 *  - its first comment line is the one that says no local paths, since
 *    issue bodies are public (`.specs/rafa-20-pr-commands.md`), and it
 *    sits above every section so it is read before anything is typed.
 *
 * ## The two readings that could pass while wrong
 *
 * A heading list read off the file with the same normalisation the gate
 * uses would agree with the gate however both were broken. So the
 * headings are read here with a plain `## ` prefix match and compared to
 * the exported constant, and the FILLED template is then run through
 * {@link findReadinessGaps} with its comments removed and an item put
 * under each list heading: it answers no gap, which is the reading that
 * says an author who does as the template asks gets a plannable body.
 *
 * Its control is the template as shipped, which is asserted to answer
 * gaps — every guidance comment is an unfilled template comment and the
 * two bullets are empty — so the check is one that can fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { SPEC_LABEL } from '../board/issue.js';
import { findReadinessGaps, LIST_HEADINGS, TEMPLATE_HEADINGS } from '../board/readiness.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Where the template is tracked, from the repository root. */
const TEMPLATE_PATH = 'src/board/templates/spec.md';

const TEMPLATE = readFileSync(join(REPO_ROOT, TEMPLATE_PATH), 'utf8');

/** What the first comment line is asserted to carry. */
const PUBLIC_WORDS = ['public', 'local paths', 'credentials'];

/** The front matter of the template, parsed. */
function frontMatter(): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(TEMPLATE);
  if (match === null) throw new Error(`${TEMPLATE_PATH} carries no front matter`);
  return Bun.YAML.parse(match[1] ?? '') as Record<string, unknown>;
}

/** Every `## ` heading of the template, in the order it writes them. */
function headings(): readonly string[] {
  return TEMPLATE.split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice('## '.length).trim());
}

/** The text of the first HTML comment in the template. */
function firstComment(): string {
  const start = TEMPLATE.indexOf('<!--');
  const end = TEMPLATE.indexOf('-->', start);
  if (start === -1 || end === -1) throw new Error(`${TEMPLATE_PATH} carries no comment`);
  return TEMPLATE.slice(start + '<!--'.length, end);
}

/** The template as an author leaves it: comments deleted, one item per list. */
function filledTemplate(): string {
  const withoutComments = TEMPLATE.replace(/^---\n[\s\S]*?\n---\n/u, '')
    .replace(/<!--[\s\S]*?-->\n?/gu, '');

  return withoutComments.split('\n')
    .map((line) => (line === '-'
      ? '- one thing that can be shown by a command'
      : line))
    .join('\n')
    .replace(/(## [^\n]+\n)\n(?=\n*(?:## |$))/gu, '$1\nWhat this section says.\n');
}

describe('the spec issue template', () => {
  it('labels the issue type:spec, which is the label the issue read refuses without', () => {
    expect(frontMatter()['labels']).toBe(SPEC_LABEL);
  });

  it('carries the template headings, in the order the code declares them', () => {
    expect(headings()).toEqual([...TEMPLATE_HEADINGS]);
  });

  it('opens with the comment saying the issue is public and takes no local path', () => {
    const opening = firstComment().toLowerCase();
    for (const word of PUBLIC_WORDS) expect(opening).toContain(word);
    expect(TEMPLATE.indexOf('<!--')).toBeLessThan(TEMPLATE.indexOf('## '));
  });

  it('leaves the two list sections for the author to fill, each with a bullet waiting', () => {
    for (const heading of LIST_HEADINGS) {
      const section = TEMPLATE.slice(TEMPLATE.indexOf(`## ${heading}`));
      expect(section).toContain('\n-\n');
    }
  });

  it('answers no gap once it is filled in as it asks, where as shipped it answers gaps', () => {
    expect(findReadinessGaps(filledTemplate())).toEqual([]);
    // The control: the template as tracked is a template, not a ready spec.
    expect(findReadinessGaps(TEMPLATE).length).toBeGreaterThan(0);
  });
});
