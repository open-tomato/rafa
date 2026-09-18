/**
 * Tests for the ordered checker.
 *
 * Every case plants its own skills directory, its own instincts
 * directory, its own consuming project and its own `PATH` directory
 * under this file's temporary directory. Nothing here reads this
 * checkout, the machine home or the real `PATH`, and nothing spawns
 * anything: the `PATH` seam is a planted directory holding a file that
 * is executable, and the project seam is a planted tree.
 *
 * ## Every reading is paired
 *
 * A file reported as failing is only a reading about a rule when the
 * near-identical file beside it is reported clean. So the four-stage
 * case has a twin with all four faults repaired and no issues at all,
 * the `--fix` refusal has a twin that fixes, the project seam is
 * measured by resolving ONE body against two planted projects, and the
 * cap is measured at 255 with a 256-file directory beside a 3-file one.
 *
 * ## What is measured here and what is not
 *
 * The four check modules own their own rules and their own tests. What
 * this file measures is what only the checker can be wrong about: that
 * all five stages run over a file that already failed an earlier one,
 * that the issues come back in {@link CHECK_STAGES} order, that the
 * `stack` the frontmatter declares reaches the reference checker's
 * seam (dropping that one wiring reddens the off-stack case, driven on
 * 2026-09-18), that a file
 * with four faults counts ONCE, that a warning never counts, that the
 * count is capped, and that `--fix` writes exactly two fields and not
 * one byte of a body.
 */
import type { CheckIssue, CheckReport } from './run.js';

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { REFERENCE_ISSUE_CODES } from './references.js';
import {
  CHECKER_ISSUE_CODES,
  CHECK_STAGES,
  FAILING_FILE_CAP,
  FIXABLE_FIELDS,
  checkDirectory,
  checkFile,
  failureExitCode,
  fileEntry,
  fixableFields,
  hasCheckFailure,
  inferredStack,
  inferredTags,
  LOCALITY_CODES,
} from './run.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-check-run-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/**
 * Plants a tree and answers its root. A key ending in `/` is an empty
 * directory, a key opening with `+` is an executable file, and every
 * other key is a plain file holding its value.
 */
