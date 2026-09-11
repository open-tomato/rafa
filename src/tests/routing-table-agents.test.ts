/**
 * Every agent the routing table names resolves to something.
 *
 * `context/workflow.md` carries the task-shape routing table, and its
 * THIRD column is the load-bearing one. Each row holds either the
 * tracked `.claude/agents/<name>.md` path that travels with a clone,
 * or the literal `user-level`, which is a portability warning that the
 * name resolves against whatever the machine happens to hold. That is
 * what lets a routed name be checked as portable-or-marked without a
 * hardcoded roster living in this file: the table declares which of
 * the two it is, and this file holds the declaration to the tree.
 *
 * A wrong row is worth a test because of what the CLI does with one.
 * An unresolvable `--agent` name exits 1 with NO JSON at all and the
 * whole roster on stderr, before any model call — so a row pointing
 * at nothing STOPS a dispatch rather than quietly running it unrouted.
 * A red case here is the cheap version of that failure, found by the
 * suite instead of by a loop that has stopped.
 *
 * ## The live page, not a fixture
 *
 * The subject IS the table. A fixture would assert that a string this
 * file wrote agrees with a directory listing this file also chose, and
 * would pass unchanged against a page whose rows had all gone stale.
 * `agents-split-accounting.test.ts` beside it is fixture-driven for
 * the opposite and equally deliberate reason: it checks the split's
 * ARITHMETIC, which must keep holding while the live pages grow.
 *
 * ## The claim is two-sided
 *
 * A project row owes two readings that are not the same reading. `git
 * ls-files` reads the INDEX, so it answers whether the file travels;
 * `existsSync` answers whether it is there to be read. A file deleted
 * from the worktree but still staged passes the first and fails the
 * second, and only the second is what a dispatch actually opens.
 *
 * A `user-level` row owes the NEGATIVE half, and it is the one that
 * goes stale silently. A project file of the same name REPLACES the
 * user-level agent rather than merging with it, and the CLI roster is
 * blind to the difference — a shadowed name appears exactly ONCE in
 * the list of available agents. So the day someone lands
 * `.claude/agents/tdd-guide.md`, the table's `user-level` marker is
 * false and nothing else in the tree reports it.
 *
 * Nothing here reads a user-level agent file: it lives outside the
 * repo by definition, and this file spawns no `claude`. The whole
 * claim about that bucket is the shadow one.
 *
 * ## Reading tracked-ness
 *
 * `git ls-files -z -- .claude/agents` once, read as a LISTING, and
 * never per path as an exit code: `git ls-files <path>` exits 0 with
 * EMPTY stdout for a path git has never seen, so the reflexive
 * `ls-files "$p" && echo tracked` idiom answers "tracked" for a
 * fabricated name. `-z` because the default output quotes a path
 * carrying a space. The listing's own liveness is the fabricated
 * member coming back ABSENT, which is what separates a live set from
 * one that has stopped containing anything.
 *
 * ## The prose pin
 *
 * The paragraph under the table states both bucket counts in words,
 * which is the only other statement in the tree that moves when a row
 * is added. Pinning it turns "the table grew and the prose did not"
 * into a red instead of a sentence nobody re-reads. The phrase
 * crosses a hand wrap (`The three tracked rows` ends a line and
 * `travel.` opens the next), so the match runs over whitespace-
 * normalised text — a line-based search finds one of the two and
 * reports the other as missing.
 *
 * Landing this file corrected both numbers. The table has carried
 * nine rows, three tracked and six user-level, since the commit that
 * added it, while the prose said five and four — and so did that
 * commit's own message. Two arithmetic slips in prose, invisible to
 * every gate, which is exactly the shape this pin exists for.
 *
 * ## The controls
 *
 * Every core claim here is an empty offender list, and an empty list
 * is what a matcher that has stopped matching also answers. Seven
 * plants carry those zeros, each built by rewriting the LIVE page in
 * memory so the matcher under test is the real one: a third column
 * that is neither form, a project row pointing at an untracked path,
 * a project row pointing at a tracked file belonging to ANOTHER agent
 * (which holds the name claim apart from the tracked one — the
 * planted path is still tracked), a prose count moved off the table's
 * own, a prose count written as a word the reader cannot parse, a
 * bare `|` inside a cell, and a header line with no alignment row
 * under it. Every plant asserts its target appeared exactly ONCE on
 * the line it rewrote, so a mis-transcribed target reads as a failed
 * plant rather than as a clean tree.
 *
 * The last two exist because their rules have no violator on a
 * well-formed page. A pipe count compared against the header's own
 * cannot differ while every row is correct, and a header with no
 * delimiter under it is not something the live page contains — so
 * both rules read as covered until a fixture VIOLATES them, and the
 * plant is that fixture.
 *
 * ## The mutation grid
 *
 * Twenty-three legs over this file's own helpers, each asked for case
 * NAMES through `--reporter=json` and restored from a captured copy.
 * All 23 applied, all 23 reddened, the union covers all 21 cases and
 * the file came back bytes-identical.
 *
 * The first pass is the reading worth keeping. It ran 22 legs with 3
 * green and the union at 17 of 18, and every one of the four holes
 * was the same shape: a rule with no violating fixture. The unchecked
 * `git ls-files` status (nothing made git fail), the loosened
 * exactly-once plant guard (no target appeared twice), the dropped
 * one-table guard (nothing built a second table), and the agent-cell
 * regex — which a leg widening it to `/^(.*)$/` cannot redden, since
 * the case asserts no cell parses to null and everything parses under
 * a wider rule. Four cases closed all four: a plant target that is
 * not unique, a page carrying two tables, `trackedAgentFiles` over a
 * directory git knows nothing about, and a leg NARROWING the agent
 * regex instead of widening it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE_PATH = 'context/workflow.md';
const AGENT_DIR = '.claude/agents';
const USER_LEVEL_MARKER = 'user-level';

/** The header that identifies the routing table wherever it sits. */
const ROUTING_HEADER = ['Task shape', 'Agent', 'Where it lives'] as const;

