/**
 * What `rafa init --board` makes on a GitHub repository: the labels, the
 * spec issue template, the pinned Roadmap issue, and `roadmap.issue`
 * written to the project config.
 *
 * The board is the part of the workflow that does not live in the
 * checkout (`.rafa/specs/rafa-20-pr-commands.md`): a spec is an issue, its
 * readiness is a label, and the order is a task list in one pinned
 * issue. A repository that has none of that cannot be planned from, and
 * making it by hand is fifteen labels, a template file and an issue body
 * nobody remembers the shape of. This module makes all four, and
 * {@link setUpBoard} is the whole of it; the question, the flags and the
 * lines printed are `src/commands/init.ts`'s, and the present-or-missing
 * rows are `rafa doctor`'s.
 *
 * ## Every part is idempotent, and says which it was
 *
 * Each part answers one {@link BoardPart}: `created` when this run made
 * it or wrote to it, `present` when it was already there and nothing was written, or
 * `refused` when it was not made and the detail says why. So a second
 * run over a board already set up writes no byte and answers `present`
 * fifteen-plus-three times, which is what keeps `rafa init`'s "Nothing
 * changed." true when the board step is part of it.
 *
 * A refusal is never a throw. `setUpBoard` reports a failed `gh`
 * command, an unreadable config or an ambiguous roadmap as a refused
 * part and carries on with the rest, because the parts are independent:
 * a repository whose labels could not be listed still wants its issue
 * template. The caller decides what a refusal costs the command.
 *
 * ## The labels, and where their names come from
 *
 * {@link BOARD_LABELS} is the spec's list, and of its fifteen names only
 * the three horizons and {@link ROADMAP_LABEL} are spelled here for the
 * first time: `type:spec`
 * is `./issue.ts`'s {@link SPEC_LABEL}, the label an issue is refused
 * for not carrying, `spec:ready` is `./readiness.ts`'s {@link SPEC_READY_LABEL},
 * `spec:needs-work` is `./gate.ts`'s {@link SPEC_NEEDS_WORK_LABEL},
 * `spec:blocked` is `./blocked.ts`'s {@link SPEC_BLOCKED_LABEL}, and
 * `type:bug`, `type:epic`, `needs-triage`, `module:unassigned` and
 * `module:cli-gap` are
 * built from `GITHUB_LABELS`, the prefixes `src/adapters/tracker/github.ts`
 * files a draft under. A label spelled twice is a label the gate looks
 * for and this command does not make. `horizon:now`, `horizon:next` and
 * `horizon:later` are the horizons an epic carries one of, and this list
 * is where they are first spelled: `./epic-problems.ts` reads only their
 * `horizon:` prefix, and `./epic-walk.ts` builds `horizon:now` from it.
 * `type:roadmap` marks an issue as a board, built from the same
 * `GITHUB_LABELS` type prefix, and is exported from here as
 * {@link ROADMAP_LABEL} for the readers that find boards by it.
 * `rafa:claimed` and `rafa:in-development` are the stages of a claim
 * (`.rafa/plans/rafa-324-claim-issue-so-two`), `packages/rafa/src/claims/stale.ts`'s
 * {@link CLAIMED_LABEL} and {@link IN_DEVELOPMENT_LABEL}: they show the
 * stage an issue's claim is at, never who holds it, which lives in git.
 *
 * No colour is sent. `gh label create --help` says a colour is optional
 * and a random one is chosen when it is left out, and the spec asks for
 * a description and no colour; a palette chosen here would be one more
 * thing to keep in step with a repository that has recoloured its
 * labels, for a part of the board nothing reads.
 *
 * The existing labels are LISTED first and only the missing ones are
 * created, rather than sending `gh label create --force` for each.
 * `--force` updates the colour and the description of a label that
 * exists, which would rewrite a description somebody edited and make
 * every run a write.
 *
 * That listing reads {@link LABEL_LIST_LIMIT} labels. A repository
 * holding more than that can have one of the fifteen fall off the end, and
 * what it costs is a refused part: `gh label create --help` says
 * `--force` is what updates a label that already exists, so the plain
 * form this sends fails, and the failure is reported as the refusal
 * detail with whatever `gh` wrote in it — the words it writes there are
 * not measured anywhere in this repository. Nothing is overwritten and
 * no run is stopped, so the limit is a line an operator may have to read
 * past rather than a failure mode.
 *
 * ## The roadmap step lives in `./setup-roadmap.ts`
 *
 * The Roadmap issue, its label, its body and `roadmap.issue` are
 * `./setup-roadmap.ts`'s, which carries the note on why the config is
 * read before the search. This module re-exports all of it and runs it
 * last, under the `naming.branch` template {@link BoardSetupOptions}
 * carries, so the issue's naming paragraph names the claim branch the
 * project configured. The parts and the `gh` readers both steps share
 * are `./setup-parts.ts`'s.
 *
 * ## Seams
 *
 * Nothing here spawns. GitHub arrives through the {@link GhRunner}
 * declared in `src/adapters/tracker/github.ts`, as it does for the
 * tracker, the pull request provider and the issue board, and the two
 * files are read and written under `options.root`, which a case points
 * at its own temporary directory. Every case in `./setup.test.ts` drives
 * a recorded fake: none reaches GitHub, spawns `gh`, or touches the real
 * home.
 */
