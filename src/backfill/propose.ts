/**
 * The backfill's half that needs judgement: the fields no table can
 * fill, proposed by a session that reads the bodies, written to a file
 * a reviewer edits, and applied from that file.
 *
 * `./derive.ts` writes the three fields a table decides. The two left
 * over are `prevents` — the failure a skill heads off — and `signal`,
 * whether that failure announces itself, and neither is anywhere in a
 * skill except in its prose. Two more things come out of the same
 * reading and are asked for in the same breath: a trigger sentence for
 * a body with no "When to Use" section, which is the one input
 * `./derive.ts` cannot take from the file itself, and a replacement
 * description for one already over the cap.
 *
 * ## Three calls, and a person between the second and the third
 *
 * {@link runProposalPass} selects the files that need something,
 * batches them twenty at a time, runs one `claude -p` session per batch
 * through the capturing door of `../utils/claude.ts`, and writes each
 * batch to `<scope>/.rafa/backfill/proposals-<nn>.yaml` marked
 * `status: draft`. A reviewer then edits those files — correcting what
 * a session said, answering what it did not, and marking each file
 * `status: reviewed`. {@link applyProposals} writes the reviewed rows
 * into the skills.
 *
 * The three modules of the pass split along those calls:
 * `./proposal-batch.ts` owns which files are asked about, what they are
 * asked and what an answer reads as; `./proposal-file.ts` owns the file
 * all three calls pass through; and this module owns the sessions, the
 * rows those answers become, and every byte written into a skill.
 *
 * The batch is twenty because a session that read two hundred bodies
 * would answer about the first few and the last few, and because a
 * batch is the unit a failure costs: an unreadable answer loses twenty
 * rows and no more, and re-running the pass asks those twenty again.
 *
 * ## A session never guesses, and neither does this module
 *
 * The one failure that has to be impossible is a `prevents` nobody
 * wrote, appearing in somebody else's skill and reading exactly like
 * one somebody did. So every road from a session to a file passes
 * through a row marked `unanswered`:
 *
 *   - A session whose stdout holds nothing `parseSessionAnswer` can
 *     read as YAML leaves EVERY row of its batch unanswered, with the
 *     exit code in the note. Nothing is inferred from the prose around
 *     the block it failed to write.
 *   - A session that answers about nineteen of its twenty files leaves
 *     the twentieth unanswered. A path it names that was not in the
 *     batch is dropped.
 *   - A row whose answer does not carry what the file NEEDS — a
 *     `prevents` with no `signal`, a `signal` outside the two the
 *     schema allows, a replacement description still over the cap — is
 *     unanswered, with a note naming what was wrong
 *     ({@link answerProblem}).
 *
 * An unanswered row is not a refusal: it is a row for the reviewer to
 * answer, and {@link applyProposals} passes it over untouched.
 *
 * ## What an apply refuses
 *
 * Three things, each for the reason the demotion pass refuses its own
 * three (`../demote/apply.ts`):
 *
 *   - **A file still marked `status: draft`**, whose every row is
 *     refused at once. A draft file is the normal output of the first
 *     half of the pass, and the review is what makes it applicable.
 *   - **A file naming another skills directory** than the one being
 *     applied. Every row is a relative path plus a hash, so one tier's
 *     proposals applied over another tier would match those paths
 *     against different files.
 *   - **A row whose skill changed since the proposal**, by sha256 of
 *     the whole file. A body edited since is a body the session did not
 *     read.
 *
 * A refusal is one row, or one file, and never the run: a hundred rows
 * reviewed by a person are too much work to throw away because the
 * sixty-first skill was edited in another window.
 *
 * ## The check around the write, and what "fails `checkFile`" means
 *
 * The check runs in place and twice, exactly as in `./derive.ts`: the
 * failures the file already had are read before the write, the file is
 * re-checked after it, and a file that came out with a failure it did
 * not have before is put back from its own bytes and the row reported
 * `refused`. A row is therefore refused for a failure this pass ADDED,
 * never for one it inherited — most of the corpus fails something
 * before the backfill opens it (a home path in a fenced command, a dead
 * body path), those failures belong to the hand-repair step, and a pass
 * that refused every file carrying one would fill in nothing at all.
 * What the belt does catch is the failure a proposal itself can make: a
 * description still over the cap, and a `prevents` written without its
 * `signal`.
 *
 * ## What is written, and what is not
 *
 * `prevents`, `signal` and a replacement `description`, through
 * `writeFrontmatter`, so the body survives byte for byte and every key
 * this pass does not name keeps its place and its spelling. The trigger
 * sentence is NOT written: it is an input to `when_to_use`, which
 * `./derive.ts` owns, so {@link applyProposals} answers the sentences
 * it applied as {@link ProposalApplyResult.triggers}, in the shape that
 * module's `triggers` option takes. A skill whose only need was a
 * trigger therefore ends an apply `unchanged`, with its sentence in
 * that record.
 */
