/**
 * The skill-use collector: which skills a session invoked, in its main
 * thread and in its sidechains, read off its Claude Code logs.
 *
 * ## The one exception to "no tool input"
 *
 * `session-log.ts` folds a log into counters and identifiers and lets no
 * message content reach its row. This module is the one exception: it
 * reads the input of a `Skill` tool call. It keeps the tool's name, to
 * pick the call out, and the `skill` member of its input, mapped to the
 * bare name with `bareSkillName`, and nothing else. The call's `args`,
 * every other tool's input, every prompt and every tool output are read
 * past and never kept, so the counts it answers can be stored beside the
 * session rows without the store becoming a copy of a transcript.
 *
 * ## Where the calls are
 *
 * A session's main thread is its loose log, `<dir>/<session>.jsonl`. Each
 * subagent it started has its own log at
 * `<dir>/<session>/subagents/agent-*.jsonl`, the population
 * `session-log-dirs.ts` describes and `collect.ts` deliberately leaves out
 * of its session rows.
 * {@link subagentLogPaths} lists them with one directory read, and lists
 * no other file of the folder, such as the `agent-*.meta.json` Claude Code
 * 2.1.318 writes beside each log. A call is a
 * sidechain call when its log is one of those or its record carries
 * `isSidechain: true`. Measured on 2026-09-26 over the 3,710 logs under
 * `~/.claude/projects`: 68,009 records in `agent-*.jsonl` files, every one
 * `isSidechain: true`, and none in a loose log. The record flag is honoured
 * anyway, so a sidechain turn written into the main log would not be
 * counted as the main thread's.
 *
 * A call is a `tool_use` block named `Skill` in the `message.content` of
 * an `assistant` record. Measured over the same tree, all 459 such blocks
 * carry a `skill` input and 82 an `args` one. From Claude Code 2.1.266 the
 * record ALSO carries each block's input under a top-level
 * `wireToolInputs`, keyed by the block's id: 31 of the 38 blocks written
 * by 2.1.280 have one, none written before 2.1.266 does. Every figure here
 * is a snapshot of a growing tree, the fixture's own session included.
 * This module reads `message.content` only, so a record carrying both is
 * one call, not two.
 *
 * ## The floor and the fixture
 *
 * {@link SKILL_USE_FIXTURE_VERSION} is the Claude Code version whose log
 * format this module was written and tested against, the `version` of
 * every record of session `ac7aeff1-84f2-46c9-bb9c-b9ceb994599f` in
 * `testdata/skill-use/`. That fixture was recorded from a real `claude -p`
 * session under 2.1.280 that invoked two project skills in its main thread
 * and one in a subagent, stripped to the records carrying a tool call,
 * with the `Agent` call's prompt and description replaced. The second
 * session there, `28eea32a-3a3f-4b3e-99a8-20e057775d5e`, was recorded the
 * same way under 2.1.318: its main thread started one subagent, which
 * invoked one project skill. Its paths are dropped, and its session and
 * agent ids replaced the same way in both logs. It holds the sidechain
 * half above the fixture's version, which is not vouched for.
 *
 * {@link SKILL_USE_CLI_FLOOR} is the oldest version whose `Skill` call
 * shape the reader is known to read. It is the fixture's version, since no
 * older log has been read. Measured on 2026-11-02 over the 769 loose loop
 * logs of this project on the measuring machine, of 2.1.296, 2.1.299,
 * 2.1.300, 2.1.301, 2.1.302, 2.1.304 and 2.1.316: all 49 `Skill` blocks
 * are `tool_use` blocks in the `message.content` of an `assistant`
 * record with a non-blank string `skill` input, the fixture's shape, so a
 * version above the floor is read the fixture's way. There is no ceiling;
 * lowering the floor means reading a log of the older version first.
 *
 * A version is compared as `X.Y.Z`, three whole numbers, field by field
 * ({@link compareCliVersions}); a `version` of any other shape, such as
 * `2.1`, `2.1.316-beta` or the number 2, counts as below the floor. A
 * session is read by skill name when every record of it that carries a
 * `version`, in its main log and in each subagent log, is at or above the
 * floor. The reading is vouched for only when every one of them carries
 * the fixture's version: a reading above it answers `vouched` false with
 * the versions seen, and the skill half (`collect-skills.ts`) counts it
 * apart from a vouched one.
 *
 * Otherwise the reading is `unknown`, which the `skill_invocations` table
 * stores as an unknown count and never as 0: when any versioned record is
 * below the floor, when no record carries a `version`, when a line is not
 * a JSON object (a half-written last line could hold a call; none of the
 * 3,710 logs held one), and when a `Skill` call's `skill` input is not a
 * non-blank string. Records without a `version`, such as `queue-operation`
 * and `last-prompt`, are read past.
 *
 * The sidechain half of a loop session of those versions counts nothing
 * because none of them started a subagent, not because the logs moved.
 * The same measurement found no `<session>/subagents/` folder beside any
 * of the 769 logs, no record flagged `isSidechain: true` and no
 * `tool_use` block named `Agent`; `Agent` appears only in the tool lists
 * a request offers.
 * Recorded on 2026-11-04 under 2.1.318, a subagent's log is where the
 * fixture's was, `<session>/subagents/agent-<id>.jsonl`, with an
 * `agent-<id>.meta.json` beside it. Every record of that log carries
 * `isSidechain: true` except the `api-request-shape`, `api-request-blob`
 * and `api-request` records, which carry no `isSidechain` and no
 * `tool_use` block; of those, `api-request-blob` carries no `version`. The
 * reader counts the subagent's `Skill` call as a sidechain call, and the
 * reading answers `vouched` false with the versions `['2.1.318']`.
 *
 * ## The reading
 *
 * {@link readSkillUse} answers a {@link SkillUseOutcome}: the
 * `SkillUseReading` that `writeSkillInvocations`
 * (`store/skill-invocations.ts`) takes, one use per skill and side with
 * its count, sorted by name with the main thread first, `[]` for a session
 * that invoked none, plus whether the reading is vouched for and the
 * versions it read. Logs are read line by line
 * through `readLines`, so memory is bounded by the number of distinct
 * skills, never by the length of a log. {@link collectSkillUse} is the
 * same fold over line sources a caller supplies, so a test drives it
 * without touching disk.
 */
