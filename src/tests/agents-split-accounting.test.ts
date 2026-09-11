/**
 * The AGENTS.md split, held to the line.
 *
 * Splitting a root `AGENTS.md` into `context/` pages is a MOVE, and a
 * move is the one edit shape no gate here can see. Every page lints
 * clean on its own, `gate:control-bytes` opens each of them happily,
 * and nothing in the tree compares two files — so a page that dropped
 * its last paragraph, a boundary that lost its blank line, or a
 * subsection swallowed into the page above it all leave a tree that is
 * green end to end and a document that is quietly short. This file is
 * where that arithmetic is checked rather than trusted.
 *
 * ## Why a fixture and not the live files
 *
 * The live pages are not a stable subject. `context/` is where a
 * finding promoted out of `progress.txt` now goes, so every page grows
 * on its own schedule, and the pre-split root file exists ONLY in git
 * history — a test reaching for it would have to shell out to
 * `git show <sha>:AGENTS.md` and would be measuring one commit rather
 * than the procedure. Pinned to either, this file would go red for a
 * reason that is not a fault.
 *
 * So the fixture is a miniature pre-split document carrying the same
 * SHAPE, and what is under test is the accounting itself. That matters
 * beyond this one split: two more AGENTS.md files are split the same
 * way (`packages/service` and `packages/web`), and a checked procedure
 * is what those tasks get to run instead of an ad-hoc probe.
 *
 * The shape the fixture mirrors was measured against the real split at
 * the commit that landed it: 2,461 source lines == 2,437 carried onto
 * five pages (341 + 432 + 753 + 527 + 384) + 4 separators + 20 lines
 * of residue, and those 20 residue lines are byte-identical at the head
 * of the rewritten map. The fixture reproduces every structural trap in
 * that reading and none of its size.
 *
 * ## The four readings, and what each one alone cannot see
 *
 * The accounting is four independent readings because no one of them
 * covers the others, and the pairs that stay green are the point:
 *
 *   - **the partition** (`accountForSplit`) walks the source once
 *     against the concatenation of the map's residue, the page bodies
 *     in order, and one blank separator between neighbours. Every
 *     source line gets exactly one owner or the walk names the line it
 *     stopped on. It sees a dropped line, a duplicated line, a page in
 *     the wrong order and a lost separator. It CANNOT see a swallow:
 *     folding one page's section into the page above it moves no byte.
 *   - **the range derivation** (`deriveBodies`) rebuilds each page from
 *     the source's own headings — start at the page's first assigned
 *     heading, end at the next heading of ANY LEVEL the page was not
 *     assigned, strip the trailing blank — and holds the result against
 *     the page on disk. Ending at any level is one predicate for both
 *     directions: the verification page must stop at a `###` below it
 *     and the gates page at the `##` above it, and a derivation keyed
 *     on `^## ` alone silently swallows the first of those.
 *   - **the arithmetic** (`balanceOf`) is page lines + residue +
 *     separators against the source total, with the separator count at
 *     pages MINUS ONE rather than one per page. The last section leaves
 *     no trailing blank behind because the separator belongs to the
 *     NEXT heading and it has no next heading, and the one-per-page
 *     form over-predicts by exactly 1 the moment that section is
 *     carried.
 *   - **the roster** (`assignHeadings`) is the one that sees a swallow:
 *     one page per tag, every source heading assigned to exactly one
 *     page or left in the residue, and no page carrying a heading it
 *     was not given.
 *
 * ## The controls
 *
 * Each positive reading carries its own, because each is satisfiable
 * by a broken check. The partition's `unaccounted` list being empty is
 * a zero-hit reading, so the owner histogram is held against the page
 * line counts and the walk is required to have consumed the whole
 * source rather than merely not complained. Every range derivation is
 * re-run SHIFTED BY ONE in both directions and required to DIFFER — an
 * empty extraction and a range compared against itself both answer
 * "equal", and only the shift separates the right range from a
 * self-consistent wrong one. The fixture guard case is the control on
 * the fixture itself: it asserts the traps are still there — the
 * nested `###`, the adjacent pair on one page, the residue running
 * into the first page with no separator of its own, and the shebang
 * inside a fence that opens on `#` and is not a heading — so a later
 * edit that flattened one of them is a red rather than a suite that
 * quietly stopped testing anything.
 *
 * The negative cases are the other half. Each plants a split that went
 * wrong ONE way and requires the accounting to name it, and the two
 * that matter most are the ones where readings disagree: the swallowed
 * subsection passes the partition and the arithmetic and is caught by
 * the range derivation and the roster, and a page that kept the blank
 * belonging to its neighbour reports as a mismatch on a HEADING rather
 * than on a blank — the page ate the separator, so the walk asks for
 * one where the next page's first line already is, which is what that
 * failure actually looks like.
 *
 * ## The artefact is written to disk
 *
 * Pages are files, and reading them back is where an off-by-one hides:
 * a page ends with exactly one newline, so a naive split on `\n` yields
 * a phantom empty last element and every page reads one line long.
 * `readPageBody` drops it and refuses a file that does not end in a
 * newline at all, so that fault is a red here rather than a silent +1
 * in every count downstream.
 *
 * ## The mutation grid
 *
 * The readings are this file's own helpers, so the grid is over them:
 * fifteen mutations, each run TWICE and asked for case NAMES through
 * `--reporter=json` so a red SET is comparable member for member. All
 * fifteen applied cleanly, all fifteen reddened at least one case,
 * both passes named the identical set every time, and the file was
 * restored bytes-identical with all 12 cases green either side. The
 * union of the red sets covers all 12, so no fixture is riding along.
 *
 * The wide legs say which reading carries the file. Keeping the
 * phantom last line of every page reddens 8 — it is the off-by-one
 * this file exists to make loud. Emitting no separator reddens 7 and
 * never recording a mismatch reddens 6, which between them are the
 * partition. Dropping the space from the heading pattern reddens 5,
 * every one of them through the shebang in the tooling fixture.
 *
 * The legs that ISOLATE are what each case is shaped for. Ending a
 * range at the next `^## ` instead of at the next heading of any level
 * reddens the range case and the swallow case and nothing else.
 * Reusing the real range for the shifted-up control reddens the range
 * case ALONE, which is what says the shift is load-bearing rather than
 * decorative. Dropping the blank `bodyOf` puts between two sections
 * reddens the boundary case alone — and that case had to be written
 * for it, because `bodyOf` builds the source AND the artefact, so
 * until one fixture VIOLATED the contiguous-slice rule the leg moved
 * both sides together and read as covered. Freezing `unaccounted`
 * empty reddens the dropped-line case alone. And three legs redden the
 * swallow case alone — two over the roster, one over the line
 * comparison — which is the whole reason that case asserts the
 * partition and the arithmetic PASS in its own body.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/** What a mismatch reports when the artefact outran the source. */
