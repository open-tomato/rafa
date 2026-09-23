/**
 * Tests for `rafa skill search` and `rafa agent search`
 * (`src/commands/skill/search.ts`, `src/commands/agent/search.ts`): the
 * ranking `--no-model` prints, the kept match and the dropped line of a
 * stubbed session, the unanswerable and fallback outputs, `--all`, the
 * json result, the effort row, the refusals and the `spends`
 * declaration.
 *
 * Every dispatched case plants a project, a home and a runtime of its
 * own under a temporary directory of this file's own and dispatches the
 * command in-process (`src/tests/cli-capture.ts`) with a
 * `CapturingSpawner` double as its spawn seam, so no case starts a real
 * session or reads the real home.
 *
 * ## The controls
 *
 * That `--no-model` spawns nothing is held with a spawner that fails the
 * case when hit, beside the same line without `--no-model`, which hits a
 * recording one. That `--all` adds the agent session is held beside the
 * same question without it, which runs one. That the effort row reaches
 * the configured store is held beside a session that leaves no log,
 * whose run says the row was not stored.
 */
import type { SearchCommandResult } from './search.js';
import type { CapturedSession, CapturingSpawner } from '../../utils/claude.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sessionLogDir } from '../../effort/collect.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';
import { createAgentSearchCommand } from '../agent/search.js';

import { createSkillSearchCommand, rankingLines } from './search.js';

/** The subjects the dispatched cases route through. */
const SUBJECTS = [
  { name: 'skill', summary: 'search skills' },
  { name: 'agent', summary: 'search agents' },
];

/** The question most cases ask: it ranks documentation, changelog-notes and the reviewer agent. */
const QUESTION = 'who writes TSDoc comments for exported symbols';

/** The line the true quote sits on in the documentation file. */
const TRUE_LINE = 8;

/** The sentence on {@link TRUE_LINE}. */
const TRUE_QUOTE = 'Every exported symbol carries a TSDoc block.';

/** The id every stubbed session runs under. */
const SESSION_ID = '5ea4c400-0000-4000-8000-0000000000bb';

const DOCUMENTATION = [
  '---',
  'name: documentation',
  'description: Owns TSDoc blocks and inline comment rules.',
  'tags: [tsdoc]',
  '---',
  '# Documentation',
  '',
  TRUE_QUOTE,
  'Inline comments say why, never what.',
  '',
].join('\n');

const CHANGELOG = [
  '---',
  'name: changelog-notes',
  'description: Writes the change notes for exported symbols a release renders.',
  '---',
  '# Changelog notes',
  '',
  'One line per change a user would notice.',
  '',
].join('\n');

const DOCKER = [
  '---',
  'name: docker-images',
  'description: Builds container images with a pinned base.',
  '---',
  'Pin the base image by digest.',
  '',
].join('\n');

const REVIEWER = [
  '---',
  'name: reviewer',
  'description: Reviews TSDoc comments on exported symbols.',
  '---',
  'Reviews code.',
  '',
].join('\n');

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-search-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What one case plants: a project, a home, a runtime and a scratch root. */
interface Planted {
  readonly root: string;
  readonly home: string;
  readonly entry: string;
  readonly scratchRoot: string;
}

/** Plants one case's tree: three project skills and one project agent. */
function plant(): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const entry = join(scope, 'runtime', 'cli.js');
  const scratchRoot = join(scope, 'scratch');
  plantProjectConfig(root, 'version: 1\nloop:\n  settingSources: project,local\n');
  for (const dir of [home, scratchRoot, dirname(entry)]) mkdirSync(dir, { recursive: true });
  writeFileSync(entry, '// the runtime\n', 'utf8');
  const files: Readonly<Record<string, string>> = {
    '.claude/skills/documentation/SKILL.md': DOCUMENTATION,
    '.claude/skills/changelog-notes/SKILL.md': CHANGELOG,
    '.claude/skills/docker-images/SKILL.md': DOCKER,
    '.claude/agents/reviewer.md': REVIEWER,
  };
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, entry, scratchRoot };
}

/** What one stubbed spawn was handed. */
interface SpawnCall {
  readonly args: readonly string[];
  readonly prompt: string;
}

/** How the stub answers, and whether it leaves a session log where Claude Code would. */
interface StubOptions {
  readonly answer: (prompt: string) => CapturedSession;
  readonly log?: boolean;
}

