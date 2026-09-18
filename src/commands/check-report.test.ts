/**
 * Tests for `rafa skill check` and `rafa instinct check`
 * (`src/commands/skill/check.ts`, `src/commands/instinct/check.ts`) and
 * the runner they share (`src/commands/check-report.ts`): the words
 * each reads off a line, the lines a run prints, the exit code it
 * refuses with, and the refusals.
 *
 * Every case plants its own tier under a temporary directory of this
 * file's own and dispatches the command in-process with streams, an
 * environment and a working directory of its own
 * (`src/tests/cli-capture.ts`). Nothing reads the real home,
 * `~/.claude/skills` or the process `PATH`: the tool lookup is the
 * `PATH` of the dispatched environment and the project root is
 * `--project` alone, so a run given neither resolves neither. The
 * commands declare `needsProject: false`, and the temporary project
 * `dispatchCaptured` plants is the dispatcher's, never the checker's.
 *
 * ## The controls
 *
 * Two readings here could be false negatives, and each is paired. That
 * a run given no `--project` exits 0 over a body naming a project path
 * is held BESIDE the same tier checked with `--project`, which exits 1
 * naming `unresolved-path`: the warning is a warning because the
 * failure is reachable. And that `--fix` leaves a body byte-identical
 * is held beside the frontmatter it did fill, so a fix that wrote
 * nothing at all would redden the same case.
 */
import type { CheckIssue, CheckReport } from '../check/run.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { dispatchCaptured, eventsOf } from '../tests/cli-capture.js';

import {
  checkCommandResult,
  INSTINCT_CHECK_USAGE,
  issueLine,
  readCheckDirectory,
  readFix,
  readProjectRoot,
  renderCheck,
  reportMarker,
  SKILL_CHECK_USAGE,
  warningFileCount,
} from './check-report.js';
import { createInstinctCheckCommand } from './instinct/check.js';
import { createSkillCheckCommand } from './skill/check.js';

/** The subjects the dispatched cases route through. */
const SUBJECTS = [
  { name: 'skill', summary: 'check a skills directory' },
  { name: 'instinct', summary: 'check an instincts directory' },
];

/** A temporary directory of this file's own, holding every planted tier. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-check-command-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Plants a tree and answers its root. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const root = join(tempBase, `case-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return root;
}

/** A markdown file: the frontmatter lines given, then the body given. */
function fileText(lines: readonly string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** The four required skill fields, filled with values every check accepts. */
const CLEAN_SKILL_FIELDS: readonly string[] = [
  'name: verification-loop',
  'description: Run the gates in order and read each exit code',
  'tags: [verification, gates]',
  'stack: [agnostic]',
];

/** The same skill without the two fields `--fix` fills. */
const FIXABLE_SKILL_FIELDS: readonly string[] = [
  'name: verification-loop',
  'description: Run the gates in order and read each exit code',
];

/** A body naming nothing any check can refuse. */
const PLAIN_BODY = '\n# Verification loop\n\nRead each exit code.\n';

/** The frontmatter of a record every check accepts. */
const CLEAN_INSTINCT_FIELDS: readonly string[] = [
  'id: bun-install-after-worktree-fork',
  'trigger: when running tests in a freshly forked worktree',
  'kind: gotcha',
  'domain: workflow',
  'confidence: 0.6',
  'signal: loud',
  'scope: project',
  'source: task-report',
  'evidence:',
  '  - plan: my-feature',
  '    outcome: blocked',
  'created_at: 2026-09-11T10:00:00Z',
  'updated_at: 2026-09-11T10:00:00Z',
];

/** A record body with both sections the schema requires. */
const INSTINCT_BODY = '\n## Action\nRun the install first.\n\n## Cause\nThe fork copies no packages.\n';

/** The commands under test, each resolving relative paths against `root`. */
function commandsFor(root: string) {
  const seams = { cwd: () => root };
  return [createSkillCheckCommand(seams), createInstinctCheckCommand(seams)];
}

/** Dispatches `words` over the two commands, with `cwd` as their working directory. */
async function run(words: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}) {
  return dispatchCaptured(words, SUBJECTS, commandsFor(cwd), env);
}

/** A report with the fields the line renderers read. */
function report(fields: Partial<CheckReport>): CheckReport {
  return {
    kind: 'skill',
    path: '/tier/a/SKILL.md',
    isFile: true,
    name: 'a',
    issues: [],
    failed: false,
    fixed: [],
    ...fields,
  };
}

/** An issue with the fields the line renderers read. */
function issue(fields: Partial<CheckIssue>): CheckIssue {
  return {
    stage: 'schema',
    code: 'missing-field',
    severity: 'failure',
    field: null,
    line: null,
    message: 'said something',
    ...fields,
  };
}

/** The exit code and the message a call refused with. */
function refusal(call: () => unknown): [number, string] {
  try {
    call();
  } catch (error) {
    if (error instanceof CommandExit) return [error.exitCode, error.message];
    throw error;
  }
  throw new Error('expected a CommandExit, and the call returned');
}