const PAST_END = '<past the end of the source>';

/** One section of the pre-split document. */
interface SectionSpec {
  /** The heading line, verbatim. */
  heading: string;
  /** Every line below it. Never ends blank — see the fixture guard. */
  lines: readonly string[];
}

/** One `context/` page the split is specified to produce. */
interface PageSpec {
  /** The page's tag, which is also its filename stem. */
  name: string;
  /** The source sections it is assigned, in source order. */
  sections: readonly SectionSpec[];
}

/** A page as it was actually written, read back off disk. */
interface PageFile {
  name: string;
  body: readonly string[];
}

/**
 * The header and workspace map the split leaves behind.
 *
 * It ends on a blank line on purpose: that blank is the separator
 * before the first carried heading, so the residue runs straight into
 * the first page with no separator of its own. The real file has the
 * same property, which is why its residue is 20 lines and not 21.
 */
const RESIDUE: readonly string[] = [
  '# agentic-research',
  '',
  'Umbrella monorepo (bun workspaces) for the agentic research',
  'platform.',
  '',
  '## Workspace map',
  '',
  '| Path | Package | What it is |',
  '|---|---|---|',
  '| `packages/ui` | `@ar/ui` | Component library and harness. |',
  '| `tools/ralph` | — | The agent task loop, run from the root. |',
  '',
  'Each package keeps its own `AGENTS.md` with package-specific',
  'conventions — read it before working inside that package.',
  '',
];

