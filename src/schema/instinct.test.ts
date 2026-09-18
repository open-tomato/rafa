/**
 * Tests for the instinct record.
 *
 * Most cases are a whole file built from strings by {@link
 * recordText}, because the reader takes file text: the action lives in
 * the body and half the rules are about the two halves agreeing. The
 * {@link REFUSALS} table pairs every refusal with the nearly-identical
 * record that passes, so a refusal is a reading about ONE field rather
 * than about a file being broken in general, and the case under `the
 * issue codes` closes the set in both directions against
 * {@link INSTINCT_ISSUE_CODES}: a code nothing here provokes and a
 * code produced by nothing named here are both red.
 *
 * ## The hash is computed twice
 *
 * `actionHash` is asserted against a digest computed independently in
 * the test with `node:crypto`, and against a literal hex string that
 * `printf | shasum -a 256` produced for the lowercased action on
 * 2026-09-18. The literal is what makes it a reading about SHA-256 of
 * the trimmed, lowercased action rather than about the module agreeing
 * with itself: the two `node:crypto` spellings would move together if
 * the module changed its input, and the shell digest would not.
 *
 * The spec's guarantee — a hand edit cannot leave a hash stale — is
 * measured as a pair: the same frontmatter with an edited Action reads
 * as a different hash, and the same Action indented differently and in
 * another case reads as the same one.
 *
 * The `project_id` field is only read here, never derived: deriving it
 * is `./project-id.ts`, and `project-id.test.ts` measures it against
 * the shell it copies.
 */
import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { FINDING_KINDS, FINDING_SIGNALS } from '../report/parse.js';

import { renderFrontmatter } from './frontmatter.js';
import {
  ACTION_HEADING,
  CAUSE_HEADING,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DEFAULT_USAGE_COUNT,
  INSTINCT_DOMAINS,
  INSTINCT_ISSUE_CODES,
  INSTINCT_KEY_ORDER,
  INSTINCT_KINDS,
  INSTINCT_SIGNALS,
  PROJECT_ID_LENGTH,
  actionHash,
  checkInstinctBody,
  checkInstinctFrontmatter,
  instinctFrontmatter,
  parseInstinct,
  sectionText,
  toLearningRecord,
  writeInstinct,
} from './instinct.js';

/** Every frontmatter key at once, each holding a value nothing refuses. */
const COMPLETE = {
  id: 'bun-install-after-worktree-fork',
  trigger: 'when running tests in a freshly forked worktree',
  kind: 'gotcha',
  domain: 'workflow',
  confidence: 0.6,
  usage_count: 3,
  artifact: 'Cannot find package',
  signal: 'loud',
  scope: 'project',
  project_id: '8f2c1a9d3e4b',
  source: 'task-report',
  evidence: [{
    plan: 'my-feature',
    task: 'Run the schema tests',
    session: '6f1e',
    outcome: 'blocked',
  }],
  created_at: '2026-09-11T10:00:00Z',
  updated_at: '2026-09-11T10:00:00Z',
} as const;

/** The action every fixture carries unless it says otherwise. */
const ACTION = 'Run `bun install --frozen-lockfile` before the first test.';

/** The cause every fixture carries unless it says otherwise. */
const CAUSE = 'Worktree creation copies the tree, not `node_modules`.';

/** A body with both sections, as the writer lays them out. */
const BODY = `\n${ACTION_HEADING}\n${ACTION}\n\n${CAUSE_HEADING}\n${CAUSE}\n`;

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

/** A whole record file: {@link COMPLETE} plus `changes`, and `body`. */
function recordText(
  changes: Readonly<Record<string, unknown>> = {},
  body: string = BODY,
): string {
  return `---\n${renderFrontmatter(withFields(COMPLETE, changes))}\n---\n${body}`;
}

/** The codes and fields `text` is refused for, as `code field` pairs. */
function refusalsOf(text: string): string[] {
  return parseInstinct(text).issues.map((entry) => `${entry.code} ${entry.field}`);
}

