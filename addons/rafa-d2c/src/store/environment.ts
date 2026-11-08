/**
 * The old `ENVIRONMENT` file a flat baseline set carried before the key
 * layout: `key: value` lines. Only the facts the key and the record need
 * are read; the rest stay in the store's history.
 */

/** What the old file says. */
export interface EnvironmentFacts {
  readonly playwrightVersion: string;
  /** `darwin-arm64`, `linux-amd64`. */
  readonly platform: string;
  /** The OS label without its arch: `macOS 26.6.2`. */
  readonly os: string;
  /** The first word of `source_commit`, or null. */
  readonly sourceCommit: string | null;
  /** The `state` line verbatim, or null. */
  readonly state: string | null;
}

/** The arch words an OS line ends with, to the key's arch. */
const ARCHES = new Map([['arm64', 'arm64'], ['aarch64', 'arm64'], ['x86_64', 'amd64'], ['amd64', 'amd64'], ['x64', 'amd64']]);

/** The `key: value` pairs of the file, first one of each key kept. */
function pairsOf(text: string): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!pairs.has(key)) pairs.set(key, line.slice(at + 1).trim());
  }
  return pairs;
}

/** Reads an old `ENVIRONMENT` file. Throws naming the file and the key it lacks or cannot read. */
export async function readEnvironment(file: string): Promise<EnvironmentFacts> {
  const pairs = pairsOf(await Bun.file(file).text());
  const playwrightVersion = pairs.get('playwright-core');
  if (playwrightVersion === undefined || playwrightVersion === '') throw new Error(`${file} has no playwright-core line`);
  const osLine = pairs.get('os') ?? '';
  const words = osLine.split(/\s+/).filter((word) => word !== '');
  const arch = ARCHES.get(words.at(-1) ?? '');
  if (arch === undefined) throw new Error(`${file}: the os line ${JSON.stringify(osLine)} does not end with an arch (arm64, x86_64)`);
  const platform = `${words[0] === 'macOS'
    ? 'darwin'
    : 'linux'}-${arch}`;
  const commit = pairs.get('source_commit')?.split(/\s+/)[0];
  return {
    playwrightVersion,
    platform,
    os: words.slice(0, -1).join(' '),
    sourceCommit: commit === undefined || commit === ''
      ? null
      : commit,
    state: pairs.get('state') ?? null,
  };
}
