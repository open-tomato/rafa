/**
 * A spawned `bun` probe running `rafa next --roadmap --yes=hop,plan,start,home`
 * over ONE two-board fixture — board Alpha (#10), epic Alpha (#100,
 * `horizon:now`) listing H (#103), and board Beta (#20), epic Beta (#200,
 * `horizon:now`) listing D (#205) then C (#203) — from a fresh hop all
 * the way to a started loop and back home, the four steps its `--yes`
 * list names run one after another with no question put.
 *
 * `next-roadmap-hop-cli.test.ts` proves the hop alone, over `runRafa` and
 * a real `gh` stand-in, since neither `plan create` nor `loop start` is
 * ever reached there. This file reaches both, so it cannot run the
 * REGISTERED `rafa` binary: a real `plan create` would spawn a real
 * Claude Code planner session, and a real `loop start` a real task
 * loop. It borrows `next-chain-integration.test.ts`'s own answer to
 * that — a small program of its own, spawned as a probe, composing the
 * real `next`, `switch` and `plan create` commands over a stand-in
 * planner adapter and a stand-in `loop start` that opens a real session
 * record through `openRunSession` (`src/start/session.ts`) and then
 * "opens" the pull request that closes C by rewriting the file the
 * stand-in `gh`'s `pr list` answers from — never a real branch, a real
 * session or a real pull request, since nothing this suite checks reads
 * either.
 *
 * The position file is planted at home (`epic #100 on board #10`)
 * before the probe runs, rather than left absent: `hop`'s own record
 * reads home off the position file when there is one
 * (`homeOf`, `src/next/hop-rows.ts`), and off a plainer fallback that
 * carries no epic when there is not, which would read as a different
 * place from the one the real `switch` command resolves once it runs
 * and stale the record on the very turn that opens it. Starting from an
 * already-planted home is the ordinary shape of a checkout that has
 * used `rafa switch` before, and it is what every later assertion here
 * — the position ending home, the hop record closing `waiting` rather
 * than staling out — depends on holding true from the first turn.
 *
 * D (#205), epic Beta's own first checklist line, is ready and would be
 * planned by an ordinary walk into that epic; it is there so the run's
 * one assertion that the chain PLANS C can be read against a line the
 * walk would otherwise have reached first, rather than against an
 * epic with nothing else in it.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { SPEC_LABEL } from '../board/issue.js';
import { planStub } from '../board/naming.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { parseSessionRecord, runsDir } from '../loop/sessions.js';
import { hopFilePath, readHopRecord } from '../next/hop-record.js';
import { positionFilePath } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, eventsOf, type ScratchRepo } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { SRC_DIR } from './next-chain-fixtures.js';
import { scratchHomeEnv } from './scratch-home-env.js';
import { completeSpecBody } from './spec-bodies.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-roadmap-loop-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the probe may take: several sequential local `gh` and `git` reads, and one plan write, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** Board Alpha, the default board, and its `horizon:now` epic. */
const BOARD_A = 10;
const EPIC_A = 100;

/** H: epic Alpha's one checklist line, blocked by C. */
const H = 103;

/** Board Beta, holding the epic C is a member of. */
const BOARD_B = 20;
const EPIC_B = 200;

/** D: epic Beta's own first checklist line, ready but never the hop's pick; see the module note. */
const D = 205;
const D_TITLE = 'Beta first thing';

/** C: H's blocker, epic Beta's second checklist line, open, unblocked and ready. */
const C = 203;
const C_TITLE = 'Fix the blocker';

/** The pull request the stand-in `loop start` opens, closing C. */
const PR_NUMBER = 555;

/** C's plan stub, `planStub` derives the same way `plan create` does off the issue it reads. */
const C_STUB = planStub(C, C_TITLE);

/** The plan `loop start` runs once `plan create` has written it. */
const PLAN_PATH = `.rafa/plans/PLAN-${C_STUB}.md`;

/** One `gh issue view`/`issue list` row, labels already named. */
function issueRow(number: number, title: string, body: string, labels: readonly string[]): object {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })), author: { login: AUTHOR_LOGIN } };
}