import type { BoardPart } from './setup-parts.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Stats } from 'node:fs';

import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '@open-tomato/rafa/claims/stale';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { GITHUB_LABELS } from '../adapters/tracker/github.js';

import { SPEC_BLOCKED_LABEL } from './blocked.js';
import { SPEC_NEEDS_WORK_LABEL } from './gate.js';
import { SPEC_LABEL } from './issue.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { detailOf, holdsLabel, parseRows, partOf, PREFIX, rowText } from './setup-parts.js';
import { ROADMAP_LABEL, setUpRoadmap } from './setup-roadmap.js';

export type { BoardOutcome, BoardPart, BoardPartKind } from './setup-parts.js';
export {
  CREATED_ISSUE_URL,
  ROADMAP_LABEL,
  roadmapIssueBody,
  setUpRoadmap,
  writeRoadmapSetting,
} from './setup-roadmap.js';
export type { RoadmapStep } from './setup-roadmap.js';

/** This module's own directory: where the shipped issue template is looked for. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** One label the board needs, with the description it is made with. */
export interface BoardLabel {
  /** The name as GitHub holds it. */
  readonly name: string;
  /** The one-line description sent with `gh label create`. */
  readonly description: string;
}

/**
 * The fifteen labels the workflow files under, in the order they are made.
 * See the module note on where each name comes from.
 */
export const BOARD_LABELS: readonly BoardLabel[] = Object.freeze([
  {
    name: SPEC_LABEL,
    description: 'A change described well enough that rafa can plan from it',
  },
  {
    name: SPEC_READY_LABEL,
    description: 'The spec is complete: rafa may plan from this issue',
  },
  {
    name: SPEC_NEEDS_WORK_LABEL,
    description: 'The readiness gate found gaps in this spec, listed in a comment',
  },
  {
    name: SPEC_BLOCKED_LABEL,
    description: 'The work waits on other issues, named by a Blocked by: line in the body',
  },
  {
    name: `${GITHUB_LABELS.typePrefix}bug`,
    description: 'Something that is broken',
  },
  {
    name: GITHUB_LABELS.needsTriage,
    description: 'No priority has been set on this yet',
  },
  {
    name: `${GITHUB_LABELS.modulePrefix}unassigned`,
    description: 'No module owns this yet',
  },
  {
    name: `${GITHUB_LABELS.modulePrefix}cli-gap`,
    description: 'A step a session needed that no rafa command can do, filed as a gap report',
  },
  {
    name: `${GITHUB_LABELS.typePrefix}epic`,
    description: 'A group of issues shipped together, its members labelled epic:<slug>',
  },
  {
    name: 'horizon:now',
    description: 'An epic being worked on now',
  },
  {
    name: 'horizon:next',
    description: 'An epic to be worked on after the ones now',
  },
  {
    name: 'horizon:later',
    description: 'An epic with no date yet',
  },
  {
    name: ROADMAP_LABEL,
    description: 'A board: its body is the ordered checklist of epics and specs to take next',
  },
  {
    name: CLAIMED_LABEL,
    description: 'A device has claimed this issue and planned it; the claim branch names which',
  },
  {
    name: IN_DEVELOPMENT_LABEL,
    description: 'A claimed issue whose loop has started; the claim branch names which device',
  },
]);