import type { SkillUse, SkillUseReading } from '@open-tomato/rafa/store/skill-invocations';

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readLines, sessionIdFromPath } from '@open-tomato/rafa/effort/session-log';
import { UNKNOWN_SKILL_COUNT } from '@open-tomato/rafa/store/skill-invocations';
import { bareSkillName } from '@open-tomato/rafa-inventory';

/** The oldest Claude Code version whose logs are read by skill name. */
export const SKILL_USE_CLI_FLOOR = '2.1.280';

/** The `version` of every record of the 2.1.280 session in `testdata/skill-use/`, the one version vouched for. */
export const SKILL_USE_FIXTURE_VERSION = '2.1.280';

/** A Claude Code version as the reader compares it: three whole numbers. */
const CLI_VERSION_SHAPE = /^(\d+)\.(\d+)\.(\d+)$/u;

/** The tool whose calls are counted. */
const SKILL_TOOL = 'Skill';

/** A subagent log's file name under `<session>/subagents/`. */
const SUBAGENT_LOG_NAME = /^agent-.+\.jsonl$/;

/** One log of a session, as lines, and whether it is a subagent's. */
export interface SkillUseSource {
  /** The log's lines, consumed once. */
  readonly lines: AsyncIterable<string>;
  /** True for a `subagents/agent-*.jsonl` log, whose every call is a sidechain call. */
  readonly subagent: boolean;
}

/** A session's reading, with what the fold knows of the versions behind it. */
export interface SkillUseOutcome extends SkillUseReading {
  /** True when every versioned record carries {@link SKILL_USE_FIXTURE_VERSION}; false for an `unknown` reading. */
  readonly vouched: boolean;
  /** The distinct `version` values read, as text, in ascending order. */
  readonly versions: readonly string[];
}

type JsonObject = Record<string, unknown>;

/**
 * What the fold has seen so far. Mutated in place by the fold and never
 * returned, so no reading shares it.
 */
interface Tally {
  /** Calls per `JSON.stringify([bareName, sidechain])`. */
  readonly counts: Map<string, number>;
  /** Records carrying a `version` below the floor, or of a shape other than `X.Y.Z`. */
  belowFloor: number;
  /** Records carrying a `version` at or above the floor. */
  atOrAbove: number;
  /** The distinct `version` values read, as text. */
  readonly versions: Set<string>;
  /** Lines that were not a JSON object, and `Skill` calls with no usable `skill`. */
  unreadable: number;
}

/** Narrows to a plain JSON object; arrays and scalars answer null. */
function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** One line to a JSON object, or null when it is not one. */
function parseRecord(line: string): JsonObject | null {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return null;
  }
}

/**
 * The subagent logs of the session whose main log is `sessionLogPath`,
 * sorted by name: `<dir>/<session>/subagents/agent-*.jsonl`. None when the
 * session started no subagent, so the directory does not exist.
 */
