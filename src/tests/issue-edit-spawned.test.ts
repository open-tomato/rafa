/**
 * `rafa issue edit`, spawned as the real `rafa` binary (`src/tests/cli-capture.ts`)
 * in a scratch project whose `gh` is a stand-in: the proof that the registered
 * command (`src/commands/issue/edit.ts`) holds over the real process, not only
 * over the fake tracker `src/commands/issue/edit-run.test.ts` drives in-process.
 *
 * The scratch `bin/` holds a stand-in `gh` (a bun script, {@link plantStandInGh}'s
 * shape with the issue held as a JSON file under the scratch root) answering
 * `auth status`, `repo view`, `api user`, the collaborators permission read,
 * `issue view` and `issue edit`. Every write is logged, so a case reads whether
 * the tracker was written to, and a rival body can be set to land straight
 * after the write, the way a browser edit does.
 *
 * Cases:
 *   1. an append leaves the original body byte for byte, the block after one
 *      blank line;
 *   2. the same line again answers `already` and writes nothing;
 *   3. an append on an issue with a saved copy answers `stale-copy`, printing
 *      `rafa plan create --issue=<n> --refresh`;
 *   4. an append on a claimed issue is refused without `--while-in-development`
 *      and lets through with it, answering `stale-copy`;
 *   5. a body changed right after the write answers `conflict`, exit 1, with
 *      the body read before and the body read after under `.rafa/scratch/`.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { IN_DEVELOPMENT_LABEL } from '../claims/stale.js';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-edit-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: each runs `rafa` spawned up to three times. */
const CASE_TIMEOUT_MS = 60_000;

const ISSUE = 42;
const TITLE = 'Sync design for devices';
const REASON = 'sync design';
const TEXT = 'One workflow moves or seeds an environment.';
const ORIGINAL = 'Original body, kept byte for byte.\n\nA second paragraph with ünïcode ✓.\n';
const REMOTE = 'https://github.com/open-tomato/rafa.git';

/** What the stand-in `gh` holds for the issue: its title, body, state, labels and author. */
interface HeldIssue {
  readonly title: string;
  readonly body: string;
  readonly open: boolean;
  readonly labels: readonly string[];
  readonly author: string;
}

/** One case's scratch project, its stand-in `gh`'s state, and the directory beside the repository. */
interface World {
  readonly scratch: ScratchRepo;
  readonly root: string;
  readonly state: string;
}

/** Runs git in `repo` and throws with what it said: a fixture step, not a reading. */
function git(repo: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: repo, stdio: 'pipe' });
}

/** The stand-in `gh`, a bun script holding the issue in `stateDir`; `process.execPath` runs it. */
function standInGhScript(stateDir: string): string {
  return [
    `#!${process.execPath}`,
    'import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `const STATE = ${JSON.stringify(stateDir)};`,
    'const HELD = join(STATE, "issue.json");',
    'const RIVAL = join(STATE, "rival.json");',
    'const WRITES = join(STATE, "writes.log");',
    'const EDITOR = "marcos";',
    'const args = process.argv.slice(2);',
    'const [command, action] = args;',
    'const held = () => JSON.parse(readFileSync(HELD, "utf8"));',
    'const answer = (value) => { console.log(JSON.stringify(value)); process.exit(0); };',
    'const valueOf = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };',
    'if (command === "auth" && action === "status") { console.log("Logged in"); process.exit(0); }',
    'if (command === "repo" && action === "view") answer({ nameWithOwner: "open-tomato/rafa" });',
    'if (command === "api" && action === "user") answer({ login: EDITOR });',
    'if (command === "api" && action.startsWith("repos/") && action.endsWith("/permission")) {',
    '  answer({ permission: "admin", role_name: "admin" });',
    '}',
    'if (command === "issue" && action === "view") {',
    '  const issue = held();',
    '  answer({',
    '    title: issue.title, body: issue.body, state: issue.open ? "OPEN" : "CLOSED",',
    '    labels: issue.labels.map((name) => ({ name })), author: { login: issue.author },',
    '  });',
    '}',
    'if (command === "issue" && action === "edit") {',
    '  const bodyFromStdin = args.includes("--body-file");',
    '  const body = bodyFromStdin ? await Bun.stdin.text() : undefined;',
    '  const title = valueOf("--title");',
    '  const before = held();',
    '  const next = { ...before, ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }) };',
    '  writeFileSync(HELD, JSON.stringify(next));',
    '  appendFileSync(WRITES, args.join(" ") + "\\n");',
    '  if (existsSync(RIVAL)) {',
    '    const rival = JSON.parse(readFileSync(RIVAL, "utf8"));',
    '    rmSync(RIVAL);',
    '    writeFileSync(HELD, JSON.stringify({ ...next, body: rival.body }));',
    '  }',
    '  process.exit(0);',
    '}',
    'console.error("stand-in gh: unsupported: " + args.join(" "));',
    'process.exit(1);',
    '',
  ].join('\n');
}

/** Plants the stand-in `gh` into the scratch `bin/`, holding `issue` in its state directory. */
function plantIssueGh(scratch: ScratchRepo, stateDir: string, issue: HeldIssue): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'issue.json'), JSON.stringify(issue), 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, standInGhScript(stateDir), 'utf8');
  chmodSync(gh, 0o755);
}

