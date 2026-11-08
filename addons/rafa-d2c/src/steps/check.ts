/**
 * `check`: readiness, in the first seconds, with every gap named beside
 * its fix in one pass, and one line naming the run ahead.
 *
 * A gap stops a run (config the store cannot serve, a store folder that
 * is missing, no git or git-lfs for a git store, an unreachable remote,
 * no playwright-core). A warning does not (no origin remote, PNGs not
 * tracked by lfs, an OS that differs from the set's, a tracked config).
 * A missing set is neither: the run seeds, and the line says so.
 */
import type { LoadedConfig } from '../config/load.js';
import type { HostFacts } from '../host.js';
import type { ProcessRunner } from '../process.js';
import type { SetRecord } from '../store/set-record.js';

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { hashFolder } from '../store/hash.js';
import { existingKeys, hostRunnerKey, readPlaywrightVersion, setPaths } from '../store/key.js';
import { readSetRecord } from '../store/set-record.js';

/** What `check` may run. */
export interface CheckSeams {
  readonly run: ProcessRunner;
  readonly host: HostFacts;
}

/** What `check` found. */
export interface CheckReport {
  readonly gaps: readonly string[];
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
  /** True when no set exists at this run's key. */
  readonly willSeed: boolean;
  readonly runLine: string;
  /** The runner key, or null when the runner has none in this version. */
  readonly runnerKey: string | null;
  readonly playwrightVersion: string | null;
  /** The set's record at this run's key, when it has one. */
  readonly set: SetRecord | null;
  /** How many PNGs the set holds at this run's key. */
  readonly setFiles: number;
}

/** How long `git ls-remote` may take before the remote counts as unreachable. */
export const REMOTE_TIMEOUT_MS = 10_000;

/** The first line of a process's error output, or a fallback. */
function firstLine(text: string, fallback: string): string {
  return text.split('\n').find((line) => line.trim() !== '')
    ?.trim() ?? fallback;
}

/** True when `dir` is a folder. */
async function isFolder(dir: string): Promise<boolean> {
  return stat(dir).then((entry) => entry.isDirectory(), () => false);
}

/** What one check pass gathers. */
interface Findings {
  readonly gaps: string[];
  readonly warnings: string[];
  readonly notes: string[];
}

/** The runner's key, noting a runner this version does not run. */
function runnerKeyOf(loaded: LoadedConfig, host: HostFacts, found: Findings): string | null {
  const { runner } = loaded.config.visual;
  if (runner.kind === 'container') {
    found.gaps.push('visual.runner.kind is container, which arrives in cut 2; set it to host for now');
    return null;
  }
  if (runner.kind === 'remote') {
    found.notes.push(`remote runner: host, workdir and command are set; runs on ${runner.host} are your own setup (see the README), and this version starts none`);
    return null;
  }
  try {
    return hostRunnerKey(host.platform, host.arch);
  } catch (error) {
    found.gaps.push(error instanceof Error
      ? error.message
      : String(error));
    return null;
  }
}

/** The git and git-lfs checks of a side-repo store. */
async function checkGitStore(dir: string, run: ProcessRunner, found: Findings): Promise<void> {
  const repo = await run(['git', '-C', dir, 'rev-parse', '--is-inside-work-tree'], { cwd: dir });
  if (repo.exitCode !== 0) {
    found.gaps.push(`the store folder ${dir} is not a git repository; run git init there, then git lfs install --local and git lfs track "*.png"`);
    return;
  }
  const lfs = await run(['git', 'lfs', 'version'], { cwd: dir });
  if (lfs.exitCode !== 0) found.gaps.push('git-lfs is not installed; install it (https://git-lfs.com), then run git lfs install');
  const attributes = Bun.file(join(dir, '.gitattributes'));
  const tracked = (await attributes.exists()) && /\*\.png\b[^\n]*filter=lfs/.test(await attributes.text());
  if (!tracked) found.warnings.push('the store does not track *.png with git-lfs; run git lfs track "*.png" in it');
  const origin = await run(['git', '-C', dir, 'remote', 'get-url', 'origin'], { cwd: dir });
  if (origin.exitCode !== 0) {
    found.warnings.push('the store has no origin remote; promoted sets stay local commits');
    return;
  }
  const remote = await run(['git', '-C', dir, 'ls-remote', '--heads', 'origin'], { cwd: dir, timeoutMs: REMOTE_TIMEOUT_MS });
  if (remote.exitCode !== 0) found.gaps.push(`the store's origin remote does not answer: ${firstLine(remote.stderr, `exit code ${remote.exitCode}`)}`);
}

