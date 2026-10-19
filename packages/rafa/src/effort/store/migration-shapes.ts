/**
 * What a migration's SQL does, statement by statement, and what that
 * breaks for an older runtime that never ran it.
 *
 * ## The rows it matches
 *
 * {@link classifyMigration} strips comments, splits the SQL into
 * statements, and gives each one a {@link StatementShape}, a row of the
 * additive table in the spec and in `context/effort-store.md`:
 *
 *   - A new table, a new nullable column (a CHECK is allowed), a new
 *     non-unique index and a new view break nothing.
 *   - A unique index breaks nothing when its table was created by the
 *     same migration, or when it covers a column the same migration adds
 *     and its `WHERE` requires that column to be non-NULL. An older
 *     writer leaves such a column NULL, so none of its rows is indexed.
 *   - Any other new unique index, any dropped index and a trigger break
 *     `writers`. A dropped index is counted as unique, because the
 *     statement alone does not say which kind it was.
 *   - A dropped or renamed table or column breaks `readers` and
 *     `writers`, and so does a statement matching no row.
 *
 * Four shapes are refused in an additive entry whatever it declares: a
 * column added `NOT NULL`, a column added with a `DEFAULT` other than
 * NULL, a PRAGMA, and a data statement. An older writer fills a
 * defaulted column with a value that reads as a real one, a PRAGMA can
 * move the legacy gate, and a backfill is a command the installed
 * runtime runs, not a migration. A breaking table rebuild may carry its
 * `INSERT … SELECT`, so these are not refused in a breaking entry. A
 * shape matching no row is refused in an additive entry as well.
 *
 * ## Which way it errs
 *
 * Where the text leaves a shape in doubt, the classifier answers the
 * wider break: a partial index whose `WHERE` holds an `OR` or a
 * `BETWEEN` at its top level, or wraps the guard in parentheses, is not
 * read as guarded. A computed break an entry does not declare is
 * reported as `under-declared`, so a wrong answer here asks for a
 * declaration and never lets a breaking change pass as additive.
 *
 * ## What it names as created
 *
 * `creates` lists every object the SQL names in a `CREATE`, read from
 * the text before comments are stripped. A statement a comment swallowed
 * runs nowhere and still reads as present, so an object named there and
 * missing from `sqlite_master` once the entry has run shows the swallow.
 * An object the same entry drops is left out, and a table the same entry
 * renames is listed under its new name.
 *
 * `migrations.test.ts` is the one reader: it runs every entry of
 * `SQLITE_MIGRATIONS` through this module and applies each to
 * `:memory:`. The module imports nothing from SQLite.
 */
import type { MigrationBreak, SqliteMigration } from './migrations.js';

/** A row of the additive table a statement matches. */
export type StatementShape =
  | 'create-table'
  | 'add-column'
  | 'add-column-not-null'
  | 'add-column-default'
  | 'create-index'
  | 'create-view'
  | 'create-unique-index-on-new-table'
  | 'create-unique-index-on-new-column'
  | 'create-unique-index'
  | 'drop-index'
  | 'create-trigger'
  | 'drop-table'
  | 'drop-column'
  | 'rename-table'
  | 'rename-column'
  | 'data'
  | 'pragma'
  | 'unknown';

/** One statement of a migration, with comments stripped. */
export interface ClassifiedStatement {
  /** Its tokens as written, joined by single spaces. */
  readonly text: string;
  readonly shape: StatementShape;
  /** What the shape breaks for an older runtime. */
  readonly breaks: readonly MigrationBreak[];
}

/** An object a migration's text names in a `CREATE`. */
export interface CreatedObject {
  readonly type: 'table' | 'index' | 'view' | 'trigger';
  /** As `sqlite_master` would spell it: unquoted, without a schema. */
  readonly name: string;
}

/** A shape an additive entry may not hold. */
export type AdditiveRefusal = 'not-null-column' | 'default-column' | 'pragma' | 'data' | 'unknown-shape';

/** One way an entry's SQL disagrees with what it declares. */
export type ShapeProblem =
  /** The SQL breaks more than the entry's `breaks` names. */
  | { readonly kind: 'under-declared'; readonly missing: readonly MigrationBreak[] }
  /** A statement an additive entry may not hold. */
  | { readonly kind: AdditiveRefusal; readonly statement: string };