export function subagentLogPaths(sessionLogPath: string): string[] {
  const dir = join(dirname(sessionLogPath), sessionIdFromPath(sessionLogPath), 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SUBAGENT_LOG_NAME.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

/** The three numbers of an `X.Y.Z` version, or null for any other value. */
function versionFields(version: unknown): readonly number[] | null {
  if (typeof version !== 'string') return null;
  const match = CLI_VERSION_SHAPE.exec(version);
  return match === null
    ? null
    : match.slice(1).map(Number);
}

/**
 * Orders two versions: negative when `a` is below `b`, 0 when equal,
 * positive when above. Each `X.Y.Z` is compared as three whole numbers,
 * field by field, so 2.1.9 is below 2.1.10. Text of any other shape sorts
 * below every `X.Y.Z` version, and among itself by text.
 */
export function compareCliVersions(a: string, b: string): number {
  const left = versionFields(a);
  const right = versionFields(b);
  if (left === null || right === null) {
    if (left !== right) {
      return left === null
        ? -1
        : 1;
    }
    return a.localeCompare(b);
  }
  const differing = left.findIndex((field, index) => field !== right[index]);
  return differing === -1
    ? 0
    : (left[differing] ?? 0) - (right[differing] ?? 0);
}

/**
 * Records the record's `version`, if it carries one, against `floor`, an
 * `X.Y.Z` version: a version of another shape sorts below it.
 */
function applyVersion(tally: Tally, record: JsonObject, floor: string): void {
  const version = record['version'];
  if (version === undefined) return;
  const text = String(version);
  tally.versions.add(text);
  if (typeof version === 'string' && compareCliVersions(version, floor) >= 0) {
    tally.atOrAbove += 1;
  } else {
    tally.belowFloor += 1;
  }
}

/** Counts each `Skill` block in an assistant record's `message.content`. */
function applyCalls(tally: Tally, record: JsonObject, sidechain: boolean): void {
  if (record['type'] !== 'assistant') return;
  const content = asObject(record['message'])?.['content'];
  if (!Array.isArray(content)) return;

  for (const item of content) {
    const block = asObject(item);
    if (block?.['type'] !== 'tool_use' || block['name'] !== SKILL_TOOL) continue;
    const skill = asObject(block['input'])?.['skill'];
    if (typeof skill !== 'string' || skill.trim().length === 0) {
      tally.unreadable += 1;
      continue;
    }
    const key = JSON.stringify([bareSkillName(skill), sidechain]);
    tally.counts.set(key, (tally.counts.get(key) ?? 0) + 1);
  }
}

/** Folds one log's lines into the tally. */
async function applySource(tally: Tally, source: SkillUseSource, floor: string): Promise<void> {
  for await (const rawLine of source.lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const record = parseRecord(line);
    if (record === null) {
      tally.unreadable += 1;
      continue;
    }
    applyVersion(tally, record, floor);
    applyCalls(tally, record, source.subagent || record['isSidechain'] === true);
  }
}

/** The tally's counts as uses, sorted by name, the main thread first. */
function usesOf(counts: ReadonlyMap<string, number>): SkillUse[] {
  const uses = [...counts].map(([key, count]) => {
    const [name, sidechain] = JSON.parse(key) as [string, boolean];
    return { name, sidechain, count };
  });
  return uses.sort((a, b) => a.name.localeCompare(b.name) || Number(a.sidechain) - Number(b.sidechain));
}

/**
 * Folds a session's logs into one outcome: its uses, read by name when
 * every versioned record is at or above `floor`, or `unknown` when one is
 * below it, none carries a version, or a line or call cannot be read. The
 * reading is vouched for only when every versioned record carries
 * {@link SKILL_USE_FIXTURE_VERSION}. See the module note.
 *
 * Each source is consumed once, in order, and never collected into an
 * array.
 */
export async function collectSkillUse(
  sessionId: string,
  sources: readonly SkillUseSource[],
  floor: string = SKILL_USE_CLI_FLOOR,
): Promise<SkillUseOutcome> {
  if (versionFields(floor) === null) throw new TypeError(`skill-use floor ${JSON.stringify(floor)} is not an X.Y.Z version`);

  const tally: Tally = { counts: new Map(), belowFloor: 0, atOrAbove: 0, versions: new Set(), unreadable: 0 };
  for (const source of sources) await applySource(tally, source, floor);

  const versions = [...tally.versions].sort(compareCliVersions);
  if (tally.belowFloor > 0 || tally.atOrAbove === 0 || tally.unreadable > 0) {
    return { sessionId, uses: UNKNOWN_SKILL_COUNT, vouched: false, versions };
  }
  const vouched = versions.length === 1 && versions[0] === SKILL_USE_FIXTURE_VERSION;
  return { sessionId, uses: usesOf(tally.counts), vouched, versions };
}

/**
 * Reads the skill use of the session whose main log is `sessionLogPath`,
 * over that log and every log {@link subagentLogPaths} lists for it. The
 * session id is the main log's basename, as on the session row.
 *
 * Throws when the main log cannot be read, or when `floor` is not an
 * `X.Y.Z` version.
 */
export async function readSkillUse(
  sessionLogPath: string,
  floor: string = SKILL_USE_CLI_FLOOR,
): Promise<SkillUseOutcome> {
  const sources: SkillUseSource[] = [
    { lines: readLines(sessionLogPath), subagent: false },
    ...subagentLogPaths(sessionLogPath).map((path) => ({ lines: readLines(path), subagent: true })),
  ];
  return collectSkillUse(sessionIdFromPath(sessionLogPath), sources, floor);
}
