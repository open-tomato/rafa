/**
 * The proposal pass's ledger: the file one session writes, a reviewer
 * edits by hand, and `--apply` reads back.
 *
 * `./propose.ts` is the pass — it selects the files, batches them, runs
 * the sessions and writes the skills. This module is the shape its
 * answers travel in, `<scope>/.rafa/backfill/proposals-<nn>.yaml`, and
 * it is deliberately the whole contract between the two halves:
 * {@link renderProposalFile} writes what a session said, a person edits
 * the file in an editor, and {@link parseProposalFile} reads back what
 * survived that edit. Nothing here spawns a session, opens a skill or
 * writes one; the pass owns every one of those and this module owns
 * only the text. It is `../demote/report.ts` to that pass's
 * `../demote/apply.ts`, for the same reason and with the same split.
 *
 * ## Why the whole file is YAML and the demotion report is a table
 *
 * The demotion report is a markdown table because its six cells are
 * short and a reviewer reads it rendered. A proposal carries four free
 * sentences per row, one of them a description of up to 129 characters,
 * and a sentence typed into a table cell is one bare `|` away from
 * being silently re-columned. So a proposal file is YAML from its first
 * byte: a reviewer edits values rather than cells, a value that needs
 * quoting is quoted by `Bun.YAML`, and a row whose edit broke the
 * syntax refuses the file rather than shifting a field.
 *
 * The header comment ({@link PROPOSAL_FILE_HEADER}) is what the review
 * instructions are written in, because a YAML comment survives the
 * reviewer's edit and is not a key anything has to ignore.
 *
 * ## A file nothing can read holds no review
 *
 * {@link parseProposalFile} answers a null file and ONE sentence saying
 * why, rather than a partial file: `--apply` acts on every row of a file
 * at once, so a file half of which is readable is not a file the pass
 * may act on. That is `../demote/report.ts`'s rule and
 * `../schema/instinct.ts`'s before it. The sentence is there because a
 * refusal a reviewer cannot act on sends them to read the parser.
 *
 * ## `status` and `skills` are the two keys that refuse a run
 *
 * `status` is `draft` until a reviewer marks it `reviewed`, and
 * `--apply` refuses a draft. `skills` names the directory the rows are
 * relative to, and `--apply` refuses a file that names another one:
 * every row is a relative path plus a sha256, and applying one tier's
 * proposals over another tier would match those paths against different
 * files. Both refusals are `./propose.ts`'s to make; this module only
 * guarantees that both values survive the round trip.
 */
import type { SkillSignal } from '../schema/skill.js';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderFrontmatter } from '../schema/frontmatter.js';
import { SKILL_SIGNALS } from '../schema/skill.js';

/** The directory under `<base>/.rafa/` the proposal files are written into. */
export const BACKFILL_PATH = join('.rafa', 'backfill');

/** What a proposal file is named, before its two-digit batch number. */
export const PROPOSAL_FILE_PREFIX = 'proposals-';

/** And after it. */
export const PROPOSAL_FILE_EXTENSION = '.yaml';

/** The shape a row's hash takes: sha256 in lower-case hex. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Whether a proposal file has been through the review. */
export type ProposalStatus = 'draft' | 'reviewed';

/** Every status, in the order a file passes through them. */
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['draft', 'reviewed'];

/** The status a freshly written proposal file carries. */
export const DRAFT_FILE: ProposalStatus = 'draft';

/** The status an apply requires. */
export const REVIEWED_FILE: ProposalStatus = 'reviewed';

/** Whether a row carries an answer anything may be written from. */
export type ProposalRowStatus = 'answered' | 'unanswered';

/** Every row status. */
export const PROPOSAL_ROW_STATUSES: readonly ProposalRowStatus[] = ['answered', 'unanswered'];

/** The status of a row no session answered usably. */
export const UNANSWERED_ROW: ProposalRowStatus = 'unanswered';

/** The status of a row that carries what its needs asked for. */
export const ANSWERED_ROW: ProposalRowStatus = 'answered';

/** What one file is asked for. */
export type ProposalNeed = 'prevents' | 'trigger' | 'description';

/** Every need, in the order a row lists them. */
export const PROPOSAL_NEEDS: readonly ProposalNeed[] = ['prevents', 'trigger', 'description'];

