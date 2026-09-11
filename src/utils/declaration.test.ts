/**
 * Tests for the task declaration parser.
 *
 * The subject is a pure function over a string, so every case here is
 * a literal in and a record out — no fixture tree, no repository, no
 * clock. What that buys is that the interesting cases are the ones a
 * plan can actually write, and two of the fixtures are exactly that:
 * the declaration-bearing task lines of the plan this module was
 * written for, copied whole rather than reduced to a sketch.
 *
 * Two claims are deliberately NOT asserted here, both because the plan
 * gives them tasks of their own and a test written twice is a test
 * nobody maintains: the six negative shapes (an unclosed brace, nested
 * braces, a trailing code span, an empty block, a block that is not
 * anchored at end of line, an unrecognised key on its own), and the
 * flag-mapping matrix (an `agent` suppressing the granular keys, and
 * the three mapping onto their flags in its absence). The negative
 * shapes now live in `tests/declaration-negatives.test.ts`, each with
 * its own positive control; the one line of overlap left here is the
 * block of unrecognised keys below, which that file widens into the
 * lone key, the case split and a near miss of all four. What IS asserted
 * of {@link resolveDeclarationFlags} here is the one claim this task
 * owns: no declaration means no flags, which is today's behaviour
 * exactly.
 *
 * The value sets are pinned to LITERALS rather than built from the
 * module's own constants. A case comparing a constant against itself
 * moves with the constant and cannot tell five effort levels from six
 * — and these five are not this module's invention, they are what
 * `claude --help` documents `--effort` accepting, so a literal is also
 * the record of what was measured.
 *
 * Sixteen module mutations were driven against this file and FOURTEEN
 * reddened at least one case, with the module restored byte-identical
 * and green either side: allowing a block that is the whole text,
 * accepting a block with no recognised key, taking the last duplicate
 * instead of the first, treating every key as recognised, recording no
 * extras, recording no issue for an unusable value, keeping an
 * unusable value anyway, accepting any effort spelling, accepting any
 * model spelling, accepting a tool value of any shape, not deduping
 * the tool list, not trimming the text before the block, emitting
 * flags for a null declaration, and letting a stray token pass
 * unrecorded.
 *
 * The two that stayed GREEN are named rather than dropped, and they
 * are not no-ops — both are real holes, and both belong to
 * `tests/declaration-negatives.test.ts` rather than to this file.
 * DROPPING THE END ANCHOR (`/\{([^{}]*)\}$/` to `/\{([^{}]*)\}/`)
 * and ALLOWING A NESTED BRACE (`[^{}]*` to `[\s\S]*`) each need a
 * fixture whose braces are somewhere other than a well-formed trailing
 * block, and every fixture here puts them exactly there. Both were
 * re-driven against that file when it landed and redden 5 and 4 of its
 * 15 cases, which is how it knows its own fixtures reached the module.
 */
import type { TaskDeclaration } from './declaration.js';

import { describe, expect, it } from 'vitest';

import {
  DECLARATION_KEYS,
  EFFORT_LEVELS,
  GRANULAR_KEYS,
  isEffortLevel,
  isModelValue,
  MODEL_ALIASES,
  parseTaskDeclaration,
  parseToolList,
  resolveDeclarationFlags,
  stripTaskDeclaration,
} from './declaration.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** The routing-table task of this plan, without its block. */
const ROUTING_TASK = [
  'Add the task-shape to agent routing table to `context/workflow.md`,',
  'mapping prose to `doc-updater`, tests to `tdd-guide`, migrations to',
  '`database-reviewer`, repair to `build-error-resolver`, cleanup to',
  '`refactor-cleaner`, review to the read-only reviewers, and',
  'implementation to `loop-implementer`',
].join(' ');

/** That task's own block, spelled as the plan spells it. */
const ROUTING_BLOCK =
  '{tools=Read,Write,Edit,Grep,Glob model=haiku effort=low}';