function plant(files: Readonly<Record<string, string>>): string {
  planted += 1;
  const root = join(tempBase, `case-${planted}`);
  mkdirSync(root, { recursive: true });
  for (const [key, text] of Object.entries(files)) {
    const executable = key.startsWith('+');
    const name = executable
      ? key.slice(1)
      : key;
    const path = join(root, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    if (executable) chmodSync(path, 0o755);
  }
  return root;
}

/** A skill file: the frontmatter lines given, then the body given. */
function skillText(lines: readonly string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** The four required fields, filled with values every check accepts. */
const CLEAN_SKILL_FIELDS: readonly string[] = [
  'name: verification-loop',
  'description: Run the gates in order and read each exit code',
  'tags: [verification, gates]',
  'stack: [agnostic]',
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

/** The seams a run with neither a project nor a PATH resolves against. */
const BARE = { projectRoot: null, pathDirs: [] } as const;

/** Every issue as `stage/code`, which is what the order cases read. */
function marks(report: CheckReport): string[] {
  return report.issues.map((issue) => `${issue.stage}/${issue.code}`);
}

/** Every issue of a whole directory as `stage/code`. */
function directoryMarks(reports: readonly CheckReport[]): string[] {
  return reports.flatMap((report) => marks(report));
}

describe('a clean skill', () => {
  const root = plant({
    'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    'project/src/there.ts': 'export const there = 1;\n',
    '+bin/mytool': '#!/bin/sh\n',
  });
  const path = join(root, 'skills/verification-loop/SKILL.md');

  it('passes every check with no issues at all', () => {
    const report = checkFile(path, 'skill', BARE);

    expect(report.issues).toEqual([]);
    expect(report.failed).toBe(false);
    expect(report.fixed).toEqual([]);
    expect(report.isFile).toBe(true);
    expect(report.name).toBe('verification-loop');
  });

  it('fails once a body path, a tool and an absolute path go wrong', () => {
    const broken = plant({
      'skills/verification-loop/SKILL.md': skillText(
        CLEAN_SKILL_FIELDS,
        '\nRead `src/gone.ts` and `/Users/someone/notes.md`.\n\n```bash\nnosuchtool run\n```\n',
      ),
      'project/': '',
    });
    const report = checkFile(
      join(broken, 'skills/verification-loop/SKILL.md'),
      'skill',
      { projectRoot: join(broken, 'project'), pathDirs: [] },
    );

    expect(marks(report)).toEqual([
      'resolution/unresolved-path',
      'resolution/missing-tool',
      'locality/home-path',
    ]);
    expect(report.failed).toBe(true);
  });
});

describe('a skill failing four checks at once', () => {
  const body = '\nRead `src/gone.ts` and `/Users/someone/notes.md`.\n';
  const faults: readonly string[] = [
    'name: another-name',
    `description: ${'x'.repeat(140)}`,
    'tags: [verification]',
    'stack: [agnostic]',
  ];
  const root = plant({
    'skills/verification-loop/SKILL.md': skillText(faults, body),
    'project/': '',
  });
  const options = { projectRoot: join(root, 'project'), pathDirs: [] };
  const report = checkFile(join(root, 'skills/verification-loop/SKILL.md'), 'skill', options);

  it('runs every later check although the first one already failed', () => {
    expect(marks(report)).toEqual([
      'layout/name-mismatch',
      'schema/description-too-long',
      'resolution/unresolved-path',
      'locality/home-path',
    ]);
  });

  it('reports the four stages in the order the checks run', () => {
    const order = report.issues.map((issue) => CHECK_STAGES.indexOf(issue.stage));

    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('counts the file once for its four faults', () => {
    const directory = checkDirectory(join(root, 'skills'), 'skill', options);

    expect(directory.failingFiles).toBe(1);
    expect(directory.exitCode).toBe(1);
  });

  it('reports nothing at all once the same four faults are repaired', () => {
    const repaired = plant({
      'skills/verification-loop/SKILL.md': skillText(
        CLEAN_SKILL_FIELDS,
        '\nRead `src/there.ts`.\n',
      ),
      'project/src/there.ts': 'export const there = 1;\n',
    });
    const report2 = checkFile(
      join(repaired, 'skills/verification-loop/SKILL.md'),
      'skill',
      { projectRoot: join(repaired, 'project'), pathDirs: [] },
    );

    expect(report2.issues).toEqual([]);
  });
});

describe('the project, skill and PATH seams', () => {
  const body = '\nRead `src/there.ts`, then run `./helper.sh`.\n\n```bash\nmytool run\n```\n';
  const files = {
    'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, body),
    'skills/verification-loop/helper.sh': '#!/bin/sh\n',
    'with/src/there.ts': 'export const there = 1;\n',
    'without/': '',
    '+bin/mytool': '#!/bin/sh\n',
  };
  const root = plant(files);
  const path = join(root, 'skills/verification-loop/SKILL.md');

  it('resolves the same body clean against one planted project', () => {
    const report = checkFile(path, 'skill', {
      projectRoot: join(root, 'with'),
      pathDirs: [join(root, 'bin')],
    });

    expect(report.issues).toEqual([]);
  });

  it('fails the same body against the project beside it that lacks the file', () => {
    const report = checkFile(path, 'skill', {
      projectRoot: join(root, 'without'),
      pathDirs: [join(root, 'bin')],
    });

    expect(marks(report)).toEqual(['resolution/unresolved-path']);
  });

  it('fails the tool once the PATH it was given holds nothing', () => {
    const report = checkFile(path, 'skill', { projectRoot: join(root, 'with'), pathDirs: [] });

    expect(marks(report)).toEqual(['resolution/missing-tool']);
  });

  it('counts a project path as a warning when the run has no project root', () => {
    const report = checkFile(path, 'skill', {
      projectRoot: null,
      pathDirs: [join(root, 'bin')],
    });

    expect(marks(report)).toEqual(['resolution/unchecked-path']);
    expect(report.failed).toBe(false);
  });
});

describe('a missing tool off the machine stack', () => {
  /**
   * The one body all three readings share: a fenced command naming a
   * tool no planted `PATH` directory holds, and nothing else any check
   * can refuse. Only the `stack` line above it differs between the
   * three files.
   */
  const body = '\n# Perl gates\n\nRun the gate:\n\n```bash\ncpanm --installdeps .\n```\n';

  /** `CLEAN_SKILL_FIELDS` with its `stack` line replaced or dropped. */
  function fields(stack: string | null): readonly string[] {
    const rest = CLEAN_SKILL_FIELDS.filter((line) => !line.startsWith('stack:'));
    return stack === null
      ? rest
      : [...rest, `stack: ${stack}`];
  }

  const root = plant({
    'off/verification-loop/SKILL.md': skillText(fields('[perl]'), body),
    'agnostic/verification-loop/SKILL.md': skillText(fields('[agnostic]'), body),
    'none/verification-loop/SKILL.md': skillText(fields(null), body),
  });

  /** The report on one of the three planted tiers, with an empty PATH. */
  function read(tier: string): CheckReport {
    return checkFile(join(root, tier, 'verification-loop/SKILL.md'), 'skill', BARE);
  }

  it('warns instead of failing when the frontmatter declares a stack of its own', () => {
    const report = read('off');
    const directory = checkDirectory(join(root, 'off'), 'skill', BARE);

    expect(marks(report)).toEqual(['resolution/missing-tool-off-stack']);
    expect(report.issues[0]?.severity).toBe('warning');
    expect(report.issues[0]?.message).toContain('cpanm');
    expect(report.failed).toBe(false);
    expect(directory.failingFiles).toBe(0);
    expect(directory.exitCode).toBe(0);
  });

  it('fails the same body when the stack is agnostic', () => {
    const report = read('agnostic');
    const directory = checkDirectory(join(root, 'agnostic'), 'skill', BARE);

    expect(marks(report)).toEqual(['resolution/missing-tool']);
    expect(report.issues[0]?.severity).toBe('failure');
    expect(report.failed).toBe(true);
    expect(directory.exitCode).toBe(1);
  });

  it('fails the same body when the frontmatter declares no stack at all', () => {
    const report = read('none');

    expect(marks(report)).toEqual(['schema/missing-field', 'resolution/missing-tool']);
    expect(report.failed).toBe(true);
  });
});

describe('the resolution and locality split', () => {
  it('sends every reference code to one stage and only these two to locality', () => {
    expect(LOCALITY_CODES).toEqual(['home-path', 'foreign-path']);
    for (const code of LOCALITY_CODES) {
      expect(REFERENCE_ISSUE_CODES).toContain(code);
    }
  });

  it.each([
    ['`src/gone.ts`', 'resolution/unresolved-path'],
    ['`scripts/gone.sh`', 'resolution/missing-script'],
    ['`/Users/someone/notes.md`', 'locality/home-path'],
    ['`/nowhere/notes.md`', 'locality/foreign-path'],
  ])('reads %s as %s', (span, mark) => {
    const root = plant({
      'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, `\nRead ${span}.\n`),
      'skills/verification-loop/scripts/there.sh': '#!/bin/sh\n',
      'project/': '',
    });
    const report = checkFile(join(root, 'skills/verification-loop/SKILL.md'), 'skill', {
      projectRoot: join(root, 'project'),
      pathDirs: [],
    });

    expect(marks(report)).toEqual([mark]);
  });
});

describe('an instinct record', () => {
  it('passes every check when its frontmatter and both sections are right', () => {
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md':
        skillText(CLEAN_INSTINCT_FIELDS, INSTINCT_BODY),
    });
    const report = checkFile(
      join(root, 'instincts/bun-install-after-worktree-fork.md'),
      'instinct',
      BARE,
    );

    expect(report.issues).toEqual([]);
  });

  it('fails a task-report record whose evidence is empty, at the instinct stage', () => {
    const fields = CLEAN_INSTINCT_FIELDS.filter((line) => !/^(evidence|\s)/.test(line));
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md':
        skillText([...fields, 'evidence: []'], INSTINCT_BODY),
    });
    const report = checkFile(
      join(root, 'instincts/bun-install-after-worktree-fork.md'),
      'instinct',
      BARE,
    );

    expect(marks(report)).toEqual(['instinct/missing-evidence']);
    expect(report.issues[0]?.field).toBe('evidence');
  });

  it('reports an id that is not the file stem at the layout stage, before the body', () => {
    const fields = CLEAN_INSTINCT_FIELDS.map((line) => (line.startsWith('id:')
      ? 'id: another-id'
      : line));
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md': skillText(fields, '\n## Action\nGo.\n'),
    });
    const report = checkFile(
      join(root, 'instincts/bun-install-after-worktree-fork.md'),
      'instinct',
      BARE,
    );

    expect(marks(report)).toEqual(['layout/name-mismatch', 'instinct/missing-section']);
  });

  it('resolves a record body against the project too', () => {
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md': skillText(
        CLEAN_INSTINCT_FIELDS,
        `${INSTINCT_BODY}\nSee \`src/gone.ts\`.\n`,
      ),
      'project/': '',
    });
    const report = checkFile(
      join(root, 'instincts/bun-install-after-worktree-fork.md'),
      'instinct',
      { projectRoot: join(root, 'project'), pathDirs: [] },
    );

    expect(marks(report)).toEqual(['resolution/unresolved-path']);
  });

  it('runs no skill schema over a record and no instinct schema over a skill', () => {
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md':
        skillText(CLEAN_INSTINCT_FIELDS, INSTINCT_BODY),
      'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    });
    const asSkill = checkFile(
      join(root, 'instincts/bun-install-after-worktree-fork.md'),
      'skill',
      BARE,
    );
    const asInstinct = checkFile(join(root, 'skills/verification-loop/SKILL.md'), 'instinct', BARE);

    expect(marks(asSkill).every((mark) => mark.startsWith('schema/') || mark === 'layout/unregistered-path')).toBe(true);
    expect(marks(asInstinct).every((mark) => mark.startsWith('instinct/'))).toBe(true);
  });
});

