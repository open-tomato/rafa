/**
 * Tests for skill frontmatter v2.
 *
 * Every case is a literal mapping in and a list of issues out; the
 * module opens no file, so there is no fixture tree. What the cases
 * are built to avoid is the shape a schema test slips into by
 * default — asserting that a broken block produces SOME issue, which
 * a module returning one issue for everything would pass. So each
 * refusal is asserted as a code AND a field, each is paired with the
 * nearly-identical block that passes, and {@link
 * everyCodeIsReachable} closes the set: the codes the table below
 * provokes are compared to {@link SKILL_ISSUE_CODES} in both
 * directions, so a code nothing can produce and a code produced by
 * nothing named here are both red.
 *
 * ## The `paths` cases carry Bun controls
 *
 * The rule the spec states is that a `paths` entry is a glob
 * `Bun.Glob` accepts, and measured on Bun 1.3.14 `Bun.Glob` accepts
 * every string: the cases under `paths` assert directly that
 * `new Bun.Glob('{a')` and `new Bun.Glob('')` construct without
 * throwing, so the reading "the constructor cannot catch this" is
 * measured here rather than assumed in the module note.
 *
 * Each refused pattern is then paired with the `Bun.Glob` match that
 * shows what it silently does instead — `**\/*.{kt,kts` matching
 * `src/a.kt` and NOT `src/a.kts`, `[abc` matching neither `a` nor its
 * own text, `**\/*.kt}` matching only a literal brace. Those are the
 * assertions that would redden if a Bun upgrade made the patterns
 * behave, which is the day the rule should be revisited.
 *
 * ## The two length caps are measured at the boundary
 *
 * 129 and 130 characters, 1,535 and 1,536 together: the passing half
 * of each pair is what makes the failing half a reading about the
 * limit rather than about long strings. One further case is a
 * description of 129 astral characters, whose `String.length` is 258;
 * it passes, and the `.length` value is asserted beside it, so the
 * counting unit is pinned as codepoints rather than UTF-16 units.
 */
import { describe, expect, test } from 'bun:test';

import { readFrontmatter } from './frontmatter.js';
import {
  DESCRIPTION_LIMIT,
  FORBIDDEN_SKILL_FIELDS,
  LISTING_LIMIT,
  REQUIRED_SKILL_FIELDS,
  SKILL_ISSUE_CODES,
  SKILL_NAME_PATTERN,
  SKILL_SIGNALS,
  checkSkillFrontmatter,
  countCharacters,
  globProblem,
  isSkillName,
  listingLength,
  parseSkillFrontmatter,
} from './skill.js';

/** The four required fields, filled with values every check accepts. */
const MINIMAL = {
  name: 'drizzle-custom-migration-traps',
  description: 'Traps in hand-written Drizzle migrations',
  tags: ['drizzle', 'migrations', 'sql'],
  stack: ['typescript', 'postgres'],
} as const;

/** Every v2 field at once, including the ones Claude Code reads. */
const COMPLETE = {
  ...MINIMAL,
  origin: 'auto-extracted',
  prevents: 'a swallowed DDL statement in a --custom migration',
  signal: 'silent',
  when_to_use: 'When editing a Drizzle migration. Prevents: a swallowed DDL statement',
  paths: ['**/*.ts', '**/*.sql'],
  relates: ['drizzle-orm'],
  supersedes: [],
  'disable-model-invocation': true,
  'user-invocable': false,
} as const;