/** The progress-hygiene task of this plan, without its block. */
const HYGIENE_TASK = [
  'Update `.claude/skills/progress-hygiene/SKILL.md` with the enforced',
  'cap and the rolling cadence, replacing the sentence that describes',
  'compaction as an end-of-run step',
].join(' ');

/** That task's own block. */
const HYGIENE_BLOCK = '{agent=doc-updater model=haiku effort=low}';

/** The routing task exactly as its own tracker line spells it. */
const ROUTING_LINE = `${ROUTING_TASK}${GAP}${ROUTING_BLOCK}`;

/** The hygiene task exactly as its own tracker line spells it. */
const HYGIENE_LINE = `${HYGIENE_TASK}${GAP}${HYGIENE_BLOCK}`;

/** The declaration a text carries, or a failure naming the text. */
function declarationOf(taskText: string): TaskDeclaration {
  const parsed = parseTaskDeclaration(taskText);
  if (parsed.declaration === null) {
    throw new Error(`no declaration parsed from: ${taskText}`);
  }
  return parsed.declaration;
}

describe('the recognised grammar', () => {
  it('recognises exactly four keys', () => {
    expect([...DECLARATION_KEYS]).toEqual([
      'agent',
      'model',
      'effort',
      'tools',
    ]);
  });

  it('names the three keys an agent outranks', () => {
    expect([...GRANULAR_KEYS]).toEqual(['model', 'effort', 'tools']);
  });

  it('carries the five levels the CLI documents', () => {
    expect([...EFFORT_LEVELS]).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(isEffortLevel('xhigh')).toBe(true);
    expect(isEffortLevel('medum')).toBe(false);
  });

  it('carries the four documented model aliases', () => {
    expect([...MODEL_ALIASES]).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'fable',
    ]);
  });

  it('takes a full model name as well as an alias', () => {
    expect(isModelValue('haiku')).toBe(true);
    expect(isModelValue('claude-fable-5')).toBe(true);
    expect(isModelValue('opuss')).toBe(false);
    expect(isModelValue('Haiku')).toBe(false);
  });
});

