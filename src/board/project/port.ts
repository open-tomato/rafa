/**
 * The project port: the one interface every reader of the repository's
 * GitHub project goes through (`.rafa/specs/rafa-791-github-project-each-repository.md`).
 * The project is a MIRROR of the issues' labels, pull requests and the
 * Roadmap checklists; nothing read here is ever a source of truth.
 *
 * The interface lives here and its `gh api graphql` adapter in `./gh.ts`,
 * the way `../relations/port.ts` and its adapters split, so a caller
 * holds a {@link ProjectPort} and never assembles a `gh` argv itself.
 * Every call needs the `project` token scope (`gh auth refresh -s
 * project` adds it).
 *
 * ## Reads
 *
 * {@link ProjectPort.find} finds a project by its owner's login and its
 * number, answering its fields with their options; null when the owner
 * holds no project of that number, or there is no such owner.
 * {@link ProjectPort.items} lists every item of a project with the values
 * it holds, read page by page.
 *
 * ## Writes
 *
 * {@link ProjectPort.copy} copies the template to an owner under a title,
 * answering the new project as the find reads it; its draft issues are
 * left behind. {@link ProjectPort.link} links a repository to a project,
 * so the project shows on the repository's Projects tab.
 * {@link ProjectPort.addItem} adds an issue or a pull request to a
 * project, answering the item's node id. Each names its owner, repository
 * or issue the way a caller holds it, by login, `owner/name` and number,
 * and the adapter reads the node id the mutation needs first, so each
 * write is two `gh` calls. Setting and clearing an item's fields is not
 * here: `./writes.ts` batches them, {@link PROJECT_WRITE_BATCH_SIZE} to a
 * request, {@link PROJECT_WRITE_PAUSE_MS} apart.
 *
 * ## Fields and options by exact name
 *
 * rafa finds the five fields of the template (`board.project.template`)
 * and their select options by their EXACT names: no case folding, no
 * trimming. {@link PROJECT_FIELDS} names them, Stage's and Horizon's
 * options spelled once in `./options.ts` ({@link STAGE_OPTIONS},
 * {@link HORIZON_OPTIONS}). {@link matchProjectFields} reads a project's
 * fields against them: a field matches when one of that name has the
 * expected type and every expected option; any other is a
 * {@link FieldMismatch}, whose field is skipped while the rest are
 * written. A project may hold more fields, and a select more options,
 * than the template: they are passed over.
 *
 * Measured with `gh` 2.100.0 on 2026-10-06, read-only, against the
 * template (`https://github.com/orgs/open-tomato/projects/6`): it answered
 * thirteen built-in fields (Title, Assignees, Status, Labels, ...) before
 * the five, Stage and Horizon as `ProjectV2SingleSelectField` with
 * `dataType` `SINGLE_SELECT`, Rank as `NUMBER`, Blocked by and Progress as
 * `TEXT`, each option with an eight-hex-digit id.
 *
 * ## Refusals
 *
 * A failed `gh` call, an answer that is not the recorded shape, and a
 * list longer than the one page read where one page is all there is (a
 * project's fields, an item's values) reject with a
 * {@link ProjectPortError}, whose {@link ProjectPortError.detail} keeps
 * what `gh` wrote so a caller can tell a missing scope from a rate limit
 * without the port deciding it. Only a project that is not there answers
 * null rather than rejecting: a write naming an owner, a repository or an
 * issue that is not there rejects.
 */
import { HORIZON_OPTIONS, STAGE_OPTIONS } from './options.js';

/**
 * GitHub's largest page for a GraphQL connection: a project's fields, a
 * page of its items, and an item's values are each read at this size.
 * A page of 100 items with 100 values each cost 1 point of the hourly
 * budget, read off `rateLimit { cost }` on 2026-10-06.
 */
export const PROJECT_PAGE_SIZE = 100;

/**
 * How many field writes `./writes.ts` sends in one GraphQL request, each
 * an aliased mutation. Not a reading: whether GitHub counts a request of
 * several mutations once or once per mutation against its per-minute and
 * per-hour write limits was not measured (the spec's "Write volume is
 * unmeasured"), so a first fill of about 400 writes goes as 20 requests.
 */
export const PROJECT_WRITE_BATCH_SIZE = 20;

