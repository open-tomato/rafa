/**
 * Integration tests over whole skill and instinct FILES: text a caller
 * would actually read off disk, carried through the frontmatter reader,
 * the v2 schema and the stack vocabulary together, rather than the
 * literal mappings `schema/skill.test.ts` and `schema/instinct.test.ts`
 * check in isolation.
 *
 * Nothing here opens a real file. `skillFile` and `instinctFile` build
 * whole file text the way `schema/instinct.test.ts`'s `recordText`
 * does — frontmatter rendered by the module under test, not typed by
 * hand — so the reader, the writer and the checker are exercised on the
 * same bytes a `--fix` or a demotion pass would actually touch.
 *
 * Four readings, each showing something a schema test run on a bare
 * mapping cannot:
 *
 *   - The 1,535/1,536 boundary of the listing cap, read off a FILE
 *     through `readFrontmatterDocument`, so the frontmatter parse is
 *     part of what is measured and not just the counting function.
 *   - `stack: [agnostic, kotlin]`, refused by the schema as one
 *     whole-list rule and, separately, by `stack.ts`'s own
 *     `isStackList` — the two modules have to agree about the same
 *     list, or a skill could clear one gate and fail the other
 *     silently.
 *   - An Action section edited by hand, with a plain `String.replace`
 *     on a whole instinct file's bytes rather than through a fixture
 *     builder's own field, showing the hash moves under an edit a
 *     human actually makes and not only under one the module made for
 *     itself.
 *   - A round trip that changes one frontmatter key — `paths`, computed
 *     from the skill's `stack` by `stack.ts` — and leaves a realistic,
 *     multi-paragraph body (a fenced block, a trailing-space line
 *     inside it, CRLF terminators) byte-identical, which is the
 *     promise `frontmatter.ts` states and `frontmatter.test.ts`
 *     measures only on two-line bodies.
 */
import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { readFrontmatterDocument, renderFrontmatter, updateFrontmatter } from '../schema/frontmatter.js';
import { ACTION_HEADING, CAUSE_HEADING, actionHash, parseInstinct } from '../schema/instinct.js';
import {
  DESCRIPTION_LIMIT,
  LISTING_LIMIT,
  checkSkillFrontmatter,
  countCharacters,
  listingLength,
  parseSkillFrontmatter,
} from '../schema/skill.js';
import { AGNOSTIC_STACK, isStackList, stackGlobs, stackPaths } from '../schema/stack.js';

/** The four required fields, filled with values every v2 check accepts. */
const SKILL_BASE = {
  name: 'drizzle-custom-migration-traps',
  description: 'Traps in hand-written Drizzle migrations',
  tags: ['drizzle', 'migrations'],
  stack: ['kotlin'],
} as const;

/**
 * A realistic skill body: a heading, prose, a fenced block carrying a
 * trailing-space line, and a checklist — the shape a demotion pass or a
 * `--fix` actually rewrites around, not the two-line body a schema unit
 * test gets away with.
 */
const SKILL_BODY = [
  '',
  '# Drizzle custom migration traps',
  '',
  'Run this before hand-editing a `--custom` Drizzle migration.',
  '',
  '```sql',
  '-- a line with trailing space   ',
  'ALTER TABLE accounts ADD COLUMN archived_at timestamptz;',
  '```',
  '',
  '## Checklist',
  '',
  '- Confirm the DDL statement is not swallowed',
  '- Re-run `drizzle-kit check`',
  '',
].join('\n');

/** `data` with `changes` applied, dropping a key whose change is `undefined`. */
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

/** A string of `length` ASCII characters. */
function filler(length: number): string {
  return 'x'.repeat(length);
}

/** `data` rendered as a whole skill file: fences, frontmatter, then `body`. */
function skillFile(
  data: Readonly<Record<string, unknown>>,
  body: string = SKILL_BODY,
  newline = '\n',
): string {
  return `---${newline}${renderFrontmatter(data, newline)}${newline}---${newline}${body}`;
}