/** The installed playwright-core version, noting a gap when none resolves. */
function playwrightOf(loaded: LoadedConfig, found: Findings): string | null {
  try {
    return readPlaywrightVersion(join(loaded.root, loaded.config.visual.suite.package));
  } catch (error) {
    found.gaps.push(error instanceof Error
      ? error.message
      : String(error));
    return null;
  }
}

/** The line naming the nearest key that exists, or an empty string. */
async function nearestOf(dir: string, set: string, playwrightVersion: string, runnerKey: string): Promise<string> {
  const others = (await existingKeys(dir, set)).filter((key) => key.playwrightVersion !== playwrightVersion || key.runnerKey !== runnerKey);
  const nearest = others.find((key) => key.runnerKey === runnerKey) ?? others[0];
  return nearest === undefined
    ? ''
    : ` (nearest: ${nearest.playwrightVersion}/${nearest.runnerKey})`;
}

/** Checks readiness and names the run ahead. */
export async function checkVisual(loaded: LoadedConfig, seams: CheckSeams): Promise<CheckReport> {
  const found: Findings = { gaps: [], warnings: [...loaded.warnings], notes: [] };
  const { store } = loaded.config.visual;
  const runnerKey = runnerKeyOf(loaded, seams.host, found);
  const playwrightVersion = playwrightOf(loaded, found);
  const base = { ...found, willSeed: false, runnerKey, playwrightVersion, set: null, setFiles: 0 };
  if (store.kind === 'same-repo') {
    found.gaps.push('visual.store.kind is same-repo, which arrives in a later cut; use side-repo or local-dir');
    return { ...base, runLine: 'no run: the store is not served yet' };
  }
  if (!(await isFolder(store.dir))) {
    found.gaps.push(`the store folder ${store.dir} does not exist; create it or fix visual.store.dir`);
    return { ...base, runLine: 'no run: the store folder is missing' };
  }
  if (store.kind === 'side-repo') await checkGitStore(store.dir, seams.run, found);
  if (runnerKey === null || playwrightVersion === null) return { ...base, runLine: 'no run: the runner or playwright-core is not ready' };

  const paths = setPaths(store.dir, store.set, playwrightVersion, runnerKey);
  let set: SetRecord | null = null;
  try {
    set = await readSetRecord(paths.recordFile);
  } catch (error) {
    found.gaps.push(error instanceof Error
      ? error.message
      : String(error));
  }
  const setFiles = (await hashFolder(paths.snapshotsDir)).size;
  if (set?.runner.os != null && seams.host.os !== null && set.runner.os !== seams.host.os) {
    found.warnings.push(`the set was drawn on ${set.runner.os} and this host is ${seams.host.os}; pixels may differ`);
  }
  const willSeed = setFiles === 0;
  const runLine = willSeed
    ? `no set for ${runnerKey}; this run will seed${await nearestOf(store.dir, store.set, playwrightVersion, runnerKey)}`
    : `assert against ${store.set} @ ${runnerKey} (${setFiles} files, from ${set?.projectCommit ?? 'an unrecorded commit'})`;
  return { ...found, willSeed, runLine, runnerKey, playwrightVersion, set, setFiles };
}
