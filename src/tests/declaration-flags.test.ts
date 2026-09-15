/**
 * The declaration-to-flag mapping, every side of the priority rule.
 *
 * `utils/declaration.test.ts` beside the module drives the grammar and
 * hands this matrix here by name, keeping exactly one claim of its own:
 * a null declaration resolves to no flags at all. What is left is the
 * rule the grammar duplicates ON PURPOSE. An `agent` outranks `model`
 * and `tools` whenever it is named, because an agent definition already
 * names a model and a tool set and a flag beside it would be two
 * authorities for one decision. It outranks `effort` only when its
 * definition declares an effort of its own; otherwise `--effort` joins
 * `--agent`. The outranked keys stay ON THE RECORD, and
 * {@link ResolvedFlags.suppressed} names which ones those were.
 *
 * Whether a definition declares an effort is a lookup the caller hands
 * in, which `utils/agent-definition.ts` answers for the loop from the
 * definition's frontmatter. That module's suite reads files; this one
 * hands in a lookup that RECORDS the names it is asked about, so a case
 * can tell an effort decided by the named agent's definition from one
 * decided by any definition at all. Every case naming no agent hands in
 * a lookup that THROWS, so a resolver consulting definitions for an
 * unrouted block reddens rather than passing.
 *
 * Half of the rule is a REFUSAL — the resolver emitting no `--model`
 * for a block that plainly carried one — and a refusal case is
 * satisfied by a resolver that emits nothing whatever it is handed. So
 * the shape here is a TABLE rather than a list of assertions: every
 * entry in `ROUTING_PAIRS` carries one granular half, and the table is
 * driven from THREE sides — no agent in front of that half, `agent=`
 * with a definition silent on effort, and `agent=` with one declaring
 * it — varying one axis at a time while the granular spelling stays
 * byte-identical across all three. The mapping reading and the two
 * suppression readings are therefore each other's positive controls,
 * and none of them can pass against a resolver that has stopped
 * emitting.
 *
 * Flag names are pinned to LITERALS. `--agent`, `--model`, `--effort`,
 * `--max-budget-usd` and `--tools` are the CLI's spellings and not this
 * module's, so a
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
 * Twenty mutations of `utils/declaration.ts` were driven against this
 * file, each run TWICE with the failing case NAMES identical on both
 * passes, and the module restored byte-identical (sha256 checked) after
 * each. NINETEEN reddened at least one of the 14 cases here, and their
 * union covers all 14.
 *
 * Ten legs aim at the agent branch: never passing an effort beside an
 * agent 6, ignoring the lookup 6, inverting it 6, asking it about
 * another name 6, putting `--effort` ahead of `--agent` 3, passing
 * `--model` beside both 3, naming a passed effort as suppressed 3,
 * leaving an owned effort unnamed 3, reversing `AGENT_OWNED_KEYS` 2,
 * and asking the lookup about a block with no effort 1. That last leg
 * reddens the recorder case ALONE, which is what the recorder is for.
 *
 * Nine rebuild the unrouted legs against the new resolver: consulting
 * the lookup for a block naming no agent 6 (the throwing lookup),
 * clearing an outranked model off the record 6, renaming `--model` 5,
 * renaming the unrouted `--effort` 5, putting the unrouted effort ahead
 * of the model 5, space-joining the tool list 4, naming all three as
 * suppressed whatever the block held 4, dropping the model presence
 * guard 3, and dropping the tools presence guard 2. Clearing the model
 * off the record is the only leg reaching
 * `keeps the outranked values on the record either way`.
 *
 * The ONE green is named rather than dropped: a null declaration
 * resolving to a flag reddens nothing here, because no fixture here
 * hands the resolver a null. It reddens the colocated suite (1 case)
 * and `tests/declaration-negatives.test.ts` (13).
 *
 * ## The budget half
 *
 * The three cases under `a budget passes whatever routes the task` came
 * with the `budget` key, after that grid, so its counts are of the 14
 * cases before them. Three legs of `utils/declaration.ts` were driven on
 * 2026-09-15 against this file and the three other declaration suites,
 * each restored sha256-identical, and each reddened a case here: the
 * budget dropped beside an agent (1), the budget emitted after the tools
 * (1), and a zero budget accepted (1 here, 1 in the colocated suite).
 */
