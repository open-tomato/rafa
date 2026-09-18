/**
 * One batch of the proposal pass: which skills a session is asked
 * about, what it is asked, and what its answer reads as.
 *
 * `./propose.ts` is the pass and `./proposal-file.ts` is the file the
 * pass writes. This module is the round trip in the middle, and it is
 * the only place that decides three things:
 *
 *   - **Which files are candidates at all.** {@link candidateNeeds}
 *     answers what one skill is short of, and a skill short of nothing
 *     never reaches a session. The post-demotion corpus is around two
 *     hundred skills and the needs are what keeps the sessions
 *     proportional to the gaps rather than to the corpus.
 *   - **What the session is told.** {@link PROPOSAL_PROMPT_HEADER} is a
 *     TypeScript constant rather than a markdown file, so the build's
 *     copy list and `src/tests/package-build.test.ts` stay as they are.
 *   - **What counts as an answer.** {@link parseSessionAnswer} reads
 *     the session's whole stdout and answers null rather than a guess;
 *     `./propose.ts` turns that null into a batch of unanswered rows.
 *
 * ## The three needs
 *
 * `prevents` is needed when the file carries no `prevents`, or carries
 * one whose `signal` is missing or outside the two the schema allows —
 * the pair is written together or not at all, so half of it is a gap.
 *
 * `trigger` is needed when the body has no "When to Use" section for
 * `./derive.ts` to take a first sentence from. That reading is
 * `triggerSentence`'s, imported rather than repeated, so the sentence
 * the session is asked for is exactly the one the derivation would
 * have taken had the section been there.
 *
 * `description` is needed when the existing one is at or over
 * `DESCRIPTION_LIMIT`. The DoD asks every skill to pass with no
 * `--fix`, and a description over the cap is a failure nothing
 * deterministic can repair: shortening prose is the same judgement as
 * the other two, so it rides along in the same session rather than in
 * a pass of its own.
 *
 * ## The body is cut, and the reading that justifies it
 *
 * A prompt carrying twenty whole bodies would be far past what a
 * session reads to its end, and what a skill prevents is decided in a
 * body's first screens: the "When to Use" and problem sections sit at
 * the top of every shape in the corpus. So each body reaches the
 * prompt cut at {@link PROMPT_BODY_LIMIT} characters, with a marker
 * saying so, and a session that needs more can open the file — its
 * path is in the section.
 *
 * ## Why every fenced block is tried
 *
 * A session under `-p` writes prose around its answer as often as not,
 * and a model told to answer in a fence sometimes writes two. So
 * {@link parseSessionAnswer} tries each fenced block in the order it
 * was written and the whole output last, and takes the first that
 * holds a non-empty {@link PROPOSAL_ANSWER_KEY} list. A block that
 * parses but carries no such list is passed over rather than accepted
 * empty, because an empty answer and no answer are the same reading
 * and both have to leave every row unanswered.
 */
import type { ProposalNeed } from './proposal-file.js';
import type { LayoutEntry } from '../check/layout.js';

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { SKILL_FILE, scanLayout } from '../check/layout.js';
import { sourceHash } from '../demote/report.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';
import { countCharacters, DESCRIPTION_LIMIT } from '../schema/skill.js';

import { triggerSentence } from './derive.js';
import {
  filledStringAt,
  isSkillSignal,
  isYamlMapping,
  readYamlMapping,
  stringAt,
} from './proposal-file.js';

/** How many files one session is asked about. */
export const PROPOSAL_BATCH_SIZE = 20;

/** How much of a body reaches the prompt, in codepoints. */
export const PROMPT_BODY_LIMIT = 4000;

/** The key a session's YAML block carries its answers under. */
export const PROPOSAL_ANSWER_KEY = 'proposals';