describe('a complete record', () => {
  const result = parseInstinct(recordText());

  test('is accepted', () => {
    expect(result.issues).toEqual([]);
    expect(result.instinct).not.toBeNull();
  });

  test('reads every frontmatter field under a camelCase name', () => {
    expect(result.instinct).toMatchObject({
      id: 'bun-install-after-worktree-fork',
      trigger: 'when running tests in a freshly forked worktree',
      kind: 'gotcha',
      domain: 'workflow',
      confidence: 0.6,
      usageCount: 3,
      artifact: 'Cannot find package',
      signal: 'loud',
      scope: 'project',
      projectId: '8f2c1a9d3e4b',
      source: 'task-report',
      createdAt: '2026-09-11T10:00:00Z',
      updatedAt: '2026-09-11T10:00:00Z',
    });
    expect(result.instinct?.evidence).toEqual(COMPLETE.evidence);
  });

  test('reads the two body sections trimmed of their blank lines', () => {
    expect(result.instinct?.action).toBe(ACTION);
    expect(result.instinct?.cause).toBe(CAUSE);
  });

  test('defaults usage_count and nulls the two optional fields when absent', () => {
    const sparse = parseInstinct(recordText({
      usage_count: undefined,
      artifact: undefined,
      project_id: undefined,
    }));

    expect(sparse.issues).toEqual([]);
    expect(sparse.instinct?.usageCount).toBe(DEFAULT_USAGE_COUNT);
    expect(sparse.instinct?.artifact).toBeNull();
    expect(sparse.instinct?.projectId).toBeNull();
  });

  test('reads an empty artifact as no artifact', () => {
    const blank = parseInstinct(recordText({ artifact: '' }));

    expect(blank.issues).toEqual([]);
    expect(blank.instinct?.artifact).toBeNull();
  });
});

describe('action_hash', () => {
  /** The digest, computed a second way, from the spelling the spec states. */
  const expected = createHash('sha256').update(ACTION.trim()
    .toLowerCase())
    .digest('hex');

  test('is the SHA-256 of the lowercased action', () => {
    expect(actionHash(ACTION)).toBe(expected);
    expect(actionHash(ACTION))
      .toBe('6eb465fd3c595dd9f5d10285ddac4d88b7c663e6f4204b24a7736252edbac54c');
  });

  test('ignores the whitespace and the case the section is written in', () => {
    expect(actionHash(`\n  ${ACTION.toUpperCase()}  \n`)).toBe(expected);
  });

  test('is on the record the reader answers', () => {
    expect(parseInstinct(recordText()).instinct?.actionHash).toBe(expected);
  });

  test('moves when the Action section is edited by hand', () => {
    const edited = recordText(
      {},
      `\n${ACTION_HEADING}\nRun bun install --production instead.\n\n${CAUSE_HEADING}\n${CAUSE}\n`,
    );

    expect(parseInstinct(edited).instinct?.actionHash).not.toBe(expected);
  });

  test('is refused when the file stores one, and accepted when it does not', () => {
    expect(refusalsOf(recordText({ action_hash: expected })))
      .toEqual(['stored-action-hash action_hash']);
    expect(refusalsOf(recordText())).toEqual([]);
  });
});

describe('the body sections', () => {
  test('stop at the next heading and keep a fenced one', () => {
    const body = [
      '',
      ACTION_HEADING,
      'Run it.',
      '',
      '```sh',
      '## not a heading',
      '```',
      '',
      CAUSE_HEADING,
      'Because.',
      '',
    ].join('\n');

    expect(sectionText(body, ACTION_HEADING))
      .toBe('Run it.\n\n```sh\n## not a heading\n```');
    expect(sectionText(body, CAUSE_HEADING)).toBe('Because.');
  });

  test('do stop at the same line unfenced, which is the control', () => {
    const body = `\n${ACTION_HEADING}\nRun it.\n\n## not a heading\n`;

    expect(sectionText(body, ACTION_HEADING)).toBe('Run it.');
  });

  test('read as null when the heading is absent', () => {
    expect(sectionText('no headings here', ACTION_HEADING)).toBeNull();
  });

  test('refuse an absent and an empty section by heading', () => {
    expect(checkInstinctBody(`\n${CAUSE_HEADING}\n${CAUSE}\n`).map((entry) => entry.field))
      .toEqual([ACTION_HEADING]);
    expect(checkInstinctBody(`\n${ACTION_HEADING}\n\n${CAUSE_HEADING}\n\n`)
      .map((entry) => `${entry.code} ${entry.field}`))
      .toEqual([
        `missing-section ${ACTION_HEADING}`,
        `missing-section ${CAUSE_HEADING}`,
      ]);
  });

  test('accept a record whose sections are filled, which is the control', () => {
    expect(checkInstinctBody(BODY)).toEqual([]);
  });
});