/**
 * The five pages, and the sections each is assigned.
 *
 * Every structural trap of the real split is here and nothing else is:
 * `security` carries TWO adjacent sections, so its range may not stop
 * at the heading in its middle; `gates` is a `###` sitting inside the
 * range a `^## `-keyed derivation would give `verification`; `gates`
 * itself ends at a heading ABOVE its own level; and `workflow` is
 * last, so it leaves no separator behind.
 */
const PAGES: readonly PageSpec[] = [
  {
    name: 'tooling',
    sections: [
      {
        heading: '## Shared tooling',
        lines: [
          '',
          '- `eslint.base.mjs` + `sharedRules.mjs` at the root; each',
          '  package carries its own leaf config extending it.',
          '- bun uses an isolated linker here, so `bun x` resolves a',
          '  different tool version per directory.',
          '',
          // A line opening on `#` that is NOT a heading, which is the
          // only thing standing between the heading inventory and a
          // range that ends in the middle of a page. The space in
          // `headingsOf`'s pattern is what keeps it out; no fence
          // tracking is needed, and none of the four AGENTS.md files
          // in this tree holds a heading-shaped line inside a fence.
          '```bash',
          '#!/usr/bin/env bash',
          'bun run lint:all',
          '```',
        ],
      },
    ],
  },
  {
    name: 'security',
    sections: [
      {
        heading: '## Plans and specs (CRITICAL)',
        lines: [
          '',
          'Working plans and specs go in `.plans/` and `.specs/` at the',
          'repo root, and both are gitignored on purpose.',
        ],
      },
      {
        heading: '## Security posture',
        lines: [
          '',
          'Seven de-origination needles in two buckets. A zero is only a',
          'reading once a planted control proves the needle still bites.',
        ],
      },
    ],
  },
  {
    name: 'verification',
    sections: [
      {
        heading: '## Verification order',
        lines: [
          '',
          '1. `bun run lint:all` — zero problems.',
          '2. `bun run check-types:all` — zero errors.',
          '3. `bun run test:all` — every suite green.',
          '',
          'Read the verdict lines rather than the summary figures, which',
          'are snapshots that move on their own.',
        ],
      },
    ],
  },
  {
    name: 'gates',
    sections: [
      {
        heading: '### Which gate reads which file',
        lines: [
          '',
          'A fan-out reports the same green SHAPE under any change to',
          'what it COVERS, so an explicit-path run is what says a gate',
          'opened your file at all.',
        ],
      },
    ],
  },
  {
    name: 'workflow',
    sections: [
      {
        heading: '## Workflow',
        lines: [
          '',
          'Feature branch, then PR, then merge. The runner owns the push,',
          'the pull request and the merge; a task session owns neither.',
          '',
          'Take the mergeability reading before every push.',
        ],
      },
    ],
  },
];

/** What the rewritten map adds below the residue it carries. */
const MAP_ADDITIONS: readonly string[] = [
  '## Context pages',
  '',
  'One page per tag, each the authority for its own subject. The',
  'pointers below are plain paths on purpose.',
  '',
  '- `context/tooling.md` — the root config layering and the traps.',
  '- `context/security.md` — the gitignored plans law and the needles.',
  '- `context/verification.md` — the three fan-out gates in order.',
  '- `context/gates.md` — which gate actually opens which file.',
  '- `context/workflow.md` — branch, PR, merge and the close-out.',
  '',
  '## This file is capped',
  '',
  '**80 lines.** `CLAUDE.md` imports it into every turn, so it carries',
  'the workspace map and the pointers above and nothing else.',
];

/** The rewritten root map: the residue verbatim, then its own lines. */
const MAP: readonly string[] = [...RESIDUE, ...MAP_ADDITIONS];

/**
 * A page body as the split should write it.
 *
 * Two adjacent sections on one page are ONE CONTIGUOUS slice of the
 * source, so they are joined by the single blank line the source
 * itself put between them — a page assembled from two independently
 * stripped bodies that does not equal the contiguous slice has lost or
 * gained a line at that boundary.
 */
function bodyOf(page: PageSpec): readonly string[] {
  const body: string[] = [];
  for (const section of page.sections) {
    if (body.length > 0) body.push('');
    body.push(section.heading, ...section.lines);
  }
  return body;
}

