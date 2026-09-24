/**
 * The skill tier rows of `rafa doctor`: what the doctor reports about
 * the three tiers a loop session is served from, project, rafa and user.
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` asks the doctor for five
 * readings. Each one comes from a module that already decides it, so
 * nothing is decided twice. The inventory (`inventory/index.ts`) and
 * its `resolveTiers` outcome (`tiers/resolve.ts`) give the collisions
 * and the byte-identical copies, `provenanceBlock` (`tiers/serve.ts`)
 * gives the unreviewed items, and `SERVE_CLI_VERSION`
 * (`tiers/delivery.ts`) gives the pin. The module lives beside
 * `./doctor.ts`, not inside it, because that file is near the 800-line
 * cap (`context/source.md`). `rafa doctor` calls {@link checkDoctorTiers}
 * on every run, `--deep` or not, after the references row and before the
 * deep sections; json mode gives the reading as the data's `tiers`.
 *
 * ## What one doctor run reads under
 *
 * {@link checkDoctorTiers} builds the inventory over the seams `--deep`
 * builds its own over (`inventorySeams`, `./doctor-deep.ts`): the
 * project, the home, the resolved config's tier keys and modules, and
 * the session's `PATH`. `claude --version` runs under the environment
 * `readSessionEnv` gives a session (`./doctor-deep-env.ts`), in the
 * project root, so the version read is the one a session would spawn.
 *
 * ## The rows
 *
 * | Row | Status | One per |
 * | --- | --- | --- |
 * | `collision` | `warn` | collision in `Resolution.collisions`: every holder's path, and the pin line as the fix |
 * | `unreviewed` | `warn` | rafa-tier or add-on row whose `provenance` `provenanceBlock` refuses |
 * | `cli-version` | `warn` | reading, when the installed Claude Code is not `SERVE_CLI_VERSION` |
 * | `cli-version` | `note` | reading, when no installed version could be read |
 * | `copy` | `note` | byte-identical copy a person can delete, with the deletion as the fix |
 * | `no-provenance` | `note` | user-tier row with no `provenance`, when the user tier is loaded |
 *
 * Rows come in that order, so the warnings are first. Every collision is
 * listed in the same reading, so one config edit can settle all of
 * them. No row is a preflight item, and no row changes the doctor's exit
 * code. The refusal belongs to `loop start` and `plan validate`.
 *
 * ## Unreviewed: the rule serving uses
 *
 * An item in the rafa tier or in an add-on is read with
 * `provenanceBlock`. That is the same function `serveResolution` uses
 * before it copies a winner, so the doctor and serving cannot disagree.
 * The function refuses two things: a third-party `provenance` with no
 * `reviewed`, and a `provenance` the checker refuses. A misspelt
 * `review:` is the second case, and serving leaves that item out just
 * as it leaves out the first, so both get a row, each with its own
 * reason. Every such row is listed whatever its state, because a
 * shadowed item would still not be served once its shadow went away.
 * A file that cannot be read, or has no frontmatter, has no provenance
 * to judge and gets no row here.
 *
 * ## Copies: which holder to delete
 *
 * A served name's `copies` are the loaded holders that are
 * byte-identical to its winner. The holder to keep is the one in the
 * rafa tier when the group has one. That copy ships with rafa and
 * cannot usefully be deleted, and #127's workaround is exactly a
 * project copy of it. With no rafa holder, the winner is kept, since it
 * already serves the name. Every other holder is a row, unless its path
 * resolves to the same file as the one kept: a link is not a copy. This
 * repository's own `.claude/` links into `src/bundled/` are therefore
 * not rows. For a skill held as `<name>/SKILL.md`, the fix names the
 * directory and says that only `SKILL.md` was compared, because
 * `resolveTiers` does not read supporting files.
 *
 * ## Provenance on user items: loaded tier only
 *
 * A missing `provenance` on a user-tier item is a note and never a
 * refusal, as the spec says. The note is given only when
 * `loop.settingSources` loads the user tier. Otherwise no loop session
 * sees those items, and a home with dozens of skills would fill the
 * report with rows about items rafa never serves. A file with no
 * frontmatter carries no `provenance` either, so it gets the note. A
 * `provenance` the checker refuses is a value, not an absent one, so it
 * gets no note here; the checker names it.
 *
 * ## The pin
 *
 * The installed Claude Code is read as the leading `X.Y.Z` of
 * `claude --version`. The command is looked up on the `PATH` of the
 * environment it is handed, so the version is the one a session would
 * run. That output reads `2.1.280 (Claude Code)`, measured on 2026-09-24.
 * A version equal to the pin gets no row. A version that differs gets
 * one warning, as `PLUGINS_CLI_VERSION` does for the plugins record. A
 * version that cannot be read gets a note, so a missing reading is never
 * mistaken for a match.
 *
 * Nothing here writes. The files are read through
 * {@link TierFileReaders}, and Claude Code through
 * {@link DoctorTiersSeams.readClaudeVersion}, so each case drives a
 * planted world and a stand-in version.
 */
