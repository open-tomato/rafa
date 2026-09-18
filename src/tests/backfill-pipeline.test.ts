/**
 * The backfill pipeline end to end, over a planted user tier and a
 * stand-in `claude` put first on the real PATH: `rafa skill check
 * --fix`, `rafa skill backfill --propose`, a reviewed `--apply` and the
 * derivation it runs after, closing with `rafa skill check` at exit 0
 * with no `--fix` at all.
 *
 * `src/commands/skill/backfill.test.ts` covers the command's own words
 * and refusals through a scripted spawner SEAM. This file is the one
 * place the pass runs through its real door instead
 * (`utils/claude.ts`'s default `spawnClaudeCaptured`), which resolves
 * `claude` off the actual process environment rather than off
 * `dispatchInProject`'s own `env` — so the seam a case controls here is
 * the OS `PATH` itself, prepended in `beforeAll` and restored in
 * `afterAll`. No case spawns the real `claude`.
 *
 * ## The controls
 *
 *   - **An unreadable session answer leaves every row of its one batch
 *     unanswered**, the session's exit code carried in the note, rather
 *     than a row nobody wrote guessed from the ones that did.
 *   - **A draft proposal file is refused whole, with nothing written to
 *     the skill it names.** That skill is planted alone for this step:
 *     an ECC-recognised directory name would give the derivation half
 *     of the SAME apply something to write whatever the proposal half
 *     refused, which would make "nothing is written" the wrong reading
 *     for it. The kotlin skill joins the tier only after, so it reaches
 *     `check --fix` and the proposal pass with no apply having touched
 *     it yet — and is then carried, beside the plain skill, through one
 *     reviewed `--apply` that writes both rows and derives over both
 *     files at once.
 *   - **The kotlin skill alone ends up carrying `paths`.** Its directory
 *     name is the one the derivation's ECC table recognises; the plain
 *     skill beside it gets no `paths` at all, so a run that wrote
 *     `paths` onto every file would be caught here.
 *   - **Every file the pass rewrites is backed up before its first
 *     write**, and every file's BODY — planted, then carried through
 *     the fix and the two applies — stays byte-identical throughout:
 *     only the frontmatter ever changes.
 *   - **The pipeline ends at `rafa skill check` with no `--fix`**,
 *     which is the DoD the whole backfill exists to reach.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { DRAFT_FILE, parseProposalFile, proposalPath, REVIEWED_FILE, UNANSWERED_ROW } from '../backfill/proposal-file.js';
import { createSkillBackfillCommand } from '../commands/skill/backfill.js';
import { createSkillCheckCommand } from '../commands/skill/check.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

/** The subject both dispatched commands route through. */
const SUBJECTS = [{ name: 'skill', summary: 'check and backfill a skills directory' }];

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-backfill-pipeline-')));

/** The directory put first on PATH, holding the stand-in `claude` this file rewrites between calls. */
const binDir = join(tempBase, 'bin');
mkdirSync(binDir, { recursive: true });

/** The real PATH, restored once this file's test has run. */
const REAL_PATH = process.env['PATH'] ?? '';

beforeAll(() => {
  process.env['PATH'] = [binDir, REAL_PATH].join(delimiter);
});

afterAll(() => {
  process.env['PATH'] = REAL_PATH;
  rmSync(tempBase, { recursive: true, force: true });
});

/** Writes the stand-in `claude` the next real spawn on this file's PATH resolves to. */
function writeStandInClaude(script: string): void {
  const claude = join(binDir, 'claude');
  writeFileSync(claude, script, 'utf8');
  chmodSync(claude, 0o755);
}

/** A session that answers nothing readable as YAML, and exits non-zero. */
const UNREADABLE_CLAUDE = [
  '#!/bin/sh',
  'cat >/dev/null',
  'echo \'Sorry, this request could not be completed.\'',
  'exit 3',
  '',
].join('\n');

/**
 * A session that answers every `path:` line of its prompt with one
 * planted row, read straight off its own stdin.
 */