/**
 * The pre-split document, assembled from the same table the pages are.
 *
 * This is the second independent path the whole file rests on: the
 * source is built by CONCATENATION and every reading below rebuilds
 * the pages by EXTRACTION, so a fault in either shows up as a
 * disagreement rather than as two copies of one mistake agreeing.
 */
function sourceLines(pages: readonly PageSpec[]): readonly string[] {
  const lines: string[] = [...RESIDUE];
  for (const [index, page] of pages.entries()) {
    lines.push(...bodyOf(page));
    if (index < pages.length - 1) lines.push('');
  }
  return lines;
}

/** The pre-split document every case measures against. */
const SOURCE = sourceLines(PAGES);

/** The split as specified: each page written exactly as assigned. */
function correctArtefact(): PageFile[] {
  return PAGES.map((page) => ({ name: page.name, body: bodyOf(page) }));
}

/** A heading line, with its 1-indexed position. */
interface Heading {
  lineNum: number;
  text: string;
  level: number;
}

/** Every heading in a document, at every level. */
function headingsOf(lines: readonly string[]): Heading[] {
  const found: Heading[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6}) /.exec(line);
    if (!match) continue;
    found.push({ lineNum: index + 1, text: line, level: match[1]!.length });
  }
  return found;
}

/** Which bucket of the split a source line belongs to. */
type Owner = 'map' | 'separator' | `page:${string}`;

/** Where the walk first disagreed with the source. */
interface Mismatch {
  /** 1-indexed source line it stopped on. */
  at: number;
  /** What the artefact said should be there. */
  expected: string;
  /** What the source actually holds. */
  found: string;
  /** Which bucket was being consumed when it stopped. */
  owner: Owner;
}

/** Reading one: the partition. */
interface Account {
  /** One owner per source line consumed, in source order. */
  owners: Owner[];
  /** 1-indexed source lines no bucket claimed. */
  unaccounted: number[];
  /** The first disagreement, or null. */
  mismatch: Mismatch | null;
  /** Blank separators the walk actually consumed. */
  separators: number;
  /** Lines each page claimed. */
  perPage: Map<string, number>;
}

/** One expected line and the bucket that owns it. */
interface Expectation {
  line: string;
  owner: Owner;
}

/**
 * The whole artefact flattened back into the order it claims to cover
 * the source in: the map's residue, then each page, with one blank
 * separator between neighbours and none after the last.
 */
function expectationsFor(
  residue: readonly string[],
  pages: readonly PageFile[],
): Expectation[] {
  const wanted: Expectation[] = residue.map((line) => ({
    line,
    owner: 'map' as Owner,
  }));

  for (const [index, page] of pages.entries()) {
    const owner: Owner = `page:${page.name}`;
    for (const line of page.body) wanted.push({ line, owner });
    if (index < pages.length - 1) {
      wanted.push({ line: '', owner: 'separator' });
    }
  }

  return wanted;
}

/**
 * Walks the source against the artefact and answers who owns what.
 *
 * The residue is taken from the MAP rather than declared separately,
 * which is what makes "the root map accounts for the header" a
 * measurement: the map's own head has to BE those source lines.
 */
function accountForSplit(
  source: readonly string[],
  map: readonly string[],
  pages: readonly PageFile[],
  residueLength: number,
): Account {
  const wanted = expectationsFor(map.slice(0, residueLength), pages);
  const owners: Owner[] = [];
  let mismatch: Mismatch | null = null;

  for (const [index, expectation] of wanted.entries()) {
    const found = source[index];
    if (found !== expectation.line) {
      mismatch = {
        at: index + 1,
        expected: expectation.line,
        found: found ?? PAST_END,
        owner: expectation.owner,
      };
      break;
    }
    owners.push(expectation.owner);
  }

  const unaccounted: number[] = [];
  for (let index = owners.length; index < source.length; index++) {
    unaccounted.push(index + 1);
  }

  const perPage = new Map<string, number>();
  for (const page of pages) perPage.set(page.name, page.body.length);

  return {
    owners,
    unaccounted,
    mismatch,
    separators: owners.filter((owner) => owner === 'separator').length,
    perPage,
  };
}