/** One refused record, the code and field it earns, and why it is here. */
interface Refusal {
  /** What the case is called in the test output. */
  readonly title: string;
  /** The frontmatter change that breaks it. */
  readonly changes: Readonly<Record<string, unknown>>;
  /** The body, when the case is about the body. */
  readonly body?: string;
  /** Every `code field` pair the record must earn, in order. */
  readonly expected: readonly string[];
}

/** Every rule, refused once and passed once by its neighbouring case. */
const REFUSALS: readonly Refusal[] = [
  {
    title: 'an absent id',
    changes: { id: undefined },
    expected: ['missing-field id'],
  },
  {
    title: 'an id that is not a slug',
    changes: { id: 'Bun Install' },
    expected: ['invalid-id id'],
  },
  {
    title: 'a trigger that is a number',
    changes: { trigger: 3 },
    expected: ['wrong-type trigger'],
  },
  {
    title: 'a trigger that is whitespace',
    changes: { trigger: '   ' },
    expected: ['missing-field trigger'],
  },
  {
    title: 'a kind outside the closed set',
    changes: { kind: 'insight' },
    expected: ['unknown-kind kind'],
  },
  {
    title: 'a domain instinct-cli defaults to but the skill never names',
    changes: { domain: 'general' },
    expected: ['unknown-domain domain'],
  },
  {
    title: 'a signal outside the closed set',
    changes: { signal: 'quiet' },
    expected: ['unknown-signal signal'],
  },
  {
    title: 'a scope outside the closed set',
    changes: { scope: 'global' },
    expected: ['unknown-scope scope'],
  },
  {
    title: 'a source outside the closed set',
    changes: { source: 'session-observation' },
    expected: ['unknown-source source'],
  },
  {
    title: 'a confidence below the floor',
    changes: { confidence: 0.29 },
    expected: ['confidence-out-of-range confidence'],
  },
  {
    title: 'a confidence above the ceiling',
    changes: { confidence: 0.91 },
    expected: ['confidence-out-of-range confidence'],
  },
  {
    title: 'a confidence that is a string',
    changes: { confidence: '0.6' },
    expected: ['wrong-type confidence'],
  },
  {
    title: 'a usage_count of zero',
    changes: { usage_count: 0 },
    expected: ['invalid-usage-count usage_count'],
  },
  {
    title: 'a fractional usage_count',
    changes: { usage_count: 1.5 },
    expected: ['invalid-usage-count usage_count'],
  },
  {
    title: 'a project_id one character short',
    changes: { project_id: '8f2c1a9d3e4' },
    expected: ['invalid-project-id project_id'],
  },
  {
    title: 'a project_id in upper case',
    changes: { project_id: '8F2C1A9D3E4B' },
    expected: ['invalid-project-id project_id'],
  },
  {
    title: 'a created_at that is a date alone',
    changes: { created_at: '2026-09-11' },
    expected: ['invalid-timestamp created_at'],
  },
  {
    title: 'an updated_at naming a month that does not exist',
    changes: { updated_at: '2026-13-01T00:00:00Z' },
    expected: ['invalid-timestamp updated_at'],
  },
  {
    title: 'a task-report record with no evidence',
    changes: { evidence: undefined },
    expected: ['missing-evidence evidence'],
  },
  {
    title: 'a task-report record with an empty evidence list',
    changes: { evidence: [] },
    expected: ['missing-evidence evidence'],
  },
  {
    title: 'an evidence entry that is a string',
    changes: { evidence: ['my-feature'] },
    expected: ['wrong-type evidence[0]'],
  },
  {
    title: 'an evidence entry that says nothing',
    changes: { evidence: [{}] },
    expected: ['wrong-type evidence[0]'],
  },
  {
    title: 'an evidence value that is itself a list',
    changes: { evidence: [{ plan: 'my-feature', task: ['a', 'b'] }] },
    expected: ['wrong-type evidence[0].task'],
  },
  {
    title: 'evidence that is not a list at all',
    changes: { evidence: { plan: 'my-feature' } },
    expected: ['wrong-type evidence'],
  },
  {
    title: 'a stored action_hash',
    changes: { action_hash: 'deadbeef' },
    expected: ['stored-action-hash action_hash'],
  },
  {
    title: 'a body with neither section',
    changes: {},
    body: '\nJust prose.\n',
    expected: [`missing-section ${ACTION_HEADING}`, `missing-section ${CAUSE_HEADING}`],
  },
];

