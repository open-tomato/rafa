/**
 * Where a stretch keeps its files, and the two facts every action reads
 * from them: the engineer's session id and the stretch's start.
 *
 * @module bundled/operators/scripts/stretch-dir
 */
import type { Io } from './io.js';

import { join } from 'node:path';

/** The stretch an action reads. */
export interface Stretch {
  /** The project root, which holds `.rafa/`. */
  readonly root: string;
  /** `.rafa/stretch/<n>` under the root. */
  readonly dir: string;
  /** The engineer's Claude session id, from `agent.json`. */
  readonly sessionId: string | undefined;
  /** The stretch's start in epoch milliseconds, from `agent.json`. */
  readonly startedAt: number | undefined;
}

/** Reads `.rafa/stretch/<n>/agent.json`; a missing or broken file leaves both fields unset. */
export function readStretch(io: Io, root: string, n: string): Stretch {
  const dir = join(root, '.rafa', 'stretch', n);
  const text = io.read(join(dir, 'agent.json'));
  let sessionId: string | undefined;
  let startedAt: number | undefined;

  if (text !== undefined) {
    try {
      const agent = JSON.parse(text) as { sessionId?: unknown; startedAt?: unknown };

      sessionId = typeof agent.sessionId === 'string'
        ? agent.sessionId
        : undefined;
      const started = typeof agent.startedAt === 'string'
        ? Date.parse(agent.startedAt)
        : Number.NaN;

      startedAt = Number.isNaN(started)
        ? undefined
        : started;
    } catch {
      // A broken agent.json reads as no agent.json.
    }
  }

  return { root, dir, sessionId, startedAt };
}

/** The directory Claude Code keeps a working directory's session logs in. */
export function transcriptDir(io: Io, cwd: string): string {
  return join(io.home(), '.claude', 'projects', cwd.replace(/[/.]/g, '-'));
}

/** The first and the last `"timestamp"` in a session log, in epoch milliseconds. */
export function sessionWindow(text: string): { from: number; to: number } | undefined {
  const pattern = /"timestamp":"([^"]+)"/g;
  const first = pattern.exec(text);

  if (!first?.[1]) {
    return undefined;
  }
  const tail = text.slice(Math.max(0, text.length - 50_000));
  const stamps = [...tail.matchAll(/"timestamp":"([^"]+)"/g)];
  const last = stamps.at(-1)?.[1] ?? first[1];
  const from = Date.parse(first[1]);
  const to = Date.parse(last);

  return Number.isNaN(from) || Number.isNaN(to)
    ? undefined
    : { from, to };
}
