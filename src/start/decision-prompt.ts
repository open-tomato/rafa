/**
 * The prompt a `rafa loop start --continue` decision session is handed:
 * the fixed contract in `src/continue-decision-prompt.md`, its slots
 * filled from the stopped task, and the criteria it decides by.
 *
 * ## Two bundled files
 *
 * `src/continue-decision-prompt.md` is the contract: the inputs, the
 * four strategies and the `rafa:decision` block `./decision-parse.ts`
 * reads. It is never overridable, so a project's edit cannot break the
 * parser. `src/continue-criteria.md` is the base criteria, drawn from a
 * survey of loop stops. The build copies both into `dist/` beside
 * `PROMPT.md`, and this module sits one directory below them in a
 * checkout, so {@link bundledCandidates} answers two paths, as
 * `../epic/verify-plan.ts` does for its template: the module's own
 * directory, which is `dist/` in a build, then its parent, which is
 * `src/` in a checkout.
 *
 * ## The project criteria
 *
 * `loop.continue.criteria` names a project file, read from the project
 * root unless absolute, on every decision, so an edit needs no rebuild.
 * `loop.continue.criteriaMode` says how it meets the base:
 *
 *   - `extend` (the default) appends it under the base, after
 *     {@link PROJECT_CRITERIA_HEADING}. A missing or blank file leaves
 *     the base alone, which is the state of every project that never
 *     wrote one.
 *   - `replace` uses it alone, and the base is never read. A missing or
 *     blank file is a refusal: replacing the criteria with nothing would
 *     leave the session choosing by none. {@link resolveContinueCriteria}
 *     answers the refusal as a value, so the caller raises it when the
 *     run starts rather than on its first decision.
 *
 * A path that exists and cannot be read, a directory say, is refused
 * under either mode: the person named a file, and reading past it would
 * hide that the criteria they wrote are not the ones in use.
 *
 * ## The render
 *
 * Text that comes from the plan or a report, the task, its holds and
 * the open tasks, is rendered inside a `text` fence one backtick longer
 * than any run in it, as `../epic/verify-plan.ts` fences a criterion,
 * and the contract tells the session to read it as data. Line numbers
 * are rendered counting from one, as an editor shows them, while
 * `TaskInfo.lineNum` counts from zero; `after` in a decision counts from
 * one too. Substitution is one pass with a replacer function, so a
 * `{{task}}` or a `$&` inside a value is inserted verbatim. A template
 * missing a slot throws, naming it.
 *
 * ## The retry sections
 *
 * The contract marks what it says of `retry` with two sections, each a
 * marker line opening and closing it: `<!-- retry -->` to
 * `<!-- /retry -->` (the strategy, the `approach` field and its example)
 * and `<!-- no-retry -->` to `<!-- /no-retry -->` (the line saying no
 * retry is offered). While a retry is left the first is kept and the
 * second dropped; with none left, the other way round. A decision is
 * made at a retry-safe stop only once its retries are spent, so there a
 * prompt offering `retry` would offer a strategy the loop reads as
 * `stop`. Sections are chosen before the slots are filled, so a marker
 * inside a value is inserted verbatim, and the marker lines never reach
 * the session.
 */
import type { ContinueCriteriaMode } from '../config-schema-loop-continue.js';
import type { TaskInfo } from '../utils/tracker.js';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fenceFor } from '../epic/verify-plan.js';

/** This module's own directory, where the bundled lookup starts. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The contract's file name, in `src/` and in `dist/` alike. */
export const DECISION_PROMPT_FILE = 'continue-decision-prompt.md';

/** The base criteria's file name, in `src/` and in `dist/` alike. */
export const CONTINUE_CRITERIA_FILE = 'continue-criteria.md';

/** The heading the project criteria sit under in `extend` mode. */
export const PROJECT_CRITERIA_HEADING = '### Project criteria';

/** The slots the contract carries, each written `{{name}}`. */
export const DECISION_PROMPT_SLOTS = [
  'plan',
  'line',
  'task',
  'holds',
  'retriesLeft',
  'openTasks',
  'criteria',
] as const;

/** One of {@link DECISION_PROMPT_SLOTS}. */
export type DecisionPromptSlot = (typeof DECISION_PROMPT_SLOTS)[number];

/** Any slot, for the one-pass replace. */
const SLOT_PATTERN = new RegExp(`\\{\\{(${DECISION_PROMPT_SLOTS.join('|')})\\}\\}`, 'gu');

/** A retry section, its opening and closing marker lines and its body; see the module note. */
const RETRY_SECTION = /^<!-- (retry|no-retry) -->\n([\s\S]*?)^<!-- \/\1 -->\n/gmu;

/** `template` with the retry section kept that `retriesLeft` asks for, the other dropped. */
function chooseRetrySections(template: string, retriesLeft: number): string {
  const kept = retriesLeft > 0
    ? 'retry'
    : 'no-retry';
  return template.replace(RETRY_SECTION, (_whole, section: string, body: string) => section === kept
    ? body
    : '');
}

/** What a slot with no hold reads. */
const NO_HOLDS = '(no reason was recorded)';

/** What a slot with no open task reads. */
const NO_OPEN_TASKS = '(no open task is left)';

/** A task as the prompt shows it: its text and its zero-based tracker line. */
export type PromptTask = Pick<TaskInfo, 'task' | 'lineNum'>;

/** Where the project criteria are and how they meet the base. */
export interface CriteriaSettings {
  /** The project root a relative path is read from. */
  readonly root: string;
  /** `loop.continue.criteria`. */
  readonly path: string;
  /** `loop.continue.criteriaMode`. */
  readonly mode: ContinueCriteriaMode;
}

