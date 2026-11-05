/**
 * Tests for the skill-use collector.
 *
 * The two fixtures under `testdata/skill-use/` are real Claude Code
 * sessions, stripped to their tool-call records. The 2.1.280 one holds two
 * main-thread `Skill` calls, one `Agent` call, and one `Skill` call in the
 * subagent's own log. The 2.1.318 one holds one `Agent` call in its main
 * log and one `Skill` call in its subagent's, with the subagent's
 * `agent-*.meta.json` beside that log. Every other case runs the fold over
 * in-memory lines, each beside the variant the collector counts, so a
 * collector that answered `unknown` for everything reddens.
 */
import type { SkillUseSource } from './skill-use.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNKNOWN_SKILL_COUNT } from '@open-tomato/rafa/store/skill-invocations';
import { afterAll, describe, expect, it } from 'bun:test';

import {
  collectSkillUse,
  compareCliVersions,
  readSkillUse,
  SKILL_USE_CLI_FLOOR,
  SKILL_USE_FIXTURE_VERSION,
  subagentLogPaths,
} from './skill-use.js';

/** The recorded session's id, its main log's basename. */
const FIXTURE_ID = 'ac7aeff1-84f2-46c9-bb9c-b9ceb994599f';

/** The recorded session's main log. */
const FIXTURE_LOG = fileURLToPath(new URL(`./testdata/skill-use/${FIXTURE_ID}.jsonl`, import.meta.url));

/** The recorded subagent's log. */
const FIXTURE_AGENT_LOG = fileURLToPath(new URL(
  `./testdata/skill-use/${FIXTURE_ID}/subagents/agent-a7651caa35e8b5c69.jsonl`,
  import.meta.url,
));

/** The 2.1.318 session's id, its main log's basename and its folder's name. */
const RECORDED_318_ID = '28eea32a-3a3f-4b3e-99a8-20e057775d5e';

/** The 2.1.318 session's subagents folder. */
const RECORDED_318_SUBAGENTS = fileURLToPath(new URL(`./testdata/skill-use/${RECORDED_318_ID}/subagents/`, import.meta.url));

/** The 2.1.318 session's main log. */
const RECORDED_318_LOG = fileURLToPath(new URL(`./testdata/skill-use/${RECORDED_318_ID}.jsonl`, import.meta.url));

/** The 2.1.318 subagent's log. */
const RECORDED_318_AGENT_LOG = join(RECORDED_318_SUBAGENTS, 'agent-ae979d95edbcd4293.jsonl');

/** The metadata file 2.1.318 writes beside the subagent's log. */
const RECORDED_318_AGENT_META = join(RECORDED_318_SUBAGENTS, 'agent-ae979d95edbcd4293.meta.json');

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

/** An assistant record at the fixture's version carrying one `tool_use` block per input. */
function calls(
  blocks: readonly { name: string; input: unknown }[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'assistant',
    version: SKILL_USE_FIXTURE_VERSION,
    isSidechain: false,
    message: {
      role: 'assistant',
      content: blocks.map((block, index) => ({ type: 'tool_use', id: `toolu_${index}`, ...block })),
    },
    ...extra,
  };
}

