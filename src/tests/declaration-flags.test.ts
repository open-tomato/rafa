/**
 * The declaration-to-flag mapping, both halves of the priority rule.
 *
 * `utils/declaration.test.ts` beside the module drives the grammar and
 * hands this matrix here by name, keeping exactly one claim of its own:
 * a null declaration resolves to no flags at all. What is left is the
 * rule the grammar duplicates ON PURPOSE — an `agent` outranks
 * `model`, `effort` and `tools` entirely, because an agent definition
 * already names a model and a tool set and a flag beside it would be
 * two authorities for one decision. The outranked keys stay ON THE
 * RECORD so a later report can say what a planner asked for against
 * what the agent supplied, and {@link ResolvedFlags.suppressed} names
 * which ones those were.
 *
 * Half of that is a REFUSAL — the resolver emitting no `--model` for a
 * block that plainly carried one — and a refusal case is satisfied by a
 * resolver that emits nothing whatever it is handed. So the shape here
 * is a PAIRED TABLE rather than a list of assertions: every entry in
 * `ROUTING_PAIRS` carries one granular half, and the table is driven
 * TWICE — once by the case that puts `agent=` in front of that half
 * and once by the case that does not — varying the single axis the
 * rule is about while the granular spelling stays byte-identical
 * across the pair. The suppression reading and the mapping reading
 * are therefore each other's positive control, and neither can pass
 * against a resolver that has stopped emitting.
 *
 * Flag names are pinned to LITERALS. `--agent`, `--model`, `--effort`
 * and `--tools` are the CLI's spellings and not this module's, so a
 * case built from the module's own constants would move with a typo
 * rather than reporting it; the same reason the colocated suite pins
 * the effort levels.
 *
 * Two orderings are asserted because they are decisions rather than
 * accidents. The resolver emits flags in the module's own
 * `DECLARATION_KEYS` order whatever order the block wrote them in —
 * the last table entry spells its three keys backwards for exactly
 * that reading — and `suppressed` is named in `GRANULAR_KEYS` order
 * for the same reason. A report joining two runs of one plan compares
 * those lists, and a source-order answer would make two identical
 * declarations differ.
 *
 * ## The mutation grid
 *
 * Thirteen module mutations were driven against this file and TWELVE
 * reddened at least one case. Every leg ran TWICE and named the
 * IDENTICAL red set on both passes, asked for through
 * `--reporter=json` so a red SET is comparable member for member — a
 * red COUNT cannot separate two legs reddening the same number of
 * different cases, which is exactly the split that says which fixture
 * carries which claim. The module was restored bytes-identical and all
 * 11 cases were green either side.
 *
 * The twelve, with the cases each took: inverting the agent test 10,
 * dropping the agent branch 5, clearing the outranked values off the
 * record 5, renaming `--model` 5, renaming `--effort` 5, emitting a
 * granular flag beside `--agent` 4, naming nothing as suppressed 4,
 * space-joining the tool list 4, naming all three as suppressed
 * regardless 3, dropping the model presence guard 3, taking source
 * order for the suppressed list 2, and dropping the tools presence
 * guard 2. The union covers all 11 cases, so no fixture here is
 * riding along.
 *
 * The ONE green is named rather than dropped and is not a hole: making
 * a null declaration resolve to a flag reddens nothing, because that
 * claim is the colocated suite's and no fixture here hands the resolver
 * a null. Re-driving it there is what covers it.
 */
import type {
  ResolvedFlags,
  TaskDeclaration,
} from '../utils/declaration.js';

import { describe, expect, it } from 'vitest';

import {
  parseTaskDeclaration,
  resolveDeclarationFlags,
} from '../utils/declaration.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** A task sentence, held fixed so only the block varies. */
const TASK = 'Update the cap sentence';

/** The agent every routed fixture below names. */
const AGENT = 'doc-updater';

/** The routing-table task of this plan, without its block. */
const ROUTING_TASK = [
  'Add the task-shape to agent routing table to `context/workflow.md`,',
  'mapping prose to `doc-updater`, tests to `tdd-guide`, migrations to',
  '`database-reviewer`, repair to `build-error-resolver`, cleanup to',
  '`refactor-cleaner`, review to the read-only reviewers, and',
  'implementation to `loop-implementer`',
].join(' ');

/** That task's own block, granular, as the plan spells it. */
const ROUTING_BLOCK =
  '{tools=Read,Write,Edit,Grep,Glob model=haiku effort=low}';

/** The routing task exactly as its own tracker line spells it. */
const ROUTING_LINE = `${ROUTING_TASK}${GAP}${ROUTING_BLOCK}`;

/** The progress-hygiene task of this plan, agent-routed. */
const HYGIENE_BLOCK = '{agent=doc-updater model=haiku effort=low}';

/** That task's own line, the plan's only agent-routed one. */
const HYGIENE_LINE =
  `Update the skill cap sentence${GAP}${HYGIENE_BLOCK}`;

/** Three granular keys written in the opposite of module order. */
const BACKWARDS = 'tools=Grep effort=high model=opus';

/**
 * One granular half of a block, with what it resolves to on each side
 * of the single axis under test. `flags` is what the keys map to with
 * no agent named; `suppressed` is what they are reported as when one
 * is. The last entry writes its keys backwards on purpose.
 */
