/**
 * `stretch watch`: one probe of every signal the watchtower reads, and
 * with `--until` a wait that ends when one of them fires. The probe reads
 * the engineer's row in `claude agents --json`, its session log, the
 * stretch's loop logs, `rafa loop list` and the settings files of the
 * hook rule. It writes nothing.
 *
 * @module bundled/operators/scripts/watch
 */

import type { Io } from './io.js';
import type { Stretch } from './stretch-dir.js';

import { join } from 'node:path';

import { round1 } from './stats.js';
import { sessionWindow } from './stretch-dir.js';
import { readSuspends, suspendedMinutes } from './suspends.js';

/** Everything one probe saw. */
export interface Probe {
  readonly at: number;
  readonly agent: string;
  readonly agentQuietMinutes: number | undefined;
  readonly denials: number;
  readonly topError: { readonly text: string; readonly count: number } | undefined;
  readonly hook: readonly string[];
  readonly log: string | undefined;
  readonly events: number;
  readonly lastLine: string | undefined;
  readonly loopQuietMinutes: number | undefined;
  readonly loops: readonly string[];
}

/** The thresholds a probe is judged by, in minutes and counts. */
export interface Thresholds {
  readonly waitMinutes: number;
  readonly quietMinutes: number;
  readonly repeats: number;
}

/** A `rafa·` line that ends or stops something. */
const EVENT_LINE = /^rafa· (pr |no pr|halt|error)|^rafa· task \S+ blocked/;

