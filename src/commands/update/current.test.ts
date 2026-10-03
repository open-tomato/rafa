import type { UpdateCurrentResult, UpdateCurrentSeams } from './current.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { SubjectSpec } from '../../cli/registry.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { BOARD_LABELS } from '../../board/setup.js';
import { LOCK_FILE, projectLockText, writeProjectLock } from '../../project/lock.js';
import { PROJECT_TREE } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { APPLY_QUESTION, createUpdateCurrentCommand } from './current.js';
import self from './self.js';

const SUBJECTS: readonly SubjectSpec[] = [{ name: 'update', summary: 'update rafa and this project' }];
const INSTALLED = '0.34.2';
const GITHUB_REMOTE = 'https://github.com/example/project.git';

let scope = '';
let project: PlantedProject;

beforeEach(() => {
  scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-update-current-')));
  project = plantProject(scope);
});

afterEach(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A `gh` stand-in holding `held` labels, recording each call's words. */
function standInGh(held: readonly string[], calls: string[], refuseCreate = false): GhRunner {
  return (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'label' && args[1] === 'list') {
      return Promise.resolve({ ok: true, stdout: JSON.stringify(held.map((name) => ({ name }))), stderr: '' });
    }
    return Promise.resolve(refuseCreate
      ? { ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }
      : { ok: true, stdout: '', stderr: '' });
  };
}

/** A prompter answering `answer`, recording the questions. */
function scriptedPrompter(answer: string | null, questions: string[]): Prompter {
  return {
    say: () => {},
    ask: (question) => {
      questions.push(question);
      return Promise.resolve(answer);
    },
    close: () => {},
  };
}

interface World {
  readonly gh: string[];
  readonly questions: string[];
}

function seamsOf(world: World, options: { held?: readonly string[]; terminal?: boolean; answer?: string | null; remote?: string | null; lockRoot?: string; refuseCreate?: boolean } = {}): UpdateCurrentSeams {
  return {
    installed: INSTALLED,
    openGh: () => standInGh(options.held ?? [], world.gh, options.refuseCreate ?? false),
    readRemote: () => (options.remote === undefined
      ? GITHUB_REMOTE
      : options.remote),
    isTerminal: () => options.terminal ?? false,
    openPrompter: () => scriptedPrompter(options.answer ?? null, world.questions),
    lockRootOf: (root) => options.lockRoot ?? root,
  };
}

function newWorld(): World {
  return { gh: [], questions: [] };
}

function update(words: readonly string[], seams: UpdateCurrentSeams): ReturnType<typeof dispatchInProject> {
  return dispatchInProject(['update', ...words], SUBJECTS, [createUpdateCurrentCommand(seams), self], project);
}

/** Every folder and label present, so only the lock can change. */
function plantComplete(): readonly string[] {
  for (const name of PROJECT_TREE) mkdirSync(join(project.root, '.rafa', name), { recursive: true });
  return BOARD_LABELS.map((label) => label.name);
}

