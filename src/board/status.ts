/**
 * What the board of a GitHub repository holds, READ and never written:
 * the six labels, the spec issue template, the Roadmap issue and
 * `roadmap.issue`, each present or missing. `rafa doctor` prints these
 * rows and names `rafa init --board` as the fix
 * (`.rafa/specs/rafa-20-pr-commands.md`, "`rafa init` sets up the board").
 *
 * `./setup.ts` is the half that MAKES those parts, and this module is
 * the half that only looks. They are separate because a checker that
 * ran the maker with a "don't write" flag would be one flag away from
 * writing during `rafa doctor`, which starts nothing and stores
 * nothing; here there is no write to reach.
 *
 * ## The rows answer what `rafa init --board` would do
 *
 * Each row is decided the way {@link setUpBoard} decides its part, minus
 * the write, so the fix a row names is a fix that would change that row:
 *
 *   - A label is present when the repository carries one of that name,
 *     however either spells its case, and missing otherwise — the same
 *     listing and the same fold, through {@link listBoardLabels} and
 *     {@link missingBoardLabels}.
 *   - The template is present when a file is at
 *     {@link SPEC_TEMPLATE_PATH}, which is what makes `init --board`
 *     leave it alone.
 *   - The Roadmap issue is present when `roadmap.issue` names one, else
 *     when one open issue is titled {@link ROADMAP_TITLE}, in that
 *     order and for the reason `./setup.ts` gives: the config is the
 *     record, the search index is not.
 *   - `roadmap.issue` is present only when the config names an issue.
 *     A repository whose Roadmap issue is open and unnamed reads
 *     `present` and `missing` on those two rows, which is exactly the
 *     pair `rafa init --board` would turn into one write.
 *
 * ## Why there is a third outcome
 *
 * A reading that failed is `unknown`, not `missing`. `gh label list`
 * that could not reach GitHub says nothing about whether the labels are
 * there, and reporting that silence as `missing` would be a checker
 * inventing a finding; two open Roadmap issues are the same shape of
 * answer, one `./roadmap.ts` already refuses rather than picks. Each
 * `unknown` row carries the sentence that produced it.
 *
 * ## Nothing here writes, and nothing spawns
 *
 * Two `gh` commands at most — the label listing, and the roadmap search
 * only when the config names no issue — and two files read under
 * `options.root`. GitHub arrives through the {@link GhRunner} the
 * caller opens, as it does for the setup, and every case in
 * `./status.test.ts` drives a recorded fake pointed at its own
 * temporary directory.
 */
import type { BoardPartKind } from './setup.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Stats } from 'node:fs';

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';

import { createGhRoadmapSearch, ROADMAP_SETTING, ROADMAP_TITLE, severalRoadmapsMessage } from './roadmap.js';
import { readRoadmapSetting } from './setup-config.js';
import { BOARD_LABELS, listBoardLabels, missingBoardLabels, SPEC_TEMPLATE_PATH } from './setup.js';

/** What one row of the board came to. */
export type BoardStatusOutcome =
  /** The repository holds it, and `rafa init --board` would leave it alone. */
  | 'present'
  /** It is not there, and `rafa init --board` would make it. */
  | 'missing'
  /** The reading failed or answered something this does not pick; `detail` says which. */
  | 'unknown';

/** One part of the board as it was read. */
export interface BoardRow {
  /** Which part it is, spelled as `./setup.ts` spells its parts. */
  readonly kind: BoardPartKind;
  /** What it is called: a label name, a path, `Roadmap issue`, `roadmap.issue`. */
  readonly name: string;
  readonly outcome: BoardStatusOutcome;
  /** One sentence: what was found, or why it could not be. */
  readonly detail: string;
}

/** What one reading of the board came to. */
export interface BoardStatus {
  /** Every row: the six labels, the template, the issue and the setting. */
  readonly rows: readonly BoardRow[];
  /** The roadmap issue the config names or the search found; null when there is none. */
  readonly roadmapIssue: number | null;
}

/** What {@link readBoardStatus} reads through. */
export interface BoardStatusOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The project root: where the template and the config are read. */
  readonly root: string;
}

/** The `Roadmap issue` row, under the name `./setup.ts` gives its part. */
export const ROADMAP_ROW_NAME = `${ROADMAP_TITLE} issue`;

/** One row, as the rows are built. */
function rowOf(kind: BoardPartKind, name: string, outcome: BoardStatusOutcome, detail: string): BoardRow {
  return { kind, name, outcome, detail };
}

/** Every row of `status` that is not present, in the order they were read. */
export function boardGaps(status: BoardStatus): readonly BoardRow[] {
  return status.rows.filter((row) => row.outcome !== 'present');
}

/**
 * One row per label of {@link BOARD_LABELS}. A listing that failed
 * leaves all six `unknown` with its own sentence, because nothing is
 * known about any of them then.
 */