/** The criteria a decision is made by, or why there are none. */
export type CriteriaReading =
  | {
    readonly ok: true;
    /** The criteria text the `{{criteria}}` slot takes, trailing whitespace off. */
    readonly criteria: string;
    /** The project file's absolute path when it exists, or null. */
    readonly project: string | null;
  }
  | {
    readonly ok: false;
    /** One line naming the key and the path. */
    readonly refusal: string;
  };

/** What the decision prompt is built from. */
export interface DecisionPromptInput {
  /** The plan's path, as the run names it. */
  readonly plan: string;
  /** The task that stopped. */
  readonly task: PromptTask;
  /** Why it stopped: the report's holds, the blocker, the failed step. */
  readonly holds: readonly string[];
  /** The retries this run has left. */
  readonly retriesLeft: number;
  /** The plan's open tasks, the stopped one included, in tracker order. */
  readonly openTasks: readonly PromptTask[];
  /** The criteria {@link resolveContinueCriteria} answered. */
  readonly criteria: string;
}

/** The two paths a bundled `file` may sit at; see the module note. */
export function bundledCandidates(file: string, moduleDir: string = MODULE_DIR): readonly string[] {
  return [join(moduleDir, file), join(dirname(moduleDir), file)];
}

/**
 * A bundled file's text, from the first of {@link bundledCandidates}
 * that exists.
 *
 * @throws Error naming both paths when neither exists.
 */
export function readBundledFile(file: string, moduleDir: string = MODULE_DIR): string {
  const candidates = bundledCandidates(file, moduleDir);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`loop continue: ${file} is missing: no file at ${candidates.join(' or ')}`);
  }
  return readFileSync(found, 'utf8');
}

/** The project file's text, null when it is missing, or the refusal of a path that cannot be read. */
function readProjectFile(path: string): { text: string | null } | { refusal: string } {
  if (!existsSync(path)) return { text: null };
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    return { refusal: `loop.continue.criteria cannot be read at ${path}: ${message}` };
  }
}

/**
 * The criteria a decision is made by, under the mode's rule in the
 * module note. A refusal is answered, never thrown.
 *
 * @throws Error when `extend` needs the bundled base and it is missing.
 */
export function resolveContinueCriteria(
  settings: CriteriaSettings,
  moduleDir: string = MODULE_DIR,
): CriteriaReading {
  const path = resolve(settings.root, settings.path);
  const read = readProjectFile(path);
  if ('refusal' in read) return { ok: false, refusal: read.refusal };

  const projectText = read.text?.trim() ?? '';
  const project = read.text === null
    ? null
    : path;

  if (settings.mode === 'replace') {
    if (read.text === null) {
      return {
        ok: false,
        refusal: `loop.continue.criteriaMode is replace, and loop.continue.criteria names no file at ${path}`,
      };
    }
    if (projectText === '') {
      return { ok: false, refusal: `loop.continue.criteriaMode is replace, and ${path} holds no criteria` };
    }
    return { ok: true, criteria: projectText, project };
  }

  const base = readBundledFile(CONTINUE_CRITERIA_FILE, moduleDir).trimEnd();
  const criteria = projectText === ''
    ? base
    : `${base}\n\n${PROJECT_CRITERIA_HEADING}\n\n${projectText}`;
  return { ok: true, criteria, project };
}

/** `text` inside a `text` fence longer than any backtick run in it. */
function fenced(text: string): string {
  const fence = fenceFor(text);
  return `${fence}text\n${text}\n${fence}`;
}

/** A zero-based line as the prompt counts it, from one. */
function shownLine(lineNum: number): string {
  return String(lineNum + 1);
}

/** The open tasks, one `line N: text` each, fenced; or the line saying none is left. */
function renderOpenTasks(tasks: readonly PromptTask[]): string {
  if (tasks.length === 0) return NO_OPEN_TASKS;
  return fenced(tasks.map((task) => `line ${shownLine(task.lineNum)}: ${task.task}`).join('\n'));
}

/**
 * The decision session's prompt: `template` with its retry sections
 * chosen by `input.retriesLeft` and every slot filled from `input`, in
 * one pass.
 *
 * @throws Error naming the first slot `template` does not carry.
 */
export function renderDecisionPrompt(template: string, input: DecisionPromptInput): string {
  const missing = DECISION_PROMPT_SLOTS.find((slot) => !template.includes(`{{${slot}}}`));
  if (missing !== undefined) {
    throw new Error(`loop continue: the decision prompt carries no {{${missing}}} slot`);
  }

  const values: Readonly<Record<DecisionPromptSlot, string>> = {
    plan: input.plan,
    line: shownLine(input.task.lineNum),
    task: fenced(input.task.task),
    holds: input.holds.length === 0
      ? NO_HOLDS
      : fenced(input.holds.join('\n')),
    retriesLeft: String(input.retriesLeft),
    openTasks: renderOpenTasks(input.openTasks),
    criteria: input.criteria,
  };
  return chooseRetrySections(template, input.retriesLeft)
    .replace(SLOT_PATTERN, (_whole, slot: DecisionPromptSlot) => values[slot]);
}

/**
 * The decision session's prompt from the bundled contract.
 *
 * @throws Error when the contract is missing or carries no slot it needs.
 */
export function buildDecisionPrompt(input: DecisionPromptInput, moduleDir: string = MODULE_DIR): string {
  return renderDecisionPrompt(readBundledFile(DECISION_PROMPT_FILE, moduleDir), input);
}
