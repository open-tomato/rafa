/**
 * The project step of `rafa init --board`: the repository's GitHub
 * project, copied from the template, linked, filled and named in the
 * project config (`.rafa/specs/rafa-791-github-project-each-repository.md`,
 * "`rafa init --board`, the project step"). The project is a MIRROR of
 * the issues' labels, pull requests and the Roadmap checklists; the
 * issues stay the source of truth.
 *
 * {@link setUpProject} is the whole of it, and {@link runProjectStep}
 * decides whether it runs at all. `src/commands/init.ts` reads
 * `--project` and `--no-project` as it reads `--epic-guard`, and calls
 * the step last, after the board step, the epic guard and the
 * relationships move, so the Blocked by values are read in the mode the
 * move has just left the board in. The first answer wins:
 *
 *   - The board step did not run: nothing is read, asked or sent, and a
 *     line that said `--project` is told so through the warnings.
 *   - `--no-project`: declined, nothing read.
 *   - `--project`: run, asking nothing.
 *   - No terminal: not asked and not run, and the line naming
 *     `rafa init --board --project` is printed.
 *   - Otherwise its own `[y/N]` question ({@link PROJECT_QUESTION}),
 *     read as the board's is: anything but `y` or `yes` declines.
 *
 * The `gh` runner is opened only once the step runs, and the
 * `roadmap.issue` the board step may have just written is read back off
 * the file first, since `init` resolved its config before that write.
 *
 * ## Five parts, each `created`, `present` or `refused`
 *
 * Reported the way `src/board/setup.ts` reports the board's parts, in
 * this order:
 *
 *  1. **Scope** ({@link SCOPE_PART}): `gh auth status --active --json
 *     hosts` must show `project` among the scopes of an active account
 *     logged in successfully. Without it the part is refused naming
 *     `gh auth refresh -s project`, and the four parts below are refused
 *     as not tried. The part is never `created`: it reads, and writes
 *     nothing.
 *  2. **Copy and link** ({@link COPY_PART}): `present` when
 *     `board.project.number` is set and the repository's owner holds that
 *     project; otherwise the template `board.project.template` names is
 *     copied to the owner, titled after the repository's name, and the
 *     repository linked to the copy. A copy whose link was refused is a
 *     refused part, and the parts below still run on the copy, so its
 *     number is saved and a second run does not copy again.
 *  3. **Add the issues** ({@link ITEMS_PART}): every open issue, every
 *     closed issue with a Rank, and every closed issue whose Stage is In
 *     review, read off the board the refresh reads
 *     (`readRefreshBoard`, `src/board/project/refresh.ts`). Facts are
 *     read only for the closed issues the first two leave out that the
 *     project does not hold already, so a second run reads none it has
 *     added. Each missing issue is added through `ProjectPort.addItem`,
 *     lowest number first, {@link PROJECT_WRITE_PAUSE_MS} apart as the
 *     field writes are paced; `present` when none was missing. An add
 *     refused part way is a refused part naming how many went through;
 *     the adds are idempotent, so a second run finishes them.
 *  4. **Fill the fields** ({@link FIELDS_PART}): `refreshProjectItems`
 *     over every item, which writes only the values that differ:
 *     `created` when it wrote any, `present` when none differed, and
 *     `refused` on a rate-limit refusal, a missing scope, or a project
 *     that is not there. A field the project does not hold as the
 *     template has it is skipped and its line kept in
 *     {@link ProjectSetupReport.problems}; the other fields are written.
 *  5. **Save the number** ({@link PROJECT_NUMBER_SETTING}):
 *     `board.project.number` written into `.rafa/config.yaml`
 *     (`./init-board-project-setting.ts`); `present` when it already
 *     names the project.
 *
 * Parts 3 to 5 need a project: with none copied or found they are
 * refused as not tried, with the reason the copy part gave.
 *
 * The step never sets an auto-add rule: the API cannot, and rafa adds
 * the issues itself.
 *
 * ## A second run writes nothing
 *
 * Over a project already set up, the scope is read, the project found,
 * every wanted issue found on it, every value found as the rules give it,
 * and the number found in the file: five `present` parts and no write,
 * which keeps `rafa init`'s "Nothing changed." true.
 *
 * ## The scope reading
 *
 * Measured with `gh` 2.100.0 on 2026-10-07, read-only, with the logins
 * and tokens left out of the capture: `gh auth status --active --json
 * hosts` exited 0 and wrote `{"hosts":{"github.com":[{"state":
 * "success","active":true,"host":"github.com","login":…,"tokenSource":
 * "keyring","scopes":"admin:org, admin:public_key, delete_repo, gist,
 * project, repo","gitProtocol":"ssh"}]}}`. `scopes` is one string,
 * comma and space separated, and `project` is matched as a whole entry,
 * so `read:project`, which cannot write, does not pass. NOT measured: a
 * fine-grained token, which carries no classic scopes, and the answer
 * with no account logged in; both read as no `project` scope and are
 * refused. A host other than the one the project lives on is not told
 * apart: a project call the token is refused for later still answers
 * the scope fix, through `isMissingProjectScope`.
 *
 * ## Never a throw
 *
 * Every failed `gh` call and every write the file would not take is a
 * refused part, and the step carries on with what does not need it, the
 * way `setUpBoard` does: the caller decides what a refusal costs. Every
 * call goes through the one `GhRunner`; every case in
 * `./init-board-project.test.ts` drives a recorded fake.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Project, ProjectItem, ProjectPort, ProjectRef } from '../board/project/port.js';
import type { ProjectRefresh, RefreshConfig, RefreshOptions } from '../board/project/refresh.js';
import type { BoardOutcome } from '../board/setup.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { RafaConfig } from '../config.js';
import type { BoardStepResult } from './init-board.js';

import { readIssueFacts } from '../board/project/facts.js';
import { createGhProjectPort } from '../board/project/gh.js';
import { PROJECT_WRITE_PAUSE_MS } from '../board/project/port.js';
import { isMissingProjectScope, PROJECT_SCOPE_FIX, rateLimitWarning } from '../board/project/refresh-warnings.js';
import { readRefreshBoard, refreshProjectItems } from '../board/project/refresh.js';
import { rankOf, stageOf } from '../board/project/rules.js';
import { readRoadmapSetting } from '../board/setup-config.js';
import { isMapping, messageOf } from '../config-sections.js';

import { readBoardRepository } from './epic/move-native.js';
import { PROJECT_NUMBER_SETTING, writeProjectNumber } from './init-board-project-setting.js';
import { YES_ANSWERS } from './init-board.js';

/** The line that runs the step again, named by a refusal. */
export const PROJECT_STEP_FIX = 'rafa init --board --project';