const ANSWERING_CLAUDE = [
  '#!/bin/sh',
  'prompt="$(cat)"',
  'echo \'proposals:\'',
  'printf \'%s\\n\' "$prompt" | grep \'^path: \' | sed \'s/^path: //\' | while IFS= read -r p; do',
  '  printf \'  - path: %s\\n\' "$p"',
  '  printf \'    prevents: a planted skill nobody can tell from its neighbours\\n\'',
  '  printf \'    signal: silent\\n\'',
  '  printf \'    trigger: Use it when the planted shape is in front of you\\n\'',
  'done',
  '',
].join('\n');

/** A skill missing `tags` and `stack`, with a description and a When to Use section, and no judgement field. */
function plantedSkillText(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: the ${name} skill, planted for this case`,
    '---',
    '',
    `# ${name}`,
    '',
    '## When to Use',
    '',
    'When the planted shape is the one in front of you. More prose follows it.',
    '',
  ].join('\n');
}

/** The frontmatter the file at `path` now carries. */
function frontmatterOf(path: string): Readonly<Record<string, unknown>> {
  const document = readFrontmatterDocument(readFileSync(path, 'utf8'));
  if (document === null) throw new Error(`no frontmatter at ${path}`);
  return document.data;
}

/** The body `text` carries, byte for byte. */
function bodyOfText(text: string): string {
  const document = readFrontmatterDocument(text);
  if (document === null) throw new Error('the text carries no frontmatter');
  return document.body;
}

/** The body the file at `path` now carries, byte for byte. */
function bodyOf(path: string): string {
  return bodyOfText(readFileSync(path, 'utf8'));
}