/** A markdown alignment row, which is what makes a pipe line a table. */
const DELIMITER_ROW = /^\|(?:\s*:?-+:?\s*\|)+$/;

/** The agent column: one code span holding a slug and nothing else. */
const AGENT_CELL = /^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/;

/** The home column's project form: one code span holding the path. */
const AGENT_PATH_CELL = /^`(\.claude\/agents\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md)`$/;

/** The two count sentences, matched over whitespace-normalised prose. */
const USER_LEVEL_COUNT = /Those ([a-z]+) definitions live outside the repo/;
const PROJECT_COUNT = /The ([a-z]+) tracked rows travel/;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** A name no agent file has, used as the dead-needle control. */
const FABRICATED = `${AGENT_DIR}/zz-not-a-real-agent.md`;

export interface TableRow {
  /** 1-indexed line in the page, so an offender names where it is. */
  readonly line: number;
  readonly cells: readonly string[];
  /** Raw `|` count, which a cell carrying one of its own inflates. */
  readonly pipes: number;
}

export interface MarkdownTable {
  readonly header: TableRow;
  readonly rows: readonly TableRow[];
}

export type AgentHome =
  | { readonly kind: 'project'; readonly path: string; readonly name: string }
  | { readonly kind: 'user-level' }
  | { readonly kind: 'unrecognised'; readonly cell: string };

export interface RoutingEntry {
  readonly line: number;
  readonly pipes: number;
  readonly shape: string;
  readonly agentCell: string;
  /** The slug, or null when the cell is not a lone code span. */
  readonly agent: string | null;
  readonly home: AgentHome;
}

/** A project row with its home flattened, so callers stop narrowing. */
export interface ProjectRow {
  readonly entry: RoutingEntry;
  readonly path: string;
  readonly name: string;
}

export interface ProseCount {
  /** The word as written, which is what a plant rewrites. */
  readonly word: string | null;
  readonly value: number | null;
}

/**
 * Splits one pipe line into trimmed cells, keeping the raw pipe count.
 *
 * The count is kept rather than derived because it is the reading that
 * catches a cell carrying a bare `|` inside a code span — the row then
 * renders with extra columns while its cell list still looks plausible.
 */