/**
 * The pause `./writes.ts` takes between two write requests, in
 * milliseconds: GitHub's documentation on secondary rate limits asks for
 * at least one second between mutating requests. Not a reading either.
 */
export const PROJECT_WRITE_PAUSE_MS = 1_000;

/** What every refusal opens with. */
export const PROJECT_PORT_PREFIX = 'board project';

/** The `dataType` GitHub answers for each kind of field rafa writes. */
export const FIELD_DATA_TYPES = Object.freeze({
  singleSelect: 'SINGLE_SELECT',
  number: 'NUMBER',
  text: 'TEXT',
} as const);

/** A `dataType` rafa writes. */
export type WrittenDataType = (typeof FIELD_DATA_TYPES)[keyof typeof FIELD_DATA_TYPES];

/** One field of the template, as rafa expects to find it. */
export interface TemplateField {
  /** How code names it; never shown. */
  readonly key: ProjectFieldKey;
  /** Its exact name on the project. */
  readonly name: string;
  readonly dataType: WrittenDataType;
  /** Its options, left to right, by exact name; empty unless a single select. */
  readonly options: readonly string[];
}

/** The five fields rafa writes. */
export type ProjectFieldKey = 'stage' | 'horizon' | 'rank' | 'blockedBy' | 'progress';

/** The five fields of the template, in the order the spec's table lists them. */
export const PROJECT_FIELDS: readonly TemplateField[] = Object.freeze([
  { key: 'stage', name: 'Stage', dataType: FIELD_DATA_TYPES.singleSelect, options: STAGE_OPTIONS },
  { key: 'horizon', name: 'Horizon', dataType: FIELD_DATA_TYPES.singleSelect, options: HORIZON_OPTIONS },
  { key: 'rank', name: 'Rank', dataType: FIELD_DATA_TYPES.number, options: [] },
  { key: 'blockedBy', name: 'Blocked by', dataType: FIELD_DATA_TYPES.text, options: [] },
  { key: 'progress', name: 'Progress', dataType: FIELD_DATA_TYPES.text, options: [] },
]);

/** A project as {@link ProjectPort.find} names it: its owner's login and its number. */
export interface ProjectRef {
  /** The login of the organization or user holding it, e.g. `open-tomato`. */
  readonly owner: string;
  readonly number: number;
}

/** One option of a single-select field. */
export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

/** One field of a project, built-in or custom. */
export interface ProjectField {
  readonly id: string;
  readonly name: string;
  /** GitHub's `ProjectV2FieldType`, e.g. `TITLE`, `SINGLE_SELECT`, `NUMBER`, `TEXT`. */
  readonly dataType: string;
  /** Its options, in the project's order, for a single select; null for any other field. */
  readonly options: readonly ProjectOption[] | null;
}

/** A project, as {@link ProjectPort.find} reads it. */
export interface Project extends ProjectRef {
  /** Its node id, the one every later call names it by. */
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly closed: boolean;
  readonly public: boolean;
  /** Every field, in the project's order. */
  readonly fields: readonly ProjectField[];
}

/** The value an item holds in one single-select, number or text field. */
export type ProjectFieldValue =
  | { readonly kind: 'option'; readonly optionId: string; readonly name: string }
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'text'; readonly text: string };

/** What an item stands for. */
export type ProjectItemContent =
  | { readonly kind: 'issue' | 'pull-request'; readonly number: number; readonly repository: string }
  | { readonly kind: 'draft' }
  /** An item whose content the token may not read. */
  | { readonly kind: 'redacted' };

/** One item of a project, with the values it holds. */
export interface ProjectItem {
  /** Its node id, the one a field write names. */
  readonly id: string;
  readonly archived: boolean;
  readonly content: ProjectItemContent;
  /**
   * Its single-select, number and text values, by the exact name of their
   * field: Title among them, since GitHub answers the title as a text
   * value. A field the item holds no value in has no key.
   */
  readonly values: ReadonlyMap<string, ProjectFieldValue>;
}

/** What {@link ProjectPort.copy} copies, and where to. */
export interface ProjectCopy {
  /** The node id of the project copied, as {@link ProjectPort.find} read it. */
  readonly templateId: string;
  /** The login of the organization or user the copy goes to. */
  readonly owner: string;
  /** The copy's title. */
  readonly title: string;
}

