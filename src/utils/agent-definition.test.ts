/**
 * Tests for reading a routed agent's definition.
 *
 * Every case plants its definitions under this file's own temporary
 * directory, one `repo` and one `home` per case, and the first case
 * asserts the paths looked at resolve there: in the loop the second
 * root is the real home, and a case that lost a root would read it.
 * The one live reading is this repo's own `.claude/agents/`, whose
 * files the lookup has to be able to find by the names they carry.
 *
 * Most claims here are a file PASSED OVER, and a lookup answering null
 * for every name satisfies each of those. So each such case also plants
 * the file that does answer, in the same body, and asserts it is found.
 *
 * The home is searched only under setting sources that name `user`, so
 * every case reading a home definition hands over {@link WITH_USER}.
 * The cases under `the setting sources` read the same roots under
 * {@link WITHOUT_USER}, the loop's default, beside `WITH_USER`, so a
 * home left unread is a reading and not a definition nothing planted.
 * Two legs over that rule were run once each against this file and the
 * six other suites that reach the sources, each restored
 * sha256-identical: searching the home whatever the sources say reddened
 * the three cases here that read under `WITHOUT_USER`, and never
 * searching it reddened ten.
 *
 * ## The mutation grid
 *
 * Eighteen mutations of `utils/agent-definition.ts` were driven against
 * this file and the suites that use the module, each run TWICE with the
 * failing case names identical on both passes and the module restored
 * byte-identical after each, and every one reddened at least one case
 * here. The first fourteen left four cases unreached, all four positive
 * readings no leg had aimed at: the vendored frontmatter read, an effort
 * answered true, `null` answered false, and a lookup answering from its
 * own roots. Four more legs reach them — a frontmatter body losing its
 * first line (17 cases here), no definition ever declaring (6), no
 * definition read as declaring (2), and a lookup caching its answer by
 * name across roots (1) — and the union covers all 22.
 *
 * The narrow legs name what each refusal rests on. Dropping the
 * bare-name check, the frontmatter `name` check, the null-and-empty
 * effort rule or the unvalidated level, finding the opening fence
 * anywhere, closing at the last fence, reading a sequence as a mapping,
 * reading an unclosed block as empty, letting a YAML error propagate
 * and leaving CRLF unsplit each redden 1 or 2 cases here. Searching the
 * home first reddens 3, dropping the home 7, letting a read error
 * propagate 6, and swapping the lookup's roots 1.
 */
import type {
  AgentDefinition,
  AgentDefinitionCandidate,
  AgentDefinitionRoots,
} from './agent-definition.js';
import type { ClaudeSettingSource } from '../config.js';

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  agentDefinitionCandidates,
  agentEffortLookup,
  declaresEffort,
  findAgentDefinition,
  readFrontmatter,
} from './agent-definition.js';

/** This repo's root, whose own definitions the last case reads. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Setting sources naming the user scope, so the home is searched. */
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** The sources a run with no config resolves to, leaving the user scope out. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-agent-definition-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh pair of roots under this file's temporary directory. */
function freshRoots(): AgentDefinitionRoots {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return { repoRoot: join(base, 'repo'), home: join(base, 'home') };
}

/** A definition whose frontmatter holds `lines`, then a body. */
function definitionText(...lines: string[]): string {
  return ['---', ...lines, '---', 'The agent body.', ''].join('\n');
}

/** Writes `text` as `<root>/.claude/agents/<file>` and answers its path. */
function plant(root: string, file: string, text: string): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, text, 'utf8');
  return path;
}

/** A definition record carrying `frontmatter`, read from nowhere. */
function definitionOf(frontmatter: Record<string, unknown>): AgentDefinition {
  return {
    name: 'doc-updater',
    scope: 'project',
    path: join(tempBase, 'never-read.md'),
    frontmatter,
  };
}

describe('where a definition is looked for', () => {
  it('looks under the repo root, then under the home', () => {
    const roots = freshRoots();
    const candidates = agentDefinitionCandidates('doc-updater', roots, WITH_USER);

    expect(candidates).toEqual([
      { scope: 'project', path: join(roots.repoRoot, '.claude', 'agents', 'doc-updater.md') },
      { scope: 'user', path: join(roots.home, '.claude', 'agents', 'doc-updater.md') },
    ]);
    for (const candidate of candidates) {
      expect(candidate.path.startsWith(tempBase)).toBe(true);
    }
  });

  it('looks nowhere for a name that is not a bare file stem', () => {
    const roots = freshRoots();
    plant(roots.repoRoot, 'inside.md', definitionText('name: inside'));
    // One directory up from the agents, reachable only by a name
    // holding a path, and naming itself exactly that.
    writeFileSync(
      join(roots.repoRoot, '.claude', 'outside.md'),
      definitionText('name: ../outside'),
      'utf8',
    );

    expect(agentDefinitionCandidates('../outside', roots, WITH_USER)).toEqual([]);
    expect(findAgentDefinition('../outside', roots, WITH_USER)).toBeNull();
    expect(findAgentDefinition('inside', roots, WITH_USER)?.scope).toBe('project');
  });
});

