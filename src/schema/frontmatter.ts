/**
 * The one reader and the one writer for a markdown file's leading
 * `---` block, shared by everything in rafa that opens an agent
 * definition, a skill or an instinct record.
 *
 * Reading a frontmatter block is easy and was therefore written twice:
 * `utils/agent-definition.ts` had the only copy, and `agents/roster.ts`
 * and `commands/agent/vendor.ts` imported it from there, which made a
 * module about ONE agent's effort the home of a parser three unrelated
 * callers depend on. The schema needs the same parse plus a writer, so
 * both live here and `agent-definition.ts` re-exports the reader for
 * the callers that already had it.
 *
 * ## What the writer has to preserve
 *
 * A `--fix` adds `stack` or `paths` to a skill somebody else wrote,
 * and a rewrite that changed anything else about that file would be a
 * rewrite nobody could review. Three things are therefore preserved,
 * and each is preserved by a different part of {@link
 * FrontmatterDocument}:
 *
 *   - **The body, byte for byte.** {@link FrontmatterDocument.body} is
 *     the exact substring following the closing fence's line
 *     terminator, so a CRLF body stays CRLF, a body with no trailing
 *     newline gains none, and trailing whitespace inside it survives.
 *     Nothing here splits the body into lines, which is the only way
 *     that promise can be kept.
 *   - **Key order.** `Bun.YAML.parse` returns keys in document order
 *     and `Bun.YAML.stringify` emits them in insertion order — both
 *     measured on Bun 1.3.14 — so order is preserved by carrying the
 *     parsed record around unsorted. {@link mergeFrontmatter} writes an
 *     existing key in place and appends a new one at the end.
 *   - **Unknown keys.** The record is never filtered against a schema,
 *     so a skill's `user-invocable`, `disable-model-invocation` or
 *     anything else Claude Code grows next survives a rewrite this
 *     module makes for another key entirely.
 *
 * What is NOT preserved is the spelling of the values. A rendered
 * block is `Bun.YAML.stringify`'s, so a plain `description: hello`
 * stays plain but a value that needed quoting comes back quoted the
 * way that serialiser quotes, and a multi-line string comes back as
 * one escaped double-quoted scalar rather than a `|` block. {@link
 * writeFrontmatter} called with no data at all re-emits the ORIGINAL
 * block text instead, so a caller that read a file and changed nothing
 * writes the file back byte-identical.
 *
 * ## Two measured shapes of `Bun.YAML.stringify`
 *
 * Both readings are Bun 1.3.14, and both are pinned in
 * `frontmatter.test.ts` so a Bun that changes either reddens here
 * rather than in a skill file:
 *
 *   - **Block style needs an indent argument.** `Bun.YAML.stringify(o)`
 *     returns FLOW style — `{name: x,tags: [a,b]}` on one line — which
 *     is legal YAML and unreadable frontmatter. With an indent it emits
 *     one key per line, so {@link FRONTMATTER_INDENT} is passed on
 *     every call.
 *   - **A key whose value is a list or a mapping is emitted with a
 *     trailing space** (`tags: \n  - a`). {@link renderFrontmatter}
 *     strips trailing spaces and tabs line by line. That is safe
 *     because the serialiser escapes every newline inside a scalar, so
 *     no line this module strips is inside a value, and a value that
 *     genuinely ends in a space is emitted quoted (`s: "trail "`) and
 *     so ends in a quote rather than in whitespace.
 *
 * The same escaping is what lets {@link renderFrontmatter} translate
 * newlines for a CRLF document: every `\n` in the serialiser's output
 * separates lines, because a `\n` inside a value is written as the two
 * characters backslash and `n`.
 *
 * ## What reads as no frontmatter
 *
 * A text that does not open with a `---` line, one that never closes
 * the block, one whose block `Bun.YAML` refuses, and one whose block
 * is not a mapping. Each reads as null and nothing throws, which is
 * the behaviour `agent-definition.ts` measured against Claude Code and
 * documents: a definition whose frontmatter this module refuses is one
 * rafa passes over, and `description: Probe: answers one literal`
 * throws in `Bun.YAML` while the CLI dispatches it.
 */

/** The line that opens and closes a frontmatter block. */
export const FRONTMATTER_FENCE = '---';

/**
 * The indent `Bun.YAML.stringify` is called with. Any positive indent
 * selects block style; two spaces is what the corpus of skills and
 * agent definitions is written in.
 */
export const FRONTMATTER_INDENT = 2;

/** A markdown file split at its frontmatter, with every byte kept. */
export interface FrontmatterDocument {
  /** The block as `Bun.YAML` parsed it, in document key order. */
  readonly data: Readonly<Record<string, unknown>>;
  /** The block's text between the fences, byte-exact and unterminated. */
  readonly yaml: string;
  /**
   * Everything after the closing fence line, byte-exact: the whole rest
   * of the file, line endings and a missing trailing newline included.
   */
  readonly body: string;
  /** The line terminator the opening fence used, `\n` or `\r\n`. */
  readonly newline: string;
  /**
   * The terminator the closing fence used, empty when the file ended at
   * that fence with no newline at all.
   */
  readonly closingNewline: string;
}