/** The scope part's name. */
export const SCOPE_PART = 'project scope';

/** The copy-and-link part's name. */
export const COPY_PART = 'project';

/** The add-the-issues part's name. */
export const ITEMS_PART = 'project issues';

/** The fill-the-fields part's name. */
export const FIELDS_PART = 'project fields';

/** The scope every project call needs, as `gh auth status` lists it. */
export const PROJECT_SCOPE = 'project';

/** The read of the active accounts' scopes; see the module note. */
export const SCOPE_ARGS: readonly string[] = Object.freeze(['auth', 'status', '--active', '--json', 'hosts']);

/** The state `gh auth status` answers for an account whose token works. */
const LOGGED_IN = 'success';

/** Which of the five parts a {@link ProjectPart} is. */
export type ProjectPartKind = 'scope' | 'project' | 'items' | 'fields' | 'setting';

/** One part of the project step, and what this run made of it. */
export interface ProjectPart {
  readonly kind: ProjectPartKind;
  /** What a row calls it: {@link SCOPE_PART}, {@link COPY_PART}, …, `board.project.number`. */
  readonly name: string;
  /** Created by this run, already present, or not made. */
  readonly outcome: BoardOutcome;
  /** One sentence: what was made or found, or why it was not. */
  readonly detail: string;
}

/** What a whole run of {@link setUpProject} came to. */
export interface ProjectSetupReport {
  /** The five parts, in the order of the module note. */
  readonly parts: readonly ProjectPart[];
  /** The project this run copied or found, or null when there is none. */
  readonly project: (ProjectRef & { readonly url: string }) | null;
  /** A sentence per reading that failed without refusing a part: a field the refresh skipped. */
  readonly problems: readonly string[];
}

/** The config keys the step reads. */
export type ProjectSetupConfig = RefreshConfig & Pick<RafaConfig, 'boardProjectTemplate'>;