/** An assistant record at the fixture's version calling `Skill` once with `input`. */
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

    expect(reading).toEqual({ sessionId: FIXTURE_ID, uses: FIXTURE_USES, vouched: true, versions: ['2.1.280'] });
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

    expect([...versions]).toEqual([SKILL_USE_FIXTURE_VERSION]);
  });

  it('reads unknown under a floor above its version, never 0', async () => {
    const reading = await readSkillUse(FIXTURE_LOG, '2.1.281');

    expect(reading).toEqual({ sessionId: FIXTURE_ID, uses: UNKNOWN_SKILL_COUNT, vouched: false, versions: ['2.1.280'] });
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

describe('the recorded 2.1.318 fixture', () => {
  it('counts the subagent\'s one call as a sidechain call, unvouched', async () => {
    const reading = await readSkillUse(RECORDED_318_LOG);

    expect(reading).toEqual({
      sessionId: RECORDED_318_ID,
      uses: [{ name: 'fixture-gamma', sidechain: true, count: 1 }],
      vouched: false,
      versions: ['2.1.318'],
    });
  });

  it('reads no call from the main log alone', async () => {
    const reading = await collectSkillUse(RECORDED_318_ID, [
      { lines: linesOf(readFileSync(RECORDED_318_LOG, 'utf8').split('\n')), subagent: false },
    ]);

    expect(reading.uses).toEqual([]);
  });

  it('lists the subagent\'s log and not the agent-*.meta.json beside it', () => {
    expect(existsSync(RECORDED_318_AGENT_META)).toBe(true);
    expect(subagentLogPaths(RECORDED_318_LOG)).toEqual([RECORDED_318_AGENT_LOG]);
  });

  it('holds tool calls only, under one session id, with the Agent call\'s prompt replaced', () => {
    const records = [...recordsOf(RECORDED_318_LOG), ...recordsOf(RECORDED_318_AGENT_LOG)];
    const blocks = records.flatMap((record) => (record['message'] as { content: Record<string, unknown>[] }).content);
    const meta = JSON.parse(readFileSync(RECORDED_318_AGENT_META, 'utf8')) as Record<string, unknown>;

    expect(records.map((record) => [record['isSidechain'], record['sessionId'], record['version']])).toEqual([
      [false, RECORDED_318_ID, '2.1.318'],
      [true, RECORDED_318_ID, '2.1.318'],
    ]);
    expect(blocks.map((block) => [block['type'], block['name']])).toEqual([['tool_use', 'Agent'], ['tool_use', 'Skill']]);
    expect(blocks[0]?.['input']).toEqual({
      description: '<replaced>',
      subagent_type: 'general-purpose',
      prompt: '<replaced>',
      run_in_background: false,
    });
    expect(meta['toolUseId']).toBe(blocks[0]?.['id']);
    expect(meta['description']).toBe('<replaced>');
  });
});

describe('collectSkillUse', () => {
  it('sums one skill\'s calls on one side', async () => {
    const reading = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' }), skillCall({ skill: 'tdd', args: 'held back' })]),
    ]);

    expect(reading).toEqual({
      sessionId: 's',
      uses: [{ name: 'tdd', sidechain: false, count: 2 }],
      vouched: true,
      versions: ['2.1.280'],
    });
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

  it('answers no uses for a vouched session that invoked no skill', async () => {
    const reading = await collectSkillUse('s', [source([calls([{ name: 'Read', input: { file_path: 'x' } }])])]);

    expect(reading).toEqual({ sessionId: 's', uses: [], vouched: true, versions: ['2.1.280'] });
  });

  it('reads past records carrying no version', async () => {
    const reading = await collectSkillUse('s', [
      source([{ type: 'queue-operation' }, skillCall({ skill: 'tdd' }), { type: 'last-prompt' }]),
    ]);

    expect(reading.uses).toEqual([{ name: 'tdd', sidechain: false, count: 1 }]);
  });

  it('reads unknown when a subagent log is below the floor', async () => {
    const vouched = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' })]),
      source([skillCall({ skill: 'tdd' })], true),
    ]);
    const mixed = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' })]),
      source([skillCall({ skill: 'tdd' }, { version: '2.1.247' })], true),
    ]);

    expect(vouched.uses).toHaveLength(2);
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

describe('the floor', () => {
  /** What a session of one log, every record at `version`, answers. */
  async function readingAt(version: unknown): Promise<Awaited<ReturnType<typeof collectSkillUse>>> {
    return collectSkillUse('s', [source([skillCall({ skill: 'tdd' }, { version })])]);
  }

  const TDD = [{ name: 'tdd', sidechain: false, count: 1 }];

  it('sits at the fixture\'s version', () => {
    expect(SKILL_USE_CLI_FLOOR).toBe('2.1.280');
    expect(SKILL_USE_FIXTURE_VERSION).toBe('2.1.280');
  });

  it('reads a session above the floor by name, unvouched', async () => {
    expect(await readingAt('2.1.316')).toEqual({ sessionId: 's', uses: TDD, vouched: false, versions: ['2.1.316'] });
  });

  it('reads a session at the fixture\'s version by name, vouched', async () => {
    expect(await readingAt('2.1.280')).toEqual({ sessionId: 's', uses: TDD, vouched: true, versions: ['2.1.280'] });
  });

  it('reads a session below the floor as unknown', async () => {
    expect(await readingAt('2.1.279')).toEqual({
      sessionId: 's',
      uses: UNKNOWN_SKILL_COUNT,
      vouched: false,
      versions: ['2.1.279'],
    });
    expect((await readingAt('2.1.263')).uses).toBe(UNKNOWN_SKILL_COUNT);
  });

  it('reads a main log at the fixture\'s version and a subagent log above it by name, unvouched', async () => {
    const reading = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' }, { version: '2.1.316' })]),
      source([skillCall({ skill: 'tdd' })], true),
    ]);

    expect(reading).toEqual({
      sessionId: 's',
      uses: [{ name: 'tdd', sidechain: false, count: 1 }, { name: 'tdd', sidechain: true, count: 1 }],
      vouched: false,
      versions: ['2.1.280', '2.1.316'],
    });
  });

  it('reads unknown when one log is below the floor and another above it', async () => {
    const reading = await collectSkillUse('s', [
      source([skillCall({ skill: 'tdd' }, { version: '2.1.316' })]),
      source([skillCall({ skill: 'tdd' }, { version: '2.1.279' })], true),
    ]);

    expect(reading).toEqual({
      sessionId: 's',
      uses: UNKNOWN_SKILL_COUNT,
      vouched: false,
      versions: ['2.1.279', '2.1.316'],
    });
  });

  it('reads unknown under a version that is not X.Y.Z', async () => {
    for (const version of ['2.1', '2.1.316-beta', 2]) {
      const reading = await readingAt(version);

      expect(reading.uses).toBe(UNKNOWN_SKILL_COUNT);
      expect(reading.versions).toEqual([String(version)]);
    }
  });

  it('refuses a floor that is not X.Y.Z', async () => {
    await expect(collectSkillUse('s', [], '2.1')).rejects.toThrow('skill-use floor "2.1" is not an X.Y.Z version');
  });
});

describe('compareCliVersions', () => {
  it('compares each field as a whole number', () => {
    expect(compareCliVersions('2.1.9', '2.1.10')).toBeLessThan(0);
    expect(compareCliVersions('2.1.10', '2.1.9')).toBeGreaterThan(0);
  });

  it('reads the earlier fields first', () => {
    expect(compareCliVersions('2.2.0', '2.1.316')).toBeGreaterThan(0);
    expect(compareCliVersions('3.0.0', '2.1.316')).toBeGreaterThan(0);
    expect(compareCliVersions('2.1.316', '3.0.0')).toBeLessThan(0);
  });

  it('answers 0 for the same version', () => {
    expect(compareCliVersions('2.1.280', '2.1.280')).toBe(0);
  });

  it('sorts a version of another shape below every X.Y.Z version', () => {
    expect(compareCliVersions('2.1.316-beta', '0.0.0')).toBeLessThan(0);
    expect(compareCliVersions('0.0.0', '2.1')).toBeGreaterThan(0);
    expect(['2.1.316', '2.1', '2.1.9', '2.1.10'].sort(compareCliVersions)).toEqual(['2.1', '2.1.9', '2.1.10', '2.1.316']);
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
