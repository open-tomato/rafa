/**
 * The plan's conventions section: a `## Conventions` section in the
 * open pull request's body, one line per `convention` entry the triage
 * routed `pr-body` (`triage/kind-route.ts`). A file too long or a name
 * off the pattern is the reviewer's to weigh beside the change, not an
 * issue of its own, so it reaches no tracker. {@link writeConventionLines}
 * writes it once, after the delivery, from `start/wrap-up-run.ts`.
 *
 * ## The lines
 *
 * The plan's `bug_routes` rows (`readBugRoutesForPlan`,
 * `effort/store/bug-routes.ts`) routed `pr-body` are the lines, in
 * append order, one per text: two rows that read as the same line, from
 * two sessions of one task, are one. Each is {@link conventionLine},
 * `- <what>`. A plan with no such row has no section: no provider is
 * read, no `gh` spawned and nothing printed.
 *
 * `what` is a session's text, so each line is redacted before it is
 * built, as `start/follow-ups.ts` redacts its own: of the run's named
 * secrets first, then of local paths under the project root, the
 * checkout and the home directory. It is then escaped as
 * `escapeBlockerText` (`utils/tracker.ts`) escapes a blocker, so no
 * entry opens a second line, an HTML comment or a heading of its own.
 * An entry whose `security` flag was true or missing never reaches a
 * `pr-body` row: it took the private channel (`triage/kind-route.ts`).
 *
 * ## The section
 *
 * {@link bodyWithConventions} builds the body. With no `## Conventions`
 * line in it, the section goes below the body's last paragraph. With
 * one, the section runs to the next heading of level one or two, and
 * the lines it does not already hold, each compared with every section
 * line trimmed, go below its last line. A section holding every line
 * answers the body unchanged.
 *
 * ## The write
 *
 * The body is written through `writeBodyWith` (`./release-body.ts`):
 * the provider reading first, so a `none` provider spawns no `gh` and
 * prints the lines in one line instead, then the read-modify-write
 * against the branch's open pull request, which leaves a body the
 * section would not change alone, so a re-run writes nothing. The
 * provider reading is the run's, handed in by `start/wrap-up-run.ts`.
 *
 * ## A failure never stops the run
 *
 * {@link writeConventionLines} never rejects. A store that cannot be
 * read, a pull request that cannot be found, read or edited, and
 * anything thrown are each one warning line, redacted. The rows stay
 * in the store, so the next wrap-up of the plan writes them again.
 */
import type { BodyAnnouncer, ReleaseBodySeams, ReleaseBodyWrite } from './release-body.js';
import type { SecretEnvironment } from '../triage/triage.js';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { BugRouteRow } from '@open-tomato/rafa/store/bug-routes';

import { homedir } from 'node:os';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { activeOutput } from '@open-tomato/rafa/core/output';
import { escapeBlockerText } from '@open-tomato/rafa/core/plan';
import { readBugRoutesForPlan } from '@open-tomato/rafa/store/bug-routes';

import { localPathRedactor } from '../triage/local-paths.js';
import { namedSecrets, redactSecrets } from '../triage/triage.js';

import { RELEASE_BODY_SEAMS, writeBodyWith } from './release-body.js';

/** The heading the section opens with. */
export const CONVENTIONS_HEADING = '## Conventions';

/** What every line this module prints opens with, after its indent. */
const LINE_PREFIX = 'Conventions: ';

/** The indent every printed line takes, as the dispatch indents its own. */
const INDENT = '   ';

/** A heading that closes the section: level one or two. */
const SECTION_END = /^#{1,2}\s/;

/** One line of the section, `- <what>`, `what` escaped; redacting is the caller's. */
export function conventionLine(what: string): string {
  return `- ${escapeBlockerText(what.trim())}`;
}

/**
 * The lines of `rows` routed `pr-body`, each redacted by `redact` and
 * built by {@link conventionLine}, in row order, one per text.
 */
export function conventionLines(
  rows: readonly BugRouteRow[],
  redact: (text: string) => string = (text) => text,
): string[] {
  const lines = rows
    .filter((row) => row.route === 'pr-body')
    .map((row) => conventionLine(redact(row.what)));
  return [...new Set(lines)];
}

/** `body` and `paragraph` as two paragraphs, or `paragraph` alone. */
function appended(body: string, paragraph: string): string {
  const kept = body.trimEnd();
  return kept === ''
    ? `${paragraph}\n`
    : `${kept}\n\n${paragraph}\n`;
}

/** The index of the line after the section opened at `heading`. */
function sectionEnd(lines: readonly string[], heading: number): number {
  const next = lines.findIndex((line, index) => index > heading && SECTION_END.test(line));
  return next < 0
    ? lines.length
    : next;
}

/** The index of the section's last non-blank line, the heading's when it has none. */
function lastFilled(lines: readonly string[], heading: number, end: number): number {
  let last = heading;
  for (let index = heading + 1; index < end; index += 1) {
    if (lines[index]?.trim() !== '') last = index;
  }
  return last;
}

/**
 * `body` with `lines` in its `## Conventions` section; see the module
 * note. Answers `body` itself, unchanged, when the section already
 * holds every line or there is none to write.
 */