import type {
  AgentEffortLookup,
  ResolvedFlags,
  TaskDeclaration,
} from '../utils/declaration.js';

import { describe, expect, it } from 'bun:test';

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

/** A second agent, whose definition the name-keyed case varies. */
const OTHER_AGENT = 'tdd-guide';

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

/** A key the resolver can name as left to the agent. */
type SuppressedKey = ResolvedFlags['suppressed'][number];

/**
 * One granular half of a block, with what it resolves to from each of
 * the three sides. `flags` is what the keys map to with no agent named.
 * `routed` is what follows `--agent` when the definition is silent on
 * effort, and `suppressed` what is left to the agent then; `owned` is
 * what is left to it when the definition declares an effort.
 */
interface RoutingPair {
  id: string;
  granular: string;
  flags: string[];
  routed: string[];
  suppressed: SuppressedKey[];
  owned: SuppressedKey[];
}

/** The granular halves, the last one written backwards on purpose. */
const ROUTING_PAIRS: readonly RoutingPair[] = [
  {
    id: 'model alone',
    granular: 'model=haiku',
    flags: ['--model', 'haiku'],
    routed: [],
    suppressed: ['model'],
    owned: ['model'],
  },
  {
    id: 'effort alone',
    granular: 'effort=low',
    flags: ['--effort', 'low'],
    routed: ['--effort', 'low'],
    suppressed: [],
    owned: ['effort'],
  },
  {
    id: 'tools alone',
    granular: 'tools=Read,Write',
    flags: ['--tools', 'Read,Write'],
    routed: [],
    suppressed: ['tools'],
    owned: ['tools'],
  },
  {
    id: 'model and effort',
    granular: 'model=opus effort=max',
    flags: ['--model', 'opus', '--effort', 'max'],
    routed: ['--effort', 'max'],
    suppressed: ['model'],
    owned: ['model', 'effort'],
  },
  {
    id: 'all three, written backwards',
    granular: 'tools=Grep effort=high model=sonnet',
    flags: ['--model', 'sonnet', '--effort', 'high', '--tools', 'Grep'],
    routed: ['--effort', 'high'],
    suppressed: ['model', 'tools'],
    owned: ['model', 'effort', 'tools'],
  },
];

/** A lookup over definitions, and every name it was asked about. */
interface RecordingLookup {
  lookup: AgentEffortLookup;
  asked: string[];
}

/** Definitions in which exactly the `declaring` agents carry an effort. */
function definitions(...declaring: string[]): RecordingLookup {
  const asked: string[] = [];
  const lookup: AgentEffortLookup = (agent) => {
    asked.push(agent);
    return declaring.includes(agent);
  };
  return { lookup, asked };
}

/** The lookup every case naming no agent hands in. */
const NEVER_ASKED: AgentEffortLookup = (agent) => {
  throw new Error(`a block naming no agent asked about ${agent}`);
};

/** The declaration a text carries, or a failure naming the text. */
function declarationOf(taskText: string): TaskDeclaration {
  const parsed = parseTaskDeclaration(taskText);
  if (parsed.declaration === null) {
    throw new Error(`no declaration parsed from: ${taskText}`);
  }
  return parsed.declaration;
}

/** What a task line's own block resolves to under `lookup`. */
function flagsOf(taskText: string, lookup: AgentEffortLookup): ResolvedFlags {
  return resolveDeclarationFlags(declarationOf(taskText), lookup);
}

/** A line carrying `granular` alone. */
function granularLine(granular: string): string {
  return `${TASK}${GAP}{${granular}}`;
}

/** The same line with an agent in front of the same granular half. */
function routedLine(granular: string): string {
  return `${TASK}${GAP}{agent=${AGENT} ${granular}}`;
}