import type { ProposalAnswer, ProposalCandidate } from './proposal-batch.js';
import type { ProposalFile, ProposalNeed, ProposalRow } from './proposal-file.js';
import type { ClaudeSettingSource } from '../config.js';
import type { CapturedSession, CapturingSpawner } from '../utils/claude.js';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { checkFile } from '../check/run.js';
import { sourceHash } from '../demote/report.js';
import { mergeFrontmatter, readFrontmatterDocument, writeFrontmatter } from '../schema/frontmatter.js';
import { countCharacters, DESCRIPTION_LIMIT, SKILL_SIGNALS } from '../schema/skill.js';
import { runClaudeCaptured } from '../utils/claude.js';

import { addedFailures, failureLines } from './derive.js';
import { batchCandidates, parseSessionAnswer, renderProposalPrompt, selectProposals } from './proposal-batch.js';
import { ANSWERED_ROW, DRAFT_FILE, isSkillSignal, proposalPath, renderProposalFile, REVIEWED_FILE, UNANSWERED_ROW } from './proposal-file.js';

/** A proposal file as it was written, and where. */
export interface WrittenProposal {
  /** The file, absolute. */
  readonly path: string;
  /** What it says. */
  readonly file: ProposalFile;
}

/** The seams one proposal pass runs through. */
export interface ProposalPassOptions {
  /** The skills directory the pass reads, absolute. */
  readonly root: string;
  /** `<base>/.rafa/backfill`, which the files are written into. */
  readonly backfillDir: string;
  /** The setting sources each session loads, the run's `loop.settingSources`. */
  readonly settingSources: readonly ClaudeSettingSource[];
  /** The flags each session is spawned with, none by default. */
  readonly flags?: readonly string[];
  /** The spawner, the real capturing one by default. */
  readonly spawn?: CapturingSpawner;
}

/** What one proposal pass came to. */
export interface ProposalPassResult {
  /** Every file written, in batch order. */
  readonly written: readonly WrittenProposal[];
  /** How many files the pass had something to ask about. */
  readonly candidates: number;
}

/** What {@link applyProposals} resolves its checks against. */
export interface ProposalApplyOptions {
  /** The project a body is consumed in, or null for a tier with none. */
  readonly projectRoot: string | null;
  /** The directories a command name in a body is looked up in. */
  readonly pathDirs: readonly string[];
}

/** What an apply did with one row. */
export type ProposalActionKind = 'applied' | 'unchanged' | 'unanswered' | 'refused';

/** Every kind, in the order a summary counts them. */
export const PROPOSAL_ACTION_KINDS: readonly ProposalActionKind[] = [
  'applied',
  'unchanged',
  'unanswered',
  'refused',
];

/** One row, and what became of the skill it names. */
export interface ProposalAction {
  /** The file, absolute. */
  readonly path: string;
  /** Its path relative to the skills directory, as the row spells it. */
  readonly relative: string;
  /** What happened to it. */
  readonly kind: ProposalActionKind;
  /** One line a caller prints unedited, saying what and why. */
  readonly detail: string;
  /** The fields written, with their values, empty for every other kind. */
  readonly changes: Readonly<Record<string, unknown>>;
  /** The failures the write ADDED, which is why a `refused` row was put back. */
  readonly added: readonly string[];
}

/** Everything an apply made of every proposal file it was handed. */
export interface ProposalApplyResult {
  /** One action per row, in file and then row order. */
  readonly actions: readonly ProposalAction[];
  /** How many rows came to each kind. */
  readonly counts: Readonly<Record<ProposalActionKind, number>>;
  /** The trigger sentences applied, by skill name, for `./derive.ts`. */
  readonly triggers: Readonly<Record<string, string>>;
}

/** A row carrying no answer, for the stated reason. */
function unanswered(candidate: ProposalCandidate, note: string): ProposalRow {
  return {
    path: candidate.relative,
    name: candidate.name,
    hash: candidate.hash,
    needs: candidate.needs,
    status: UNANSWERED_ROW,
    prevents: null,
    signal: null,
    trigger: null,
    description: null,
    note,
  };
}

