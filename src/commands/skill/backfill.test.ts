/**
 * Tests for `rafa skill backfill` (`./backfill.ts`): the words it reads
 * off a line, the refusals that stop a run before it opens a file, and
 * the three halves dispatched end to end.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own and dispatches in-process with
 * streams, an environment and a working directory of its own
 * (`src/tests/cli-capture.ts`), so no case reads the real
 * `~/.claude/skills` and none writes the real `~/.rafa/`. NO case
 * spawns `claude`: the command takes its spawner as a seam, and every
 * session here answers from a script.
 *
 * ## The controls
 *
 * Four readings here would pass on a command that did nothing:
 *
 *   - **A plan writes nothing.** The case asserts the planted skill is
 *     byte-identical and `<home>/.rafa` is absent, BESIDE the counts on
 *     stdout naming the file it would derive — a command that read
 *     nothing would be red on the second.
 *   - **`--propose` touches no skill**, beside the proposal file it
 *     wrote with its row in it.
 *   - **`--apply` refuses a draft**, beside the SAME rows applied once
 *     the header says `reviewed`, so the refusal cannot be an apply
 *     that writes nothing.
 *   - **A backup is taken**, and its bytes are asserted to be the
 *     file's BEFORE the write, beside the rewritten file that differs
 *     from them.
 *
 * `--propose` typed AHEAD of the directory is measured as its own
 * refusal, because `parseArgs` hands the flag the directory as its
 * value, exactly as it does for `rafa skill check --fix`.
 */
