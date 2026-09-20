/**
 * What `rafa init --board` makes on a GitHub repository: the labels, the
 * spec issue template, the pinned Roadmap issue, and `roadmap.issue`
 * written to the project config.
 *
 * The board is the part of the workflow that does not live in the
 * checkout (`.rafa/specs/rafa-20-pr-commands.md`): a spec is an issue, its
 * readiness is a label, and the order is a task list in one pinned
 * issue. A repository that has none of that cannot be planned from, and
 * making it by hand is six labels, a template file and an issue body
 * nobody remembers the shape of. This module makes all four, and
 * {@link setUpBoard} is the whole of it; the question, the flags and the
 * lines printed are `src/commands/init.ts`'s, and the present-or-missing
 * rows are `rafa doctor`'s.
 *
 * ## Every part is idempotent, and says which it was
 *
 * Each part answers one {@link BoardPart}: `created` when this run made
 * it, `present` when it was already there and nothing was written, or
 * `refused` when it was not made and the detail says why. So a second
 * run over a board already set up writes no byte and answers `present`
 * six-plus-three times, which is what keeps `rafa init`'s "Nothing
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
 * {@link BOARD_LABELS} is the spec's list, and not one of the six names
 * is spelled here for the first time: `type:spec` is `./issue.ts`'s
 * {@link SPEC_LABEL}, the label an issue is refused for not carrying,
 * `spec:ready` is `./readiness.ts`'s {@link SPEC_READY_LABEL},
 * `spec:needs-work` is `./gate.ts`'s {@link SPEC_NEEDS_WORK_LABEL}, and
 * `type:bug`, `needs-triage` and `module:unassigned` are built from
 * `GITHUB_LABELS`, the prefixes `src/adapters/tracker/github.ts` files a
 * draft under. A label spelled twice is a label the gate looks for and
 * this command does not make.
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
 * holding more than that can have one of the six fall off the end, and
 * what it costs is a refused part: `gh label create --help` says
 * `--force` is what updates a label that already exists, so the plain
 * form this sends fails, and the failure is reported as the refusal
 * detail with whatever `gh` wrote in it — the words it writes there are
 * not measured anywhere in this repository. Nothing is overwritten and
 * no run is stopped, so the limit is a line an operator may have to read
 * past rather than a failure mode.
 *
 * ## The roadmap issue, and why the config is read before the search
 *
 * The order is: `roadmap.issue` in the project config, then the open
 * issue titled {@link ROADMAP_TITLE}, then a new issue. The config is
 * read FIRST on purpose. `gh issue list --search` goes through GitHub's
 * search index, which is not updated the moment an issue is created, so
 * a second run minutes after the first can be answered "no issue titled
 * Roadmap" for an issue that exists — and creating a second Roadmap
 * issue is the one failure here that cannot be undone by running the
 * command again. Once `roadmap.issue` names the issue, no later run
 * searches at all, so idempotency rests on a file in the checkout rather
 * than on an index nobody controls.
 *
 * Two open issues titled Roadmap are REFUSED, with `./roadmap.ts`'s own
 * sentence, for the reason it gives: which one holds the order is not
 * this command to guess.
 *
 * The pin is `gh issue pin <n>` (measured present in `gh` 2.100.0 on
 * 2026-09-19). A pin that fails does not make the part refused: the
 * issue exists and `roadmap.issue` names it, which is everything
 * `plan create --next` reads, and pinnedness is what a person sees on
 * the issues page. It comes back as a {@link BoardSetupReport.problems}
 * sentence instead, the shape `./roadmap.ts` uses for the half of a
 * branch scan that failed.
 *
 * ## Writing one setting into a file of comments
 *
 * `roadmap.issue` is written INTO the config `rafa init` wrote rather
 * than over it, so the commented template an operator reads stays in the
 * file. The edit, the shape it refuses and the parse-back that guards it
 * are `./setup-config.ts`'s; {@link writeRoadmapSetting} is the part
 * that reports what came of them.
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
import type { SettingReading } from './setup-config.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Stats } from 'node:fs';

import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITHUB_LABELS } from '../adapters/tracker/github.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';
import { configFilePath } from '../config.js';

import { SPEC_NEEDS_WORK_LABEL } from './gate.js';
import { SPEC_LABEL } from './issue.js';
import { BRANCH_PREFIX, ID_PREFIX } from './naming.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { ROADMAP_SETTING, ROADMAP_TITLE, severalRoadmapsMessage } from './roadmap.js';
import { readRoadmapSetting, roadmapIssueIn, withRoadmapIssue } from './setup-config.js';

/** What every refusal this module writes opens with. */
const PREFIX = 'board setup';

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
 * The six labels the workflow files under, in the order they are made.
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
]);

