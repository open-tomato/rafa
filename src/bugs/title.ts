/**
 * The title template (#951): one string that renders an issue's title
 * from its fields and reads a title back into them.
 *
 * ## The syntax
 *
 *   - `${name}` prints a variable, one of {@link TITLE_VARIABLES}.
 *   - `?( … )` is an optional group. It prints only when every variable
 *     DIRECTLY inside it is printable ({@link isPrintable}): a group
 *     nested in it decides for itself. A separator goes inside its group,
 *     so a missing value takes its separator with it.
 *   - Anything else is text. A `)` outside every group is text too.
 *
 * `null`, `undefined`, a blank string, the word `unknown` and anything
 * that is no string are not printable. The issue's id is no variable: a
 * tracker assigns it after the title is written, and a listing prints it
 * as a column of its own.
 *
 * ## Reading back
 *
 * {@link parseTitle} turns the same template into a pattern: text is
 * matched as written, a group is optional, and each variable is a named
 * capture. `module` and `action` are read with the shape their values
 * are held to ({@link MODULE_SHAPE}, {@link ACTION_SHAPE}), and the last
 * variable reads the rest, so a `: ` inside the summary never splits it.
 *
 * One limit stays. Under the default template a summary shaped
 * `<word>: …`, filed with no module, reads back with that word as its
 * module. {@link titleRoundTrips} reports it, and the record check
 * (`./record.ts`) refuses such a bug, naming the title.
 *
 * {@link templateProblem} is what a config reader calls: it refuses a
 * template that cannot be parsed, one whose summary is not the last
 * variable outside every group, and one whose own titles do not read
 * back, tried over every way of leaving its other variables out.
 */

/** Every variable a template may name. */
export const TITLE_VARIABLES = ['type', 'project', 'projectType', 'module', 'action', 'summary'] as const;

/** One variable's name. */
export type TitleVariable = (typeof TITLE_VARIABLES)[number];

/** The values a title is rendered from, and the ones read back from it. */
export type TitleValues = { readonly [K in TitleVariable]?: string | null };

/** One part of a parsed template. */
export type TitleNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'variable'; readonly name: TitleVariable }
  | { readonly kind: 'group'; readonly nodes: readonly TitleNode[] };

/** The word a filer writes for a field it cannot tell. Never printed in a title. */
export const UNKNOWN_VALUE = 'unknown';

/** The template a bug's title is rendered with when the config names none. */
export const DEFAULT_BUG_TITLE = '?(${module}?( - ${action}): )${summary}';

/** What a module name looks like, as a pattern source with no anchors. */
export const MODULE_SHAPE = '[a-z0-9][a-z0-9._-]*';

/** What an action looks like: a module's shape, spaces allowed. */
export const ACTION_SHAPE = '[a-z0-9][a-z0-9._ -]*';

/** The variable that must close a template, and reads the rest of a title. */
const SUMMARY: TitleVariable = 'summary';

/** The shape a variable is read back with; any other reads any text. */
const VARIABLE_SHAPES: { readonly [K in TitleVariable]?: string } = { module: MODULE_SHAPE, action: ACTION_SHAPE };

/** What a variable with no shape of its own reads. */
const FREE_SHAPE = '.+';

/** What opens an optional group. */
const GROUP_OPEN = '?(';

/** What closes the innermost open group. */
const GROUP_CLOSE = ')';

/** What opens a variable. */
const VARIABLE_OPEN = '${';

/** What closes a variable. */
const VARIABLE_CLOSE = '}';

/** A template that cannot be parsed; its message says why. */
export class TitleTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TitleTemplateError';
  }
}

/** True for a value a title prints: a string that is not blank and not `unknown`. */
export function isPrintable(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== UNKNOWN_VALUE;
}

/** True for the name of a variable. */
function isTitleVariable(name: string): name is TitleVariable {
  return (TITLE_VARIABLES as readonly string[]).includes(name);
}

/** The nodes one reading answered, and where the next one starts. */
interface NodesRead {
  readonly nodes: readonly TitleNode[];
  readonly next: number;
}

/** The variable opening at `at`, and where the text after it starts. */
function readVariable(template: string, at: number): { readonly node: TitleNode; readonly next: number } {
  const close = template.indexOf(VARIABLE_CLOSE, at);
  if (close === -1) throw new TitleTemplateError(`"${VARIABLE_OPEN}" at ${at} is never closed`);
  const name = template.slice(at + VARIABLE_OPEN.length, close);
  if (!isTitleVariable(name)) {
    throw new TitleTemplateError(`\${${name}} names no variable, expected one of: ${TITLE_VARIABLES.join(', ')}`);
  }
  return { node: { kind: 'variable', name }, next: close + VARIABLE_CLOSE.length };
}

/** The nodes from `start` to the end, or to the `)` closing the group at `depth`. */
function readNodes(template: string, start: number, depth: number): NodesRead {
  const nodes: TitleNode[] = [];
  let text = '';
  let at = start;
  const flush = (): void => {
    if (text !== '') nodes.push({ kind: 'text', text });
    text = '';
  };
  while (at < template.length) {
    if (template.startsWith(GROUP_OPEN, at)) {
      flush();
      const inner = readNodes(template, at + GROUP_OPEN.length, depth + 1);
      nodes.push({ kind: 'group', nodes: inner.nodes });
      at = inner.next;
    } else if (depth > 0 && template[at] === GROUP_CLOSE) {
      flush();
      return { nodes, next: at + GROUP_CLOSE.length };
    } else if (template.startsWith(VARIABLE_OPEN, at)) {
      flush();
      const variable = readVariable(template, at);
      nodes.push(variable.node);
      at = variable.next;
    } else {
      text += template[at];
      at += 1;
    }
  }
  if (depth > 0) throw new TitleTemplateError(`a "${GROUP_OPEN}" group is never closed`);
  flush();
  return { nodes, next: at };
}

