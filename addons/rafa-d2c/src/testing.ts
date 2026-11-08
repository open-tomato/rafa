/**
 * Test helpers shared by the add-on's test files: temp folders that are
 * removed after each test, and a fake process runner. Imported by tests
 * only.
 */
import type { ProcessResult, ProcessRunner } from './process.js';

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A set of temp folders, each a real path, removed by {@link TempDirs.clean}. */
export class TempDirs {
  private readonly made: string[] = [];

  /** A new empty folder. */
  async make(prefix = 'd2c-'): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    this.made.push(dir);
    return dir;
  }

  /** Removes every folder made. */
  async clean(): Promise<void> {
    await Promise.all(this.made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

/** One scripted answer: the argv prefix it matches, and what it answers. */
export type FakeAnswer = readonly [readonly string[], Partial<ProcessResult>];

/** A runner answering the first answer whose argv prefix matches, exit 0 and empty output otherwise; `seen` records every argv. */
export function fakeRunner(answers: readonly FakeAnswer[] = [], seen: string[][] = []): ProcessRunner {
  return (argv) => {
    seen.push([...argv]);
    const match = answers.find(([prefix]) => prefix.every((word, index) => argv[index] === word));
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...match?.[1] });
  };
}