/** What {@link setUpProject} is made with. */
export interface ProjectSetupOptions {
  /** The project root: where `.rafa/config.yaml` is written. */
  readonly root: string;
  readonly config: ProjectSetupConfig;
  /** Runs every `gh` call the step sends. */
  readonly gh: GhRunner;
  /** The pause between two adds and between two write requests; `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** One part, as the parts are built. */
function partOf(kind: ProjectPartKind, name: string, outcome: BoardOutcome, detail: string): ProjectPart {
  return { kind, name, outcome, detail };
}

/** The parts of `kinds`, each refused as not tried for `why`. */
function notTried(kinds: readonly ProjectPartKind[], why: string): readonly ProjectPart[] {
  const names: Readonly<Record<ProjectPartKind, string>> = {
    scope: SCOPE_PART,
    project: COPY_PART,
    items: ITEMS_PART,
    fields: FIELDS_PART,
    setting: PROJECT_NUMBER_SETTING,
  };
  return kinds.map((kind) => partOf(kind, names[kind], 'refused', `not tried: ${why}`));
}

/** The detail of a token without the `project` scope. */
function scopeDetail(): string {
  return `the gh token has no \`${PROJECT_SCOPE}\` scope; run \`${PROJECT_SCOPE_FIX}\`, then \`${PROJECT_STEP_FIX}\``;
}

/** Why a part's call was refused: the scope fix for a missing scope, else the error's own words. */
function refusalOf(error: unknown): string {
  return isMissingProjectScope(error)
    ? scopeDetail()
    : messageOf(error);
}

/** True when one account of `hosts` is active, logged in, and holds the `project` scope. */
function holdsProjectScope(hosts: unknown): boolean {
  if (!isMapping(hosts)) return false;
  return Object.values(hosts).some((accounts) => Array.isArray(accounts) && accounts.some((account) => isMapping(account)
    && account['active'] === true
    && account['state'] === LOGGED_IN
    && typeof account['scopes'] === 'string'
    && account['scopes'].split(',').map((scope) => scope.trim())
      .includes(PROJECT_SCOPE)));
}

/** The scope part, read off `gh auth status`; see the module note. */
export async function readScopePart(gh: GhRunner): Promise<ProjectPart> {
  const command = `gh ${SCOPE_ARGS.join(' ')}`;
  const result = await gh(SCOPE_ARGS);
  if (!result.ok) {
    const written = result.stderr.trim() || result.stdout.trim() || 'it wrote nothing';
    return partOf('scope', SCOPE_PART, 'refused', `${command} failed: ${written}; ${scopeDetail()}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    return partOf('scope', SCOPE_PART, 'refused', `${command} wrote output that is not JSON: ${messageOf(error)}`);
  }
  const hosts = isMapping(payload)
    ? payload['hosts']
    : null;
  return holdsProjectScope(hosts)
    ? partOf('scope', SCOPE_PART, 'present', `the gh token holds the \`${PROJECT_SCOPE}\` scope`)
    : partOf('scope', SCOPE_PART, 'refused', scopeDetail());
}

/** A project URL's owner and number, or null for one that is not `https://github.com/(orgs|users)/<owner>/projects/<n>`. */
export function projectRefOf(url: string): ProjectRef | null {
  const match = /^https:\/\/github\.com\/(?:orgs|users)\/([A-Za-z0-9][A-Za-z0-9-]*)\/projects\/([1-9]\d*)$/u.exec(url);
  if (match === null) return null;
  return { owner: match[1] ?? '', number: Number.parseInt(match[2] ?? '', 10) };
}

/** What the copy part came to: the part, and the project the later parts run on. */
interface CopyStep {
  readonly part: ProjectPart;
  readonly project: Project | null;
}

/** Copies the template to `owner` and links `repository` to the copy; see the module note. */
async function copyTemplate(port: ProjectPort, config: ProjectSetupConfig, repository: string, owner: string): Promise<CopyStep> {
  const template = config.boardProjectTemplate;
  const ref = projectRefOf(template);
  if (ref === null) {
    return { part: partOf('project', COPY_PART, 'refused', `board.project.template is ${template}, not a project URL`), project: null };
  }
  const found = await port.find(ref);
  if (found === null) {
    const why = `the template ${template} was not found; set board.project.template to a project the gh account can read`;
    return { part: partOf('project', COPY_PART, 'refused', why), project: null };
  }
  const title = repository.split('/')[1] ?? repository;
  const project = await port.copy({ templateId: found.id, owner, title });
  const copied = `copied ${template} to ${project.url}, titled ${title}`;
  try {
    await port.link(project.id, repository);
  } catch (error) {
    return { part: partOf('project', COPY_PART, 'refused', `${copied}, but ${repository} was not linked: ${refusalOf(error)}`), project };
  }
  return { part: partOf('project', COPY_PART, 'created', `${copied}, and linked ${repository}`), project };
}

/** The copy part: the project `board.project.number` names when the owner holds it, else a new copy. */
async function copyStep(port: ProjectPort, config: ProjectSetupConfig, repository: string): Promise<CopyStep> {
  const owner = repository.split('/')[0] ?? '';
  try {
    const number = config.boardProjectNumber;
    const held = number === null
      ? null
      : await port.find({ owner, number });
    if (held !== null) return { part: partOf('project', COPY_PART, 'present', held.url), project: held };
    return await copyTemplate(port, config, repository, owner);
  } catch (error) {
    return { part: partOf('project', COPY_PART, 'refused', refusalOf(error)), project: null };
  }
}

/** The issue numbers of `repository` that `items` holds. */
function heldIssues(items: readonly ProjectItem[], repository: string): ReadonlySet<number> {
  const wanted = repository.toLowerCase();
  return new Set(items.flatMap(({ content }) => (content.kind === 'issue' && content.repository.toLowerCase() === wanted
    ? [content.number]
    : [])));
}

/** `issues`, or the one issue, as a sentence counts them. */
function issueCount(count: number): string {
  return count === 1
    ? '1 issue'
    : `${String(count)} issues`;
}

/** The issues the project should hold and does not, lowest number first; see the module note. */
async function missingIssues(options: ProjectSetupOptions, repository: string, project: Project): Promise<readonly number[]> {
  const { config, gh } = options;
  const board = await readRefreshBoard(config, gh, repository);
  const held = heldIssues(await createGhProjectPort(gh).items(project.id), repository);
  const ranked = board.closed.filter((issue) => rankOf(board.ranks, issue) !== null);
  const unread = board.closed.filter((issue) => rankOf(board.ranks, issue) === null && !held.has(issue));
  const facts = await readIssueFacts({ gh, fragments: config.releaseFragments }, unread);
  const inReview = unread.filter((issue) => {
    const read = facts.get(issue);
    return read !== undefined && stageOf(read) === 'In review';
  });
  return [...new Set([...board.open, ...ranked, ...inReview])]
    .filter((issue) => !held.has(issue))
    .sort((a, b) => a - b);
}

/** The add-the-issues part over `project`; see the module note. */
async function itemsStep(options: ProjectSetupOptions, repository: string, project: Project): Promise<ProjectPart> {
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  let missing: readonly number[];
  try {
    missing = await missingIssues(options, repository, project);
  } catch (error) {
    return partOf('items', ITEMS_PART, 'refused', `the issues to add could not be read: ${refusalOf(error)}`);
  }
  if (missing.length === 0) return partOf('items', ITEMS_PART, 'present', 'the project holds every issue it shows');

  const port = createGhProjectPort(options.gh);
  let added = 0;
  try {
    for (const number of missing) {
      if (added > 0) await sleep(PROJECT_WRITE_PAUSE_MS);
      await port.addItem(project.id, { repository, number });
      added += 1;
    }
  } catch (error) {
    const went = `${issueCount(added)} of ${String(missing.length)} added`;
    return partOf('items', ITEMS_PART, 'refused', `${went}, then #${String(missing[added])} was refused: ${refusalOf(error)}; run \`${PROJECT_STEP_FIX}\` to add the rest`);
  }
  return partOf('items', ITEMS_PART, 'created', `added ${issueCount(added)} to the project`);
}

/** What the fill part came to: the part, and the lines of the fields it skipped. */
interface FieldsStep {
  readonly part: ProjectPart;
  readonly problems: readonly string[];
}

/** The fill-the-fields part: the refresh over every item of `project`; see the module note. */
async function fieldsStep(options: ProjectSetupOptions, project: Project): Promise<FieldsStep> {
  const config: RefreshConfig = { ...options.config, boardProjectNumber: project.number };
  const refreshOptions: RefreshOptions = options.sleep === undefined
    ? { config, gh: options.gh }
    : { config, gh: options.gh, sleep: options.sleep };
  let refreshed: ProjectRefresh;
  try {
    refreshed = await refreshProjectItems(refreshOptions, [], { everyItem: true });
  } catch (error) {
    return { part: partOf('fields', FIELDS_PART, 'refused', refusalOf(error)), problems: [] };
  }
  if (refreshed.kind === 'refused') return { part: partOf('fields', FIELDS_PART, 'refused', scopeDetail()), problems: [] };
  if (refreshed.kind !== 'refreshed') {
    return { part: partOf('fields', FIELDS_PART, 'refused', refreshed.warnings.join(' ') || 'the refresh sent no call'), problems: [] };
  }
  const { writes, changes, skipped } = refreshed;
  const problems = refreshed.warnings.slice(writes.rateLimited
    ? 1
    : 0);
  if (writes.rateLimited) {
    return { part: partOf('fields', FIELDS_PART, 'refused', rateLimitWarning(writes.notUpdated)), problems };
  }
  if (changes.length === 0) {
    const held = skipped.length === 0
      ? 'every value is as the rules give it'
      : 'every value written is as the rules give it';
    return { part: partOf('fields', FIELDS_PART, 'present', held), problems };
  }
  const issues = new Set(changes.map(({ issue }) => issue)).size;
  const values = writes.written === 1
    ? '1 value'
    : `${String(writes.written)} values`;
  return { part: partOf('fields', FIELDS_PART, 'created', `wrote ${values} to ${issueCount(issues)}`), problems };
}

/** The parts after a copy part that found or made `project`. */
async function onProject(options: ProjectSetupOptions, repository: string, project: Project): Promise<{ parts: readonly ProjectPart[]; problems: readonly string[] }> {
  const items = await itemsStep(options, repository, project);
  const fields = await fieldsStep(options, project);
  const setting = writeProjectNumber(options.root, project.number);
  return { parts: [items, fields.part, setting], problems: fields.problems };
}

/**
 * Copies, links, fills and saves the repository's project, reporting
 * each of the five parts of the module note. Never throws for a `gh`
 * call that failed or a file that would not take a write: those are
 * refused parts.
 */
export async function setUpProject(options: ProjectSetupOptions): Promise<ProjectSetupReport> {
  const { gh, config } = options;
  const scope = await readScopePart(gh);
  if (scope.outcome === 'refused') {
    return { parts: [scope, ...notTried(['project', 'items', 'fields', 'setting'], 'the gh token has no project scope')], project: null, problems: [] };
  }
  let repository: string;
  try {
    repository = await readBoardRepository(gh);
  } catch (error) {
    const why = messageOf(error);
    return { parts: [scope, partOf('project', COPY_PART, 'refused', why), ...notTried(['items', 'fields', 'setting'], 'no project')], project: null, problems: [] };
  }
  const copied = await copyStep(createGhProjectPort(gh), config, repository);
  if (copied.project === null) {
    return { parts: [scope, copied.part, ...notTried(['items', 'fields', 'setting'], 'no project')], project: null, problems: [] };
  }
  const { project } = copied;
  const rest = await onProject(options, repository, project);
  return {
    parts: [scope, copied.part, ...rest.parts],
    project: { owner: project.owner, number: project.number, url: project.url },
    problems: rest.problems,
  };
}

/** True when any part of `report` was created, so the step wrote something. */
export function projectSetupChanged(report: ProjectSetupReport): boolean {
  return report.parts.some((part) => part.outcome === 'created');
}

/** The heading the part rows sit under. */
export const PROJECT_HEADING = 'GitHub project:';

/** How wide an outcome column is, as the board's rows have it: `created`, `present` and `refused` are each seven. */
const OUTCOME_WIDTH = 7;

/** One part as a row: its detail too, unless it was already present, as a board row has it. */
export function projectPartLine(part: ProjectPart): string {
  const row = `  ${part.outcome.padEnd(OUTCOME_WIDTH, ' ')}  ${part.name}`;
  return part.outcome === 'present'
    ? row
    : `${row}: ${part.detail}`;
}

/** The lines text mode writes for the step: the heading, a row per part, then each problem. */
export function renderProjectSetup(report: ProjectSetupReport): readonly string[] {
  return [PROJECT_HEADING, ...report.parts.map((part) => projectPartLine(part)), ...report.problems];
}

/** The step's one question, asked after the board, the epic guard and the relationships move. */
export const PROJECT_QUESTION = 'Also create a GitHub project with roadmap and kanban views? [y/N] ';

/** What the project step came to. */
export type ProjectStepStatus =
  /** {@link setUpProject} ran, and `report` says what each part came to. */
  | 'ran'
  /** `--no-project`, or its question answered with anything but yes. */
  | 'declined'
  /** Nobody said and there was no terminal to ask on. */
  | 'unasked'
  /** The board step did not run, so neither did this one. */
  | 'not-run';

/** What one run of {@link runProjectStep} came to. */
export interface ProjectStepResult {
  readonly status: ProjectStepStatus;
  /** True when its question was put to an operator. */
  readonly asked: boolean;
  /** What the five parts came to, or null when the step did not run. */
  readonly report: ProjectSetupReport | null;
  /** A sentence per flag the step could not act on. */
  readonly warnings: readonly string[];
}

/** What {@link runProjectStep} is asked. */
export interface ProjectStepOptions {
  /** True for `--project`, false for `--no-project`, null when the line said neither. */
  readonly wanted: boolean | null;
  /** What the board step came to; the project runs only after a board that ran. */
  readonly board: BoardStepResult;
  /** The project root: where `roadmap.issue` is read back and `board.project.number` written. */
  readonly root: string;
  /** The config as `init` resolved it before the board step wrote `roadmap.issue`. */
  readonly config: ProjectSetupConfig;
  /** Opens the runner every `gh` command goes through. Called only once the step runs. */
  readonly openGh: () => GhRunner;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
  /** Sets the project up; {@link setUpProject} when left out. */
  readonly setUp?: (options: ProjectSetupOptions) => Promise<ProjectSetupReport>;
}

/** What a line asking for `--project` is told when the board step did not run. */
export const PROJECT_NO_BOARD_WARNING = '--project creates the GitHub project with the GitHub board,'
  + ` and the board step did not run, so no project was created; run ${PROJECT_STEP_FIX}.`;

/** A project step that set nothing up. */
function noProject(status: ProjectStepStatus, asked: boolean, warnings: readonly string[] = []): ProjectStepResult {
  return { status, asked, report: null, warnings: Object.freeze([...warnings]) };
}

/** Asks the step's question; true only for `y` or `yes`, and the prompter closed either way. */
async function askProject(openPrompter: () => Prompter): Promise<boolean> {
  const prompter = openPrompter();
  try {
    const answer = await prompter.ask(PROJECT_QUESTION);
    return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/**
 * `config` with the `roadmap.issue` the board step may just have written
 * read back off the file, so the Ranks come off the Roadmap issue this
 * run opened rather than a search for it.
 */
function withWrittenRoadmap(root: string, config: ProjectSetupConfig): ProjectSetupConfig {
  const written = readRoadmapSetting(root).issue;
  return written === null
    ? config
    : { ...config, roadmapIssue: written };
}

/**
 * The project step of `rafa init`, having decided whether to run it and
 * asked when nobody said. The first answer wins: a board that did not
 * run (warning only when `--project` asked), `--no-project`,
 * `--project`, no terminal, then the question. Never throws for a `gh`
 * call that failed: {@link setUpProject} reports those as refused parts.
 */
export async function runProjectStep(options: ProjectStepOptions): Promise<ProjectStepResult> {
  const { wanted, board, root, isTerminal, openPrompter } = options;
  if (board.status !== 'ran') {
    return noProject('not-run', false, wanted === true
      ? [PROJECT_NO_BOARD_WARNING]
      : []);
  }
  if (wanted === false) return noProject('declined', false);

  const run = async (asked: boolean): Promise<ProjectStepResult> => {
    const setUp = options.setUp ?? setUpProject;
    const report = await setUp({ root, config: withWrittenRoadmap(root, options.config), gh: options.openGh() });
    return { status: 'ran', asked, report, warnings: [] };
  };
  if (wanted === true) return run(false);
  if (!isTerminal()) return noProject('unasked', false);
  return await askProject(openPrompter)
    ? run(true)
    : noProject('declined', true);
}

/** True when the project step created any part. */
export function projectStepChanged(result: ProjectStepResult): boolean {
  return result.report !== null && projectSetupChanged(result.report);
}

/** The lines text mode writes for the project step, and none when it has nothing to say. */
export function renderProjectStep(result: ProjectStepResult): readonly string[] {
  if (result.report !== null) return renderProjectSetup(result.report);
  if (result.status === 'declined') return [`The GitHub project was left out; run ${PROJECT_STEP_FIX} to create it.`];
  if (result.status === 'unasked') return [`The GitHub project question needs a terminal; run ${PROJECT_STEP_FIX} to create it.`];
  return [];
}
