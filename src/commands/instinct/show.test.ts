/**
 * Tests for `rafa instinct show <id>`
 * (`src/commands/instinct/show.ts`): the fields one record prints, the
 * scope that answers when both hold the id, and the two refusals.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own, and dispatches the command
 * in-process with streams, an environment and a working directory of
 * its own (`src/tests/cli-capture.ts`), so nothing reads the real
 * `~/.rafa/instincts`.
 *
 * ## The controls
 *
 * That the project scope answers an id both scopes hold is held BESIDE
 * the same id shown from a tree where only the home holds it, which
 * answers the user scope: a lookup that read one scope alone would
 * pass the first half and fail the second.
 *
 * That a half-written record is refused is held BESIDE a clean record
 * in the same scope, which is shown and exits 0: a command that
 * refused everything would pass the first half on its own.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { actionHash, ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createInstinctShowCommand, evidenceLine, unknownIdMessage } from './show.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'show one record the instinct scopes hold' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-show-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The action every fixture carries. */
const ACTION = 'Run `bun install` before the first test.';

/** The cause every fixture carries. */
const CAUSE = 'Worktree creation copies the tree and not its packages.';

/** A record whose every field is one nothing refuses, evidence included. */
function recordText(id: string, scope: string): string {
  return [
    '---',
    `id: ${id}`,
    'trigger: when running tests in a freshly forked worktree',
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'usage_count: 3',
    'artifact: Cannot find package',
    'signal: loud',
    `scope: ${scope}`,
    'source: task-report',
    'evidence:',
    '  - plan: my-feature',
    '    outcome: blocked',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    ACTION,
    '',
    CAUSE_HEADING,
    CAUSE,
    '',
  ].join('\n');
}

/** The same record without the two optional fields and with no evidence. */
function sparseRecordText(id: string, scope: string): string {
  return recordText(id, scope)
    .replace('artifact: Cannot find package\n', '')
    .replace('evidence:\n  - plan: my-feature\n    outcome: blocked\n', '')
    .replace('source: task-report', 'source: loop-observed');
}

/** What one case plants: a project and a home, each with its own instincts. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
}

/** Plants one case's tree. A key ending in `/` is an empty directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root);
  mkdirSync(home, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    if (name.endsWith('/')) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home };
}

/** Dispatches `words` over the command, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  const command = createInstinctShowCommand();
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

describe('what one record prints', () => {
  it('writes an evidence entry as its keys in the order the file wrote them', () => {
    expect(evidenceLine({ plan: 'my-feature', outcome: 'blocked', count: 2 }))
      .toBe('plan: my-feature, outcome: blocked, count: 2');
  });

  it('names every scope it looked in when no record is filed under the id', () => {
    const message = unknownIdMessage('gone', [
      { scope: 'project', dir: '/p/.rafa/instincts', exists: true, records: [] },
      { scope: 'user', dir: '/h/.rafa/instincts', exists: false, records: [] },
    ]);

    expect(message).toContain('No instinct is filed under "gone"');
    expect(message).toContain('  project  /p/.rafa/instincts');
    expect(message).toContain('  user  /h/.rafa/instincts  (no such directory)');
  });

  it('prints the fields, the two sections, the evidence and the computed action hash', async () => {
    const tree = plant({ 'home/.rafa/instincts/bun-install.md': recordText('bun-install', 'user') });

    const answered = await run(['instinct', 'show', 'bun-install'], tree);
    const lines = answered.stdout.split('\n');

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(lines[0]).toBe('bun-install  (user scope)');
    expect(lines[1]).toBe(join(tree.home, '.rafa', 'instincts', 'bun-install.md'));
    expect(answered.stdout).toContain('  trigger     when running tests in a freshly forked worktree');
    expect(answered.stdout).toContain('  usage_count 3');
    expect(answered.stdout).toContain('  artifact    Cannot find package');
    expect(answered.stdout).toContain(`  action_hash ${actionHash(ACTION)}`);
    expect(answered.stdout).toContain(`${ACTION_HEADING}\n${ACTION}`);
    expect(answered.stdout).toContain(`${CAUSE_HEADING}\n${CAUSE}`);
    expect(answered.stdout).toContain('Evidence (1):');
    expect(answered.stdout).toContain('  - plan: my-feature, outcome: blocked');
  });

  it('leaves out a field the record omits and says so for an evidence-free record', async () => {
    const tree = plant({ 'home/.rafa/instincts/sparse.md': sparseRecordText('sparse', 'user') });

    const answered = await run(['instinct', 'show', 'sparse'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).not.toContain('artifact');
    expect(answered.stdout).not.toContain('project_id');
    expect(answered.stdout).toContain('Evidence: none');
  });
});

describe('which scope answers', () => {
  it('shows the project record and names the user scope holding the same id', async () => {
    const tree = plant({
      'project/.rafa/instincts/shared.md': recordText('shared', 'project'),
      'home/.rafa/instincts/shared.md': recordText('shared', 'user'),
    });

    const answered = await run(['instinct', 'show', 'shared'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('shared  (project scope)');
    expect(answered.stdout).toContain('Also filed under this id in the user scope.');
  });

  it('shows the user record when the project scope holds no such id', async () => {
    const tree = plant({
      'project/.rafa/instincts/other.md': recordText('other', 'project'),
      'home/.rafa/instincts/shared.md': recordText('shared', 'user'),
    });

    const answered = await run(['instinct', 'show', 'shared'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('shared  (user scope)');
    expect(answered.stdout).not.toContain('Also filed under this id');
  });

  it('gives the record as the data of the terminal result event', async () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project') });

    const answered = await run(['instinct', 'show', 'bun-install', '--output=json'], tree);
    const result = eventsOf(answered.stdout).find((event) => event.type === 'result');
    const data = result?.data as { id: string; scope: string; instinct: { actionHash: string; usageCount: number } };

    expect(answered.exitCode).toBe(0);
    expect(data.id).toBe('bun-install');
    expect(data.scope).toBe('project');
    expect(data.instinct.usageCount).toBe(3);
    expect(data.instinct.actionHash).toBe(actionHash(ACTION));
  });
});

describe('the refusals', () => {
  it('refuses an id no scope holds, naming both scopes, beside a record it shows', async () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project') });

    const shown = await run(['instinct', 'show', 'bun-install'], tree);
    const answered = await run(['instinct', 'show', 'gate-order'], tree);

    expect(shown.exitCode).toBe(0);
    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('No instinct is filed under "gate-order"');
    expect(answered.stderr).toContain(join(tree.root, '.rafa', 'instincts'));
    expect(answered.stderr).toContain(`${join(tree.home, '.rafa', 'instincts')}  (no such directory)`);
  });

  it('refuses a record that broke a rule, naming its issues', async () => {
    const tree = plant({
      'project/.rafa/instincts/half.md': '---\nid: half\nkind: gotcha\n---\n\n## Action\nDo it.\n',
    });

    const answered = await run(['instinct', 'show', 'half'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('is no record:');
    expect(answered.stderr).toContain('trigger:');
    expect(answered.stderr).toContain('Run `rafa instinct check` on the scope');
  });

  it('refuses a line naming no id and one naming two', async () => {
    const tree = plant({ 'project/.rafa/instincts/': '' });

    const none = await run(['instinct', 'show'], tree);
    const two = await run(['instinct', 'show', 'one', 'two'], tree);

    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('Usage: rafa instinct show <id>');
    expect(two.exitCode).toBe(1);
    expect(two.stderr).toContain('Usage: rafa instinct show <id>');
  });
});