export async function readLabelRows(gh: GhRunner): Promise<readonly BoardRow[]> {
  let held: readonly string[];
  try {
    held = await listBoardLabels(gh);
  } catch (error) {
    const why = messageOf(error);
    return Object.freeze(BOARD_LABELS.map((label) => rowOf('label', label.name, 'unknown', why)));
  }

  const missing = missingBoardLabels(held);
  return Object.freeze(BOARD_LABELS.map((label) => (missing.includes(label)
    ? rowOf('label', label.name, 'missing', 'the repository carries no label of that name')
    : rowOf('label', label.name, 'present', 'the repository carries it'))));
}

/**
 * The template row: present for a file at {@link SPEC_TEMPLATE_PATH}
 * under `root`, missing when nothing resolves there, and `unknown` for
 * anything else at that path — a directory, or a link to nothing —
 * since `rafa init --board` refuses those rather than writing them.
 */
export function readTemplateRow(root: string): BoardRow {
  const path = join(root, SPEC_TEMPLATE_PATH);
  const name = SPEC_TEMPLATE_PATH;
  let found: Stats;
  try {
    found = statSync(path);
  } catch {
    return rowOf('template', name, 'missing', 'the repository carries no spec issue template');
  }
  return found.isFile()
    ? rowOf('template', name, 'present', 'the repository carries it')
    : rowOf('template', name, 'unknown', `${path} is not a file`);
}

/**
 * Every open issue whose title folds exactly to {@link ROADMAP_TITLE},
 * through `./roadmap.ts`'s own search, so the command sent and the
 * shape read are the ones the roadmap reader uses.
 *
 * @throws Error naming the command when `gh` failed or answered a shape
 * that reader does not read.
 */
async function searchRoadmapIssues(gh: GhRunner): Promise<readonly number[]> {
  const wanted = ROADMAP_TITLE.toLowerCase();
  const candidates = await createGhRoadmapSearch({ gh })();
  return Object.freeze(candidates
    .filter((candidate) => candidate.title.trim().toLowerCase() === wanted)
    .map((candidate) => candidate.number));
}

/** Both roadmap rows and the issue they name; see the module note. */
async function readRoadmapRows(gh: GhRunner, root: string): Promise<BoardStatus> {
  const unknownBoth = (why: string): BoardStatus => ({
    rows: [rowOf('issue', ROADMAP_ROW_NAME, 'unknown', why), rowOf('setting', ROADMAP_SETTING, 'unknown', why)],
    roadmapIssue: null,
  });

  const reading = readRoadmapSetting(root);
  if (reading.problem !== null) return unknownBoth(reading.problem);
  if (reading.issue !== null) {
    const named = `#${String(reading.issue)}`;
    return {
      rows: [
        rowOf('issue', ROADMAP_ROW_NAME, 'present', `${ROADMAP_SETTING} names issue ${named}`),
        rowOf('setting', ROADMAP_SETTING, 'present', `it names issue ${named}`),
      ],
      roadmapIssue: reading.issue,
    };
  }

  let found: readonly number[];
  try {
    found = await searchRoadmapIssues(gh);
  } catch (error) {
    return unknownBoth(messageOf(error));
  }
  if (found.length > 1) return unknownBoth(severalRoadmapsMessage(found));

  const existing = found[0] ?? null;
  if (existing === null) {
    return {
      rows: [
        rowOf('issue', ROADMAP_ROW_NAME, 'missing', `no open issue is titled ${ROADMAP_TITLE}`),
        rowOf('setting', ROADMAP_SETTING, 'missing', 'the project config names no roadmap issue'),
      ],
      roadmapIssue: null,
    };
  }
  const named = `#${String(existing)}`;
  return {
    rows: [
      rowOf('issue', ROADMAP_ROW_NAME, 'present', `issue ${named} is open and titled ${ROADMAP_TITLE}`),
      rowOf('setting', ROADMAP_SETTING, 'missing', `the project config names no roadmap issue, and ${named} is one`),
    ],
    roadmapIssue: existing,
  };
}

/**
 * Reads every part of the board and answers a row for each: the six
 * labels, the spec issue template, the Roadmap issue and
 * `roadmap.issue`.
 *
 * Writes nothing and never throws: a `gh` command that failed and a
 * config that could not be read are `unknown` rows carrying their own
 * sentence.
 */
export async function readBoardStatus(options: BoardStatusOptions): Promise<BoardStatus> {
  const { gh, root } = options;
  const labels = await readLabelRows(gh);
  const template = readTemplateRow(root);
  const roadmap = await readRoadmapRows(gh, root);

  return Object.freeze({
    rows: Object.freeze([...labels, template, ...roadmap.rows]),
    roadmapIssue: roadmap.roadmapIssue,
  });
}
