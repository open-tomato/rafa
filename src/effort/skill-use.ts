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
 * `<dir>/<session>/subagents/agent-*.jsonl`, the population `collect.ts`
 * describes and deliberately leaves out of its session rows.
 * {@link subagentLogPaths} lists them with one directory read. A call is a
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
 * ## The version it vouches for
 *
 * {@link SKILL_USE_CLI_VERSION} is the Claude Code version whose log format
 * this module was written and tested against, the `version` of every
 * record in `testdata/skill-use/`. That fixture was recorded from a real
 * `claude -p` session under 2.1.280 that invoked two project skills in its
 * main thread and one in a subagent, stripped to the records carrying a
 * tool call, with the `Agent` call's prompt and description replaced.
 *
 * The `wireToolInputs` reading shows the format moves between versions,
 * so a reading is only vouched for when every record of the session that
 * carries a `version`, in its main log and in each subagent log, carries
 * this one. Otherwise the reading is `unknown`, which the
 * `skill_invocations` table stores as an unknown count and never as 0.
 * The same holds for a session with no versioned record at all, one with
 * a line that is not a JSON object (a half-written last line could hold a
 * call; none of the 3,710 logs held one), and one with a `Skill` call
 * whose `skill` input is not a non-blank string. Records without a
 * `version`, such as `queue-operation` and `last-prompt`, are read past.
 *
 * The pin names the one version the collector is known to hold for, as
 * `SERVE_CLI_VERSION` does in `tiers/delivery.ts`. It is not a floor: a new
 * version means recording the fixture again before moving it.
 *
 * ## The reading
 *
 * {@link readSkillUse} answers the `SkillUseReading` that
 * `writeSkillInvocations` (`store/skill-invocations.ts`) takes: one use per
 * skill and side with its count, sorted by name with the main thread
 * first, `[]` for a session that invoked none. Logs are read line by line
 * through `readLines`, so memory is bounded by the number of distinct
 * skills, never by the length of a log. {@link collectSkillUse} is the
 * same fold over line sources a caller supplies, so a test drives it
 * without touching disk.
 */
import type { SkillUse, SkillUseReading } from './store/skill-invocations.js';

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { bareSkillName } from '../tiers/skill-names.js';

import { readLines, sessionIdFromPath } from './session-log.js';
import { UNKNOWN_SKILL_COUNT } from './store/skill-invocations.js';

/** The Claude Code version whose log format this collector was written against. */
export const SKILL_USE_CLI_VERSION = '2.1.280';

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

type JsonObject = Record<string, unknown>;

/**
 * What the fold has seen so far. Mutated in place by the fold and never
 * returned, so no reading shares it.
 */
interface Tally {
  /** Calls per `JSON.stringify([bareName, sidechain])`. */
  readonly counts: Map<string, number>;
  /** Records carrying a `version` other than the pin. */
  mismatched: number;
  /** Records carrying the pin. */
  pinned: number;
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

/** Records the record's `version`, if it carries one, against `cliVersion`. */
function applyVersion(tally: Tally, record: JsonObject, cliVersion: string): void {
  const version = record['version'];
  if (version === undefined) return;
  if (version === cliVersion) tally.pinned += 1;
  else tally.mismatched += 1;
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
async function applySource(tally: Tally, source: SkillUseSource, cliVersion: string): Promise<void> {
  for await (const rawLine of source.lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const record = parseRecord(line);
    if (record === null) {
      tally.unreadable += 1;
      continue;
    }
    applyVersion(tally, record, cliVersion);
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
 * Folds a session's logs into one reading: its uses, or `unknown` when the
 * logs are not all of `cliVersion`, hold no versioned record, or hold a
 * line or call the fold cannot read. See the module note.
 *
 * Each source is consumed once, in order, and never collected into an
 * array.
 */
export async function collectSkillUse(
  sessionId: string,
  sources: readonly SkillUseSource[],
  cliVersion: string = SKILL_USE_CLI_VERSION,
): Promise<SkillUseReading> {
  const tally: Tally = { counts: new Map(), mismatched: 0, pinned: 0, unreadable: 0 };
  for (const source of sources) await applySource(tally, source, cliVersion);

  if (tally.mismatched > 0 || tally.pinned === 0 || tally.unreadable > 0) {
    return { sessionId, uses: UNKNOWN_SKILL_COUNT };
  }
  return { sessionId, uses: usesOf(tally.counts) };
}

/**
 * Reads the skill use of the session whose main log is `sessionLogPath`,
 * over that log and every log {@link subagentLogPaths} lists for it. The
 * session id is the main log's basename, as on the session row.
 *
 * Throws when the main log cannot be read.
 */
export async function readSkillUse(
  sessionLogPath: string,
  cliVersion: string = SKILL_USE_CLI_VERSION,
): Promise<SkillUseReading> {
  const sources: SkillUseSource[] = [
    { lines: readLines(sessionLogPath), subagent: false },
    ...subagentLogPaths(sessionLogPath).map((path) => ({ lines: readLines(path), subagent: true })),
  ];
  return collectSkillUse(sessionIdFromPath(sessionLogPath), sources, cliVersion);
}
