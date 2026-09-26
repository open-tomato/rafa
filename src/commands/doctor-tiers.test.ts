/**
 * Tests for the skill tier rows of `rafa doctor` (`./doctor-tiers.ts`).
 *
 * One world is planted under this file's temporary directory and built
 * with `buildInventory`, so every row is read off a real `resolveTiers`
 * outcome, not one written by hand. It holds:
 *
 *   - two collisions once `user` is loaded: skill `clash` in the project
 *     and the home, and agent `tdd-guide` in rafa and the home, each
 *     pair with different bodies;
 *   - copies: skill `documentation` byte-identical in the project and
 *     rafa, skill `twin` byte-identical in the project and the home, and
 *     agent `linked`, a project link to the rafa file, which is the
 *     control for "a link is not a copy";
 *   - provenance: rafa agent `borrowed`, third-party with no `reviewed`;
 *     rafa skill `vetted`, third-party and reviewed, as the control;
 *     rafa skill `misspelt`, with `review:` for `reviewed:`; and an
 *     add-on skill `lent`, third-party with no `reviewed`;
 *   - home skill `homemade` with no `provenance`, and home skill `owned`
 *     marked `first-party`, as the control.
 *
 * Each reading that depends on `loop.settingSources` is taken with and
 * without `user`, so a row that is absent is absent for its reason and
 * not because nothing was read.
 */
import type { ClaudeSettingSource } from '../config-sections.js';
import type { InventorySeams } from '../inventory/index.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { SKILL_USE_CLI_VERSION } from '../effort/skill-use.js';
import { buildInventory } from '../inventory/index.js';
import { SERVE_CLI_VERSION } from '../tiers/delivery.js';

import { renderDeepRow } from './doctor-deep-row.js';
import {
  cliVersionRows,
  doctorTierRows,
  parseClaudeVersion,
  readClaudeVersion,
  readDoctorTiers,
  renderDoctorTiers,
  skillUseVersionRows,
  TIERS_SECTION_TITLE,
} from './doctor-tiers.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-tiers-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const addonDir = join(base, 'modules', 'lender');
const bin = join(base, 'bin');

const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

const UNREVIEWED = 'provenance:\n  origin: https://example.com/agents\n  license: MIT';
const REVIEWED = `${UNREVIEWED}\n  reviewed: marcos 2026-09-24`;
const MISSPELT = `${UNREVIEWED}\n  review: marcos 2026-09-24`;

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill the checker passes, with `extra` frontmatter lines and `body`. */
function skill(name: string, extra = '', body = 'Read each exit code.'): string {
  const lines = extra === ''
    ? ''
    : `${extra}\n`;
  return `---\nname: ${name}\ndescription: Run the gates in order and read each exit code\n${lines}---\n\n${body}\n`;
}

/** An agent definition keyed by `name`, with `extra` frontmatter lines and `body`. */
function agent(name: string, extra = '', body = 'Review the diff.'): string {
  const lines = extra === ''
    ? ''
    : `${extra}\n`;
  return `---\nname: ${name}\ndescription: Reviews one diff\n${lines}---\n\n${body}\n`;
}

// rafa, beside its entry.
write(join(runtime, 'cli.js'), '');
write(join(runtime, 'bundled/agents/tdd-guide.md'), agent('tdd-guide', 'provenance: first-party', 'Write the test first.'));
write(join(runtime, 'bundled/agents/linked.md'), agent('linked', 'provenance: first-party'));
write(join(runtime, 'bundled/agents/borrowed.md'), agent('borrowed', UNREVIEWED));
write(join(runtime, 'bundled/skills/documentation/SKILL.md'), skill('documentation', 'provenance: first-party'));
write(join(runtime, 'bundled/skills/vetted/SKILL.md'), skill('vetted', REVIEWED));
write(join(runtime, 'bundled/skills/misspelt/SKILL.md'), skill('misspelt', MISSPELT));

// The project.
write(join(projectRoot, '.claude/skills/clash/SKILL.md'), skill('clash', '', 'The project\'s way.'));
write(join(projectRoot, '.claude/skills/documentation/SKILL.md'), skill('documentation', 'provenance: first-party'));
write(join(projectRoot, '.claude/skills/twin/SKILL.md'), skill('twin'));
mkdirSync(join(projectRoot, '.claude/agents'), { recursive: true });
symlinkSync(join(runtime, 'bundled/agents/linked.md'), join(projectRoot, '.claude/agents/linked.md'));