export function splitTableRow(line: string, lineNumber: number): TableRow {
  const pipes = (line.match(/\|/g) ?? []).length;
  const trimmed = line.trim();
  const withoutLead = trimmed.startsWith('|')
    ? trimmed.slice(1)
    : trimmed;
  const body = withoutLead.endsWith('|')
    ? withoutLead.slice(0, -1)
    : withoutLead;
  return {
    line: lineNumber,
    cells: body.split('|').map((cell) => cell.trim()),
    pipes,
  };
}

/**
 * Every table in the text whose header is the routing header.
 *
 * Returns all of them rather than the first, so "there is exactly one"
 * is a claim a case can make instead of an assumption this makes.
 */
export function findRoutingTables(text: string): MarkdownTable[] {
  const lines = text.split('\n');
  const tables: MarkdownTable[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('|')) continue;
    const header = splitTableRow(line, index + 1);
    if (header.cells.length !== ROUTING_HEADER.length) continue;
    if (!ROUTING_HEADER.every((name, column) => header.cells[column] === name)) continue;
    if (!DELIMITER_ROW.test(lines[index + 1] ?? '')) continue;

    const rows: TableRow[] = [];
    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const row = lines[cursor] ?? '';
      if (!row.startsWith('|')) break;
      rows.push(splitTableRow(row, cursor + 1));
    }
    tables.push({ header, rows });
  }
  return tables;
}

/** Which of the two declared forms the home column carries. */
export function classifyHome(cell: string): AgentHome {
  if (cell === USER_LEVEL_MARKER) return { kind: 'user-level' };
  const path = AGENT_PATH_CELL.exec(cell);
  if (path !== null) return { kind: 'project', path: path[1] ?? '', name: path[2] ?? '' };
  return { kind: 'unrecognised', cell };
}

/** One entry per data row, with both keyed columns read. */
export function readRoutingEntries(table: MarkdownTable): RoutingEntry[] {
  return table.rows.map((row) => ({
    line: row.line,
    pipes: row.pipes,
    shape: row.cells[0] ?? '',
    agentCell: row.cells[1] ?? '',
    agent: AGENT_CELL.exec(row.cells[1] ?? '')?.[1] ?? null,
    home: classifyHome(row.cells[2] ?? ''),
  }));
}

/** The project rows, flattened. */
export function projectRows(entries: readonly RoutingEntry[]): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const entry of entries) {
    if (entry.home.kind !== 'project') continue;
    rows.push({ entry, path: entry.home.path, name: entry.home.name });
  }
  return rows;
}

/** The rows that declare themselves outside the repo. */
export function userLevelRows(entries: readonly RoutingEntry[]): RoutingEntry[] {
  return entries.filter((entry) => entry.home.kind === 'user-level');
}

/**
 * The offender rules, each a named function rather than a filter
 * inlined into the case that asserts it is empty.
 *
 * The live claim and its planted control then share ONE site. A rule
 * that has stopped finding anything answers `[]` for the live page,
 * which reads as clean, and `[]` for the plant, which reads as red.
 * Inlining each filter twice would let the two drift into parallel
 * implementations agreeing with each other.
 */

/** Rows whose home column is neither declared form. */
export function unrecognisedRows(entries: readonly RoutingEntry[]): RoutingEntry[] {
  return entries.filter((entry) => entry.home.kind === 'unrecognised');
}

/** Rows whose raw pipe count differs from the one the header carries. */
export function pipeCountOffenders(table: MarkdownTable): TableRow[] {
  return table.rows.filter((row) => row.pipes !== table.header.pipes);
}

/** Project rows naming a path git does not track. */
export function untrackedProjectRows(
  entries: readonly RoutingEntry[],
  tracked: ReadonlySet<string>,
): ProjectRow[] {
  return projectRows(entries).filter((row) => !tracked.has(row.path));
}

/** Project rows whose file is not on disk to be opened. */
export function missingProjectFiles(entries: readonly RoutingEntry[], root: string): ProjectRow[] {
  return projectRows(entries).filter((row) => !existsSync(join(root, row.path)));
}