import type { DeepRow, DeepRowStatus } from './doctor-deep-row.js';
import type { DeepDoctorSeams, DeepInput } from './doctor-deep.js';
import type { Inventory, InventorySeams } from '../inventory/index.js';
import type { InventoryRecord } from '../inventory/record.js';
import type { ServedItem, TierCollision, TierRow } from '../tiers/resolve.js';

import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { createGhRunner } from '../adapters/tracker/github.js';
import { buildInventory } from '../inventory/index.js';
import { readFrontmatter } from '../schema/frontmatter.js';
import { PROVENANCE_FIELD } from '../schema/provenance.js';
import { SERVE_CLI_VERSION } from '../tiers/delivery.js';
import { provenanceBlock, SKILL_FILE } from '../tiers/serve.js';
import { CLAUDE_BIN } from '../utils/claude.js';

import { PATH_KEY, readSessionEnv } from './doctor-deep-env.js';
import { renderDeepSection } from './doctor-deep-row.js';
import { inventorySeams } from './doctor-deep.js';

/** The title the rows are printed under. */
export const TIERS_SECTION_TITLE = 'Skill tiers';

/** How long `claude --version` may run before it is killed and read as no version. */
export const CLAUDE_VERSION_TIMEOUT_MS = 10_000;

/** Which reading a row reports; see the module note's table. */
export type TierDoctorRowKind = 'collision' | 'unreviewed' | 'cli-version' | 'copy' | 'no-provenance';

/** One tier row: a deep row, with the reading it reports. */
export interface TierDoctorRow extends DeepRow {
  readonly kind: TierDoctorRowKind;
}

/** What the tier rows were read from, and the rows. */
export interface DoctorTiersReading {
  /** The installed Claude Code's `X.Y.Z`, or null when it could not be read. */
  readonly cliVersion: string | null;
  /** The version skill delivery was probed against: {@link SERVE_CLI_VERSION}. */
  readonly pinnedVersion: string;
  /** Every row, in the module note's order. */
  readonly rows: readonly TierDoctorRow[];
}

/** How a definition file is read and resolved; each left out reads the disk. */
export interface TierFileReaders {
  /** A file's text, or null when it cannot be read. */
  readonly readText?: (path: string) => string | null;
  /** The file a path resolves to once links are followed; the path itself when it cannot be. */
  readonly realPath?: (path: string) => string;
}

/** What {@link readDoctorTiers} reads through. */
export interface DoctorTiersSeams extends TierFileReaders {
  /** The seams the inventory is built over, the loaded settings among them. */
  readonly inventory: InventorySeams;
  /** The directory `claude --version` runs in. */
  readonly cwd: string;
  /** The environment a session is spawned with, whose `PATH` `claude` is looked up on. */
  readonly env: Record<string, string>;
  /** The installed version under `env`; {@link readClaudeVersion} when left out. */
  readonly readClaudeVersion?: (env: Record<string, string>, cwd: string) => Promise<string | null>;
}

/** A version's leading `X.Y.Z`. */
const VERSION_PATTERN = /^\s*(\d+\.\d+\.\d+)/;

/** A file's text, or null when it cannot be read. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The path with links followed, or the path itself when it cannot be resolved. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** One row, spelled once. */
function row(kind: TierDoctorRowKind, status: DeepRowStatus, name: string, detail: string, fix?: string): TierDoctorRow {
  return fix === undefined
    ? { kind, status, name, detail }
    : { kind, status, name, detail, fix };
}

/** A holder as a row names it: its tier, then its path. */
function place(holder: Pick<TierRow, 'source' | 'path'>): string {
  return `${holder.source} ${holder.path}`;
}