/** Why `answer` does not carry what `needs` asked for, or null when it does. */
export function answerProblem(
  needs: readonly ProposalNeed[],
  answer: ProposalAnswer,
): string | null {
  if (needs.includes('prevents')) {
    if (answer.prevents === null) return 'the answer carries no prevents';
    if (answer.signal === null) return 'the answer carries prevents with no signal';
    if (!isSkillSignal(answer.signal)) {
      return `the answer signal ${answer.signal} is neither ${SKILL_SIGNALS.join(' nor ')}`;
    }
  }
  if (needs.includes('trigger') && answer.trigger === null) {
    return 'the answer carries no trigger sentence';
  }
  if (needs.includes('description')) {
    if (answer.description === null) return 'the answer carries no description';
    if (countCharacters(answer.description) >= DESCRIPTION_LIMIT) {
      return `the answer description is ${countCharacters(answer.description)} characters, at or over the ${DESCRIPTION_LIMIT} cap`;
    }
  }
  return null;
}

/**
 * One candidate as a row, carrying only the fields its needs asked for:
 * a description proposed for a file whose own description is already
 * short enough is dropped, because rewriting a description nobody asked
 * about is a change no review requested.
 */
export function proposalRow(
  candidate: ProposalCandidate,
  answer: ProposalAnswer | undefined,
): ProposalRow {
  if (answer === undefined) {
    return unanswered(candidate, 'the session answered nothing about this file');
  }

  const problem = answerProblem(candidate.needs, answer);
  if (problem !== null) return unanswered(candidate, problem);

  const wants = (need: ProposalNeed): boolean => candidate.needs.includes(need);
  const signal = answer.signal;
  return {
    path: candidate.relative,
    name: candidate.name,
    hash: candidate.hash,
    needs: candidate.needs,
    status: ANSWERED_ROW,
    prevents: wants('prevents')
      ? answer.prevents
      : null,
    signal: wants('prevents') && signal !== null && isSkillSignal(signal)
      ? signal
      : null,
    trigger: wants('trigger')
      ? answer.trigger
      : null,
    description: wants('description')
      ? answer.description
      : null,
    note: null,
  };
}

/**
 * One batch and the session that answered it, as a proposal file. An
 * unreadable answer leaves every row unanswered with the exit code in
 * its note; see the module note.
 */
export function batchProposalFile(
  batch: number,
  skills: string,
  candidates: readonly ProposalCandidate[],
  session: CapturedSession,
): ProposalFile {
  const answers = parseSessionAnswer(session.stdout);
  const rows = answers === null
    ? candidates.map((candidate) => unanswered(
      candidate,
      `the session answered nothing readable as YAML (exit ${session.exitCode})`,
    ))
    : candidates.map((candidate) => proposalRow(candidate, answers.get(candidate.relative)));

  return { status: DRAFT_FILE, batch, skills, exitCode: session.exitCode, rows };
}

/**
 * Runs one batch: builds the prompt, spawns the session through the
 * capturing door and answers the file that batch came to. The spawner
 * is a seam, so a test drives the pass with no session at all.
 */
export async function runProposalBatch(
  batch: number,
  candidates: readonly ProposalCandidate[],
  options: ProposalPassOptions,
): Promise<ProposalFile> {
  const session = await runClaudeCaptured(
    renderProposalPrompt(candidates),
    options.settingSources,
    options.flags ?? [],
    options.spawn,
  );
  return batchProposalFile(batch, options.root, candidates, session);
}

/**
 * The whole proposal pass over one skills directory: select, batch, one
 * session per batch, one file per batch written into
 * {@link ProposalPassOptions.backfillDir}.
 *
 * The sessions run one after another and never in parallel: twenty
 * concurrent `claude -p` sessions would interleave their output on the
 * operator's terminal and race each other for one rate limit.
 */
export async function runProposalPass(
  options: ProposalPassOptions,
): Promise<ProposalPassResult> {
  const candidates = selectProposals(options.root);
  const batches = batchCandidates(candidates);
  const written: WrittenProposal[] = [];

  if (batches.length > 0) mkdirSync(options.backfillDir, { recursive: true });
  for (const [index, batch] of batches.entries()) {
    const number = index + 1;
    const file = await runProposalBatch(number, batch, options);
    const path = proposalPath(options.backfillDir, number);
    writeFileSync(path, renderProposalFile(file), 'utf8');
    written.push({ path, file });
  }

  return { written, candidates: candidates.length };
}

/** An action that writes nothing. */
function inert(
  path: string,
  row: ProposalRow,
  kind: ProposalActionKind,
  detail: string,
): ProposalAction {
  return { path, relative: row.path, kind, detail, changes: {}, added: [] };
}

/**
 * The fields a row writes into its skill. `prevents` and `signal` go
 * together or not at all: a skill carrying one without the other fails
 * the schema.
 */
export function rowChanges(row: ProposalRow): Readonly<Record<string, unknown>> {
  const changes: Record<string, unknown> = {};
  if (row.description !== null) changes['description'] = row.description;
  if (row.prevents !== null && row.signal !== null) {
    changes['prevents'] = row.prevents;
    changes['signal'] = row.signal;
  }
  return changes;
}

