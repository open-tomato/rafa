/**
 * The plan files of a plan directory, read into the stage links the
 * bug-fix join takes (`pairBugFixes` in
 * `packages/rafa-inventory/src/report/bug-fix-pairs.ts`).
 *
 * {@link readPlanStageLinks} reads every `PLAN-*.md` directly under the
 * directory, in file-name order, through `parsePlan`, and answers one
 * {@link PlanStageLink} per `# Stage:` heading:
 *
 *   - `stub` is the plan's `rafa:plan` stub, else the one its file name
 *     carries (`planStubFromPath`);
 *   - `stage` is the heading's name and `context` the body of the
 *     stage's `rafa:stage-context` block, or null without one;
 *   - `tasks` are its task lines, whatever their checkbox, as the
 *     dispatch quotes them and the store's `task_line` holds them: the
 *     text after the checkbox, declaration included, with the trailing
 *     `<!-- blocked: ... -->` comment the tracker adds taken off.
 *
 * A `PLAN_TRACKER-*.md` is not read: the plan file is the one the
 * stage contexts are written in, and the tracker is the loop's copy.
 *
 * ## A fenced example is no task
 *
 * `parsePlan` reads a task line inside a fence that is no `rafa:*`
 * block fence-blind, as the dispatcher does, so a plan illustrating its
 * own format would hand the join a task such as `- [ ] Fix #12` that no
 * loop ran. Here a line inside any fenced code block is never a task.
 * Fences are found by the rules `readRafaBlocks` reads them by
 * (CommonMark's, at the top level): three or more backticks or tildes
 * after at most three spaces, closed by the same character at least as
 * many times, a fence never closed running to the end of the document.
 *
 * ## A file passed over
 *
 * `parsePlan` never throws, so a file fails to parse here when it cannot
 * be read, when it holds a `rafa:*` block it never closes (the block
 * takes every line after its fence, so the stages below it would read
 * short of their tasks), or when neither its header nor its file name
 * gives a stub. Each such file is passed over with one warning, and
 * the other files are read. A directory that does not exist holds no
 * plan and answers the empty list without a warning.
 */
import type { PlanModel } from '@open-tomato/rafa/core/plan';
import type { PlanStageLink } from '@open-tomato/rafa-inventory';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { activeLogger } from '@open-tomato/rafa/adapters/logger/active';
import { parsePlan, planStubFromPath } from '@open-tomato/rafa/core/plan';

/** What {@link readPlanStageLinks} can be handed. */
export interface PlanStageLinkOptions {
  /**
   * Where a passed-over file's one warning goes. The default writes a
   * `warn` entry to the active logger.
   */
  readonly warn?: (message: string) => void;
}

/** A plan file's name. */
const PLAN_FILE = /^PLAN-.+\.md$/;

/** A line opening a fence: its indent and its run. */
const FENCE_RUN = /^( {0,3})(`{3,}|~{3,})/;

/** A line that can close a fence: its run alone. */
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** One plan file, read, or why it was passed over. */
type PlanReading =
  | { readonly links: readonly PlanStageLink[] }
  | { readonly skipped: string };

/** Writes `message` as a `warn` entry of the active logger. */
function warnPassedOver(message: string): void {
  activeLogger().child({ module: 'learning', action: 'plan-stage-links' })
    .log({ level: 'warn', message });
}

/** The error's message, or the value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * The zero-based indexes of every line inside a fenced code block,
 * fences included, over the same `split('\n')` `parsePlan` numbers by.
 */
function fencedLines(markdown: string): ReadonlySet<number> {
  const lines = markdown.split('\n').map((line) => (line.endsWith('\r')
    ? line.slice(0, -1)
    : line));
  const fenced = new Set<number>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = FENCE_RUN.exec(line);
    const run = match?.[2];
    const info = line.slice(match?.[0].length ?? 0);
    if (run === undefined || (run.startsWith('`') && info.includes('`'))) {
      index += 1;
      continue;
    }
    let closing = index + 1;
    while (closing < lines.length && !closesFence(lines[closing] ?? '', run)) closing += 1;
    for (let covered = index; covered <= Math.min(closing, lines.length - 1); covered += 1) {
      fenced.add(covered);
    }
    index = closing + 1;
  }
  return fenced;
}

/** True when `line` closes the fence whose run is `opener`. */
function closesFence(line: string, opener: string): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined
    && run.charAt(0) === opener.charAt(0)
    && run.length >= opener.length;
}

/** The plan's links, one per stage, its fenced task lines left out. */
function stageLinks(stub: string, model: PlanModel, fenced: ReadonlySet<number>): PlanStageLink[] {
  return model.stages.map((stage, index) => ({
    stub,
    stage: stage.name,
    context: stage.context,
    tasks: model.tasks
      .filter((task) => task.stage === index && !fenced.has(task.lineNum))
      .map((task) => task.task),
  }));
}

/** One plan file's links, or why it is passed over. */
async function readPlanFile(path: string, name: string): Promise<PlanReading> {
  let markdown: string;
  try {
    markdown = await readFile(path, 'utf8');
  } catch (error) {
    return { skipped: `could not be read: ${messageOf(error)}` };
  }
  const model = parsePlan(markdown);
  const unclosed = model.issues.find((issue) => issue.reason === 'unclosed-block');
  if (unclosed !== undefined) {
    return { skipped: `holds a rafa block never closed, opened at line ${unclosed.line}` };
  }
  const stub = model.header.stub ?? planStubFromPath(name);
  if (stub === null) {
    return { skipped: 'names no stub in its rafa:plan block or its file name' };
  }
  return { links: stageLinks(stub, model, fencedLines(markdown)) };
}

/** The plan file names directly under `plansDir`, sorted, or none without the directory. */
async function planFileNames(plansDir: string): Promise<string[]> {
  try {
    const names = await readdir(plansDir);
    return names.filter((name) => PLAN_FILE.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * One {@link PlanStageLink} per stage of every `PLAN-*.md` directly
 * under `plansDir`, in file-name order and then in source order. A file
 * that fails to parse is passed over with one warning; see the module
 * note. Rejects only when the directory exists and cannot be listed.
 */
export async function readPlanStageLinks(
  plansDir: string,
  options: PlanStageLinkOptions = {},
): Promise<PlanStageLink[]> {
  const warn = options.warn ?? warnPassedOver;
  const links: PlanStageLink[] = [];
  for (const name of await planFileNames(plansDir)) {
    const reading = await readPlanFile(join(plansDir, name), name);
    if ('skipped' in reading) {
      warn(`Plan file ${name} passed over: it ${reading.skipped}.`);
      continue;
    }
    links.push(...reading.links);
  }
  return links;
}
