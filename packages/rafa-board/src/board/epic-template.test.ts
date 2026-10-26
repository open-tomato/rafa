/**
 * Tests for the epic issue template (`epic-template.ts`): what
 * `readEpicBody` reads from the rendered body, the placeholder lines
 * read as unchecked, and a template the renderer refuses.
 *
 * The shipped template is read from the checkout; every refusal case is a
 * literal string, and the missing-file case reads under this file's own
 * temporary root.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readEpicBody } from './epic-body.js';
import {
  CRITERIA_PLACEHOLDERS,
  PLACEHOLDER_REASON,
  epicTemplateSource,
  placeholderCriteria,
  readEpicTemplate,
  renderEpicBody,
} from './epic-template.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-template-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The one placeholder line, which a case needs by value. */
const PLACEHOLDER = CRITERIA_PLACEHOLDERS[0] ?? '';

/** A template shaped as the shipped one, with `criteria` under its heading. */
function templateWith(criteria: string, checklist = ''): string {
  return [
    '## Acceptance criteria',
    '',
    criteria,
    '',
    '## Scope',
    '',
    'Estimate:',
    'Date:',
    'Owns:',
    '',
    '## Specs',
    '',
    checklist,
  ].join('\n');
}

describe('the rendered body, as readEpicBody reads it', () => {
  it('holds the placeholder criteria alone, with the field lines outside the section', () => {
    const read = readEpicBody(renderEpicBody());

    expect(read.criteria).toBe(CRITERIA_PLACEHOLDERS.join('\n'));
  });

  it('carries the Estimate, Date and Owns lines, blank, and an empty checklist', () => {
    const body = renderEpicBody();
    const read = readEpicBody(body);

    expect(body.split('\n')).toEqual(expect.arrayContaining(['Estimate:', 'Date:', 'Owns:']));
    expect(read.estimate).toBeNull();
    expect(read.date).toBeNull();
    expect(read.owns).toEqual([]);
    expect(read.lines).toEqual([]);
  });

  it('reports the blank estimate and the blank date, and nothing about the criteria', () => {
    const read = readEpicBody(renderEpicBody());

    expect(read.problems.map((problem) => [problem.kind, problem.text])).toEqual([
      ['no-estimate', ''],
      ['malformed-date', ''],
    ]);
  });

  it('reads a checklist line appended at the end as the epic\'s first, under the last heading', () => {
    const body = `${renderEpicBody().trimEnd()}\n\n- [ ] #245 the listing\n`;
    const read = readEpicBody(body);

    expect(read.lines.map((line) => line.issue)).toEqual([245]);
    expect(read.criteria).toBe(CRITERIA_PLACEHOLDERS.join('\n'));
  });

  it('answers the shipped file byte for byte', () => {
    expect(renderEpicBody()).toBe(readEpicTemplate());
  });
});

describe('placeholderCriteria', () => {
  it('reads every placeholder the rendered body still holds as unchecked', () => {
    const read = readEpicBody(renderEpicBody());

    expect(placeholderCriteria(read.criteria)).toEqual(CRITERIA_PLACEHOLDERS.map((text) => ({
      text,
      reason: PLACEHOLDER_REASON,
    })));
  });

  it('answers the placeholder beside a criterion an author wrote, and only it', () => {
    const criteria = `- \`rafa roadmap\` lists epics by horizon.\r\n  ${PLACEHOLDER}  \r\n- Another.`;

    expect(placeholderCriteria(criteria).map((held) => held.text)).toEqual([PLACEHOLDER]);
  });

  it('reads an edited placeholder as the author\'s own criterion', () => {
    const edited = PLACEHOLDER.replace('finished', 'done');

    expect(placeholderCriteria(edited)).toEqual([]);
    expect(placeholderCriteria(PLACEHOLDER.replace('- ', '* '))).toEqual([]);
  });

  it('answers nothing for null criteria', () => {
    expect(placeholderCriteria(null)).toEqual([]);
  });
});

describe('renderEpicBody refusing a template', () => {
  it('accepts a template shaped as the shipped one, the control for the refusals below', () => {
    const template = templateWith(PLACEHOLDER);

    expect(renderEpicBody(template)).toBe(template);
  });

  it('refuses a template with no criteria section', () => {
    expect(() => renderEpicBody('Estimate:\nDate:\nOwns:\n')).toThrow('carries no acceptance criteria section');
  });

  it('refuses criteria that lost the placeholder', () => {
    expect(() => renderEpicBody(templateWith('- A real criterion.'))).toThrow('has lost 1 of its placeholder lines');
  });

  it('refuses a template carrying a checklist line', () => {
    expect(() => renderEpicBody(templateWith(PLACEHOLDER, '- [ ] #12 a member'))).toThrow('carries 1 checklist lines');
  });
});

describe('the shipped file', () => {
  it('is looked for under templates/ beside the module', () => {
    expect(epicTemplateSource('/x/board')).toBe(join('/x/board', 'templates', 'epic.md'));
  });

  it('opens no line of its comments with a field name, so no guidance is read as a field', () => {
    const comments = readEpicTemplate().split('\n')
      .filter((line) => line.startsWith('<!--'));

    expect(comments.length).toBeGreaterThan(0);
    for (const line of comments) expect(line).toMatch(/-->$/u);
  });

  it('throws naming the path when the template is not there', () => {
    expect(() => readEpicTemplate(tempBase)).toThrow(join(tempBase, 'templates', 'epic.md'));
  });
});
