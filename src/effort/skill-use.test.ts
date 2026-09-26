/**
 * Tests for the skill-use collector.
 *
 * The fixture under `testdata/skill-use/` is a real Claude Code session,
 * stripped to its tool-call records: two main-thread `Skill` calls, one
 * `Agent` call, and one `Skill` call in the subagent's own log. Every other
 * case runs the fold over in-memory lines, each beside the variant the
 * collector counts, so a collector that answered `unknown` for everything
 * reddens.
 */
import type { SkillUseSource } from './skill-use.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  collectSkillUse,
  readSkillUse,
  SKILL_USE_CLI_VERSION,
  subagentLogPaths,
} from './skill-use.js';
import { UNKNOWN_SKILL_COUNT } from './store/skill-invocations.js';

/** The recorded session's id, its main log's basename. */
const FIXTURE_ID = 'ac7aeff1-84f2-46c9-bb9c-b9ceb994599f';

/** The recorded session's main log. */
const FIXTURE_LOG = fileURLToPath(new URL(`./testdata/skill-use/${FIXTURE_ID}.jsonl`, import.meta.url));

/** The recorded subagent's log. */
const FIXTURE_AGENT_LOG = fileURLToPath(new URL(
  `./testdata/skill-use/${FIXTURE_ID}/subagents/agent-a7651caa35e8b5c69.jsonl`,
  import.meta.url,
));

/** What the recorded session invoked, spelled from the probe's prompt. */
const FIXTURE_USES = [
  { name: 'fixture-alpha', sidechain: false, count: 1 },
  { name: 'fixture-alpha', sidechain: true, count: 1 },
  { name: 'fixture-beta', sidechain: false, count: 1 },
];

const scratchRoots: string[] = [];

