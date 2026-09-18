/**
 * Tests for the deterministic derivation (`./derive.ts`): which of the
 * three fields each planted skill comes to, what the apply writes, and
 * the two refusals.
 *
 * Every case plants its own skills directory under this file's
 * temporary directory and derives over that. Nothing here reads the
 * machine home, this checkout or the real `PATH`: the checker seams are
 * a null project root and an empty `PATH` list, which is exactly how a
 * user tier is checked.
 *
 * ## Every reading is paired
 *
 * Four readings would come out the same on a derivation that did
 * nothing at all, so each is planted beside a twin that must move:
 *
 *   - **`stack` is derived from an ECC directory name and only from
 *     one.** `kotlin-testing` is planted beside `verification-loop`,
 *     whose `stack` the table recognises nothing in, and the two are
 *     asserted in one run: a derivation that wrote `[agnostic]` over
 *     every unrecognised name would be red on the second.
 *   - **`paths` comes from the glob table.** A `[python]` skill gets
 *     the table's globs beside a `[postgres]` one that gets none,
 *     because an ungated stack has no globs to give.
 *   - **A hand-written `paths` survives.** The skill whose `stack` this
 *     run does not touch keeps its narrower gate, beside the ECC skill
 *     whose stale `paths` IS replaced because its `stack` moved.
 *   - **A file that would come out worse is put back.** The candidate
 *     text of one action is replaced with a block missing `tags`, and
 *     the file is asserted byte-identical afterwards — beside a second
 *     action in the same plan that writes. An applier that wrote
 *     nothing would be red on the second.
 *
 * ## Why the refusal is measured through the plan
 *
 * No value the derivation itself computes can fail the checker: the
 * stacks come from a closed vocabulary, the globs from the table, and
 * `when_to_use` is trimmed under the cap before it is written. The
 * check before the write is therefore a belt, and the only way to
 * measure that the belt holds is to hand the applier a plan whose text
 * is broken. That is what the refusal case does, and it is named here
 * so nobody reads it as a derivation that can really produce such a
 * file.
 */
import type { DerivationAction, DerivationOptions, DerivationPlan } from './derive.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { checkFile } from '../check/run.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';
import { countCharacters, LISTING_LIMIT } from '../schema/skill.js';

import {
  applyDerivation,
  countDerivations,
  DERIVATION_KINDS,
  DERIVED_FIELDS,
  eccStack,
  planDerivation,
  renderWhenToUse,
  trimWhenToUse,
  triggerSentence,
} from './derive.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-backfill-derive-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The seams a user tier is derived with: no project, no `PATH`. */
const options: DerivationOptions = { projectRoot: null, pathDirs: [] };

/** A skills directory of this case's own. */
function newRoot(): string {
  planted += 1;
  const root = join(tempBase, `tier-${planted}`, 'skills');
  mkdirSync(root, { recursive: true });
  return root;
}

/** One `<root>/<name>/SKILL.md`, with `front` after its `name` line. */
function plantSkill(
  root: string,
  name: string,
  front: readonly string[],
  body: readonly string[],
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, ['---', `name: ${name}`, ...front, '---', '', ...body, ''].join('\n'), 'utf8');
  return path;
}

/** The frontmatter the file at `path` now carries. */
function frontmatterOf(path: string): Readonly<Record<string, unknown>> {
  const document = readFrontmatterDocument(readFileSync(path, 'utf8'));
  if (document === null) throw new Error(`no frontmatter at ${path}`);
  return document.data;
}

/** The body the file at `path` now carries, byte for byte. */
function bodyOf(path: string): string {
  const document = readFrontmatterDocument(readFileSync(path, 'utf8'));
  if (document === null) throw new Error(`no frontmatter at ${path}`);
  return document.body;
}

/** The action for `path` in a plan. */
function actionFor(plan: DerivationPlan, path: string): DerivationAction {
  const found = plan.actions.find((action) => action.path === path);
  if (found === undefined) throw new Error(`no action for ${path}`);
  return found;
}

/** `text` with its rendered `tags` block dropped, to break one candidate. */
function withoutTags(text: string): string {
  return text
    .split('\n')
    .filter((line) => line !== 'tags:' && !/^\s+- kotlin$/.test(line))
    .join('\n');
}

/** A body with a "When to Use" section, and nothing that resolves. */
function bodyWithTrigger(trigger: string): readonly string[] {
  return ['# A skill', '', '## When to Use', '', trigger, '', '## Steps', '', 'Do the thing.'];
}

describe('the derived fields', () => {
  it('names the three fields it writes, in write order', () => {
    expect(DERIVED_FIELDS).toEqual(['stack', 'paths', 'when_to_use']);
  });
});