/** What {@link classifyMigration} reads from one entry. */
export interface MigrationClassification {
  readonly statements: readonly ClassifiedStatement[];
  /** The union of every statement's breaks, readers before writers. */
  readonly computed: readonly MigrationBreak[];
  readonly creates: readonly CreatedObject[];
  /** Empty when the entry's SQL is what it declares. */
  readonly problems: readonly ShapeProblem[];
}

const BOTH: readonly MigrationBreak[] = ['readers', 'writers'];

const SHAPE_BREAKS: Readonly<Record<StatementShape, readonly MigrationBreak[]>> = {
  'create-table': [],
  'add-column': [],
  'add-column-not-null': [],
  'add-column-default': [],
  'create-index': [],
  'create-view': [],
  'create-unique-index-on-new-table': [],
  'create-unique-index-on-new-column': [],
  'create-unique-index': ['writers'],
  'drop-index': ['writers'],
  'create-trigger': ['writers'],
  'drop-table': BOTH,
  'drop-column': BOTH,
  'rename-table': BOTH,
  'rename-column': BOTH,
  data: [],
  pragma: [],
  unknown: BOTH,
};

const ADDITIVE_REFUSALS: Partial<Record<StatementShape, AdditiveRefusal>> = {
  'add-column-not-null': 'not-null-column',
  'add-column-default': 'default-column',
  pragma: 'pragma',
  data: 'data',
  unknown: 'unknown-shape',
};

