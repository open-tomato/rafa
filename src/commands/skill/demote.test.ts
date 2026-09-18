/**
 * Tests for `rafa skill demote` (`./demote.ts`): the words it reads off
 * a line, the refusals that stop a run before it looks at a row, and
 * the two halves dispatched end to end.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own and dispatches in-process with
 * streams, an environment and a working directory of its own
 * (`src/tests/cli-capture.ts`), so no case reads the real
 * `~/.claude/skills` and none writes the real `~/.rafa/`. The user
 * scope a case demotes is the planted home's, which is what makes the
 * scope arithmetic measurable at all.
 *
 * ## The controls
 *
 * Two readings here would pass on a command that did nothing:
 *
 *   - **A write moves nothing.** The case asserts the planted skill is
 *     still where it was planted and the instincts directory is absent,
 *     BESIDE the report existing with its counts — a command that wrote
 *     no report would be red on the second.
 *   - **`--apply` refuses a draft.** The case asserts exit code 1 with
 *     nothing moved, beside the SAME tree applied once the header says
 *     `reviewed` and the record written. A command that refused every
 *     apply would be red on the second.
 *
 * `--apply` typed AHEAD of the directory is measured as its own
 * refusal, because `parseArgs` hands the flag the directory as its
 * value, exactly as it does for `rafa skill check --fix`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { REVIEWED_STATUS } from '../../demote/report.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createSkillDemoteCommand, readApply, readDemoteDirectory, verdictLine } from './demote.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'skill', summary: 'run the demotion pass over a skills directory' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-demote-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A body with one Problem and one Solution and no numbered run. */
function observation(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: A single observation worth keeping.',
    '---',
    '',
    `# ${name}`,
    '',
    '## When to Use',
    '',
    'When a spawned child seems to hang with no output at all.',
    '',
    '## Problem',
    '',
    'The stream is buffered, so the parent sees nothing.',
    '',
    '## Solution',
    '',
    'Read the stream as it comes rather than awaiting the whole text.',
    '',
  ].join('\n');
}

/** What one case plants: a project to dispatch in, and the home the pass runs over. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home whose `.claude/skills` the case demotes. */
  readonly home: string;
}

/** Plants one case's tree, the file names taken as paths under the home. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root);
  mkdirSync(home, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(home, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home };
}

/** Dispatches `words` over the command, inside the planted project. */
async function run(words: readonly string[], tree: Planted) {
  return dispatchInProject(words, SUBJECTS, [createSkillDemoteCommand()], tree, { PATH: '' });
}

/** The skills directory of a planted home. */
function skillsOf(tree: Planted): string {
  return join(tree.home, '.claude', 'skills');
}

/** The report of a planted home. */
function reportOf(tree: Planted): string {
  return join(tree.home, '.rafa', 'demoted', 'report.md');
}

describe('the words the line is read as', () => {
  it('reads --apply as a boolean and refuses a value it cannot take', () => {
    expect(readApply(undefined)).toBe(false);
    expect(readApply(true)).toBe(true);
    expect(() => readApply('/home/.claude/skills')).toThrow(CommandExit);
    expect(() => readApply('/home/.claude/skills')).toThrow('type it after the directory');
  });

  it('resolves the directory against the working directory and refuses none and two', () => {
    expect(readDemoteDirectory(['skills'], () => '/work')).toBe('/work/skills');
    expect(() => readDemoteDirectory([], () => '/work')).toThrow('got none');
    expect(() => readDemoteDirectory(['a', 'b'], () => '/work')).toThrow('as a second');
  });

  it('writes the counts of a report as one line', () => {
    expect(verdictLine({ status: 'draft', rows: [] })).toBe('0 file(s): 0 observation, 0 procedure, 0 unclassified');
  });
});