describe('eccStack', () => {
  it('answers the table stacks for a stack-named directory', () => {
    expect(eccStack('kotlin-testing')).toEqual(['kotlin']);
    expect(eccStack('django-tdd')).toEqual(['python', 'django']);
  });

  it('answers null for a directory name the table recognises nothing in', () => {
    expect(eccStack('verification-loop')).toBeNull();
    expect(eccStack('code-tour')).toBeNull();
  });
});

describe('triggerSentence', () => {
  it('reads the first sentence of the When to Use section', () => {
    const body = bodyWithTrigger('When a migration runs with --custom. And more.').join('\n');
    expect(triggerSentence(body)).toBe('When a migration runs with --custom.');
  });

  it('answers the empty string for a body with no such section', () => {
    expect(triggerSentence('# A skill\n\n## Steps\n\nDo it.\n')).toBe('');
  });
});

describe('renderWhenToUse', () => {
  it('joins the trigger and the prevents with the template', () => {
    expect(renderWhenToUse('When a migration runs.', 'a swallowed DDL statement'))
      .toBe('When a migration runs. Prevents: a swallowed DDL statement');
  });

  it('terminates a trigger sentence that terminates itself with nothing', () => {
    expect(renderWhenToUse('When a migration runs', 'a swallowed statement'))
      .toBe('When a migration runs. Prevents: a swallowed statement');
  });
});

describe('trimWhenToUse', () => {
  it('leaves a pair already under the cap alone', () => {
    expect(trimWhenToUse('a'.repeat(100), 'b'.repeat(100))).toBe('b'.repeat(100));
  });

  it('spends the whole budget the description leaves', () => {
    const description = 'a'.repeat(100);
    const trimmed = trimWhenToUse(description, 'b'.repeat(5000));
    expect(countCharacters(trimmed)).toBe(LISTING_LIMIT - 1 - 100);
    expect(countCharacters(description) + countCharacters(trimmed)).toBeLessThan(LISTING_LIMIT);
  });

  it('counts codepoints, so an emoji costs one character', () => {
    const trimmed = trimWhenToUse('', '🙂'.repeat(5000));
    expect(countCharacters(trimmed)).toBe(LISTING_LIMIT - 1);
  });

  it('answers the empty string when the description leaves no budget', () => {
    expect(trimWhenToUse('a'.repeat(LISTING_LIMIT), 'b'.repeat(10))).toBe('');
  });
});

describe('the stack derivation', () => {
  it('writes an ECC name stack and leaves an unrecognised name alone', () => {
    const root = newRoot();
    const stackSkill = plantSkill(
      root,
      'kotlin-testing',
      ['description: How to test on the JVM.', 'tags: [kotlin]', 'stack: [agnostic]'],
      bodyWithTrigger('When a JVM test suite needs writing.'),
    );
    const agnosticSkill = plantSkill(
      root,
      'verification-loop',
      ['description: The gates, in order.', 'tags: [verification]', 'stack: [agnostic]'],
      bodyWithTrigger('When a change needs its gates run.'),
    );

    const applied = applyDerivation(planDerivation(root, options), options);

    expect(actionFor(applied, stackSkill).kind).toBe('derived');
    expect(frontmatterOf(stackSkill)['stack']).toEqual(['kotlin']);
    expect(frontmatterOf(stackSkill)['paths']).toEqual(['**/*.kt', '**/*.kts']);

    expect(actionFor(applied, agnosticSkill).kind).toBe('unchanged');
    expect(frontmatterOf(agnosticSkill)['stack']).toEqual(['agnostic']);
    expect(frontmatterOf(agnosticSkill)['paths']).toBeUndefined();
  });

  it('leaves an ECC skill alone when its stack is already what the table says', () => {
    const root = newRoot();
    const path = plantSkill(
      root,
      'rust-verification',
      [
        'description: The cargo gates, in order.',
        'tags: [rust]',
        'stack: [rust]',
        'paths: ["**/*.rs"]',
      ],
      bodyWithTrigger('When a crate needs its gates run.'),
    );

    const plan = planDerivation(root, options);
    expect(actionFor(plan, path).kind).toBe('unchanged');
    expect(actionFor(plan, path).changes).toEqual({});
  });
});