/** The words a data statement opens with. */
const DATA_HEADS = new Set(['INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'WITH', 'SELECT', 'VALUES']);

/** One lexical token of SQLite's SQL. */
interface Token {
  readonly kind: 'word' | 'name' | 'string' | 'number' | 'symbol';
  /** As written. */
  readonly source: string;
  /** A quoted identifier without its quotes; otherwise as written. */
  readonly value: string;
}

/**
 * SQLite's lexemes in the order they are tried. A `--` comment runs to
 * the end of its line, and a block comment, a string or a quoted name
 * left open runs to the end of the text, as SQLite reads them.
 */
const LEXEMES: readonly (readonly [Token['kind'] | 'blank', RegExp])[] = [
  ['blank', /\s+|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /'(?:[^']|'')*(?:'|$)/y],
  ['name', /"(?:[^"]|"")*(?:"|$)|`(?:[^`]|``)*(?:`|$)|\[[^\]]*(?:\]|$)/y],
  ['word', /[A-Za-z_\u0080-￿][\w$\u0080-￿]*/y],
  ['number', /\d[\w.]*|\.\d\w*/y],
  ['symbol', /[\s\S]/y],
];

/** An identifier as a `CREATE` names it, bare or quoted. */
const IDENTIFIER = String.raw`"(?:[^"]|"")*"|\x60(?:[^\x60]|\x60\x60)*\x60|\[[^\]]*\]|[A-Za-z_][\w$]*`;

/** A `CREATE` in raw text: the object's type, then its name. */
const CREATE_NAMED = new RegExp(
  String.raw`\bCREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?(?:UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+`
    + String.raw`(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:${IDENTIFIER})\s*\.\s*)?(${IDENTIFIER})`,
  'gi',
);

/** An identifier's value: a quoted one loses its quotes and doubled quotes. */
function identifierValue(source: string): string {
  const open = source.charAt(0);
  const close = open === '['
    ? ']'
    : open;
  if (open !== '[' && open !== '"' && open !== '`') return source;
  const closed = source.length > 1 && source.endsWith(close);
  const body = source.slice(1, source.length - Number(closed));
  return open === '['
    ? body
    : body.replaceAll(`${open}${open}`, open);
}

function nextLexeme(sql: string, at: number): readonly [Token['kind'] | 'blank', string] {
  for (const [kind, pattern] of LEXEMES) {
    pattern.lastIndex = at;
    const match = pattern.exec(sql);
    if (match !== null) return [kind, match[0]];
  }
  return ['symbol', sql.charAt(at)];
}

/** The tokens of `sql`, with whitespace and comments left out. */
function tokenize(sql: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < sql.length;) {
    const [kind, source] = nextLexeme(sql, at);
    at += source.length;
    if (kind === 'blank') continue;
    const value = kind === 'name'
      ? identifierValue(source)
      : source;
    tokens.push({ kind, source, value });
  }
  return tokens;
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === 'word' && token.source.toUpperCase() === word;
}

function isSymbol(token: Token | undefined, symbol: string): boolean {
  return token?.kind === 'symbol' && token.source === symbol;
}

/** The upper-cased word at `at`, or `''` when there is none. */
function wordAt(tokens: readonly Token[], at: number): string {
  const token = tokens[at];
  return token?.kind === 'word'
    ? token.source.toUpperCase()
    : '';
}

function isTemp(token: Token | undefined): boolean {
  return isWord(token, 'TEMP') || isWord(token, 'TEMPORARY');
}

/** Whether a statement's first tokens open a `CREATE TRIGGER`. */
function isTriggerHead(tokens: readonly Token[]): boolean {
  if (!isWord(tokens[0], 'CREATE')) return false;
  return isWord(tokens[1], 'TRIGGER') || (isTemp(tokens[1]) && isWord(tokens[2], 'TRIGGER'));
}

/** How a token moves a trigger body's `BEGIN … END` and `CASE … END` depth. */
function blockDelta(token: Token): number {
  if (isWord(token, 'BEGIN') || isWord(token, 'CASE')) return 1;
  return isWord(token, 'END')
    ? -1
    : 0;
}

/**
 * The statements of `tokens`, split at each `;`. Inside a trigger body
 * a `;` ends the statement only once its `BEGIN` has met its `END`.
 */
function splitStatements(tokens: readonly Token[]): readonly (readonly Token[])[] {
  const statements: (readonly Token[])[] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (depth <= 0 && isSymbol(token, ';')) {
      if (current.length > 0) statements.push(current);
      current = [];
      depth = 0;
      continue;
    }
    current.push(token);
    if (isTriggerHead(current)) depth += blockDelta(token);
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

/** A name at `at`, schema-qualified or not, and the index past it. */
function readName(tokens: readonly Token[], at: number): { readonly name: string; readonly next: number } | null {
  const first = tokens[at];
  if (first?.kind !== 'word' && first?.kind !== 'name') return null;
  const second = tokens[at + 2];
  if (isSymbol(tokens[at + 1], '.') && (second?.kind === 'word' || second?.kind === 'name')) {
    return { name: second.value, next: at + 3 };
  }
  return { name: first.value, next: at + 1 };
}

/** `at` moved past the words `words` when they follow in order. */
function skipWords(tokens: readonly Token[], at: number, words: readonly string[]): number {
  return words.every((word, offset) => isWord(tokens[at + offset], word))
    ? at + words.length
    : at;
}

/** The index of the `)` closing the `(` at `open`, or -1. */
function closingParen(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    if (isSymbol(tokens[at], '(')) depth += 1;
    if (isSymbol(tokens[at], ')')) depth -= 1;
    if (depth === 0) return at;
  }
  return -1;
}

/** `tokens` with each parenthesised group reduced to its opening `(`. */
function collapseGroups(tokens: readonly Token[]): readonly Token[] {
  const kept: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (depth === 0) kept.push(token);
    if (isSymbol(token, '(')) depth += 1;
    if (isSymbol(token, ')')) depth = Math.max(0, depth - 1);
  }
  return kept;
}

/** What a statement changes for the statements after it in one entry. */
type Effect =
  | { readonly kind: 'create-table'; readonly table: string }
  | { readonly kind: 'add-column'; readonly table: string; readonly column: string }
  | { readonly kind: 'rename-table'; readonly from: string; readonly to: string }
  | { readonly kind: 'drop'; readonly type: 'table' | 'index'; readonly name: string };

/** What the entry's earlier statements created, in lower case. */
interface Scope {
  readonly tables: ReadonlySet<string>;
  /** `<table>.<column>` for each column added. */
  readonly columns: ReadonlySet<string>;
}

interface Reading {
  readonly shape: StatementShape;
  readonly effect?: Effect;
}

const UNKNOWN: Reading = { shape: 'unknown' };

/**
 * The columns a partial index's `WHERE` requires to be non-NULL: each
 * top-level conjunct `c IS NOT NULL`, `c NOT NULL` or `c NOTNULL`. None
 * when the clause holds an `OR` or a `BETWEEN` at its top level.
 */