/** Reading two, per page. */
interface Derivation {
  name: string;
  /** 1-indexed first line of the page's range in the source. */
  start: number;
  /** 1-indexed last line, after the trailing blank was stripped. */
  end: number;
  /** How many trailing blanks the strip removed. */
  stripped: number;
  /** Whether the derived body equals the one on disk. */
  matches: boolean;
  /** Whether the same range shifted one line down differs. */
  shiftedUpDiffers: boolean;
  /** Whether the same range shifted one line up differs. */
  shiftedDownDiffers: boolean;
}

/** Two line lists, compared member for member. */
function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * Rebuilds each page from the source's own headings.
 *
 * The range ends at the next heading of ANY LEVEL the page was not
 * assigned, which is one predicate for both directions — a `###` below
 * the page's own heading and a `##` above it end a range alike, where
 * a `^## `-keyed derivation swallows the first and a hand-written
 * `###` exception covers only the page it was written for.
 */
function deriveBodies(
  source: readonly string[],
  spec: readonly PageSpec[],
  pages: readonly PageFile[],
): Derivation[] {
  const headings = headingsOf(source);
  const derivations: Derivation[] = [];

  for (const page of spec) {
    const owned = new Set(page.sections.map((section) => section.heading));
    const first = page.sections[0]!.heading;
    const start = headings.find((heading) => heading.text === first)?.lineNum;
    const onDisk = pages.find((file) => file.name === page.name);
    if (start === undefined || !onDisk) {
      derivations.push({
        name: page.name,
        start: start ?? -1,
        end: -1,
        stripped: -1,
        matches: false,
        shiftedUpDiffers: false,
        shiftedDownDiffers: false,
      });
      continue;
    }

    const next = headings.find(
      (heading) => heading.lineNum > start && !owned.has(heading.text),
    );
    let end = next
      ? next.lineNum - 1
      : source.length;
    let stripped = 0;
    while (end > start && (source[end - 1] ?? '').trim() === '') {
      end -= 1;
      stripped += 1;
    }

    const derived = source.slice(start - 1, end);
    derivations.push({
      name: page.name,
      start,
      end,
      stripped,
      matches: sameLines(derived, onDisk.body),
      shiftedUpDiffers: !sameLines(source.slice(start, end + 1), onDisk.body),
      shiftedDownDiffers: !sameLines(
        source.slice(start - 2, end - 1),
        onDisk.body,
      ),
    });
  }

  return derivations;
}

/** Reading three: the whole-file arithmetic. */
interface Balance {
  /** Lines carried onto pages. */
  carried: number;
  /** Lines the map keeps that came from the source. */
  residue: number;
  /** Blanks left behind between neighbouring pages. */
  separators: number;
  /** The three above, summed. */
  total: number;
  /** The source's own line count. */
  source: number;
}

/** Page lines + residue + separators, against the source total. */
function balanceOf(
  source: readonly string[],
  pages: readonly PageFile[],
  residueLength: number,
): Balance {
  const carried = pages.reduce((sum, page) => sum + page.body.length, 0);
  const separators = Math.max(pages.length - 1, 0);
  return {
    carried,
    residue: residueLength,
    separators,
    total: carried + residueLength + separators,
    source: source.length,
  };
}

/** Reading four: one page per tag, one page per heading. */
interface Assignment {
  /** Specified pages with no file in the artefact. */
  missing: string[];
  /** Files the specification never named. */
  extra: string[];
  /** Source headings left in neither the residue nor any page. */
  unassigned: string[];
  /** Headings a page carries that it was not assigned. */
  misassigned: { page: string; heading: string }[];
}