/**
 * Project rows whose file belongs to an agent other than the one
 * naming it.
 *
 * The stem against the slug, rather than a rebuilt path: the
 * directory and the extension are already pinned by the cell regex,
 * so the one freedom left in a well-formed path column is which agent
 * the file is named for.
 */
export function mismatchedProjectRows(entries: readonly RoutingEntry[]): ProjectRow[] {
  return projectRows(entries).filter((row) => row.name !== row.entry.agent);
}

/** User-level rows a tracked project file of the same name would shadow. */
export function shadowedUserLevelRows(
  entries: readonly RoutingEntry[],
  tracked: ReadonlySet<string>,
): RoutingEntry[] {
  return userLevelRows(entries)
    .filter((entry) => tracked.has(`${AGENT_DIR}/${entry.agent ?? ''}.md`));
}

/**
 * Everything git tracks under `.claude/agents`, as a listing.
 *
 * A failure to RUN is thrown rather than answered as an empty set: an
 * empty set would make every membership claim in this file pass, which
 * is the silent fallback the file exists to rule out.
 */
export function trackedAgentFiles(root: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', AGENT_DIR], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error !== undefined) {
    throw new Error(`git ls-files did not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ls-files exited ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout.split('\0').filter((path) => path !== '');
}

/** Both stated counts, read off whitespace-normalised prose. */
export function proseCounts(text: string): { userLevel: ProseCount; project: ProseCount } {
  const joined = text.replace(/\s+/g, ' ');
  const read = (pattern: RegExp): ProseCount => {
    const word = pattern.exec(joined)?.[1] ?? null;
    return {
      word,
      value: word === null
        ? null
        : NUMBER_WORDS[word] ?? null,
    };
  };
  return { userLevel: read(USER_LEVEL_COUNT), project: read(PROJECT_COUNT) };
}

const PAGE_TEXT = readFileSync(join(REPO_ROOT, PAGE_PATH), 'utf8');
const TABLES = findRoutingTables(PAGE_TEXT);
const TABLE = TABLES[0];
const ENTRIES = TABLE === undefined
  ? []
  : readRoutingEntries(TABLE);
const TRACKED = new Set(trackedAgentFiles(REPO_ROOT));

/** Replaces a substring that must appear exactly once. */
function plantOnce(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(`plant target ${JSON.stringify(from)} appears ${String(parts.length - 1)} times, not once`);
  }
  return parts.join(to);
}

/** The live page with one cell of one row rewritten. */
function plantOnRow(entry: RoutingEntry, from: string, to: string): string {
  const lines = PAGE_TEXT.split('\n');
  const index = entry.line - 1;
  lines[index] = plantOnce(lines[index] ?? '', from, to);
  return lines.join('\n');
}

/** The one routing table in a planted page, or a named failure. */
function tableOf(text: string): MarkdownTable {
  const found = findRoutingTables(text);
  const table = found[0];
  if (found.length !== 1 || table === undefined) {
    throw new Error(`expected one routing table, found ${String(found.length)}`);
  }
  return table;
}

/** The first row of a bucket, or a named failure saying the plant has no subject. */
function firstOr<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`no ${what} to plant on`);
  return row;
}

describe('the workflow routing table names agents that resolve', () => {
  it('finds exactly one routing table, with rows', () => {
    expect(TABLES).toHaveLength(1);
    expect(TABLE?.header.cells).toEqual([...ROUTING_HEADER]);
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it('splits every row on the pipe count its header carries', () => {
    expect(TABLE).toBeDefined();
    const offenders = TABLE === undefined
      ? ['no table']
      : pipeCountOffenders(TABLE).map((row) => `${PAGE_PATH}:${row.line}`);
    expect(offenders).toEqual([]);
    const cellCounts = TABLE === undefined
      ? []
      : TABLE.rows.map((row) => row.cells.length);
    expect([...new Set(cellCounts)]).toEqual([ROUTING_HEADER.length]);
  });

  it('spells every agent cell as a single code span', () => {
    const offenders = ENTRIES
      .filter((entry) => entry.agent === null)
      .map((entry) => `${PAGE_PATH}:${entry.line} ${entry.agentCell}`);
    expect(offenders).toEqual([]);
  });

  it('gives every row a tracked project path or the user-level marker', () => {
    const offenders = unrecognisedRows(ENTRIES)
      .map((entry) => `${PAGE_PATH}:${entry.line} ${entry.agent ?? entry.agentCell}`);
    expect(offenders).toEqual([]);
  });

  it('has a live subject in both buckets', () => {
    // Without this the claim above is one-sided: a table of nothing but
    // user-level rows satisfies it while proving nothing about paths.
    expect(projectRows(ENTRIES).length).toBeGreaterThan(0);
    expect(userLevelRows(ENTRIES).length).toBeGreaterThan(0);
    expect(projectRows(ENTRIES).length + userLevelRows(ENTRIES).length).toBe(ENTRIES.length);
  });

  it('reads a live tracked listing that refuses a fabricated member', () => {
    expect(TRACKED.size).toBeGreaterThan(0);
    expect([...TRACKED].filter((path) => !path.startsWith(`${AGENT_DIR}/`))).toEqual([]);
    expect(TRACKED.has(FABRICATED)).toBe(false);
  });

  it('names a file git tracks for every project row', () => {
    const untracked = untrackedProjectRows(ENTRIES, TRACKED)
      .map((row) => `${PAGE_PATH}:${row.entry.line} ${row.path}`);
    expect(untracked).toEqual([]);
  });

  it('has every project row on disk as well as in the index', () => {
    const missing = missingProjectFiles(ENTRIES, REPO_ROOT)
      .map((row) => `${PAGE_PATH}:${row.entry.line} ${row.path}`);
    expect(missing).toEqual([]);
    expect(existsSync(join(REPO_ROOT, FABRICATED))).toBe(false);
  });

  it('names each project file after the agent of the row holding it', () => {
    const mismatched = mismatchedProjectRows(ENTRIES)
      .map((row) => `${PAGE_PATH}:${row.entry.line} ${row.entry.agent ?? ''} -> ${row.path}`);
    expect(mismatched).toEqual([]);
  });

  it('leaves no user-level row shadowed by a tracked project file', () => {
    const shadowed = shadowedUserLevelRows(ENTRIES, TRACKED)
      .map((entry) => `${PAGE_PATH}:${entry.line} ${entry.agent ?? ''}`);
    expect(shadowed).toEqual([]);
  });

  it('states both bucket counts in the prose under the table', () => {
    const counts = proseCounts(PAGE_TEXT);
    expect(counts.userLevel.word).not.toBeNull();
    expect(counts.project.word).not.toBeNull();
    expect(counts.userLevel.value).toBe(userLevelRows(ENTRIES).length);
    expect(counts.project.value).toBe(projectRows(ENTRIES).length);
  });

  it('reports a third column that is neither declared form', () => {
    const target = firstOr(userLevelRows(ENTRIES), 'user-level row');
    const planted = plantOnRow(target, USER_LEVEL_MARKER, 'whatever the machine holds');
    expect(planted).not.toEqual(PAGE_TEXT);
    const offenders = unrecognisedRows(readRoutingEntries(tableOf(planted)))
      .map((entry) => entry.line);
    expect(offenders).toEqual([target.line]);
  });

  it('reports a row carrying a pipe inside one of its cells', () => {
    // The pipe count is the header's own, so nothing in a well-formed
    // table can violate it: this is the fixture that does. A bare `|`
    // inside a code span renders as an extra column while the cell list
    // it splits into still looks plausible.
    const target = firstOr(ENTRIES, 'table row');
    const planted = plantOnRow(target, target.agentCell, target.agentCell.replace('-', '|'));
    const offenders = pipeCountOffenders(tableOf(planted)).map((row) => row.line);
    expect(offenders).toEqual([target.line]);
  });

  it('takes a header line with no alignment row for prose, not a table', () => {
    const header = `| ${ROUTING_HEADER.join(' | ')} |`;
    const loose = `${PAGE_TEXT}\n${header}\n`;
    expect(findRoutingTables(loose)).toHaveLength(1);
    // Nor is it swallowed as a ROW of the table above it: the collector
    // stops at the first line that is not a pipe line, which is the only
    // thing standing between the table and the rest of the page.
    expect(tableOf(loose).rows).toHaveLength(ENTRIES.length);
    // The same plant WITH an alignment row is found, which is what says
    // the zero above is the delimiter refusing it rather than the plant
    // being invisible to the finder.
    expect(findRoutingTables(`${loose}|---|---|---|\n`)).toHaveLength(2);
  });

  it('reports a project row pointing at a path git does not track', () => {
    const target = firstOr(projectRows(ENTRIES), 'project row');
    const planted = plantOnRow(target.entry, `\`${target.path}\``, `\`${FABRICATED}\``);
    const untracked = untrackedProjectRows(readRoutingEntries(tableOf(planted)), TRACKED)
      .map((row) => row.path);
    expect(untracked).toEqual([FABRICATED]);
  });

  it('reports a project row pointing at a tracked file of another agent', () => {
    const target = firstOr(projectRows(ENTRIES), 'project row');
    const other = firstOr(
      [...TRACKED].sort().filter((path) => path !== target.path),
      'second tracked agent file',
    );
    const planted = plantOnRow(target.entry, `\`${target.path}\``, `\`${other}\``);
    const mismatched = mismatchedProjectRows(readRoutingEntries(tableOf(planted)))
      .map((row) => row.path);
    expect(mismatched).toEqual([other]);
    // The plant stays TRACKED, which is what holds the name claim apart
    // from the tracked one: only the row-to-file agreement moved.
    expect(TRACKED.has(other)).toBe(true);
  });

  it('refuses a plant target that is not unique on its line', () => {
    // Every control in this file rests on the plant having landed where
    // it was aimed. A target matching twice would splice the page in two
    // places and still produce a plausible offender list.
    expect(() => plantOnce('a b a', 'a', 'z')).toThrow(/appears 2 times/);
    expect(() => plantOnce('a b', 'q', 'z')).toThrow(/appears 0 times/);
    expect(plantOnce('a b', 'a', 'z')).toBe('z b');
  });

  it('refuses a page carrying two routing tables', () => {
    const second = `| ${ROUTING_HEADER.join(' | ')} |\n|---|---|---|\n`;
    expect(() => tableOf(`${PAGE_TEXT}\n${second}`)).toThrow(/found 2/);
    expect(tableOf(PAGE_TEXT).rows).toHaveLength(ENTRIES.length);
  });

  it('throws rather than answering an empty listing where git cannot run', () => {
    // An empty set would pass every membership claim in this file, which
    // is the silent fallback a routing entry pointing at nothing gets.
    const outside = mkdtempSync(join(tmpdir(), 'ralph-routing-'));
    try {
      expect(() => trackedAgentFiles(outside)).toThrow(/git ls-files exited/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports a prose count that has drifted off the table', () => {
    const counts = proseCounts(PAGE_TEXT);
    const word = counts.userLevel.word;
    if (word === null) throw new Error('no user-level count sentence to plant on');
    const wrong = Object.keys(NUMBER_WORDS)
      .filter((candidate) => NUMBER_WORDS[candidate] !== counts.userLevel.value);
    const replacement = firstOr(wrong, 'number word differing from the table');
    const planted = plantOnce(PAGE_TEXT, `Those ${word} definitions`, `Those ${replacement} definitions`);
    expect(proseCounts(planted).userLevel.value).not.toBe(userLevelRows(ENTRIES).length);
  });

  it('reports a prose count written as a word it cannot read', () => {
    const counts = proseCounts(PAGE_TEXT);
    const word = counts.project.word;
    if (word === null) throw new Error('no tracked-row count sentence to plant on');
    const planted = plantOnce(PAGE_TEXT, `The ${word} tracked rows`, 'The umpteen tracked rows');
    expect(proseCounts(planted).project.word).toBe('umpteen');
    expect(proseCounts(planted).project.value).toBeNull();
  });
});