describe('a whole directory', () => {
  const root = plant({
    'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    'skills/learned/one-observation.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    'skills/group/nested/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    'skills/dotted/.DS_Store': '',
    'skills/empty-skill/notes.txt': 'nothing\n',
  });
  const directory = checkDirectory(join(root, 'skills'), 'skill', BARE);

  it('names the two silent layouts and the two directories that register nothing', () => {
    expect(directoryMarks(directory.reports).sort()).toEqual([
      'layout/dotfile-only-directory',
      'layout/flat-grouped-layout',
      'layout/missing-skill-file',
      'layout/name-mismatch',
      'layout/name-mismatch',
      'layout/nested-group-layout',
    ]);
  });

  it('counts the failing entries and never the dotfile-only warning', () => {
    const warnings = directory.reports.filter(
      (report) => report.issues.length > 0 && !report.failed,
    );

    expect(directory.reports.filter((report) => report.failed).map((report) => marks(report)))
      .toEqual([
        ['layout/missing-skill-file'],
        ['layout/nested-group-layout', 'layout/name-mismatch'],
        ['layout/flat-grouped-layout', 'layout/name-mismatch'],
      ]);
    expect(directory.failingFiles).toBe(3);
    expect(directory.exitCode).toBe(3);
    expect(warnings.map((report) => marks(report))).toEqual([['layout/dotfile-only-directory']]);
  });

  it('opens no file for an entry that is not one', () => {
    const notFiles = directory.reports.filter((report) => !report.isFile);

    expect(notFiles.map((report) => marks(report)).sort()).toEqual([
      ['layout/dotfile-only-directory'],
      ['layout/missing-skill-file'],
    ]);
  });

  it('throws rather than answering an empty scan for a directory that is not there', () => {
    expect(() => checkDirectory(join(root, 'absent'), 'skill', BARE)).toThrow('no skill directory');
  });

  it('skips the Learning adapter NDJSON files beside the records', () => {
    const scope = plant({
      'instincts/bun-install-after-worktree-fork.md':
        skillText(CLEAN_INSTINCT_FIELDS, INSTINCT_BODY),
      'instincts/instincts.ndjson': '{"id":"x"}\n',
      'instincts/flags.ndjson': '{"id":"y"}\n',
    });
    const answered = checkDirectory(join(scope, 'instincts'), 'instinct', BARE);

    expect(answered.reports.map((report) => report.name)).toEqual([
      'bun-install-after-worktree-fork',
    ]);
    expect(answered.failingFiles).toBe(0);
  });
});

