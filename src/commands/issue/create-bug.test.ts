/**
 * Tests for a bug filed through `rafa issue create --type=bug`: the
 * record read from the flags, the body and a title, what rafa fills
 * itself, the refusal of a record that is not complete, and `--dry-run`.
 *
 * Every case dispatches the command in a project of its own, with a git
 * seam answering a fixed commit, so no case reads this checkout.
 */
import type { IssueSeams } from './issue-tracker.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RAFA_VERSION } from '@open-tomato/rafa/core/command';

import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { localIssuesDir, parseLocalIssue } from '../../adapters/tracker/local.js';
import { dispatchInProject, plantProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createIssueCreateCommand } from './create.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-create-bug-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** A config naming `local` first. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A config naming `github` first, then `local`. */
const GITHUB_CONFIG = 'tracker:\n  default: github\n  fallback: [local]\n';

/** The line of the spec's definition of done, without its `--dry-run`. */
const DOD_LINE = [
  'issue', 'create', '--type=bug', '--module=loop', '--action=start',
  '--summary=resume does not find the worktree branch',
  '--reproduce=rafa loop start --continue after a stop',
  '--cause=git:new-context', '--proposed=git:branch-not-found',
];

/** The title the definition-of-done line renders. */
const DOD_TITLE = 'loop - start: resume does not find the worktree branch';

/**
 * A git on commit `2bdad97`, whose checkout is `toplevel`, or no
 * repository's for null, and whose `status` writes `changes`.
 */
function gitAt(toplevel: string | null, changes = ''): GitRunner {
  return (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return toplevel === null
        ? { ok: false, stdout: '', stderr: 'fatal: not a git repository' }
        : { ok: true, stdout: `${toplevel}\n`, stderr: '' };
    }
    return {
      ok: true,
      stdout: args[0] === 'rev-parse'
        ? '2bdad97\n'
        : changes,
      stderr: '',
    };
  };
}

/** A git on commit `2bdad97` with a clean tree, in no checkout of its own: the project root stands in. */
const cleanGit = gitAt(null);

/** A fresh project holding `config`. */
function plantCase(config: string = LOCAL_CONFIG): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), config);
}

/** Writes `text` at `path` under the project, making its directories. */
function plantFile(project: PlantedProject, path: string, text: string): string {
  const file = join(project.root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/** Dispatches `words` in `project`, the command reading git through {@link cleanGit} and running from the project root. */
function run(words: readonly string[], project: PlantedProject, env: Readonly<Record<string, string>> = {}, seams: IssueSeams = {}) {
  const command = createIssueCreateCommand({ git: cleanGit, cwd: () => project.root, ...seams });
  return dispatchInProject(words, SUBJECTS, [command], project, env);
}

/** The `local` issue `number` of a project, as its adapter parses the file. */
function localIssue(project: PlantedProject, number: number) {
  const path = join(localIssuesDir(project.root), `${number}.md`);
  return parseLocalIssue(readFileSync(path, 'utf8'), path);
}

/** True when the project holds no local issue. */
function filedNothing(project: PlantedProject): boolean {
  return !existsSync(join(localIssuesDir(project.root), '1.md'));
}

/** The body the issue `DOD_LINE` and `more` file together, from the project's first local issue. */
async function bodyOf(more: readonly string[], project: PlantedProject = plantCase(), env: Readonly<Record<string, string>> = {}): Promise<string> {
  const outcome = await run([...DOD_LINE, ...more], project, env);
  expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
  return localIssue(project, 1).draft.body;
}

describe('rafa issue create --type=bug --dry-run', () => {
  it('prints the rendered title and a body with every section, and files nothing', async () => {
    const project = plantCase();

    const outcome = await run([...DOD_LINE, '--dry-run'], project);

    expect([outcome.exitCode, outcome.stderr]).toEqual([0, '']);
    expect(outcome.stdout).toBe([
      '--dry-run: nothing was filed.',
      `Title: ${DOD_TITLE}`,
      'Type: bug · Module: loop · Priority: needs-triage · Cause: git:new-context',
      '',
      '## What', '', '```', 'resume does not find the worktree branch', '```', '',
      '## Reproduce', '', '```', 'rafa loop start --continue after a stop', '```', '',
      '## Cause', '', 'git:new-context', '',
      '## Proposed cause', '', 'git:branch-not-found', '',
      '## Module', '', 'loop', '',
      '## Action', '', 'start', '',
      '## Environment', '', 'local', '',
      '## Versions', '', '```', `rafa: ${RAFA_VERSION}`, 'code: 2bdad97', '```', '',
    ].join('\n'));
    expect(filedNothing(project)).toBe(true);
  });

  it('gives the draft as the data of the result event in json mode', async () => {
    const outcome = await run([...DOD_LINE, '--dry-run', '--output=json'], plantCase());
    const result = outcome.stdout.trim().split('\n')
      .map((line) => JSON.parse(line) as { type: string; data?: { dryRun: boolean; draft: { title: string; cause: string; type: string } } })
      .find((event) => event.type === 'result');

    expect(result?.data).toMatchObject({ dryRun: true, draft: { title: DOD_TITLE, cause: 'git:new-context', type: 'bug' } });
  });

  it('prints an issue of another type the same way, with no cause', async () => {
    const project = plantCase();

    const outcome = await run(['issue', 'create', '--title=Document issue move', '--body=Soon.', '--dry-run'], project);

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: '--dry-run: nothing was filed.\nTitle: Document issue move\nType: code · Module: unassigned · Priority: needs-triage\n\nSoon.\n',
      stderr: '',
    });
    expect(filedNothing(project)).toBe(true);
  });

  it('resolves no tracker: a github config with no gh planted is never asked', async () => {
    const fake = createFakeGh();

    const outcome = await run([...DOD_LINE, '--dry-run'], plantCase(GITHUB_CONFIG), {}, { gh: fake.run });

    expect(outcome.exitCode).toBe(0);
    expect(fake.calls()).toEqual([]);
  });
});

