/**
 * The released-history audit `rafa release status` prints: four things
 * a changelog can say about its own releases that no release should
 * leave behind.
 *
 * ```text
 *   audit         2 findings in 14 sections of CHANGELOG.md
 *                 0.9.0 is named by 2 headings
 *                 0.12.0 follows 0.10.0, which is not the next patch, minor or major (0.10.1, 0.11.0 or 1.0.0)
 * ```
 *
 * ## The four findings
 *
 *   - `duplicate`: two or more headings name one version. Reported once
 *     per version, with how many headings name it.
 *   - `gap`: a heading's version is not a successor of the version of
 *     the heading right below it, the older one. The successors of
 *     `M.m.p` are `M.m.(p+1)`, `M.(m+1).0` and `(M+1).0.0`, so a
 *     skipped number and a version lower than the one below it are both
 *     a gap. Two adjacent headings naming one version are a duplicate
 *     and not also a gap. A pair where either side carries a
 *     prerelease is not judged: `1.0.0-rc.1` to `1.0.0` and `1.0.0` to
 *     `1.1.0-beta` are both ordinary, and semver names no single
 *     successor of a prerelease this could hold them to.
 *   - `date-order`: a heading is dated before the heading right below
 *     it. The date is the first `YYYY-MM-DD` token in the heading, the
 *     `{date}` that `release.heading` renders; a heading without one,
 *     on either side of a pair, leaves the pair unjudged.
 *   - `untagged`: a heading's version has no release tag, and the
 *     version is not legacy by the receipt rule of `./receipt.ts`: a
 *     changelog with no receipted section has not adopted settle, so
 *     every one of its versions is legacy, and once one has, only the
 *     versions at or below the adoption boundary are. This is what
 *     keeps a changelog written before settle, this repository's own
 *     included, passing while it still carries untagged sections from
 *     before the tags were kept. The `untagged` line of
 *     `rafa release status` still lists every untagged version, legacy
 *     or not; this finding is the ones a settled project should have
 *     tagged.
 *
 * Findings come in that order, each kind in the changelog's own order,
 * newest first.
 *
 * ## What counts as a heading
 *
 * The same reading `release status` and `./receipt.ts` make: an ATX
 * heading outside a fenced code block whose first semantic-version
 * token names its version (`changelogVersions`, one heading line at a
 * time). Unlike `changelogVersions` over the whole text, a version is
 * kept every time a heading names it, since a repeat is a finding.
 *
 * ## It reads, and writes nothing
 *
 * {@link auditChangelog} is pure over the text and the tagged versions.
 * {@link readAudit} reads the changelog file and nothing else; when the
 * file cannot be read it says so by `read: false` and no sentence of
 * its own, because the `untagged` reading of the same file already
 * puts the reason under the block.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { changelogVersions } from '../commands/release/status.js';

import { checkReceipt } from './receipt.js';
import { parseSemanticVersion } from './version.js';

/** The open or close of a fenced code block, as `release status` reads one. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/** A `YYYY-MM-DD` token standing alone in a heading. */
const HEADING_DATE = /(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/;

/** One heading of a changelog that names a version. */
export interface AuditHeading {
  /** The version it names. */
  readonly version: string;
  /** The first `YYYY-MM-DD` token in it, or null when it carries none. */
  readonly date: string | null;
}

/** One thing the audit found; see the module note. */
export type AuditFinding =
  /** `count` headings name `version`. */
  | { readonly kind: 'duplicate'; readonly version: string; readonly count: number }
  /** `version` sits right above `previous` without being one of its `successors`. */
  | {
    readonly kind: 'gap';
    readonly version: string;
    readonly previous: string;
    readonly successors: readonly string[];
  }
  /** `version`, dated `date`, sits right above `previous`, dated later. */
  | {
    readonly kind: 'date-order';
    readonly version: string;
    readonly date: string;
    readonly previous: string;
    readonly previousDate: string;
  }
  /** No tag names `version`, and it is not legacy. */
  | { readonly kind: 'untagged'; readonly version: string };

/** The audit of one changelog file. */
export interface AuditReading {
  /** The path as `release.changelog` spells it. */
  readonly path: string;
  /** False when the file could not be read; the other fields are then empty. */
  readonly read: boolean;
  /** How many headings name a version. */
  readonly sections: number;
  /** What the audit found, in the module note's order. */
  readonly findings: readonly AuditFinding[];
}

/** Every heading of `text` naming a version, in file order, repeats kept. */
export function auditHeadings(text: string): readonly AuditHeading[] {
  const headings: AuditHeading[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const version = changelogVersions(line)[0];
    if (version === undefined) continue;
    headings.push({ version, date: HEADING_DATE.exec(line)?.[1] ?? null });
  }
  return headings;
}

/** The next patch, minor and major of `version`, or null when it is no plain version. */
export function successorsOf(version: string): readonly string[] | null {
  const parsed = parseSemanticVersion(version);
  if (parsed === null || parsed.prerelease !== '') return null;
  const { major, minor, patch } = parsed;
  return [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`];
}

/** True when `version` parses and carries a prerelease. */
function isPrerelease(version: string): boolean {
  return (parseSemanticVersion(version)?.prerelease ?? '') !== '';
}

/** The duplicate findings of `headings`, each version once, in the order it first appears. */
function duplicates(headings: readonly AuditHeading[]): readonly AuditFinding[] {
  const counts = new Map<string, number>();
  for (const heading of headings) counts.set(heading.version, (counts.get(heading.version) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([version, count]) => ({ kind: 'duplicate', version, count }));
}

/** The pairs of `headings` a heading and the one right below it make, newer first. */
function adjacentPairs(headings: readonly AuditHeading[]): readonly (readonly [AuditHeading, AuditHeading])[] {
  return headings.slice(1).map((older, index) => [headings[index] as AuditHeading, older] as const);
}

/** The gap finding of one pair, or null when the pair is in step or is not judged. */
function gapOf(newer: AuditHeading, older: AuditHeading): AuditFinding | null {
  if (newer.version === older.version || isPrerelease(newer.version)) return null;
  const successors = successorsOf(older.version);
  if (successors === null || successors.includes(newer.version)) return null;
  return { kind: 'gap', version: newer.version, previous: older.version, successors };
}

/** The date-order finding of one pair, or null when it is in order or not dated on both sides. */
function dateOrderOf(newer: AuditHeading, older: AuditHeading): AuditFinding | null {
  if (newer.date === null || older.date === null || newer.date >= older.date) return null;
  return {
    kind: 'date-order',
    version: newer.version,
    date: newer.date,
    previous: older.version,
    previousDate: older.date,
  };
}

/** The untagged findings of `text`: versions no tag names that are not legacy, each once. */
function untagged(
  text: string,
  headings: readonly AuditHeading[],
  tagged: ReadonlySet<string>,
): readonly AuditFinding[] {
  const versions = [...new Set(headings.map((heading) => heading.version))];
  return versions
    .filter((version) => !tagged.has(version) && checkReceipt(text, version).kind !== 'legacy')
    .map((version) => ({ kind: 'untagged', version }));
}

/** Everything the audit finds in `text` against the versions `tagged` names; see the module note. */
export function auditChangelog(text: string, tagged: readonly string[]): readonly AuditFinding[] {
  const headings = auditHeadings(text);
  const pairs = adjacentPairs(headings);
  const inPairs = (judge: typeof gapOf): readonly AuditFinding[] => pairs
    .map(([newer, older]) => judge(newer, older))
    .filter((finding): finding is AuditFinding => finding !== null);
  return [
    ...duplicates(headings),
    ...inPairs(gapOf),
    ...inPairs(dateOrderOf),
    ...untagged(text, headings, new Set(tagged)),
  ];
}

/** The versions after the last in `list`, spelled `a, b or c`. */
function orList(list: readonly string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1] ?? ''}`;
}

/** One finding as the sentence the block prints under the audit line. */
export function auditSentence(finding: AuditFinding): string {
  switch (finding.kind) {
    case 'duplicate':
      return `${finding.version} is named by ${finding.count} headings`;
    case 'gap':
      return `${finding.version} follows ${finding.previous}, which is not the next patch, minor or major`
        + ` (${orList(finding.successors)})`;
    case 'date-order':
      return `${finding.version} is dated ${finding.date}, before ${finding.previous} below it,`
        + ` dated ${finding.previousDate}`;
    case 'untagged':
      return `${finding.version} has a heading and no tag, and is newer than the releases made before settle`;
  }
}

/** The audit of the changelog at `configured` under `root` against the versions `tagged` names. */
export function readAudit(root: string, configured: string, tagged: readonly string[]): AuditReading {
  let text: string;
  try {
    text = readFileSync(join(root, configured), 'utf8');
  } catch {
    return { path: configured, read: false, sections: 0, findings: [] };
  }
  return {
    path: configured,
    read: true,
    sections: auditHeadings(text).length,
    findings: auditChangelog(text, tagged),
  };
}

/** `count` of `noun`, with an `s` when it is not one. */
function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${count} ${noun}s`;
}

/** The `audit` cell, or null when the changelog could not be read and the caller renders its own mark. */
export function auditCell(reading: AuditReading): string | null {
  if (!reading.read) return null;
  const where = `${counted(reading.sections, 'section')} of ${reading.path}`;
  return reading.findings.length === 0
    ? `clean, ${where}`
    : `${counted(reading.findings.length, 'finding')} in ${where}`;
}

/** One line per finding, for under the audit cell. */
export function auditLines(reading: AuditReading): readonly string[] {
  return reading.findings.map(auditSentence);
}