/** One line of `text` from `offset`, and where the next one starts. */
interface ScannedLine {
  /** The line's text, without its terminator. */
  readonly line: string;
  /** The terminator, empty at the end of the text. */
  readonly newline: string;
  /** The offset the next line starts at. */
  readonly next: number;
}

/** The line at `offset`, terminated by `\n`, `\r\n` or the end of `text`. */
function scanLine(text: string, offset: number): ScannedLine {
  const index = text.indexOf('\n', offset);
  if (index === -1) {
    return { line: text.slice(offset), newline: '', next: text.length };
  }

  const carriage = index > offset && text[index - 1] === '\r';
  const end = carriage
    ? index - 1
    : index;

  return {
    line: text.slice(offset, end),
    newline: text.slice(end, index + 1),
    next: index + 1,
  };
}

/** True for a parsed YAML value that is a mapping. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The mapping `yaml` holds, or null when it is not one or will not parse. */
function parseBlock(yaml: string): Readonly<Record<string, unknown>> | null {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yaml.replace(/\r\n/g, '\n'));
  } catch {
    return null;
  }

  return isRecord(parsed)
    ? parsed
    : null;
}

/**
 * `text` split at its frontmatter, or null when it opens with no `---`
 * line, never closes the block, or holds a block that is not a YAML
 * mapping. The document's parts reconstruct `text` exactly, which
 * {@link writeFrontmatter} relies on and `frontmatter.test.ts`
 * measures.
 */
export function readFrontmatterDocument(text: string): FrontmatterDocument | null {
  const opening = scanLine(text, 0);
  if (opening.line !== FRONTMATTER_FENCE || opening.newline === '') return null;

  let offset = opening.next;
  while (offset < text.length) {
    const scanned = scanLine(text, offset);
    if (scanned.line === FRONTMATTER_FENCE) {
      const data = parseBlock(text.slice(opening.next, offset));
      return data === null
        ? null
        : {
          data,
          yaml: text.slice(opening.next, offset),
          body: text.slice(scanned.next),
          newline: opening.newline,
          closingNewline: scanned.newline,
        };
    }
    offset = scanned.next;
  }

  return null;
}

/**
 * The frontmatter `text` opens with, or null when it opens with none,
 * never closes it, or holds a body that is not a YAML mapping. The
 * reader `utils/agent-definition.ts` and `agents/roster.ts` ask with,
 * for callers that want the keys and not the file's shape.
 */
export function readFrontmatter(text: string): Readonly<Record<string, unknown>> | null {
  return readFrontmatterDocument(text)?.data ?? null;
}

/**
 * `data` as a block of YAML, one key per line, without fences and
 * without a trailing terminator. Lines are separated by `newline`, so a
 * CRLF document is rewritten in CRLF.
 */
export function renderFrontmatter(
  data: Readonly<Record<string, unknown>>,
  newline = '\n',
): string {
  return Bun.YAML.stringify(data, null, FRONTMATTER_INDENT)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join(newline);
}

/**
 * `data` with `changes` applied: a key it already carries keeps its
 * place, a key it does not is appended in the order `changes` names it,
 * and a change whose value is `undefined` removes the key. Neither
 * argument is mutated.
 */
export function mergeFrontmatter(
  data: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(changes, key)) merged[key] = value;
    else if (changes[key] !== undefined) merged[key] = changes[key];
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined && !Object.hasOwn(data, key)) merged[key] = value;
  }

  return merged;
}

/**
 * `document` as a file again: its fences, `data` rendered in place of
 * the original block, and its body byte for byte. Called with no `data`
 * it re-emits the block's original text, so reading a file and writing
 * it straight back reproduces it exactly.
 */
export function writeFrontmatter(
  document: FrontmatterDocument,
  data?: Readonly<Record<string, unknown>>,
): string {
  const block = data === undefined
    ? document.yaml
    : `${renderFrontmatter(data, document.newline)}${document.newline}`;

  return [
    FRONTMATTER_FENCE,
    document.newline,
    block,
    FRONTMATTER_FENCE,
    document.closingNewline,
    document.body,
  ].join('');
}

/**
 * `text` with `changes` applied to its frontmatter and every other byte
 * of it left alone, or null when it carries no frontmatter to change.
 * A change whose value is `undefined` removes that key.
 */
export function updateFrontmatter(
  text: string,
  changes: Readonly<Record<string, unknown>>,
): string | null {
  const document = readFrontmatterDocument(text);
  if (document === null) return null;

  return writeFrontmatter(document, mergeFrontmatter(document.data, changes));
}
