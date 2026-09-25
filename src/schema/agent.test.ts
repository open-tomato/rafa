/**
 * Tests for the agent check.
 *
 * Every case is a literal mapping in and a list of issues out, each
 * refusal asserted as a code and a field beside the block that passes.
 * The provenance rules themselves are `provenance.test.ts`'s; the cases
 * here pin that the agent check reads them, with the same codes the
 * skill check reports, and where in field order they fall.
 */
import { describe, expect, test } from 'bun:test';

import {
  AGENT_ISSUE_CODES,
  REQUIRED_AGENT_FIELDS,
  checkAgentFrontmatter,
  parseAgentFrontmatter,
} from './agent.js';
import { readFrontmatter } from './frontmatter.js';
import { SKILL_ISSUE_CODES } from './skill.js';

/** The two required fields, filled. */
const MINIMAL = {
  name: 'code-reviewer',
  description: 'Reviews a diff for bugs and style',
} as const;

/** The issues for `data`, as `code@field`. */
function marks(data: Readonly<Record<string, unknown>>): string[] {
  return checkAgentFrontmatter(data).map((found) => `${found.code}@${found.field}`);
}

describe('a clean block', () => {
  test('name and description alone pass, with provenance null', () => {
    expect(parseAgentFrontmatter(MINIMAL)).toEqual({
      issues: [],
      agent: { ...MINIMAL, provenance: null },
    });
  });

  test('keys Claude Code reads and this check does not are passed over', () => {
    expect(marks({ ...MINIMAL, tools: 'Read, Grep', model: 'sonnet', effort: 'high' })).toEqual([]);
  });

  test('a definition read from text is the shape the check reads', () => {
    const data = readFrontmatter([
      '---',
      'name: tdd-guide',
      'description: Writes the failing test first',
      'provenance: { origin: https://github.com/example/agents, license: MIT }',
      '---',
      'body',
    ].join('\n'));

    expect(parseAgentFrontmatter(data!).agent?.provenance).toEqual({
      kind: 'third-party',
      origin: 'https://github.com/example/agents',
      license: 'MIT',
      reviewed: null,
    });
  });
});

describe('required fields', () => {
  for (const field of REQUIRED_AGENT_FIELDS) {
    test(`an absent ${field} is missing`, () => {
      const data: Record<string, unknown> = { ...MINIMAL };
      delete data[field];

      expect(marks(data)).toEqual([`missing-field@${field}`]);
      expect(parseAgentFrontmatter(data).agent).toBeNull();
    });

    test(`a blank ${field} is missing and a numeric one wrongly typed`, () => {
      expect(marks({ ...MINIMAL, [field]: ' ' })).toEqual([`missing-field@${field}`]);
      expect(marks({ ...MINIMAL, [field]: 3 })).toEqual([`wrong-type@${field}`]);
    });
  }

  test('a name that is not a bare file stem is invalid', () => {
    expect(marks({ ...MINIMAL, name: '../escape' })).toEqual(['invalid-name@name']);
    expect(marks({ ...MINIMAL, name: 'Explore_2' })).toEqual([]);
  });
});

describe('provenance', () => {
  test('first-party passes and parses', () => {
    expect(parseAgentFrontmatter({ ...MINIMAL, provenance: 'first-party' }).agent?.provenance)
      .toEqual({ kind: 'first-party' });
  });

  test('a mapping without origin is refused on the entry', () => {
    expect(marks({ ...MINIMAL, provenance: { license: 'MIT' } }))
      .toEqual(['missing-field@provenance.origin']);
  });

  test('it is reported after name and description', () => {
    expect(marks({ name: 'a b', provenance: 'mine' })).toEqual([
      'invalid-name@name',
      'missing-field@description',
      'unknown-provenance@provenance',
    ]);
  });
});

/** One block per code, so the set is closed at both ends. */
const CODE_EXAMPLES: Readonly<Record<string, Record<string, unknown>>> = {
  'missing-field': { name: MINIMAL.name },
  'wrong-type': { ...MINIMAL, description: ['a'] },
  'invalid-name': { ...MINIMAL, name: 'a/b' },
  'unknown-provenance': { ...MINIMAL, provenance: 'ours' },
  'invalid-reviewed': { ...MINIMAL, provenance: { origin: 'x', license: 'MIT', reviewed: 'nobody' } },
};

describe('every code is reachable', () => {
  for (const [code, data] of Object.entries(CODE_EXAMPLES)) {
    test(`${code} is produced`, () => {
      expect(checkAgentFrontmatter(data).map((found): string => found.code)).toContain(code);
    });
  }

  test('the codes the examples produce are exactly the declared set', () => {
    expect(Object.keys(CODE_EXAMPLES).sort()).toEqual([...AGENT_ISSUE_CODES].sort());
  });

  test('every agent code is also a skill code, so both report a rule alike', () => {
    for (const code of AGENT_ISSUE_CODES) expect(SKILL_ISSUE_CODES).toContain(code);
  });
});