/**
 * How many labels one `gh label list` reads. Sent because its own
 * default is 30 (`gh label list --help`, `gh` 2.100.0, read 2026-09-19),
 * which a repository can hold more than; see the module note on what a
 * repository holding more than this costs.
 */
export const LABEL_LIST_LIMIT = 100;

/** The path the spec issue template is written to, under the project root. */
export const SPEC_TEMPLATE_PATH: string = join('.github', 'ISSUE_TEMPLATE', 'spec.md');

/** The directory the build copies the shipped templates to, beside `cli.js`. */
export const TEMPLATES_DIRNAME = 'templates';

/** The name the shipped spec template carries in that directory. */
export const SPEC_TEMPLATE_FILE = 'spec.md';

/** What a whole run of {@link setUpBoard} came to. */
export interface BoardSetupReport {
  /** Every part, labels first, then the template, the issue and the setting. */
  readonly parts: readonly BoardPart[];
  /** The roadmap issue this run made or found, or null when there is none. */
  readonly roadmapIssue: number | null;
  /** A sentence per reading that failed without refusing a part. */
  readonly problems: readonly string[];
}

/** True when any part of `report` was created, so a run wrote something. */
export function boardChanged(report: BoardSetupReport): boolean {
  return report.parts.some((part) => part.outcome === 'created');
}

/** Every part of `report` that was refused, in the order it reports them. */
export function boardRefusals(report: BoardSetupReport): readonly BoardPart[] {
  return report.parts.filter((part) => part.outcome === 'refused');
}

/**
 * Every label name the repository holds, read with one
 * `gh label list --limit <n> --json name`.
 *
 * @throws Error naming the command when `gh` failed or answered a shape
 * this does not read.
 */
export async function listBoardLabels(gh: GhRunner): Promise<readonly string[]> {
  const limit = String(LABEL_LIST_LIMIT);
  const args = ['label', 'list', '--limit', limit, '--json', 'name'];
  const command = `gh label list --limit ${limit} --json name`;

  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
  return Object.freeze(parseRows(result.stdout, command)
    .map((row, index) => rowText(row, 'name', command, `label ${String(index)}`)));
}

/**
 * The labels of {@link BOARD_LABELS} that `held` does not carry, in the
 * order they are made. GitHub label names are case-insensitive, so the
 * comparison is too: a repository already carrying `Needs-Triage` is not
 * handed a second one.
 */
export function missingBoardLabels(held: readonly string[]): readonly BoardLabel[] {
  return BOARD_LABELS.filter((label) => !holdsLabel(held, label.name));
}

/**
 * Makes each of {@link BOARD_LABELS} the repository does not carry, and
 * answers one part per label. A failed listing refuses all fifteen, naming
 * the command, because nothing is known about any of them then.
 */
export async function setUpLabels(gh: GhRunner): Promise<readonly BoardPart[]> {
  let held: readonly string[];
  try {
    held = await listBoardLabels(gh);
  } catch (error) {
    const why = messageOf(error);
    return BOARD_LABELS.map((label) => partOf('label', label.name, 'refused', why));
  }

  const missing = missingBoardLabels(held);
  let parts: readonly BoardPart[] = [];
  for (const label of BOARD_LABELS) {
    if (!missing.includes(label)) {
      parts = [...parts, partOf('label', label.name, 'present', 'the repository already carries it')];
      continue;
    }
    const command = `gh label create ${label.name}`;
    const result = await gh(['label', 'create', label.name, '--description', label.description]);
    parts = [...parts, result.ok
      ? partOf('label', label.name, 'created', `made with the description ${label.description}`)
      : partOf('label', label.name, 'refused', detailOf(result, command))];
  }
  return Object.freeze(parts);
}

/** What `statSync` answers for `path`, links followed, or null when it resolves to nothing. */
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/** True when something is at `path`, a link that resolves to nothing included. */
export function anythingAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the shipped spec template is looked for: `templates/spec.md`
 * under this module's directory, which is `src/board/templates/spec.md`
 * in a checkout and `dist/templates/spec.md` in a build, since a module
 * inlined into the bundle answers `dist/` for its own directory.
 */