describe('the listing cap, read off a whole skill file', () => {
  const description = filler(DESCRIPTION_LIMIT - 1);

  test('1,535 characters together passes through the reader and the schema', () => {
    const whenToUse = filler(LISTING_LIMIT - 1 - description.length);
    const text = skillFile(withFields(SKILL_BASE, { description, when_to_use: whenToUse }));
    const document = readFrontmatterDocument(text);

    expect(document).not.toBeNull();
    expect(countCharacters(description)).toBe(DESCRIPTION_LIMIT - 1);
    expect(listingLength(document!.data)).toBe(LISTING_LIMIT - 1);
    expect(checkSkillFrontmatter(document!.data)).toEqual([]);

    const { issues, skill } = parseSkillFrontmatter(document!.data);
    expect(issues).toEqual([]);
    expect(skill?.whenToUse).toBe(whenToUse);
  });

  test('1,536 characters together is refused reading the same file shape', () => {
    const whenToUse = filler(LISTING_LIMIT - description.length);
    const text = skillFile(withFields(SKILL_BASE, { description, when_to_use: whenToUse }));
    const document = readFrontmatterDocument(text);

    expect(document).not.toBeNull();
    expect(listingLength(document!.data)).toBe(LISTING_LIMIT);
    expect(checkSkillFrontmatter(document!.data)).toEqual([{
      code: 'listing-too-long',
      field: 'description + when_to_use',
      message: 'description and when_to_use are 1536 characters together, '
        + 'and Claude Code truncates the listing at 1536',
    }]);
    expect(parseSkillFrontmatter(document!.data).skill).toBeNull();
  });
});

describe('stack: [agnostic, kotlin], refused by the schema and by stack.ts alike', () => {
  const text = skillFile(withFields(SKILL_BASE, { stack: [AGNOSTIC_STACK, 'kotlin'] }));
  const document = readFrontmatterDocument(text);

  test('the frontmatter reader parses the list exactly as written', () => {
    expect(document).not.toBeNull();
    expect(document?.data['stack']).toEqual(['agnostic', 'kotlin']);
  });

  test('the schema refuses it as one whole-list rule, not a per-entry one', () => {
    expect(checkSkillFrontmatter(document!.data)).toEqual([{
      code: 'unknown-stack',
      field: 'stack',
      message: 'agnostic is either the whole stack list or no part of it',
    }]);
  });

  test('stack.ts refuses the same list too, on its own terms', () => {
    expect(isStackList(document!.data['stack'] as string[])).toBe(false);
  });

  test('a stack of kotlin alone is accepted by both, and gates on the Kotlin globs', () => {
    const cleanDocument = readFrontmatterDocument(skillFile(SKILL_BASE));

    expect(checkSkillFrontmatter(cleanDocument!.data)).toEqual([]);
    expect(isStackList(cleanDocument!.data['stack'] as string[])).toBe(true);
    expect(stackGlobs('kotlin')).toEqual(['**/*.kt', '**/*.kts']);
  });
});

/** Every field a valid instinct record carries, filled with realistic values. */
const INSTINCT_BASE: Record<string, unknown> = {
  id: 'skill-fix-key-order-drift',
  trigger: 'when a --fix rewrites a skill missing stack',
  kind: 'gotcha',
  domain: 'testing',
  confidence: 0.5,
  signal: 'silent',
  scope: 'project',
  source: 'task-report',
  evidence: [{
    plan: 'phase-2-schema-checker-demotion',
    task: 'add schema-records.test.ts',
    session: 'b4e1',
    outcome: 'done',
  }],
  created_at: '2026-09-18T12:00:00Z',
  updated_at: '2026-09-18T12:00:00Z',
};

/** The Action the fixture instinct carries before any hand edit. */
const ORIGINAL_ACTION
  = 'Read the whole skill file through updateFrontmatter rather than re-serializing the body by hand.';