function nonNullColumns(where: readonly Token[]): ReadonlySet<string> {
  const clause = collapseGroups(where);
  if (clause.some((token) => isWord(token, 'OR') || isWord(token, 'BETWEEN'))) return new Set();
  const conjuncts: Token[][] = [[]];
  for (const token of clause) {
    if (isWord(token, 'AND')) conjuncts.push([]);
    else conjuncts[conjuncts.length - 1]?.push(token);
  }
  const guards = conjuncts.flatMap(([column, ...rest]) => {
    const words = rest.map(({ source }) => source.toUpperCase()).join(' ');
    const guarded = ['IS NOT NULL', 'NOT NULL', 'NOTNULL'].includes(words)
      && (column?.kind === 'word' || column?.kind === 'name');
    return guarded
      ? [column.value.toLowerCase()]
      : [];
  });
  return new Set(guards);
}

/** `CREATE [UNIQUE] INDEX … ON <table> (…) [WHERE …]`, from `ON`. */
function readIndex(tokens: readonly Token[], on: number, unique: boolean, scope: Scope): Reading {
  if (!isWord(tokens[on], 'ON')) return UNKNOWN;
  const table = readName(tokens, on + 1);
  if (table === null || !isSymbol(tokens[table.next], '(')) return UNKNOWN;
  const close = closingParen(tokens, table.next);
  if (close < 0) return UNKNOWN;
  if (!unique) return { shape: 'create-index' };

  const key = table.name.toLowerCase();
  if (scope.tables.has(key)) return { shape: 'create-unique-index-on-new-table' };
  const indexed = tokens.slice(table.next + 1, close).map(({ value }) => value.toLowerCase());
  const guarded = isWord(tokens[close + 1], 'WHERE')
    ? nonNullColumns(tokens.slice(close + 2))
    : new Set<string>();
  const covered = indexed.some((column) => guarded.has(column) && scope.columns.has(`${key}.${column}`));
  return {
    shape: covered
      ? 'create-unique-index-on-new-column'
      : 'create-unique-index',
  };
}

function readCreate(tokens: readonly Token[], scope: Scope): Reading {
  const afterTemp = isTemp(tokens[1])
    ? 2
    : 1;
  const unique = isWord(tokens[afterTemp], 'UNIQUE');
  const typeAt = unique
    ? afterTemp + 1
    : afterTemp;
  const type = wordAt(tokens, typeAt);
  const named = readName(tokens, skipWords(tokens, typeAt + 1, ['IF', 'NOT', 'EXISTS']));
  if (named === null) return UNKNOWN;
  if (type === 'INDEX') return readIndex(tokens, named.next, unique, scope);
  if (unique) return UNKNOWN;
  if (type === 'TABLE') {
    const effect: Effect = { kind: 'create-table', table: named.name };
    return isWord(tokens[named.next], 'AS')
      ? { shape: 'data', effect }
      : { shape: 'create-table', effect };
  }
  if (type === 'VIEW') return { shape: 'create-view' };
  return type === 'TRIGGER'
    ? { shape: 'create-trigger' }
    : UNKNOWN;
}

/** `ALTER TABLE <table> ADD [COLUMN] <column> …`, from the column's name. */
function readAddColumn(tokens: readonly Token[], at: number, table: string): Reading {
  const column = readName(tokens, at);
  if (column === null) return UNKNOWN;
  const effect: Effect = { kind: 'add-column', table, column: column.name };
  const definition = collapseGroups(tokens.slice(column.next));
  const notNull = definition.some((token, index) => isWord(token, 'NOT') && isWord(definition[index + 1], 'NULL'));
  if (notNull) return { shape: 'add-column-not-null', effect };
  const defaulted = definition.some((token, index) => isWord(token, 'DEFAULT') && !isWord(definition[index + 1], 'NULL'));
  return {
    shape: defaulted
      ? 'add-column-default'
      : 'add-column',
    effect,
  };
}