/** Holds the artefact's headings against the specified assignment. */
function assignHeadings(
  source: readonly string[],
  spec: readonly PageSpec[],
  pages: readonly PageFile[],
  residueLength: number,
): Assignment {
  const specNames = spec.map((page) => page.name);
  const fileNames = pages.map((page) => page.name);
  const residueHeadings = new Set(
    headingsOf(source.slice(0, residueLength)).map((heading) => heading.text),
  );

  const assigned = new Map<string, string>();
  for (const page of spec) {
    for (const section of page.sections) {
      assigned.set(section.heading, page.name);
    }
  }

  const unassigned = headingsOf(source)
    .map((heading) => heading.text)
    .filter((text) => !residueHeadings.has(text) && !assigned.has(text));

  const misassigned: { page: string; heading: string }[] = [];
  for (const file of pages) {
    for (const heading of headingsOf(file.body)) {
      if (assigned.get(heading.text) !== file.name) {
        misassigned.push({ page: file.name, heading: heading.text });
      }
    }
  }

  return {
    missing: specNames.filter((name) => !fileNames.includes(name)),
    extra: fileNames.filter((name) => !specNames.includes(name)),
    unassigned,
    misassigned,
  };
}

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-split-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Writes a whole split to disk and answers its `context/` directory. */
function plant(pages: readonly PageFile[]): string {
  planted += 1;
  const dir = join(tempRoot, `split-${planted}`, 'context');
  mkdirSync(dir, { recursive: true });
  for (const page of pages) {
    writeFileSync(join(dir, `${page.name}.md`), `${page.body.join('\n')}\n`);
  }
  return dir;
}

/**
 * A page as the accounting reads it.
 *
 * A markdown file ends with exactly one newline, so splitting its text
 * yields a phantom empty last element; dropping it here is what keeps
 * every count below off by nothing. A file NOT ending in a newline is
 * refused rather than silently accepted, since that is a real fault
 * with the same signature.
 */
function readPageBody(dir: string, name: string): readonly string[] {
  const text = readFileSync(join(dir, `${name}.md`), 'utf8');
  if (!text.endsWith('\n')) {
    throw new Error(`context/${name}.md does not end in a newline`);
  }
  const lines = text.split('\n');
  lines.pop();
  return lines;
}

/** Reads back a planted split in the order it was written. */
function readSplit(dir: string, names: readonly string[]): PageFile[] {
  return names.map((name) => ({ name, body: readPageBody(dir, name) }));
}

/** The correct split, planted and read back. */
function plantedSplit(): PageFile[] {
  const names = PAGES.map((page) => page.name);
  return readSplit(plant(correctArtefact()), names);
}

/** Replaces one page of an otherwise correct split. */
function splitWith(name: string, body: readonly string[]): PageFile[] {
  return correctArtefact().map((page) => (page.name === name
    ? { name, body }
    : page));
}

