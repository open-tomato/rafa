/**
 * Tests for the search prompt template.
 *
 * The drift guard holds the rendered first line equal to the `search`
 * entry's prefix in `PROMPT_SHAPES`, and classifies the rendered prompt
 * through the classifier itself. Its control renders the same prompt
 * under another heading and reads `other`, so the guard is shown able
 * to fail rather than passing over a classifier that answers `search`
 * for anything.
 */
import type { SearchPromptInput } from './prompt.js';

import { describe, expect, test } from 'bun:test';

import { classifyPromptContent, PROMPT_SHAPES } from '../../effort/classify.js';

import { renderSearchPrompt, SEARCH_BLOCK_FENCE, SEARCH_PROMPT_PREFIX } from './prompt.js';

const INPUT: SearchPromptInput = {
  kind: 'skill',
  question: 'how should TSDoc comments be written',
  candidates: [
    { name: 'documentation', file: 'documentation/SKILL.md' },
    { name: 'coding-style', file: 'coding-style/SKILL.md' },
  ],
};

const SEARCH_SHAPE = PROMPT_SHAPES.find((shape) => shape.kind === 'search');

describe('the drift guard', () => {
  test('the rendered first line is the search classifier key', () => {
    const firstLine = renderSearchPrompt(INPUT).split('\n')[0];

    expect(SEARCH_SHAPE?.prefix).toBe(SEARCH_PROMPT_PREFIX);
    expect(firstLine).toBe(SEARCH_SHAPE?.prefix ?? 'no search shape');
  });

  test('the shape names this file as its source', () => {
    expect(SEARCH_SHAPE?.source).toBe('src/inventory/search/prompt.ts');
  });

  test('a rendered prompt classifies as search', () => {
    expect(classifyPromptContent(renderSearchPrompt(INPUT))).toBe('search');
  });

  test('the same prompt under another heading classifies as other', () => {
    const renamed = renderSearchPrompt(INPUT)
      .replace(SEARCH_PROMPT_PREFIX, '# Catalogue search instructions');

    expect(renamed).not.toStartWith(SEARCH_PROMPT_PREFIX);
    expect(classifyPromptContent(renamed)).toBe('other');
  });
});

describe('renderSearchPrompt', () => {
  test('names the item kind in the plural', () => {
    expect(renderSearchPrompt(INPUT)).toContain('the skills that answer');
    expect(renderSearchPrompt({ ...INPUT, kind: 'agent' })).toContain('the agents that answer');
  });

  test('lists every candidate with its file, in the order given', () => {
    const prompt = renderSearchPrompt(INPUT);
    const first = prompt.indexOf('- documentation: `documentation/SKILL.md`');
    const second = prompt.indexOf('- coding-style: `coding-style/SKILL.md`');

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  test('fences the question as text', () => {
    const lines = renderSearchPrompt(INPUT).split('\n');
    const at = lines.indexOf(INPUT.question);

    expect(lines[at - 1]).toBe('```text');
    expect(lines[at + 1]).toBe('```');
  });

  test('widens the fence past a backtick run in the question', () => {
    const question = 'what closes a ```` fence';
    const lines = renderSearchPrompt({ ...INPUT, question }).split('\n');
    const at = lines.indexOf(question);

    expect(lines[at - 1]).toBe('`````text');
    expect(lines[at + 1]).toBe('`````');
  });

  test('ends with the example block, fenced as rafa:search', () => {
    const prompt = renderSearchPrompt(INPUT);

    expect(SEARCH_BLOCK_FENCE).toBe('rafa:search');
    expect(prompt).toEndWith([
      '```rafa:search',
      'matches:',
      '  - name: documentation',
      '    why: "owns TSDoc blocks and inline comment rules"',
      '    quote: "Every exported symbol carries a TSDoc block"',
      '    line: 41',
      'unanswerable: false',
      '```',
      '',
    ].join('\n'));
  });

  test('tells the session what to write when nothing answers', () => {
    const prompt = renderSearchPrompt(INPUT);

    expect(prompt).toContain('`matches: []`');
    expect(prompt).toContain('`unanswerable: true`');
  });

  test('carries no file outside the candidates', () => {
    const prompt = renderSearchPrompt({ ...INPUT, candidates: [] });

    expect(prompt).not.toContain('SKILL.md');
  });
});