/** The entries of `changes` the file does not already carry. */
function pendingChanges(
  data: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const pending: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (data[key] !== value) pending[key] = value;
  }
  return pending;
}

/** What the checker says about `path` now, as comparable lines. */
function checkLines(path: string, options: ProposalApplyOptions): readonly string[] {
  return failureLines(checkFile(path, 'skill', {
    projectRoot: options.projectRoot,
    pathDirs: options.pathDirs,
  }).issues);
}

/** Writes one answered row into its skill, checked before and after. */
function writeRow(
  path: string,
  row: ProposalRow,
  original: string,
  options: ProposalApplyOptions,
): ProposalAction {
  const document = readFrontmatterDocument(original);
  if (document === null) {
    return inert(path, row, 'refused', 'the file opens with no --- block holding a YAML mapping');
  }

  const changes = pendingChanges(document.data, rowChanges(row));
  if (Object.keys(changes).length === 0) {
    return inert(path, row, 'unchanged', 'every field the row proposes is already what the file carries');
  }

  const before = checkLines(path, options);
  writeFileSync(path, writeFrontmatter(document, mergeFrontmatter(document.data, changes)), 'utf8');
  const added = addedFailures(before, checkLines(path, options));
  if (added.length === 0) {
    return {
      path,
      relative: row.path,
      kind: 'applied',
      detail: `writes ${Object.keys(changes).join(', ')}`,
      changes,
      added: [],
    };
  }

  writeFileSync(path, original, 'utf8');
  return {
    path,
    relative: row.path,
    kind: 'refused',
    detail: `the written file fails a check it passed before, so it was put back — ${added.join('; ')}`,
    changes: {},
    added,
  };
}

/** One row applied: its refusals, then the write. */
function applyRow(
  root: string,
  row: ProposalRow,
  options: ProposalApplyOptions,
): ProposalAction {
  const path = join(root, ...row.path.split('/'));
  if (row.status === UNANSWERED_ROW) {
    return inert(path, row, 'unanswered', row.note ?? 'the row carries no answer');
  }
  if (row.prevents !== null && row.signal === null) {
    return inert(path, row, 'refused', 'the row carries prevents with no signal, which no skill may');
  }

  let original: string;
  try {
    original = readFileSync(path, 'utf8');
  } catch {
    return inert(path, row, 'refused', 'the file the row names is gone');
  }

  const hash = sourceHash(original);
  if (hash !== row.hash) {
    return inert(
      path,
      row,
      'refused',
      `the file changed since the proposal was written (row ${row.hash.slice(0, 12)}, file ${hash.slice(0, 12)})`,
    );
  }

  return writeRow(path, row, original, options);
}

/** Why every row of this file is refused, or null when none is. */
export function fileRefusal(file: ProposalFile, root: string): string | null {
  if (file.status !== REVIEWED_FILE) {
    return `the proposal file is still marked ${file.status}: review it and mark it ${REVIEWED_FILE}`;
  }
  return resolve(file.skills) === resolve(root)
    ? null
    : `the proposal file names the skills directory ${file.skills}, not ${root}`;
}

/** How many actions came to each kind. */
export function countProposalActions(
  actions: readonly ProposalAction[],
): Readonly<Record<ProposalActionKind, number>> {
  const counts = Object.fromEntries(
    PROPOSAL_ACTION_KINDS.map((kind) => [kind, 0]),
  ) as Record<ProposalActionKind, number>;

  for (const action of actions) counts[action.kind] += 1;
  return counts;
}

/**
 * Writes every reviewed row of `files` into the skills under `root`,
 * and answers what became of each row together with the trigger
 * sentences `./derive.ts` is to be handed.
 *
 * A trigger is answered for every row that was neither refused nor
 * unanswered, whether or not that row wrote a field: a skill whose only
 * need was a trigger writes nothing here and still has a sentence for
 * the derivation.
 */
export function applyProposals(
  files: readonly ProposalFile[],
  root: string,
  options: ProposalApplyOptions,
): ProposalApplyResult {
  const actions: ProposalAction[] = [];
  const triggers: Record<string, string> = {};

  for (const file of files) {
    const refusal = fileRefusal(file, root);
    for (const row of file.rows) {
      const action = refusal === null
        ? applyRow(root, row, options)
        : inert(join(root, ...row.path.split('/')), row, 'refused', refusal);
      actions.push(action);
      if (row.trigger !== null && action.kind !== 'refused' && action.kind !== 'unanswered') {
        triggers[row.name] = row.trigger;
      }
    }
  }

  return { actions, counts: countProposalActions(actions), triggers };
}
