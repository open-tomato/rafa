/**
 * The host's facts a set records: its platform, arch and an OS label.
 * The label is weaker than a container digest (the font set is not in
 * it), so a mismatch only warns.
 */
import type { ProcessRunner } from './process.js';

import { readFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';

/** What the host is. */
export interface HostFacts {
  /** Node's platform: `darwin`, `linux`. */
  readonly platform: string;
  /** Node's arch: `arm64`, `x64`. */
  readonly arch: string;
  /** `macOS 26.6.2` or the os-release pretty name; null when nothing says. */
  readonly os: string | null;
}

/** Where the facts are read from; the running host when absent. */
export interface HostSeams {
  readonly platform: string;
  readonly arch: string;
  /** The text of `/etc/os-release`, or null. */
  readonly osRelease: () => Promise<string | null>;
}

/** The running host. */
export const RUNNING_HOST: HostSeams = Object.freeze({
  platform: platform(),
  arch: arch(),
  osRelease: async () => readFile('/etc/os-release', 'utf8').catch(() => null),
});

/** The `PRETTY_NAME` of an os-release text, unquoted. */
function prettyName(text: string): string | null {
  const line = text.split('\n').find((entry) => entry.startsWith('PRETTY_NAME='));
  if (line === undefined) return null;
  const value = line.slice('PRETTY_NAME='.length).trim()
    .replace(/^"(.*)"$/, '$1');
  return value === ''
    ? null
    : value;
}

/** Reads the host's facts. */
export async function readHostFacts(run: ProcessRunner, seams: HostSeams = RUNNING_HOST): Promise<HostFacts> {
  const facts = { platform: seams.platform, arch: seams.arch };
  if (seams.platform === 'darwin') {
    const result = await run(['sw_vers', '-productVersion'], { cwd: '/' });
    const version = result.stdout.trim();
    return { ...facts, os: result.exitCode === 0 && version !== ''
      ? `macOS ${version}`
      : null };
  }
  if (seams.platform === 'linux') {
    const text = await seams.osRelease();
    return { ...facts, os: text === null
      ? null
      : prettyName(text) };
  }
  return { ...facts, os: null };
}
