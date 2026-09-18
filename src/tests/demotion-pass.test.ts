/**
 * The demotion pass end to end: `rafa skill demote` and `rafa instinct
 * check`, dispatched together over a planted user scope.
 *
 * `src/demote/apply.test.ts` and `src/commands/skill/demote.test.ts`
 * each cover one half of this — the plan a row comes to, and the words
 * a line reads — but neither dispatches `rafa instinct check` over what
 * `--apply` wrote. This file is the one place the whole pipeline runs
 * as a user would drive it: write, refuse a draft apply, edit a row,
 * review, apply, and check the instincts that apply produced with the
 * command the spec names for checking them, not a re-implementation of
 * its rules here.
 *
 * The scope demoted is a USER scope: the case plants its own home under
 * a temporary directory of this file's own and dispatches inside a
 * project of its own (`./cli-capture.ts`) whose `home` IS that planted
 * home, which is what `resolveDemotionScope` (`../demote/select.ts`)
 * reads to tell a user scope from a project one. Nothing here reads or
 * writes the real `~/.claude/skills`, `~/.rafa/` or `~/.claude`.
 *
 * ## The controls
 *
 *   - **The draft refusal moves nothing.** Held beside the reviewed
 *     apply that DOES move files: a command refusing every apply would
 *     be red on the reviewed one, and one that never refused a draft
 *     red on the first.
 *   - **The edited row is refused beside the two applied clean.** One
 *     row is edited after the draft refusal and two are not, so an
 *     applier ignoring the hash would be red on the edited row and one
 *     refusing the whole run red on the two clean ones.
 *   - **The instinct is checked by `rafa instinct check` itself.** The
 *     command the spec names is dispatched over the instincts directory
 *     `--apply` wrote, and ITS exit code is the reading, not a second
 *     call to `checkFile` from this file.
 *   - **The second apply is read as a tree of sha256 hashes**, taken
 *     before and after: a comparison over a tree nothing ever writes
 *     would pass either way, so the tree is asserted to already hold
 *     the moved and written files from the first apply.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createInstinctCheckCommand } from '../commands/instinct/check.js';
import { createSkillDemoteCommand } from '../commands/skill/demote.js';
import { REVIEWED_STATUS, sourceHash } from '../demote/report.js';
import { parseInstinct } from '../schema/instinct.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

/** The subjects the two dispatched commands route through. */
const SUBJECTS = [
  { name: 'skill', summary: 'run the demotion pass over a skills directory' },
  { name: 'instinct', summary: 'check the records an instincts directory holds' },
];

/** The commands both halves of the pipeline dispatch through. */
const COMMANDS = [createSkillDemoteCommand(), createInstinctCheckCommand()];

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-demotion-pass-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What one case plants: a project to dispatch in, and the home the pass runs over. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home whose `.claude/skills` the case demotes. */
  readonly home: string;
}

/** A body with one Problem and one Solution and no numbered run. */
function observation(name: string, action: string): string {
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
    action,
    '',
  ].join('\n');
}

/** A body with a numbered procedure of three consecutive steps. */
function procedure(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: The release steps, in order.',
    '---',
    '',
    `# ${name}`,
    '',
    '## Problem',
    '',
    'Releases skip a step.',
    '',
    '## Solution',
    '',
    '1. Bump the version.',
    '2. Run the gates.',
    '3. Tag the commit.',
    '',
  ].join('\n');
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

/** Dispatches `words` over the pipeline's commands, inside the planted project. */
async function run(words: readonly string[], tree: Planted) {
  return dispatchInProject(words, SUBJECTS, COMMANDS, tree, { PATH: '' });
}