describe('parseTaskDeclaration', () => {
  it('answers the task text with the block removed', () => {
    const parsed = parseTaskDeclaration(HYGIENE_LINE);

    expect(parsed.text).toBe(HYGIENE_TASK);
    expect(parsed.declaration?.raw).toBe(HYGIENE_BLOCK);
  });

  it('leaves no brace anywhere in the text it answers', () => {
    const parsed = parseTaskDeclaration(ROUTING_LINE);

    expect(parsed.text).toBe(ROUTING_TASK);
    expect(parsed.text).not.toContain('{');
    expect(parsed.text).not.toContain('}');
  });

  it('trims the gap the tracker line leaves behind', () => {
    const parsed = parseTaskDeclaration(`Do the thing${GAP}{effort=low}`);

    expect(parsed.text).toBe('Do the thing');
  });

  it('reads all four keys off one block', () => {
    const declaration = declarationOf(
      'Do it  {agent=tdd-guide model=opus effort=max tools=Read,Bash}',
    );

    expect(declaration.agent).toBe('tdd-guide');
    expect(declaration.model).toBe('opus');
    expect(declaration.effort).toBe('max');
    expect(declaration.tools).toEqual(['Read', 'Bash']);
    expect(declaration.issues).toEqual([]);
  });

  it('reads the plan routing task as its plan wrote it', () => {
    const declaration = declarationOf(ROUTING_LINE);

    expect(declaration.agent).toBeNull();
    expect(declaration.model).toBe('haiku');
    expect(declaration.effort).toBe('low');
    expect(declaration.tools).toEqual([
      'Read',
      'Write',
      'Edit',
      'Grep',
      'Glob',
    ]);
  });

  it('keeps every pair on the record in source order', () => {
    const declaration = declarationOf('Do it  {effort=low agent=tdd-guide}');

    expect(declaration.entries).toEqual([
      { key: 'effort', value: 'low' },
      { key: 'agent', value: 'tdd-guide' },
    ]);
  });

  it('answers the input unchanged when there is no block', () => {
    const text = 'Capture the baseline into /tmp/q19-log-baseline.txt';
    const parsed = parseTaskDeclaration(text);

    expect(parsed.declaration).toBeNull();
    expect(parsed.text).toBe(text);
  });

  it('reads a block of unrecognised keys as task text', () => {
    const text = 'Explain the shape  {queue=q19 wave=2}';
    const parsed = parseTaskDeclaration(text);

    expect(parsed.declaration).toBeNull();
    expect(parsed.text).toBe(text);
  });

  it('refuses a block that is the whole task text', () => {
    const parsed = parseTaskDeclaration('{agent=doc-updater}');

    expect(parsed.declaration).toBeNull();
    expect(parsed.text).toBe('{agent=doc-updater}');
  });

  it('retains an unrecognised key beside a recognised one', () => {
    const declaration = declarationOf('Do it  {agent=doc-updater queue=q19}');

    expect(declaration.agent).toBe('doc-updater');
    expect(declaration.extras).toEqual([{ key: 'queue', value: 'q19' }]);
    expect(declaration.issues).toEqual([]);
  });

  it('takes the first of a duplicated key and says so', () => {
    const declaration = declarationOf('Do it  {model=opus model=haiku}');

    expect(declaration.model).toBe('opus');
    expect(declaration.issues).toEqual([
      { reason: 'duplicate-key', key: 'model', text: 'model=haiku' },
    ]);
  });

  it('drops a value it cannot use and records the token', () => {
    const declaration = declarationOf('Do it  {effort=medum model=haiku}');

    expect(declaration.effort).toBeNull();
    expect(declaration.model).toBe('haiku');
    expect(declaration.issues).toEqual([
      { reason: 'unusable-value', key: 'effort', text: 'effort=medum' },
    ]);
  });

  it('strips a block whose values were all unusable', () => {
    const parsed = parseTaskDeclaration('Do it  {effort=medum model=opuss}');

    expect(parsed.text).toBe('Do it');
    expect(parsed.declaration?.issues).toHaveLength(2);
    expect(resolveDeclarationFlags(parsed.declaration).args).toEqual([]);
  });

  it('records a token inside the block carrying no equals', () => {
    const declaration = declarationOf('Do it  {agent=doc-updater junk}');

    expect(declaration.agent).toBe('doc-updater');
    expect(declaration.issues).toEqual([
      { reason: 'stray-token', key: '', text: 'junk' },
    ]);
  });
});

describe('parseToolList', () => {
  it('splits a comma-separated list in written order', () => {
    expect(parseToolList('Read,Write,Bash')).toEqual([
      'Read',
      'Write',
      'Bash',
    ]);
  });

  it('keeps the first of a repeated tool name', () => {
    expect(parseToolList('Read,Write,Read')).toEqual(['Read', 'Write']);
  });

  it('refuses an empty value and a doubled comma', () => {
    expect(parseToolList('')).toBeNull();
    expect(parseToolList('Read,,Write')).toBeNull();
    expect(parseToolList('Read, Write')).toBeNull();
  });
});

describe('stripTaskDeclaration', () => {
  it('answers the text a declaration-bearing task carries', () => {
    expect(stripTaskDeclaration(HYGIENE_LINE)).toBe(HYGIENE_TASK);
  });

  it('answers a plain task text unchanged', () => {
    expect(stripTaskDeclaration('Do the thing')).toBe('Do the thing');
  });
});

describe('resolveDeclarationFlags', () => {
  it('answers no flags at all for no declaration', () => {
    const resolved = resolveDeclarationFlags(null);

    expect(resolved.args).toEqual([]);
    expect(resolved.suppressed).toEqual([]);
  });
});
