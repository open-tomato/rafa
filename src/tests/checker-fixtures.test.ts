/**
 * Black-box tests for the checker: `bun src/rafa.ts skill check` and
 * `instinct check`, spawned rather than dispatched in-process, over
 * fixtures planted in one temporary project.
 *
 * `src/check/run.test.ts` measures the four check modules against
 * `checkFile` and `checkDirectory` directly, and
 * `src/commands/check-report.test.ts` measures the two commands
 * dispatched in-process over a planted tier. Neither runs the real CLI
 * entry: this file spawns `bun src/rafa.ts` (`runRafa`,
 * `src/tests/cli-capture.ts`) so the checker is measured through the
 * same path a person or a demotion pass reaches it by — argument
 * parsing, routing and the dispatcher's exit code included — not just
 * through the functions those two files call directly.
 *
 * ## The one project
 *
 * `plantScratchRepo` makes one scratch git repository, its own `HOME`
 * beside it, and writes `.rafa/config.yaml` at its root, which is the
 * "temporary project" every fixture here sits under. `.claude/skills/`
 * holds three tiers (`broken`, `clean`, `fixable`) and `.rafa/instincts/`
 * holds one record, all under that one root; `--project=.` in the
 * `broken` case names the repository itself, so a project-looking body
 * path is resolved against real files this file also controls.
 *
 * ## What each tier is for
 *
 * `broken` plants five files, each broken by exactly one rule so its
 * failure is unambiguous: a skill missing a required field (`stack`),
 * a skill whose body names a project path nothing answers, a skill
 * whose body names a path under a home root, and a `mixed-group`
 * directory holding one of each silent layout — `<dir>/<group>/<name>.md`
 * and `<dir>/<group>/<name>/SKILL.md` — with frontmatter otherwise
 * clean so the layout code is the only one their lines carry. One run
 * over `broken` therefore names every one of the five rules and exits
 * with the count of files that broke one, five.
 *
 * `clean` holds one skill every check accepts, to hold the reading that
 * a passing tier exits 0 beside the tier that does not. `fixable` holds
 * one skill missing only `tags` and `stack`, so `--fix` has exactly one
 * thing to fill; the body it carries names nothing any check would
 * refuse, so a body byte moving would be `--fix`'s doing and nothing
 * else's.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checker-fixtures-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one spawned run may take. */
const SPAWN_TIMEOUT = 30_000;