describe('the root AGENTS.md split, accounted line by line', () => {
  it('gives every source line exactly one owner', () => {
    const pages = plantedSplit();
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);

    expect(account.mismatch).toBeNull();
    expect(account.unaccounted).toEqual([]);

    // The empty list above is a zero-hit reading and a walk that
    // stopped at line 1 answers it too. These are what say it ran:
    // one owner per source line, and the buckets summing to the file.
    expect(account.owners).toHaveLength(SOURCE.length);
    expect(account.separators).toBe(PAGES.length - 1);

    const owned = account.owners.filter((owner) => owner === 'map').length;
    expect(owned).toBe(RESIDUE.length);

    for (const page of pages) {
      const lines = account.owners
        .filter((owner) => owner === `page:${page.name}`);
      expect(lines).toHaveLength(page.body.length);
      expect(account.perPage.get(page.name)).toBe(page.body.length);
    }
  });

  it('rebuilds every page from the source headings, shifts aside', () => {
    const pages = plantedSplit();
    const derivations = deriveBodies(SOURCE, PAGES, pages);

    expect(derivations).toHaveLength(PAGES.length);

    for (const derivation of derivations) {
      expect(derivation.matches).toBe(true);

      // An empty extraction and a range compared against itself both
      // answer "equal", so the shifts are what say this range was the
      // right one rather than merely self-consistent.
      expect(derivation.shiftedUpDiffers).toBe(true);
      expect(derivation.shiftedDownDiffers).toBe(true);
    }

    // The two ends the any-level predicate exists for: verification
    // stops at the `###` below it, gates at the `##` above it.
    const byName = new Map(derivations.map((one) => [one.name, one]));
    const gates = byName.get('gates')!;
    expect(byName.get('verification')!.end).toBe(gates.start - 2);
    expect(SOURCE[gates.start - 1]).toBe('### Which gate reads which file');
  });

  it('balances the pages, the residue and one separator less', () => {
    const pages = plantedSplit();
    const balance = balanceOf(SOURCE, pages, RESIDUE.length);

    expect(balance.total).toBe(balance.source);
    expect(balance.separators).toBe(PAGES.length - 1);

    // The separator belongs to the NEXT heading, so the last section
    // has none to leave behind and the one-per-page form over-predicts
    // by exactly 1. Asserted here rather than assumed, both ways.
    const derivations = deriveBodies(SOURCE, PAGES, pages);
    const stripped = derivations.map((one) => one.stripped);
    expect(stripped.slice(0, -1)).toEqual(
      new Array(PAGES.length - 1).fill(1),
    );
    expect(stripped.at(-1)).toBe(0);
    expect(balance.carried + balance.residue + PAGES.length)
      .toBe(balance.source + 1);
  });

  it('assigns every heading to the residue or to one page', () => {
    const pages = plantedSplit();
    const assignment = assignHeadings(SOURCE, PAGES, pages, RESIDUE.length);

    expect(assignment).toEqual({
      missing: [],
      extra: [],
      unassigned: [],
      misassigned: [],
    });

    // The map carries the residue VERBATIM and adds only its own
    // lines below it, which is what makes the residue accounted for
    // rather than merely deleted.
    expect(MAP.slice(0, RESIDUE.length)).toEqual([...RESIDUE]);
    expect(MAP).toHaveLength(RESIDUE.length + MAP_ADDITIONS.length);
    expect(MAP_ADDITIONS.length).toBeGreaterThan(0);
  });

  it('names the line a page that dropped its last one leaves over', () => {
    const short = bodyOf(PAGES[2]!).slice(0, -1);
    const pages = readSplit(
      plant(splitWith('verification', short)),
      PAGES.map((page) => page.name),
    );
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);

    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('separator');
    expect(SOURCE[account.mismatch!.at - 1])
      .toBe('are snapshots that move on their own.');
    expect(account.unaccounted.length).toBeGreaterThan(0);
    expect(account.unaccounted[0]).toBe(account.mismatch!.at);
  });

  it('names the heading a page that kept its separator runs into', () => {
    const kept = [...bodyOf(PAGES[0]!), ''];
    const pages = readSplit(
      plant(splitWith('tooling', kept)),
      PAGES.map((page) => page.name),
    );
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);

    // The failure lands on a HEADING and not on the blank: the page
    // ate the separator, so the walk asks for one where the next
    // page's first line already is.
    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('separator');
    expect(account.mismatch!.expected).toBe('');
    expect(account.mismatch!.found).toBe('## Plans and specs (CRITICAL)');
  });

  it('names a line a page carried twice', () => {
    const body = bodyOf(PAGES[1]!);
    const doubled = [...body.slice(0, 3), body[2]!, ...body.slice(3)];
    const pages = readSplit(
      plant(splitWith('security', doubled)),
      PAGES.map((page) => page.name),
    );
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);

    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('page:security');
    expect(account.mismatch!.expected).toBe(body[2]);
    expect(account.mismatch!.found).toBe(body[3]);
  });

  it('names the blank two sections on one page lost between them', () => {
    // Two adjacent sections carried onto one page are ONE CONTIGUOUS
    // slice of the source. Assembled instead from two independently
    // stripped bodies, the page is a line short at the boundary and
    // both readings that look at bytes say so.
    const sections = PAGES[1]!.sections;
    const first = sections[0]!;
    const second = sections[1]!;
    const joined = [
      first.heading,
      ...first.lines,
      second.heading,
      ...second.lines,
    ];
    const pages = readSplit(
      plant(splitWith('security', joined)),
      PAGES.map((page) => page.name),
    );
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);

    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('page:security');
    expect(account.mismatch!.expected).toBe('## Security posture');
    expect(account.mismatch!.found).toBe('');

    const derivations = deriveBodies(SOURCE, PAGES, pages);
    const security = derivations.find((one) => one.name === 'security')!;
    expect(security.matches).toBe(false);
  });

  it('names the first line of a page carried out of order', () => {
    const artefact = correctArtefact();
    const swapped = [
      artefact[0]!,
      artefact[1]!,
      artefact[3]!,
      artefact[2]!,
      artefact[4]!,
    ];
    const account = accountForSplit(SOURCE, MAP, swapped, RESIDUE.length);

    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('page:gates');
    expect(account.mismatch!.expected)
      .toBe('### Which gate reads which file');
    expect(account.mismatch!.found).toBe('## Verification order');
  });

  it('needs the roster and the ranges to see a swallowed subsection', () => {
    // The gates subsection folded into the page above it, exactly as
    // a derivation keyed on `^## ` would have written it.
    const merged: PageFile = {
      name: 'verification',
      body: [...bodyOf(PAGES[2]!), '', ...bodyOf(PAGES[3]!)],
    };
    const artefact = correctArtefact()
      .filter((page) => page.name !== 'gates')
      .map((page) => (page.name === 'verification'
        ? merged
        : page));
    const names = artefact.map((page) => page.name);
    const pages = readSplit(plant(artefact), names);

    // Not one byte moved, so the partition and the arithmetic both
    // pass. That is the whole reason the other two readings exist.
    const account = accountForSplit(SOURCE, MAP, pages, RESIDUE.length);
    expect(account.mismatch).toBeNull();
    expect(account.unaccounted).toEqual([]);
    expect(account.owners).toHaveLength(SOURCE.length);

    const balance = balanceOf(SOURCE, pages, RESIDUE.length);
    expect(balance.total).toBe(balance.source);

    // The roster names the page that never got written, and the page
    // carrying a heading it was never assigned.
    const assignment = assignHeadings(SOURCE, PAGES, pages, RESIDUE.length);
    expect(assignment.missing).toEqual(['gates']);
    expect(assignment.extra).toEqual([]);
    expect(assignment.unassigned).toEqual([]);
    expect(assignment.misassigned).toEqual([
      { page: 'verification', heading: '### Which gate reads which file' },
    ]);

    // And the range derivation stops at the `###` the merged page ran
    // straight through, so its body no longer matches the source.
    const derivations = deriveBodies(SOURCE, PAGES, pages);
    const byName = new Map(derivations.map((one) => [one.name, one]));
    expect(byName.get('verification')!.matches).toBe(false);
    expect(byName.get('gates')!.matches).toBe(false);
    expect(byName.get('tooling')!.matches).toBe(true);
  });

  it('names a map whose head no longer matches the source', () => {
    const dropped = RESIDUE.findIndex((line) => line.startsWith('| `tools'));
    const drifted = MAP.filter((_line, index) => index !== dropped);
    const pages = plantedSplit();
    const account = accountForSplit(SOURCE, drifted, pages, RESIDUE.length);

    // The map is where the residue is accounted for, so a map that
    // quietly lost one of those lines is a source line nobody kept.
    expect(dropped).toBeGreaterThan(0);
    expect(account.mismatch).not.toBeNull();
    expect(account.mismatch!.owner).toBe('map');
    expect(account.mismatch!.at).toBe(dropped + 1);
    expect(account.mismatch!.expected).toBe('');
    expect(account.mismatch!.found).toContain('tools/ralph');
  });

  it('still carries every trap the real split had', () => {
    // The fixture is the subject of every case above, so a later edit
    // that flattened one of these would leave the suite green and
    // testing less. Each line here is one trap.
    const levels = headingsOf(SOURCE).map((heading) => heading.level);
    expect(levels).toEqual([1, 2, 2, 2, 2, 2, 3, 2]);

    const twoSection = PAGES.filter((page) => page.sections.length === 2);
    expect(twoSection.map((page) => page.name)).toEqual(['security']);
    expect(PAGES).toHaveLength(5);

    // The residue runs into the first page with no separator of its
    // own, which is what makes the residue 20 lines and not 21 in the
    // real file and what the balance arithmetic assumes here.
    expect(RESIDUE.at(-1)).toBe('');
    expect(SOURCE[RESIDUE.length]).toBe('## Shared tooling');

    // No section ends blank, so every trailing blank in the source is
    // a separator and the strip counts above mean what they say.
    for (const page of PAGES) {
      for (const section of page.sections) {
        expect(section.lines.at(-1)).not.toBe('');
      }
    }

    // The source is assembled, never read, so its size is a property
    // of the table rather than of any file on disk.
    const carried = PAGES.reduce((sum, page) => sum + bodyOf(page).length, 0);
    expect(SOURCE).toHaveLength(RESIDUE.length + carried + PAGES.length - 1);
  });
});