const ISSUES = [
  issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
  issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(H)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
  issueRow(H, 'H, blocked by C', `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
  issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
  issueRow(EPIC_B, 'Beta work', `- [ ] #${String(D)}\n- [ ] #${String(C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
  issueRow(D, D_TITLE, completeSpecBody(D_TITLE), [SPEC_LABEL, SPEC_READY_LABEL, 'epic:beta']),
  issueRow(C, C_TITLE, completeSpecBody(C_TITLE), [SPEC_LABEL, SPEC_READY_LABEL, 'epic:beta']),
];

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository, so
 * the branch scan's remote half never fails and warns onto stdout, and
 * home base for the fixture's git reads is real; `next-roadmap-hop-cli.test.ts`'s own.
 */
function gitSetup(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the `type:roadmap`
 * listing, one `issue view` answer per fixture issue, the whole listing
 * for `issue list --state all`, and `pr list` served off `prlistFile`,
 * a file the probe's stand-in `loop start` rewrites once it "opens" C's
 * pull request. `--head <branch>` is answered empty always: nothing
 * this suite plants is ever open on the branch the checkout stays on.
 * Anything else unplanned fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo, prlistFile: string): void {
  const labelled = ISSUES.filter((issue) => (issue as { readonly labels: readonly { readonly name: string }[] }).labels
    .some((label) => label.name === 'type:roadmap'));
  const data = join(dirname(scratch.repo), 'data');
  const labelledFile = join(data, 'labelled.json');
  const allFile = join(data, 'all.json');
  mkdirSync(data, { recursive: true });
  writeFileSync(labelledFile, JSON.stringify(labelled), 'utf8');
  writeFileSync(allFile, JSON.stringify(ISSUES), 'utf8');
  writeFileSync(prlistFile, '[]', 'utf8');
  for (const issue of ISSUES) {
    const { number } = issue as { readonly number: number };
    writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
  }
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(labelledFile)}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--head "*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    '  "issue view")',
    `    f='${data}'"/view-$3.json"`,
    '    if [ -f "$f" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$f"',
    '    else',
    '      echo "unplanned issue view: $3" >&2; exit 1',
    '    fi',
    '    ;;',
    `  "pr list") ${printFile(prlistFile)};;`,
    `  "issue list") ${printFile(allFile)};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** Plants `.rafa/position.json` at home, both current and previous there too; see the module note. */
function plantHomePosition(scratch: ScratchRepo): void {
  const home = { board: BOARD_A, epic: EPIC_A };
  writeFileSync(positionFilePath(scratch.repo), `${JSON.stringify({ current: home, previous: home, home }, null, 2)}\n`, 'utf8');
}

/**
 * The probe: a program composing the real `next`, `switch` and `plan
 * create` commands, a stand-in planner adapter and a stand-in `loop
 * start`, over one `dispatch(["next", ...words])`. `words` are the
 * probe's own `argv` past the record path. See the module note for what
 * each stand-in does and why.
 */
function buildProbe(prlistFile: string): string {
  return [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `import { createAdapterRegistry } from ${JSON.stringify(join(SRC_DIR, 'adapters', 'registry.ts'))};`,
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createNextCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'next.ts'))};`,
    `import { createSwitchCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'switch.ts'))};`,
    `import planCreateDeclared from ${JSON.stringify(join(SRC_DIR, 'commands', 'plan', 'create.ts'))};`,
    `import { wrapPhaseZeroCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'wrap.ts'))};`,
    `import plan from ${JSON.stringify(join(SRC_DIR, 'plan.ts'))};`,
    `import { openRunSession } from ${JSON.stringify(join(SRC_DIR, 'start', 'session.ts'))};`,
    `import { planStubFromPath } from ${JSON.stringify(join(SRC_DIR, 'utils', 'plan-stamp.ts'))};`,
    '',
    'const [recordPath, ...nextArgv] = process.argv.slice(2);',
    'const events = [];',
    '',
    `const PR_LIST_FILE = ${JSON.stringify(prlistFile)};`,
    `const C = ${String(C)};`,
    `const PR_NUMBER = ${String(PR_NUMBER)};`,
    `const BASE = ${JSON.stringify('main')};`,
    `const AUTHOR_LOGIN = ${JSON.stringify(AUTHOR_LOGIN)};`,
    '',
    '/** The stand-in planner session `plan create` resolves in place of a real Claude Code session. */',
    'const plannerRegistry = createAdapterRegistry([{',
    '  port: "planner",',
    '  kind: "claude",',
    '  portVersion: 1,',
    '  create: (context) => ({',
    '    create: async (request) => {',
    '      events.push("plan create " + request.stub);',
    '      const planPath = context.planDir + "/PLAN-" + request.stub + ".md";',
    '      mkdirSync(join(context.repoRoot, context.planDir), { recursive: true });',
    '      writeFileSync(',
    '        join(context.repoRoot, planPath),',
    '        "# Plan\\n\\n```rafa:plan\\nstub: " + request.stub + "\\n```\\n\\n- [ ] one task\\n",',
    '      );',
    '      return { planPath, prerequisitesPath: null };',
    '    },',
    '  }),',
    '}]);',
    '',
    'const nextCommand = createNextCommand({',
    '  isTerminal: () => false,',
    '  openPrompter: () => {',
    '    throw new Error("rafa next opened a prompter: this run always allows enough of --yes to go unasked");',
    '  },',
    '});',
    '',
    'const switchCommand = createSwitchCommand();',
    '',
    'const planCommand = wrapPhaseZeroCommand(',
    '  planCreateDeclared,',
    '  (words, root) => plan(words, root, plannerRegistry),',
    ');',
    '',
    '/**',
    ' * A stand-in for `rafa loop start`: opens a real session record',
    ' * through `openRunSession`, ends it `done`, then "opens" the pull',
    ' * request that closes C by rewriting what the stand-in `gh`\'s `pr',
    ' * list` answers from. No session is spawned and no branch is cut,',
    ' * since nothing this suite checks reads either.',
    ' */',
    'const loopStartCommand = {',
    '  name: "loop start",',
    '  subject: "loop",',
    '  action: "start",',
    '  summary: "a stand-in that opens a real session record and opens the pull request that closes C",',
    '  description: "Opens the run\'s session record through the real openRunSession, stamping the away hop under --roadmap, then writes the pull request gh pr list answers for C.",',
    '  args: [],',
    '  flags: [',
    '    { name: "plan", description: "the plan file", type: "string" },',
    '    { name: "create-branch", description: "creates the branch", type: "boolean" },',
    '    { name: "roadmap", description: "stamps the away hop", type: "boolean" },',
    '  ],',
    '  examples: [{ cmd: "rafa loop start --plan=P.md --create-branch --roadmap", note: "records it" }],',
    '  outputs: ["text"],',
    '  run: async (context) => {',
    '    const planPath = String(context.flags.plan || "");',
    '    const stub = planStubFromPath(planPath);',
    '    if (stub === null) throw new Error("the stand-in loop start read no stub from " + planPath);',
    '    const branch = "feat/" + stub;',
    '    const session = openRunSession({',
    '      repoRoot: context.project.root,',
    '      planPath,',
    '      planStub: stub,',
    '      branch,',
    '      roadmap: context.flags.roadmap === true,',
    '    });',
    '    session.finished();',
    '    session.end();',
    '    events.push("loop start " + session.id);',
    '    writeFileSync(PR_LIST_FILE, JSON.stringify([{',
    '      number: PR_NUMBER,',
    '      headRefName: branch,',
    '      baseRefName: BASE,',
    '      body: "Closes #" + C,',
    '      title: "the pull request that closes #" + C,',
    '      url: "https://example.invalid/pull/" + PR_NUMBER,',
    '      state: "OPEN",',
    '      author: { login: AUTHOR_LOGIN, isBot: false },',
    '      isCrossRepository: false,',
    '      updatedAt: "2026-01-01T00:00:00Z",',
    '    }]));',
    '    events.push("open pr " + PR_NUMBER);',
    '  },',
    '};',
    '',
    'const commands = createCommandRegistry({',
    '  subjects: [',
    '    { name: "plan", summary: "plans" },',
    '    { name: "loop", summary: "the loop" },',
    '  ],',
    '  commands: [nextCommand, switchCommand, planCommand, loopStartCommand],',
    '});',
    '',
    'let outcome = { ok: false };',
    'try {',
    '  const result = await dispatch(["next", ...nextArgv], { registry: commands });',
    '  outcome = { ok: result.exitCode === 0, exitCode: result.exitCode };',
    '} catch (error) {',
    '  outcome = { ok: false, error: String((error && error.message) || error) };',
    '} finally {',
    '  writeFileSync(recordPath, JSON.stringify({ events, outcome }));',
    '}',
    '',
  ].join('\n');
}