describe('the backfill pipeline, dispatched end to end over a planted user tier', () => {
  it(
    'refuses a draft proposal file, leaves an unreadable session answer unanswered, then fixes, proposes, '
    + 'reviews and applies clean into a tier `skill check` passes with no --fix',
    async () => {
      const kotlinBody = plantedSkillText('kotlin-conventions');
      const widgetBody = plantedSkillText('widget-basics');

      const scope = join(tempBase, 'case-1');
      const root = join(scope, 'project');
      const home = join(scope, 'home');
      const skillsDir = join(home, '.claude', 'skills');
      plantProjectConfig(root);
      mkdirSync(join(skillsDir, 'widget-basics'), { recursive: true });
      writeFileSync(join(skillsDir, 'widget-basics', 'SKILL.md'), widgetBody, 'utf8');
      const tree = { root, home };

      const commands = [
        createSkillCheckCommand({ cwd: () => root }),
        createSkillBackfillCommand({ cwd: () => root }),
      ];
      const run = (words: readonly string[]) => dispatchInProject(words, SUBJECTS, commands, tree, { PATH: '' });

      const backfillDir = join(home, '.rafa', 'backfill');
      const proposalFile = proposalPath(backfillDir, 1);
      const kotlinPath = join(skillsDir, 'kotlin-conventions', 'SKILL.md');
      const widgetPath = join(skillsDir, 'widget-basics', 'SKILL.md');

      // An unreadable session leaves the one row of its one batch unanswered, its exit code in the note.
      // The kotlin skill is not planted yet: its ECC-recognised directory name would give the derivation
      // half of an apply something to write whatever the proposal half refused, which would make "nothing
      // is written" the wrong reading of a draft refusal for it specifically.
      writeStandInClaude(UNREADABLE_CLAUDE);
      const badPropose = await run(['skill', 'backfill', skillsDir, '--propose']);
      expect(badPropose.exitCode).toBe(0);
      expect(badPropose.stdout).toContain('1 unanswered');
      const badFile = parseProposalFile(readFileSync(proposalFile, 'utf8'));
      expect(badFile.file?.status).toBe(DRAFT_FILE);
      expect(badFile.file?.rows).toHaveLength(1);
      for (const row of badFile.file?.rows ?? []) {
        expect(row.status).toBe(UNANSWERED_ROW);
        expect(row.note).toContain('exit 3');
      }

      // A draft proposal file is refused whole: nothing is written to the one skill it names.
      const refusedDraft = await run(['skill', 'backfill', skillsDir, '--apply']);
      expect(refusedDraft.exitCode).toBe(1);
      expect(refusedDraft.stderr).toContain(`review it and mark it ${REVIEWED_FILE}`);
      expect(readFileSync(widgetPath, 'utf8')).toBe(widgetBody);

      // The kotlin skill joins the tier now, so its ECC-recognised name reaches `check --fix` and the
      // proposal pass fresh, with no apply having touched it yet.
      mkdirSync(join(skillsDir, 'kotlin-conventions'), { recursive: true });
      writeFileSync(kotlinPath, kotlinBody, 'utf8');

      // `check --fix` fills the two fields inference can answer, and the run itself exits clean.
      const fixed = await run(['skill', 'check', skillsDir, '--fix']);
      expect(fixed.exitCode).toBe(0);
      const kotlinAfterFix = readFileSync(kotlinPath, 'utf8');
      const widgetAfterFix = readFileSync(widgetPath, 'utf8');
      expect(frontmatterOf(kotlinPath)['stack']).toEqual(['agnostic']);
      expect(frontmatterOf(widgetPath)['stack']).toEqual(['agnostic']);

      // A working session answers both files; the pass writes a fresh draft over the unreadable one.
      writeStandInClaude(ANSWERING_CLAUDE);
      const goodPropose = await run(['skill', 'backfill', skillsDir, '--propose']);
      expect(goodPropose.exitCode).toBe(0);
      expect(goodPropose.stdout).toContain('0 unanswered');
      const goodFile = parseProposalFile(readFileSync(proposalFile, 'utf8'));
      expect(goodFile.file?.status).toBe(DRAFT_FILE);
      for (const row of goodFile.file?.rows ?? []) {
        expect(row.prevents).toBe('a planted skill nobody can tell from its neighbours');
        expect(row.signal).toBe('silent');
      }

      // The reviewer marks the file reviewed; the apply writes the rows and then derives over them.
      writeFileSync(
        proposalFile,
        readFileSync(proposalFile, 'utf8').replace(`status: ${DRAFT_FILE}`, `status: ${REVIEWED_FILE}`),
        'utf8',
      );
      const applied = await run(['skill', 'backfill', skillsDir, '--apply']);
      expect(applied.exitCode).toBe(0);
      expect(applied.stdout).toContain('2 row(s): 2 applied, 0 unchanged, 0 unanswered, 0 refused');
      expect(applied.stdout).toContain('2 file(s): 2 derived, 0 unchanged, 0 skipped, 0 refused');
      expect(applied.stdout).toContain('2 file(s) copied under');

      // The kotlin skill directory name gave the derivation `paths`; the plain skill got none.
      const kotlinFront = frontmatterOf(kotlinPath);
      expect(kotlinFront['stack']).toEqual(['kotlin']);
      expect(kotlinFront['paths']).toEqual(['**/*.kt', '**/*.kts']);
      const widgetFront = frontmatterOf(widgetPath);
      expect(widgetFront['stack']).toEqual(['agnostic']);
      expect(widgetFront['paths']).toBeUndefined();

      // Every rewritten file was backed up before its first write, and every body stayed byte-identical.
      const kotlinBackup = join(home, '.rafa', 'backfill', 'backup', 'kotlin-conventions', 'SKILL.md');
      const widgetBackup = join(home, '.rafa', 'backfill', 'backup', 'widget-basics', 'SKILL.md');
      expect(readFileSync(kotlinBackup, 'utf8')).toBe(kotlinAfterFix);
      expect(readFileSync(widgetBackup, 'utf8')).toBe(widgetAfterFix);
      expect(bodyOf(kotlinPath)).toBe(bodyOfText(kotlinBody));
      expect(bodyOf(widgetPath)).toBe(bodyOfText(widgetBody));
      expect(bodyOf(kotlinBackup)).toBe(bodyOf(kotlinPath));
      expect(bodyOf(widgetBackup)).toBe(bodyOf(widgetPath));

      // The pipeline ends where the spec's DoD does: a clean check, with no --fix needed at all.
      const clean = await run(['skill', 'check', skillsDir]);
      expect(clean.exitCode).toBe(0);
    },
  );
});