describe('the failing-file count', () => {
  it.each([
    [0, 0],
    [1, 1],
    [254, 254],
    [255, 255],
    [256, 255],
    [4000, 255],
  ])('answers %d failing files as exit code %d', (count, code) => {
    expect(failureExitCode(count)).toBe(code);
  });

  it('caps a directory of 256 failing skills at 255 and says how many there were', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 256; index += 1) {
      const name = `skill-${String(index).padStart(3, '0')}`;
      files[`skills/${name}/SKILL.md`] = skillText(['name: wrong-name'], PLAIN_BODY);
    }
    const root = plant(files);
    const directory = checkDirectory(join(root, 'skills'), 'skill', BARE);

    expect(directory.reports).toHaveLength(256);
    expect(directory.failingFiles).toBe(256);
    expect(directory.exitCode).toBe(FAILING_FILE_CAP);
  });

  it('leaves a directory of three failing skills uncapped', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 3; index += 1) {
      files[`skills/skill-${index}/SKILL.md`] = skillText(['name: wrong-name'], PLAIN_BODY);
    }
    const root = plant(files);

    expect(checkDirectory(join(root, 'skills'), 'skill', BARE).exitCode).toBe(3);
  });
});

describe('--fix', () => {
  /** A skill lacking both fixable fields, with a body naming a language. */
  const missingBoth: readonly string[] = [
    'name: drizzle-migration-traps',
    'description: Traps in hand-written migrations',
    'origin: auto-extracted',
  ];
  const fixBody = '\n# Traps\n\n```ts\nconst a = 1;\n```\n\nTrailing spaces stay:   \n';

  it('fills both fields, leaves the body byte for byte, and re-checks what it wrote', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(missingBoth, fixBody),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    const before = readFileSync(path, 'utf8');
    const report = checkFile(path, 'skill', { ...BARE, fix: true });
    const after = readFileSync(path, 'utf8');

    expect(report.fixed).toEqual(['tags', 'stack']);
    expect(report.issues).toEqual([]);
    expect(after).not.toBe(before);
    expect(after.slice(after.indexOf('\n---\n') + '\n---\n'.length)).toBe(fixBody);
  });

  it('writes tags from the name and the body, and stack from the body', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(missingBoth, fixBody),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    checkFile(path, 'skill', { ...BARE, fix: true });
    const written = readFileSync(path, 'utf8');

    expect(written).toContain('tags:\n  - drizzle\n  - migration\n  - traps\n  - typescript\n');
    expect(written).toContain('stack:\n  - typescript\n');
    expect(written).toContain('origin: auto-extracted');
  });

  it('fills only the one field that is missing', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(
        [...missingBoth, 'tags: [drizzle, migrations]'],
        fixBody,
      ),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    const report = checkFile(path, 'skill', { ...BARE, fix: true });

    expect(report.fixed).toEqual(['stack']);
    expect(readFileSync(path, 'utf8')).toContain('tags:\n  - drizzle\n  - migrations\n');
  });

  it('writes agnostic for a body that names no language', () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': skillText(
        ['name: verification-loop', 'description: Run the gates in order'],
        PLAIN_BODY,
      ),
    });
    const path = join(root, 'skills/verification-loop/SKILL.md');
    checkFile(path, 'skill', { ...BARE, fix: true });

    expect(readFileSync(path, 'utf8')).toContain('stack:\n  - agnostic\n');
  });

  it('refuses a file with any other failure and leaves every byte alone', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(
        [...missingBoth, `description: ${'x'.repeat(140)}`],
        fixBody,
      ),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    const before = readFileSync(path, 'utf8');
    const report = checkFile(path, 'skill', { ...BARE, fix: true });

    expect(report.fixed).toEqual([]);
    expect(marks(report)).toContain('schema/description-too-long');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('fixes anyway when the only other issue is a warning', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(
        missingBoth,
        `${fixBody}\nRead \`src/somewhere.ts\`.\n`,
      ),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    const report = checkFile(path, 'skill', { ...BARE, fix: true });

    expect(report.fixed).toEqual(['tags', 'stack']);
    expect(marks(report)).toEqual(['resolution/unchecked-path']);
  });

  it('writes nothing for a file that already passes', () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    });
    const path = join(root, 'skills/verification-loop/SKILL.md');
    const before = readFileSync(path, 'utf8');
    const report = checkFile(path, 'skill', { ...BARE, fix: true });

    expect(report.fixed).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('writes nothing without the switch, for the same file it would fix with it', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(missingBoth, fixBody),
    });
    const path = join(root, 'skills/drizzle-migration-traps/SKILL.md');
    const before = readFileSync(path, 'utf8');
    const report = checkFile(path, 'skill', BARE);

    expect(report.fixed).toEqual([]);
    expect(report.failed).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('never rewrites an instinct record', () => {
    const fields = CLEAN_INSTINCT_FIELDS.filter((line) => !/^(evidence|\s)/.test(line));
    const root = plant({
      'instincts/bun-install-after-worktree-fork.md':
        skillText([...fields, 'evidence: []'], INSTINCT_BODY),
    });
    const path = join(root, 'instincts/bun-install-after-worktree-fork.md');
    const before = readFileSync(path, 'utf8');
    const report = checkFile(path, 'instinct', { ...BARE, fix: true });

    expect(report.fixed).toEqual([]);
    expect(report.failed).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('fixes every fixable file of a directory and leaves the rest failing', () => {
    const root = plant({
      'skills/drizzle-migration-traps/SKILL.md': skillText(missingBoth, fixBody),
      'skills/verification-loop/SKILL.md': skillText(
        ['name: verification-loop', `description: ${'x'.repeat(140)}`],
        PLAIN_BODY,
      ),
    });
    const directory = checkDirectory(join(root, 'skills'), 'skill', { ...BARE, fix: true });

    expect(directory.reports.map((report) => report.fixed)).toEqual([['tags', 'stack'], []]);
    expect(directory.failingFiles).toBe(1);
  });
});