describe('findAgentDefinition', () => {
  it('takes the project definition over a user-level one of the same name', () => {
    const roots = freshRoots();
    const project = plant(roots.repoRoot, 'doc-updater.md', definitionText('name: doc-updater', 'model: haiku'));
    plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater', 'model: opus'));

    const found = findAgentDefinition('doc-updater', roots, WITH_USER);

    expect(found?.scope).toBe('project');
    expect(found?.path).toBe(project);
    expect(found?.frontmatter['model']).toBe('haiku');
  });

  it('falls back to the user-level definition', () => {
    const roots = freshRoots();
    const user = plant(roots.home, 'tdd-guide.md', definitionText('name: tdd-guide'));

    expect(findAgentDefinition('tdd-guide', roots, WITH_USER)).toEqual({
      name: 'tdd-guide',
      scope: 'user',
      path: user,
      frontmatter: { name: 'tdd-guide' },
    });
  });

  it('answers null when neither root holds the name', () => {
    const roots = freshRoots();

    expect(findAgentDefinition('code-reviewer', roots, WITH_USER)).toBeNull();

    plant(roots.home, 'code-reviewer.md', definitionText('name: code-reviewer'));
    expect(findAgentDefinition('code-reviewer', roots, WITH_USER)?.scope).toBe('user');
  });

  it('passes over a file whose frontmatter names another agent', () => {
    const roots = freshRoots();
    plant(roots.repoRoot, 'doc-updater.md', definitionText('name: other-name'));

    expect(findAgentDefinition('doc-updater', roots, WITH_USER)).toBeNull();
    expect(findAgentDefinition('other-name', roots, WITH_USER)).toBeNull();

    const user = plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater'));
    expect(findAgentDefinition('doc-updater', roots, WITH_USER)?.path).toBe(user);
  });

  it('passes over a file whose frontmatter carries no name', () => {
    const roots = freshRoots();
    plant(roots.repoRoot, 'doc-updater.md', definitionText('model: haiku'));

    expect(findAgentDefinition('doc-updater', roots, WITH_USER)).toBeNull();

    const user = plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater'));
    expect(findAgentDefinition('doc-updater', roots, WITH_USER)?.path).toBe(user);
  });

  it('passes over a directory where a file was expected', () => {
    const roots = freshRoots();
    mkdirSync(join(roots.repoRoot, '.claude', 'agents', 'doc-updater.md'), { recursive: true });
    const user = plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater'));

    expect(findAgentDefinition('doc-updater', roots, WITH_USER)?.path).toBe(user);
  });
});

describe('readFrontmatter', () => {
  it('reads the block the vendored definitions open with', () => {
    const text = definitionText(
      'name: tdd-guide',
      'tools: ["Read", "Write", "Grep"]',
      'model: sonnet',
    );

    expect(readFrontmatter(text)).toEqual({
      name: 'tdd-guide',
      tools: ['Read', 'Write', 'Grep'],
      model: 'sonnet',
    });
  });

  it('reads a block written with CRLF line endings', () => {
    const text = ['---', 'name: tdd-guide', 'effort: low', '---', 'Body.', ''].join('\r\n');

    expect(readFrontmatter(text)).toEqual({ name: 'tdd-guide', effort: 'low' });
  });

  it('closes the block at its first closing fence', () => {
    const text = ['---', 'name: tdd-guide', '---', '---', 'effort: high', '---', ''].join('\n');

    expect(readFrontmatter(text)).toEqual({ name: 'tdd-guide' });
  });

  it('answers null for a file that does not open with a fence', () => {
    const block = definitionText('name: tdd-guide');

    expect(readFrontmatter(`\n${block}`)).toBeNull();
    expect(readFrontmatter('name: tdd-guide\n')).toBeNull();
    expect(readFrontmatter(block)).toEqual({ name: 'tdd-guide' });
  });

  it('answers null for a block that never closes', () => {
    expect(readFrontmatter('---\nname: tdd-guide\n')).toBeNull();
    expect(readFrontmatter('---\nname: tdd-guide\n---')).toEqual({ name: 'tdd-guide' });
  });

  it('answers null for a block that is not a YAML mapping', () => {
    expect(readFrontmatter(definitionText('- Read', '- Grep'))).toBeNull();
    expect(readFrontmatter(definitionText())).toBeNull();
    expect(readFrontmatter(definitionText('description: Probe: answers one literal'))).toBeNull();
    expect(readFrontmatter(definitionText('description: "Probe: answers one literal"')))
      .toEqual({ description: 'Probe: answers one literal' });
  });
});

