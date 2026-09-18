/**
 * Tests for `rafa skill list` (`src/commands/skill/list.ts`): the rows
 * the three tiers give, the `--tier` narrowing, the stack each row
 * shows, the exit code a failing tier does NOT change, and the
 * refusals.
 *
 * Every dispatched case plants a project, a home and a runtime of its
 * own under a temporary directory of this file's own, and dispatches
 * the command in-process with streams, an environment and a working
 * directory of its own (`src/tests/cli-capture.ts`). The rafa tier is
 * measured from a planted `cli.js` handed in as the entry seam, so
 * nothing reads the real home, `~/.claude/skills` or the directory the
 * test runner happens to sit in.
 *
 * ## The controls
 *
 * Two readings here could be false negatives, and each is paired.
 *
 * That a failing skill leaves the exit code 0 is held BESIDE the row
 * for the same file, which says it failed and how many rules it broke:
 * a command that checked nothing at all would exit 0 too, and would
 * redden the row.
 *
 * That a body naming a project path is a warning in the user tier is
 * held BESIDE the same body in the project tier, where it is a failure:
 * the project tier is the one resolved against the project, and a
 * resolver that passed no project root anywhere would redden that half.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import {
  createSkillListCommand,
  failureCount,
  readTierFlag,
  renderSkillList,
  skillRowLine,
  skillStack,
  tierLines,
} from './list.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'skill', summary: 'list the skills each tier registers' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-list-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A markdown file: the frontmatter lines given, then the body given. */
function fileText(lines: readonly string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** The four required skill fields, filled with values every check accepts. */
const CLEAN_FIELDS: readonly string[] = [
  'name: verification-loop',
  'description: Run the gates in order and read each exit code',
  'tags: [verification, gates]',
  'stack: [typescript, bun]',
];

/** The same skill without the two fields the schema also requires. */
const BROKEN_FIELDS: readonly string[] = [
  'name: half-written',
  'description: A skill missing the two required list fields',
];

/** A body naming nothing any check can refuse. */
const PLAIN_BODY = '\n# Verification loop\n\nRead each exit code.\n';

/** What one case plants: a project, a home and a runtime, each with its own skills. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the tiers resolve `~/.claude/skills` under. */
  readonly home: string;
  /** The entry the rafa tier is measured from. */
  readonly entry: string;
}