/** Writes `text` at `root`/`relPath`, making its directory first, and answers the path. */
function writeFixture(root: string, relPath: string, text: string): string {
  const path = join(root, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

/** A markdown file: the frontmatter lines given, then the body given. */
function fileText(lines: readonly string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** A body naming nothing any check can refuse. */
const PLAIN_BODY = '\n# Fixture\n\nNothing here names a path or a tool.\n';

/** The four required fields of a skill named `name`, filled with values every check accepts. */
function cleanSkillFields(name: string): string[] {
  return [
    `name: ${name}`,
    `description: A fixture skill named ${name}`,
    'tags: [demo]',
    'stack: [agnostic]',
  ];
}

/**
 * Plants the `broken` tier under `.claude/skills/broken`: one file per
 * rule broken, and the `mixed-group` pair naming both silent layouts.
 * See the module note.
 */
function plantBrokenTier(root: string): void {
  writeFixture(root, '.claude/skills/broken/missing-field/SKILL.md', fileText(
    ['name: missing-field', 'description: A skill missing its stack field', 'tags: [demo]'],
    PLAIN_BODY,
  ));
  writeFixture(root, '.claude/skills/broken/unresolved-path/SKILL.md', fileText(
    cleanSkillFields('unresolved-path'),
    '\nRead `src/does-not-exist.ts` for the pattern.\n',
  ));
  writeFixture(root, '.claude/skills/broken/home-path/SKILL.md', fileText(
    cleanSkillFields('home-path'),
    '\nSee `/Users/someone/notes.md` for context.\n',
  ));
  writeFixture(root, '.claude/skills/broken/mixed-group/flat-skill.md', fileText(
    cleanSkillFields('flat-skill'),
    PLAIN_BODY,
  ));
  writeFixture(root, '.claude/skills/broken/mixed-group/nested-skill/SKILL.md', fileText(
    cleanSkillFields('nested-skill'),
    PLAIN_BODY,
  ));
}

describe('rafa skill check, spawned over a broken tier', () => {
  it('names a missing field, an unresolved path, a home path and both silent layouts, and exits with their count', () => {
    const scratch = plantScratchRepo(tempBase);
    plantBrokenTier(scratch.repo);

    const answered = runRafa(scratch, scratch.repo, [
      'skill', 'check', '.claude/skills/broken', '--project=.',
    ]);

    expect(answered.exitCode).toBe(5);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('schema missing-field (stack)');
    expect(answered.stderr).toContain('resolution unresolved-path');
    expect(answered.stderr).toContain('locality home-path');
    expect(answered.stderr).toContain('layout flat-grouped-layout');
    expect(answered.stderr).toContain('layout nested-group-layout');
    expect(answered.stderr).toContain('5 failing, 0 with warnings');
  }, SPAWN_TIMEOUT);
});

describe('rafa instinct check, spawned over a task-report record', () => {
  it('fails a task-report record whose evidence is empty', () => {
    const scratch = plantScratchRepo(tempBase);
    writeFixture(scratch.repo, '.rafa/instincts/demo-task-report.md', fileText(
      [
        'id: demo-task-report',
        'trigger: when the demo fixture runs',
        'kind: gotcha',
        'domain: workflow',
        'confidence: 0.6',
        'signal: loud',
        'scope: project',
        'source: task-report',
        'evidence: []',
        'created_at: 2026-09-11T10:00:00Z',
        'updated_at: 2026-09-11T10:00:00Z',
      ],
      '\n## Action\nDo the thing.\n\n## Cause\nBecause reasons.\n',
    ));

    const answered = runRafa(scratch, scratch.repo, ['instinct', 'check', '.rafa/instincts']);

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toBe('');
    expect(answered.stderr).toContain('instinct missing-evidence');
    expect(answered.stderr).toContain('1 failing, 0 with warnings');
  }, SPAWN_TIMEOUT);
});

describe('rafa skill check, spawned over a clean tier', () => {
  it('exits 0 and prints only the summary line', () => {
    const scratch = plantScratchRepo(tempBase);
    const dir = writeFixture(
      scratch.repo,
      '.claude/skills/clean/clean-skill/SKILL.md',
      fileText(cleanSkillFields('clean-skill'), PLAIN_BODY),
    );

    const answered = runRafa(scratch, scratch.repo, ['skill', 'check', '.claude/skills/clean']);

    expect(answered).toEqual({
      exitCode: 0,
      stdout: `1 skill(s) checked under ${dirname(dirname(dir))}: 0 failing, 0 with warnings\n`,
      stderr: '',
    });
  }, SPAWN_TIMEOUT);
});

/**
 * Three false positives named in `src/check/references.ts`'s own note,
 * each held beside a control naming a REAL missing tool or a real
 * foreign path, so a loosening that stops the false positive cannot be
 * mistaken for one that also stopped catching the true one.
 *
 * Measured at this stage's start (`823677386e3b860d8c12d92cd70e1e58ec746961`,
 * before this stage's fix tasks land): the shell-function case was
 * ALREADY GREEN — `definedFunctionNames` already reads a bare call to a
 * function the body defines as no claim about `PATH` — while the other
 * two were RED, each failing on its false positive's own message:
 *
 * - `bash fence holding JavaScript`: RED. The fence is `bash`, so
 *   `const ready = true;` is read as a command line and `const` is
 *   reported `missing-tool`, which is what `src/check/shell-lines.ts`
 *   and its wiring into this module (this stage's next two tasks) exist
 *   to stop.
 * - `shell function defined and called bare`: GREEN already. `_ok`,
 *   defined earlier in the same fence and then called bare, is not
 *   reported; only the real missing tool beside it is.
 * - `HTTP route carrying an extension`: RED. `/openapi.json` has no
 *   second segment, but it also has an extension, so the current
 *   {@link isAbsoluteReference} reads it as a path and reports it
 *   `foreign-path`; this stage's fourth task is what reads a
 *   single-segment extensioned token as a route instead.
 */
describe('rafa skill check, spawned over checker false-positive fixtures', () => {
  it('stops reporting JavaScript inside a bash fence as a missing tool, and still reports a real one', () => {
    const scratch = plantScratchRepo(tempBase);
    writeFixture(scratch.repo, '.claude/skills/false-positives/bash-fence-js/SKILL.md', fileText(
      cleanSkillFields('bash-fence-js'),
      [
        '',
        'Sample code, illustrative only:',
        '',
        '```bash',
        'const ready = true;',
        '```',
        '',
        'The real setup step:',
        '',
        '```bash',
        'zzz-fixture-missing-tool --version',
        '```',
        '',
      ].join('\n'),
    ));

    const answered = runRafa(scratch, scratch.repo, ['skill', 'check', '.claude/skills/false-positives']);

    expect(answered.stderr).not.toContain('the command const is in no directory');
    expect(answered.stderr).toContain('the command zzz-fixture-missing-tool is in no directory');
  }, SPAWN_TIMEOUT);

  it('already reads a bare call to a function the body defines as no claim about PATH', () => {
    const scratch = plantScratchRepo(tempBase);
    writeFixture(scratch.repo, '.claude/skills/false-positives/shell-function-bare/SKILL.md', fileText(
      cleanSkillFields('shell-function-bare'),
      [
        '',
        '```bash',
        '_ok() {',
        '  echo "fine"',
        '}',
        '',
        '_ok',
        'zzz-fixture-missing-tool-2',
        '```',
        '',
      ].join('\n'),
    ));

    const answered = runRafa(scratch, scratch.repo, ['skill', 'check', '.claude/skills/false-positives']);

    expect(answered.stderr).not.toContain('the command _ok is in no directory');
    expect(answered.stderr).toContain('the command zzz-fixture-missing-tool-2 is in no directory');
  }, SPAWN_TIMEOUT);

  it('stops reading a single-segment extensioned route as a foreign path, and still refuses a multi-segment one', () => {
    const scratch = plantScratchRepo(tempBase);
    writeFixture(scratch.repo, '.claude/skills/false-positives/http-route/SKILL.md', fileText(
      cleanSkillFields('http-route'),
      [
        '',
        'See `/openapi.json` for the schema.',
        '',
        'Never write `/workspace/project/config.yaml`, a different machine layout.',
        '',
      ].join('\n'),
    ));

    const answered = runRafa(scratch, scratch.repo, ['skill', 'check', '.claude/skills/false-positives']);

    expect(answered.stderr).not.toContain('/openapi.json is an absolute path outside');
    expect(answered.stderr).toContain('/workspace/project/config.yaml is an absolute path outside');
  }, SPAWN_TIMEOUT);
});

describe('rafa skill check --fix, spawned', () => {
  it('fills tags and stack, leaving the body byte for byte', () => {
    const scratch = plantScratchRepo(tempBase);
    const body = '\n# Fixable skill\n\nRun `bun test` and read the exit code.\n\n```ts\nexport const ready = true;\n```\n';
    const path = writeFixture(
      scratch.repo,
      '.claude/skills/fixable/fixable-skill/SKILL.md',
      fileText(['name: fixable-skill', 'description: A skill missing only tags and stack'], body),
    );
    const before = readFileSync(path, 'utf8');
    const bodyBefore = before.slice(before.indexOf('\n---\n') + '\n---\n'.length);

    const answered = runRafa(scratch, scratch.repo, ['skill', 'check', '.claude/skills/fixable', '--fix']);
    const after = readFileSync(path, 'utf8');
    const bodyAfter = after.slice(after.indexOf('\n---\n') + '\n---\n'.length);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout).toContain('(filled tags, stack)');
    expect(after).not.toBe(before);
    expect(after).toContain('tags:');
    expect(after).toContain('stack:');
    expect(bodyAfter).toBe(bodyBefore);
    expect(bodyAfter).toBe(body);
  }, SPAWN_TIMEOUT);
});