/** An issue or a pull request, as {@link ProjectPort.addItem} names it. */
export interface ProjectContentRef {
  /** Its repository, `owner/name`. */
  readonly repository: string;
  readonly number: number;
}

/** The reads and writes of a project. See the module note. */
export interface ProjectPort {
  /** The project `ref` names, or null when its owner holds none of that number, or there is no such owner. */
  find(ref: ProjectRef): Promise<Project | null>;
  /** Every item of the project whose node id is `projectId`, in the project's order. */
  items(projectId: string): Promise<readonly ProjectItem[]>;
  /** Copies the template, without its draft issues, answering the new project. */
  copy(request: ProjectCopy): Promise<Project>;
  /** Links `repository` (`owner/name`) to the project whose node id is `projectId`. */
  link(projectId: string, repository: string): Promise<void>;
  /** Adds the issue or pull request `content` names to the project `projectId`, answering the item's node id. */
  addItem(projectId: string, content: ProjectContentRef): Promise<string>;
}

/** A refusal of the port; see the module note. */
export class ProjectPortError extends Error {
  /** What `gh` wrote, or the part of the answer refused; empty when there was nothing. */
  readonly detail: string;

  constructor(problem: string, detail = '') {
    super(`${PROJECT_PORT_PREFIX}: ${problem}`);
    this.name = 'ProjectPortError';
    this.detail = detail;
  }
}

/** A template field found on the project, its options by name. */
export interface MatchedField {
  readonly template: TemplateField;
  readonly field: ProjectField;
  /** Each expected option's id, by its exact name; empty unless a single select. */
  readonly options: ReadonlyMap<string, string>;
}

/** A template field the project does not hold as expected. */
export interface FieldMismatch {
  readonly template: TemplateField;
  /** No field of that name; one of another type; or one missing options. */
  readonly problem: 'missing' | 'type' | 'options';
  /** The expected options the field lacks, in the template's order; empty unless `options`. */
  readonly missingOptions: readonly string[];
  /** One sentence naming the field and what is wrong with it. */
  readonly sentence: string;
}

/** How a project's fields read against the template. */
export interface FieldMatch {
  /** The fields found as expected, in {@link PROJECT_FIELDS} order. */
  readonly matched: readonly MatchedField[];
  /** The others, in {@link PROJECT_FIELDS} order. */
  readonly mismatched: readonly FieldMismatch[];
}

/** The project's field named exactly `name`, or null; the first, should two share it. */
export function fieldByName(project: Pick<Project, 'fields'>, name: string): ProjectField | null {
  return project.fields.find((field) => field.name === name) ?? null;
}

/** The option of `field` named exactly `name`, or null; the first, should two share it. */
export function optionByName(field: ProjectField, name: string): ProjectOption | null {
  return field.options?.find((option) => option.name === name) ?? null;
}

/** How one template field reads on `project`. */
function matchField(project: Pick<Project, 'fields'>, template: TemplateField): MatchedField | FieldMismatch {
  const field = fieldByName(project, template.name);
  if (field === null) {
    return { template, problem: 'missing', missingOptions: [], sentence: `The project has no field named "${template.name}".` };
  }
  if (field.dataType !== template.dataType) {
    return {
      template,
      problem: 'type',
      missingOptions: [],
      sentence: `The project's field "${template.name}" is ${field.dataType}, expected ${template.dataType}.`,
    };
  }
  const found = template.options.flatMap((name) => {
    const option = optionByName(field, name);
    return option === null
      ? []
      : [[name, option.id] as const];
  });
  const missingOptions = template.options.filter((name) => optionByName(field, name) === null);
  if (missingOptions.length > 0) {
    const named = missingOptions.map((name) => `"${name}"`).join(', ');
    return { template, problem: 'options', missingOptions, sentence: `The project's field "${template.name}" has no option ${named}.` };
  }
  return { template, field, options: new Map(found) };
}

/** Reads `project`'s fields against {@link PROJECT_FIELDS}; see the module note. */
export function matchProjectFields(project: Pick<Project, 'fields'>): FieldMatch {
  const read = PROJECT_FIELDS.map((template) => matchField(project, template));
  return {
    matched: read.filter((entry): entry is MatchedField => 'field' in entry),
    mismatched: read.filter((entry): entry is FieldMismatch => 'problem' in entry),
  };
}
