/**
 * Integration tests for check 4 of `rafa plan create` end to end
 * (`checkCreateRefs` over `enforceRefsGate`, `src/commands/plan/refs-check.ts`
 * and `src/board/refs-gate.ts`), over planted repositories and the
 * verifier `plan create` builds for them: real git, the real extractor
 * and the real stamp codec, and a real rafa checkout whose own `describe`
 * is run for the roster. Only the `gh` issue reader is out of it, because
 * the fixture specs name no issue.
 *
 * Two fixtures, each a saved copy under `.rafa/specs/` of a planted
 * repository:
 *
 *  - #172's classes, which the gate must let through with no
 *    `--accept-refs` and no `dangerous.acceptStaleRefs`: an unexported
 *    interface member, an object field, a module-local function, a flag
 *    of `gh` and of `claude` (in prose and in spans, which are not
 *    references at all) and a command and flag only the checkout's own
 *    roster holds. The first reading stamps the copy and a second reading
 *    over the stamped copy still passes.
 *  - Drift, which the gate must still refuse, naming each reference: a
 *    path stamped `present` and since deleted reads `dangling`, a path
 *    stamped with its blob and since changed reads `suspect`, and a
 *    stamped path nobody touched is not named.
 *
 * The controls: the refusal case runs the same gate over the same copy
 * as the passing one, so a gate that read nothing cannot pass for one
 * that found nothing; and the refusal leaves the copy as it was.
 */
import type { ResolvedSpec } from '../board/spec-source.js';
import type { DescribeDocument, DescribedAction } from '../cli/describe.js';
import type { Output } from '../ports/index.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_REFUSAL_EXIT } from '../board/plan-spec.js';
import { CommandExit } from '../cli/command.js';
import { checkCreateRefs, RAFA_PACKAGE_NAME } from '../commands/plan/refs-check.js';
import { readRefsBlock } from '../refs/stamp.js';

import { sinkOutput } from './output-sinks.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-create-refs-gate-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ISSUE = 172;
const COPY_PATH = join('.rafa', 'specs', 'rafa-172-spec.md');