import type { CapturedSession, CapturingSpawner } from '../../utils/claude.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { DRAFT_FILE, REVIEWED_FILE } from '../../backfill/proposal-file.js';
import { CommandExit } from '../../cli/command.js';
import { readFrontmatterDocument } from '../../schema/frontmatter.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import {
  backfillScopeOf,
  createSkillBackfillCommand,
  readBackfillDirectory,
  readConsumerRoot,
  readMode,
  readSwitch,
} from './backfill.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'skill', summary: 'backfill a skills directory' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-backfill-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A skill with a `description` and a "When to Use" section, and no judgement field. */
function skillText(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: the ${name} skill, planted for this case`,
    'tags:',
    '  - planted',
    'stack:',
    '  - agnostic',
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

/** What one case plants: a project to dispatch in, and the home the backfill runs over. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home whose `.claude/skills` the case backfills. */
  readonly home: string;
  /** `<home>/.claude/skills`. */
  readonly skills: string;
}

/** Plants one case's tree: a project, a home, and one skill per name. */
function plant(names: readonly string[]): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const skills = join(home, '.claude', 'skills');
  plantProjectConfig(root);
  for (const name of names) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), skillText(name), 'utf8');
  }
  return { root, home, skills };
}

/** Every path the prompt lists, in the order it lists them. */
function promptPaths(prompt: string): readonly string[] {
  return [...prompt.matchAll(/^path: (.+)$/gm)].map((match) => match[1] ?? '');
}

/** A spawner answering every file of its prompt, recording each prompt it was handed. */
function scriptedSpawner(): { prompts: string[]; spawn: CapturingSpawner } {
  const prompts: string[] = [];
  const spawn: CapturingSpawner = (_args, prompt) => {
    prompts.push(prompt);
    const rows = promptPaths(prompt).map((path) => [
      `  - path: ${path}`,
      '    prevents: a planted skill nobody can tell from its neighbours',
      '    signal: silent',
      '    trigger: Use it when the planted shape is in front of you',
    ].join('\n'));
    const session: CapturedSession = {
      exitCode: 0,
      stdout: ['```yaml', 'proposals:', ...rows, '```', ''].join('\n'),
    };
    return Promise.resolve(session);
  };
  return { prompts, spawn };
}

/** Dispatches `words` over the command, inside the planted project. */
async function run(words: readonly string[], tree: Planted, spawn?: CapturingSpawner) {
  const command = createSkillBackfillCommand({ cwd: () => tree.root, spawn });
  return dispatchInProject(words, SUBJECTS, [command], tree, { PATH: '' });
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

/** The one proposal file a `--propose` run wrote. */
function proposalOf(tree: Planted): string {
  return join(tree.home, '.rafa', 'backfill', 'proposals-01.yaml');
}

/** Marks every proposal file of the tree reviewed. */
function review(tree: Planted): void {
  const path = proposalOf(tree);
  writeFileSync(path, readFileSync(path, 'utf8').replace(`status: ${DRAFT_FILE}`, `status: ${REVIEWED_FILE}`), 'utf8');
}

describe('the words the line is read as', () => {
  it('reads a switch as a boolean and refuses a value it cannot take', () => {
    expect(readSwitch('propose', undefined)).toBe(false);
    expect(readSwitch('propose', true)).toBe(true);
    expect(() => readSwitch('propose', '/home/.claude/skills')).toThrow(CommandExit);
    expect(() => readSwitch('propose', '/home/.claude/skills')).toThrow('type it after the directory');
  });

  it('reads the mode off the two switches and refuses the pair naming both halves', () => {
    expect(readMode({})).toBe('plan');
    expect(readMode({ propose: true })).toBe('propose');
    expect(readMode({ apply: true })).toBe('apply');
    expect(() => readMode({ propose: true, apply: true })).toThrow('a run is one or the other');
  });

  it('resolves the directory against the working directory and refuses none and two', () => {
    expect(readBackfillDirectory(['skills'], () => '/work')).toBe('/work/skills');
    expect(() => readBackfillDirectory([], () => '/work')).toThrow('got none');
    expect(() => readBackfillDirectory(['a', 'b'], () => '/work')).toThrow('as a second');
  });

  it('resolves --project against the working directory and refuses a bare one', () => {
    expect(readConsumerRoot(undefined, () => '/work')).toBeNull();
    expect(readConsumerRoot('.', () => '/work')).toBe('/work');
    expect(() => readConsumerRoot(true, () => '/work')).toThrow('needs a path');
  });

  it('reads the user scope off a home and refuses a directory that is no skills directory', () => {
    const tree = plant(['one']);

    expect(backfillScopeOf(tree.skills, tree.home).scope).toBe('user');
    expect(() => backfillScopeOf(join(tree.home, '.claude'), tree.home)).toThrow('is no skills directory');
  });
});

describe('the refusals that stop a run', () => {
  it('refuses a directory that is no .claude/skills', async () => {
    const tree = plant(['one']);
    const refused = await run(['skill', 'backfill', join(tree.home, '.claude')], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('is no skills directory');
  });

  it('refuses a .claude/skills that is not there', async () => {
    const tree = plant(['one']);
    const refused = await run(['skill', 'backfill', join(tree.home, 'elsewhere', '.claude', 'skills')], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('is not a directory');
  });

  it('refuses --propose typed ahead of the directory, naming the order that works', async () => {
    const tree = plant(['one']);
    const refused = await run(['skill', 'backfill', '--propose', tree.skills], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('type it after the directory');
  });

  it('refuses a line naming both halves', async () => {
    const tree = plant(['one']);
    const refused = await run(['skill', 'backfill', tree.skills, '--propose', '--apply'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('a run is one or the other');
  });

  it('refuses an apply over a proposal file that does not parse', async () => {
    const tree = plant(['one']);
    mkdirSync(join(tree.home, '.rafa', 'backfill'), { recursive: true });
    writeFileSync(proposalOf(tree), 'status: reviewed\nrows: [\n', 'utf8');

    const refused = await run(['skill', 'backfill', tree.skills, '--apply'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('does not parse');
    expect(readFileSync(join(tree.skills, 'one', 'SKILL.md'), 'utf8')).toBe(skillText('one'));
  });
});

describe('the plan, which writes nothing', () => {
  it('says what the derivation would write and leaves the tree exactly as it was', async () => {
    const tree = plant(['one']);
    const planRun = await run(['skill', 'backfill', tree.skills], tree);

    expect(planRun.exitCode).toBe(0);
    expect(planRun.stdout).toContain('user scope:');
    expect(planRun.stdout).toContain('1 file(s): 0 derived, 1 unchanged, 0 skipped, 0 refused');
    expect(planRun.stdout).toContain('1 file(s) a proposal pass would ask a session about');
    expect(readFileSync(join(tree.skills, 'one', 'SKILL.md'), 'utf8')).toBe(skillText('one'));
    expect(existsSync(join(tree.home, '.rafa'))).toBe(false);
  });

  it('gives the counts as the result data in json mode', async () => {
    const tree = plant(['one']);
    const planRun = await run(['skill', 'backfill', tree.skills, '--output=json'], tree);
    const result = eventsOf(planRun.stdout).find((event) => event.type === 'result');
    const data = result?.data as { mode?: string; candidates?: number } | undefined;

    expect(planRun.exitCode).toBe(0);
    expect(data?.mode).toBe('plan');
    expect(data?.candidates).toBe(1);
  });
});

describe('the proposal pass, which touches no skill', () => {
  it('writes one draft file per batch and leaves every skill as it was', async () => {
    const tree = plant(['one', 'two']);
    const scripted = scriptedSpawner();

    const proposed = await run(['skill', 'backfill', tree.skills, '--propose'], tree, scripted.spawn);

    expect(proposed.exitCode).toBe(0);
    expect(scripted.prompts).toHaveLength(1);
    expect(proposed.stdout).toContain('2 file(s) to ask about, in 1 batch(es)');
    expect(proposed.stdout).toContain('0 unanswered');
    const written = readFileSync(proposalOf(tree), 'utf8');

    expect(written).toContain(`status: ${DRAFT_FILE}`);
    expect(written).toContain('one/SKILL.md');
    expect(readFileSync(join(tree.skills, 'one', 'SKILL.md'), 'utf8')).toBe(skillText('one'));
    expect(readFileSync(join(tree.skills, 'two', 'SKILL.md'), 'utf8')).toBe(skillText('two'));
  });
});

describe('the apply, which acts on a reviewed file alone', () => {
  it('refuses a draft file with nothing written, and writes the same rows once it is reviewed', async () => {
    const tree = plant(['one']);
    const path = join(tree.skills, 'one', 'SKILL.md');
    await run(['skill', 'backfill', tree.skills, '--propose'], tree, scriptedSpawner().spawn);

    const refused = await run(['skill', 'backfill', tree.skills, '--apply'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`review it and mark it ${REVIEWED_FILE}`);
    expect(readFileSync(path, 'utf8')).toBe(skillText('one'));

    review(tree);
    const applied = await run(['skill', 'backfill', tree.skills, '--apply'], tree);
    const front = frontmatterOf(path);

    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('1 row(s): 1 applied, 0 unchanged, 0 unanswered, 0 refused');
    expect(front['prevents']).toBe('a planted skill nobody can tell from its neighbours');
    expect(front['signal']).toBe('silent');
    expect(String(front['when_to_use'])).toContain('Prevents: a planted skill');
    expect(bodyOf(path)).toBe(bodyOfText(skillText('one')));
  });

  it('copies each rewritten file under the backup directory before it writes, and keeps every body', async () => {
    const tree = plant(['one']);
    const path = join(tree.skills, 'one', 'SKILL.md');
    const backup = join(tree.home, '.rafa', 'backfill', 'backup', 'one', 'SKILL.md');
    await run(['skill', 'backfill', tree.skills, '--propose'], tree, scriptedSpawner().spawn);
    review(tree);

    const applied = await run(['skill', 'backfill', tree.skills, '--apply'], tree);

    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('1 file(s) copied under');
    expect(readFileSync(backup, 'utf8')).toBe(skillText('one'));
    expect(readFileSync(path, 'utf8')).not.toBe(skillText('one'));
    expect(bodyOf(path)).toBe(bodyOf(backup));
  });

  it('derives over what the proposals wrote and gives both halves as the result data in json mode', async () => {
    const tree = plant(['one']);
    await run(['skill', 'backfill', tree.skills, '--propose'], tree, scriptedSpawner().spawn);
    review(tree);

    const applied = await run(['skill', 'backfill', tree.skills, '--apply', '--output=json'], tree);
    const result = eventsOf(applied.stdout).find((event) => event.type === 'result');
    const data = result?.data as {
      mode?: string;
      backups?: number;
      proposalCounts?: Record<string, number>;
      derivationCounts?: Record<string, number>;
    } | undefined;

    expect(applied.exitCode).toBe(0);
    expect(data?.mode).toBe('apply');
    expect(data?.backups).toBe(1);
    expect(data?.proposalCounts?.['applied']).toBe(1);
    expect(data?.derivationCounts?.['derived']).toBe(1);
  });
});