describe('the words a check line is read as', () => {
  it('resolves the directory against the working directory it was handed', () => {
    expect(readCheckDirectory(['skills'], SKILL_CHECK_USAGE, () => '/tier')).toBe('/tier/skills');
    expect(readCheckDirectory(['/abs/skills'], SKILL_CHECK_USAGE, () => '/tier')).toBe('/abs/skills');
  });

  it('refuses a line naming no directory and one naming a second word', () => {
    expect(refusal(() => readCheckDirectory([], SKILL_CHECK_USAGE, () => '/tier'))).toEqual([
      1,
      `❌ Expected a directory to check, got none\nUsage: ${SKILL_CHECK_USAGE}`,
    ]);
    expect(refusal(() => readCheckDirectory(['a', 'b'], INSTINCT_CHECK_USAGE, () => '/tier'))).toEqual([
      1,
      `❌ Expected one directory, and read "b" as a second\nUsage: ${INSTINCT_CHECK_USAGE}`,
    ]);
  });

  it('reads --fix as a boolean and refuses a value it took off the next word', () => {
    expect(readFix(undefined, SKILL_CHECK_USAGE)).toBe(false);
    expect(readFix(false, SKILL_CHECK_USAGE)).toBe(false);
    expect(readFix('false', SKILL_CHECK_USAGE)).toBe(false);
    expect(readFix(true, SKILL_CHECK_USAGE)).toBe(true);
    expect(readFix('true', SKILL_CHECK_USAGE)).toBe(true);
    expect(refusal(() => readFix('skills', SKILL_CHECK_USAGE))[0]).toBe(1);
  });

  it('resolves --project against the working directory, answers null for a line without it, and refuses a bare one', () => {
    expect(readProjectRoot(undefined, SKILL_CHECK_USAGE, () => '/tier')).toBeNull();
    expect(readProjectRoot('.', SKILL_CHECK_USAGE, () => '/tier')).toBe('/tier');
    expect(readProjectRoot('/abs', SKILL_CHECK_USAGE, () => '/tier')).toBe('/abs');
    expect(refusal(() => readProjectRoot(true, SKILL_CHECK_USAGE, () => '/tier'))).toEqual([
      1,
      `❌ --project needs a path, and the line gave it none\nUsage: ${SKILL_CHECK_USAGE}`,
    ]);
  });
});

describe('the lines a run prints', () => {
  it('marks a failing entry, a warning-only entry and a fixed one apart', () => {
    expect(reportMarker(report({ failed: true }))).toBe('❌');
    expect(reportMarker(report({ fixed: ['tags'] }))).toBe('🔧');
    expect(reportMarker(report({}))).toBe('⚠️');
  });

  it('names an issue by its stage and code, with its field or its body line', () => {
    expect(issueLine(issue({ field: 'tags' }))).toBe('   schema missing-field (tags): said something');
    expect(issueLine(issue({ stage: 'resolution', code: 'unresolved-path', line: 12 })))
      .toBe('   resolution unresolved-path (line 12): said something');
    expect(issueLine(issue({ stage: 'layout', code: 'loose-file' })))
      .toBe('   layout loose-file: said something');
  });

  it('prints nothing for a clean entry, and closes with the count', () => {
    const reports = [
      report({ path: '/tier/clean/SKILL.md' }),
      report({ path: '/tier/warned/SKILL.md', issues: [issue({ severity: 'warning', stage: 'resolution', code: 'unchecked-path' })] }),
      report({ path: '/tier/broken/SKILL.md', issues: [issue({ field: 'tags' })], failed: true }),
    ];
    const result = checkCommandResult(
      { kind: 'skill', root: '/tier', reports, failingFiles: 1, exitCode: 1 },
      null,
    );

    expect(warningFileCount(reports)).toBe(1);
    expect(renderCheck(result)).toEqual([
      '⚠️ /tier/warned/SKILL.md',
      '   resolution unchecked-path: said something',
      '❌ /tier/broken/SKILL.md',
      '   schema missing-field (tags): said something',
      '3 skill(s) checked under /tier: 1 failing, 1 with warnings',
    ]);
  });

  it('names the fields a fix filled on the entry line', () => {
    expect(renderCheck(checkCommandResult(
      { kind: 'skill', root: '/tier', reports: [report({ fixed: ['tags', 'stack'] })], failingFiles: 0, exitCode: 0 },
      null,
    ))).toEqual([
      '🔧 /tier/a/SKILL.md (filled tags, stack)',
      '1 skill(s) checked under /tier: 0 failing, 0 with warnings',
    ]);
  });
});