/** One skill the pass has something to ask about. */
export interface ProposalCandidate {
  /** The file, absolute. */
  readonly path: string;
  /** Its path relative to the skills directory, in posix form. */
  readonly relative: string;
  /** The skill name its directory implies. */
  readonly name: string;
  /** sha256 of the file as the pass read it. */
  readonly hash: string;
  /** Its `description`, or the empty string where it carries none. */
  readonly description: string;
  /** What it is asked for, in `PROPOSAL_NEEDS` order. */
  readonly needs: readonly ProposalNeed[];
  /** Its body, which the prompt is built from. */
  readonly body: string;
}

/** What a session said about one file, before anything is checked. */
export interface ProposalAnswer {
  /** The failure the skill heads off, or null. */
  readonly prevents: string | null;
  /** Whether that failure announces itself, unchecked, or null. */
  readonly signal: string | null;
  /** The trigger sentence, or null. */
  readonly trigger: string | null;
  /** A replacement description, unchecked against the cap, or null. */
  readonly description: string | null;
}

/**
 * What every session is told, before its batch. See the module note on
 * why it lives here rather than in a markdown file beside it.
 */
export const PROPOSAL_PROMPT_HEADER = `You are filling in frontmatter fields for a batch of Claude Code skills.

Each file below is given with its path, its name, its current description,
what it needs, and its body. Answer about each one with the fields its
needs line asks for:

  - prevents: the failure this skill heads off, as one phrase naming what
    goes wrong when nobody follows it. Not what the skill does.
  - signal: loud when that failure announces itself (an error, a red test,
    a refused command), silent when it passes for success.
  - trigger: one sentence saying the situation the skill applies to,
    written to open a When to Use section.
  - description: a replacement description under ${DESCRIPTION_LIMIT} characters, asked for
    only where the existing one is at or over that cap.

Rules:

  - Use each path exactly as it is listed below.
  - Leave a file out rather than guessing about it. A file you leave out
    is recorded as unanswered and asked again; a guess is written into
    somebody else's skill.
  - Answer with one fenced YAML block, and nothing after it.

The block:

\`\`\`yaml
${PROPOSAL_ANSWER_KEY}:
  - path: <the path as listed>
    prevents: <one phrase>
    signal: loud
    trigger: <one sentence>
    description: <only where the needs line says description>
\`\`\`

The files:
`;

/** What this file is asked for, in `PROPOSAL_NEEDS` order. */
export function candidateNeeds(
  data: Readonly<Record<string, unknown>>,
  body: string,
): readonly ProposalNeed[] {
  const needs: ProposalNeed[] = [];
  const prevents = filledStringAt(data, 'prevents');
  const signal = filledStringAt(data, 'signal');
  if (prevents === null || signal === null || !isSkillSignal(signal)) needs.push('prevents');
  if (triggerSentence(body) === '') needs.push('trigger');
  if (countCharacters(stringAt(data, 'description') ?? '') >= DESCRIPTION_LIMIT) {
    needs.push('description');
  }
  return needs;
}

/** `path` relative to `root`, in the posix form a row spells it in. */
function posixRelative(root: string, path: string): string {
  return relative(root, path).split('\\')
    .join('/');
}

/** One scanned entry as a candidate, or null when it is none. */
function readCandidate(root: string, entry: LayoutEntry): ProposalCandidate | null {
  if (!entry.isFile || entry.name === null) return null;
  if (!entry.path.endsWith(SKILL_FILE)) return null;

  let text: string;
  try {
    text = readFileSync(entry.path, 'utf8');
  } catch {
    return null;
  }

  const document = readFrontmatterDocument(text);
  if (document === null) return null;

  const needs = candidateNeeds(document.data, document.body);
  return needs.length === 0
    ? null
    : {
      path: entry.path,
      relative: posixRelative(root, entry.path),
      name: entry.name,
      hash: sourceHash(text),
      description: stringAt(document.data, 'description') ?? '',
      needs,
      body: document.body,
    };
}

/**
 * Every skill under `root` the pass has something to ask about, in path
 * order. A missing directory THROWS, as `scanLayout` does. A file that
 * cannot be read or carries no frontmatter is passed over: the checker
 * is what reports it, and a session cannot propose for a file whose
 * frontmatter nothing can write into.
 */