/**
 * How many labels one `gh label list` reads. Sent because its own
 * default is 30 (`gh label list --help`, `gh` 2.100.0, read 2026-09-19),
 * which a repository can hold more than; see the module note on what a
 * repository holding more than this costs.
 */
export const LABEL_LIST_LIMIT = 100;

/** The path the spec issue template is written to, under the project root. */
export const SPEC_TEMPLATE_PATH = join('.github', 'ISSUE_TEMPLATE', 'spec.md');

/** The directory the build copies the shipped templates to, beside `cli.js`. */
export const TEMPLATES_DIRNAME = 'templates';

/** The name the shipped spec template carries in that directory. */
export const SPEC_TEMPLATE_FILE = 'spec.md';

/** What one part of the board came to. */
export type BoardOutcome = 'created' | 'present' | 'refused';

/** Which part of the board a {@link BoardPart} is about. */
export type BoardPartKind = 'label' | 'template' | 'issue' | 'setting';

/** One part of the board, and what this run made of it. */
export interface BoardPart {
  /** Which part it is; a caller groups its rows by this. */
  readonly kind: BoardPartKind;
  /** What it is called: a label name, a path, `Roadmap issue`, `roadmap.issue`. */
  readonly name: string;
  /** Created by this run, already present, or not made. */
  readonly outcome: BoardOutcome;
  /** One sentence: what was made, or why it was not. */
  readonly detail: string;
}

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

/** One part, as the parts are built. */
function partOf(kind: BoardPartKind, name: string, outcome: BoardOutcome, detail: string): BoardPart {
  return { kind, name, outcome, detail };
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** What `command` wrote, parsed as a list. Throws, naming it, when it is not one. */
function parseRows(stdout: string, command: string): readonly unknown[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(payload)}, expected a list`);
  }
  return payload as readonly unknown[];
}

/** The string a row carries at `key`, checked. */
function rowText(row: unknown, key: string, command: string, where: string): string {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a string`);
  }
  return value;
}

