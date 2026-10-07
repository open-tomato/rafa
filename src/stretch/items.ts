/**
 * The item ledger of a stretch: `.rafa/stretch/<n>/items.ndjson` (#816).
 *
 * `rafa stretch item` appends one line per merged item, and
 * `rafa stretch end` reads them all back for the `Closes` lines of the
 * pull request into the default branch. Each line is one JSON object:
 * the issue, the plan stub, the pull request number, the merge commit,
 * the item's `Closes` lines and the ISO timestamp it was written at.
 *
 * The file is append-only text a person may edit, so a read never
 * refuses the whole ledger over one bad line: {@link readItems} keeps
 * every well-formed item and names each malformed line by its 1-based
 * number and the reason. {@link lastItemTime} is the newest timestamp,
 * the cut-off the pit-stop readings count new bugs from.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { errorCode } from '../loop/sessions.js';

import { stretchFolder } from './folder.js';

/** The ledger's file name inside a stretch folder. */
export const ITEMS_FILE = 'items.ndjson';

/** One merged item of a stretch. */
export interface StretchItem {
  readonly issue: string;
  readonly plan: string;
  readonly pullRequest: number;
  readonly mergeCommit: string;
  readonly closes: readonly string[];
  /** ISO 8601 time the line was written. */
  readonly at: string;
}

/** A ledger line that did not read as an item. */
export interface MalformedItemLine {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly reason: string;
}

/** Every item the ledger holds, and every line it skipped. */
export interface ItemsReading {
  readonly items: readonly StretchItem[];
  readonly malformed: readonly MalformedItemLine[];
}

/** The ledger's path for stretch `n` of the project at `root`. */
export function itemsPath(root: string, n: number): string {
  return join(stretchFolder(root, n), ITEMS_FILE);
}

/** Appends `item` as one line, creating the folder and file as needed. */
export function appendItem(root: string, n: number, item: StretchItem): void {
  const reason = itemProblem(item);
  if (reason !== null) {
    throw new Error(`refusing to write a stretch item: ${reason}`);
  }
  const file = itemsPath(root, n);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(toRecord(item))}\n`);
}

/** Reads every line of the ledger; a missing file reads as empty. */
export function readItems(root: string, n: number): ItemsReading {
  const text = readLedger(itemsPath(root, n));
  return text === null
    ? { items: [], malformed: [] }
    : parseItems(text);
}

/** Parses ledger text, skipping blank lines and naming malformed ones. */
export function parseItems(text: string): ItemsReading {
  const items: StretchItem[] = [];
  const malformed: MalformedItemLine[] = [];
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') {
      return;
    }
    const parsed = parseLine(raw);
    if (typeof parsed === 'string') {
      malformed.push({ line: index + 1, reason: parsed });
    } else {
      items.push(parsed);
    }
  });
  return { items, malformed };
}

/** The newest `at` among the ledger's items, or null when it has none. */
export function lastItemTime(root: string, n: number): Date | null {
  const times = readItems(root, n).items.map((item) => Date.parse(item.at));
  return times.length === 0
    ? null
    : new Date(Math.max(...times));
}

/** One line per malformed entry, for a command to print. */
export function malformedItemLines(root: string, n: number, malformed: readonly MalformedItemLine[]): readonly string[] {
  const file = itemsPath(root, n);
  return malformed.map((entry) => `skipped ${file}:${entry.line}: ${entry.reason}`);
}

function readLedger(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function toRecord(item: StretchItem): StretchItem {
  return {
    issue: item.issue,
    plan: item.plan,
    pullRequest: item.pullRequest,
    mergeCommit: item.mergeCommit,
    closes: [...item.closes],
    at: item.at,
  };
}

function parseLine(raw: string): StretchItem | string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'not a JSON object';
  }
  const record = value as Record<string, unknown>;
  const candidate = {
    issue: record['issue'],
    plan: record['plan'],
    pullRequest: record['pullRequest'],
    mergeCommit: record['mergeCommit'],
    closes: record['closes'],
    at: record['at'],
  } as StretchItem;
  const reason = itemProblem(candidate);
  return reason === null
    ? toRecord(candidate)
    : reason;
}

function itemProblem(item: StretchItem): string | null {
  for (const field of ['issue', 'plan', 'mergeCommit', 'at'] as const) {
    if (typeof item[field] !== 'string' || item[field] === '') {
      return `${field} is not a non-empty string`;
    }
  }
  if (!Number.isInteger(item.pullRequest) || item.pullRequest <= 0) {
    return 'pullRequest is not a positive whole number';
  }
  if (!Array.isArray(item.closes) || !item.closes.every((line) => typeof line === 'string')) {
    return 'closes is not a list of strings';
  }
  if (Number.isNaN(Date.parse(item.at))) {
    return 'at is not a timestamp';
  }
  return null;
}