describe('the paths derivation', () => {
  it('writes the glob table entries for a gated stack and none for an ungated one', () => {
    const root = newRoot();
    const gated = plantSkill(
      root,
      'migration-traps',
      ['description: Traps in hand-written migrations.', 'tags: [migrations]', 'stack: [python]'],
      bodyWithTrigger('When a migration is written by hand.'),
    );
    const ungated = plantSkill(
      root,
      'index-traps',
      ['description: Traps in index choices.', 'tags: [indexes]', 'stack: [postgres]'],
      bodyWithTrigger('When an index is added to a hot table.'),
    );

    const applied = applyDerivation(planDerivation(root, options), options);

    expect(actionFor(applied, gated).kind).toBe('derived');
    expect(frontmatterOf(gated)['paths']).toEqual(['**/*.py']);

    expect(actionFor(applied, ungated).kind).toBe('unchanged');
    expect(frontmatterOf(ungated)['paths']).toBeUndefined();
  });

  it('keeps a hand-written paths under an untouched stack and replaces a stale one under a moved stack', () => {
    const root = newRoot();
    const kept = plantSkill(
      root,
      'migration-traps',
      [
        'description: Traps in hand-written migrations.',
        'tags: [migrations]',
        'stack: [python]',
        'paths: ["migrations/**/*.py"]',
      ],
      bodyWithTrigger('When a migration is written by hand.'),
    );
    const moved = plantSkill(
      root,
      'kotlin-testing',
      [
        'description: How to test on the JVM.',
        'tags: [kotlin]',
        'stack: [python]',
        'paths: ["**/*.py"]',
      ],
      bodyWithTrigger('When a JVM test suite needs writing.'),
    );

    const applied = applyDerivation(planDerivation(root, options), options);

    expect(actionFor(applied, kept).kind).toBe('unchanged');
    expect(frontmatterOf(kept)['paths']).toEqual(['migrations/**/*.py']);

    expect(actionFor(applied, moved).kind).toBe('derived');
    expect(frontmatterOf(moved)['stack']).toEqual(['kotlin']);
    expect(frontmatterOf(moved)['paths']).toEqual(['**/*.kt', '**/*.kts']);
  });
});

describe('the when_to_use derivation', () => {
  it('writes the template from the body trigger and the prevents', () => {
    const root = newRoot();
    const path = plantSkill(
      root,
      'migration-traps',
      [
        'description: Traps in hand-written migrations.',
        'tags: [migrations]',
        'stack: [agnostic]',
        'prevents: a swallowed DDL statement',
        'signal: silent',
      ],
      bodyWithTrigger('When a migration is written by hand.'),
    );

    applyDerivation(planDerivation(root, options), options);

    expect(frontmatterOf(path)['when_to_use'])
      .toBe('When a migration is written by hand. Prevents: a swallowed DDL statement');
  });

  it('takes the trigger from the options where the body has no section, and writes none without one', () => {
    const root = newRoot();
    const front = [
      'description: Traps in hand-written migrations.',
      'tags: [migrations]',
      'stack: [agnostic]',
      'prevents: a swallowed DDL statement',
      'signal: silent',
    ];
    const bare = ['# A skill', '', '## Steps', '', 'Do the thing.'];
    const given = plantSkill(root, 'given-trigger', front, bare);
    const missing = plantSkill(root, 'missing-trigger', front, bare);

    const withTrigger: DerivationOptions = {
      ...options,
      triggers: { 'given-trigger': 'When a migration is reviewed' },
    };
    const applied = applyDerivation(planDerivation(root, withTrigger), withTrigger);

    expect(actionFor(applied, given).kind).toBe('derived');
    expect(frontmatterOf(given)['when_to_use'])
      .toBe('When a migration is reviewed. Prevents: a swallowed DDL statement');

    const missingAction = actionFor(applied, missing);
    expect(missingAction.kind).toBe('unchanged');
    expect(missingAction.detail).toContain('no When to Use section');
    expect(frontmatterOf(missing)['when_to_use']).toBeUndefined();
  });

  it('writes nothing for a skill with no prevents', () => {
    const root = newRoot();
    const path = plantSkill(
      root,
      'migration-notes',
      ['description: Notes on migrations.', 'tags: [migrations]', 'stack: [agnostic]'],
      bodyWithTrigger('When a migration is written by hand.'),
    );

    expect(actionFor(planDerivation(root, options), path).kind).toBe('unchanged');
    expect(frontmatterOf(path)['when_to_use']).toBeUndefined();
  });

  it('trims the pair under the listing cap and leaves the description alone', () => {
    const root = newRoot();
    const description = 'Traps in hand-written migrations.';
    const path = plantSkill(
      root,
      'migration-traps',
      [
        `description: ${description}`,
        'tags: [migrations]',
        'stack: [agnostic]',
        `prevents: ${'x'.repeat(2000)}`,
        'signal: silent',
      ],
      bodyWithTrigger('When a migration is written by hand.'),
    );

    applyDerivation(planDerivation(root, options), options);
    const data = frontmatterOf(path);
    const whenToUse = data['when_to_use'] as string;

    expect(data['description']).toBe(description);
    expect(countCharacters(description) + countCharacters(whenToUse))
      .toBe(LISTING_LIMIT - 1);
    expect(checkFile(path, 'skill', options).issues.map((issue) => issue.code))
      .not.toContain('listing-too-long');
  });
});