describe('rafa issue create --type=bug, filed', () => {
  it('files the rendered title, the body, the module and the cause', async () => {
    const project = plantCase();

    const outcome = await run(DOD_LINE, project);

    expect(outcome).toEqual({ exitCode: 0, stdout: 'Created local issue 1.\n', stderr: '' });
    expect(localIssue(project, 1).draft).toMatchObject({ title: DOD_TITLE, type: 'bug', module: 'loop', cause: 'git:new-context', priority: null });
    expect(localIssue(project, 1).draft.body).toContain('## Reproduce\n\n```\nrafa loop start --continue after a stop\n```');
  });

  it('files the cause as a label on github', async () => {
    const fake = createFakeGh();

    const outcome = await run(DOD_LINE, plantCase(GITHUB_CONFIG), {}, { gh: fake.run });

    expect(outcome.exitCode).toBe(0);
    expect(fake.issue('1')?.title).toBe(DOD_TITLE);
    expect(fake.issue('1')?.labels).toEqual(expect.arrayContaining(['module:loop', 'type:bug', 'cause:git:new-context']));
  });

  it('files under module unassigned, titled with the summary alone, when the module and action are unknown', async () => {
    const project = plantCase();
    const line = DOD_LINE.map((word) => word.replace('--module=loop', '--module=unknown').replace('--action=start', '--action=unknown'));

    await run(line, project);

    expect(localIssue(project, 1).draft).toMatchObject({ title: 'resume does not find the worktree branch', module: 'unassigned' });
    expect(localIssue(project, 1).draft.body).toContain('## Module\n\nunknown\n');
  });

  it('reads module unassigned as unknown', async () => {
    const project = plantCase();

    await run(DOD_LINE.map((word) => word.replace('--module=loop', '--module=unassigned')), project);

    expect(localIssue(project, 1).draft.title).toBe('resume does not find the worktree branch');
  });

  it('names the package of the project and its version when the root has a manifest', async () => {
    const project = plantCase();
    plantFile(project, 'package.json', '{"name":"@acme/app","version":"1.2.0"}');

    expect(await bodyOf([], project)).toContain(`## Versions\n\n\`\`\`\nrafa: ${RAFA_VERSION}\ncode: 2bdad97\npackage: @acme/app@1.2.0\n\`\`\`\n`);
  });

  it('names the package the artifact\'s first project file belongs to, and --path over it', async () => {
    const project = plantCase();
    plantFile(project, 'package.json', '{"name":"@acme/app","version":"1.2.0"}');
    plantFile(project, 'src/a.ts', '');
    plantFile(project, 'packages/hub/package.json', '{"name":"@acme/hub","version":"0.3.1"}');
    plantFile(project, 'packages/hub/src/b.ts', '');
    const body = plantFile(project, 'bug.md', '## Artifact\n\n```\nTypeError: x is not a function\n    at run (packages/hub/src/b.ts:3:1)\n```\n');

    expect(await bodyOf([`--body-file=${body}`], project)).toContain('package: @acme/hub@0.3.1\npath: packages/hub/src/b.ts\n');

    const second = plantCase();
    plantFile(second, 'package.json', '{"name":"@acme/app","version":"1.2.0"}');
    plantFile(second, 'src/a.ts', '');
    expect(await bodyOf(['--path=src/a.ts'], second)).toContain('package: @acme/app@1.2.0\npath: src/a.ts\n');
  });

  it('marks a tree with tracked changes as dirty', async () => {
    const project = plantCase();

    await run(DOD_LINE, project, {}, { git: gitAt(null, ' M src/a.ts\n') });

    expect(localIssue(project, 1).draft.body).toContain('code: 2bdad97-dirty\n');
  });
});

