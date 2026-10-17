/**
 * The release ladder row of `rafa doctor`, printed right under the
 * `Release:` row (`./doctor-release.ts`): the level `release.settle`,
 * `release.tag` and `release.publish` put the project at, and every
 * precondition of that level the project's files show to be missing.
 *
 * ```text
 * Release ladder: level 0, Manual.
 * Release ladder: level 2, CI publishes; release.settle is pr where the level reads push. Publishing waits for the repository variable RAFA_RELEASE_PUBLISH set to ci, which doctor cannot read.
 * Release ladder: level 3, Release PR, 2 missing: .github/workflows/release-tag.yml is absent (run rafa release workflows --write); package.json is private (remove "private": true to publish it). Publishing waits for the repository variable RAFA_RELEASE_PUBLISH set to ci, which doctor cannot read.
 * ```
 *
 * ## What is read, and what decides
 *
 * {@link readLadderFiles} makes the readings `src/release/ladder.ts`
 * takes, under the project root: a stat of each of the four workflow
 * files of `LADDER_WORKFLOWS` (a directory or any other non-file is
 * `not-a-file`), the publish workflow's text, a stat of
 * `.github/dependabot.yml`, and the version file parsed as a JSON
 * manifest (null when it is absent or is not a JSON object). The level
 * is `ladderLevel`'s and the missing items are `ladderPreconditions`',
 * so every rule lives in the pure module and this one only reads and
 * words.
 *
 * ## When it warns
 *
 * Nothing missing is an `info` line; anything missing makes the row a
 * `warn` line naming each missing item with the file or command that
 * supplies it (`rafa release workflows --write` for a workflow file).
 * A key that does not fit the level's table row is named on the row in
 * both cases and does not by itself warn. From level 2 up the row ends
 * on {@link PUBLISH_SWITCH_REMINDER}, after the missing list when there
 * is one: the publish job waits for the repository variable
 * `PUBLISH_SWITCH_VARIABLE` names, which doctor cannot read from the
 * checkout, so the reminder is never a missing item, never turns the
 * row to `warn` and never changes the count. In json mode the row goes
 * out at the same level as a `log` event. Doctor never refuses for it:
 * the exit code is what the other rows give, and nothing is written.
 */
import type {
  LadderLevelReading,
  LadderManifestReading,
  LadderMissing,
  LadderReadings,
  LadderWorkflowReading,
} from '../release/ladder.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEPENDABOT_CONFIG,
  LADDER_WORKFLOWS,
  PUBLISH_SWITCH_VARIABLE,
  PUBLISH_WORKFLOW,
  ladderLevel,
  ladderPreconditions,
} from '../release/ladder.js';

/** The command that writes a missing ladder workflow. */
export const WORKFLOWS_COMMAND = 'rafa release workflows --write';

/** The lowest level that publishes from CI, from which the row carries the reminder. */
const FIRST_PUBLISHING_LEVEL = 2;

/**
 * The sentence ending the row from level 2 up: what publishing waits
 * for that doctor cannot read. It never holds the word "missing".
 */
export const PUBLISH_SWITCH_REMINDER: string = `Publishing waits for the repository variable ${PUBLISH_SWITCH_VARIABLE} set to ci, which doctor cannot read.`;

/** The settings the row reads, named as the resolved config names them. */
export type DoctorLadderConfig = Pick<
  RafaConfig,
  'releaseSettle' | 'releaseTag' | 'releasePublish' | 'releaseVersionFile'
>;

/** The row's reading: the level and what it lacks. */
export interface DoctorLadderReading {
  /** The level, its name and the key that does not fit, as `ladderLevel` answers. */
  readonly level: LadderLevelReading;
  /** The level's missing preconditions, in `ladderPreconditions`' order. */
  readonly missing: readonly LadderMissing[];
}

/** What a stat finds at `path`: a regular file, something else, or nothing. */
function kindAt(path: string): LadderWorkflowReading['kind'] {
  try {
    return statSync(path).isFile()
      ? 'file'
      : 'not-a-file';
  } catch {
    return 'absent';
  }
}