// The home.
write(join(home, '.claude/skills/clash/SKILL.md'), skill('clash', 'provenance: first-party', 'The home\'s way.'));
write(join(home, '.claude/skills/twin/SKILL.md'), skill('twin'));
write(join(home, '.claude/skills/homemade/SKILL.md'), skill('homemade'));
write(join(home, '.claude/skills/owned/SKILL.md'), skill('owned', 'provenance: first-party'));
write(join(home, '.claude/agents/tdd-guide.md'), agent('tdd-guide', 'provenance: first-party', 'Write the code first.'));

// One loaded add-on.
write(join(addonDir, 'package.json'), JSON.stringify({
  name: 'lender',
  version: '1.0.0',
  rafa: {
    manifestVersion: 1,
    types: ['skills'],
    provides: { skills: './skills' },
    requires: { rafa: '>=0.0.1', ports: {} },
  },
}));
write(join(addonDir, 'skills/lent/SKILL.md'), skill('lent', UNREVIEWED));

/** The planted world's seams under `settingSources`. */
function seams(settingSources: readonly ClaudeSettingSource[]): InventorySeams {
  return {
    home,
    projectRoot,
    entry: join(runtime, 'cli.js'),
    pathDirs: [],
    settingSources,
    modules: [{ name: 'lender', directory: addonDir, state: 'loaded' }],
  };
}

/** The rows of the planted world under `settingSources`, the pin matching. */
function rowsOf(settingSources: readonly ClaudeSettingSource[]) {
  return doctorTierRows(buildInventory(seams(settingSources)), SERVE_CLI_VERSION);
}

/** A row as `kind status name`, the fields the order and the selection are held to. */
function heads(rows: ReturnType<typeof rowsOf>): readonly string[] {
  return rows.map((row) => `${row.kind} ${row.status} ${row.name}`);
}