/** Plants one case's tree. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const entry = join(scope, 'runtime', 'cli.js');
  plantProjectConfig(root);
  mkdirSync(home, { recursive: true });
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, '// the runtime\n', 'utf8');
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, entry };
}

/** Dispatches `words` over the command, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  const command = createSkillListCommand({ entry: () => tree.entry });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
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

describe('the words a skill list line is read as', () => {
  it('reads a tier the flag names and nothing when it is left out', () => {
    expect(readTierFlag(undefined)).toBeNull();
    expect(readTierFlag(false)).toBeNull();
    expect(readTierFlag('user')).toBe('user');
    expect(readTierFlag('rafa')).toBe('rafa');
    expect(readTierFlag('project')).toBe('project');
  });

  it('refuses a tier that is no tier and a flag typed with no value', () => {
    const [code, message] = refusal(() => readTierFlag('users'));

    expect(code).toBe(1);
    expect(message).toContain('--tier is "users", expected one of: project, rafa, user');
    expect(refusal(() => readTierFlag(true))[1]).toContain('--tier needs a value');
  });
});

describe('what a row says', () => {
  it('reads the stack a file carries, and nothing for a file with none or one it cannot read', () => {
    const tree = plant({
      'skills/with/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY),
      'skills/without/SKILL.md': fileText(BROKEN_FIELDS, PLAIN_BODY),
      'skills/bare/SKILL.md': '# No frontmatter at all\n',
    });
    const at = (name: string) => join(dirname(tree.root), 'skills', name, 'SKILL.md');

    expect(skillStack(at('with'))).toEqual(['typescript', 'bun']);
    expect(skillStack(at('without'))).toEqual([]);
    expect(skillStack(at('bare'))).toEqual([]);
    expect(skillStack(at('gone'))).toEqual([]);
  });

  it('counts the failures of a report and leaves its warnings out', () => {
    const issues = [
      { stage: 'schema' as const, code: 'missing-field' as const, severity: 'failure' as const, field: 'tags', line: null, message: 'x' },
      { stage: 'resolution' as const, code: 'unchecked-path' as const, severity: 'warning' as const, field: null, line: 3, message: 'y' },
    ];

    expect(failureCount({ kind: 'skill', path: '/a/SKILL.md', isFile: true, name: 'a', issues, failed: true, fixed: [] })).toBe(1);
  });

  it('writes a passing row, a failing one and an absent tier apart', () => {
    const row = { tier: 'user' as const, name: 'a', path: '/h/a/SKILL.md', stack: ['bun'], ok: true, failures: 0 };
    const broken = { ...row, name: 'b', stack: [], ok: false, failures: 2 };

    expect(skillRowLine(row)).toBe('    ✅ a  [bun]');
    expect(skillRowLine(broken)).toBe('    ❌ b  [—]  2 failure(s)');
    expect(tierLines({ tier: 'rafa', dir: '/install/skills', exists: false, skills: [] }))
      .toEqual(['  rafa  /install/skills  (no such directory)']);
    expect(tierLines({ tier: 'user', dir: '/h/.claude/skills', exists: true, skills: [] }))
      .toEqual(['  user  /h/.claude/skills  (no skills)']);
  });

  it('opens with the tier a line narrowed to and closes with the two counts', () => {
    const lines = renderSkillList({
      projectRoot: '/p',
      tier: 'user',
      tiers: [{ tier: 'user', dir: '/h/.claude/skills', exists: true, skills: [] }],
      total: 3,
      passing: 1,
    });

    expect(lines[0]).toBe('Skills in the user tier (project: /p):');
    expect(lines.at(-1)).toBe('3 skill(s): 1 pass the checker, 2 do not');
    expect(renderSkillList({ projectRoot: '/p', tier: null, tiers: [], total: 0, passing: 0 })[0])
      .toBe('Skills by tier (project: /p):');
  });
});

describe('rafa skill list over planted tiers', () => {
  it('lists the three tiers in order, each skill with its tier, stack and verdict', async () => {
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY),
      'home/.claude/skills/half-written/SKILL.md': fileText(BROKEN_FIELDS, PLAIN_BODY),
      'runtime/skills/': '',
    });

    const answered = await run(['skill', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `Skills by tier (project: ${tree.root}):`,
      `  project  ${join(tree.root, '.claude', 'skills')}`,
      '    ✅ verification-loop  [typescript, bun]',
      `  rafa  ${join(dirname(tree.entry), 'skills')}  (no skills)`,
      `  user  ${join(tree.home, '.claude', 'skills')}`,
      '    ❌ half-written  [—]  2 failure(s)',
      '2 skill(s): 1 pass the checker, 1 do not',
    ]);
  });

  it('says so for a tier whose directory is not there, and lists the others', async () => {
    const tree = plant({ 'home/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY) });

    const answered = await run(['skill', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain(`  project  ${join(tree.root, '.claude', 'skills')}  (no such directory)`);
    expect(answered.stdout).toContain(`  rafa  ${join(dirname(tree.entry), 'skills')}  (no such directory)`);
    expect(answered.stdout).toContain('    ✅ verification-loop  [typescript, bun]');
    expect(answered.stdout).toContain('1 skill(s): 1 pass the checker, 0 do not');
  });

  it('narrows to the tier --tier names', async () => {
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY),
      'home/.claude/skills/half-written/SKILL.md': fileText(BROKEN_FIELDS, PLAIN_BODY),
    });

    const answered = await run(['skill', 'list', '--tier=user'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('Skills in the user tier');
    expect(answered.stdout).toContain('    ❌ half-written');
    expect(answered.stdout).not.toContain('verification-loop');
    expect(answered.stdout).toContain('1 skill(s): 0 pass the checker, 1 do not');
  });

  it('exits 0 over a tier of failing skills, with the failures on the rows', async () => {
    const tree = plant({
      'home/.claude/skills/half-written/SKILL.md': fileText(BROKEN_FIELDS, PLAIN_BODY),
      'home/.claude/skills/loose.md': fileText(CLEAN_FIELDS, PLAIN_BODY),
    });

    const answered = await run(['skill', 'list', '--tier=user'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('    ❌ half-written  [—]  2 failure(s)');
    expect(answered.stdout).toContain('2 skill(s): 0 pass the checker, 2 do not');
  });

  it('resolves a body path against the project for the project tier alone', async () => {
    const body = '\nRead `src/gone.ts` before the gates.\n';
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, body),
      'home/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, body),
    });

    const answered = await run(['skill', 'list'], tree);
    const rows = answered.stdout.split('\n').filter((line) => line.includes('verification-loop'));

    expect(answered.exitCode).toBe(0);
    expect(rows).toEqual([
      '    ❌ verification-loop  [typescript, bun]  1 failure(s)',
      '    ✅ verification-loop  [typescript, bun]',
    ]);
  });

  it('gives the tiers and their rows as the json result', async () => {
    const tree = plant({ 'project/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY) });

    const answered = await run(['skill', 'list', '--output=json'], tree);
    const [, result] = eventsOf(answered.stdout);

    expect(answered.exitCode).toBe(0);
    expect(result).toMatchObject({
      type: 'result',
      ok: true,
      data: { projectRoot: tree.root, tier: null, total: 1, passing: 1 },
    });
    expect((result as { data: { tiers: { tier: string; exists: boolean }[] } }).data.tiers.map((listing) => [listing.tier, listing.exists]))
      .toEqual([['project', true], ['rafa', false], ['user', false]]);
  });

  it('refuses a positional word and a --tier that is no tier', async () => {
    const tree = plant({ 'home/.claude/skills/verification-loop/SKILL.md': fileText(CLEAN_FIELDS, PLAIN_BODY) });

    const worded = await run(['skill', 'list', 'user'], tree);
    const wrong = await run(['skill', 'list', '--tier=users'], tree);

    expect(worded.exitCode).toBe(1);
    expect(worded.stderr).toContain('Expected no argument, got 1: user');
    expect(wrong.exitCode).toBe(1);
    expect(wrong.stderr).toContain('expected one of: project, rafa, user');
  });
});
