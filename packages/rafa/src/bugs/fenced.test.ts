import { describe, expect, test } from 'bun:test';

import { fenced } from './fenced.js';

describe('fenced', () => {
  test('a value with no backticks takes the three-backtick fence', () => {
    expect(fenced('plain')).toBe('```\nplain\n```');
  });

  test('a fence is one backtick longer than the longest run the value holds', () => {
    const value = 'a ` one, a ``` three and a ````` five';
    expect(fenced(value)).toBe(`\`\`\`\`\`\`\n${value}\n\`\`\`\`\`\``);
  });

  test('runs shorter than the minimum keep the three-backtick fence', () => {
    expect(fenced('`x` and ``y``')).toBe('```\n`x` and ``y``\n```');
  });

  test('a value ending in a newline gains no second one', () => {
    expect(fenced('line\n')).toBe('```\nline\n```');
  });
});
