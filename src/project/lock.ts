/**
 * `rafa.lock`, the tracked record of which rafa a project was last
 * brought to (#714, under the update epic #713).
 *
 * It sits at the repository root, beside `package.json`, rather than under
 * `.rafa/`: many projects ignore `.rafa/` in git, and the lock is meant to
 * be tracked, so a pull request that moves a project's rafa shows it. It
 * is JSON because the YAML config is the person's file and is moving to a
 * fallback (#720 holds what the lock grows into: settings, modules).
 *
 * Today it holds two keys: `lockfileVersion`, the format this file is
 * written in, and `rafa`, the version. A lock in a format this rafa does
 * not read is refused rather than overwritten, since a newer rafa wrote
 * it. `rafa update current` is its only writer.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { parseSemanticVersion } from '../release/version.js';

/** The lock's file name, at the project root. */
export const LOCK_FILE = 'rafa.lock';

/** The format this rafa reads and writes. */
export const LOCKFILE_VERSION = 1;

/** What a lock records. */
export interface ProjectLock {
  /** The format the file is written in. */
  readonly lockfileVersion: number;
  /** The rafa version the project was last brought to. */
  readonly rafa: string;
}

/** A lock that is there and cannot be read as one. */
export class ProjectLockError extends Error {
  override readonly name = 'ProjectLockError';
}

/** The lock's path under `root`. */
export function lockPath(root: string): string {
  return join(root, LOCK_FILE);
}

/** The text a lock recording `version` is written as. */
export function projectLockText(version: string): string {
  const lock: ProjectLock = { lockfileVersion: LOCKFILE_VERSION, rafa: version };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** True when `path` is a link, whether or not it resolves. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function refuse(problem: string): never {
  throw new ProjectLockError(`${LOCK_FILE} ${problem}`);
}

/** `value` as a lock, or a refusal naming what is wrong with it. */
function lockOf(value: unknown): ProjectLock {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse('holds no JSON object');
  const record = value as Record<string, unknown>;
  const format = record['lockfileVersion'];
  if (format !== LOCKFILE_VERSION) {
    refuse(`is in lockfileVersion ${String(format)}, and this rafa reads ${String(LOCKFILE_VERSION)}: a newer rafa wrote it`);
  }
  const rafa = record['rafa'];
  if (typeof rafa !== 'string' || parseSemanticVersion(rafa) === null) {
    refuse(`names rafa ${JSON.stringify(rafa)}, which is no version`);
  }
  return { lockfileVersion: LOCKFILE_VERSION, rafa };
}

/**
 * The lock under `root`, or null when there is none.
 *
 * @throws ProjectLockError for a lock that cannot be read, is a link to
 * nothing, is not JSON, is in another format, or names no version.
 */
export function readProjectLock(root: string): ProjectLock | null {
  const path = lockPath(root);
  if (!existsSync(path)) {
    if (isLink(path)) refuse('is a link to nothing');
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    refuse(`could not be read: ${messageOf(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    refuse('is not JSON');
  }
  return lockOf(value);
}

/** Writes the lock recording `version` under `root`, replacing any there. */
export function writeProjectLock(root: string, version: string): void {
  writeFileSync(lockPath(root), projectLockText(version), 'utf8');
}
