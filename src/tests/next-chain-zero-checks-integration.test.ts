/**
 * A second scratch-repository suite, over a pull request that reports
 * no check at all (verdict `none`) rather than the green one
 * `./next-chain-integration.test.ts` merges. Row 7 of `src/next/state.ts`'s
 * table proposes `merge-unchecked` for it, which `rafa next` hands over
 * to a real `pr merge <n> --skip-checks` with no `--yes` of its own
 * (`QUESTION_HANDED_OVER` in `src/commands/next.ts`) — so this probe is
 * built without the plan and loop doubles the other suite needs, since
 * none of the three cases below reaches a plan or a loop, and it scripts
 * `pr merge`'s own question through a small prompter of its own rather
 * than the other suite's, which stays a refusal here as it does there.
 *
 * The roadmap this probe's stand-in `gh` answers carries no undone line
 * at all, so a merge that goes through reads back to `nothing-left`
 * (row 13) rather than to the next plan — nothing the case below asks
 * about needs a second question answered.
 *
 * `./next-chain-fixtures.ts` holds what both suites share: the scratch
 * repository's fixed identity, the stand-in `gh`, real git run in
 * isolation, and the harness that spawns a probe and reads back what it
 * logged. This file keeps its own temporary directory and its own
 * `afterAll`, never the other suite's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { DRY_RUN_FLAG } from '../commands/next.js';

import { plantProjectConfig } from './cli-capture.js';
import {
  BASE, CONFIG_TEXT, OLD_BRANCH, PR_DETAIL, PR_NUMBER, PR_SUMMARY,
  type Scratch,
  SRC_DIR, git, makeTempBase, runProbe, writeStandInGh,
} from './next-chain-fixtures.js';

/** A temporary directory this file's own scratch repositories sit under. */
const tempBase = makeTempBase('rafa-next-chain-zero-checks-');

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The workflow count `pr merge --skip-checks` reads for the merge case: zero, the no-workflow reading. */
const NO_WORKFLOW_COUNT = 0;

/** The roadmap body for this probe: no `- [ ] #<n>` line, so a merge that lands reads back to `nothing-left`. */
const ROADMAP_BODY_DONE = '';

/** What one zero-checks probe is built over. */
interface ZeroChecksProbeOptions {
  /** What GitHub says about merging the pull request: `mergeable` proposes `merge-unchecked`, `conflicting` proposes `triage`. */
  readonly mergeable: 'mergeable' | 'conflicting';
  /** The workflow count `pr merge --skip-checks` reads, when it is read at all. */
  readonly workflowCount: number | null;
  /** Scripted answers for `pr merge`'s own unchecked question, in order; a call past the end throws. */
  readonly mergeAnswers: readonly string[];
}

/**
 * The probe for a zero-checks pull request: `rafa next` and a real
 * `pr merge`, over a pull request double answering verdict `none` and
 * `options.mergeable`, and a scripted prompter standing in for
 * `pr merge`'s own question — the only one any case here answers, since
 * `rafa next`'s own question is handed over for `merge-unchecked` and
 * never reached for `triage` under `--dry-run`.
 */