afterAll(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

/** A fresh temporary directory, removed after the suite. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'rafa-skill-use-'));
  scratchRoots.push(root);
  return root;
}

/** Yields each item as a line: a string as written, anything else as JSON. */
async function* linesOf(items: readonly unknown[]): AsyncGenerator<string> {
  for (const item of items) {
    yield typeof item === 'string'
      ? item
      : JSON.stringify(item);
  }
}

/** A source over `items`. */
function source(items: readonly unknown[], subagent = false): SkillUseSource {
  return { lines: linesOf(items), subagent };
}

/** An assistant record at the pin carrying one `tool_use` block per input. */
function calls(
  blocks: readonly { name: string; input: unknown }[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'assistant',
    version: SKILL_USE_CLI_VERSION,
    isSidechain: false,
    message: {
      role: 'assistant',
      content: blocks.map((block, index) => ({ type: 'tool_use', id: `toolu_${index}`, ...block })),
    },
    ...extra,
  };
}

/** An assistant record at the pin calling `Skill` once with `input`. */
function skillCall(input: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return calls([{ name: 'Skill', input }], extra);
}

/** The records of a log on disk. */
function recordsOf(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('the recorded fixture', () => {
  it('counts the main-thread and the sidechain calls apart', async () => {
    const reading = await readSkillUse(FIXTURE_LOG);

    expect(reading).toEqual({ sessionId: FIXTURE_ID, uses: FIXTURE_USES });
  });

  it('reads no sidechain call from the main log alone', async () => {
    const reading = await collectSkillUse(FIXTURE_ID, [
      { lines: linesOf(readFileSync(FIXTURE_LOG, 'utf8').split('\n')), subagent: false },
    ]);

    expect(reading.uses).toEqual([
      { name: 'fixture-alpha', sidechain: false, count: 1 },
      { name: 'fixture-beta', sidechain: false, count: 1 },
    ]);
  });

  it('finds the one subagent log beside the main log', () => {
    expect(subagentLogPaths(FIXTURE_LOG)).toEqual([FIXTURE_AGENT_LOG]);
  });

  it('carries the pinned version on every record', () => {
    const versions = new Set([...recordsOf(FIXTURE_LOG), ...recordsOf(FIXTURE_AGENT_LOG)].map((record) => record['version']));

    expect([...versions]).toEqual([SKILL_USE_CLI_VERSION]);
  });

  it('reads unknown under any other version, never 0', async () => {
    const reading = await readSkillUse(FIXTURE_LOG, '2.1.281');

    expect(reading).toEqual({ sessionId: FIXTURE_ID, uses: UNKNOWN_SKILL_COUNT });
  });

  it('holds tool calls only, with every prompt replaced', () => {
    const records = [...recordsOf(FIXTURE_LOG), ...recordsOf(FIXTURE_AGENT_LOG)];
    const blocks = records.flatMap((record) => (record['message'] as { content: Record<string, unknown>[] }).content);
    const agentInputs = blocks.filter((block) => block['name'] === 'Agent').map((block) => block['input']);

    expect(records.map((record) => record['type'])).toEqual(['assistant', 'assistant', 'assistant', 'assistant']);
    expect(blocks.map((block) => block['type'])).toEqual(['tool_use', 'tool_use', 'tool_use', 'tool_use']);
    expect(agentInputs).toEqual([
      { subagent_type: 'general-purpose', description: '<replaced>', prompt: '<replaced>' },
    ]);
  });
});

describe('collectSkillUse', () => {
  it('sums one skill\'s calls on one side', async () => {
    const reading = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' }), skillCall({ skill: 'tdd', args: 'held back' })]),
    ]);

    expect(reading).toEqual({ sessionId: 's', uses: [{ name: 'tdd', sidechain: false, count: 2 }] });
  });

  it('keeps the name, the side and the count, and nothing of the call\'s args', async () => {
    const reading = await collectSkillUse('s', [source([skillCall({ skill: 'tdd', args: 'held back' })])]);

    expect(JSON.stringify(reading)).not.toContain('held back');
  });

  it('counts a record flagged isSidechain in the main log as a sidechain call', async () => {
    const reading = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' }, { isSidechain: true }), skillCall({ skill: 'tdd' })]),
    ]);

    expect(reading.uses).toEqual([
      { name: 'tdd', sidechain: false, count: 1 },
      { name: 'tdd', sidechain: true, count: 1 },
    ]);
  });

  it('counts every call in a subagent source as a sidechain call', async () => {
    const reading = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' })], true)]);

    expect(reading.uses).toEqual([{ name: 'tdd', sidechain: true, count: 1 }]);
  });

  it('counts each Skill block of a record, and no other tool', async () => {
    const reading = await collectSkillUse('s', [source([
      calls([
        { name: 'Skill', input: { skill: 'tdd' } },
        { name: 'Agent', input: { skill: 'not-a-skill-call' } },
        { name: 'Skill', input: { skill: 'git-workflow' } },
      ]),
    ])]);

    expect(reading.uses).toEqual([
      { name: 'git-workflow', sidechain: false, count: 1 },
      { name: 'tdd', sidechain: false, count: 1 },
    ]);
  });

  it('reads message.content only, never the wireToolInputs copy', async () => {
    const reading = await collectSkillUse('s', [source([
      skillCall({ skill: 'tdd' }, { wireToolInputs: { toolu_0: { skill: 'tdd' } } }),
      calls([], { wireToolInputs: { toolu_9: { skill: 'orphan' } } }),
    ])]);

    expect(reading.uses).toEqual([{ name: 'tdd', sidechain: false, count: 1 }]);
  });

  it('keeps another plugin\'s prefix on a name', async () => {
    const reading = await collectSkillUse('s', [source([skillCall({ skill: 'superpowers:brainstorming' })])]);

    expect(reading.uses).toEqual([{ name: 'superpowers:brainstorming', sidechain: false, count: 1 }]);
  });

  it('answers no uses for a pinned session that invoked no skill', async () => {
    const reading = await collectSkillUse('s', [source([calls([{ name: 'Read', input: { file_path: 'x' } }])])]);

    expect(reading).toEqual({ sessionId: 's', uses: [] });
  });

  it('reads past records carrying no version', async () => {
    const reading = await collectSkillUse('s', [
      source([{ type: 'queue-operation' }, skillCall({ skill: 'tdd' }), { type: 'last-prompt' }]),
    ]);

    expect(reading.uses).toEqual([{ name: 'tdd', sidechain: false, count: 1 }]);
  });

  it('reads unknown when a subagent log is of another version', async () => {
    const pinned = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' })]),
      source([skillCall({ skill: 'tdd' })], true),
    ]);
    const mixed = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' })]),
      source([skillCall({ skill: 'tdd' }, { version: '2.1.247' })], true),
    ]);

    expect(pinned.uses).toHaveLength(2);
    expect(mixed.uses).toBe(UNKNOWN_SKILL_COUNT);
  });

  it('reads unknown when no record carries a version', async () => {
    const unversioned = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' }, { version: undefined })])]);
    const empty = await collectSkillUse('s', []);

    expect(unversioned.uses).toBe(UNKNOWN_SKILL_COUNT);
    expect(empty.uses).toBe(UNKNOWN_SKILL_COUNT);
  });

  it('reads unknown when a line is not a JSON object', async () => {
    const whole = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' }), ''])]);
    const torn = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' }), '{"type":"assist'])]);
    const array = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' }), '[1]'])]);

    expect(whole.uses).toEqual([{ name: 'tdd', sidechain: false, count: 1 }]);
    expect(torn.uses).toBe(UNKNOWN_SKILL_COUNT);
    expect(array.uses).toBe(UNKNOWN_SKILL_COUNT);
  });

  it('reads unknown when a Skill call names no skill', async () => {
    for (const input of [{}, { skill: '' }, { skill: '  ' }, { skill: 7 }, null]) {
      const reading = await collectSkillUse('s', [source([skillCall({ skill: 'tdd' }), skillCall(input)])]);

      expect(reading.uses).toBe(UNKNOWN_SKILL_COUNT);
    }
  });
});

describe('subagentLogPaths', () => {
  it('lists agent logs only, sorted by name', () => {
    const dir = scratch();
    const subagents = join(dir, 'session', 'subagents');
    mkdirSync(subagents, { recursive: true });
    for (const name of ['agent-b.jsonl', 'agent-a.jsonl', 'agent-a.meta.json', 'notes.jsonl']) {
      writeFileSync(join(subagents, name), '');
    }
    mkdirSync(join(subagents, 'agent-dir.jsonl'));

    expect(subagentLogPaths(join(dir, 'session.jsonl'))).toEqual([
      join(subagents, 'agent-a.jsonl'),
      join(subagents, 'agent-b.jsonl'),
    ]);
  });

  it('lists none for a session that started no subagent', () => {
    expect(subagentLogPaths(join(scratch(), 'session.jsonl'))).toEqual([]);
  });
});

describe('readSkillUse', () => {
  it('throws when the main log does not exist', async () => {
    await expect(readSkillUse(join(scratch(), 'missing.jsonl'))).rejects.toThrow('ENOENT');
  });
});