describe('doctorTierRows over the planted world', () => {
  it('lists every row, warnings first, with user loaded', () => {
    expect(heads(rowsOf(WITH_USER))).toEqual([
      'collision warn skill clash',
      'collision warn agent tdd-guide',
      'unreviewed warn skill lent',
      'unreviewed warn skill misspelt',
      'unreviewed warn agent borrowed',
      'copy note skill documentation',
      'copy note skill twin',
      'no-provenance note skill homemade',
      'no-provenance note skill twin',
    ]);
  });

  it('lists no collision, no user copy and no provenance note without user loaded', () => {
    // Control: the same world gives both collisions under WITH_USER above.
    expect(heads(rowsOf(WITHOUT_USER))).toEqual([
      'unreviewed warn skill lent',
      'unreviewed warn skill misspelt',
      'unreviewed warn agent borrowed',
      'copy note skill documentation',
    ]);
  });

  it('names both paths of a collision and gives the pin line as the fix', () => {
    const [clash, tdd] = rowsOf(WITH_USER);

    expect(clash?.detail).toBe('held by 2 loaded tiers with different contents: '
      + `project ${join(projectRoot, '.claude/skills/clash/SKILL.md')} and `
      + `user ${join(home, '.claude/skills/clash/SKILL.md')}; nothing serves it`);
    expect(clash?.fix).toBe('pin the tier that serves it: tiers.skills: { clash: user }');
    expect(tdd?.fix).toBe('pin the tier that serves it: tiers.agents: { tdd-guide: rafa }');
  });

  it('keeps the rafa holder of a copy and suggests deleting the project directory', () => {
    const copy = rowsOf(WITH_USER).find((row) => row.kind === 'copy' && row.name === 'skill documentation');
    const projectDir = join(projectRoot, '.claude/skills/documentation');

    expect(copy?.detail).toBe(`project ${join(projectDir, 'SKILL.md')} is byte-identical to `
      + `rafa ${join(runtime, 'bundled/skills/documentation/SKILL.md')}, vendoring header aside`);
    expect(copy?.fix).toBe(`delete ${projectDir} (only its SKILL.md was compared)`);
  });

  it('keeps the winner of a copy with no rafa holder and suggests deleting the farther one', () => {
    const copy = rowsOf(WITH_USER).find((row) => row.kind === 'copy' && row.name === 'skill twin');

    expect(copy?.detail.startsWith(`user ${join(home, '.claude/skills/twin/SKILL.md')} is byte-identical to project `))
      .toBe(true);
    expect(copy?.fix).toBe(`delete ${join(home, '.claude/skills/twin')} (only its SKILL.md was compared)`);
  });

  it('gives no row for a project link into the rafa tier, but one once the link is read as a file', () => {
    const inventory = buildInventory(seams(WITH_USER));
    const linked = inventory.resolution.items.find((item) => item.name === 'linked');

    // Control: the resolver does count the link a copy, so the row is left out by the link rule alone.
    expect(linked?.state === 'served' && linked.copies.length).toBe(1);
    expect(doctorTierRows(inventory, SERVE_CLI_VERSION).some((row) => row.name === 'agent linked')).toBe(false);

    const unresolved = doctorTierRows(inventory, SERVE_CLI_VERSION, { realPath: (path) => path });
    expect(unresolved.find((row) => row.name === 'agent linked')?.fix)
      .toBe(`delete ${join(projectRoot, '.claude/agents/linked.md')}`);
  });

  it('says why each unreviewed item is not served, and lists no reviewed one', () => {
    const rows = rowsOf(WITHOUT_USER).filter((row) => row.kind === 'unreviewed');
    const [lent, misspelt, borrowed] = rows;

    expect(lent?.detail).toBe(`addon:lender ${join(addonDir, 'skills/lent/SKILL.md')} is not served: `
      + 'it is third-party from https://example.com/agents with no reviewed');
    expect(lent?.fix).toBe('review it and add reviewed: <who> <YYYY-MM-DD> to its provenance');
    expect(misspelt?.detail.endsWith('is not served: its provenance does not pass the checker')).toBe(true);
    expect(misspelt?.fix).toBe('correct its provenance; rafa skill check names what is wrong');
    expect(borrowed?.detail.startsWith(`rafa ${join(runtime, 'bundled/agents/borrowed.md')}`)).toBe(true);
    // Control: vetted is a third-party rafa item too, and its reviewed keeps it out.
    expect(rows.some((row) => row.name === 'skill vetted')).toBe(false);
  });

  it('gives a user item with no provenance a note and a first-party one none', () => {
    const notes = rowsOf(WITH_USER).filter((row) => row.kind === 'no-provenance');

    expect(notes.map((row) => row.detail)).toEqual([
      `user ${join(home, '.claude/skills/homemade/SKILL.md')} carries no provenance, so where it came from is not recorded`,
      `user ${join(home, '.claude/skills/twin/SKILL.md')} carries no provenance, so where it came from is not recorded`,
    ]);
    expect(notes.some((row) => row.name === 'skill owned')).toBe(false);
    expect(notes.every((row) => row.fix === undefined)).toBe(true);
  });

  it('reads no file it cannot read as unreviewed or missing provenance', () => {
    const rows = doctorTierRows(buildInventory(seams(WITH_USER)), SERVE_CLI_VERSION, { readText: () => null });

    expect(rows.some((row) => row.kind === 'unreviewed' || row.kind === 'no-provenance')).toBe(false);
    // Control: the rows the resolver alone decides are still there.
    expect(rows.filter((row) => row.kind === 'collision')).toHaveLength(2);
  });
});

describe('the SERVE_CLI_VERSION pin', () => {
  it('gives no row when the installed version is the pin', () => {
    expect(cliVersionRows(SERVE_CLI_VERSION)).toEqual([]);
  });

  it('gives one warning naming both versions when they differ', () => {
    expect(cliVersionRows('2.1.999', '2.1.280')).toEqual([{
      kind: 'cli-version',
      status: 'warn',
      name: 'Claude Code',
      detail: '2.1.999 is installed, and skill delivery was probed against 2.1.280',
      fix: 'run the delivery probe again (context/inventory.md, "Serving") before trusting SERVE_CLI_VERSION',
    }]);
  });

  it('gives a note, not silence, when no version could be read', () => {
    expect(cliVersionRows(null, '2.1.280').map((row) => `${row.status} ${row.detail}`)).toEqual([
      'note its version could not be read from claude --version; skill delivery was probed against 2.1.280',
    ]);
  });

  it('places both pin warnings after the unreviewed rows and before the notes', () => {
    const rows = doctorTierRows(buildInventory(seams(WITHOUT_USER)), '9.9.9');

    expect(heads(rows).slice(2, 6)).toEqual([
      'unreviewed warn agent borrowed',
      'cli-version warn Claude Code',
      'skill-use-version warn Claude Code',
      'copy note skill documentation',
    ]);
  });

  it('parses the leading X.Y.Z of claude --version', () => {
    expect(parseClaudeVersion('2.1.280 (Claude Code)\n')).toBe('2.1.280');
    expect(parseClaudeVersion('Claude Code, no version')).toBeNull();
  });
});