/** A scratch project on a GitHub remote, its stand-in `gh` holding `issue` as the one issue. */
function plantWorld(issue: HeldIssue): World {
  const scratch = plantScratchRepo(tempBase);
  git(scratch.repo, ['remote', 'add', 'origin', REMOTE]);
  const root = dirname(scratch.repo);
  const state = join(root, 'gh-state');
  plantIssueGh(scratch, state, issue);
  return { scratch, root, state };
}

/** A spec issue's default: open, unlabelled, by `octocat`, holding {@link ORIGINAL}. */
function openIssue(overrides: Partial<HeldIssue> = {}): HeldIssue {
  return { title: TITLE, body: ORIGINAL, open: true, labels: [], author: 'octocat', ...overrides };
}

/** The body the stand-in `gh` holds now. */
function heldBody(world: World): string {
  return (JSON.parse(readFileSync(join(world.state, 'issue.json'), 'utf8')) as HeldIssue).body;
}

/** How many writes the stand-in `gh` took: one line each. */
function writesOf(world: World): number {
  const log = join(world.state, 'writes.log');
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .length;
}

/** Writes an update file for an append and answers its path, under the scratch root. */
function plantUpdateFile(world: World, text: string): string {
  const path = join(world.root, 'update.md');
  writeFileSync(path, text, 'utf8');
  return path;
}

/** What one run wrote to stdout and stderr, together. */
function outputOf(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${run.stdout}${run.stderr}`;
}

/** Runs `rafa issue edit <n>` with `flags` from the scratch repository. */
function editRun(world: World, flags: readonly string[]) {
  return runRafa(world.scratch, world.scratch.repo, ['issue', 'edit', String(ISSUE), ...flags]);
}

describe('rafa issue edit, spawned against a stand-in gh', () => {
  it('appends below the original part, which stays byte for byte', () => {
    const world = plantWorld(openIssue());
    const updateFile = plantUpdateFile(world, `${TEXT}\n`);

    const run = editRun(world, [`--append-file=${updateFile}`, `--reason=${REASON}`]);

    expectExit(run, 0, world.scratch);
    expect(outputOf(run)).toContain(`Appended an update to github issue ${String(ISSUE)}; the original part is unchanged.`);
    const body = heldBody(world);
    expect(body.startsWith(ORIGINAL)).toBe(true);
    const added = body.slice(ORIGINAL.length);
    expect(added).toMatch(/^\n\*\*Updated \d{4}-\d{2}-\d{2}, sync design:\*\*\n\nOne workflow moves or seeds an environment\.$/u);
    expect(writesOf(world)).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('answers already and writes nothing when the same line is run again', () => {
    const world = plantWorld(openIssue());

    expectExit(editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`]), 0, world.scratch);
    const again = editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`]);

    expectExit(again, 0, world.scratch);
    expect(outputOf(again)).toContain(`github issue ${String(ISSUE)} already ends with this update; nothing was written.`);
    expect(writesOf(world)).toBe(1);
    expect(heldBody(world).split('**Updated').length).toBe(2);
  }, CASE_TIMEOUT_MS);

  it('answers stale-copy and prints the refresh line when the issue has a saved copy', () => {
    const world = plantWorld(openIssue());
    const specs = join(world.scratch.repo, '.rafa', 'specs');
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(specs, `rafa-${String(ISSUE)}-sync-design.md`), '# saved copy\n', 'utf8');

    const run = editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`]);

    expectExit(run, 0, world.scratch);
    expect(outputOf(run)).toContain(`rafa plan create --issue=${String(ISSUE)} --refresh`);
    expect(heldBody(world).startsWith(ORIGINAL)).toBe(true);
    expect(writesOf(world)).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('refuses an append on a claimed issue, and lets it through under --while-in-development as stale-copy', () => {
    const world = plantWorld(openIssue({ labels: [IN_DEVELOPMENT_LABEL] }));

    const refused = editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`]);
    expectExit(refused, 2, world.scratch);
    expect(outputOf(refused)).toContain('refused in-development');
    expect(heldBody(world)).toBe(ORIGINAL);
    expect(writesOf(world)).toBe(0);

    const amended = editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`, '--while-in-development']);
    expectExit(amended, 0, world.scratch);
    expect(outputOf(amended)).toContain('is under way on ');
    expect(outputOf(amended)).toContain(`rafa plan create --issue=${String(ISSUE)} --refresh`);
    expect(heldBody(world).startsWith(ORIGINAL)).toBe(true);
    expect(writesOf(world)).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('answers conflict, exit 1, when the body changes right after the write, saving both bodies under .rafa/scratch/', () => {
    const world = plantWorld(openIssue());
    const rival = 'A browser edit replaced the whole body.\n';
    writeFileSync(join(world.state, 'rival.json'), JSON.stringify({ body: rival }), 'utf8');

    const run = editRun(world, [`--append=${TEXT}`, `--reason=${REASON}`]);

    expectExit(run, 1, world.scratch);
    const output = outputOf(run);
    const before = /\.rafa\/scratch\/rafa-42-edit-before-\S+\.md/u.exec(output)?.[0];
    const after = /\.rafa\/scratch\/rafa-42-edit-after-\S+\.md/u.exec(output)?.[0];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;
    expect(readFileSync(join(world.scratch.repo, before), 'utf8')).toBe(ORIGINAL);
    expect(readFileSync(join(world.scratch.repo, after), 'utf8')).toBe(rival);
    expect(heldBody(world)).toBe(rival);
  }, CASE_TIMEOUT_MS);
});