/** The `X.Y.Z` that `claude --version` wrote, or null when it wrote none. */
export function parseClaudeVersion(output: string): string | null {
  return VERSION_PATTERN.exec(output)?.[1] ?? null;
}

/**
 * The installed Claude Code's `X.Y.Z` under `env`, or null when
 * `claude` is not on `env.PATH`, fails, times out or writes no version.
 */
export async function readClaudeVersion(env: Record<string, string>, cwd: string): Promise<string | null> {
  const claude = createGhRunner({ cwd, command: CLAUDE_BIN, env, timeoutMs: CLAUDE_VERSION_TIMEOUT_MS });
  const result = await claude(['--version']);
  return result.ok
    ? parseClaudeVersion(result.stdout)
    : null;
}

/** One row per collision, every holder named and the pin line as the fix. */
export function collisionRows(collisions: readonly TierCollision[]): readonly TierDoctorRow[] {
  return collisions.map((collision) => row(
    'collision',
    'warn',
    `${collision.kind} ${collision.name}`,
    `held by ${String(collision.holders.length)} loaded tiers with different contents: `
      + `${collision.holders.map(place).join(' and ')}; nothing serves it`,
    `pin the tier that serves it: ${collision.pinLine}`,
  ));
}

/** A row's frontmatter mapping; null when its file cannot be read, and empty when it has none. */
function frontmatterOf(path: string, readText: (path: string) => string | null): Readonly<Record<string, unknown>> | null {
  const text = readText(path);
  if (text === null) return null;
  return readFrontmatter(text) ?? {};
}

/** Whether `source` is one whose unreviewed items are not served: the rafa tier or an add-on. */
function isServedSource(source: InventoryRecord['source']): boolean {
  return source === 'rafa' || source.startsWith('addon:');
}

/** One row per rafa-tier or add-on item `provenanceBlock` refuses. See "Unreviewed". */
export function unreviewedRows(
  records: readonly InventoryRecord[],
  readText: (path: string) => string | null = readTextFile,
): readonly TierDoctorRow[] {
  return records.flatMap((record) => {
    if (!isServedSource(record.source)) return [];
    const data = frontmatterOf(record.path, readText);
    if (data === null) return [];
    const verdict = provenanceBlock(data);
    if (verdict.ok) return [];
    return [row(
      'unreviewed',
      'warn',
      `${record.kind} ${record.name}`,
      `${place(record)} is not served: ${verdict.why}`,
      verdict.reason === 'unreviewed'
        ? `review it and add reviewed: <who> <YYYY-MM-DD> to its ${PROVENANCE_FIELD}`
        : `correct its ${PROVENANCE_FIELD}; rafa skill check names what is wrong`,
    )];
  });
}

/** The holder of a byte-identical group that is kept: the rafa one, else the winner. */
function keptHolder(item: ServedItem): TierRow {
  return [item.winner, ...item.copies].find((holder) => holder.source === 'rafa') ?? item.winner;
}

/** What deleting `holder` means: its directory for a `SKILL.md` skill, else its file. */
function deletion(holder: TierRow): string {
  return holder.kind === 'skill' && basename(holder.path) === SKILL_FILE
    ? `delete ${dirname(holder.path)} (only its ${SKILL_FILE} was compared)`
    : `delete ${holder.path}`;
}

/** One row per byte-identical copy a person can delete. See "Copies". */
export function copyRows(
  items: Inventory['resolution']['items'],
  realPath: (path: string) => string = realPathOf,
): readonly TierDoctorRow[] {
  return items.flatMap((item) => {
    if (item.state !== 'served' || item.copies.length === 0) return [];
    const kept = keptHolder(item);
    const keptFile = realPath(kept.path);
    return [item.winner, ...item.copies]
      .filter((holder) => holder !== kept && realPath(holder.path) !== keptFile)
      .map((holder) => row(
        'copy',
        'note',
        `${item.kind} ${item.name}`,
        `${place(holder)} is byte-identical to ${place(kept)}, vendoring header aside`,
        deletion(holder),
      ));
  });
}