describe('an agent present outranks its model and tools', () => {
  it('passes the effort a silent definition leaves open', () => {
    for (const pair of ROUTING_PAIRS) {
      const routed = flagsOf(routedLine(pair.granular), definitions().lookup);

      expect([...routed.args]).toEqual(['--agent', 'doc-updater', ...pair.routed]);
      expect([...routed.suppressed]).toEqual(pair.suppressed);
    }

    expect(ROUTING_PAIRS).toHaveLength(5);
  });

  it('passes the agent alone when its definition declares an effort', () => {
    for (const pair of ROUTING_PAIRS) {
      const owned = flagsOf(routedLine(pair.granular), definitions(AGENT).lookup);

      expect([...owned.args]).toEqual(['--agent', 'doc-updater']);
      expect([...owned.suppressed]).toEqual(pair.owned);
    }
  });

  it('asks about the named agent, and only for a block declaring effort', () => {
    const withEffort = definitions();
    const withoutEffort = definitions();

    flagsOf(routedLine('model=haiku effort=low'), withEffort.lookup);
    flagsOf(routedLine('model=haiku tools=Read'), withoutEffort.lookup);

    // The first list is the second one's control: the same recorder,
    // asked once, so an empty list is a lookup left alone rather than a
    // recorder that stopped recording.
    expect(withEffort.asked).toEqual(['doc-updater']);
    expect(withoutEffort.asked).toEqual([]);
  });

  it('decides the effort by the named agent definition, not by any', () => {
    const others = definitions(OTHER_AGENT);
    const ownLine = `${TASK}${GAP}{agent=${OTHER_AGENT} effort=low}`;

    expect([...flagsOf(routedLine('effort=low'), others.lookup).args])
      .toEqual(['--agent', 'doc-updater', '--effort', 'low']);
    expect([...flagsOf(ownLine, others.lookup).args])
      .toEqual(['--agent', 'tdd-guide']);
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

  it('emits no model or tools flag beside the agent', () => {
    const granular = 'model=haiku effort=low tools=Read,Write';
    const silent = flagsOf(routedLine(granular), definitions().lookup);
    const owned = flagsOf(routedLine(granular), definitions(AGENT).lookup);

    for (const routed of [silent, owned]) {
      expect(routed.args).not.toContain('--model');
      expect(routed.args).not.toContain('--tools');
    }
    expect(silent.args).toContain('--effort');
    expect(owned.args).not.toContain('--effort');
    expect(flagsOf(granularLine(granular), NEVER_ASKED).args).toEqual([
      '--model',
      'haiku',
      '--effort',
      'low',
      '--tools',
      'Read,Write',
    ]);
  });

  it('names nothing when the block carried no granular key', () => {
    const bare = flagsOf(`${TASK}${GAP}{agent=${AGENT}}`, definitions(AGENT).lookup);

    expect(bare.args).toEqual(['--agent', 'doc-updater']);
    expect(bare.suppressed).toEqual([]);
    expect([...flagsOf(routedLine('model=haiku'), definitions(AGENT).lookup).suppressed])
      .toEqual(['model']);
  });

  it('names the outranked keys in module order', () => {
    const owned = flagsOf(routedLine(BACKWARDS), definitions(AGENT).lookup);
    const silent = flagsOf(routedLine(BACKWARDS), definitions().lookup);
    const written = declarationOf(routedLine('tools=Grep model=opus'));

    expect([...owned.suppressed]).toEqual(['model', 'effort', 'tools']);
    expect([...silent.suppressed]).toEqual(['model', 'tools']);
    expect(written.entries.map((entry) => entry.key)).toEqual([
      'agent',
      'tools',
      'model',
    ]);
  });

  it('routes the plan hygiene task by its agent and its effort', () => {
    const silent = flagsOf(HYGIENE_LINE, definitions().lookup);
    const owned = flagsOf(HYGIENE_LINE, definitions(AGENT).lookup);

    expect([...silent.args]).toEqual(['--agent', 'doc-updater', '--effort', 'low']);
    expect([...silent.suppressed]).toEqual(['model']);
    expect([...owned.args]).toEqual(['--agent', 'doc-updater']);
    expect([...owned.suppressed]).toEqual(['model', 'effort']);
  });
});

describe('an agent absent maps the granular keys onto flags', () => {
  it('maps every granular key onto its own flag', () => {
    for (const pair of ROUTING_PAIRS) {
      const resolved = flagsOf(granularLine(pair.granular), NEVER_ASKED);

      expect([...resolved.args]).toEqual(pair.flags);
      expect(resolved.suppressed).toEqual([]);
    }

    expect(ROUTING_PAIRS.map((pair) => pair.id)).toHaveLength(5);
  });

  it('emits the flags in module order, not source order', () => {
    const resolved = flagsOf(granularLine(BACKWARDS), NEVER_ASKED);

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
    const resolved = flagsOf(granularLine('tools=Read,Write,Read'), NEVER_ASKED);

    expect([...resolved.args]).toEqual(['--tools', 'Read,Write']);
    expect(declarationOf(granularLine('tools=Read,Write,Read')).tools)
      .toEqual(['Read', 'Write']);
  });

  it('emits nothing for a key whose value it could not use', () => {
    const dropped = flagsOf(granularLine('model=opuss effort=low'), NEVER_ASKED);

    expect([...dropped.args]).toEqual(['--effort', 'low']);
    expect(dropped.suppressed).toEqual([]);
    expect([...flagsOf(granularLine('model=opus effort=low'), NEVER_ASKED).args])
      .toEqual(['--model', 'opus', '--effort', 'low']);
  });

  it('maps the plan routing task onto its three flags', () => {
    const resolved = flagsOf(ROUTING_LINE, NEVER_ASKED);

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

describe('a budget passes whatever routes the task', () => {
  it('passes the budget with no agent, after the effort and ahead of the tools', () => {
    const resolved = flagsOf(granularLine('tools=Grep budget=0.5 effort=high model=sonnet'), NEVER_ASKED);

    expect(resolved).toEqual({
      args: ['--model', 'sonnet', '--effort', 'high', '--max-budget-usd', '0.5', '--tools', 'Grep'],
      suppressed: [],
    });
  });

  it('passes the budget beside an agent, whether or not its definition declares an effort', () => {
    const silent = definitions();
    const declaring = definitions(AGENT);
    const line = routedLine('model=haiku effort=low budget=2 tools=Read');

    expect(flagsOf(line, silent.lookup)).toEqual({
      args: ['--agent', AGENT, '--effort', 'low', '--max-budget-usd', '2'],
      suppressed: ['model', 'tools'],
    });
    expect(flagsOf(line, declaring.lookup)).toEqual({
      args: ['--agent', AGENT, '--max-budget-usd', '2'],
      suppressed: ['model', 'effort', 'tools'],
    });
    expect(flagsOf(routedLine('budget=0.75'), definitions().lookup)).toEqual({
      args: ['--agent', AGENT, '--max-budget-usd', '0.75'],
      suppressed: [],
    });

    // The control: the same blocks with the budget taken out pass no budget flag.
    const unbudgeted = routedLine('model=haiku effort=low tools=Read');
    expect(flagsOf(unbudgeted, silent.lookup).args).toEqual(['--agent', AGENT, '--effort', 'low']);
    expect(flagsOf(unbudgeted, declaring.lookup).args).toEqual(['--agent', AGENT]);
  });

  it('passes no budget flag for a budget it could not use, keeping the rest of the block', () => {
    expect(flagsOf(routedLine('budget=0'), definitions().lookup).args).toEqual(['--agent', AGENT]);
    expect(flagsOf(granularLine('budget=$1 effort=low'), NEVER_ASKED).args).toEqual(['--effort', 'low']);
    expect(declarationOf(granularLine('budget=$1 effort=low')).budget).toBeNull();
  });
});
