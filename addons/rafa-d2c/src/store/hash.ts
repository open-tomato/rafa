/** The sha256 of every PNG in a folder, by file name. */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The sha256 of one file's bytes, as hex. */
export async function hashFile(file: string): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(await Bun.file(file).arrayBuffer())
    .digest('hex');
}

/** Each `*.png` file directly in `dir`, by name, to its sha256; an empty map for a missing folder. */
export async function hashFolder(dir: string): Promise<ReadonlyMap<string, string>> {
  let names: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return new Map();
  }
  const hashes = new Map<string, string>();
  for (const name of names) hashes.set(name, await hashFile(join(dir, name)));
  return hashes;
}
