/**
 * The release receipt: the `<!-- rafa:fragments <id> <id> -->` comment
 * a settled changelog section carries, naming the fragments it folded
 * (`./strategies/semver-by-level.ts` writes it through
 * `fragmentsReceipt`). This module reads it back, finds the adoption
 * boundary, and answers whether one version's section is a release
 * `rafa release tag` may tag.
 *
 * ## The rule
 *
 * A version whose section carries no receipt is refused, except a
 * version at or below the adoption boundary, which was released before
 * the project settled anything and is accepted as legacy.
 *
 * ## The adoption boundary is read off the changelog alone
 *
 * No config key and no stored marker: the boundary is the version of
 * the newest section BELOW the oldest section that carries a receipt.
 * Every section under the first settled one is history written by hand
 * or by the old wrap-up, and every version at or below it by semver
 * precedence is legacy.
 *
 * Two edges follow from that reading:
 *
 *   - No receipted section anywhere: the project has not adopted
 *     settle, so every section is legacy and accepted. This is what
 *     keeps a changelog written before settle — this repository's
 *     own included — passing.
 *   - The oldest receipted section is the bottom one: nothing is
 *     below it, so the boundary is null and no version is legacy.
 *
 * ## What counts as a section and as a receipt
 *
 * A section starts at an ATX heading naming a version, read by
 * `changelogVersions` from `release status` one heading line at a time
 * so the two never disagree about which heading names which version,
 * and runs to the next such heading. Lines inside a fenced code block
 * are neither headings nor receipts, as `changelogVersions` skips them
 * too. A receipt is a whole line holding the comment with at least one
 * id; one naming no fragment records nothing and is not a receipt.
 * When two sections name one version, the newer (upper) one is the
 * version's, as `changelogVersions` keeps the first it meets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { changelogVersions, compareVersions } from './status-readings.js';
import { parseSemanticVersion } from './version.js';

/** A receipt line: the comment alone on its line, ids separated by whitespace. */
const RECEIPT_LINE = /^\s*<!--\s*rafa:fragments((?:\s+[^\s>]+)*)\s*-->\s*$/;

/** The open or close of a fenced code block, as `release status` reads one. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/** One version section of a changelog, newest first in file order. */
export interface ChangelogSection {
  /** The version its heading names. */
  readonly version: string;
  /** The fragment ids its receipt names, or null when it carries none. */
  readonly receipt: readonly string[] | null;
}

/** Where settle was adopted, read off the sections; see the module note. */
export interface AdoptionBoundary {
  /** True when any section carries a receipt. */
  readonly adopted: boolean;
  /** The newest version released before adoption, or null when none is. */
  readonly version: string | null;
}

/** What {@link checkReceipt} answered for one version. */
export type ReceiptVerdict =
  /** The version's section carries a receipt naming these ids. */
  | { readonly kind: 'receipted'; readonly ids: readonly string[] }
  /** No receipt, and the version is at or below the boundary, or settle was never adopted. */
  | { readonly kind: 'legacy'; readonly boundary: AdoptionBoundary }
  /** No receipt, and the version is above the boundary. */
  | { readonly kind: 'unreceipted'; readonly boundary: AdoptionBoundary }
  /** No section names the version at all. */
  | { readonly kind: 'absent' };

/** The ids `line` names as a receipt, or null when it is no receipt. */
export function readReceipt(line: string): readonly string[] | null {
  const found = RECEIPT_LINE.exec(line);
  if (found === null) return null;
  const ids = (found[1] ?? '')
    .trim()
    .split(/\s+/)
    .filter((id) => id !== '');
  return ids.length === 0
    ? null
    : ids;
}

/** A section under construction: its version, and its receipt once one is met. */
interface OpenSection {
  readonly version: string;
  readonly receipt: readonly string[] | null;
}

/** `open` with `line` read into it: the first receipt it meets is its receipt. */
function withLine(open: OpenSection, line: string): OpenSection {
  if (open.receipt !== null) return open;
  const receipt = readReceipt(line);
  return receipt === null
    ? open
    : { version: open.version, receipt };
}

/** The version sections of `text` in file order, each with its receipt. */
export function changelogSections(text: string): readonly ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let open: OpenSection | null = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const version = changelogVersions(line)[0];
    if (version !== undefined) {
      if (open !== null) sections.push(open);
      open = { version, receipt: null };
      continue;
    }
    if (open !== null) open = withLine(open, line);
  }
  if (open !== null) sections.push(open);
  return sections;
}

/** The adoption boundary of `sections`, in file order; see the module note. */
export function adoptionBoundary(sections: readonly ChangelogSection[]): AdoptionBoundary {
  const receipted = sections.map((section) => section.receipt !== null);
  const oldest = receipted.lastIndexOf(true);
  if (oldest === -1) return { adopted: false, version: null };
  return { adopted: true, version: sections[oldest + 1]?.version ?? null };
}

/** True when `version` is at or below `boundary` by semver precedence. */
function atOrBelow(version: string, boundary: string | null): boolean {
  if (boundary === null) return false;
  const left = parseSemanticVersion(version);
  const right = parseSemanticVersion(boundary);
  if (left === null || right === null) return false;
  return compareVersions(left, right) <= 0;
}

/** Whether `version`'s section in `text` is a release that may be tagged; see the module note. */
export function checkReceipt(text: string, version: string): ReceiptVerdict {
  const sections = changelogSections(text);
  const section = sections.find((each) => each.version === version);
  if (section === undefined) return { kind: 'absent' };
  if (section.receipt !== null) return { kind: 'receipted', ids: section.receipt };
  const boundary = adoptionBoundary(sections);
  if (!boundary.adopted || atOrBelow(version, boundary.version)) return { kind: 'legacy', boundary };
  return { kind: 'unreceipted', boundary };
}

/**
 * Why `version` may not be tagged by `verdict`, as one sentence naming
 * `path`, or null when it may. `absent` names the missing section,
 * though `rafa release tag` refuses a changelog that does not name the
 * version before it asks.
 */
export function receiptProblem(verdict: ReceiptVerdict, version: string, path: string): string | null {
  if (verdict.kind === 'receipted' || verdict.kind === 'legacy') return null;
  if (verdict.kind === 'absent') return `${path} has no section for ${version}, so no receipt names it`;
  const below = verdict.boundary.version === null
    ? 'no section below the oldest settled one was released before settle'
    : `only versions at or below ${verdict.boundary.version}, released before settle, may go without one`;
  return `the ${path} section for ${version} carries no <!-- rafa:fragments --> receipt, and ${below};`
    + ' release it with rafa release settle';
}

/** {@link checkReceipt} over the changelog at `configured` under `root`, or null when it could not be read. */
export function readReceiptVerdict(root: string, configured: string, version: string): ReceiptVerdict | null {
  let text: string;
  try {
    text = readFileSync(join(root, configured), 'utf8');
  } catch {
    return null;
  }
  return checkReceipt(text, version);
}
