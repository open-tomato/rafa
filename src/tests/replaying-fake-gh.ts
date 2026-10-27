/**
 * A `gh` a spawned run can call: `packages/rafa-pr/src/pr/gh-fake.ts`'s in-memory fake
 * behind a process, for the case that spawns `rafa pr triage` and has to
 * answer each `gh` command it sends.
 *
 * Every `gh` call is a new process, and the fake lives in memory, so
 * the state is rebuilt on each call: the pull requests and permissions
 * the case planted are read from `seed.json` in the directory
 * `FAKE_GH_STATE` names, every command an earlier call ran is replayed
 * from `calls.jsonl` beside it, and only then is this call's command
 * run, written to the file and answered. A comment an earlier call
 * wrote is therefore the one a later call reads, as it would be on
 * GitHub.
 *
 * `auth status` is answered as signed in, which the fake does not model.
 * Anything else the fake refuses is refused here as it is there, with
 * its `fake gh:` message on stderr and exit 1.
 *
 * Run as `bun <this file> <gh arguments>`; {@link plantFakeGh} writes
 * the `gh` script in a scratch `bin/` that does so.
 */
import type { FakePullRequestSeed } from '@open-tomato/rafa-pr/pr/gh-fake-shapes';

import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakePrGh } from '@open-tomato/rafa-pr/pr/gh-fake';

/** The variable naming the directory holding the seed and the call log. */
export const FAKE_GH_STATE = 'FAKE_GH_STATE';

/** The clock every comment is stamped with. */
const NOW = '2026-10-14T09:00:00Z';

/** What a case plants in the fake before any call. */
export interface FakeGhSeed {
  readonly pulls: readonly FakePullRequestSeed[];
  /** Each login and the permission the collaborators endpoint answers for it. */
  readonly permissions: Readonly<Record<string, string>>;
}

/** The seed file under a state directory. */
function seedPath(state: string): string {
  return join(state, 'seed.json');
}

/** The call log under a state directory, one JSON array of arguments per line. */
function callsPath(state: string): string {
  return join(state, 'calls.jsonl');
}

/** Writes a `gh` into `bin` that runs this file, holding its state under `state`. Answers its path. */
export function plantFakeGh(bin: string, state: string, seed: FakeGhSeed): string {
  writeFileSync(seedPath(state), JSON.stringify(seed), 'utf8');
  const gh = join(bin, 'gh');
  const script = fileURLToPath(import.meta.url);
  writeFileSync(gh, [
    '#!/bin/sh',
    `FAKE_GH_STATE='${state}' exec '${process.execPath}' '${script}' "$@"`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
  return gh;
}

/** The earlier commands this state directory holds, in order. */
function earlierCalls(state: string): readonly (readonly string[])[] {
  if (!existsSync(callsPath(state))) return [];
  return readFileSync(callsPath(state), 'utf8').split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

/** Runs one `gh` command over the state in `state`, writing what it answers. */
async function main(state: string, args: readonly string[]): Promise<number> {
  if (args[0] === 'auth' && args[1] === 'status') {
    process.stdout.write('Logged in\n');
    return 0;
  }
  const seed = JSON.parse(readFileSync(seedPath(state), 'utf8')) as FakeGhSeed;
  const fake = createFakePrGh({ now: () => NOW });
  for (const pull of seed.pulls) fake.plant(pull);
  for (const [login, permission] of Object.entries(seed.permissions)) fake.plantPermission(login, permission);
  for (const earlier of earlierCalls(state)) await fake.run(earlier);

  const result = await fake.run(args);
  appendFileSync(callsPath(state), `${JSON.stringify(args)}\n`, 'utf8');
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.ok
    ? 0
    : 1;
}

if (import.meta.main) {
  const state = process.env[FAKE_GH_STATE];
  if (state === undefined) {
    process.stderr.write(`replaying-fake-gh: ${FAKE_GH_STATE} names no state directory\n`);
    process.exit(2);
  }
  process.exit(await main(state, process.argv.slice(2)));
}