describe('rafa update current', () => {
  it('adopts a project with no lock: its folders, its missing labels and the lock, under --yes', async () => {
    const world = newWorld();
    const held = BOARD_LABELS.map((label) => label.name).filter((name) => !name.startsWith('rafa:'));
    const run = await update(['current', '--yes'], seamsOf(world, { held }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`from no ${LOCK_FILE} to ${INSTALLED}`);
    expect(readFileSync(join(project.root, LOCK_FILE), 'utf8')).toBe(projectLockText(INSTALLED));
    for (const name of PROJECT_TREE) expect(existsSync(join(project.root, '.rafa', name))).toBe(true);
    expect(world.gh.filter((call) => call.startsWith('label create'))).toEqual([
      expect.stringContaining('label create rafa:claimed'),
      expect.stringContaining('label create rafa:in-development'),
    ]);
    expect(run.stdout).toContain('warn: rafa cannot roll these changes back');
  });

  it('lists every change under --dry-run and writes nothing', async () => {
    const world = newWorld();
    const run = await update(['current', '--dry-run'], seamsOf(world));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('create .rafa/specs');
    expect(run.stdout).toContain('create labels type:spec');
    expect(run.stdout).toContain('Dry run: nothing was written.');
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);
    expect(existsSync(join(project.root, '.rafa', 'specs'))).toBe(false);
    expect(world.gh.some((call) => call.startsWith('label create'))).toBe(false);
  });

  it('refuses with no terminal and no --yes, writing nothing', async () => {
    const world = newWorld();
    const run = await update(['current'], seamsOf(world));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('there is no terminal to ask on');
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);
  });

  it('applies on a yes typed at the terminal, and changes nothing on a no', async () => {
    const no = newWorld();
    const declined = await update(['current'], seamsOf(no, { terminal: true, answer: 'n' }));

    expect(declined.exitCode).toBe(0);
    expect(no.questions).toEqual([APPLY_QUESTION]);
    expect(declined.stdout).toContain('Nothing was changed.');
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);

    const yes = newWorld();
    const applied = await update(['current'], seamsOf(yes, { terminal: true, answer: 'y' }));

    expect(applied.exitCode).toBe(0);
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(true);
  });

  it('moves a lock to a newer patch of its minor', async () => {
    const held = plantComplete();
    writeProjectLock(project.root, '0.34.0');
    const run = await update(['current', '--yes'], seamsOf(newWorld(), { held }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`update 0.34.0 → ${INSTALLED}`);
    expect(readFileSync(join(project.root, LOCK_FILE), 'utf8')).toBe(projectLockText(INSTALLED));
  });

  it('says there is nothing to change at the same version with nothing missing, asking nothing', async () => {
    const held = plantComplete();
    writeProjectLock(project.root, INSTALLED);
    const world = newWorld();
    const run = await update(['current'], seamsOf(world, { held, terminal: true, answer: 'y' }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Nothing to change.');
    expect(world.questions).toEqual([]);
  });

  it('refuses a newer minor, naming update next, and an older installed rafa as a downgrade', async () => {
    writeProjectLock(project.root, '0.33.4');
    const minor = await update(['current', '--yes'], seamsOf(newWorld()));

    expect(minor.exitCode).toBe(1);
    expect(minor.stderr).toContain('rafa update next');

    writeProjectLock(project.root, '0.34.3');
    const older = await update(['current', '--yes'], seamsOf(newWorld()));

    expect(older.exitCode).toBe(1);
    expect(older.stderr).toContain('no downgrade runs before 1.0.0');
    expect(readFileSync(join(project.root, LOCK_FILE), 'utf8')).toBe(projectLockText('0.34.3'));
  });

  it('exits 2 for a lock it cannot read, changing nothing', async () => {
    Bun.write(join(project.root, LOCK_FILE), 'not json');
    await Bun.sleep(0);
    const run = await update(['current', '--yes'], seamsOf(newWorld()));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`${LOCK_FILE} is not JSON`);
    expect(existsSync(join(project.root, '.rafa', 'specs'))).toBe(false);
  });

  it('skips the board on a repository with no GitHub remote, and sends no gh command', async () => {
    const world = newWorld();
    const run = await update(['current', '--yes'], seamsOf(world, { remote: null }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('skipped: pr.provider is none');
    expect(world.gh).toEqual([]);
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(true);
  });

  it('gives the plan and what was applied as the json result', async () => {
    const run = await update(['current', '--yes', '--output=json'], seamsOf(newWorld()));
    const result = eventsOf(run.stdout).find((event) => event.type === 'result');
    const data = (result as { data: UpdateCurrentResult } | undefined)?.data;

    expect(run.exitCode).toBe(0);
    expect(data?.plan.to).toBe(INSTALLED);
    expect(data?.plan.lock).toBe('created');
    expect(data?.applied?.lock).toBe('created');
  });
});

describe('rafa update current, when something stands in the way', () => {
  it('writes the lock where the checkout it runs in is, naming that path, and the folders at the project root', async () => {
    const worktree = join(scope, 'worktree');
    mkdirSync(worktree);
    const run = await update(['current', '--yes'], seamsOf(newWorld(), { lockRoot: worktree }));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`create at ${INSTALLED} in ${worktree}`);
    expect(existsSync(join(worktree, LOCK_FILE))).toBe(true);
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);
    expect(existsSync(join(project.root, '.rafa', 'specs'))).toBe(true);
  });

  it('applies everything else, then exits 1, when gh will not create a label', async () => {
    const run = await update(['current', '--yes'], seamsOf(newWorld(), { refuseCreate: true }));

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('warn: label type:spec was not created');
    expect(run.stderr).toContain('board label(s) were not created; everything else was applied');
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(true);
  });

  it('exits 2 before asking when a .rafa/ folder path holds a file, changing nothing', async () => {
    Bun.write(join(project.root, '.rafa', 'specs'), 'not a folder');
    await Bun.sleep(0);
    const world = newWorld();
    const run = await update(['current'], seamsOf(world, { terminal: true, answer: 'y' }));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('the project scope cannot be written');
    expect(world.questions).toEqual([]);
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);
  });

  it('names the lock step and what was kept when the lock cannot be written', async () => {
    const run = await update(['current', '--yes'], seamsOf(newWorld(), { lockRoot: join(scope, 'no-such-dir') }));

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('FAIL — lock:');
    expect(run.stderr).toContain('Already written, and kept:');
    expect(run.stderr).toContain(join('.rafa', 'specs'));
    expect(existsSync(join(project.root, '.rafa', 'specs'))).toBe(true);
  });
});

describe('rafa update stubs', () => {
  it('refuses outside a project too, in the same line', async () => {
    const outside = join(scope, 'outside');
    mkdirSync(outside);
    const run = await dispatchInProject(['update', 'self'], SUBJECTS, [self], { root: outside, home: project.home });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('rafa update self is a feature in development');
  });

  it('refuses rafa update self in one line naming its issue, changing nothing', async () => {
    const run = await update(['self'], seamsOf(newWorld()));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('rafa update self is a feature in development');
    expect(run.stderr).toContain('issues/715');
    expect(existsSync(join(project.root, LOCK_FILE))).toBe(false);
  });
});