/** The Cause section, left untouched by every case in this describe. */
const CAUSE = 'A hand rewrite of the body loses the trailing whitespace and CRLF terminators Bun.YAML never touches.';

/** `data` rendered as a whole instinct file, its two body sections filled. */
function instinctFile(
  data: Readonly<Record<string, unknown>> = INSTINCT_BASE,
  action: string = ORIGINAL_ACTION,
): string {
  return `---\n${renderFrontmatter(data)}\n---\n\n${ACTION_HEADING}\n${action}\n\n${CAUSE_HEADING}\n${CAUSE}\n`;
}

describe('a hand-edited Action changes action_hash', () => {
  const original = instinctFile();
  const originalResult = parseInstinct(original);

  test('the unedited file parses to the action as written', () => {
    expect(originalResult.issues).toEqual([]);
    expect(originalResult.instinct?.action).toBe(ORIGINAL_ACTION);
  });

  test('a plain string edit of only the Action line moves the hash', () => {
    const editedAction = 'Run drizzle-kit check after every hand-written migration edit.';
    const edited = original.replace(ORIGINAL_ACTION, editedAction);

    expect(edited).not.toBe(original);
    // Nothing else in the file moved: the frontmatter block and the
    // Cause section are untouched by the replace.
    expect(edited).toContain(`---\n${renderFrontmatter(INSTINCT_BASE)}\n---\n`);
    expect(edited).toContain(`${CAUSE_HEADING}\n${CAUSE}\n`);

    const editedResult = parseInstinct(edited);
    expect(editedResult.issues).toEqual([]);
    expect(editedResult.instinct?.action).toBe(editedAction);
    expect(editedResult.instinct?.actionHash).not.toBe(originalResult.instinct?.actionHash);
    expect(editedResult.instinct?.actionHash).toBe(actionHash(editedAction));
    expect(editedResult.instinct?.actionHash).toBe(
      createHash('sha256').update(editedAction.trim().toLowerCase())
        .digest('hex'),
    );
  });

  test('the frontmatter itself carries no trace of the edit', () => {
    const edited = original.replace(ORIGINAL_ACTION, 'Run bun install --production instead.');

    expect(readFrontmatterDocument(edited)?.data).toEqual(readFrontmatterDocument(original)?.data);
  });
});

describe('a round trip through updateFrontmatter leaves the body bytes alone', () => {
  test('adding paths computed from stack.ts leaves a realistic body byte-identical', () => {
    const original = skillFile(SKILL_BASE);
    const document = readFrontmatterDocument(original);
    const { skill } = parseSkillFrontmatter(document!.data);
    const paths = stackPaths(skill!.stack);

    expect(paths).toEqual(['**/*.kt', '**/*.kts']);

    const written = updateFrontmatter(original, { paths });
    const rewrittenDocument = readFrontmatterDocument(written ?? '');

    expect(rewrittenDocument?.body).toBe(SKILL_BODY);
    expect(written?.endsWith(SKILL_BODY)).toBe(true);
    expect(checkSkillFrontmatter(rewrittenDocument!.data)).toEqual([]);
    expect(parseSkillFrontmatter(rewrittenDocument!.data).skill?.paths).toEqual(paths);
  });

  test('the same round trip in CRLF keeps every terminator and the trailing-space line', () => {
    const crlfBody = SKILL_BODY.replace(/\n/g, '\r\n');
    const original = skillFile(SKILL_BASE, crlfBody, '\r\n');
    const document = readFrontmatterDocument(original);

    expect(document?.body).toBe(crlfBody);
    expect(document?.newline).toBe('\r\n');

    const written = updateFrontmatter(original, { paths: stackPaths(SKILL_BASE.stack) });
    const rewrittenDocument = readFrontmatterDocument(written ?? '');

    expect(rewrittenDocument?.body).toBe(crlfBody);
    expect(rewrittenDocument?.body.includes('trailing space   \r\n')).toBe(true);
    expect(checkSkillFrontmatter(rewrittenDocument!.data)).toEqual([]);
  });
});