describe('the SKILL_USE_CLI_VERSION pin', () => {
  it('gives no row when the installed version is the pin', () => {
    expect(skillUseVersionRows(SKILL_USE_CLI_VERSION)).toEqual([]);
  });

  it('gives one warning naming both versions when they differ', () => {
    expect(skillUseVersionRows('2.1.999', '2.1.280')).toEqual([{
      kind: 'skill-use-version',
      status: 'warn',
      name: 'Claude Code',
      detail: '2.1.999 is installed, and the skill-use collector reads logs of 2.1.280, '
        + 'so skill_invocations stores the skill counts of the sessions it logs as unknown',
      fix: 'record the skill-use fixture again under the installed version (src/effort/skill-use.ts) '
        + 'before moving SKILL_USE_CLI_VERSION',
    }]);
  });

  it('gives no second row when no version could be read, the cli-version note standing for both', () => {
    expect(skillUseVersionRows(null, '2.1.280')).toEqual([]);
    // Control: the unread version is still reported, once, by the delivery pin.
    expect(cliVersionRows(null, '2.1.280').map((row) => `${row.kind} ${row.status}`)).toEqual(['cli-version note']);
  });

  it('warns for the skill-use pin alone when only that pin differs from the installed version', () => {
    const rows = [...cliVersionRows('2.1.300', '2.1.300'), ...skillUseVersionRows('2.1.300', '2.1.280')];

    expect(rows.map((row) => row.kind)).toEqual(['skill-use-version']);
  });

  it('gives no pin row over the planted world when the installed version matches both pins', () => {
    // Guards the default arguments: rowsOf passes SERVE_CLI_VERSION, so this holds only while the pins agree.
    expect(SKILL_USE_CLI_VERSION).toBe(SERVE_CLI_VERSION);
    expect(rowsOf(WITHOUT_USER).some((row) => row.kind === 'cli-version' || row.kind === 'skill-use-version')).toBe(false);
  });
});

describe('readClaudeVersion with a stand-in claude', () => {
  /** Plants an executable `claude` in `dir` running `script`. */
  function plant(dir: string, script: string): void {
    write(join(dir, 'claude'), `#!/bin/sh\n${script}\n`);
    chmodSync(join(dir, 'claude'), 0o755);
  }

  it('reads the version of the claude on the PATH it is handed', async () => {
    plant(join(bin, 'answers'), 'echo "2.1.999 (Claude Code)"');

    expect(await readClaudeVersion({ PATH: join(bin, 'answers') }, base)).toBe('2.1.999');
  });

  it('reads no version when claude fails, and none when it is not on the PATH', async () => {
    plant(join(bin, 'fails'), 'echo "2.1.999 (Claude Code)"; exit 1');

    expect(await readClaudeVersion({ PATH: join(bin, 'fails') }, base)).toBeNull();
    expect(await readClaudeVersion({ PATH: join(bin, 'empty') }, base)).toBeNull();
  });
});

describe('readDoctorTiers and renderDoctorTiers', () => {
  it('builds the inventory, reads the version under the env and cwd it was handed, and renders a titled section', async () => {
    const calls: string[] = [];
    const reading = await readDoctorTiers({
      inventory: seams(WITH_USER),
      cwd: projectRoot,
      env: { PATH: '/stand-in' },
      readClaudeVersion: (env, cwd) => {
        calls.push(`${env['PATH'] ?? ''} ${cwd}`);
        return Promise.resolve('2.1.999');
      },
    });

    expect(calls).toEqual([`/stand-in ${projectRoot}`]);
    expect(reading.cliVersion).toBe('2.1.999');
    expect(reading.pinnedVersion).toBe(SERVE_CLI_VERSION);
    expect(reading.rows.filter((row) => row.kind === 'collision')).toHaveLength(2);

    const lines = renderDoctorTiers(reading);
    expect(lines[0]).toBe(`${TIERS_SECTION_TITLE}:`);
    expect(lines.slice(1)).toEqual(reading.rows.flatMap(renderDeepRow));
  });

  it('renders nothing for a reading with no row, and nothing for none', () => {
    expect(renderDoctorTiers({ cliVersion: SERVE_CLI_VERSION, pinnedVersion: SERVE_CLI_VERSION, rows: [] })).toEqual([]);
    expect(renderDoctorTiers(null)).toEqual([]);
  });
});