/** One file of a batch, and what is to be written into it. */
export interface ProposalRow {
  /** Its path relative to the skills directory, in posix form. */
  readonly path: string;
  /** The skill name, which is the key a trigger sentence is answered under. */
  readonly name: string;
  /** sha256 of the whole file when the proposal was written. */
  readonly hash: string;
  /** What the file was asked for. */
  readonly needs: readonly ProposalNeed[];
  /** Whether it carries an answer. */
  readonly status: ProposalRowStatus;
  /** `prevents`, or null. */
  readonly prevents: string | null;
  /** `signal`, or null. */
  readonly signal: SkillSignal | null;
  /** The trigger sentence, or null. It is written to no skill; see `./propose.ts`. */
  readonly trigger: string | null;
  /** A replacement `description`, or null. */
  readonly description: string | null;
  /** Why the row is unanswered, or null when it is answered. */
  readonly note: string | null;
}

/** One batch's proposals: its header, and one row per file. */
export interface ProposalFile {
  /** `status`, {@link DRAFT_FILE} until the review marks it. */
  readonly status: ProposalStatus;
  /** Which batch it is, 1-based. */
  readonly batch: number;
  /** The skills directory its rows are relative to, absolute. */
  readonly skills: string;
  /** The exit code of the session that answered it. */
  readonly exitCode: number;
  /** One row per file of the batch, in selection order. */
  readonly rows: readonly ProposalRow[];
}

/** What {@link parseProposalFile} answers. */
export interface ProposalParseResult {
  /** The file read, or null when it could not be. */
  readonly file: ProposalFile | null;
  /** One sentence saying why it could not be, or null when it was. */
  readonly problem: string | null;
}

/** One proposal file read off disk, and where it was read from. */
export interface ReadProposal {
  /** The file, absolute. */
  readonly path: string;
  /** What reading it came to. */
  readonly result: ProposalParseResult;
}

/** The comment block every proposal file opens with, for the reviewer. */
export const PROPOSAL_FILE_HEADER = [
  '# Backfill proposals: one row per skill, written by one session.',
  '#',
  '# Review each row against the skill description and its When to Use',
  '# section, reading the body only where neither supports prevents.',
  '# Correct what a row says, answer every row marked unanswered, and',
  '# then set status to reviewed.',
  '#',
  '# Applying refuses a file still marked draft, a file naming another',
  '# skills directory, and a row whose skill changed since its sha256.',
  '',
  '',
].join('\n');

/** The file a batch of `batch` is written to, under `dir`. */
export function proposalPath(dir: string, batch: number): string {
  return join(dir, `${PROPOSAL_FILE_PREFIX}${String(batch).padStart(2, '0')}${PROPOSAL_FILE_EXTENSION}`);
}

/** Whether `name` names a proposal file this module wrote. */
export function isProposalFileName(name: string): boolean {
  return name.startsWith(PROPOSAL_FILE_PREFIX) && name.endsWith(PROPOSAL_FILE_EXTENSION);
}

/**
 * True for a parsed YAML value that is a mapping.
 *
 * Exported with the three readers below because `./propose.ts` reads a
 * session's answer with the same four: an answer is YAML a model wrote
 * and a proposal file is YAML a person edited, and neither may be read
 * by indexing a value whose type nothing checked.
 */
export function isYamlMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The string at `key`, or null when it is absent or another type. */
export function stringAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string'
    ? value
    : null;
}

/** The string at `key` trimmed, or null when it is absent, blank or another type. */
export function filledStringAt(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = stringAt(data, key)?.trim() ?? '';
  return value === ''
    ? null
    : value;
}

/** Whether `value` is one of the two signals the skill schema allows. */
export function isSkillSignal(value: string): value is SkillSignal {
  return (SKILL_SIGNALS as readonly string[]).includes(value);
}

/** The mapping `text` holds, or null when it holds none. */
export function readYamlMapping(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text.replace(/\r\n/g, '\n'));
  } catch {
    return null;
  }
  return isYamlMapping(parsed)
    ? parsed
    : null;
}

/** One proposal file as the mapping it is written as. */
function proposalDocument(file: ProposalFile): Record<string, unknown> {
  return {
    status: file.status,
    batch: file.batch,
    skills: file.skills,
    session_exit_code: file.exitCode,
    rows: file.rows.map((row) => ({
      path: row.path,
      name: row.name,
      sha256: row.hash,
      needs: [...row.needs],
      status: row.status,
      prevents: row.prevents,
      signal: row.signal,
      trigger: row.trigger,
      description: row.description,
      note: row.note,
    })),
  };
}

/**
 * `file` as the text written to disk: the reviewer's header, then the
 * mapping. The mapping goes through `renderFrontmatter`, this repo's
 * one YAML writer, so a value needing quotes is quoted the way every
 * other file rafa writes quotes it and the trailing space Bun leaves
 * after a list key is stripped in one place.
 */
