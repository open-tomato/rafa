/**
 * `rafa release list`: one row per unit that releases on its own, the
 * root first, then each publishable workspace package, with its version,
 * the fragments waiting for it on the base and its newest tag.
 *
 * ```text
 * @open-tomato/rafa  0.45.0  2 waiting  v0.45.0
 * @scope/plugin      0.1.0   1 waiting  @scope/plugin@0.1.0
 * ```
 *
 * ## Where each row comes from
 *
 * The root is read as `rafa release status` reads it: its version from
 * `release.versionFile` (`readVersionFile`, `./status.ts`), its waiting
 * count from the fragments with no `package` line on the base ref
 * (`readWaiting`, `./status-fragments.ts`), its tag the highest root
 * tag (`readTags`'s `latest`). Its name is the version file's manifest
 * `name`, for display only, and the version file's path when that file
 * names none. The packages are `readPackages` (`./status-packages.ts`),
 * handed the same tag and waiting readings so no git command is sent
 * twice, and the columns are laid out by its `packagesLines`, so the
 * two commands print a package the same way.
 *
 * ## It writes nothing and refuses only its line
 *
 * Every git command sent is a read and the base is read AS LAST
 * FETCHED, as `status` reads it. A reading that failed leaves its
 * column {@link UNREADABLE} and says why on a line under the rows, and
 * the command still exits 0. The refusals left are the line's own: a
 * stray word, and a config `loadConfig` refuses, both exit 1.
 */
import type { WaitingReading, WaitingSettings } from './status-fragments.js';
import type { PackageRow, PackagesReading } from './status-packages.js';
import type { ReleaseSeams, VersionFileReading } from './status.js';
import type { TagReading } from '../../release/status-readings.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectNoArgument, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { createGitRunner } from '@open-tomato/rafa/core/git';

import { readTags } from '../../release/status-readings.js';
import { readManifestName } from '../../release/version.js';

import { RELEASE_LIST_DECLARATION } from './declarations.js';
import { readWaiting, waitingSettingsOf } from './status-fragments.js';
import { packagesLines, readPackages } from './status-packages.js';
import { DEFAULT_RELEASE_SEAMS, readVersionFile, UNREADABLE } from './status.js';

/** The command's name, as its refusals spell it. */
const COMMAND_NAME = 'rafa release list';

/** The usage line this action's refusals name. */
export const RELEASE_LIST_USAGE = 'rafa release list';

/** One unit's row: the root's with `package: null`, a workspace package's with its name. */
export interface ReleaseListRow extends PackageRow {
  /** The workspace package the row is, or null for the root. */
  readonly package: string | null;
}

/** Every row of one run, and why any column could not be read. */
export interface ReleaseListReading {
  /** The root first, then each publishable package in manifest-path order. */
  readonly rows: readonly ReleaseListRow[];
  /** False when the tag list could not be read, so no row's tag is known. */
  readonly tagsRead: boolean;
  /** One sentence per reading that failed, in row order. */
  readonly problems: readonly string[];
}

/** What json mode gives as the terminal result's `data`. */
export interface ReleaseListResult {
  /** The rows and the problems. */
  readonly reading: ReleaseListReading;
  /** The lines text mode writes. */
  readonly text: string;
}

/** The settings one run reads out of the config. */
export interface ReleaseListSettings {
  /** `release.versionFile`, relative to the repository root. */
  readonly versionFile: string;
  /** Where the waiting fragments are read. */
  readonly waiting: WaitingSettings;
}

/** The root's display name: the version file's manifest `name`, else the version file's path. */
function rootNameOf(root: string, versionFile: string): string {
  try {
    return readManifestName(readFileSync(join(root, versionFile), 'utf8')) ?? versionFile;
  } catch {
    return versionFile;
  }
}

/** How many of `waiting`'s fragments name no package, or null when the tree could not be read. */
function rootWaiting(waiting: WaitingReading): number | null {
  if (!waiting.read) return null;
  return waiting.fragments.filter((each) => each.package === null).length;
}

/** The root's row, from the readings made for the whole run. */
function rootRow(root: string, version: VersionFileReading, tags: TagReading, waiting: WaitingReading): ReleaseListRow {
  return {
    package: null,
    name: rootNameOf(root, version.path),
    dir: '.',
    version: version.version,
    waiting: rootWaiting(waiting),
    tag: tags.latest?.tag ?? null,
  };
}

/** Every sentence under the rows, in row order: the root's readings, then the workspace's. */
function problemsOf(
  version: VersionFileReading,
  tags: TagReading,
  waiting: WaitingReading,
  packages: PackagesReading,
): readonly string[] {
  return [
    version.problem,
    tags.problem,
    ...(waiting.read
      ? []
      : waiting.problems),
    packages.problem,
  ].filter((problem): problem is string => problem !== null);
}

/**
 * The rows of the project at `root`: the root's, then each publishable
 * package's. Reads only; never throws for a reading that failed.
 */
export function readList(root: string, git: GitRunner, settings: ReleaseListSettings): ReleaseListReading {
  const version = readVersionFile(root, settings.versionFile);
  const tags = readTags(git);
  const waiting = readWaiting(git, settings.waiting);
  const packages = readPackages(root, git, settings.waiting, { tags, waiting });
  const rows = [
    rootRow(root, version, tags, waiting),
    ...packages.packages.map((row): ReleaseListRow => ({ package: row.name, ...row })),
  ];
  return { rows, tagsRead: tags.problem === null, problems: problemsOf(version, tags, waiting, packages) };
}

/**
 * The lines one reading renders to: a row per unit in columns, then,
 * after a blank line, a line per reading that failed. Pure and total.
 */
export function renderList(reading: ReleaseListReading): string {
  const rows = packagesLines({ read: true, packages: reading.rows, tagsRead: reading.tagsRead, problem: null }, UNREADABLE);
  return reading.problems.length === 0
    ? rows.join('\n')
    : [rows.join('\n'), reading.problems.join('\n')].join('\n\n');
}

/** The rows for one invocation, and the text they render to. */
export async function runList(
  context: RafaContext,
  seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS,
): Promise<ReleaseListResult> {
  expectNoArgument(context.args, RELEASE_LIST_USAGE);
  const project = requireProject(context, COMMAND_NAME);
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const git = (seams.git ?? createGitRunner)(project.root);
  const reading = readList(project.root, git, {
    versionFile: config.releaseVersionFile,
    waiting: waitingSettingsOf(config),
  });
  return { reading, text: renderList(reading) };
}

/** The command, reaching git through `seams`; see the module note. */
export function createReleaseListCommand(seams: ReleaseSeams = DEFAULT_RELEASE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...RELEASE_LIST_DECLARATION,
    run: async (context) => {
      const list = await runList(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(list);
        return;
      }
      context.output.info(list.text);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createReleaseListCommand();
export default command;