describe('a bug filed from a worktree of the project', () => {
  it('reads the path, the package and the commit in the checkout the command runs in, and takes its path out', async () => {
    const project = plantCase();
    plantFile(project, 'package.json', '{"name":"@acme/main","version":"9.9.9"}');
    const checkout = join(project.root, 'worktrees', 'feature');
    plantFile(project, 'worktrees/feature/package.json', '{"name":"@acme/app","version":"1.2.0"}');
    plantFile(project, 'worktrees/feature/packages/hub/package.json', '{"name":"@acme/hub","version":"0.3.1"}');
    const frame = plantFile(project, 'worktrees/feature/packages/hub/src/b.ts', '');
    const file = plantFile(project, 'bug.md', `## Artifact\n\n\`\`\`\nTypeError: x\n    at run (${frame}:3:1)\n\`\`\`\n`);

    const outcome = await run([...DOD_LINE, `--body-file=${file}`], project, {}, { git: gitAt(checkout) });
    const { body } = localIssue(project, 1).draft;

    expect(outcome.exitCode).toBe(0);
    expect(body).toContain('package: @acme/hub@0.3.1\npath: packages/hub/src/b.ts\n');
    expect(body).toContain('    at run (packages/hub/src/b.ts:3:1)');
    expect(body).not.toContain(project.root);
  });

  it('takes the worktree\'s path and the main checkout\'s out of one text, with the project under the home', async () => {
    const home = mkdtempSync(join(tempBase, 'home-'));
    const root = join(home, 'clients', 'acme-corp', 'app');
    plantProjectConfig(root, LOCAL_CONFIG);
    const project: PlantedProject = { root, home };
    const checkout = join(root, '.claude', 'worktrees', 'fix-1');
    mkdirSync(checkout, { recursive: true });
    const line = [
      'issue', 'create', '--type=bug', '--module=loop', '--action=start', '--cause=git:new-context',
      `--summary=fails under ${root}/src`,
      `--reproduce=run ${checkout}/src/a.ts, then read ${root}/.rafa/config.yaml and ${home}/notes.txt`,
    ];

    const outcome = await run(line, project, {}, { git: gitAt(checkout) });
    const { title, body } = localIssue(project, 1).draft;

    expect(outcome.exitCode).toBe(0);
    expect(body).toContain('run src/a.ts, then read .rafa/config.yaml and [redacted: HOME]/notes.txt');
    expect(title).toBe('loop - start: fails under src');
    expect(`${title}\n${body}`).not.toContain('acme-corp');
    expect(`${title}\n${body}`).not.toContain(home);
  });

  it('reads a project in a subdirectory of its repository at the project root, never as the repository\'s package', async () => {
    const project = plantCase();
    const outer = dirname(project.root);
    writeFileSync(join(outer, 'package.json'), '{"name":"mono-root","version":"0.0.1"}', 'utf8');
    plantFile(project, 'package.json', '{"name":"@acme/app","version":"2.0.0"}');
    plantFile(project, 'src/a.ts', '');
    const file = plantFile(project, 'bug.md', '## Artifact\n\n```\nTypeError: x\n    at run (src/a.ts:1:1)\n```\n');

    const outcome = await run([...DOD_LINE, `--body-file=${file}`], project, {}, { git: gitAt(outer) });
    const { body } = localIssue(project, 1).draft;

    expect(outcome.exitCode).toBe(0);
    expect(body).toContain('package: @acme/app@2.0.0\npath: src/a.ts\n');
    expect(body).not.toContain('mono-root');
  });

  it('names the checkout\'s own package for a bug that names no file', async () => {
    const project = plantCase();
    plantFile(project, 'package.json', '{"name":"@acme/main","version":"9.9.9"}');
    plantFile(project, 'worktrees/feature/package.json', '{"name":"@acme/app","version":"1.2.0"}');

    await run(DOD_LINE, project, {}, { git: gitAt(join(project.root, 'worktrees', 'feature')) });

    expect(localIssue(project, 1).draft.body).toContain('package: @acme/app@1.2.0\n');
  });
});