describe('declaresEffort', () => {
  it('answers true for a definition carrying an effort', () => {
    expect(declaresEffort(definitionOf({ name: 'doc-updater', effort: 'high' }))).toBe(true);
  });

  it('answers false for an effort key that is missing, null or empty', () => {
    expect(declaresEffort(definitionOf({ name: 'doc-updater' }))).toBe(false);
    expect(declaresEffort(definitionOf({ name: 'doc-updater', effort: null }))).toBe(false);
    expect(declaresEffort(definitionOf({ name: 'doc-updater', effort: '' }))).toBe(false);
    expect(declaresEffort(definitionOf({ name: 'doc-updater', effort: 'low' }))).toBe(true);
  });

  it('takes a level the CLI flag would refuse at its word', () => {
    expect(declaresEffort(definitionOf({ name: 'doc-updater', effort: 'medum' }))).toBe(true);
  });

  it('answers false for no definition', () => {
    expect(declaresEffort(null)).toBe(false);
  });
});

describe('agentEffortLookup', () => {
  it('answers from the roots it was built over', () => {
    const declaring = freshRoots();
    const silent = freshRoots();
    plant(declaring.repoRoot, 'doc-updater.md', definitionText('name: doc-updater', 'effort: high'));
    plant(silent.repoRoot, 'doc-updater.md', definitionText('name: doc-updater'));

    expect(agentEffortLookup(declaring, WITH_USER)('doc-updater')).toBe(true);
    expect(agentEffortLookup(silent, WITH_USER)('doc-updater')).toBe(false);
  });

  it('reads the effort off the definition that shadows, not the one shadowed', () => {
    const roots = freshRoots();
    plant(roots.repoRoot, 'doc-updater.md', definitionText('name: doc-updater'));
    plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater', 'effort: high'));
    plant(roots.repoRoot, 'tdd-guide.md', definitionText('name: tdd-guide', 'effort: low'));
    plant(roots.home, 'tdd-guide.md', definitionText('name: tdd-guide'));
    const lookup = agentEffortLookup(roots, WITH_USER);

    expect(lookup('doc-updater')).toBe(false);
    expect(lookup('tdd-guide')).toBe(true);
  });

  it('answers false for a name neither root holds', () => {
    const roots = freshRoots();
    plant(roots.home, 'code-reviewer.md', definitionText('name: code-reviewer', 'effort: max'));
    const lookup = agentEffortLookup(roots, WITH_USER);

    expect(lookup('loop-implementer')).toBe(false);
    expect(lookup('code-reviewer')).toBe(true);
  });
});

describe('the setting sources', () => {
  it('looks under the home only when the sources include user', () => {
    const roots = freshRoots();
    const project: AgentDefinitionCandidate = { scope: 'project', path: join(roots.repoRoot, '.claude', 'agents', 'doc-updater.md') };
    const user: AgentDefinitionCandidate = { scope: 'user', path: join(roots.home, '.claude', 'agents', 'doc-updater.md') };

    expect(agentDefinitionCandidates('doc-updater', roots, WITHOUT_USER)).toEqual([project]);
    expect(agentDefinitionCandidates('doc-updater', roots, ['project', 'user'])).toEqual([project, user]);
    expect(agentDefinitionCandidates('doc-updater', roots, WITH_USER)).toEqual([project, user]);
  });

  it('finds no user-level definition under sources without user', () => {
    const roots = freshRoots();
    const user = plant(roots.home, 'tdd-guide.md', definitionText('name: tdd-guide'));

    expect(findAgentDefinition('tdd-guide', roots, WITHOUT_USER)).toBeNull();
    expect(findAgentDefinition('tdd-guide', roots, WITH_USER)?.path).toBe(user);
  });

  it('still takes the project definition under sources without user', () => {
    const roots = freshRoots();
    const project = plant(roots.repoRoot, 'doc-updater.md', definitionText('name: doc-updater'));
    plant(roots.home, 'doc-updater.md', definitionText('name: doc-updater', 'effort: high'));

    expect(findAgentDefinition('doc-updater', roots, WITHOUT_USER)?.path).toBe(project);
  });

  it('reads no effort off a user-level definition under sources without user', () => {
    const roots = freshRoots();
    plant(roots.home, 'code-reviewer.md', definitionText('name: code-reviewer', 'effort: max'));

    expect(agentEffortLookup(roots, WITHOUT_USER)('code-reviewer')).toBe(false);
    expect(agentEffortLookup(roots, WITH_USER)('code-reviewer')).toBe(true);
  });
});

describe('the definitions under this repo', () => {
  it('each resolves by the name its file carries', () => {
    const agentsDir = join(REPO_ROOT, '.claude', 'agents');
    const names = readdirSync(agentsDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -'.md'.length));
    const roots = { repoRoot: REPO_ROOT, home: join(tempBase, 'empty-home') };

    for (const name of names) {
      expect(findAgentDefinition(name, roots, WITHOUT_USER)?.scope).toBe('project');
    }
    for (const routed of ['doc-updater', 'tdd-guide', 'build-error-resolver', 'code-reviewer', 'loop-implementer']) {
      expect(names).toContain(routed);
    }
  });
});
