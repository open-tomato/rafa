/** File moves the steps share. None deletes a file it has not first put somewhere else. */
import { copyFile, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** True when something is at `path`. */
export async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** Moves a folder; across devices, copies it whole and only then removes the source. */
export async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true });
  }
}

/** Copies the named files from one folder to another, making the target. Answers how many were copied. */
export async function copyNamed(from: string, to: string, names: Iterable<string>): Promise<number> {
  await mkdir(to, { recursive: true });
  let copied = 0;
  for (const name of names) {
    await copyFile(join(from, name), join(to, name));
    copied += 1;
  }
  return copied;
}

/** The `*.png` names directly in `dir`, sorted; none for a missing folder. */
export async function pngNames(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