describe('fixableFields', () => {
  /** An issue with only the fields the rule reads. */
  function issue(partial: Partial<CheckIssue>): CheckIssue {
    return {
      stage: 'schema',
      code: 'missing-field',
      severity: 'failure',
      field: 'tags',
      line: null,
      message: 'tags is required and is absent',
      ...partial,
    };
  }

  it('answers the two fields in a fixed order whatever order they came in', () => {
    const found = fixableFields([issue({ field: 'stack' }), issue({ field: 'tags' })]);

    expect(found).toEqual(['tags', 'stack']);
    expect(FIXABLE_FIELDS).toEqual(['tags', 'stack']);
  });

  it('answers null for a file with nothing wrong', () => {
    expect(fixableFields([])).toBeNull();
  });

  it('answers null for another missing field', () => {
    expect(fixableFields([issue({ field: 'description' })])).toBeNull();
  });

  it('answers null for another rule on a fixable field', () => {
    expect(fixableFields([issue({ code: 'wrong-type' })])).toBeNull();
  });

  it('answers null for a missing-field the instinct schema reported', () => {
    expect(fixableFields([issue({ stage: 'instinct' })])).toBeNull();
  });

  it('ignores a warning beside the two fields', () => {
    const warning = issue({
      stage: 'resolution',
      code: 'unchecked-path',
      severity: 'warning',
      field: null,
    });

    expect(fixableFields([issue({}), warning])).toEqual(['tags']);
  });
});