export function bodyWithConventions(body: string, lines: readonly string[]): string {
  if (lines.length === 0) return body;
  const held = body.split(/\r?\n/);
  const heading = held.findIndex((line) => line.trim() === CONVENTIONS_HEADING);
  if (heading < 0) return appended(body, `${CONVENTIONS_HEADING}\n\n${lines.join('\n')}`);

  const end = sectionEnd(held, heading);
  const section = held.slice(heading + 1, end).map((line) => line.trim());
  const missing = lines.filter((line) => !section.includes(line));
  if (missing.length === 0) return body;

  const last = lastFilled(held, heading, end);
  const lead = last === heading
    ? ['']
    : [];
  const tail = end < held.length && last + 1 === end
    ? ['']
    : [];
  return [...held.slice(0, last + 1), ...lead, ...missing, ...tail, ...held.slice(last + 1)].join('\n');
}

/** The config keys the write reads: the secrets its lines are redacted of. */
export type ConventionBodyConfig = Pick<RafaConfig, 'prerequisitesRequired' | 'prerequisitesOptional'>;

/** What {@link writeConventionLines} writes, as `runWrapUp` hands it. */
export interface ConventionBodyInput {
  /** The project root, holding `.rafa/`: the store is read there. */
  readonly repoRoot: string;
  /** The run's checkout: the provider is resolved and asked there, and its paths are redacted. */
  readonly checkout: string;
  /** The run's head branch, whose open pull request carries the section. */
  readonly branch: string;
  /** The run's resolved config. */
  readonly settings: ConventionBodyConfig;
  /** The plan's stub, or null for a plan whose file name carries none, which has no section. */
  readonly planStub: string | null;
}

/** The effects {@link writeConventionLines} reaches through; each defaults to the real one. */
export interface ConventionBodySeams extends Partial<ReleaseBodySeams> {
  /** Reads a plan's rows. `readBugRoutesForPlan` when left out. */
  readonly readRows?: (repoRoot: string, planStub: string) => readonly BugRouteRow[];
  /** The environment the secrets' values are read from. `process.env` when left out. */
  readonly env?: SecretEnvironment;
  /** The home directory lines are redacted of. `homedir()` when left out. */
  readonly home?: string;
}

/** What {@link writeConventionLines} did with the plan's lines. */
export type ConventionBodyResult =
  /** No row of the plan is routed `pr-body`, or the run has no plan stub; nothing was done. */
  | { readonly action: 'none' }
  /** The lines went to the body writer, which answered `body`. */
  | { readonly action: 'written'; readonly lines: readonly string[]; readonly body: ReleaseBodyWrite }
  /** The rows could not be read, or the write threw; nothing more was tried. */
  | { readonly action: 'failed'; readonly problem: string };

/** `1 line` or `<n> lines`. */
function lineCount(count: number): string {
  return count === 1
    ? '1 line'
    : `${String(count)} lines`;
}

/** The announcer the body writer prints through once a provider answered. */
function announcerFor(redact: (text: string) => string): BodyAnnouncer {
  return (write, count) => {
    const out = activeOutput();
    if (write.problem !== null) {
      out.warn(`${INDENT}${LINE_PREFIX}the section was not written, and the next wrap-up tries again: ${redact(write.problem)}`);
      return;
    }
    if (write.already) {
      out.info(`${INDENT}${LINE_PREFIX}pull request #${String(write.number)} already holds every line.`);
      return;
    }
    out.info(`${INDENT}${LINE_PREFIX}added ${lineCount(count)} to the body of pull request #${String(write.number)}.`);
  };
}

/** Reads and writes the plan's lines; what {@link writeConventionLines} runs inside its catch. */
async function writeLines(
  input: ConventionBodyInput,
  seams: ConventionBodySeams,
  redact: (text: string) => string,
): Promise<ConventionBodyResult> {
  const stub = input.planStub;
  if (stub === null) return { action: 'none' };
  const rows = (seams.readRows ?? readBugRoutesForPlan)(input.repoRoot, stub);
  const lines = conventionLines(rows, redact);
  if (lines.length === 0) return { action: 'none' };

  const bodySeams: ReleaseBodySeams = {
    pulls: seams.pulls ?? RELEASE_BODY_SEAMS.pulls,
    readProvider: seams.readProvider ?? RELEASE_BODY_SEAMS.readProvider,
  };
  const body = await writeBodyWith(
    bodySeams,
    { repoRoot: input.checkout, branch: input.branch },
    lines,
    (read) => bodyWithConventions(read, lines),
    announcerFor(redact),
  );
  return { action: 'written', lines, body };
}

/**
 * Writes the plan's `pr-body` lines into the `## Conventions` section
 * of the open pull request's body, or prints them under a `none`
 * provider. See the module note. Never rejects.
 */
export async function writeConventionLines(
  input: ConventionBodyInput,
  seams: ConventionBodySeams = {},
): Promise<ConventionBodyResult> {
  const secrets = namedSecrets(input.settings, seams.env ?? process.env);
  const local = localPathRedactor([input.repoRoot, input.checkout], seams.home ?? homedir());
  const redact = (text: string): string => local(redactSecrets(text, secrets));
  try {
    return await writeLines(input, seams, redact);
  } catch (error) {
    const problem = `the plan's conventions were not written: ${messageOf(error)}`;
    activeOutput().warn(`${INDENT}${LINE_PREFIX}${redact(problem)}`);
    return { action: 'failed', problem };
  }
}