export function renderProposalFile(file: ProposalFile): string {
  return `${PROPOSAL_FILE_HEADER}${renderFrontmatter(proposalDocument(file))}\n`;
}

/** One parsed row, or the sentence saying why it is not one. */
function parseRow(value: unknown, index: number): ProposalRow | string {
  if (!isYamlMapping(value)) return `row ${index + 1} is no mapping`;

  const path = filledStringAt(value, 'path');
  const name = filledStringAt(value, 'name');
  const hash = filledStringAt(value, 'sha256');
  const status = filledStringAt(value, 'status');
  const signal = filledStringAt(value, 'signal');
  const needs = Array.isArray(value['needs'])
    ? value['needs'].map((need) => String(need))
    : [];

  if (path === null) return `row ${index + 1} names no path`;
  if (name === null) return `row ${index + 1} names no skill name`;
  if (hash === null || !SHA256_PATTERN.test(hash)) return `row ${index + 1} carries no sha256`;
  if (status === null || !(PROPOSAL_ROW_STATUSES as readonly string[]).includes(status)) {
    return `row ${index + 1} carries the status ${status ?? '(none)'}, which is no row status`;
  }
  if (signal !== null && !isSkillSignal(signal)) {
    return `row ${index + 1} carries the signal ${signal}, which is neither ${SKILL_SIGNALS.join(' nor ')}`;
  }

  return {
    path,
    name,
    hash,
    needs: needs.filter(
      (need): need is ProposalNeed => (PROPOSAL_NEEDS as readonly string[]).includes(need),
    ),
    status: status as ProposalRowStatus,
    prevents: filledStringAt(value, 'prevents'),
    signal,
    trigger: filledStringAt(value, 'trigger'),
    description: filledStringAt(value, 'description'),
    note: filledStringAt(value, 'note'),
  };
}

/** A parse that answered nothing, for the stated reason. */
function unreadable(problem: string): ProposalParseResult {
  return { file: null, problem };
}

/** The header keys read, or the sentence saying which one refused. */
function parseHeader(data: Readonly<Record<string, unknown>>): string | null {
  const status = filledStringAt(data, 'status');
  if (status === null || !(PROPOSAL_STATUSES as readonly string[]).includes(status)) {
    return `the status ${status ?? '(none)'} is neither ${PROPOSAL_STATUSES.join(' nor ')}`;
  }
  if (filledStringAt(data, 'skills') === null) return 'the file names no skills directory';
  return Array.isArray(data['rows'])
    ? null
    : 'the file carries no rows list';
}

/** The number at `key`, or 0 when it carries none. */
function numberAt(data: Readonly<Record<string, unknown>>, key: string): number {
  const value = data[key];
  return typeof value === 'number'
    ? value
    : 0;
}

/**
 * `text` as a proposal file, or the one sentence saying why it is not
 * one. A single bad row refuses the whole file; see the module note.
 */
export function parseProposalFile(text: string): ProposalParseResult {
  const parsed = readYamlMapping(text);
  if (parsed === null) return unreadable('the file holds no YAML mapping');

  const headerProblem = parseHeader(parsed);
  if (headerProblem !== null) return unreadable(headerProblem);

  const rows: ProposalRow[] = [];
  for (const [index, value] of (parsed['rows'] as readonly unknown[]).entries()) {
    const row = parseRow(value, index);
    if (typeof row === 'string') return unreadable(row);
    rows.push(row);
  }

  return {
    file: {
      status: filledStringAt(parsed, 'status') as ProposalStatus,
      batch: numberAt(parsed, 'batch'),
      skills: filledStringAt(parsed, 'skills') ?? '',
      exitCode: numberAt(parsed, 'session_exit_code'),
      rows,
    },
    problem: null,
  };
}

/**
 * Every proposal file `dir` holds, in name order, each with the path it
 * was read from. A directory that cannot be read holds none. A file
 * that cannot be parsed is answered with its problem and a null file,
 * so a caller reports it rather than passing over it in silence.
 */
export function readProposalFiles(dir: string): readonly ReadProposal[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  return names
    .filter((name) => isProposalFileName(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const path = join(dir, name);
      try {
        return { path, result: parseProposalFile(readFileSync(path, 'utf8')) };
      } catch (error) {
        return { path, result: unreadable(`the file cannot be read (${error instanceof Error
          ? error.message
          : String(error)})`) };
      }
    });
}
