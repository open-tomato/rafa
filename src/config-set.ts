/**
 * One setting written into a project config's text by its dotted key:
 * the edit `rafa config set <key>=<value>` makes. Pure — the text comes
 * in and the text to write goes out, and the caller reads and writes the
 * file.
 *
 * The text is edited and never re-serialised, so every comment `rafa
 * init` wrote, and every comment an operator added, survives: the rule
 * `src/release/setting.ts` and `src/effort/store/move.ts` follow for
 * their one key each. This module is the same edit for any key the
 * schema knows, one or two levels deep.
 *
 * ## The three shapes the edit covers
 *
 * {@link withConfigSetting} edits one line or adds one or two:
 *
 *   - an uncommented line already setting the key is REPLACED in place,
 *     keeping its indentation and its trailing comment;
 *   - a key missing from its uncommented section is ADDED as the first
 *     line under the section line, at the indentation the section's
 *     other keys use (two spaces when it has none);
 *   - a key whose section is missing is APPENDED with the section, after
 *     the last line of the file. A one-level key is appended as one line.
 *
 * A commented line is never uncommented. `rafa init` writes every
 * setting commented at its default (`src/project/scaffold.ts`), and the
 * block a commented `# pr:` opens holds the other `pr` keys too, so
 * uncommenting the section would be uncommenting a section of several
 * settings for one of them; `src/release/setting.ts` explains why that
 * is the wrong edit. So the commented block stays as it was, and the
 * setting is appended below it.
 *
 * A top-level line spelling the dotted key itself, `pr.base: main`, is
 * read by `parseConfigText` as the setting, so it counts as the key's
 * line and is replaced like one.
 *
 * ## What it refuses
 *
 * Every refusal is a {@link ConfigSetRefusal} naming its
 * {@link ConfigSetRefusalReason}, and none leaves a text behind:
 *
 *   - `key`: a key no setting is spelled with, a section rather than a
 *     setting, or a setting three levels deep (`loop.wrapUp.retries`),
 *     which this edit does not reach;
 *   - `value`: an empty or multi-line value, or one `parseConfigText`
 *     refuses for the key when read on its own;
 *   - `config`: a text `parseConfigText` cannot read before the edit;
 *   - `duplicate`: the key, or its section, on two uncommented lines.
 *     `Bun.YAML.parse` answers the LAST of two duplicate keys and says
 *     nothing about the first (measured on bun 1.3.14), so an edit of
 *     either would read back as the new value with the key still in the
 *     file twice;
 *   - `shape`: a section written in flow style (`pr: {base: main}`), or
 *     a key the document names in a spelling no line here matches, such
 *     as a quoted key or a flow document. An appended section would read
 *     back as the right answer with the key in the file twice;
 *   - `readback`: an edited text that does not read back as the value
 *     asked for with every other setting as it was.
 *
 * ## The parse-back
 *
 * The value is read on its own first, as the only line of a minimal
 * config, so a value the key's reader refuses is refused with that
 * reader's own sentence before the file is looked at. The edited text is
 * then read through `parseConfigText`, the reader `loadConfig` uses, and
 * is answered only when the key reads as that same value and every other
 * setting and retained unknown key reads as it did before the edit. That
 * control catches a replaced line that held a block value: the block's
 * items are left orphaned and the text no longer parses. The comparison
 * of the other settings catches a value that redefines a YAML anchor: a
 * written `&b stretch/9` moves every later `*b` with it while the key
 * itself reads back right. It is the control that makes a hand-written
 * line edit safe to write.
 */
import type { ConfigSetting } from './config-schema.js';

import { knownKeysAbove, SECTIONS, SETTING_BY_KEY, SETTING_NAMES } from './config-schema.js';
import { isMapping, messageOf } from './config-sections.js';
import { parseConfigText } from './config.js';

/** The deepest key, in dotted parts, this edit sets. */
export const CONFIG_SET_MAX_DEPTH = 2;

/** Why an edit was refused. See the module note for each. */
export type ConfigSetRefusalReason = 'key' | 'value' | 'config' | 'duplicate' | 'shape' | 'readback';

/** An edit refused, naming why. Nothing is written after one. */
export class ConfigSetRefusal extends Error {
  /** Which check refused. */
  readonly reason: ConfigSetRefusalReason;

  constructor(reason: ConfigSetRefusalReason, message: string) {
    super(message);
    this.name = 'ConfigSetRefusal';
    this.reason = reason;
  }
}

/** What one edit answers. */
export interface ConfigSetEdit {
  /** The dotted key set. */
  readonly key: string;
  /** The setting the key names. */
  readonly setting: ConfigSetting;
  /** What the text set the key to before the edit, or null when it named none. */
  readonly before: unknown;
  /** What the edited text reads the key as. */
  readonly after: unknown;
  /** The text to write: the input itself when it already read the value. */
  readonly text: string;
  /** False when the text already read the value, and is answered unchanged. */
  readonly changed: boolean;
}