/** A template's nodes. Throws a {@link TitleTemplateError} for one that cannot be read. */
export function parseTitleTemplate(template: string): readonly TitleNode[] {
  return readNodes(template, 0, 0).nodes;
}

/** Every variable under `nodes`, groups included, in the order written. */
function variablesOf(nodes: readonly TitleNode[]): readonly TitleVariable[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'variable') return [node.name];
    return node.kind === 'group'
      ? variablesOf(node.nodes)
      : [];
  });
}

/** True when every variable directly inside a group is printable. */
function groupShows(nodes: readonly TitleNode[], values: TitleValues): boolean {
  return nodes.every((node) => node.kind !== 'variable' || isPrintable(values[node.name]));
}

/** What a variable prints: its value without the space around it, or nothing. */
function printed(values: TitleValues, name: TitleVariable): string {
  const value = values[name];
  return isPrintable(value)
    ? value.trim()
    : '';
}

/** The values `nodes` would print, by variable. */
function shownValues(nodes: readonly TitleNode[], values: TitleValues): Readonly<Record<string, string>> {
  return Object.fromEntries(nodes.flatMap((node): (readonly [string, string])[] => {
    if (node.kind === 'text') return [];
    if (node.kind === 'variable') {
      return printed(values, node.name) === ''
        ? []
        : [[node.name, printed(values, node.name)]];
    }
    return groupShows(node.nodes, values)
      ? Object.entries(shownValues(node.nodes, values))
      : [];
  }));
}

/** What `nodes` print for `values`. */
function renderNodes(nodes: readonly TitleNode[], values: TitleValues): string {
  return nodes.map((node) => {
    if (node.kind === 'text') return node.text;
    if (node.kind === 'variable') return printed(values, node.name);
    return groupShows(node.nodes, values)
      ? renderNodes(node.nodes, values)
      : '';
  }).join('');
}

/** The title `template` renders from `values`. Throws for a template that cannot be read. */
export function renderTitle(template: string, values: TitleValues): string {
  return renderNodes(parseTitleTemplate(template), values).trim();
}

/** `text` matched literally inside a regular expression. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern source `nodes` read a title with; `last` reads the rest. */
function patternOf(nodes: readonly TitleNode[], last: TitleVariable | undefined): string {
  return nodes.map((node) => {
    if (node.kind === 'text') return escapeLiteral(node.text);
    if (node.kind === 'group') return `(?:${patternOf(node.nodes, last)})?`;
    const shape = node.name === last
      ? FREE_SHAPE
      : `${VARIABLE_SHAPES[node.name] ?? FREE_SHAPE}?`;
    return `(?<${node.name}>${shape})`;
  }).join('');
}

/**
 * The values `title` holds under `template`, or null when it does not
 * fit. Throws for a template that cannot be read, or that names a
 * variable twice. See the module note.
 */
export function parseTitle(template: string, title: string): TitleValues | null {
  const nodes = parseTitleTemplate(template);
  const names = variablesOf(nodes);
  const match = new RegExp(`^${patternOf(nodes, names.at(-1))}$`, 'u').exec(title.trim());
  if (match === null) return null;
  return Object.fromEntries(names.flatMap((name): (readonly [string, string])[] => {
    const value = match.groups?.[name];
    return value === undefined
      ? []
      : [[name, value]];
  }));
}

/** True when the title rendered from `values` reads back as the values it printed. */
export function titleRoundTrips(template: string, values: TitleValues): boolean {
  const nodes = parseTitleTemplate(template);
  const title = renderNodes(nodes, values).trim();
  if (title === '') return false;
  const read: Readonly<Record<string, string | null | undefined>> = parseTitle(template, title) ?? {};
  const shown = shownValues(nodes, values);
  return variablesOf(nodes).every((name) => (read[name] ?? null) === (shown[name] ?? null));
}

/** Values every variable can print, the summary holding a `: ` and opening with a capital. */
const SAMPLE: Readonly<Record<TitleVariable, string>> = {
  type: 'bug',
  project: 'api',
  projectType: 'cli',
  module: 'loop',
  action: 'start',
  summary: 'Does not find the branch: again',
};

/** Every way of leaving some of `names` out, the summary always in. */
function samplesOf(names: readonly TitleVariable[]): readonly TitleValues[] {
  const optional = names.filter((name) => name !== SUMMARY);
  const subsets = optional.reduce<readonly (readonly TitleVariable[])[]>(
    (found, name) => [...found, ...found.map((subset) => [...subset, name])],
    [[]],
  );
  return subsets.map((subset) => Object.fromEntries([...subset, SUMMARY].map((name) => [name, SAMPLE[name]])));
}

/** Why the nodes of a template that parsed cannot be used, or null. */
function nodesProblem(template: string, nodes: readonly TitleNode[]): string | null {
  const names = variablesOf(nodes);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) return `\${${twice}} appears twice`;
  if (names.at(-1) !== SUMMARY) return `\${${SUMMARY}} must be the last variable`;
  if (!nodes.some((node) => node.kind === 'variable' && node.name === SUMMARY)) {
    return `\${${SUMMARY}} must stand outside every ?( ) group`;
  }
  const failed = samplesOf(names).find((sample) => !titleRoundTrips(template, sample));
  return failed === undefined
    ? null
    : `the title ${JSON.stringify(renderTitle(template, failed))} does not read back as the fields it was rendered from`;
}

/** Why `template` cannot be used, or null when it can. See the module note. */
export function templateProblem(template: string): string | null {
  try {
    return nodesProblem(template, parseTitleTemplate(template));
  } catch (error) {
    if (error instanceof TitleTemplateError) return error.message;
    throw error;
  }
}