/** One workflow file, with its text when it is the publish workflow and a file. */
function readWorkflow(root: string, path: string): LadderWorkflowReading {
  const kind = kindAt(join(root, path));
  if (kind !== 'file' || path !== PUBLISH_WORKFLOW.path) return { kind };
  try {
    return { kind, text: readFileSync(join(root, path), 'utf8') };
  } catch {
    return { kind, text: '' };
  }
}

/** The version file as a manifest, or null when it is absent or not a JSON object. */
export function readLadderManifest(root: string, versionFile: string): LadderManifestReading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, versionFile), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const manifest = parsed as Record<string, unknown>;
  const name = manifest['name'];
  return {
    path: versionFile,
    private: manifest['private'] === true,
    name: typeof name === 'string'
      ? name
      : null,
  };
}

/**
 * The readings `ladderPreconditions` takes, read under `root`.
 *
 * @param root - The project root the workflow paths are relative to.
 * @param versionFile - `release.versionFile`, relative to `root`.
 * @returns The workflow files, the manifest and whether Dependabot is configured.
 */
export function readLadderFiles(root: string, versionFile: string): LadderReadings {
  const workflows = new Map(LADDER_WORKFLOWS.map((entry) => [entry.path, readWorkflow(root, entry.path)] as const));
  return {
    workflows,
    manifest: readLadderManifest(root, versionFile),
    dependabot: kindAt(join(root, DEPENDABOT_CONFIG)) === 'file',
  };
}

/** The row's reading for the project; see the module note. Never a throw for a failed read. */
export function readDoctorLadder(root: string, config: DoctorLadderConfig): DoctorLadderReading {
  const level = ladderLevel({
    releaseSettle: config.releaseSettle,
    releaseTag: config.releaseTag,
    releasePublish: config.releasePublish,
  });
  return { level, missing: ladderPreconditions(level.level, readLadderFiles(root, config.releaseVersionFile)) };
}

/** What a workflow path that is not a file reads as, and what supplies it. */
function workflowFound(path: string, found: 'absent' | 'not-a-file'): string {
  return found === 'absent'
    ? `${path} is absent (run ${WORKFLOWS_COMMAND})`
    : `${path} is not a file (move it aside, then run ${WORKFLOWS_COMMAND})`;
}

/**
 * One missing precondition as the row words it: what is missing and
 * the file or command that supplies it.
 */
export function missingPhrase(missing: LadderMissing): string {
  switch (missing.kind) {
    case 'workflow':
      return workflowFound(missing.workflow.path, missing.found);
    case 'bot-workflow':
      return `${workflowFound(missing.workflow.path, missing.found)}, needed while ${missing.dependabot} exists`;
    case 'id-token':
      return `${missing.workflow.path} grants no id-token: write (add it to the publish job's permissions)`;
    case 'manifest-private':
      return `${missing.path} is private (remove "private": true to publish it)`;
    case 'manifest-unnamed':
      return `${missing.path} has no name (add a "name" to publish it)`;
  }
}

/**
 * The row: the level, the key that does not fit, each missing item,
 * and from level 2 up the publish switch reminder last.
 */
export function ladderRow(reading: DoctorLadderReading): string {
  const { level, misfit } = reading.level;
  const head = `Release ladder: level ${String(level)}, ${reading.level.name}`;
  const fit = misfit === null
    ? ''
    : `; ${misfit.key} is ${misfit.value} where the level reads ${misfit.expected}`;
  const reminder = level >= FIRST_PUBLISHING_LEVEL
    ? ` ${PUBLISH_SWITCH_REMINDER}`
    : '';
  if (reading.missing.length === 0) return `${head}${fit}.${reminder}`;
  const items = reading.missing.map(missingPhrase).join('; ');
  return `${head}${fit}, ${String(reading.missing.length)} missing: ${items}.${reminder}`;
}

/**
 * Writes the row: `info` when nothing is missing, `warn` otherwise, in
 * both modes, so json mode carries it as a `log` event at that level.
 */
export function writeDoctorLadder(context: Pick<RafaContext, 'output'>, reading: DoctorLadderReading): void {
  const row = ladderRow(reading);
  if (reading.missing.length === 0) context.output.info(row);
  else context.output.warn(row);
}
