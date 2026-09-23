/**
 * End-to-end test of `rafa skill search` over a planted project, spawned
 * as `bun src/rafa.ts` in a scratch repository whose `claude` is a
 * stand-in. The stand-in logs every call, records its arguments and its
 * working directory, and answers with a `rafa:search` block, so no real
 * session starts.
 *
 * Measured: `--no-model` prints the ranking and never reaches the
 * stand-in; a block holding one true and one invented quote prints one
 * match and the dropped line; the session's `--tools` value is exactly
 * `Read,Grep,Glob`; and the scratch copy the session ran in is gone once
 * the command has exited.
 */
import type { ScratchRepo } from './cli-capture.js';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-search-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SPAWN_TIMEOUT = 60_000;

const QUESTION = 'who writes tsdoc for exported symbols';

/** The line of the planted quote in each skill file. */
const QUOTE_LINE = 9;

const TRUE_QUOTE = 'Every exported symbol carries a TSDoc block.';

function skillText(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Owns tsdoc comments on exported symbols',
    'tags: [tsdoc, comments]',
    '---',
    '',
    `# ${name}`,
    '',
    TRUE_QUOTE,
    '',
  ].join('\n');
}

function plantSkill(scratch: ScratchRepo, name: string): void {
  const file = join(scratch.repo, '.claude/skills', name, 'SKILL.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, skillText(name), 'utf8');
}

interface Planted {
  readonly scratch: ScratchRepo;
  readonly argsLog: string;
  readonly cwdLog: string;
  readonly tmp: string;
}

/** Plants a project with two skills and a stand-in `claude` printing `answer`, or failing when `answer` is null. */
function plant(answer: string | null): Planted {
  const scratch = plantScratchRepo(tempBase);
  plantSkill(scratch, 'documentation');
  plantSkill(scratch, 'commenting');
  const tmp = join(scratch.home, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const argsLog = join(scratch.home, 'args.log');
  const cwdLog = join(scratch.home, 'cwd.log');
  const answerFile = join(scratch.home, 'answer.txt');
  writeFileSync(answerFile, answer ?? '', 'utf8');
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo called >> '${scratch.callLog}'`,
    answer === null
      ? 'exit 1'
      : [
        `for a in "$@"; do printf '%s\\n' "$a" >> '${argsLog}'; done`,
        `pwd >> '${cwdLog}'`,
        `while IFS= read -r l; do printf '%s\\n' "$l"; done < '${answerFile}'`,
        'exit 0',
      ].join('\n'),
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
  return { scratch, argsLog, cwdLog, tmp };
}

function block(matches: readonly { name: string; quote: string }[]): string {
  const entries = matches.map((match) => [
    `  - name: ${match.name}`,
    '    why: "owns TSDoc blocks"',
    `    quote: "${match.quote}"`,
    `    line: ${QUOTE_LINE}`,
  ].join('\n'));
  return ['Done.', '', '```rafa:search', 'matches:', ...entries, 'unanswerable: false', '```', ''].join('\n');
}

describe('rafa skill search, spawned', () => {
  it('prints the ranking and spawns nothing under --no-model', () => {
    const { scratch, tmp } = plant(null);

    const run = runRafa(scratch, scratch.repo, ['skill', 'search', QUESTION, '--no-model'], { TMPDIR: tmp });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('keyword ranking, no session');
    expect(run.stdout).toContain('documentation');
    expect(run.stdout).toContain('commenting');
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
  }, SPAWN_TIMEOUT);

  it('prints the one true match and "1 match dropped", with the three tools and no scratch copy left', () => {
    const { scratch, argsLog, cwdLog, tmp } = plant(block([
      { name: 'documentation', quote: TRUE_QUOTE },
      { name: 'commenting', quote: 'This sentence was invented by the model.' },
    ]));

    const run = runRafa(scratch, scratch.repo, ['skill', 'search', QUESTION], { TMPDIR: tmp });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`"${TRUE_QUOTE}"`);
    expect(run.stdout).toContain('documentation (project)');
    expect(run.stdout).not.toContain('commenting (project)');
    expect(run.stdout).toContain('1 match dropped');
    expect(readFileSync(scratch.callLog, 'utf8')
      .trim()
      .split('\n')).toHaveLength(1);

    const args = readFileSync(argsLog, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const tools = args[args.indexOf('--tools') + 1];
    expect(args.indexOf('--tools')).toBeGreaterThan(-1);
    expect(tools?.split(',').sort()).toEqual(['Glob', 'Grep', 'Read']);
    expect(args.at(-1)).toBe(tools);

    const ranIn = readFileSync(cwdLog, 'utf8').trim();
    expect(ranIn.startsWith(realpathSync(tmp))).toBe(true);
    expect(existsSync(ranIn)).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
  }, SPAWN_TIMEOUT);
});