describe('the frontmatter rules', () => {
  for (const refusal of REFUSALS) {
    test(`refuses ${refusal.title}`, () => {
      expect(refusalsOf(recordText(refusal.changes, refusal.body ?? BODY)))
        .toEqual([...refusal.expected]);
    });
  }

  test('accepts the confidence bounds themselves', () => {
    expect(refusalsOf(recordText({ confidence: CONFIDENCE_MIN }))).toEqual([]);
    expect(refusalsOf(recordText({ confidence: CONFIDENCE_MAX }))).toEqual([]);
  });

  test('accepts a usage_count of one and a twelve-character project_id', () => {
    expect(refusalsOf(recordText({ usage_count: DEFAULT_USAGE_COUNT }))).toEqual([]);
    expect(refusalsOf(recordText({ project_id: '0'.repeat(PROJECT_ID_LENGTH) }))).toEqual([]);
  });

  test('accepts every kind, domain and signal in the vocabularies', () => {
    for (const kind of INSTINCT_KINDS) {
      expect(refusalsOf(recordText({ kind }))).toEqual([]);
    }
    for (const domain of INSTINCT_DOMAINS) {
      expect(refusalsOf(recordText({ domain }))).toEqual([]);
    }
    for (const signal of INSTINCT_SIGNALS) {
      expect(refusalsOf(recordText({ signal }))).toEqual([]);
    }
  });

  test('names every broken rule at once rather than the first', () => {
    const issues = checkInstinctFrontmatter(withFields(COMPLETE, {
      id: 'Not A Slug',
      kind: 'insight',
      confidence: 2,
    }));

    expect(issues.map((entry) => entry.code))
      .toEqual(['invalid-id', 'unknown-kind', 'confidence-out-of-range']);
  });

  test('refuses text that carries no frontmatter at all', () => {
    expect(refusalsOf(`${ACTION_HEADING}\n${ACTION}\n`))
      .toEqual(['missing-frontmatter frontmatter']);
    expect(parseInstinct('no frontmatter').instinct).toBeNull();
  });
});

describe('the evidence rule', () => {
  test('is owed only by a task-report record', () => {
    for (const source of ['loop-observed', 'imported', 'demoted']) {
      expect(refusalsOf(recordText({ source, evidence: undefined }))).toEqual([]);
    }
    expect(refusalsOf(recordText({ source: 'task-report', evidence: undefined })))
      .toEqual(['missing-evidence evidence']);
  });

  test('accepts the evidence a demotion writes, which names no task', () => {
    const demoted = parseInstinct(recordText({
      source: 'demoted',
      evidence: [{ extracted_at: '2025-11-02', file: 'drizzle-migration-trap/SKILL.md' }],
    }));

    expect(demoted.issues).toEqual([]);
    expect(demoted.instinct?.evidence[0]).toEqual({
      extracted_at: '2025-11-02',
      file: 'drizzle-migration-trap/SKILL.md',
    });
  });

  test('reads an absent evidence list as an empty one', () => {
    expect(parseInstinct(recordText({ source: 'imported', evidence: undefined }))
      .instinct?.evidence).toEqual([]);
  });
});