export function specTemplateSource(moduleDir: string = MODULE_DIR): string {
  return join(moduleDir, TEMPLATES_DIRNAME, SPEC_TEMPLATE_FILE);
}

/**
 * The text of the shipped spec template.
 *
 * @throws Error naming the path when the build dropped it.
 */
export function readSpecTemplate(moduleDir: string = MODULE_DIR): string {
  const source = specTemplateSource(moduleDir);
  if (!existsSync(source)) {
    throw new Error(`${PREFIX}: the spec issue template is missing: no file at ${source}`);
  }
  return readFileSync(source, 'utf8');
}

/** A file the build ships, and where under a project root it is written. */
export interface ShippedFile {
  /** Where it is written, relative to the project root; also the name of its part. */
  readonly path: string;
  /** Where the shipped copy is read from. */
  readonly source: string;
  /** What a refusal calls it: `the template`, `the workflow`. */
  readonly what: string;
  /** The shipped copy's text; throws, naming the path, when the build dropped it. */
  readonly read: () => string;
}

/**
 * Writes `file` under `root` when nothing is at its path, and answers its
 * `template` part. An existing file is left byte for byte as it is,
 * whatever it holds: a repository that has edited its own copy has said
 * what it wants, and a symbolic link that resolves to a file is one of
 * those.
 *
 * A path holding anything else is REFUSED rather than written to: a
 * directory, and a link that resolves to nothing, which `statSync`
 * answers for as loudly as an empty path does and `lstatSync` does not.
 */
export function writeShippedFile(root: string, file: ShippedFile): BoardPart {
  const path = join(root, file.path);
  const name = file.path;

  const found = statOrNull(path);
  if (found !== null) {
    return found.isFile()
      ? partOf('template', name, 'present', 'the repository already carries it')
      : partOf('template', name, 'refused', `${path} is not a file, so ${file.what} was not written`);
  }
  if (anythingAt(path)) {
    return partOf('template', name, 'refused', `${path} is a link to nothing, so ${file.what} was not written`);
  }

  try {
    const text = file.read();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
    return partOf('template', name, 'created', `written from ${file.source}`);
  } catch (error) {
    return partOf('template', name, 'refused', messageOf(error));
  }
}

/**
 * Writes {@link SPEC_TEMPLATE_PATH} under `root` when nothing is at that
 * path, through {@link writeShippedFile}, which says what an existing
 * path is left as or refused for.
 */
export function writeSpecTemplate(root: string, moduleDir: string = MODULE_DIR): BoardPart {
  return writeShippedFile(root, {
    path: SPEC_TEMPLATE_PATH,
    source: specTemplateSource(moduleDir),
    what: 'the template',
    read: () => readSpecTemplate(moduleDir),
  });
}

/** What {@link setUpBoard} is made with. */
export interface BoardSetupOptions {
  /** Runs every `gh` command, in the repository the board is made on. */
  readonly gh: GhRunner;
  /** The project root: where the template and the config are written. */
  readonly root: string;
  /** Where the shipped template is looked for; this module's directory unless given. */
  readonly moduleDir?: string | undefined;
  /**
   * The `naming.branch` template the Roadmap issue's naming paragraph
   * builds the claim branch from; `DEFAULT_BRANCH_TEMPLATE` when left out.
   */
  readonly branchTemplate?: string | undefined;
}

/**
 * Makes every part of the board that is missing and answers what each
 * came to: the fifteen labels, the spec issue template, the pinned Roadmap
 * issue and `roadmap.issue`.
 *
 * Writes nothing a second time: a run over a board already set up
 * answers `present` for every part, and {@link boardChanged} is false.
 * Never throws for a failed command or an unwritable path; those come
 * back as refused parts.
 */
export async function setUpBoard(options: BoardSetupOptions): Promise<BoardSetupReport> {
  const { gh, root, moduleDir, branchTemplate } = options;
  const labels = await setUpLabels(gh);
  const template = writeSpecTemplate(root, moduleDir ?? MODULE_DIR);
  const roadmap = await setUpRoadmap(gh, root, branchTemplate);

  return Object.freeze({
    parts: Object.freeze([...labels, template, ...roadmap.parts]),
    roadmapIssue: roadmap.issue,
    problems: Object.freeze([...roadmap.problems]),
  });
}