/** One note per user-tier row with no `provenance`, when the user tier is loaded. See "Provenance on user items". */
export function noProvenanceRows(
  inventory: Pick<Inventory, 'records' | 'resolution'>,
  readText: (path: string) => string | null = readTextFile,
): readonly TierDoctorRow[] {
  if (!inventory.resolution.loadedTiers.includes('user')) return [];
  return inventory.records.flatMap((record) => {
    if (record.source !== 'user') return [];
    const data = frontmatterOf(record.path, readText);
    if (data === null || Object.hasOwn(data, PROVENANCE_FIELD)) return [];
    return [row(
      'no-provenance',
      'note',
      `${record.kind} ${record.name}`,
      `${place(record)} carries no ${PROVENANCE_FIELD}, so where it came from is not recorded`,
    )];
  });
}

/** The pin's row: none on a match, a warning on a difference, a note when unread. See "The pin". */
export function cliVersionRows(installed: string | null, pinned = SERVE_CLI_VERSION): readonly TierDoctorRow[] {
  if (installed === pinned) return [];
  const name = 'Claude Code';
  if (installed === null) {
    return [row(
      'cli-version',
      'note',
      name,
      `its version could not be read from ${CLAUDE_BIN} --version; skill delivery was probed against ${pinned}`,
    )];
  }
  return [row(
    'cli-version',
    'warn',
    name,
    `${installed} is installed, and skill delivery was probed against ${pinned}`,
    'run the delivery probe again (context/inventory.md, "Serving") before trusting SERVE_CLI_VERSION',
  )];
}

/**
 * Every tier row of `inventory`, with `installed` read against the pin,
 * in the module note's order. Reads definition files through `readers`
 * and writes nothing.
 */
export function doctorTierRows(
  inventory: Pick<Inventory, 'records' | 'resolution'>,
  installed: string | null,
  readers: TierFileReaders = {},
): readonly TierDoctorRow[] {
  const readText = readers.readText ?? readTextFile;
  return [
    ...collisionRows(inventory.resolution.collisions),
    ...unreviewedRows(inventory.records, readText),
    ...cliVersionRows(installed),
    ...copyRows(inventory.resolution.items, readers.realPath ?? realPathOf),
    ...noProvenanceRows(inventory, readText),
  ];
}

/**
 * The tier reading: the inventory built over `seams.inventory`, the
 * installed Claude Code read under `seams.env`, and the rows. Never
 * throws for a missing `claude`; see "The pin".
 */
export async function readDoctorTiers(seams: DoctorTiersSeams): Promise<DoctorTiersReading> {
  const inventory = buildInventory(seams.inventory);
  const read = seams.readClaudeVersion ?? readClaudeVersion;
  const cliVersion = await read(seams.env, seams.cwd);
  return {
    cliVersion,
    pinnedVersion: SERVE_CLI_VERSION,
    rows: doctorTierRows(inventory, cliVersion, seams),
  };
}

/** What `rafa doctor` adds for the tier rows: the inventory `--deep` builds, and the version reading. */
export interface DoctorTiersRunSeams extends Pick<DeepDoctorSeams, 'sessionCwd' | 'inventory'> {
  /** The installed version under the session's environment; {@link readClaudeVersion} when left out. */
  readonly readClaudeVersion?: DoctorTiersSeams['readClaudeVersion'];
}

/**
 * The tier reading of one `rafa doctor` run, read under what a session
 * would run with; see "What one doctor run reads under".
 */
export async function checkDoctorTiers(input: DeepInput, seams: DoctorTiersRunSeams = {}): Promise<DoctorTiersReading> {
  const { project, resolved } = input;
  const cwd = (seams.sessionCwd ?? ((): string => process.cwd()))();
  const session = readSessionEnv({
    env: input.env,
    settingSources: resolved.config.settingSources,
    home: project.home,
    projectRoot: project.root,
    cwd,
  });
  const inventory = await inventorySeams(input, session.env[PATH_KEY], seams.inventory ?? {});
  const env = Object.fromEntries(Object.entries(session.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return readDoctorTiers({ inventory, cwd: project.root, env, readClaudeVersion: seams.readClaudeVersion });
}

/** The lines text mode writes: the titled rows, or nothing when there is no row. */
export function renderDoctorTiers(reading: DoctorTiersReading | null): readonly string[] {
  if (reading === null || reading.rows.length === 0) return [];
  return renderDeepSection({ title: TIERS_SECTION_TITLE, rows: reading.rows });
}