function buildZeroChecksProbe(options: ZeroChecksProbeOptions): string {
  return [
    'import { writeFileSync } from "node:fs";',
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createNextCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'next.ts'))};`,
    `import { createPrMergeCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'pr', 'merge.ts'))};`,
    `import { createGitRunner } from ${JSON.stringify(join(SRC_DIR, 'pr', 'index.ts'))};`,
    `import { createPullRequestsDouble } from ${JSON.stringify(join(SRC_DIR, 'pr', 'pull-requests-double.ts'))};`,
    '',
    'const [recordPath, ...nextArgv] = process.argv.slice(2);',
    'const events = [];',
    '',
    `const BASE = ${JSON.stringify(BASE)};`,
    `const OLD_BRANCH = ${JSON.stringify(OLD_BRANCH)};`,
    '',
    '/** The real git runner, wrapped to push every call onto the shared log before running it. */',
    'function wrapGit(root) {',
    '  const real = createGitRunner(root);',
    '  return (args) => {',
    '    events.push("git " + args.join(" "));',
    '    return real(args);',
    '  };',
    '}',
    '',
    '/** A prompter printing the question it is asked, to stderr, then answering one scripted line per `ask`, throwing once it runs out. */',
    'function scriptedPrompter(answers) {',
    '  let index = 0;',
    '  return {',
    '    say: () => {},',
    '    ask: async (question) => {',
    '      process.stderr.write(question);',
    '      if (index >= answers.length) throw new Error("the scripted merge prompter ran out of answers");',
    '      return answers[index++];',
    '    },',
    '    close: () => {},',
    '  };',
    '}',
    '',
    `const summary = ${JSON.stringify(PR_SUMMARY)};`,
    `const detail = { ...${JSON.stringify(PR_DETAIL)}, mergeable: ${JSON.stringify(options.mergeable)} };`,
    `const workflowCount = ${JSON.stringify(options.workflowCount)};`,
    `const mergeAnswers = ${JSON.stringify(options.mergeAnswers)};`,
    '',
    'const prDouble = createPullRequestsDouble({',
    '  findOpen: (branch) => Promise.resolve(branch === OLD_BRANCH ? summary : null),',
    '  get: () => Promise.resolve(detail),',
    '  checks: () => Promise.resolve({ rows: [], verdict: "none" }),',
    '  workflowCount: () => Promise.resolve(workflowCount),',
    '  merge: () => {',
    '    events.push("merge");',
    '    return Promise.resolve({ merged: true, detail: "Squashed and merged pull request" });',
    '  },',
    '  comment: (number, body) => {',
    '    events.push("comment");',
    '    return Promise.resolve({',
    '      id: "1",',
    '      author: { login: "rafa", isBot: true },',
    '      body,',
    '      updatedAt: "2026-09-22T11:00:00Z",',
    '      url: "https://example.invalid/pull/" + number + "#comment-1",',
    '    });',
    '  },',
    '});',
    '',
    'const nextCommand = createNextCommand({',
    '  isTerminal: () => true,',
    '  openGit: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  openPrompter: () => {',
    '    throw new Error("rafa next opened a prompter: this probe scripts only pr merge\'s own question");',
    '  },',
    '});',
    '',
    'const mergeCommand = createPrMergeCommand({',
    '  git: wrapGit,',
    '  pullRequests: () => prDouble.pulls,',
    '  isTerminal: () => true,',
    '  openPrompter: () => scriptedPrompter(mergeAnswers),',
    '});',
    '',
    'const commands = createCommandRegistry({',
    '  subjects: [{ name: "pr", summary: "pull requests" }],',
    '  commands: [nextCommand, mergeCommand],',
    '});',
    '',
    'let outcome = { ok: false };',
    'try {',
    '  const result = await dispatch(["next", ...nextArgv], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode, result: result.result };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/** Plants a zero-checks scratch repository the same shape as the other suite's own, scripted with `options`. */
function plantZeroChecksScratch(options: ZeroChecksProbeOptions): Scratch {
  const root = mkdtempSync(join(tempBase, 'repo-zero-'));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  expect(git(root, home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare).ok).toBe(true);
  expect(git(root, home, 'init', '-q', `--initial-branch=${BASE}`, work).ok).toBe(true);
  writeFileSync(join(work, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(work, 'README.md'), 'a scratch repository for the zero-checks suite\n', 'utf8');
  expect(git(work, home, 'add', '.gitignore', 'README.md').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'first').ok).toBe(true);
  expect(git(work, home, 'remote', 'add', 'origin', bare).ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BASE).ok).toBe(true);
  expect(git(work, home, 'switch', '-q', '-c', OLD_BRANCH).ok).toBe(true);
  writeFileSync(join(work, 'feature.txt'), 'a feature\n', 'utf8');
  expect(git(work, home, 'add', 'feature.txt').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'feature').ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', OLD_BRANCH).ok).toBe(true);
  plantProjectConfig(work, CONFIG_TEXT);

  writeStandInGh(bin, ROADMAP_BODY_DONE);

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
  const path = [bin, dirname(gitBinary)].join(delimiter);

  const probe = join(root, 'probe.ts');
  writeFileSync(probe, buildZeroChecksProbe(options), 'utf8');

  return { root, work, home, probe, path };
}

describe('rafa next, over a pull request reporting no check at all', () => {
  it('still proposes triage for a conflicting zero-checks pull request, changing nothing under --dry-run', () => {
    const scratch = plantZeroChecksScratch({ mergeable: 'conflicting', workflowCount: null, mergeAnswers: [] });
    const before = { head: git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout };

    const { record, stdout } = runProbe(scratch, ['--dry-run']);

    if (!record.outcome.ok) {
      throw new Error(`--dry-run did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }
    // Every git call the read made was read-only: no merge ran.
    expect(record.events.every((event) => event.startsWith('git '))).toBe(true);

    expect(stdout).toContain(`#${PR_NUMBER} is open on \`${OLD_BRANCH}\` and conflicts with \`${BASE}\``);
    expect(stdout).toContain(`triage #${PR_NUMBER}`);
    expect(stdout).toContain(`⏹ --${DRY_RUN_FLAG}: nothing ran.`);

    expect({ head: git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout }).toEqual(before);
  }, 30_000);

  it('proposes merging without checks for a mergeable zero-checks pull request under --dry-run, and changes nothing', () => {
    const scratch = plantZeroChecksScratch({ mergeable: 'mergeable', workflowCount: null, mergeAnswers: [] });
    const before = { head: git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout };

    const { record, stdout } = runProbe(scratch, ['--dry-run']);

    if (!record.outcome.ok) {
      throw new Error(`--dry-run did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }
    expect(record.events.every((event) => event.startsWith('git '))).toBe(true);

    expect(stdout).toContain(`#${PR_NUMBER} is open on \`${OLD_BRANCH}\`, reports no check at all and merges into \`${BASE}\``);
    expect(stdout).toContain(`merge #${PR_NUMBER} into \`${BASE}\` with no checks — rafa pr merge ${PR_NUMBER} --skip-checks`);
    expect(stdout).toContain(`⏹ --${DRY_RUN_FLAG}: nothing ran.`);

    expect({ head: git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout }).toEqual(before);
  }, 30_000);

  it('merges a mergeable zero-checks pull request once its own question is answered y, with rafa next asking none of its own', () => {
    const scratch = plantZeroChecksScratch({ mergeable: 'mergeable', workflowCount: NO_WORKFLOW_COUNT, mergeAnswers: ['y'] });

    const { record, stdout, stderr } = runProbe(scratch, []);

    if (!record.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(record.outcome)}`);
    }
    expect(record.events).toContain('merge');

    // `rafa next` hands the question over rather than asking its own:
    // the proposal names the command, and what follows is `pr merge`'s
    // own warning and question, not a second `[y/N]` of the chain's.
    expect(stdout).toContain(`merge #${PR_NUMBER} into \`${BASE}\` with no checks — rafa pr merge ${PR_NUMBER} --skip-checks`);
    expect(stdout).toContain('nothing on GitHub has tested this branch');
    expect(stderr).toContain(`Merge #${PR_NUMBER} with no checks? [y/N]`);
    expect(stdout).toContain(`Merged #${PR_NUMBER} into ${BASE}`);

    // Read off real git, not the log: the branch really moved and the
    // old one is really gone on both sides.
    expect(git(scratch.work, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(BASE);
    expect(git(scratch.work, scratch.home, 'branch', '--list', OLD_BRANCH).stdout).toBe('');
    expect(git(join(scratch.root, 'origin.git'), scratch.home, 'show-ref', '--verify', `refs/heads/${OLD_BRANCH}`).ok).toBe(false);
  }, 30_000);
});