/** A scratch repository, planted, committed and pushed, its `gh` stand-in serving the fixture, ready for the probe. */
interface LoopScratch {
  readonly scratch: ScratchRepo;
  readonly probe: string;
}

function plantScratch(): LoopScratch {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`);
  gitSetup(scratch);
  plantHomePosition(scratch);
  const prlistFile = join(dirname(scratch.repo), 'data', 'prlist.json');
  writeGhStub(scratch, prlistFile);
  const probe = join(dirname(scratch.repo), 'probe.ts');
  writeFileSync(probe, buildProbe(prlistFile), 'utf8');
  return { scratch, probe };
}

/** One spawn of the probe: its record and its captured stdout (the events `next --output=json` printed). */
function runProbe(loop: LoopScratch, words: readonly string[]): { readonly events: readonly string[]; readonly outcome: { readonly ok: boolean }; readonly stdout: string } {
  const recordPath = join(dirname(loop.scratch.repo), 'record.json');
  const proc = Bun.spawnSync([process.execPath, loop.probe, recordPath, ...words], {
    cwd: loop.scratch.repo,
    env: { PATH: loop.scratch.path, ...scratchHomeEnv(loop.scratch.home), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' },
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0 || !existsSync(recordPath)) {
    throw new Error(`the probe exited ${String(proc.exitCode)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { readonly events: readonly string[]; readonly outcome: { readonly ok: boolean } };
  return { ...record, stdout };
}

describe('rafa next --roadmap --yes=hop,plan,start,home, from a fresh hop to a started loop and back home, spawned', () => {
  it('hops to C, plans C rather than epic Beta\'s own first line, runs the loop, and ends home with the hop waiting', RUN_TIMEOUT, () => {
    const loop = plantScratch();

    const run = runProbe(loop, ['--roadmap', '--yes=hop,plan,start,home', '--output=json']);

    if (!run.outcome.ok) {
      throw new Error(`the chain did not end cleanly: ${JSON.stringify(run.outcome)}`);
    }

    // The hop, then the plan for C by name (never D's), then the loop
    // and the pull request it opens, in that order.
    const events = eventsOf(run.stdout);
    const messages = events.filter((event) => event.type === 'log').map((event) => (event as { message: string }).message);
    const joined = messages.join('\n');

    expect(joined).toContain(`hop from epic #${String(EPIC_A)}: #${String(H)} blocked by #${String(C)}, in epic #${String(EPIC_B)}`);
    expect(joined).toContain(`🧭 Away on a hop: issue #${String(C)}, the blocker of #${String(H)}, in epic #${String(EPIC_B)} on board #${String(BOARD_B)}`);
    expect(joined).toContain(`▶ Next on the hop: issue #${String(C)}`);
    expect(joined).not.toContain(`issue #${String(D)}`);
    expect(run.events).toEqual([`plan create ${C_STUB}`, expect.stringMatching(/^loop start /), `open pr ${String(PR_NUMBER)}`]);

    // The json result carries the hop and the home step, in order, only under --roadmap.
    const result = events.find((event) => event.type === 'result') as { data?: { hops?: readonly unknown[] } } | undefined;
    const hops = result?.data?.hops ?? [];
    expect(hops).toHaveLength(2);
    expect(hops[0]).toMatchObject({ action: 'hop', opening: { target: C, blocked: H, targetEpic: EPIC_B, targetBoard: BOARD_B } });
    expect(hops[1]).toMatchObject({ action: 'home', closing: 'waiting', pullRequest: PR_NUMBER });

    // The position is back home, exactly where it started.
    const position = JSON.parse(readFileSync(positionFilePath(loop.scratch.repo), 'utf8')) as {
      readonly current: { readonly board: number; readonly epic: number | null };
      readonly home: { readonly board: number; readonly epic: number | null };
    };
    expect(position.current).toEqual({ board: BOARD_A, epic: EPIC_A });
    expect(position.home).toEqual({ board: BOARD_A, epic: EPIC_A });

    // The hop record closed waiting, naming the pull request the stand-in loop opened.
    const closed = readHopRecord(loop.scratch.repo);
    if (!closed.set) throw new Error(`the hop record did not read: ${closed.detail}`);
    expect(closed.record.state).toBe('waiting');
    expect(closed.record.pullRequest).toBe(PR_NUMBER);
    expect(existsSync(hopFilePath(loop.scratch.repo))).toBe(true);

    // The session record the stand-in `loop start` wrote carries the away hop as its own `hop` field.
    const runs = readdirSync(runsDir(loop.scratch.repo)).filter((name) => name.endsWith('.json'));
    expect(runs).toHaveLength(1);
    const sessionFile = join(runsDir(loop.scratch.repo), runs[0] ?? '');
    const session = parseSessionRecord(readFileSync(sessionFile, 'utf8'), sessionFile);
    expect(session.hop).toBeDefined();
    expect(session.hop?.blocked).toBe(H);
    expect(session.hop?.target).toBe(C);
    expect(session.plan).toBe(PLAN_PATH);
  });
});