describe('rafa skill check over a planted tier', () => {
  it('exits 0 over a clean tier and gives the reports as the json result', async () => {
    const root = plant({ 'skills/verification-loop/SKILL.md': fileText(CLEAN_SKILL_FIELDS, PLAIN_BODY) });

    const text = await run(['skill', 'check', 'skills'], root);
    const json = await run(['skill', 'check', 'skills', '--output=json'], root);

    expect(text.exitCode).toBe(0);
    expect(text.stderr).toBe('');
    expect(text.stdout).toBe(`1 skill(s) checked under ${join(root, 'skills')}: 0 failing, 0 with warnings\n`);
    const [, result] = eventsOf(json.stdout);
    expect(result).toMatchObject({ type: 'result', ok: true, data: { kind: 'skill', failingFiles: 0, projectRoot: null } });
  });

  it('exits with the number of failing files, naming each rule on stderr', async () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': fileText(
        ['name: verification-loop', 'description: Run the gates'],
        PLAIN_BODY,
      ),
      'skills/loose.md': fileText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    });

    const answered = await run(['skill', 'check', 'skills'], root);

    expect(answered.exitCode).toBe(2);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('schema missing-field (tags)');
    expect(answered.stderr).toContain('schema missing-field (stack)');
    expect(answered.stderr).toContain('layout loose-file');
    expect(answered.stderr).toContain('2 failing, 0 with warnings');
  });

  it('counts a body path as unchecked without --project, and fails the same tier with one', async () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': fileText(CLEAN_SKILL_FIELDS, '\nRead `src/gone.ts`.\n'),
      'project/': '',
    });

    const without = await run(['skill', 'check', 'skills'], root);
    const with_ = await run(['skill', 'check', 'skills', '--project=project'], root);

    expect(without.exitCode).toBe(0);
    expect(without.stdout).toContain('resolution unchecked-path');
    expect(without.stdout).toContain('0 failing, 1 with warnings');
    expect(with_.exitCode).toBe(1);
    expect(with_.stderr).toContain('resolution unresolved-path');
  });

  it('fills tags and stack under --fix, leaving the body byte for byte', async () => {
    const body = '\n# Verification loop\n\nRun `bun test` and read the exit code.\n\n```ts\nexport const x = 1;\n```\n';
    const root = plant({ 'skills/verification-loop/SKILL.md': fileText(FIXABLE_SKILL_FIELDS, body) });
    const path = join(root, 'skills/verification-loop/SKILL.md');

    const answered = await run(['skill', 'check', 'skills', '--fix'], root);
    const written = readFileSync(path, 'utf8');

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('(filled tags, stack)');
    expect(written).toContain('tags:');
    expect(written).toContain('stack:');
    expect(written.slice(written.indexOf('\n---\n') + '\n---\n'.length)).toBe(body);
  });

  it('refuses a --fix that read the directory as its value, writing nothing', async () => {
    const root = plant({ 'skills/verification-loop/SKILL.md': fileText(FIXABLE_SKILL_FIELDS, PLAIN_BODY) });
    const before = readFileSync(join(root, 'skills/verification-loop/SKILL.md'), 'utf8');

    const answered = await run(['skill', 'check', '--fix', 'skills'], root);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('--fix takes no value');
    expect(readFileSync(join(root, 'skills/verification-loop/SKILL.md'), 'utf8')).toBe(before);
  });

  it('refuses a path that is no directory, and a line naming none', async () => {
    const root = plant({ 'skills/verification-loop/SKILL.md': fileText(CLEAN_SKILL_FIELDS, PLAIN_BODY) });

    const missing = await run(['skill', 'check', 'nowhere'], root);
    const none = await run(['skill', 'check'], root);

    expect([missing.exitCode, none.exitCode]).toEqual([1, 1]);
    expect(missing.stderr).toContain(`no skill directory at ${join(root, 'nowhere')}`);
    expect(none.stderr).toContain('Expected a directory to check, got none');
  });

  it('looks a fenced tool up on the PATH of the environment it was dispatched with', async () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': fileText(
        CLEAN_SKILL_FIELDS,
        '\nRun it.\n\n```bash\nnosuchtool run\n```\n',
      ),
    });

    const answered = await run(['skill', 'check', 'skills'], root, { PATH: join(root, 'bin') });

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('resolution missing-tool');
  });
});

describe('rafa instinct check over a planted scope', () => {
  it('exits 0 over a clean scope, passing the adapter NDJSON files over', async () => {
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md': fileText(CLEAN_INSTINCT_FIELDS, INSTINCT_BODY),
      'instincts/instincts.ndjson': '{"id":"x"}\n',
      'instincts/flags.ndjson': '{"id":"y"}\n',
    });

    const answered = await run(['instinct', 'check', 'instincts'], root);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toBe(`1 instinct(s) checked under ${join(root, 'instincts')}: 0 failing, 0 with warnings\n`);
  });

  it('fails a task-report record whose evidence is empty', async () => {
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md': fileText(
        CLEAN_INSTINCT_FIELDS.filter((line) => !line.startsWith('evidence') && !line.startsWith('  ')),
        INSTINCT_BODY,
      ),
    });

    const answered = await run(['instinct', 'check', 'instincts'], root);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('instinct missing-evidence');
    expect(answered.stderr).toContain('1 failing, 0 with warnings');
  });

  it('declares no --fix and no --project, and reads neither off a line', async () => {
    const [, instinctCheck] = commandsFor(tempBase);

    expect(instinctCheck?.flags).toEqual([]);
    expect(instinctCheck?.args.map((arg) => arg.name)).toEqual(['dir']);
  });
});