/** Every file under `dir`, by its posix path relative to it, with its sha256. */
function fileHashes(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      found[relative(dir, path)] = sourceHash(readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

describe('the demotion pass, dispatched end to end over a planted user scope', () => {
  it(
    'refuses a draft apply with nothing moved, refuses a row edited after that, demotes the rest '
    + 'into instincts that pass `instinct check`, leaves the procedure skill untouched, and changes '
    + 'nothing on a second apply',
    async () => {
      const kept = procedure('release-steps');
      const streamShim = observation('stream-shim', 'Read the stream as it comes rather than awaiting the whole text.');
      const quietFlag = observation('quiet-flag', 'Pass --quiet to suppress the progress bar.');
      const staleClone = observation('slow-clone', 'Shallow clone with --depth=1 rather than the whole history.');

      const tree = plant({
        '.claude/skills/release-steps/SKILL.md': kept,
        '.claude/skills/stream-shim/SKILL.md': streamShim,
        '.claude/skills/quiet-flag/SKILL.md': quietFlag,
        '.claude/skills/slow-clone/SKILL.md': staleClone,
      });
      const skillsDir = join(tree.home, '.claude', 'skills');
      const reportPath = join(tree.home, '.rafa', 'demoted', 'report.md');
      const demotedDir = join(tree.home, '.rafa', 'demoted');
      const instinctsDir = join(tree.home, '.rafa', 'instincts');

      // Writing the report classifies every file and moves nothing.
      const written = await run(['skill', 'demote', skillsDir], tree);
      expect(written.exitCode).toBe(0);
      expect(readFileSync(reportPath, 'utf8')).toContain('status: draft');

      // `--apply` on a draft report refuses, and moves nothing at all.
      const refusedDraft = await run(['skill', 'demote', skillsDir, '--apply'], tree);
      expect(refusedDraft.exitCode).toBe(1);
      expect(refusedDraft.stderr).toContain('is still "draft"');
      expect(existsSync(join(skillsDir, 'release-steps', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'stream-shim', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'quiet-flag', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'slow-clone', 'SKILL.md'))).toBe(true);
      expect(existsSync(instinctsDir)).toBe(false);

      // A file is edited after the report refused: its row's hash no longer matches.
      const editedClone = observation('slow-clone', 'Edited after the report was written.');
      writeFileSync(join(skillsDir, 'slow-clone', 'SKILL.md'), editedClone, 'utf8');

      // The report is marked reviewed, as a reviewer would mark it by hand.
      writeFileSync(
        reportPath,
        readFileSync(reportPath, 'utf8').replace('status: draft', `status: ${REVIEWED_STATUS}`),
        'utf8',
      );

      // The reviewed report is applied: two rows demoted, one kept, one refused for its edit.
      const applied = await run(['skill', 'demote', skillsDir, '--apply'], tree);
      expect(applied.exitCode).toBe(1);
      expect(applied.stderr).toContain('changed since the report was written');
      expect(applied.stderr).toContain('2 demoted, 1 kept, 0 left, 0 done, 1 refused');

      // The edited row moved nothing: its file is exactly where the edit left it.
      expect(readFileSync(join(skillsDir, 'slow-clone', 'SKILL.md'), 'utf8')).toBe(editedClone);

      // The procedure skill is untouched: same path, same bytes.
      expect(readFileSync(join(skillsDir, 'release-steps', 'SKILL.md'), 'utf8')).toBe(kept);

      // Each demoted file's original is gone from the skills directory and kept
      // byte-identical to what was planted, under `.rafa/demoted/`.
      expect(existsSync(join(skillsDir, 'stream-shim', 'SKILL.md'))).toBe(false);
      expect(existsSync(join(skillsDir, 'quiet-flag', 'SKILL.md'))).toBe(false);
      expect(readFileSync(join(demotedDir, 'stream-shim', 'SKILL.md'), 'utf8')).toBe(streamShim);
      expect(readFileSync(join(demotedDir, 'quiet-flag', 'SKILL.md'), 'utf8')).toBe(quietFlag);

      // Each demoted file became an instinct that `rafa instinct check` itself passes.
      const checked = await run(['instinct', 'check', instinctsDir], tree);
      expect(checked.exitCode).toBe(0);

      for (const id of ['stream-shim', 'quiet-flag']) {
        const text = readFileSync(join(instinctsDir, `${id}.md`), 'utf8');
        expect(text).toContain('source: demoted');

        const parsed = parseInstinct(text);
        expect(parsed.issues).toEqual([]);
        expect(parsed.instinct).not.toBeNull();
        expect(parsed.instinct?.evidence.length).toBeGreaterThan(0);
        expect(parsed.instinct?.evidence[0]?.['path']).toBe(`${id}/SKILL.md`);
      }

      // A second apply over the same reviewed report changes nothing: the tree is
      // read as a whole before and after, and the two must be equal.
      const before = fileHashes(tree.home);
      const second = await run(['skill', 'demote', skillsDir, '--apply'], tree);
      const after = fileHashes(tree.home);

      expect(second.exitCode).toBe(1); // the edited row stays refused, since nothing fixed it
      expect(second.stderr).toContain('0 demoted, 1 kept, 0 left, 2 done, 1 refused');
      expect(after).toEqual(before);
    },
  );
});