/** A spawner double recording each call; see the module note. */
function stubSpawner(tree: Planted, options: StubOptions): { spawn: CapturingSpawner; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: CapturingSpawner = (args, prompt, spawnOptions) => {
    calls.push({ args, prompt });
    const cwd = spawnOptions?.cwd;
    if (options.log === true && cwd !== undefined) {
      const dir = sessionLogDir(realpathSync(cwd), tree.home);
      mkdirSync(dir, { recursive: true });
      const records = [
        { type: 'queue-operation', operation: 'enqueue', content: prompt },
        {
          type: 'assistant',
          timestamp: '2026-09-24T09:00:00.000Z',
          gitBranch: 'main',
          entrypoint: 'sdk-cli',
          isSidechain: false,
          message: { model: 'claude-haiku-4-5', usage: { input_tokens: 900, output_tokens: 210 } },
        },
      ];
      writeFileSync(join(dir, `${SESSION_ID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    }
    return Promise.resolve(options.answer(prompt));
  };
  return { spawn, calls };
}

/** A spawner that fails the case when it is hit. */
const refusingSpawner: CapturingSpawner = () => {
  throw new Error('the stub was spawned');
};

/** An answer exiting 0 whose stdout ends with a `rafa:search` block of `body`. */
function block(body: readonly string[]): CapturedSession {
  return { exitCode: 0, stdout: ['Found them.', '', '```rafa:search', ...body, '```', ''].join('\n') };
}

/** A block keeping the true quote on documentation and inventing one on changelog-notes. */
const ONE_TRUE_ONE_INVENTED = block([
  'matches:',
  '  - name: documentation',
  '    why: "owns TSDoc blocks"',
  `    quote: "${TRUE_QUOTE}"`,
  `    line: ${String(TRUE_LINE)}`,
  '  - name: changelog-notes',
  '    why: "writes notes"',
  '    quote: "Every change note carries a TSDoc block"',
  '    line: 7',
  'unanswerable: false',
]);

/** Dispatches `words` over both search commands with `spawn` as their seam. */
async function run(words: readonly string[], tree: Planted, spawn: CapturingSpawner) {
  const seams = {
    entry: () => tree.entry,
    modules: {},
    spawn,
    scratchRoot: tree.scratchRoot,
    sessionId: () => SESSION_ID,
  };
  const commands = [createSkillSearchCommand(seams), createAgentSearchCommand(seams)];
  return dispatchInProject(words, SUBJECTS, commands, { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The data of the result event a json run ends with. */
function resultData(stdout: string): SearchCommandResult {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as unknown as { data: SearchCommandResult };
  return result.data;
}

describe('rafa skill search --no-model', () => {
  it('prints the keyword ranking and spawns nothing', async () => {
    const tree = plant();
    const outcome = await run(['skill', 'search', QUESTION, '--no-model'], tree, refusingSpawner);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Skills for "${QUESTION}" (project: ${tree.root}; keyword ranking, no session):`);
    expect(outcome.stdout).toMatch(/1\. documentation +project +score \d+ +Owns TSDoc blocks/);
    expect(outcome.stdout).toContain('changelog-notes');
    expect(outcome.stdout).not.toContain('docker-images');
    expect(readdirSync(tree.scratchRoot)).toEqual([]);
  });

  it('spawns a session for the same line without --no-model, the control', async () => {
    const tree = plant();
    const { spawn, calls } = stubSpawner(tree, { answer: () => ONE_TRUE_ONE_INVENTED });
    const outcome = await run(['skill', 'search', QUESTION], tree, spawn);

    expect(outcome.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('gives the ranking as status ranked with model false in json mode', async () => {
    const tree = plant();
    const outcome = await run(['skill', 'search', QUESTION, '--no-model', '--output=json'], tree, refusingSpawner);
    const data = resultData(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(data.model).toBe(false);
    expect(data.question).toBe(QUESTION);
    expect(data.searches.map((search) => [search.kind, search.status])).toEqual([['skill', 'ranked']]);
    expect(data.searches[0]?.ranking.map((ranked) => ranked.record.name)).toEqual(['documentation', 'changelog-notes']);
  });
});

describe('rafa skill search over a stubbed session', () => {
  it('prints the one true match with its quote and the line "1 match dropped"', async () => {
    const tree = plant();
    const { spawn, calls } = stubSpawner(tree, { answer: () => ONE_TRUE_ONE_INVENTED });
    const outcome = await run(['skill', 'search', QUESTION], tree, spawn);
    const documentation = join(tree.root, '.claude', 'skills', 'documentation', 'SKILL.md');

    expect(outcome.exitCode).toBe(0);
    expect(calls[0]?.args).toContain('Read,Grep,Glob');
    expect(outcome.stdout).toContain('  documentation (project): owns TSDoc blocks\n');
    expect(outcome.stdout).toContain(`    "${TRUE_QUOTE}" (${documentation}:${String(TRUE_LINE)})\n`);
    expect(outcome.stdout).not.toContain('changelog-notes (project)');
    expect(outcome.stdout).toContain('1 match dropped: its quote is not in the file\n');
    expect(readdirSync(tree.scratchRoot)).toEqual([]);
  });

  it('prints the unanswerable line when the session says so', async () => {
    const tree = plant();
    const { spawn } = stubSpawner(tree, { answer: () => block(['matches: []', 'unanswerable: true']) });
    const outcome = await run(['skill', 'search', QUESTION], tree, spawn);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('  not answerable from these files\n');
    expect(outcome.stdout).not.toContain('match dropped');
  });

  it('warns and prints the ranking when the session writes no block', async () => {
    const tree = plant();
    const { spawn } = stubSpawner(tree, { answer: () => ({ exitCode: 0, stdout: 'I could not decide.\n' }) });
    const outcome = await run(['skill', 'search', QUESTION], tree, spawn);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toMatch(/warn: .*showing the keyword ranking instead/);
    expect(outcome.stdout).toMatch(/1\. documentation +project +score \d+/);
  });

  it('starts no session and says so when no skill ranks', async () => {
    const tree = plant();
    const outcome = await run(['skill', 'search', 'kubernetes helm charts'], tree, refusingSpawner);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('  (no skill ranks for these words)\n');
  });

  it('stores the search row in the configured store when the session left its log', async () => {
    const tree = plant();
    const { spawn } = stubSpawner(tree, { answer: () => ONE_TRUE_ONE_INVENTED, log: true });
    const outcome = await run(['skill', 'search', QUESTION, '--output=json'], tree, spawn);
    const search = resultData(outcome.stdout).searches[0];
    const effort = search !== undefined && 'effort' in search
      ? search.effort
      : null;

    expect(outcome.exitCode).toBe(0);
    expect(effort?.written).toBe(true);
    const storePath = effort?.written === true
      ? effort.storePath
      : '';
    expect(storePath.startsWith(tree.root)).toBe(true);
    expect(readFileSync(storePath, 'utf8')).toContain('"kind":"search"');
  });

  it('warns that the row was not stored when the session left no log, the control', async () => {
    const tree = plant();
    const { spawn } = stubSpawner(tree, { answer: () => ONE_TRUE_ONE_INVENTED });
    const outcome = await run(['skill', 'search', QUESTION], tree, spawn);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('warn: the skill search session\'s effort row was not stored: no session log at');
  });
});

describe('rafa skill search --all and rafa agent search', () => {
  /** Answers the agent session with reviewer and the skill session with the true quote. */
  function byKind(prompt: string): CapturedSession {
    return prompt.includes('- reviewer:')
      ? block(['matches:', '  - name: reviewer', '    why: "reviews TSDoc"', '    quote: "Reviews code."', '    line: 5', 'unanswerable: false'])
      : ONE_TRUE_ONE_INVENTED;
  }

  it('runs one session per kind under --all, skills first', async () => {
    const tree = plant();
    const { spawn, calls } = stubSpawner(tree, { answer: byKind });
    const outcome = await run(['skill', 'search', QUESTION, '--all'], tree, spawn);

    expect(outcome.exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.prompt).toContain('- documentation:');
    expect(calls[1]?.prompt).toContain('- reviewer:');
    expect(outcome.stdout.indexOf('Skills for')).toBeLessThan(outcome.stdout.indexOf('Agents for'));
    expect(outcome.stdout).toContain('  reviewer (project): reviews TSDoc\n');
  });

  it('searches agents alone with rafa agent search, and agents first under --all', async () => {
    const tree = plant();
    const { spawn, calls } = stubSpawner(tree, { answer: byKind });
    const alone = await run(['agent', 'search', QUESTION, '--no-model', '--output=json'], tree, refusingSpawner);
    const both = await run(['agent', 'search', QUESTION, '--all', '--output=json'], tree, spawn);

    expect(resultData(alone.stdout).searches.map((search) => search.kind)).toEqual(['agent']);
    expect(resultData(alone.stdout).searches[0]?.ranking.map((ranked) => ranked.record.name)).toEqual(['reviewer']);
    expect(resultData(both.stdout).searches.map((search) => [search.kind, search.status])).toEqual([
      ['agent', 'answered'],
      ['skill', 'answered'],
    ]);
    expect(calls).toHaveLength(2);
  });
});

describe('the refusals', () => {
  it.each([
    ['no question', ['skill', 'search'], 'Expected one argument, got none'],
    ['two questions', ['skill', 'search', 'one', 'two'], 'Expected one argument, got 2'],
    ['a blank question', ['skill', 'search', '  '], 'The question is blank'],
    ['a question read into --all', ['skill', 'search', '--all', QUESTION], '--all takes no value'],
    ['a value given to --model', ['skill', 'search', QUESTION, '--model=opus'], '--model takes no value'],
  ])('refuses %s with exit code 1 and starts no session', async (_name, words, message) => {
    const tree = plant();
    const outcome = await run(words, tree, refusingSpawner);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout + outcome.stderr).toContain(message);
  });
});

describe('the declarations', () => {
  it('declares spends unless --no-model on both commands', () => {
    for (const command of [createSkillSearchCommand(), createAgentSearchCommand()]) {
      expect(command.spends).toEqual({ when: 'unless', flag: '--no-model', what: 'one search session' });
      expect(command.flags.map((flag) => flag.name)).toEqual(['all', 'model']);
    }
  });

  it('numbers the ranking rows and pads each column', () => {
    const record = { kind: 'skill', source: 'project', summary: 'S', path: '/x' } as const;
    const lines = rankingLines([
      { record: { ...record, name: 'a' } as never, score: 12, words: [], fields: [] },
      { record: { ...record, name: 'longer' } as never, score: 3, words: [], fields: [] },
    ]);

    expect(lines).toEqual(['  1. a       project  score 12  S', '  2. longer  project  score 3   S']);
  });
});