describe('the body', () => {
  it('survives byte for byte, trailing spaces and a missing final newline included', () => {
    const root = newRoot();
    const dir = join(root, 'kotlin-testing');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    const body = '# A skill\n\n## When to Use  \n\nWhen a JVM suite needs writing.\n\n\ttabbed line';
    writeFileSync(
      path,
      [
        '---',
        'name: kotlin-testing',
        'description: How to test on the JVM.',
        'tags: [kotlin]',
        'stack: [agnostic]',
        '---',
        body,
      ].join('\n'),
      'utf8',
    );

    applyDerivation(planDerivation(root, options), options);

    expect(bodyOf(path)).toBe(body);
    expect(frontmatterOf(path)['stack']).toEqual(['kotlin']);
  });
});

describe('a second run', () => {
  it('changes nothing after the first has run', () => {
    const root = newRoot();
    const path = plantSkill(
      root,
      'kotlin-testing',
      [
        'description: How to test on the JVM.',
        'tags: [kotlin]',
        'stack: [agnostic]',
        'prevents: a suite that never ran',
        'signal: silent',
      ],
      bodyWithTrigger('When a JVM test suite needs writing.'),
    );

    const first = applyDerivation(planDerivation(root, options), options);
    const afterFirst = readFileSync(path, 'utf8');
    const second = applyDerivation(planDerivation(root, options), options);

    expect(first.counts.derived).toBe(1);
    expect(second.counts.derived).toBe(0);
    expect(second.counts.unchanged).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe(afterFirst);
  });
});

describe('what is skipped', () => {
  it('skips a file with no frontmatter and a directory that holds no SKILL.md', () => {
    const root = newRoot();
    const dir = join(root, 'kotlin-testing');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    writeFileSync(path, '# A skill with no block\n', 'utf8');
    mkdirSync(join(root, 'empty-skill'), { recursive: true });

    const plan = planDerivation(root, options);

    expect(actionFor(plan, path).kind).toBe('skipped');
    expect(actionFor(plan, path).detail).toContain('no --- block');
    expect(plan.counts.skipped).toBeGreaterThanOrEqual(2);
    expect(plan.counts.derived).toBe(0);
  });
});

describe('the check before the write', () => {
  it('puts back a file whose candidate text fails a check it passed, beside one it writes', () => {
    const root = newRoot();
    const broken = plantSkill(
      root,
      'kotlin-testing',
      ['description: How to test on the JVM.', 'tags: [kotlin]', 'stack: [agnostic]'],
      bodyWithTrigger('When a JVM test suite needs writing.'),
    );
    const clean = plantSkill(
      root,
      'rust-testing',
      ['description: How to test a crate.', 'tags: [rust]', 'stack: [agnostic]'],
      bodyWithTrigger('When a crate needs a test suite.'),
    );
    const before = readFileSync(broken, 'utf8');

    const plan = planDerivation(root, options);
    const tampered: DerivationPlan = {
      ...plan,
      actions: plan.actions.map((action) => (action.path === broken
        ? { ...action, text: withoutTags(action.text ?? '') }
        : action)),
    };
    expect(tampered.actions.some((action) => action.text?.includes('tags') === false)).toBe(true);
    const applied = applyDerivation(tampered, options);
    const refused = actionFor(applied, broken);

    expect(refused.kind).toBe('refused');
    expect(refused.added.join(' ')).toContain('missing-field');
    expect(readFileSync(broken, 'utf8')).toBe(before);

    expect(actionFor(applied, clean).kind).toBe('derived');
    expect(frontmatterOf(clean)['stack']).toEqual(['rust']);
  });

  it('refuses a file that changed between the plan and the apply', () => {
    const root = newRoot();
    const path = plantSkill(
      root,
      'kotlin-testing',
      ['description: How to test on the JVM.', 'tags: [kotlin]', 'stack: [agnostic]'],
      bodyWithTrigger('When a JVM test suite needs writing.'),
    );

    const plan = planDerivation(root, options);
    const edited = `${readFileSync(path, 'utf8')}\nAn edit from another window.\n`;
    writeFileSync(path, edited, 'utf8');
    const applied = applyDerivation(plan, options);

    expect(actionFor(applied, path).kind).toBe('refused');
    expect(actionFor(applied, path).detail).toContain('changed since the plan');
    expect(readFileSync(path, 'utf8')).toBe(edited);
  });
});

describe('countDerivations', () => {
  it('counts every kind, zero included', () => {
    const counts = countDerivations([]);
    expect(Object.keys(counts).sort((left, right) => left.localeCompare(right)))
      .toEqual([...DERIVATION_KINDS].sort((left, right) => left.localeCompare(right)));
    expect(Object.values(counts)).toEqual([0, 0, 0, 0]);
  });
});