describe('the fields of a bug line', () => {
  it('reads the sections of a body file, a flag winning over its section', async () => {
    const project = plantCase();
    const file = plantFile(project, 'bug.md', [
      '## What', '', 'The loop stops after a resume.', '',
      '## Reproduce', '', 'from the file', '',
      '## Cause', '', 'tsc:new-context', '',
      '## Suspected cause', '', 'the branch is read too early', '',
      '## Artifact', '', '```', '', 'Error: branch 12 not found', '    at resume', '```', '',
    ].join('\n'));
    const line = ['issue', 'create', '--type=bug', '--module=loop', '--action=start', '--summary=resume fails', '--cause=git:new-context', `--body-file=${file}`];

    await run(line, project);
    const { body } = localIssue(project, 1).draft;

    expect(body).toContain('## What\n\n```\nThe loop stops after a resume.\n```');
    expect(body).toContain('## Reproduce\n\n```\nfrom the file\n```');
    expect(body).toContain('## Cause\n\ngit:new-context\n');
    expect(body).toContain('## Suspected cause\n\n```\nthe branch is read too early\n```');
    expect(body).toContain('## Error line\n\n```\nError: branch not found\n```');
    expect(body).toContain('## Artifact\n\n```\nError: branch 12 not found\n    at resume\n```');
  });

  it('takes a body with no section as the description, and the summary when there is no body', async () => {
    expect(await bodyOf(['--body=Seen twice.'])).toContain('## What\n\n```\nSeen twice.\n```');
    expect(await bodyOf([])).toContain('## What\n\n```\nresume does not find the worktree branch\n```');
  });

  it('keeps a body file\'s sections that are no field, after the record\'s own', async () => {
    const project = plantCase();
    const file = plantFile(project, 'bug.md', `## Expected\n\nit resumes\n\n## Refs\n\n- seen under ${project.root}/src\n\n## Rerun\n\nbun test\n`);

    const body = await bodyOf([`--body-file=${file}`], project);

    expect(body.endsWith('```\n\n## Expected\n\nit resumes\n\n## Refs\n\n- seen under src\n')).toBe(true);
    expect(body).toContain('## Rerun\n\n```\nbun test\n```');
    expect(body.indexOf('## Versions')).toBeLessThan(body.indexOf('## Expected'));
  });

  it('cuts an artifact past its cap, saying how many lines it left out', async () => {
    const project = plantCase();
    const lines = Array.from({ length: 70 }, (_, index) => `line ${index + 1}`);
    const file = plantFile(project, 'bug.md', `## Artifact\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);

    const body = await bodyOf([`--body-file=${file}`], project);

    expect(body).toContain('line 60\n… 10 more lines cut\n```');
    expect(body).not.toContain('line 61');
  });

  it('suggests ci under CI, and takes --env over it', async () => {
    expect(await bodyOf([], plantCase(), { CI: 'true' })).toContain('## Environment\n\nci\n');
    expect(await bodyOf(['--env=prod'], plantCase(), { CI: 'true' })).toContain('## Environment\n\nprod\n');
  });

  it('takes a place the config adds, and refuses it without', async () => {
    const refused = await run([...DOD_LINE, '--env=staging'], plantCase());
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('environment is "staging", expected one of: local, ci, prod, unknown');

    const project = plantCase(`${LOCAL_CONFIG}issues:\n  environments: [staging]\n`);
    expect(await bodyOf(['--env=staging'], project)).toContain('## Environment\n\nstaging\n');
  });

  it('takes the fields a --title holds, and refuses a title that disagrees with a flag', async () => {
    const project = plantCase();
    const line = ['issue', 'create', '--type=bug', '--title=loop - start: x fails', '--cause=git:new-context', '--reproduce=run it'];

    await run(line, project);
    expect(localIssue(project, 1).draft).toMatchObject({ title: 'loop - start: x fails', module: 'loop' });
    expect(localIssue(project, 1).draft.body).toContain('## Action\n\nstart\n');

    const disagreeing = await run([...line, '--module=board'], plantCase());
    expect(disagreeing.exitCode).toBe(1);
    expect(disagreeing.stderr).toContain('--title reads module as "loop", and --module says "board"');
  });

  it('reads the project a --title holds under a template that names one, and refuses one that disagrees', async () => {
    const config = `${LOCAL_CONFIG}issues:\n  titles:\n    bug: "?([\${project}] )?(\${module}?( - \${action}): )\${summary}"\n`;
    const line = ['issue', 'create', '--type=bug', '--title=[api] loop - start: x fails', '--cause=git:new-context', '--reproduce=run it'];
    const project = plantCase(config);

    await run(line, project);
    expect(localIssue(project, 1).draft.title).toBe('[api] loop - start: x fails');
    expect(localIssue(project, 1).draft.body).toContain('## Project\n\n```\napi\n```');

    const disagreeing = await run([...line, '--project=web'], plantCase(config));
    expect(disagreeing.exitCode).toBe(1);
    expect(disagreeing.stderr).toContain('--title reads project as "api", and --project says "web"');
  });

  it('takes the text a body file opens with as the description, beside its sections', async () => {
    const project = plantCase();
    const file = plantFile(project, 'bug.md', 'The loop stops after a resume.\n\n## Rerun\n\nbun test\n');

    expect(await bodyOf([`--body-file=${file}`], project)).toContain('## What\n\n```\nThe loop stops after a resume.\n```');
  });

  it('takes local paths and named secrets out of every free text', async () => {
    const project = plantCase();
    const secret = 'ghp_0123456789secret';
    const line = [
      'issue', 'create', '--type=bug', '--module=loop', '--action=start', '--summary=resume fails', '--cause=git:new-context',
      `--reproduce=run it in ${project.root}/src with ${secret}`,
    ];

    const outcome = await run(line, project, { GITHUB_TOKEN: secret });
    const { body } = localIssue(project, 1).draft;

    expect(outcome.exitCode).toBe(0);
    expect(body).not.toContain(project.root);
    expect(body).not.toContain(secret);
    expect(body).toContain('run it in src with [redacted: GITHUB_TOKEN]');
  });
});

describe('a bug line refused', () => {
  it('names the missing field and the usage line, and files nothing', async () => {
    const project = plantCase();

    const outcome = await run(DOD_LINE.filter((word) => !word.startsWith('--reproduce=')), project);

    expect([outcome.exitCode, outcome.stdout]).toEqual([1, '']);
    expect(outcome.stderr).toContain('the bug record is not complete:\n  reproduce is missing');
    expect(outcome.stderr).toContain('rafa issue create (--title=<text> | --type=bug');
    expect(filedNothing(project)).toBe(true);
  });

  it('names every missing field of a bug typed with a title alone, one per line', async () => {
    const outcome = await run(['issue', 'create', '--type=bug', '--title=Timeouts in plan show'], plantCase());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain([
      'the bug record is not complete:',
      '  reproduce is missing: pass --reproduce=<the steps, or the condition that revealed it>; it is never unknown',
      '  cause is missing: pass --cause=<family>:<leaf> from rafa bug codes, or <family>:new-context',
      '  module is missing: pass --module=<name>, or --module=unknown',
      '  action is missing: pass --action=<name>, or --action=unknown',
    ].join('\n'));
  });

  it('runs no gh for a refused line', async () => {
    const fake = createFakeGh();

    const outcome = await run(['issue', 'create', '--type=bug', '--title=x'], plantCase(GITHUB_CONFIG), {}, { gh: fake.run });

    expect(outcome.exitCode).toBe(1);
    expect(fake.calls()).toEqual([]);
  });

  it('reads a relative --path from the directory rafa runs in, and refuses one that names no file', async () => {
    const project = plantCase();
    plantFile(project, 'src/commands/create.ts', '');
    const cwd = (): string => join(project.root, 'src', 'commands');

    const outcome = await run([...DOD_LINE, '--path=create.ts'], project, {}, { cwd });
    expect(outcome.exitCode).toBe(0);
    expect(localIssue(project, 1).draft.body).toContain('path: src/commands/create.ts\n');

    const missing = await run([...DOD_LINE, '--path=gone.ts'], plantCase());
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('--path names no file: "gone.ts"');
  });

  it('refuses a --path outside the project', async () => {
    const outcome = await run([...DOD_LINE, '--path=/elsewhere/x.ts'], plantCase());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--path is outside the project: "/elsewhere/x.ts"');
  });

  it('refuses a bug flag on a line of another type, where the same line files without it', async () => {
    const refused = await run(['issue', 'create', '--title=x', '--summary=y'], plantCase());
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('--summary is read for --type=bug only');

    const project = plantCase();
    expect((await run(['issue', 'create', '--title=x'], project)).exitCode).toBe(0);
    expect(localIssue(project, 1).draft).toMatchObject({ title: 'x', type: 'code', module: 'unassigned' });
  });

  it('still refuses a line of another type with no --title', async () => {
    const outcome = await run(['issue', 'create', '--type=chore'], plantCase());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--title is required: --title=<value>');
  });
});