function readAlter(tokens: readonly Token[]): Reading {
  if (!isWord(tokens[1], 'TABLE')) return UNKNOWN;
  const table = readName(tokens, 2);
  if (table === null) return UNKNOWN;
  const verb = wordAt(tokens, table.next);
  const at = table.next + 1;
  if (verb === 'ADD') return readAddColumn(tokens, skipWords(tokens, at, ['COLUMN']), table.name);
  if (verb === 'DROP') return { shape: 'drop-column' };
  if (verb !== 'RENAME') return UNKNOWN;
  if (!isWord(tokens[at], 'TO')) return { shape: 'rename-column' };
  const to = readName(tokens, at + 1);
  return to === null
    ? UNKNOWN
    : { shape: 'rename-table', effect: { kind: 'rename-table', from: table.name, to: to.name } };
}

function readDrop(tokens: readonly Token[]): Reading {
  const type = wordAt(tokens, 1);
  const named = readName(tokens, skipWords(tokens, 2, ['IF', 'EXISTS']));
  if (named === null) return UNKNOWN;
  if (type === 'TABLE') return { shape: 'drop-table', effect: { kind: 'drop', type: 'table', name: named.name } };
  return type === 'INDEX'
    ? { shape: 'drop-index', effect: { kind: 'drop', type: 'index', name: named.name } }
    : UNKNOWN;
}

function readStatement(tokens: readonly Token[], scope: Scope): Reading {
  const head = wordAt(tokens, 0);
  if (head === 'CREATE') return readCreate(tokens, scope);
  if (head === 'ALTER') return readAlter(tokens);
  if (head === 'DROP') return readDrop(tokens);
  if (head === 'PRAGMA') return { shape: 'pragma' };
  return DATA_HEADS.has(head)
    ? { shape: 'data' }
    : UNKNOWN;
}

function widen(scope: Scope, effect: Effect | undefined): Scope {
  if (effect?.kind === 'create-table') {
    return { ...scope, tables: new Set([...scope.tables, effect.table.toLowerCase()]) };
  }
  if (effect?.kind === 'add-column') {
    const column = `${effect.table}.${effect.column}`.toLowerCase();
    return { ...scope, columns: new Set([...scope.columns, column]) };
  }
  return scope;
}

/** The objects `sql` names in a `CREATE`, less those `effects` drop or rename. */
function namedCreates(sql: string, effects: readonly Effect[]): readonly CreatedObject[] {
  const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
  return [...sql.matchAll(CREATE_NAMED)].flatMap((match): CreatedObject[] => {
    const type = (match[1] ?? '').toLowerCase() as CreatedObject['type'];
    const created: CreatedObject = { type, name: identifierValue(match[2] ?? '') };
    const dropped = effects.some((effect) => (
      effect.kind === 'drop' && effect.type === type && same(effect.name, created.name)
    ));
    if (dropped) return [];
    const renamed = effects.find((effect) => (
      effect.kind === 'rename-table' && type === 'table' && same(effect.from, created.name)
    ));
    return renamed?.kind === 'rename-table'
      ? [{ type, name: renamed.to }]
      : [created];
  });
}

/**
 * Reads `migration`'s SQL against the additive table, and reports each
 * way it disagrees with the entry's declared `breaks`. The module note
 * gives the rows, the shapes refused in an additive entry, and which
 * way a doubtful reading errs.
 */
export function classifyMigration(migration: Pick<SqliteMigration, 'sql' | 'breaks'>): MigrationClassification {
  const statements: ClassifiedStatement[] = [];
  const effects: Effect[] = [];
  let scope: Scope = { tables: new Set(), columns: new Set() };
  for (const tokens of splitStatements(tokenize(migration.sql))) {
    const { shape, effect } = readStatement(tokens, scope);
    statements.push({ text: tokens.map(({ source }) => source).join(' '), shape, breaks: SHAPE_BREAKS[shape] });
    if (effect !== undefined) effects.push(effect);
    scope = widen(scope, effect);
  }

  const computed = BOTH.filter((side) => statements.some(({ breaks }) => breaks.includes(side)));
  const missing = computed.filter((side) => !migration.breaks.includes(side));
  const refusals = migration.breaks.length > 0
    ? []
    : statements.flatMap(({ shape, text }): ShapeProblem[] => {
      const kind = ADDITIVE_REFUSALS[shape];
      return kind === undefined
        ? []
        : [{ kind, statement: text }];
    });
  const problems: ShapeProblem[] = [
    ...(missing.length > 0
      ? [{ kind: 'under-declared' as const, missing }]
      : []),
    ...refusals,
  ];
  return { statements, computed, creates: namedCreates(migration.sql, effects), problems };
}
