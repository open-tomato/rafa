/**
 * A recording stand-in for the project refresh the `rafa epic` actions
 * share (`./epic-project.ts`), handed in as their `projectRefresh` seam,
 * and the config line that opts a planted project in. Each action's test
 * reads from it which issues and widening its run asked the refresh for,
 * without driving the whole project through a fake `gh`;
 * `./epic-project.test.ts` and `src/board/project/refresh.test.ts` cover
 * the refresh itself.
 *
 * This module is a test helper that is not itself a test file, as
 * `src/board/project/project-fake.ts` is: bun runs nothing in it until a
 * `*.test.ts` calls it, and `check-types` reads it.
 */
import type { RefreshEpicItems } from './epic-project.js';
import type { ProjectRefresh, RefreshOptions, RefreshWidening } from '../../board/project/refresh.js';

/** The project number a planted config names. */
export const EPIC_PROJECT_NUMBER = 6;

/** One call the recording refresh received. */
export interface EpicRefreshCall {
  /** The `board.project.number` it was handed. */
  readonly number: number | null;
  readonly issues: readonly number[];
  readonly widening: RefreshWidening;
}

/** The recording refresh and what it received. */
export interface RecordingEpicRefresh {
  readonly refresh: RefreshEpicItems;
  /** Every call, in order. */
  readonly calls: () => readonly EpicRefreshCall[];
}

/** `config` with `board.project.number` set to `number`, appended as its own `board:` section. */
export function withProjectNumber(config: string, number: number = EPIC_PROJECT_NUMBER): string {
  return `${config}board:\n  project:\n    number: ${String(number)}\n`;
}

/** A refresh that answers `warnings` as a refresh that sent nothing would, and records each call. */
export function recordingEpicRefresh(warnings: readonly string[] = []): RecordingEpicRefresh {
  const calls: EpicRefreshCall[] = [];
  const refresh: RefreshEpicItems = (options: RefreshOptions, issues, widening): Promise<ProjectRefresh> => {
    calls.push({ number: options.config.boardProjectNumber, issues, widening });
    return Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings });
  };
  return { refresh, calls: () => [...calls] };
}