/** A denial in a session log: the auto-mode check or a hook. */
const DENIAL = /denied by the Claude Code auto mode classifier|hook[^"\n]{0,40}(denied|blocked)/g;

/** The engineer's status in `claude agents --json`, or `gone`. */
export function agentStatus(stdout: string, sessionId: string): string {
  try {
    const rows = JSON.parse(stdout) as { sessionId?: string; status?: string }[];

    return rows.find((row) => row.sessionId === sessionId)?.status ?? 'gone';
  } catch {
    return 'unknown';
  }
}

/** The denials and the most repeated error result in a session log. */
export function transcriptSignals(text: string): { denials: number; topError: Probe['topError'] } {
  const counts = new Map<string, number>();

  for (const line of text.split('\n')) {
    if (!line.includes('"is_error":true')) {
      continue;
    }
    try {
      const record = JSON.parse(line) as { message?: { content?: unknown } };
      const parts = Array.isArray(record.message?.content)
        ? record.message.content
        : [];

      for (const part of parts as { type?: string; is_error?: boolean; content?: unknown }[]) {
        if (part.type === 'tool_result' && part.is_error) {
          const key = (typeof part.content === 'string'
            ? part.content
            : JSON.stringify(part.content)).slice(0, 120);

          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    } catch {
      // A line that is no JSON is no error result.
    }
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return { denials: (text.match(DENIAL) ?? []).length, topError: top
    ? { text: top[0], count: top[1] }
    : undefined };
}

/** The settings files and skills that make the hook rule fire. */
export function hookFindings(io: Io, root: string): string[] {
  const settings = [join(io.home(), '.claude', 'settings.json'), join(io.home(), '.claude', 'settings.local.json'), join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')];
  const skills = [join(io.home(), '.claude', 'skills', 'rafa-hookify'), join(root, '.claude', 'skills', 'rafa-hookify')];

  return [
    ...settings.filter((path) => io.read(path)?.includes('rafa-tooling-hook')).map((path) => `${path} names rafa-tooling-hook`),
    ...skills.filter((path) => io.mtime(path) !== undefined).map((path) => `${path} is installed`),
  ];
}

/** The engineer's session log, looked up under every project directory. */
function findTranscript(io: Io, sessionId: string): string | undefined {
  const projects = join(io.home(), '.claude', 'projects');

  return io.list(projects).map((dir) => join(projects, dir, `${sessionId}.jsonl`))
    .find((path) => io.mtime(path) !== undefined);
}

/** The running loops' plan stubs, from `rafa loop list --output=json`. */
export function runningLoops(stdout: string): string[] {
  const result = stdout.trim().split('\n')
    .reverse()
    .find((line) => line.includes('"type":"result"'));

  try {
    const sessions = (JSON.parse(result ?? '') as { data?: { sessions?: { session?: { planStub?: string; state?: string } }[] } }).data?.sessions ?? [];

    return sessions.flatMap((entry) => (entry.session?.state === 'running' && entry.session.planStub
      ? [entry.session.planStub]
      : []));
  } catch {
    return [];
  }
}

/** Awake minutes from `from` to `now`, suspends taken out. */
function awakeSince(io: Io, from: number, now: number): number {
  const suspends = readSuspends(io, from);

  return round1((now - from) / 60_000 - (suspends.known
    ? suspendedMinutes(suspends.suspends, from, now)
    : 0));
}

/** The newest `loop-*.log` in the stretch folder, its events and its quiet time. */
function loopSignals(io: Io, stretch: Stretch, now: number): Pick<Probe, 'log' | 'events' | 'lastLine' | 'loopQuietMinutes'> {
  const logs = io.list(stretch.dir).filter((name) => /^loop-.*\.log$/.test(name));
  const newest = logs.map((name) => ({ path: join(stretch.dir, name), at: io.mtime(join(stretch.dir, name)) ?? 0 })).sort((a, b) => b.at - a.at)[0];

  if (!newest) {
    return { log: undefined, events: 0, lastLine: undefined, loopQuietMinutes: undefined };
  }
  const lines = (io.read(newest.path) ?? '').split('\n').filter((line) => line.startsWith('rafa·'));

  return { log: newest.path, events: lines.filter((line) => EVENT_LINE.test(line)).length, lastLine: lines.at(-1), loopQuietMinutes: awakeSince(io, newest.at, now) };
}

/** Takes one probe of the stretch. */
export function probe(io: Io, stretch: Stretch): Probe {
  const now = io.now();
  const sessionId = stretch.sessionId ?? '';
  const agent = sessionId === ''
    ? 'unknown'
    : agentStatus(io.exec(['claude', 'agents', '--json']).stdout, sessionId);
  const transcriptPath = sessionId === ''
    ? undefined
    : findTranscript(io, sessionId);
  const transcript = transcriptPath === undefined
    ? ''
    : io.read(transcriptPath) ?? '';
  const window = sessionWindow(transcript.slice(-50_000));
  const { denials, topError } = transcriptSignals(transcript);

  return {
    at: now,
    agent,
    agentQuietMinutes: window
      ? awakeSince(io, window.to, now)
      : undefined,
    denials,
    topError,
    hook: hookFindings(io, stretch.root),
    ...loopSignals(io, stretch, now),
    loops: runningLoops(io.exec(['rafa', 'loop', 'list', '--output=json'], stretch.root).stdout),
  };
}

/** What fired between `before` and `after`, judged by `thresholds`. */
export function fired(before: Probe, after: Probe, thresholds: Thresholds): string[] {
  return [
    after.agent === before.agent
      ? undefined
      : `agent ${before.agent} → ${after.agent}`,
    after.agent === 'gone' && after.loops.length > 0
      ? `agent gone, loop still running: ${after.loops.join(', ')}`
      : undefined,
    after.agent === 'waiting' && (after.agentQuietMinutes ?? 0) >= thresholds.waitMinutes
      ? `agent waiting ${after.agentQuietMinutes} min`
      : undefined,
    after.events > before.events
      ? `loop event: ${after.lastLine ?? ''}`
      : undefined,
    before.loops.some((loop) => !after.loops.includes(loop))
      ? `loop ended: ${before.loops.filter((loop) => !after.loops.includes(loop)).join(', ')}`
      : undefined,
    after.loops.length > 0 && (after.loopQuietMinutes ?? 0) >= thresholds.quietMinutes
      ? `loop quiet ${after.loopQuietMinutes} min awake`
      : undefined,
    after.denials > before.denials
      ? `new denial in the agent's thread (${after.denials} in all)`
      : undefined,
    after.hook.length > 0
      ? `hook rule: ${after.hook.join('; ')}`
      : undefined,
    (after.topError?.count ?? 0) >= thresholds.repeats && (before.topError?.count ?? 0) < (after.topError?.count ?? 0)
      ? `same error ${after.topError?.count}× in the agent's thread`
      : undefined,
  ].filter((reason): reason is string => reason !== undefined);
}

/** Probes every `everyMs` until something fires, at most `timeoutMs` of rounds. */
export function waitUntil(io: Io, stretch: Stretch, thresholds: Thresholds, everyMs: number, timeoutMs: number): { reasons: string[]; probe: Probe } {
  const start = probe(io, stretch);
  const rounds = Math.max(1, Math.ceil(timeoutMs / everyMs));
  let latest = start;

  for (let round = 0; round < rounds; round += 1) {
    io.sleep(everyMs);
    latest = probe(io, stretch);
    const reasons = fired(start, latest, thresholds);

    if (reasons.length > 0) {
      return { reasons, probe: latest };
    }
  }

  return { reasons: [], probe: latest };
}

/** A probe as text. */
export function formatProbe(seen: Probe): string {
  return [
    `agent: ${seen.agent}${seen.agentQuietMinutes === undefined
      ? ''
      : `, last record ${seen.agentQuietMinutes} min ago (awake)`}`,
    `loops running: ${seen.loops.join(', ') || 'none'}`,
    `log: ${seen.log ?? 'none'}${seen.loopQuietMinutes === undefined
      ? ''
      : `, quiet ${seen.loopQuietMinutes} min (awake)`}`,
    `last line: ${seen.lastLine ?? 'none'}`,
    `denials: ${seen.denials}; top repeated error: ${seen.topError
      ? `${seen.topError.count}× ${seen.topError.text.replace(/\s+/g, ' ').slice(0, 60)}`
      : 'none'}`,
    `hook rule: ${seen.hook.length === 0
      ? 'clear'
      : seen.hook.join('; ')}`,
  ].join('\n');
}