const ROUTING_PAIRS = [
  {
    id: 'model alone',
    granular: 'model=haiku',
    flags: ['--model', 'haiku'],
    suppressed: ['model'],
  },
  {
    id: 'effort alone',
    granular: 'effort=low',
    flags: ['--effort', 'low'],
    suppressed: ['effort'],
  },
  {
    id: 'tools alone',
    granular: 'tools=Read,Write',
    flags: ['--tools', 'Read,Write'],
    suppressed: ['tools'],
  },
  {
    id: 'model and effort',
    granular: 'model=opus effort=max',
    flags: ['--model', 'opus', '--effort', 'max'],
    suppressed: ['model', 'effort'],
  },
  {
    id: 'all three, written backwards',
    granular: 'tools=Grep effort=high model=sonnet',
    flags: ['--model', 'sonnet', '--effort', 'high', '--tools', 'Grep'],
    suppressed: ['model', 'effort', 'tools'],
  },
];

/** The declaration a text carries, or a failure naming the text. */
function declarationOf(taskText: string): TaskDeclaration {
  const parsed = parseTaskDeclaration(taskText);
  if (parsed.declaration === null) {
    throw new Error(`no declaration parsed from: ${taskText}`);
  }
  return parsed.declaration;
}

/** What a task line's own block resolves to on the command line. */
function flagsOf(taskText: string): ResolvedFlags {
  return resolveDeclarationFlags(declarationOf(taskText));
}

/** A line carrying `granular` alone. */
function granularLine(granular: string): string {
  return `${TASK}${GAP}{${granular}}`;
}

/** The same line with an agent in front of the same granular half. */
function routedLine(granular: string): string {
  return `${TASK}${GAP}{agent=${AGENT} ${granular}}`;
}

describe('an agent present suppresses the granular keys', () => {
  it('passes the agent alone and names what it outranked', () => {
    for (const pair of ROUTING_PAIRS) {
      const routed = flagsOf(routedLine(pair.granular));

      expect(routed.args).toEqual(['--agent', 'doc-updater']);
      expect([...routed.suppressed]).toEqual(pair.suppressed);
    }

    expect(ROUTING_PAIRS).toHaveLength(5);
  });

  it('keeps the outranked values on the record either way', () => {
    const granular = 'model=haiku effort=low tools=Read,Write';
    const routed = declarationOf(routedLine(granular));
    const plain = declarationOf(granularLine(granular));

    for (const record of [routed, plain]) {
      expect(record.model).toBe('haiku');
      expect(record.effort).toBe('low');
      expect(record.tools).toEqual(['Read', 'Write']);
      expect(record.issues).toEqual([]);
    }

    expect(routed.agent).toBe('doc-updater');
    expect(plain.agent).toBeNull();
  });

  it('emits no granular flag beside the agent', () => {
    const granular = 'model=haiku effort=low tools=Read,Write';
    const routed = flagsOf(routedLine(granular));

    expect(routed.args).not.toContain('--model');
    expect(routed.args).not.toContain('--effort');
    expect(routed.args).not.toContain('--tools');
    expect(flagsOf(granularLine(granular)).args).toEqual([
      '--model',
      'haiku',
      '--effort',
      'low',
      '--tools',
      'Read,Write',
    ]);
  });

  it('names nothing when the block carried no granular key', () => {
    const bare = flagsOf(`${TASK}${GAP}{agent=${AGENT}}`);

    expect(bare.args).toEqual(['--agent', 'doc-updater']);
    expect(bare.suppressed).toEqual([]);
    expect([...flagsOf(routedLine('model=haiku')).suppressed])
      .toEqual(['model']);
  });

  it('names the outranked keys in module order', () => {
    const backwards = flagsOf(routedLine(BACKWARDS));
    const written = declarationOf(routedLine('tools=Grep model=opus'));

    expect([...backwards.suppressed]).toEqual(['model', 'effort', 'tools']);
    expect(written.entries.map((entry) => entry.key)).toEqual([
      'agent',
      'tools',
      'model',
    ]);
  });

  it('routes the plan hygiene task by its agent alone', () => {
    const resolved = flagsOf(HYGIENE_LINE);

    expect(resolved.args).toEqual(['--agent', 'doc-updater']);
    expect([...resolved.suppressed]).toEqual(['model', 'effort']);
  });
});

describe('an agent absent maps the granular keys onto flags', () => {
  it('maps every granular key onto its own flag', () => {
    for (const pair of ROUTING_PAIRS) {
      const resolved = flagsOf(granularLine(pair.granular));

      expect([...resolved.args]).toEqual(pair.flags);
      expect(resolved.suppressed).toEqual([]);
    }

    expect(ROUTING_PAIRS.map((pair) => pair.id)).toHaveLength(5);
  });

  it('emits the flags in module order, not source order', () => {
    const resolved = flagsOf(granularLine(BACKWARDS));

    expect([...resolved.args]).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
      '--tools',
      'Grep',
    ]);
  });

  it('joins the tool list back with commas', () => {
    const resolved = flagsOf(granularLine('tools=Read,Write,Read'));

    expect([...resolved.args]).toEqual(['--tools', 'Read,Write']);
    expect(declarationOf(granularLine('tools=Read,Write,Read')).tools)
      .toEqual(['Read', 'Write']);
  });

  it('emits nothing for a key whose value it could not use', () => {
    const dropped = flagsOf(granularLine('model=opuss effort=low'));

    expect([...dropped.args]).toEqual(['--effort', 'low']);
    expect(dropped.suppressed).toEqual([]);
    expect([...flagsOf(granularLine('model=opus effort=low')).args])
      .toEqual(['--model', 'opus', '--effort', 'low']);
  });

  it('maps the plan routing task onto its three flags', () => {
    const resolved = flagsOf(ROUTING_LINE);

    expect([...resolved.args]).toEqual([
      '--model',
      'haiku',
      '--effort',
      'low',
      '--tools',
      'Read,Write,Edit,Grep,Glob',
    ]);
    expect(resolved.suppressed).toEqual([]);
  });
});
