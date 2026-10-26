/**
 * The eighth reading of `rafa release status`: the workspace packages
 * that publish on their own, each with its version, its waiting
 * fragments and its newest tag.
 *
 * ```text
 *   packages      1 publishable
 *                 @scope/plugin  0.1.0  1 waiting  @scope/plugin@0.1.0
 * ```
 *
 * ## Where each column comes from
 *
 * The members are `readWorkspacePackages(root)`
 * (`src/release/workspace-packages.ts`), the checkout's own manifests,
 * filtered to the publishable ones by `publishableOf`; the root package
 * is never one of them. The version is the one the member's manifest
 * declares on disk. The waiting count is the fragments of the `waiting`
 * reading (`./status-fragments.ts`) whose `package` line names the
 * member, so it counts what is waiting on the base ref, not in the
 * checkout. The tag is `latestTagOf(tags, name)`
 * (`src/release/status-readings.ts`): the highest `<name>@<version>`
 * tag, or `untagged` when the repository holds none.
 *
 * ## Readings made once
 *
 * `rafa release status` has already read the tags and the waiting
 * fragments for rows of their own, so it hands both in as `made`, and
 * no git command is sent twice. A caller that hands neither in has
 * them read here, through `git` and `settings`, by the same readers.
 *
 * ## What is unreadable
 *
 * A root with no `package.json` is a project with no workspace, and
 * reads as no publishable member, not as a failure. A manifest that
 * cannot be read or parsed leaves the cell unreadable, with the
 * reader's sentence under the block. A tag list or a waiting tree that
 * could not be read leaves that column unreadable on every line; its
 * reason is already said under its own row, so it is not repeated here.
 */
import type { WaitingReading, WaitingSettings } from './status-fragments.js';
import type { TagReading } from '../../release/status-readings.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { latestTagOf, readTags } from '../../release/status-readings.js';
import { publishableOf, readWorkspacePackages } from '../../release/workspace-packages.js';

import { readWaiting } from './status-fragments.js';

/** What a package's tag column reads as when the repository holds no tag of it. */
export const UNTAGGED = 'untagged';

/** One publishable workspace package, as the block lists it. */
export interface PackageRow {
  /** The manifest's `name`. */
  readonly name: string;
  /** The member's directory relative to the root. */
  readonly dir: string;
  /** The version its manifest declares, or null when it declares none. */
  readonly version: string | null;
  /** How many fragments on the base name it, or null when the waiting tree could not be read. */
  readonly waiting: number | null;
  /** Its highest release tag, or null when it has none or the tags could not be read. */
  readonly tag: string | null;
}

/** The publishable workspace packages, or why they could not be read. */
export interface PackagesReading {
  /** False when the workspace could not be read; the cell is then unreadable. */
  readonly read: boolean;
  /** One row per publishable package, sorted by manifest path. */
  readonly packages: readonly PackageRow[];
  /** False when the tag list could not be read, so no row's tag is known. */
  readonly tagsRead: boolean;
  /** Why the workspace could not be read, or null when it was. */
  readonly problem: string | null;
}

/** The readings `rafa release status` has already made, handed in so none is made twice. */
export interface MadeReadings {
  /** The repository's release tags. */
  readonly tags?: TagReading;
  /** The fragments waiting on the base. */
  readonly waiting?: WaitingReading;
}

/** How many of `waiting`'s fragments name `name`, or null when the tree could not be read. */
function waitingFor(waiting: WaitingReading, name: string): number | null {
  if (!waiting.read) return null;
  return waiting.fragments.filter((each) => each.package === name).length;
}

/**
 * The publishable workspace packages of the checkout at `root`, each
 * with its version, its waiting fragments and its newest tag.
 *
 * @param root - The project root, holding the root `package.json`.
 * @param git - The runner the tags and the waiting tree are read through when `made` lacks them.
 * @param settings - Where the waiting fragments are read, when `made` lacks them.
 * @param made - The tag and waiting readings already made; see the module note.
 * @returns A new reading; never throws for a reading that failed.
 */
export function readPackages(
  root: string,
  git: GitRunner,
  settings: WaitingSettings,
  made: MadeReadings = {},
): PackagesReading {
  if (!existsSync(join(root, 'package.json'))) return { read: true, packages: [], tagsRead: true, problem: null };
  const workspace = readWorkspacePackages(root);
  if (!workspace.ok) {
    return { read: false, packages: [], tagsRead: true, problem: `the workspace packages could not be read: ${workspace.problem}` };
  }
  const publishable = publishableOf(workspace.packages);
  if (publishable.length === 0) return { read: true, packages: [], tagsRead: true, problem: null };

  const tags = made.tags ?? readTags(git);
  const waiting = made.waiting ?? readWaiting(git, settings);
  const tagsRead = tags.problem === null;
  const packages = publishable.map((member): PackageRow => ({
    name: member.name,
    dir: member.dir,
    version: member.version,
    waiting: waitingFor(waiting, member.name),
    tag: tagsRead
      ? latestTagOf(tags, member.name)?.tag ?? null
      : null,
  }));
  return { read: true, packages, tagsRead, problem: null };
}

/**
 * The `packages` cell: `nothing` for a workspace with no publishable
 * member, `<n> publishable` otherwise, or null when the workspace could
 * not be read and the caller renders its own unreadable mark.
 */
export function packagesCell(reading: PackagesReading, nothing: string): string | null {
  if (!reading.read) return null;
  return reading.packages.length === 0
    ? nothing
    : `${reading.packages.length} publishable`;
}

/** One row's columns, `unreadable` for each that could not be read. */
function columnsOf(row: PackageRow, tagsRead: boolean, unreadable: string): readonly string[] {
  const tag = tagsRead
    ? row.tag ?? UNTAGGED
    : unreadable;
  return [
    row.name,
    row.version ?? unreadable,
    `${row.waiting ?? unreadable} waiting`,
    tag,
  ];
}

/**
 * One line per publishable package, in manifest-path order: name,
 * version, waiting count and newest tag, in columns two spaces apart.
 * A column that could not be read is `unreadable`.
 */
export function packagesLines(reading: PackagesReading, unreadable: string): readonly string[] {
  const rows = reading.packages.map((row) => columnsOf(row, reading.tagsRead, unreadable));
  const widths = [0, 1, 2].map((column) => Math.max(0, ...rows.map((columns) => (columns[column] ?? '').length)));
  return rows.map((columns) => columns
    .map((column, index) => column.padEnd(widths[index] ?? 0))
    .join('  '));
}