/** Runs git in `cwd`, throwing on failure: the planting's own git. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** Writes `text` at `file` under `root`, making its directories. */
function plant(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** A described action holding `flags` as boolean flags. */
function action(name: string, flags: readonly string[]): DescribedAction {
  return {
    name,
    summary: '',
    description: '',
    args: [],
    flags: flags.map((flag) => ({ name: flag, description: '', type: 'boolean', required: false, default: null, aliases: [] })),
    examples: [],
    outputs: ['text'],
    aliases: [],
    deprecated: null,
    module: null,
    spends: null,
  };
}

/** The roster the planted checkout's own `describe` writes: a command and a flag no core roster holds. */
const CHECKOUT_ROSTER: DescribeDocument = {
  schemaVersion: 2,
  binary: 'rafa',
  version: '0.0.0-planted',
  subjects: [{ name: 'checkoutonly', summary: '', actions: [action('frobnicate', ['frob-fast'])] }],
  commands: [],
};

/** An entry that answers {@link CHECKOUT_ROSTER} as `describe --output=json` does. */
const ROSTER_ENTRY = [
  `console.log(${JSON.stringify(JSON.stringify({ type: 'start', command: 'describe', ts: '2026-10-05T00:00:00.000Z' }))});`,
  `console.log(${JSON.stringify(JSON.stringify({ type: 'result', ok: true, data: CHECKOUT_ROSTER }))});`,
  '',
].join('\n');

let planted = 0;

/** A rafa checkout (named and tracked as one) holding `files`, committed, and `staged`, added but not committed. */
function plantRepository(files: Readonly<Record<string, string>>, staged: Readonly<Record<string, string>> = {}): string {
  planted += 1;
  const root = join(tempBase, `repo-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'rafa@example.test']);
  git(root, ['config', 'user.name', 'rafa test']);
  plant(root, 'package.json', `${JSON.stringify({ name: RAFA_PACKAGE_NAME, version: '0.0.0' })}\n`);
  plant(root, 'src/rafa.ts', ROSTER_ENTRY);
  for (const [file, text] of Object.entries(files)) plant(root, file, text);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--no-verify', '--message', 'planted']);
  for (const [file, text] of Object.entries(staged)) {
    plant(root, file, text);
    git(root, ['add', file]);
  }
  return root;
}

/** Writes the saved copy of the spec into `root` and answers what a board route resolves for it. */
function plantCopy(root: string, text: string): ResolvedSpec {
  plant(root, COPY_PATH, text);
  return { path: COPY_PATH, kind: 'issue', source: `issue #${String(ISSUE)}`, issue: ISSUE, read: null, snapshot: null };
}

/** The lines a run wrote, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output keeping the lines it is handed. */
function capture(): { lines: Lines; output: Output } {
  const lines: Lines = { info: [], warn: [] };
  return {
    lines,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
  };
}

/** Check 4 as `plan create --issue=172` runs it with no acceptance, over the verifier the command builds. */
async function runCheck4(root: string, spec: ResolvedSpec, output: Output): ReturnType<typeof checkCreateRefs> {
  return checkCreateRefs({ spec, repoRoot: root, args: ['--issue=172'], acceptStaleRefs: false, output });
}

/** The refusal `run` ends with, or a failure when it ends with none. */
async function refusal(run: Promise<unknown>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected check 4 to refuse');
}

const SHAPES = [
  'interface LocalShape {',
  '  memberName: number;',
  '}',
  'const TABLE = {',
  '  objectField: 1,',
  '};',
  'function localHelper(): LocalShape {',
  '  return { memberName: TABLE.objectField };',
  '}',
  'localHelper();',
  '',
].join('\n');

const CLASSES_SPEC = [
  '# Spec',
  '',
  'The member `memberName`, the field `objectField` and the function `localHelper()` are read.',
  'It lives in `src/shapes.ts`.',
  'Run `rafa checkoutonly frobnicate --frob-fast` to try it.',
  'Prose: gh issue create --body-file is not ours, and `gh issue create --body-file` nor',
  '`claude --setting-sources` is a rafa flag; --body-file in running text is not either.',
  '',
].join('\n');

describe('check 4 over a spec holding #172\'s classes', () => {
  it('passes with no acceptance, stamps the copy and says nothing of the correct names', async () => {
    const root = plantRepository({ 'src/shapes.ts': SHAPES });
    const spec = plantCopy(root, CLASSES_SPEC);
    const { lines, output } = capture();

    const answer = await runCheck4(root, spec, output);

    expect(answer).not.toBeNull();
    expect(answer?.restamped).toBe(false);
    expect(answer?.accepted).toEqual([]);
    expect(answer?.rows.map((row) => `${row.kind}:${row.text}:${row.state}`)).toEqual([
      'symbol:memberName:ok',
      'symbol:objectField:ok',
      'symbol:localHelper:ok',
      'path:src/shapes.ts:ok',
      'command:rafa checkoutonly frobnicate:ok',
      'flag:--frob-fast:ok',
    ]);
    expect(lines).toEqual({ info: [], warn: [] });
    const stamps = readRefsBlock(readFileSync(join(root, COPY_PATH), 'utf8')).stamps;
    expect(stamps?.map((stamp) => `${stamp.kind}:${stamp.text}`)).toEqual([
      'symbol:memberName',
      'symbol:objectField',
      'symbol:localHelper',
      'path:src/shapes.ts',
      'command:rafa checkoutonly frobnicate',
      'flag:--frob-fast',
    ]);
  });

  it('passes again over the copy its first run stamped', async () => {
    const root = plantRepository({ 'src/shapes.ts': SHAPES });
    const spec = plantCopy(root, CLASSES_SPEC);
    await runCheck4(root, spec, capture().output);
    const stamped = readFileSync(join(root, COPY_PATH), 'utf8');
    const { lines, output } = capture();

    const answer = await runCheck4(root, spec, output);

    expect(answer?.rows.every((row) => row.state === 'ok')).toBe(true);
    expect(answer?.rows).toHaveLength(6);
    expect(lines).toEqual({ info: [], warn: [] });
    expect(readFileSync(join(root, COPY_PATH), 'utf8')).toBe(stamped);
  });
});

const DRIFT_SPEC = [
  '# Spec',
  '',
  'It reads `src/staged.ts`,',
  '`src/changes.ts` and `src/steady.ts`.',
  '',
].join('\n');

describe('check 4 over a spec whose stamped references drifted', () => {
  it('refuses a stamped present path now deleted and a stamped blob now changed, naming each and not the steady one', async () => {
    const root = plantRepository(
      { 'src/changes.ts': 'export const before = 1;\n', 'src/steady.ts': 'export const steady = 1;\n' },
      { 'src/staged.ts': 'export const staged = 1;\n' },
    );
    const spec = plantCopy(root, DRIFT_SPEC);
    const first = await runCheck4(root, spec, capture().output);
    expect(first?.rows.map((row) => `${row.text}:${row.state}`)).toEqual(['src/staged.ts:ok', 'src/changes.ts:ok', 'src/steady.ts:ok']);
    const stamped = readRefsBlock(readFileSync(join(root, COPY_PATH), 'utf8')).stamps;
    expect(stamped?.map((stamp) => `${stamp.text}:${stamp.fingerprint.kind}`)).toEqual([
      'src/staged.ts:present',
      'src/changes.ts:blob',
      'src/steady.ts:blob',
    ]);
    const copyBefore = readFileSync(join(root, COPY_PATH), 'utf8');

    git(root, ['rm', '--quiet', '--force', 'src/staged.ts']);
    plant(root, 'src/changes.ts', 'export const after = 2;\n');
    git(root, ['add', 'src/changes.ts']);
    git(root, ['commit', '--quiet', '--no-verify', '--message', 'drift']);
    const { output } = capture();
    const thrown = await refusal(runCheck4(root, spec, output));

    expect(thrown.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(thrown.message).toContain('issue #172 names references that are missing or changed');
    expect(thrown.message).toContain('• dangling src/staged.ts (line 3)');
    expect(thrown.message).toContain('• suspect src/changes.ts');
    expect(thrown.message).not.toContain('src/steady.ts');
    expect(thrown.message).toContain('--accept-refs');
    expect(readFileSync(join(root, COPY_PATH), 'utf8')).toBe(copyBefore);
  });

  it('lets the same drift through under --accept-refs, so the refusal is the check\'s and not the fixture\'s', async () => {
    const root = plantRepository({ 'src/changes.ts': 'export const before = 1;\n' }, { 'src/staged.ts': 'export const staged = 1;\n' });
    const spec = plantCopy(root, DRIFT_SPEC.replace('and `src/steady.ts`', ''));
    await runCheck4(root, spec, capture().output);
    git(root, ['rm', '--quiet', '--force', 'src/staged.ts']);
    plant(root, 'src/changes.ts', 'export const after = 2;\n');
    git(root, ['add', 'src/changes.ts']);
    git(root, ['commit', '--quiet', '--no-verify', '--message', 'drift']);

    const answer = await checkCreateRefs({ spec, repoRoot: root, args: ['--issue=172', '--accept-refs'], acceptStaleRefs: false, output: capture().output });

    expect(answer?.restamped).toBe(true);
    expect(answer?.accepted.map((row) => `${row.state} ${row.text}`)).toEqual(['dangling src/staged.ts', 'suspect src/changes.ts']);
  });
});