/** A line that is blank or a comment, which neither sets a key nor ends a block. */
const SKIPPABLE = /^\s*(#|$)/u;

/** `name` with every regular-expression metacharacter escaped. */
function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** A line setting `name` at `indent`: the indentation, then the text after the colon. */
function keyLine(name: string, indent: string): RegExp {
  return new RegExp(`^${indent}${escaped(name)}\\s*:(?=\\s|$)(.*)$`, 'u');
}

/** A character after which a quote opens a quoted scalar rather than sitting inside a plain one. */
const OPENS_QUOTE = /[\s[{,:]/u;

/**
 * Where the trailing comment of a value's text begins, its leading
 * whitespace with it, or `rest.length` when it carries none. A `#`
 * opens a comment only after whitespace and outside quotes, and a quote
 * opens a quoted scalar only at the start of one, so the apostrophe in
 * a plain `don't` hides no comment after it.
 */
function commentStart(rest: string): number {
  let quote: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index] ?? '';
    const previous = rest[index - 1] ?? ' ';
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if ((char === '\'' || char === '"') && OPENS_QUOTE.test(previous)) quote = char;
    else if (char === '#' && /\s/u.test(previous)) return rest.slice(0, index).trimEnd().length;
  }
  return rest.length;
}

/** The trailing comment of a line's text after its colon, its leading whitespace kept. */
function trailingComment(rest: string): string {
  return rest.slice(commentStart(rest));
}

/** True when the text after a section's colon holds a value, not only a comment. */
function holdsValue(rest: string): boolean {
  return rest.slice(0, commentStart(rest)).trim() !== '';
}

/** The indices of every line matching `pattern`. */
function linesMatching(lines: readonly string[], pattern: RegExp): number[] {
  return lines.flatMap((line, index) => pattern.test(line)
    ? [index]
    : []);
}

/** `lines` with `added` after the last line that holds anything, ending in a newline. */
function appended(lines: readonly string[], added: readonly string[]): string[] {
  const body = lines.at(-1) === ''
    ? lines.slice(0, -1)
    : [...lines];
  return [...body, ...added, ''];
}

/** `lines` with the line at `at` replaced by `line`. */
function replaced(lines: readonly string[], at: number, line: string): string[] {
  return [...lines.slice(0, at), line, ...lines.slice(at + 1)];
}

/** The line at `at`, rewritten to set `name` to `value` at its own indentation and comment. */
function rewritten(lines: readonly string[], at: number, name: string, value: string): string {
  const line = lines[at] ?? '';
  const indent = /^\s*/u.exec(line)?.[0] ?? '';
  const colon = line.indexOf(':', indent.length);
  return `${indent}${name}: ${value}${trailingComment(line.slice(colon + 1))}`;
}

/** True when `text` parses to a document naming `name` at its top level. */
function namesTopLevel(text: string, name: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch {
    return false;
  }
  return isMapping(document) && Object.hasOwn(document, name);
}

/** The block a section line at `open` holds: the line after it to the next top-level line. */
function blockAfter(lines: readonly string[], open: number): { end: number; indent: string | null } {
  let indent: string | null = null;
  for (let index = open + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (SKIPPABLE.test(line)) continue;
    if (!/^\s/u.test(line)) return { end: index, indent };
    indent ??= /^\s+/u.exec(line)?.[0] ?? null;
  }
  return { end: lines.length, indent };
}

/** Context every edit step refuses with. */
interface EditTarget {
  readonly key: string;
  readonly value: string;
  readonly path: string;
}

/** The lines with a one-level key set. */
function withTopLevel(lines: readonly string[], text: string, target: EditTarget): string[] {
  const { key, value, path } = target;
  const found = linesMatching(lines, keyLine(key, ''));
  if (found.length > 1) {
    throw new ConfigSetRefusal('duplicate', `${path} sets ${key} on ${String(found.length)} lines; keep one, then set it again`);
  }
  const [at] = found;
  if (at !== undefined) return replaced(lines, at, rewritten(lines, at, key, value));
  if (namesTopLevel(text, key)) {
    throw new ConfigSetRefusal('shape', `${path} names ${key} in a shape this edit does not cover, such as flow style`);
  }
  return appended(lines, [`${key}: ${value}`]);
}

/** The lines with a two-level key set. */
function withSectionKey(lines: readonly string[], text: string, target: EditTarget): string[] {
  const { key, value, path } = target;
  const [section = '', name = ''] = key.split('.');
  const dotted = linesMatching(lines, keyLine(key, ''));
  const opens = linesMatching(lines, keyLine(section, ''));
  if (opens.length > 1) {
    throw new ConfigSetRefusal('duplicate', `${path} opens ${section} on ${String(opens.length)} lines; keep one, then set ${key} again`);
  }

  const [open] = opens;
  const block = open === undefined
    ? null
    : blockAfter(lines, open);
  if (open !== undefined && holdsValue(keyLine(section, '').exec(lines[open] ?? '')?.[1] ?? '')) {
    throw new ConfigSetRefusal('shape', `${path} writes ${section} in flow style, which this edit does not cover`);
  }
  const children = open === undefined || block === null || block.indent === null
    ? []
    : linesMatching(lines.slice(open + 1, block.end), keyLine(name, block.indent)).map((index) => index + open + 1);

  const found = [...dotted, ...children];
  if (found.length > 1) {
    throw new ConfigSetRefusal('duplicate', `${path} sets ${key} on ${String(found.length)} lines; keep one, then set it again`);
  }
  const [at] = found;
  if (at !== undefined) {
    const spelled = at === dotted[0]
      ? key
      : name;
    return replaced(lines, at, rewritten(lines, at, spelled, value));
  }
  if (open !== undefined) {
    const line = `${block?.indent ?? '  '}${name}: ${value}`;
    return [...lines.slice(0, open + 1), line, ...lines.slice(open + 1)];
  }
  if (namesTopLevel(text, section)) {
    throw new ConfigSetRefusal('shape', `${path} names ${section} in a shape this edit does not cover, such as flow style`);
  }
  return appended(lines, [`${section}:`, `  ${name}: ${value}`]);
}

/** The setting `key` names, or a `key` refusal saying why it names none this edit sets. */
function settingOf(key: string): ConfigSetting {
  const setting = SETTING_BY_KEY.get(key);
  if (setting === undefined) {
    if (SECTIONS.has(key)) {
      throw new ConfigSetRefusal('key', `${key} is a section, not a setting; name a key under it`);
    }
    const [under, names] = knownKeysAbove(key);
    const where = under === ''
      ? ''
      : ` under ${under}`;
    throw new ConfigSetRefusal('key', `unknown key ${JSON.stringify(key)} (known keys${where}: ${names.join(', ')})`);
  }
  if (key.split('.').length > CONFIG_SET_MAX_DEPTH) {
    throw new ConfigSetRefusal(
      'key',
      `${key} is ${String(key.split('.').length)} levels deep; this edit sets keys at most ${String(CONFIG_SET_MAX_DEPTH)} deep`,
    );
  }
  return setting;
}

/** What `value` reads as for `setting`, read on its own; a `value` refusal when it is none. */
function valueReading(key: string, setting: ConfigSetting, value: string, path: string): unknown {
  if (value.trim() === '') throw new ConfigSetRefusal('value', `${key} needs a value`);
  if (/[\r\n]/u.test(value)) throw new ConfigSetRefusal('value', `${key} takes a value on one line`);
  const [section, name] = key.split('.');
  const minimal = name === undefined
    ? `${key}: ${value}\n`
    : `${section ?? ''}:\n  ${name}: ${value}\n`;
  let read: unknown;
  try {
    read = parseConfigText(minimal, path).values[setting];
  } catch (error) {
    throw new ConfigSetRefusal('value', `${key} cannot be ${JSON.stringify(value)}: ${messageOf(error)}`);
  }
  if (read === undefined) throw new ConfigSetRefusal('value', `${key}: ${value} reads as no value`);
  return read;
}

/** Reads `text` as a config, or refuses with `reason` naming `why`. */
function readConfig(text: string, path: string, reason: ConfigSetRefusalReason, why: string): ReturnType<typeof parseConfigText> {
  try {
    return parseConfigText(text, path);
  } catch (error) {
    throw new ConfigSetRefusal(reason, `${path} ${why} (${messageOf(error)})`);
  }
}

/** True when `after` reads every setting but `setting`, and every unknown key, as `before` does. */
function othersKept(before: ReturnType<typeof parseConfigText>, after: ReturnType<typeof parseConfigText>, setting: ConfigSetting): boolean {
  const kept = SETTING_NAMES.every((other) => other === setting || Bun.deepEquals(before.values[other], after.values[other]));
  return kept && Bun.deepEquals(before.extras, after.extras);
}

/**
 * `text` with the setting `key` names set to `value`, every comment
 * kept, read back through `parseConfigText` before it is answered.
 * `value` is YAML as it is written after the key's colon; `path` labels
 * the refusals only.
 *
 * @throws ConfigSetRefusal for each shape the module note refuses.
 */
export function withConfigSetting(text: string, key: string, value: string, path: string): ConfigSetEdit {
  const setting = settingOf(key);
  const wanted = valueReading(key, setting, value, path);
  const original = readConfig(text, path, 'config', 'cannot be read as a config');
  const before = original.values[setting] ?? null;

  const eol = text.includes('\r\n')
    ? '\r\n'
    : '\n';
  const lines = text.split(eol);
  const target = { key, value, path };
  const edited = (key.includes('.')
    ? withSectionKey(lines, text, target)
    : withTopLevel(lines, text, target)).join(eol);

  if (Bun.deepEquals(before, wanted)) {
    return { key, setting, before, after: before, text, changed: false };
  }
  const read = readConfig(edited, path, 'readback', `would not read back once ${key} is set`);
  const after = read.values[setting];
  if (!Bun.deepEquals(after, wanted) || !othersKept(original, read, setting)) {
    throw new ConfigSetRefusal('readback', `${path} would not read ${key} back as ${value} with every other setting kept`);
  }
  return { key, setting, before, after, text: edited, changed: true };
}