describe('a path checked outside a directory scan', () => {
  const root = plant({
    'skills/learned/one-observation.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
    'skills/verification-loop/SKILL.md': skillText(CLEAN_SKILL_FIELDS, PLAIN_BODY),
  });

  it('refuses a skill that is not a SKILL.md, which registers nowhere', () => {
    const report = checkFile(join(root, 'skills/learned/one-observation.md'), 'skill', BARE);

    expect(marks(report)).toContain('layout/unregistered-path');
  });

  it('names the flat grouped layout instead when the scan classified it', () => {
    const directory = checkDirectory(join(root, 'skills'), 'skill', BARE);
    const flat = directory.reports.find((report) => report.path.endsWith('one-observation.md'));

    expect(marks(flat as CheckReport)).toContain('layout/flat-grouped-layout');
    expect(marks(flat as CheckReport)).not.toContain('layout/unregistered-path');
  });

  it('takes a skill name from the directory and a record name from the stem', () => {
    expect(fileEntry(join(root, 'skills/verification-loop/SKILL.md'), 'skill').name)
      .toBe('verification-loop');
    expect(fileEntry(join(root, 'instincts/some-id.md'), 'instinct').name).toBe('some-id');
  });

  it('refuses a record that is not markdown', () => {
    const scope = plant({ 'instincts/instincts.ndjson': '{"id":"x"}\n' });
    const report = checkFile(join(scope, 'instincts/instincts.ndjson'), 'instinct', BARE);

    expect(marks(report)).toContain('layout/unregistered-path');
  });
});

