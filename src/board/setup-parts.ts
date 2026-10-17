/**
 * The pieces every step of `rafa init --board` builds its answer from:
 * the {@link BoardPart} each step reports, and the readers of what a `gh`
 * command wrote.
 *
 * They live apart from `./setup.ts` so that `./setup-roadmap.ts`, which
 * `./setup.ts` re-exports, can use them without importing the module
 * that imports it. `./setup.ts` re-exports the three types, so no
 * importer of the board step reads this file by name.
 */
import type { GhResult } from '../adapters/tracker/github.js';

import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

/** What every refusal this module writes opens with. */
export const PREFIX = 'board setup';

/** What one part of the board came to. */
export type BoardOutcome = 'created' | 'present' | 'refused';

/** Which part of the board a {@link BoardPart} is about. */
export type BoardPartKind = 'label' | 'template' | 'issue' | 'setting';

/** One part of the board, and what this run made of it. */
export interface BoardPart {
  /** Which part it is; a caller groups its rows by this. */
  readonly kind: BoardPartKind;
  /** What it is called: a label name, a path, `Roadmap issue`, `roadmap.issue`. */
  readonly name: string;
  /** Created by this run, already present, or not made. */
  readonly outcome: BoardOutcome;
  /** One sentence: what was made, or why it was not. */
  readonly detail: string;
}

/** One part, as the parts are built. */
export function partOf(kind: BoardPartKind, name: string, outcome: BoardOutcome, detail: string): BoardPart {
  return { kind, name, outcome, detail };
}

/** What a failed command wrote, for a message. Never empty. */
export function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** What `command` wrote, parsed as a list. Throws, naming it, when it is not one. */
export function parseRows(stdout: string, command: string): readonly unknown[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(payload)}, expected a list`);
  }
  return payload as readonly unknown[];
}

/** The string a row carries at `key`, checked. */
export function rowText(row: unknown, key: string, command: string, where: string): string {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a string`);
  }
  return value;
}

/** The positive whole number a row carries at `key`, checked. */
export function rowNumber(row: unknown, key: string, command: string, where: string): number {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

/** True when `held` carries `name`, however either spells its case. */
export function holdsLabel(held: readonly string[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return held.some((label) => label.trim().toLowerCase() === wanted);
}