describe('the issue codes', () => {
  test('are each reachable, and none is produced without being named', () => {
    const produced = new Set<string>();
    for (const refusal of REFUSALS) {
      for (const entry of parseInstinct(recordText(refusal.changes, refusal.body ?? BODY)).issues) {
        produced.add(entry.code);
      }
    }
    for (const entry of parseInstinct('not a record').issues) produced.add(entry.code);

    expect([...produced].sort()).toEqual([...INSTINCT_ISSUE_CODES].sort());
  });

  test('carry a message that names no field prefix of its own', () => {
    for (const entry of parseInstinct(recordText({ kind: 'insight' })).issues) {
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.message.startsWith(`${entry.field}:`)).toBe(false);
    }
  });
});

describe('the kinds and signals', () => {
  test('are the report findings own sets, not a second spelling of them', () => {
    expect(INSTINCT_KINDS).toBe(FINDING_KINDS);
    expect(INSTINCT_SIGNALS).toBe(FINDING_SIGNALS);
  });
});

describe('the writer', () => {
  const instinct = parseInstinct(recordText()).instinct;

  test('emits the keys in the documented order and no action_hash', () => {
    expect(Object.keys(instinctFrontmatter(instinct!))).toEqual([...INSTINCT_KEY_ORDER]);
    expect(writeInstinct(instinct!)).not.toContain('action_hash');
  });

  test('leaves out the fields the record does not carry', () => {
    const sparse = parseInstinct(recordText({
      source: 'demoted',
      artifact: undefined,
      project_id: undefined,
      evidence: undefined,
    })).instinct;

    expect(Object.keys(instinctFrontmatter(sparse!)))
      .toEqual(['id', 'trigger', 'kind', 'domain', 'confidence', 'usage_count',
        'signal', 'scope', 'source', 'created_at', 'updated_at']);
  });

  test('writes a file the reader reads back as the same record', () => {
    const written = writeInstinct(instinct!);
    const reread = parseInstinct(written);

    expect(reread.issues).toEqual([]);
    expect(reread.instinct).toEqual(instinct);
    expect(writeInstinct(reread.instinct!)).toBe(written);
  });

  test('lays the body out under the two headings, ending in one newline', () => {
    expect(writeInstinct(instinct!)).toContain(`---\n\n${ACTION_HEADING}\n${ACTION}\n`);
    expect(writeInstinct(instinct!).endsWith(`${CAUSE}\n`)).toBe(true);
  });

  test('writes CRLF throughout when asked for it', () => {
    const written = writeInstinct(instinct!, '\r\n');

    expect(written.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
    expect(parseInstinct(written).instinct).toEqual(instinct);
  });
});

describe('the conversion to the Learning port', () => {
  const instinct = parseInstinct(recordText()).instinct!;
  const record = toLearningRecord(instinct);

  test('carries the merge fields and marks the record active', () => {
    expect(record).toEqual({
      id: 'bun-install-after-worktree-fork',
      trigger: 'when running tests in a freshly forked worktree',
      action: ACTION,
      action_hash: instinct.actionHash,
      confidence: 0.6,
      usage_count: 3,
      artifact: 'Cannot find package',
      signal: 'loud',
      status: 'active',
      created_at: '2026-09-11T10:00:00Z',
      updated_at: '2026-09-11T10:00:00Z',
    });
  });

  test('leaves the fields that stay in the file behind', () => {
    for (const key of ['kind', 'domain', 'scope', 'project_id', 'source', 'evidence', 'cause']) {
      expect(Object.hasOwn(record, key)).toBe(false);
    }
  });

  test('omits artifact rather than sending an empty one', () => {
    const blank = toLearningRecord(parseInstinct(recordText({ artifact: '' })).instinct!);

    expect(Object.hasOwn(blank, 'artifact')).toBe(false);
  });
});