describe('the codes the checker owns', () => {
  it('names exactly three, each provoked by a case here', () => {
    expect(CHECKER_ISSUE_CODES).toEqual([
      'unreadable-file',
      'missing-frontmatter',
      'unregistered-path',
    ]);
  });

  it('reports a file that cannot be read at all', () => {
    const root = plant({ 'skills/': '' });
    const report = checkFile(join(root, 'skills/absent/SKILL.md'), 'skill', BARE);

    expect(marks(report)).toEqual(['layout/unreadable-file']);
    expect(report.failed).toBe(true);
  });

  it('reports a skill with no frontmatter block, and still reads its body', () => {
    const root = plant({
      'skills/verification-loop/SKILL.md': '# No frontmatter\n\nRead `/Users/someone/notes.md`.\n',
      'project/': '',
    });
    const report = checkFile(join(root, 'skills/verification-loop/SKILL.md'), 'skill', {
      projectRoot: join(root, 'project'),
      pathDirs: [],
    });

    expect(marks(report)).toEqual(['schema/missing-frontmatter', 'locality/home-path']);
  });
});

describe('the stage list and the severity rule', () => {
  it('holds the five checks in the order the spec runs them', () => {
    expect(CHECK_STAGES).toEqual(['layout', 'schema', 'resolution', 'locality', 'instinct']);
  });

  it('reads a list holding only warnings as no failure', () => {
    const warning: CheckIssue = {
      stage: 'resolution',
      code: 'unchecked-path',
      severity: 'warning',
      field: null,
      line: 3,
      message: 'line 3: src/x.ts was not resolved',
    };

    expect(hasCheckFailure([])).toBe(false);
    expect(hasCheckFailure([warning])).toBe(false);
    expect(hasCheckFailure([warning, { ...warning, severity: 'failure' }])).toBe(true);
  });
});

describe('the inference --fix writes with', () => {
  it('reads the languages of a body and falls back to agnostic', () => {
    expect(inferredStack('```ts\nconst a = 1;\n```\n')).toEqual(['typescript']);
    expect(inferredStack('Nothing but prose.\n')).toEqual(['agnostic']);
  });

  it('takes tags from the name tokens, then the body stacks, each once', () => {
    expect(inferredTags('drizzle-migration-traps', '```ts\nconst a = 1;\n```\n'))
      .toEqual(['drizzle', 'migration', 'traps', 'typescript']);
    expect(inferredTags('typescript-gates', '```ts\nconst a = 1;\n```\n'))
      .toEqual(['typescript', 'gates']);
    expect(inferredTags('verification-loop', 'Nothing but prose.\n'))
      .toEqual(['verification', 'loop']);
  });
});
