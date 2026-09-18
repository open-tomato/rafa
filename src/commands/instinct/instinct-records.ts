/**
 * What `rafa instinct list` and `rafa instinct show` share: the two
 * scopes read, the files in them that are records, and the lookup an
 * id is answered by.
 *
 * `rafa instinct check <dir>` answers one directory in detail and
 * exits with its failures. These two commands answer the other
 * question: what has been LEARNED, in which scope, and what one record
 * says. The scopes are `src/schema/tiers.ts`'s —
 * `<root>/.rafa/instincts` and `~/.rafa/instincts`, nearest the work
 * first — so a scope that moves moves in one place.
 *
 * ## What is a record, and what is passed over
 *
 * A record is a top-level `<scope>/<id>.md`, which is the layout
 * `src/check/layout.ts` registers. Everything else in the directory is
 * passed over without a word: the local Learning adapter writes
 * `instincts.ndjson` and `flags.ndjson` there, and those are its store
 * and no records of anybody's. They are skipped by the same rule that
 * skips a `.DS_Store` and a subdirectory — a record is a `.md` file at
 * the top level — rather than by name, so a third NDJSON file the
 * adapter grows later is skipped on the day it appears. {@link
 * LEARNING_STORE_FILES} names the two anyway, for the sentence a
 * listing prints and for a test to plant.
 *
 * ## A record that cannot be read is listed, not thrown
 *
 * {@link readRecord} hands back both halves of {@link parseInstinct}:
 * the record when it parsed, and every rule it broke when it did not.
 * A scope with a half-written file in it is still a scope worth
 * listing, and the listing says which file is unreadable and how many
 * rules it broke. `rafa instinct check` is the command that exits with
 * that count; nothing here sets an exit code.
 *
 * ## The id is the file name
 *
 * {@link InstinctRecordEntry.id} is the file's stem, never the
 * frontmatter `id`, because it is what a lookup has to work on for a
 * file whose frontmatter cannot be read at all. The checker's
 * `name-mismatch` rule is what says the two disagree; a lookup that
 * preferred the frontmatter would make a mismatched record
 * unreachable by the name it is filed under.
 *
 * ## No directory is read that is not there
 *
 * {@link readScope} asks {@link tierExists} first and answers an empty
 * listing for an absent scope, which is the ordinary state of a
 * project that has learned nothing yet.
 */
import type { RafaContext } from '../../cli/command.js';
import type { ProjectFound } from '../../project/scope.js';
import type { Instinct, InstinctIssue } from '../../schema/instinct.js';
import type { InstinctScope, TierSeams } from '../../schema/tiers.js';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MARKDOWN_EXTENSION } from '../../check/layout.js';
import { parseInstinct } from '../../schema/instinct.js';
import { resolveInstinctScopes, tierExists } from '../../schema/tiers.js';

/** The local Learning adapter's own files, which are no records. */
export const LEARNING_STORE_FILES: readonly string[] = ['instincts.ndjson', 'flags.ndjson'];

/** One file under a scope, read as a record. */
export interface InstinctRecordEntry {
  /** Which scope holds it. */
  readonly scope: InstinctScope;
  /** The file, absolute. */
  readonly path: string;
  /** The file's stem, which is the id a lookup works on. */
  readonly id: string;
  /** The record, or null when it broke a rule or could not be opened. */
  readonly instinct: Instinct | null;
  /** Every rule it broke, empty on a record that read clean. */
  readonly issues: readonly InstinctIssue[];
}

/** One scope, and what it holds. */
export interface ScopeListing {
  /** Which scope. */
  readonly scope: InstinctScope;
  /** The directory it resolved to. */
  readonly dir: string;
  /** Whether that directory is there at all. */
  readonly exists: boolean;
  /** One entry per record, in id order. Empty for an absent scope. */
  readonly records: readonly InstinctRecordEntry[];
}

/** Whether `name` is a record file: a `.md` that is no dotfile. */
export function isRecordFile(name: string): boolean {
  return !name.startsWith('.') && name.endsWith(MARKDOWN_EXTENSION) && name !== MARKDOWN_EXTENSION;
}

/** `name` without its `.md`. */
export function recordId(name: string): string {
  return name.slice(0, -MARKDOWN_EXTENSION.length);
}

/** The one issue a file nothing can open is reported with. */
function unreadableIssue(message: string): InstinctIssue {
  return { code: 'missing-frontmatter', field: 'file', message: `the file could not be read: ${message}` };
}

/** One file read as a record, with every rule it broke beside it. */
export function readRecord(path: string, scope: InstinctScope, id: string): InstinctRecordEntry {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    return { scope, path, id, instinct: null, issues: [unreadableIssue(message)] };
  }
  const parsed = parseInstinct(text);
  return { scope, path, id, instinct: parsed.instinct, issues: parsed.issues };
}

/** Whether a path is a file, with a broken link or a vanished entry answering false. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Every record file directly under `dir`, in name order. */
export function recordFiles(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => isRecordFile(name) && isFile(join(dir, name)))
    .sort((left, right) => left.localeCompare(right));
}

/** One scope read, or an empty listing when its directory is not there. */
export function readScope(scope: InstinctScope, dir: string): ScopeListing {
  if (!tierExists(dir)) return { scope, dir, exists: false, records: [] };
  return {
    scope,
    dir,
    exists: true,
    records: recordFiles(dir).map((name) => readRecord(join(dir, name), scope, recordId(name))),
  };
}

/** Both scopes read, nearest the work first. */
export function readScopes(seams: TierSeams): readonly ScopeListing[] {
  return resolveInstinctScopes(seams).map((location) => readScope(location.scope, location.dir));
}

/** Every entry of every scope, in scope order. */
export function allRecords(listings: readonly ScopeListing[]): readonly InstinctRecordEntry[] {
  return listings.flatMap((listing) => listing.records);
}

/** Every entry filed under `id`, in scope order: the project scope holds one too. */
export function findRecords(listings: readonly ScopeListing[], id: string): readonly InstinctRecordEntry[] {
  return allRecords(listings).filter((entry) => entry.id === id);
}

/** The project the dispatcher resolved, which both commands declare they need. */
export function instinctProject(context: RafaContext, name: string): ProjectFound {
  if (context.project === null) throw new Error(`${name} runs inside a project, and was handed none`);
  return context.project;
}