export function selectProposals(root: string): readonly ProposalCandidate[] {
  const candidates: ProposalCandidate[] = [];
  for (const entry of scanLayout(root, 'skill').entries) {
    const candidate = readCandidate(root, entry);
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}

/** `candidates` in runs of {@link PROPOSAL_BATCH_SIZE}, order kept. */
export function batchCandidates(
  candidates: readonly ProposalCandidate[],
): readonly (readonly ProposalCandidate[])[] {
  const batches: (readonly ProposalCandidate[])[] = [];
  for (let start = 0; start < candidates.length; start += PROPOSAL_BATCH_SIZE) {
    batches.push(candidates.slice(start, start + PROPOSAL_BATCH_SIZE));
  }
  return batches;
}

/** `body` cut to {@link PROMPT_BODY_LIMIT} codepoints, with a marker where it was cut. */
function cutBody(body: string): string {
  if (countCharacters(body) <= PROMPT_BODY_LIMIT) return body;

  const kept = Array.from(body).slice(0, PROMPT_BODY_LIMIT)
    .join('');
  return `${kept}\n\n[body cut at ${PROMPT_BODY_LIMIT} characters]`;
}

/** One candidate as the prompt names it. */
function promptSection(candidate: ProposalCandidate, index: number, total: number): string {
  return [
    `--- file ${index + 1} of ${total} ---`,
    `path: ${candidate.relative}`,
    `name: ${candidate.name}`,
    `description: ${candidate.description}`,
    `needs: ${candidate.needs.join(', ')}`,
    'body:',
    cutBody(candidate.body),
    `--- end of file ${index + 1} ---`,
    '',
  ].join('\n');
}

/** The whole prompt one batch is asked with. */
export function renderProposalPrompt(batch: readonly ProposalCandidate[]): string {
  const sections = batch.map(
    (candidate, index) => promptSection(candidate, index, batch.length),
  );
  return `${PROPOSAL_PROMPT_HEADER}\n${sections.join('\n')}`;
}

/** Every text in `stdout` that might be the answer, fenced blocks first. */
function yamlCandidates(stdout: string): readonly string[] {
  const texts: string[] = [];
  const fence = /^[ \t]*```[ \t]*[a-z]*[ \t]*\r?\n([\s\S]*?)^[ \t]*```/gm;
  for (const match of stdout.matchAll(fence)) texts.push(match[1] ?? '');
  texts.push(stdout);
  return texts;
}

/** One answer mapping read, with the path it names, or null. */
function answerEntry(value: unknown): readonly [string, ProposalAnswer] | null {
  if (!isYamlMapping(value)) return null;
  const path = filledStringAt(value, 'path');
  if (path === null) return null;

  return [path, {
    prevents: filledStringAt(value, 'prevents'),
    signal: filledStringAt(value, 'signal'),
    trigger: filledStringAt(value, 'trigger'),
    description: filledStringAt(value, 'description'),
  }];
}

/** The answers one YAML text holds, keyed by path, empty when it holds none. */
function answersIn(text: string): ReadonlyMap<string, ProposalAnswer> {
  const answers = new Map<string, ProposalAnswer>();
  const parsed = readYamlMapping(text);
  const rows = parsed?.[PROPOSAL_ANSWER_KEY];
  if (!Array.isArray(rows)) return answers;

  for (const row of rows) {
    const entry = answerEntry(row);
    if (entry !== null) answers.set(entry[0], entry[1]);
  }
  return answers;
}

/**
 * What a session said, keyed by the path each answer names, or null
 * when its output holds nothing this can read. See the module note on
 * why every fenced block is tried.
 */
export function parseSessionAnswer(stdout: string): ReadonlyMap<string, ProposalAnswer> | null {
  for (const text of yamlCandidates(stdout)) {
    const answers = answersIn(text);
    if (answers.size > 0) return answers;
  }
  return null;
}