/** The positive whole number a row carries at `key`, checked. */
function rowNumber(row: unknown, key: string, command: string, where: string): number {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
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

/** True when `held` carries `name`, however either spells its case. */
function holdsLabel(held: readonly string[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return held.some((label) => label.trim().toLowerCase() === wanted);
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
 * answers one part per label. A failed listing refuses all six, naming
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
function anythingAt(path: string): boolean {
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

/**
 * Writes {@link SPEC_TEMPLATE_PATH} under `root` when nothing is at that
 * path. An existing file is left byte for byte as it is, whatever it
 * holds: a repository that has edited its own template has said what it
 * wants an issue to ask for, and a symbolic link that resolves to a file
 * is one of those.
 *
 * A path holding anything else is REFUSED rather than written to: a
 * directory, and a link that resolves to nothing, which `statSync`
 * answers for as loudly as an empty path does and `lstatSync` does not.
 */
export function writeSpecTemplate(root: string, moduleDir: string = MODULE_DIR): BoardPart {
  const path = join(root, SPEC_TEMPLATE_PATH);
  const name = SPEC_TEMPLATE_PATH;

  const found = statOrNull(path);
  if (found !== null) {
    return found.isFile()
      ? partOf('template', name, 'present', 'the repository already carries it')
      : partOf('template', name, 'refused', `${path} is not a file, so the template was not written`);
  }
  if (anythingAt(path)) {
    return partOf('template', name, 'refused', `${path} is a link to nothing, so the template was not written`);
  }

  try {
    const text = readSpecTemplate(moduleDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
    return partOf('template', name, 'created', `written from ${specTemplateSource(moduleDir)}`);
  } catch (error) {
    return partOf('template', name, 'refused', messageOf(error));
  }
}

/** The body a new Roadmap issue is opened with: the empty list and the naming paragraph. */
export function roadmapIssueBody(): string {
  const spec = `${ID_PREFIX}-<n>-<slug>`;
  const branch = `${BRANCH_PREFIX}/${spec}`;
  return [
    '## Next, in order',
    '',
    '<!-- One issue per line, the one to take next at the top:',
    '`- [ ] #<n> why it is next`. rafa plan create --next walks this list',
    'from the top and takes the first line nobody has finished and nobody',
    'has started, so the order written here is the order the work happens',
    'in. A ticked line is done: rafa pr merge ticks one when the pull',
    'request that closes its issue is merged. -->',
    '',
    '## Naming',
    '',
    'Every piece of work has one issue, and the number of that issue is its',
    `id everywhere else: the spec \`${spec}.md\`, the plan stub \`${spec}\`,`,
    `the branch \`${branch}\` and the pull request title`,
    `\`${ID_PREFIX}-<n>: <what you get>\`.`,
    '',
  ].join('\n');
}

/**
 * The URL `gh issue create` prints, capturing the issue number.
 *
 * `src/adapters/tracker/github.ts` keeps its own copy of this pattern,
 * private, for the same line off the same command. Reading a URL is not
 * the concern either module is about, and the shared alternative is
 * exporting a regular expression from the tracker adapter, which is a
 * copied shape open-tomato owns: a second reader of it would be one more
 * thing a change there has to look at.
 */
const CREATED_ISSUE_URL = /^https:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+\/issues\/([1-9]\d*)$/u;

/** What a roadmap issue step came to: the parts it made and the issue, when there is one. */
export interface RoadmapStep {
  readonly parts: readonly BoardPart[];
  readonly issue: number | null;
  readonly problems: readonly string[];
}

/** The `Roadmap issue` part, under the name every caller groups it by. */
const ISSUE_PART_NAME = `${ROADMAP_TITLE} issue`;

/**
 * Writes `roadmap.issue: <issue>` into the project config under `root`,
 * having read the text back as that issue first. Answers the `setting`
 * part.
 */
export function writeRoadmapSetting(root: string, issue: number, reading: SettingReading): BoardPart {
  const path = configFilePath(root);
  const name = ROADMAP_SETTING;
  const written = withRoadmapIssue(reading.text, issue);
  if (written === null) {
    const why = `it spells roadmap in a shape this command does not edit, so set ${name} by hand`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }

  let read: number | null;
  try {
    read = roadmapIssueIn(written, path);
  } catch (error) {
    const why = `the file this run would have written does not parse: ${messageOf(error)}`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }
  if (read !== issue) {
    const why = `the file this run would have written reads ${name} as ${describeValue(read)}`;
    return partOf('setting', name, 'refused', `${path} was left as it was: ${why}`);
  }

  try {
    writeFileSync(path, written, 'utf8');
  } catch (error) {
    return partOf('setting', name, 'refused', `${path} could not be written: ${messageOf(error)}`);
  }
  return partOf('setting', name, 'created', `${path} now names issue #${String(issue)}`);
}

/** Both parts refused for the same reason, when neither can be reached. */
function roadmapRefused(why: string): RoadmapStep {
  return {
    parts: [
      partOf('issue', ISSUE_PART_NAME, 'refused', why),
      partOf('setting', ROADMAP_SETTING, 'refused', why),
    ],
    issue: null,
    problems: [],
  };
}

/** Every open issue titled {@link ROADMAP_TITLE}, by an exact fold of the title. */
async function searchRoadmapIssues(gh: GhRunner): Promise<readonly number[]> {
  const search = `${ROADMAP_TITLE} in:title`;
  const args = ['issue', 'list', '--state', 'open', '--search', search, '--json', 'number,title'];
  const command = `gh issue list --state open --search "${search}" --json number,title`;

  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
  const wanted = ROADMAP_TITLE.toLowerCase();
  return Object.freeze(parseRows(result.stdout, command)
    .map((row, index) => ({
      number: rowNumber(row, 'number', command, `issue ${String(index)}`),
      title: rowText(row, 'title', command, `issue ${String(index)}`),
    }))
    .filter((row) => row.title.trim().toLowerCase() === wanted)
    .map((row) => row.number));
}

/** Opens the Roadmap issue and answers its number, or throws naming the command. */
async function createRoadmapIssue(gh: GhRunner): Promise<number> {
  const command = `gh issue create --title ${ROADMAP_TITLE}`;
  const result = await gh(['issue', 'create', '--title', ROADMAP_TITLE, '--body', roadmapIssueBody()]);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);

  const url = result.stdout.trim().split('\n')
    .at(-1) ?? '';
  const number = CREATED_ISSUE_URL.exec(url)?.[1];
  if (number === undefined) {
    throw new Error(`${PREFIX}: ${command} exited 0 and printed no issue URL, so the issue may exist`
      + ` unrecorded; it wrote ${describeValue(result.stdout)}`);
  }
  return Number.parseInt(number, 10);
}

/** Pins `issue`; a failure is a sentence the caller carries, never a refusal. */
async function pinRoadmapIssue(gh: GhRunner, issue: number): Promise<string | null> {
  const command = `gh issue pin ${String(issue)}`;
  const result = await gh(['issue', 'pin', String(issue)]);
  return result.ok
    ? null
    : `issue #${String(issue)} was opened but not pinned, so it does not show at the top of the issues page: ${detailOf(result, command)}`;
}

/**
 * The roadmap issue and the setting that names it: `roadmap.issue` when
 * the project config names one, else the open issue titled
 * {@link ROADMAP_TITLE}, else a new one. See the module note on why the
 * config is read before the search.
 */
export async function setUpRoadmap(gh: GhRunner, root: string): Promise<RoadmapStep> {
  const reading = readRoadmapSetting(root);
  if (reading.problem !== null) return roadmapRefused(reading.problem);
  if (reading.issue !== null) {
    return {
      parts: [
        partOf('issue', ISSUE_PART_NAME, 'present', `${ROADMAP_SETTING} names issue #${String(reading.issue)}`),
        partOf('setting', ROADMAP_SETTING, 'present', `it already names issue #${String(reading.issue)}`),
      ],
      issue: reading.issue,
      problems: [],
    };
  }

  let found: readonly number[];
  try {
    found = await searchRoadmapIssues(gh);
  } catch (error) {
    return roadmapRefused(messageOf(error));
  }
  if (found.length > 1) return roadmapRefused(severalRoadmapsMessage(found));

  const existing = found[0] ?? null;
  if (existing !== null) {
    return {
      parts: [
        partOf('issue', ISSUE_PART_NAME, 'present', `issue #${String(existing)} is open and titled ${ROADMAP_TITLE}`),
        writeRoadmapSetting(root, existing, reading),
      ],
      issue: existing,
      problems: [],
    };
  }

  let opened: number;
  try {
    opened = await createRoadmapIssue(gh);
  } catch (error) {
    return roadmapRefused(messageOf(error));
  }
  const pin = await pinRoadmapIssue(gh, opened);
  return {
    parts: [
      partOf('issue', ISSUE_PART_NAME, 'created', `issue #${String(opened)} opened and pinned`),
      writeRoadmapSetting(root, opened, reading),
    ],
    issue: opened,
    problems: pin === null
      ? []
      : [pin],
  };
}

/** What {@link setUpBoard} is made with. */
export interface BoardSetupOptions {
  /** Runs every `gh` command, in the repository the board is made on. */
  readonly gh: GhRunner;
  /** The project root: where the template and the config are written. */
  readonly root: string;
  /** Where the shipped template is looked for; this module's directory unless given. */
  readonly moduleDir?: string | undefined;
}

/**
 * Makes every part of the board that is missing and answers what each
 * came to: the six labels, the spec issue template, the pinned Roadmap
 * issue and `roadmap.issue`.
 *
 * Writes nothing a second time: a run over a board already set up
 * answers `present` for every part, and {@link boardChanged} is false.
 * Never throws for a failed command or an unwritable path; those come
 * back as refused parts.
 */
export async function setUpBoard(options: BoardSetupOptions): Promise<BoardSetupReport> {
  const { gh, root, moduleDir } = options;
  const labels = await setUpLabels(gh);
  const template = writeSpecTemplate(root, moduleDir ?? MODULE_DIR);
  const roadmap = await setUpRoadmap(gh, root);

  return Object.freeze({
    parts: Object.freeze([...labels, template, ...roadmap.parts]),
    roadmapIssue: roadmap.issue,
    problems: Object.freeze([...roadmap.problems]),
  });
}