describe('the refusals that stop a run', () => {
  it('refuses a directory that is no .claude/skills', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', join(tree.home, '.claude')], tree);

    expect(run1.exitCode).toBe(1);
    expect(run1.stderr).toContain('is no skills directory');
  });

  it('refuses a .claude/skills that is not there', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', join(tree.home, 'elsewhere', '.claude', 'skills')], tree);

    expect(run1.exitCode).toBe(1);
    expect(run1.stderr).toContain('is not a directory');
  });

  it('refuses --apply typed ahead of the directory, naming the order that works', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', '--apply', skillsOf(tree)], tree);

    expect(run1.exitCode).toBe(1);
    expect(run1.stderr).toContain('type it after the directory');
  });

  it('refuses --apply with no report to apply', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', skillsOf(tree), '--apply'], tree);

    expect(run1.exitCode).toBe(1);
    expect(run1.stderr).toContain('No report at');
  });
});

describe('the write, which moves nothing', () => {
  it('writes the report and leaves the tree exactly as it was', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', skillsOf(tree)], tree);

    expect(run1.exitCode).toBe(0);
    expect(run1.stdout).toContain('1 file(s): 1 observation, 0 procedure, 0 unclassified');
    expect(run1.stdout).toContain('nothing was moved');
    expect(readFileSync(reportOf(tree), 'utf8')).toContain('status: draft');
    expect(existsSync(join(skillsOf(tree), 'one', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tree.home, '.rafa', 'instincts'))).toBe(false);
  });

  it('gives the counts as the result data in json mode', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    const run1 = await run(['skill', 'demote', skillsOf(tree), '--output=json'], tree);
    const result = run1.stdout.split('\n').filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { type: string; data?: { applied?: boolean; scope?: string; files?: number } })
      .find((event) => event.type === 'result');

    expect(run1.exitCode).toBe(0);
    expect(result?.data?.applied).toBe(false);
    expect(result?.data?.scope).toBe('user');
    expect(result?.data?.files).toBe(1);
  });
});

describe('the apply, which acts on a reviewed report alone', () => {
  it('refuses a draft report with nothing moved, and applies the same report once it is reviewed', async () => {
    const tree = plant({ '.claude/skills/one/SKILL.md': observation('one') });
    await run(['skill', 'demote', skillsOf(tree)], tree);

    const refused = await run(['skill', 'demote', skillsOf(tree), '--apply'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('is still "draft"');
    expect(existsSync(join(skillsOf(tree), 'one', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tree.home, '.rafa', 'instincts'))).toBe(false);

    writeFileSync(
      reportOf(tree),
      readFileSync(reportOf(tree), 'utf8').replace('status: draft', `status: ${REVIEWED_STATUS}`),
      'utf8',
    );
    const applied = await run(['skill', 'demote', skillsOf(tree), '--apply'], tree);

    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('1 demoted, 0 kept, 0 left, 0 done, 0 refused');
    expect(existsSync(join(skillsOf(tree), 'one', 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(tree.home, '.rafa', 'instincts', 'one.md'), 'utf8')).toContain('source: demoted');
    expect(readFileSync(join(tree.home, '.rafa', 'demoted', 'one', 'SKILL.md'), 'utf8')).toBe(observation('one'));
  });

  it('exits with the number of rows it refused', async () => {
    const tree = plant({
      '.claude/skills/one/SKILL.md': observation('one'),
      '.claude/skills/two/SKILL.md': observation('two'),
    });
    await run(['skill', 'demote', skillsOf(tree)], tree);
    writeFileSync(
      reportOf(tree),
      readFileSync(reportOf(tree), 'utf8').replace('status: draft', `status: ${REVIEWED_STATUS}`),
      'utf8',
    );
    writeFileSync(join(skillsOf(tree), 'two', 'SKILL.md'), `${observation('two')}\nEdited.\n`, 'utf8');

    const applied = await run(['skill', 'demote', skillsOf(tree), '--apply'], tree);

    expect(applied.exitCode).toBe(1);
    expect(applied.stderr).toContain('changed since the report was written');
    expect(applied.stderr).toContain('1 demoted, 0 kept, 0 left, 0 done, 1 refused');
    expect(existsSync(join(skillsOf(tree), 'two', 'SKILL.md'))).toBe(true);
  });
});
