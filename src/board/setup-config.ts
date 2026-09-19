/**
 * One setting read out of a config file made of comments, and the text
 * that sets it written back into one: `roadmap.issue`, as
 * `rafa init --board` names the Roadmap issue it opened. The write
 * itself, and the part it is reported as, are `./setup.ts`'s.
 *
 * `rafa init` writes a project config that is `version: 1` and every
 * other setting commented out at its default
 * (`src/project/scaffold.ts`), and that file is the point: an operator
 * reads it to see what can be set and what the default is. So the
 * setting is written INTO that text. A `Bun.YAML.stringify` of the
 * parsed document would answer a correct file with every comment gone,
 * which is a worse file than the one it replaced.
 *
 * ## The three shapes the edit covers, and the fourth it refuses
 *
 * {@link withRoadmapIssue} is a line edit with three branches: an
 * uncommented `roadmap:` on a line of its own gains the setting under
 * it, the commented block `rafa init` writes is uncommented, and a file
 * naming no `roadmap` at all gains the block at its end.
 *
 * The commented branch replaces BOTH template lines, so the trailing
 * `# the issue plan create --next reads; unset is the one titled
 * Roadmap` goes with them: that comment describes an unset setting, and
 * the setting is not unset once this edit lands.
 *
 * The fourth shape — a file that names `roadmap` some other way, such as
 * the flow mapping `roadmap: {issue: 4}` — is REFUSED with null rather
 * than appended to. `Bun.YAML.parse` answers the LAST of two duplicate
 * keys and says nothing about the first (measured on bun 1.3.14,
 * 2026-09-19), so an appended block would read back as the right issue
 * and pass every check while leaving the key in the file twice.
 *
 * ## The parse-back, and what it can and cannot catch
 *
 * {@link roadmapIssueIn} reads a candidate text through
 * `parseConfigText`, the same reader `loadConfig` uses, so the caller
 * writes nothing until the text it holds reads back as the issue it
 * means. That control catches a branch that put the line in the wrong
 * place — a `  issue: <n>` under a `roadmap:` that already carries one
 * reads back as the OLD issue, since the parser takes the last of the
 * two — and it is what makes a hand-written edit safe to ship.
 *
 * What it cannot catch is the duplicate top-level key above, which is
 * why that one is refused by shape instead.
 *
 * Nothing here spawns, asks the board anything or writes: the file is
 * READ under the root the caller names, which every case in
 * `./setup-config.test.ts` points at its own temporary directory, and
 * the text that would replace it is answered rather than written.
 */
import { readFileSync } from 'node:fs';

import { isMapping, messageOf } from '../config-sections.js';
import { configFilePath, parseConfigText } from '../config.js';

/** What the project config says `roadmap.issue` is, or why it could not be read. */
export interface SettingReading {
  /** The issue named, or null when the file names none. */
  readonly issue: number | null;
  /** The text of the file, kept for the write that may follow. */
  readonly text: string;
  /** Why the file could not be read, or null when it was. */
  readonly problem: string | null;
}

/**
 * What `text` says `roadmap.issue` is, read through `parseConfigText`,
 * the reader `loadConfig` uses. `path` labels the refusals only.
 *
 * @throws ConfigError when the text is not a config this rafa reads.
 */
export function roadmapIssueIn(text: string, path: string): number | null {
  return parseConfigText(text, path).values.roadmapIssue ?? null;
}

/** Reads `roadmap.issue` out of the project config under `root`, through the schema. */
export function readRoadmapSetting(root: string): SettingReading {
  const path = configFilePath(root);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { issue: null, text: '', problem: `${path} could not be read: ${messageOf(error)}` };
  }
  try {
    return { issue: roadmapIssueIn(text, path), text, problem: null };
  } catch (error) {
    return { issue: null, text, problem: `${path} could not be read: ${messageOf(error)}` };
  }
}

/** An uncommented `roadmap:` at the top level of the document. */
const ROADMAP_KEY = /^roadmap:\s*$/u;

/** The same key commented out, as `rafa init` writes it. */
const COMMENTED_ROADMAP_KEY = /^#\s*roadmap:\s*$/u;

/** The commented `issue:` line under it, whatever trailing comment it carries. */
const COMMENTED_ISSUE_KEY = /^#\s+issue:/u;

/** `lines` with `block` after the last line that holds anything. */
function appended(lines: readonly string[], block: readonly string[]): readonly string[] {
  const body = lines.at(-1) === ''
    ? lines.slice(0, -1)
    : [...lines];
  return [...body, ...block, ''];
}

/** True when `text` parses to a document that already names `roadmap`. */
function namesRoadmap(text: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch {
    return false;
  }
  return isMapping(document) && Object.hasOwn(document, 'roadmap');
}

/**
 * `text` with `roadmap.issue` set to `issue`, the comments around it
 * kept, or null when the file spells `roadmap` in a shape none of the
 * three branches edits.
 *
 * The branches, in order: an uncommented `roadmap:` on a line of its own
 * gains the setting under it, the commented block `rafa init` writes is
 * uncommented, and a file naming no `roadmap` at all gains the block at
 * its end.
 *
 * The null is the fourth case and it is a REFUSAL, not an append:
 * `Bun.YAML.parse` answers the LAST of two duplicate keys silently
 * (measured on bun 1.3.14, 2026-09-19), so appending a second `roadmap:`
 * to a file that spells the key some other way — `roadmap: {issue: 4}`,
 * a flow mapping, an anchor — would read back as this issue and pass
 * every check while leaving a file with two of the same key in it.
 *
 * Pure otherwise, and unchecked: the caller parses what comes back
 * before writing it.
 */
export function withRoadmapIssue(text: string, issue: number): string | null {
  const setting = `  issue: ${String(issue)}`;
  const lines = text.split('\n');

  const open = lines.findIndex((line) => ROADMAP_KEY.test(line));
  if (open >= 0) {
    return [...lines.slice(0, open + 1), setting, ...lines.slice(open + 1)].join('\n');
  }

  const commented = lines.findIndex((line) => COMMENTED_ROADMAP_KEY.test(line));
  if (commented >= 0) {
    const next = lines[commented + 1] ?? '';
    const after = COMMENTED_ISSUE_KEY.test(next)
      ? commented + 2
      : commented + 1;
    return [...lines.slice(0, commented), 'roadmap:', setting, ...lines.slice(after)].join('\n');
  }

  if (namesRoadmap(text)) return null;
  return appended(lines, ['roadmap:', setting]).join('\n');
}