/** `data` with `changes` applied and an `undefined` change removing its key. */
function withFields(
  data: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

/** Every issue as `code@field`, which is what the cases assert on. */
function marks(data: Readonly<Record<string, unknown>>): string[] {
  return checkSkillFrontmatter(data).map((found) => `${found.code}@${found.field}`);
}

/** A string of `length` ASCII characters. */
function filler(length: number): string {
  return 'x'.repeat(length);
}

describe('a block the schema accepts', () => {
  test('the four required fields alone are enough', () => {
    expect(checkSkillFrontmatter(MINIMAL)).toEqual([]);
  });

  test('every v2 field together is accepted', () => {
    expect(checkSkillFrontmatter(COMPLETE)).toEqual([]);
  });

  test('keys outside the schema are neither read nor refused', () => {
    const data = withFields(MINIMAL, {
      origin: 'ECC',
      'license-note': 'internal',
      allowed_tools: ['Bash'],
    });

    expect(checkSkillFrontmatter(data)).toEqual([]);
  });

  test('a minimal block parses with every optional field defaulted', () => {
    const { issues, skill } = parseSkillFrontmatter(MINIMAL);

    expect(issues).toEqual([]);
    expect(skill).toEqual({
      name: 'drizzle-custom-migration-traps',
      description: 'Traps in hand-written Drizzle migrations',
      tags: ['drizzle', 'migrations', 'sql'],
      stack: ['typescript', 'postgres'],
      prevents: null,
      signal: null,
      whenToUse: null,
      paths: [],
      relates: [],
      supersedes: [],
      disableModelInvocation: false,
      userInvocable: false,
      provenance: null,
    });
  });

  test('a complete block parses with the hyphenated keys renamed', () => {
    const { skill } = parseSkillFrontmatter(COMPLETE);

    expect(skill?.prevents).toBe('a swallowed DDL statement in a --custom migration');
    expect(skill?.signal).toBe('silent');
    expect(skill?.whenToUse).toBe(COMPLETE.when_to_use);
    expect(skill?.paths).toEqual(['**/*.ts', '**/*.sql']);
    expect(skill?.relates).toEqual(['drizzle-orm']);
    expect(skill?.supersedes).toEqual([]);
    expect(skill?.disableModelInvocation).toBe(true);
    expect(skill?.userInvocable).toBe(false);
  });

  test('a block read by the frontmatter reader is the shape the schema checks', () => {
    const text = [
      '---',
      'name: verification-loop',
      'description: Run the gates in order and read each exit code',
      'tags: [verification, gates]',
      'stack: [agnostic]',
      'user-invocable: false',
      '---',
      '',
      '# Verification loop',
      '',
    ].join('\n');

    const data = readFrontmatter(text);

    expect(data).not.toBeNull();
    expect(checkSkillFrontmatter(data ?? {})).toEqual([]);
    expect(parseSkillFrontmatter(data ?? {}).skill?.stack).toEqual(['agnostic']);
  });

  test('a block with an issue parses to no skill at all', () => {
    const { issues, skill } = parseSkillFrontmatter(withFields(MINIMAL, { tags: undefined }));

    expect(skill).toBeNull();
    expect(issues.map((found) => found.code)).toEqual(['missing-field']);
  });
});

describe('the four required fields', () => {
  test('the declared list is the four the spec names', () => {
    expect(REQUIRED_SKILL_FIELDS).toEqual(['name', 'description', 'tags', 'stack']);
  });

  for (const field of REQUIRED_SKILL_FIELDS) {
    test(`an absent ${field} is a missing-field`, () => {
      expect(marks(withFields(MINIMAL, { [field]: undefined })))
        .toEqual([`missing-field@${field}`]);
    });

    test(`a null ${field} is a missing-field`, () => {
      expect(marks(withFields(MINIMAL, { [field]: null })))
        .toEqual([`missing-field@${field}`]);
    });
  }

  test('a blank description is missing rather than wrongly typed', () => {
    expect(marks(withFields(MINIMAL, { description: '   ' })))
      .toEqual(['missing-field@description']);
  });

  test('an empty tags list is missing rather than accepted', () => {
    expect(marks(withFields(MINIMAL, { tags: [] }))).toEqual(['missing-field@tags']);
  });

  test('an empty stack list is missing rather than accepted', () => {
    expect(marks(withFields(MINIMAL, { stack: [] }))).toEqual(['missing-field@stack']);
  });

  test('a name that is a number is wrongly typed, and the message says so', () => {
    const [found] = checkSkillFrontmatter(withFields(MINIMAL, { name: 7 }));

    expect(found?.code).toBe('wrong-type');
    expect(found?.message).toBe('name must be a string, not a number');
  });

  test('tags written as one string is wrongly typed', () => {
    expect(marks(withFields(MINIMAL, { tags: 'drizzle, migrations' })))
      .toEqual(['wrong-type@tags']);
  });

  test('a tags entry that is not a string is named by its index', () => {
    expect(marks(withFields(MINIMAL, { tags: ['drizzle', 7, ''] })))
      .toEqual(['wrong-type@tags[1]', 'wrong-type@tags[2]']);
  });

  test('two broken required fields are both named in one pass', () => {
    expect(marks(withFields(MINIMAL, { description: undefined, stack: undefined })))
      .toEqual(['missing-field@description', 'missing-field@stack']);
  });
});

describe('the name shape', () => {
  for (const name of ['drizzle-orm', 'a', 'sqlite3-wal', 'x1-y2-z3']) {
    test(`"${name}" is a skill name`, () => {
      expect(isSkillName(name)).toBe(true);
      expect(marks(withFields(MINIMAL, { name }))).toEqual([]);
    });
  }

  for (const name of ['Drizzle-ORM', 'trailing-', '-leading', 'double--hyphen', 'has_underscore', 'has space']) {
    test(`"${name}" is refused as invalid-name`, () => {
      expect(isSkillName(name)).toBe(false);
      expect(marks(withFields(MINIMAL, { name }))).toEqual(['invalid-name@name']);
    });
  }

  test('the pattern is anchored at both ends', () => {
    expect(SKILL_NAME_PATTERN.test('ok\nnot ok')).toBe(false);
  });
});

describe('the description limit', () => {
  test('the limit is the 130 the spec names', () => {
    expect(DESCRIPTION_LIMIT).toBe(130);
    expect(marks(withFields(MINIMAL, { description: filler(129) }))).toEqual([]);
    expect(marks(withFields(MINIMAL, { description: filler(130) })))
      .toEqual(['description-too-long@description']);
  });

  test(`${DESCRIPTION_LIMIT - 1} characters is accepted`, () => {
    expect(marks(withFields(MINIMAL, { description: filler(DESCRIPTION_LIMIT - 1) })))
      .toEqual([]);
  });

  test(`${DESCRIPTION_LIMIT} characters is refused`, () => {
    expect(marks(withFields(MINIMAL, { description: filler(DESCRIPTION_LIMIT) })))
      .toEqual(['description-too-long@description']);
  });

  test('the message names the length and the limit', () => {
    const [found] = checkSkillFrontmatter(
      withFields(MINIMAL, { description: filler(DESCRIPTION_LIMIT + 11) }),
    );

    expect(found?.message).toBe('description is 141 characters, and the limit is 130');
  });

  test('characters are codepoints, so astral characters count once', () => {
    const description = '\u{1F600}'.repeat(DESCRIPTION_LIMIT - 1);

    expect(description.length).toBe((DESCRIPTION_LIMIT - 1) * 2);
    expect(countCharacters(description)).toBe(DESCRIPTION_LIMIT - 1);
    expect(marks(withFields(MINIMAL, { description }))).toEqual([]);
  });
});

describe('the listing cap', () => {
  const description = filler(100);

  test('the cap is the 1536 the spec names', () => {
    expect(LISTING_LIMIT).toBe(1536);
    expect(marks(withFields(MINIMAL, { description, when_to_use: filler(1435) })))
      .toEqual([]);
    expect(marks(withFields(MINIMAL, { description, when_to_use: filler(1436) })))
      .toEqual(['listing-too-long@description + when_to_use']);
  });

  test(`${LISTING_LIMIT - 1} characters together is accepted`, () => {
    const data = withFields(MINIMAL, {
      description,
      when_to_use: filler(LISTING_LIMIT - 1 - description.length),
    });

    expect(listingLength(data)).toBe(LISTING_LIMIT - 1);
    expect(marks(data)).toEqual([]);
  });

  test(`${LISTING_LIMIT} characters together is refused`, () => {
    const data = withFields(MINIMAL, {
      description,
      when_to_use: filler(LISTING_LIMIT - description.length),
    });

    expect(listingLength(data)).toBe(LISTING_LIMIT);
    expect(marks(data)).toEqual(['listing-too-long@description + when_to_use']);
  });

  test('the message names the total and the cap', () => {
    const data = withFields(MINIMAL, { description, when_to_use: filler(LISTING_LIMIT) });
    const [found] = checkSkillFrontmatter(data);

    expect(found?.message).toBe(
      'description and when_to_use are 1636 characters together, '
      + 'and Claude Code truncates the listing at 1536',
    );
  });

  test('a when_to_use that is not a string is wrongly typed and not counted', () => {
    expect(marks(withFields(MINIMAL, { when_to_use: ['a', 'b'] })))
      .toEqual(['wrong-type@when_to_use']);
  });

  test('a when_to_use written empty is a missing field', () => {
    expect(marks(withFields(MINIMAL, { when_to_use: '' })))
      .toEqual(['missing-field@when_to_use']);
  });

  test('listingLength ignores a field that is not a string', () => {
    expect(listingLength({ description: 'abcd', when_to_use: 12 })).toBe(4);
    expect(listingLength({})).toBe(0);
  });
});

describe('the stack vocabulary', () => {
  test('exactly agnostic is accepted', () => {
    expect(marks(withFields(MINIMAL, { stack: ['agnostic'] }))).toEqual([]);
  });

  test('agnostic mixed with a name is refused as a whole-list rule', () => {
    const [found] = checkSkillFrontmatter(
      withFields(MINIMAL, { stack: ['agnostic', 'kotlin'] }),
    );

    expect(found?.code).toBe('unknown-stack');
    expect(found?.field).toBe('stack');
    expect(found?.message).toBe('agnostic is either the whole stack list or no part of it');
  });

  test('a name outside the vocabulary is named by its index', () => {
    expect(marks(withFields(MINIMAL, { stack: ['kotlin', 'cobol'] })))
      .toEqual(['unknown-stack@stack[1]']);
  });

  test('a repeated unknown name is named at each index it sits at', () => {
    expect(marks(withFields(MINIMAL, { stack: ['cobol', 'kotlin', 'cobol'] })))
      .toEqual(['unknown-stack@stack[0]', 'unknown-stack@stack[2]']);
  });

  test('an ungated vocabulary name is still a vocabulary name', () => {
    expect(marks(withFields(MINIMAL, { stack: ['postgres'] }))).toEqual([]);
  });

  test('a stack entry that is not a string stops at its type', () => {
    expect(marks(withFields(MINIMAL, { stack: ['kotlin', 7] })))
      .toEqual(['wrong-type@stack[1]']);
  });
});

describe('prevents and signal are written together', () => {
  const prevents = 'a swallowed DDL statement';

  test('both together are accepted', () => {
    expect(marks(withFields(MINIMAL, { prevents, signal: 'loud' }))).toEqual([]);
  });

  test('prevents alone asks for the signal', () => {
    const [found] = checkSkillFrontmatter(withFields(MINIMAL, { prevents }));

    expect(found?.code).toBe('unpaired-prevents');
    expect(found?.field).toBe('signal');
  });

  test('signal alone asks for the failure it describes', () => {
    const [found] = checkSkillFrontmatter(withFields(MINIMAL, { signal: 'silent' }));

    expect(found?.code).toBe('unpaired-prevents');
    expect(found?.field).toBe('prevents');
  });

  for (const signal of SKILL_SIGNALS) {
    test(`signal ${signal} is accepted`, () => {
      expect(marks(withFields(MINIMAL, { prevents, signal }))).toEqual([]);
    });
  }

  test('a signal outside the two values is refused', () => {
    const [found] = checkSkillFrontmatter(
      withFields(MINIMAL, { prevents, signal: 'quiet' }),
    );

    expect(found?.code).toBe('unknown-signal');
    expect(found?.message).toBe('signal "quiet" is neither loud nor silent');
  });

  test('a signal that is not a string stops at its type', () => {
    expect(marks(withFields(MINIMAL, { prevents, signal: false })))
      .toEqual(['wrong-type@signal']);
  });

  test('a blank prevents is a missing field and still counts as present', () => {
    expect(marks(withFields(MINIMAL, { prevents: '', signal: 'loud' })))
      .toEqual(['missing-field@prevents']);
  });
});

describe('relates and supersedes', () => {
  for (const field of ['relates', 'supersedes']) {
    test(`an empty ${field} list is accepted`, () => {
      expect(marks(withFields(MINIMAL, { [field]: [] }))).toEqual([]);
    });

    test(`${field} holding skill names is accepted`, () => {
      expect(marks(withFields(MINIMAL, { [field]: ['drizzle-orm', 'sql-review'] })))
        .toEqual([]);
    });

    test(`${field} written as one string is wrongly typed`, () => {
      expect(marks(withFields(MINIMAL, { [field]: 'drizzle-orm' })))
        .toEqual([`wrong-type@${field}`]);
    });

    test(`a ${field} entry that is not a skill name is named by its index`, () => {
      expect(marks(withFields(MINIMAL, { [field]: ['drizzle-orm', 'Drizzle ORM'] })))
        .toEqual([`invalid-name@${field}[1]`]);
    });

    test(`a ${field} entry that is not a string stops at its type`, () => {
      expect(marks(withFields(MINIMAL, { [field]: [2] })))
        .toEqual([`wrong-type@${field}[0]`]);
    });
  }
});

describe('paths globs', () => {
  test('Bun.Glob accepts every string, which is why this rule exists', () => {
    expect(() => new Bun.Glob('{a')).not.toThrow();
    expect(() => new Bun.Glob('[abc')).not.toThrow();
    expect(() => new Bun.Glob('')).not.toThrow();
    expect(new Bun.Glob('{a').match('a')).toBe(false);
  });

  test('the vocabulary globs are accepted', () => {
    expect(marks(withFields(MINIMAL, { paths: ['**/*.kt', '**/*.kts'] }))).toEqual([]);
  });

  test('an empty paths list is accepted as no gate at all', () => {
    expect(marks(withFields(MINIMAL, { paths: [] }))).toEqual([]);
  });

  test('an unclosed brace silently drops every alternative past the first', () => {
    const glob = new Bun.Glob('**/*.{kt,kts');

    expect(glob.match('src/a.kt')).toBe(true);
    expect(glob.match('src/a.kts')).toBe(false);
    expect(globProblem('**/*.{kt,kts')).toBe(
      'leaves a { unclosed, so every alternative past the first is dropped',
    );
    expect(marks(withFields(MINIMAL, { paths: ['**/*.{kt,kts'] })))
      .toEqual(['unusable-glob@paths[0]']);
  });

  test('a closed brace matches both alternatives and is accepted', () => {
    const glob = new Bun.Glob('**/*.{kt,kts}');

    expect(glob.match('src/a.kt')).toBe(true);
    expect(glob.match('src/a.kts')).toBe(true);
    expect(globProblem('**/*.{kt,kts}')).toBeNull();
  });

  test('an unclosed character class matches nothing at all', () => {
    const glob = new Bun.Glob('[abc');

    expect(glob.match('a')).toBe(false);
    expect(glob.match('[abc')).toBe(false);
    expect(globProblem('[abc')).toBe(
      'leaves a [ character class unclosed, so it matches nothing',
    );
  });

  test('a closed character class is accepted', () => {
    expect(new Bun.Glob('[abc]').match('b')).toBe(true);
    expect(globProblem('[abc]')).toBeNull();
  });

  test('a brace nothing opened is a literal, so the glob gates on a filename with a brace', () => {
    const glob = new Bun.Glob('**/*.kt}');

    expect(glob.match('src/a.kt')).toBe(false);
    expect(glob.match('src/a.kt}')).toBe(true);
    expect(globProblem('**/*.kt}')).toBe('closes a } that nothing opened');
  });

  test('an escaped brace is a literal the scanner does not count', () => {
    expect(new Bun.Glob('a\\{b').match('a{b')).toBe(true);
    expect(globProblem('a\\{b')).toBeNull();
    expect(globProblem('a\\[b')).toBeNull();
  });

  test('a closing bracket in the first position of a class is a literal', () => {
    const closed = new Bun.Glob('[]a]');

    expect(closed.match(']')).toBe(true);
    expect(closed.match('a')).toBe(true);
    expect(globProblem('[]a]')).toBeNull();
    expect(globProblem('[]]')).toBeNull();
    expect(globProblem('[!]]')).toBeNull();
  });

  test('a class opening with a literal bracket and never closing matches nothing', () => {
    const glob = new Bun.Glob('[]abc');

    expect(glob.match('a')).toBe(false);
    expect(glob.match(']abc')).toBe(false);
    expect(glob.match('[]abc')).toBe(false);
    expect(globProblem('[]abc')).toBe(
      'leaves a [ character class unclosed, so it matches nothing',
    );
  });

  test('a trailing backslash escapes nothing', () => {
    expect(globProblem('src/a\\')).toBe('ends in a backslash escaping nothing');
  });

  test('an empty or blank glob is refused', () => {
    expect(globProblem('')).toBe('is empty');
    expect(globProblem('   ')).toBe('is empty');
    expect(marks(withFields(MINIMAL, { paths: ['**/*.kt', ''] })))
      .toEqual(['unusable-glob@paths[1]']);
  });

  test('the message quotes the glob it refused', () => {
    const [found] = checkSkillFrontmatter(withFields(MINIMAL, { paths: ['[abc'] }));

    expect(found?.message).toBe(
      'the glob "[abc" leaves a [ character class unclosed, so it matches nothing',
    );
  });

  test('paths written as one string is wrongly typed', () => {
    expect(marks(withFields(MINIMAL, { paths: '**/*.kt' }))).toEqual(['wrong-type@paths']);
  });

  test('a paths entry that is not a string is named by its index', () => {
    expect(marks(withFields(MINIMAL, { paths: ['**/*.kt', 7] })))
      .toEqual(['wrong-type@paths[1]']);
  });
});

describe('the booleans Claude Code reads', () => {
  for (const field of ['disable-model-invocation', 'user-invocable']) {
    test(`${field} true and false are accepted`, () => {
      expect(marks(withFields(MINIMAL, { [field]: true }))).toEqual([]);
      expect(marks(withFields(MINIMAL, { [field]: false }))).toEqual([]);
    });

    test(`a quoted ${field} is wrongly typed rather than read as false`, () => {
      const [found] = checkSkillFrontmatter(withFields(MINIMAL, { [field]: 'false' }));

      expect(found?.code).toBe('wrong-type');
      expect(found?.field).toBe(field);
      expect(found?.message).toBe(
        `${field} must be true or false unquoted, and this is a string`,
      );
    });

    test(`a numeric ${field} is wrongly typed`, () => {
      expect(marks(withFields(MINIMAL, { [field]: 1 }))).toEqual([`wrong-type@${field}`]);
    });
  }
});

describe('fields that belong to an instinct', () => {
  for (const field of FORBIDDEN_SKILL_FIELDS) {
    test(`${field} on a skill is refused`, () => {
      const [found] = checkSkillFrontmatter(withFields(MINIMAL, { [field]: 0.6 }));

      expect(found?.code).toBe('forbidden-field');
      expect(found?.field).toBe(field);
      expect(found?.message).toBe(
        `${field} belongs to an instinct record and never to a skill`,
      );
    });
  }

  test('all three at once are all named', () => {
    const data = withFields(MINIMAL, { confidence: 0.6, cost: 3, model: 'opus' });

    expect(marks(data)).toEqual([
      'forbidden-field@confidence',
      'forbidden-field@cost',
      'forbidden-field@model',
    ]);
  });

  test('a false value still counts as carrying the field', () => {
    expect(marks(withFields(MINIMAL, { confidence: null })))
      .toEqual(['forbidden-field@confidence']);
  });
});

describe('provenance', () => {
  test('first-party passes and parses', () => {
    const data = withFields(MINIMAL, { provenance: 'first-party' });

    expect(checkSkillFrontmatter(data)).toEqual([]);
    expect(parseSkillFrontmatter(data).skill?.provenance).toEqual({ kind: 'first-party' });
  });

  test('a reviewed third-party mapping passes and parses', () => {
    const data = withFields(MINIMAL, {
      provenance: { origin: 'https://example.com/repo', license: 'MIT', reviewed: 'marcos 2026-09-24' },
    });

    expect(checkSkillFrontmatter(data)).toEqual([]);
    expect(parseSkillFrontmatter(data).skill?.provenance).toEqual({
      kind: 'third-party',
      origin: 'https://example.com/repo',
      license: 'MIT',
      reviewed: { who: 'marcos', date: '2026-09-24' },
    });
  });

  test('a mapping without license is refused on the entry', () => {
    const data = withFields(MINIMAL, { provenance: { origin: 'https://example.com/repo' } });

    expect(marks(data)).toEqual(['missing-field@provenance.license']);
    expect(parseSkillFrontmatter(data).skill).toBeNull();
  });

  test('a string other than first-party is refused', () => {
    expect(marks(withFields(MINIMAL, { provenance: 'third-party' })))
      .toEqual(['unknown-provenance@provenance']);
  });

  test('a malformed reviewed is refused', () => {
    const data = withFields(MINIMAL, {
      provenance: { origin: 'x', license: 'MIT', reviewed: '2026-09-24' },
    });

    expect(marks(data)).toEqual(['invalid-reviewed@provenance.reviewed']);
  });

  test('it is reported after the booleans and before the forbidden fields', () => {
    const data = withFields(MINIMAL, {
      'user-invocable': 'yes',
      provenance: 'mine',
      confidence: 0.6,
    });

    expect(marks(data)).toEqual([
      'wrong-type@user-invocable',
      'unknown-provenance@provenance',
      'forbidden-field@confidence',
    ]);
  });
});

/** One block per code, so the set of codes is closed at both ends. */
const CODE_EXAMPLES: Readonly<Record<string, Record<string, unknown>>> = {
  'description-too-long': withFields(MINIMAL, { description: filler(DESCRIPTION_LIMIT) }),
  'forbidden-field': withFields(MINIMAL, { confidence: 0.6 }),
  'invalid-name': withFields(MINIMAL, { name: 'Not A Name' }),
  'listing-too-long': withFields(MINIMAL, { when_to_use: filler(LISTING_LIMIT) }),
  'missing-field': withFields(MINIMAL, { tags: undefined }),
  'unknown-signal': withFields(MINIMAL, { prevents: 'a trap', signal: 'quiet' }),
  'unknown-stack': withFields(MINIMAL, { stack: ['cobol'] }),
  'unpaired-prevents': withFields(MINIMAL, { prevents: 'a trap' }),
  'unusable-glob': withFields(MINIMAL, { paths: ['[abc'] }),
  'wrong-type': withFields(MINIMAL, { tags: 'one' }),
  'unknown-provenance': withFields(MINIMAL, { provenance: 'ours' }),
  'invalid-reviewed': withFields(MINIMAL, {
    provenance: { origin: 'x', license: 'MIT', reviewed: 'nobody' },
  }),
};

describe('everyCodeIsReachable', () => {
  for (const [code, data] of Object.entries(CODE_EXAMPLES)) {
    test(`${code} is produced by a block that differs from a passing one in one field`, () => {
      expect(checkSkillFrontmatter(data).map((found) => found.code)).toContain(code);
    });
  }

  test('the codes the examples produce are exactly the declared set', () => {
    expect(Object.keys(CODE_EXAMPLES).sort()).toEqual([...SKILL_ISSUE_CODES].sort());
  });

  test('the declared set has no repeats', () => {
    expect(new Set(SKILL_ISSUE_CODES).size).toBe(SKILL_ISSUE_CODES.length);
  });
});
