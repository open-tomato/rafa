/**
 * Unit tests for the parity fixture resolver.
 *
 * Every case plants its fixture under a fresh temporary directory and
 * hands the resolver that directory as its home, with an explicit
 * environment, so the file reads the same on a machine holding the
 * sibling's logs and on one holding neither, and never touches the real
 * `~/.claude/` or the sibling checkout.
 *
 * Three properties carry the file.
 *
 *   - The defaults are pinned against the directory names MEASURED on
 *     the machine the parity stage was written on, restated here as
 *     literals rather than derived, so a silent edit of the checkout
 *     path or of the collector's encoding turns a case red.
 *   - Every absence shape is a row of {@link ABSENCE_CASES}, and each
 *     row first proves that the complete fixture it breaks answers
 *     present. That control is what says the absence came from the check
 *     the row aims at, not from a resolver answering absent regardless.
 *     The rows' codes are held equal to {@link PARITY_ABSENCE_CODES} as
 *     a set, so a code added later without a row fails here.
 *   - A machine holding neither fixture gets a one-line skip reason and
 *     no throw.
 *
 * The `unreadable` rows plant a permission-denied directory, which
 * running as root defeats, so they are skipped there rather than
 * reporting a false red.
 */
import type {
  ParityAbsence,
  ParityAbsenceCode,
  ParityFixture,
  ParityFixtureName,
} from './parity-fixture.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  PARITY_ABSENCE_CODES,
  PARITY_LOG_DIR_ENV,
  PARITY_STORE_DIR_ENV,
  parityFixturePaths,
  resolveParityFixture,
} from './parity-fixture.js';

/**
 * Running as root defeats a permission-denied plant, so the cases that
 * need one are skipped there rather than reporting a false red.
 */
const isRoot = process.getuid?.() === 0;

/** The one loose session log a complete planted fixture holds. */
const SESSION_ID = 'aaaa-1111';

/** Temporary directories to remove once each case is done. */
const scratch: string[] = [];

/** Directories a case locked, unlocked before the scratch is removed. */
const locked: string[] = [];

afterEach(() => {
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory that this file's afterEach will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-parity-'));
  scratch.push(dir);
  return dir;
}

/** Takes every permission off a directory until the case is done. */
function lock(dir: string): void {
  chmodSync(dir, 0o000);
  locked.push(dir);
}

/** A complete fixture under one scratch root, reached through both overrides. */
interface Planted {
  root: string;
  env: Record<string, string>;
  logDir: string;
  storeDir: string;
  sessionsPath: string;
  commitsPath: string;
}

/** Plants a complete fixture: one loose log, and both row files non-empty. */
function plantFixture(): Planted {
  const root = makeScratch();
  const logDir = join(root, 'logs');
  const storeDir = join(root, 'store');
  const sessionsPath = join(storeDir, 'sessions.ndjson');
  const commitsPath = join(storeDir, 'commits.ndjson');

  mkdirSync(logDir);
  mkdirSync(storeDir);
  writeFileSync(join(logDir, `${SESSION_ID}.jsonl`), '{}\n');
  writeFileSync(sessionsPath, `{"sessionId":"${SESSION_ID}"}\n`);
  writeFileSync(commitsPath, '{"sha":"0123abcd"}\n');

  return {
    root,
    env: { [PARITY_LOG_DIR_ENV]: logDir, [PARITY_STORE_DIR_ENV]: storeDir },
    logDir,
    storeDir,
    sessionsPath,
    commitsPath,
  };
}

/** Resolves a planted fixture, with its scratch root as the home directory. */
function resolvePlanted(
  tree: Planted,
  env: Record<string, string> = tree.env,
): ParityFixture {
  return resolveParityFixture({ env, home: tree.root });
}

/** The absences a fixture answered; none when it is present. */
function absencesOf(fixture: ParityFixture): ParityAbsence[] {
  return fixture.present
    ? []
    : fixture.absences;
}

/** The skip reason a fixture answered; null when it is present. */
function reasonOf(fixture: ParityFixture): string | null {
  return fixture.present
    ? null
    : fixture.reason;
}

/** Puts an empty file where a directory was. */
function replaceWithFile(path: string): void {
  rmSync(path, { recursive: true });
  writeFileSync(path, '');
}

/** Puts an empty directory where a file was. */
function replaceWithDirectory(path: string): void {
  rmSync(path);
  mkdirSync(path);
}

/** One way to break a complete fixture, and the absences it must answer. */
interface AbsenceCase {
  label: string;
  fixture: ParityFixtureName;
  code: ParityAbsenceCode;
  /** Breaks one thing in a complete fixture; answers the env to resolve. */
  breakFixture: (tree: Planted) => Record<string, string>;
  /** The paths the absences name, in the order they are reported. */
  paths: (tree: Planted) => string[];
  /** The error code an `unreadable` absence carries; null for the rest. */
  detail: string | null;
  /** A permission plant, which running as root defeats. */
  needsNonRoot: boolean;
}

const ABSENCE_CASES: readonly AbsenceCase[] = [
  {
    label: 'a relative log directory override',
    fixture: 'session logs',
    code: 'not-absolute',
    breakFixture: (tree) => ({ ...tree.env, [PARITY_LOG_DIR_ENV]: 'logs' }),
    paths: () => ['logs'],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a log directory that is not there',
    fixture: 'session logs',
    code: 'missing',
    breakFixture: (tree) => {
      rmSync(tree.logDir, { recursive: true });
      return tree.env;
    },
    paths: (tree) => [tree.logDir],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a log directory override running through a file',
    fixture: 'session logs',
    code: 'missing',
    breakFixture: (tree) => ({
      ...tree.env,
      [PARITY_LOG_DIR_ENV]: join(tree.logDir, `${SESSION_ID}.jsonl`, 'logs'),
    }),
    paths: (tree) => [join(tree.logDir, `${SESSION_ID}.jsonl`, 'logs')],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a file where the log directory should be',
    fixture: 'session logs',
    code: 'not-a-directory',
    breakFixture: (tree) => {
      replaceWithFile(tree.logDir);
      return tree.env;
    },
    paths: (tree) => [tree.logDir],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a log directory whose only log is a subagent transcript',
    fixture: 'session logs',
    code: 'no-session-log',
    breakFixture: (tree) => {
      const nested = join(tree.logDir, SESSION_ID, 'subagents');
      mkdirSync(nested, { recursive: true });
      renameSync(
        join(tree.logDir, `${SESSION_ID}.jsonl`),
        join(nested, 'agent-1.jsonl'),
      );
      writeFileSync(join(tree.logDir, 'notes.txt'), 'not a log\n');
      return tree.env;
    },
    paths: (tree) => [tree.logDir],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a log directory it may not list',
    fixture: 'session logs',
    code: 'unreadable',
    breakFixture: (tree) => {
      lock(tree.logDir);
      return tree.env;
    },
    paths: (tree) => [tree.logDir],
    detail: 'EACCES',
    needsNonRoot: true,
  },
  {
    label: 'a relative stored-row override',
    fixture: 'stored rows',
    code: 'not-absolute',
    breakFixture: (tree) => ({ ...tree.env, [PARITY_STORE_DIR_ENV]: 'store' }),
    paths: () => ['store'],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a stored-row directory that is not there',
    fixture: 'stored rows',
    code: 'missing',
    breakFixture: (tree) => {
      rmSync(tree.storeDir, { recursive: true });
      return tree.env;
    },
    paths: (tree) => [tree.storeDir],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a file where the stored-row directory should be',
    fixture: 'stored rows',
    code: 'not-a-directory',
    breakFixture: (tree) => {
      replaceWithFile(tree.storeDir);
      return tree.env;
    },
    paths: (tree) => [tree.storeDir],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a store holding no commit rows file',
    fixture: 'stored rows',
    code: 'missing',
    breakFixture: (tree) => {
      rmSync(tree.commitsPath);
      return tree.env;
    },
    paths: (tree) => [tree.commitsPath],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a directory where the session rows file should be',
    fixture: 'stored rows',
    code: 'not-a-file',
    breakFixture: (tree) => {
      replaceWithDirectory(tree.sessionsPath);
      return tree.env;
    },
    paths: (tree) => [tree.sessionsPath],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a commit rows file holding no byte',
    fixture: 'stored rows',
    code: 'empty',
    breakFixture: (tree) => {
      writeFileSync(tree.commitsPath, '');
      return tree.env;
    },
    paths: (tree) => [tree.commitsPath],
    detail: null,
    needsNonRoot: false,
  },
  {
    label: 'a stored-row directory it may not search',
    fixture: 'stored rows',
    code: 'unreadable',
    breakFixture: (tree) => {
      lock(tree.storeDir);
      return tree.env;
    },
    paths: (tree) => [tree.sessionsPath, tree.commitsPath],
    detail: 'EACCES',
    needsNonRoot: true,
  },
];

describe('where the resolver looks', () => {
  it('derives both defaults from the sibling checkout under the home', () => {
    // The log directory name is the one measured on disk, not re-derived.
    expect(parityFixturePaths({ env: {}, home: '/Users/marcos' })).toEqual({
      logDir:
        '/Users/marcos/.claude/projects/-Users-marcos-projects-agentic-research',
      logDirSource: 'default',
      storeDir: '/Users/marcos/projects/agentic-research/.ralph/effort',
      storeDirSource: 'default',
      sessionsPath:
        '/Users/marcos/projects/agentic-research/.ralph/effort/sessions.ndjson',
      commitsPath:
        '/Users/marcos/projects/agentic-research/.ralph/effort/commits.ndjson',
    });
  });

  it('lets each override outrank its own default and only its own', () => {
    const logsOnly = parityFixturePaths({
      env: { [PARITY_LOG_DIR_ENV]: '/fixtures/logs' },
      home: '/h',
    });
    const storeOnly = parityFixturePaths({
      env: { [PARITY_STORE_DIR_ENV]: '/fixtures/store' },
      home: '/h',
    });

    expect(logsOnly).toEqual({
      logDir: '/fixtures/logs',
      logDirSource: PARITY_LOG_DIR_ENV,
      storeDir: '/h/projects/agentic-research/.ralph/effort',
      storeDirSource: 'default',
      sessionsPath: '/h/projects/agentic-research/.ralph/effort/sessions.ndjson',
      commitsPath: '/h/projects/agentic-research/.ralph/effort/commits.ndjson',
    });
    expect(storeOnly).toEqual({
      logDir: '/h/.claude/projects/-h-projects-agentic-research',
      logDirSource: 'default',
      storeDir: '/fixtures/store',
      storeDirSource: PARITY_STORE_DIR_ENV,
      sessionsPath: '/fixtures/store/sessions.ndjson',
      commitsPath: '/fixtures/store/commits.ndjson',
    });
  });

  it('counts an empty override as unset', () => {
    const empty = { [PARITY_LOG_DIR_ENV]: '', [PARITY_STORE_DIR_ENV]: '' };

    expect(parityFixturePaths({ env: empty, home: '/h' }))
      .toEqual(parityFixturePaths({ env: {}, home: '/h' }));
  });

  it('reads the process environment and the home directory by default', () => {
    expect(parityFixturePaths())
      .toEqual(parityFixturePaths({ env: process.env, home: homedir() }));
  });
});

describe('a complete fixture', () => {
  it('answers present, with its paths and its log count', () => {
    const tree = plantFixture();

    expect(resolvePlanted(tree)).toEqual({
      present: true,
      logDir: tree.logDir,
      logDirSource: PARITY_LOG_DIR_ENV,
      storeDir: tree.storeDir,
      storeDirSource: PARITY_STORE_DIR_ENV,
      sessionsPath: tree.sessionsPath,
      commitsPath: tree.commitsPath,
      sessionLogCount: 1,
    });
  });

  it('is found at the defaults when no override is set', () => {
    const home = makeScratch();
    const where = parityFixturePaths({ env: {}, home });
    mkdirSync(join(where.logDir, 'aaaa', 'subagents'), { recursive: true });
    mkdirSync(where.storeDir, { recursive: true });
    writeFileSync(join(where.logDir, 'aaaa.jsonl'), '{}\n');
    writeFileSync(join(where.logDir, 'bbbb.jsonl'), '{}\n');
    writeFileSync(join(where.logDir, 'aaaa', 'subagents', 'agent-1.jsonl'), '');
    writeFileSync(join(where.logDir, 'notes.txt'), '');
    writeFileSync(where.sessionsPath, '{}\n');
    writeFileSync(where.commitsPath, '{}\n');

    const fixture = resolveParityFixture({ env: {}, home });

    expect(absencesOf(fixture)).toEqual([]);
    // Two loose logs; the transcript one level down and the text file
    // are not session logs by the collector's own listing.
    expect(fixture.present && fixture.sessionLogCount).toBe(2);
  });
});

describe('a machine holding neither fixture', () => {
  it('answers both absences and a one-line reason, without throwing', () => {
    const home = makeScratch();
    const where = parityFixturePaths({ env: {}, home });

    const fixture = resolveParityFixture({ env: {}, home });

    expect(absencesOf(fixture)).toEqual([
      {
        fixture: 'session logs',
        code: 'missing',
        path: where.logDir,
        source: 'default',
        detail: null,
      },
      {
        fixture: 'stored rows',
        code: 'missing',
        path: where.storeDir,
        source: 'default',
        detail: null,
      },
    ]);
    expect(reasonOf(fixture)).toBe(
      'parity fixture absent: '
      + `session logs at ${where.logDir}: does not exist (documented default); `
      + `stored rows at ${where.storeDir}: does not exist (documented default)`,
    );
  });
});

describe('an absence the resolver names', () => {
  it('has a row for every absence code', () => {
    const covered = [...new Set(ABSENCE_CASES.map((row) => row.code))];

    expect(covered.sort()).toEqual([...PARITY_ABSENCE_CODES].sort());
  });

  for (const row of ABSENCE_CASES) {
    const title = `answers ${row.code} for ${row.label}`;

    it.skipIf(isRoot && row.needsNonRoot)(title, () => {
      const tree = plantFixture();
      expect(resolvePlanted(tree).present).toBe(true);

      const fixture = resolvePlanted(tree, row.breakFixture(tree));

      const source = row.fixture === 'session logs'
        ? PARITY_LOG_DIR_ENV
        : PARITY_STORE_DIR_ENV;
      expect(fixture.present).toBe(false);
      expect(absencesOf(fixture)).toEqual(row.paths(tree).map((path) => ({
        fixture: row.fixture,
        code: row.code,
        path,
        source,
        detail: row.detail,
      })));
    });
  }
});

describe('the skip reason', () => {
  it('names the variable an override came from', () => {
    const tree = plantFixture();
    const typo = join(tree.root, 'lgos');
    expect(existsSync(typo)).toBe(false);

    const fixture = resolvePlanted(tree, {
      ...tree.env,
      [PARITY_LOG_DIR_ENV]: typo,
    });

    expect(reasonOf(fixture)).toBe(
      'parity fixture absent: '
      + `session logs at ${typo}: does not exist (from RAFA_PARITY_LOG_DIR)`,
    );
  });

  it('reports every absence in a fixed order, not only the first', () => {
    const tree = plantFixture();
    rmSync(join(tree.logDir, `${SESSION_ID}.jsonl`));
    writeFileSync(tree.sessionsPath, '');
    rmSync(tree.commitsPath);

    const fixture = resolvePlanted(tree);

    expect(reasonOf(fixture)).toBe(
      'parity fixture absent: '
      + `session logs at ${tree.logDir}: holds no loose *.jsonl session log`
      + ' (from RAFA_PARITY_LOG_DIR); '
      + `stored rows at ${tree.sessionsPath}: is empty`
      + ' (from RAFA_PARITY_STORE_DIR); '
      + `stored rows at ${tree.commitsPath}: does not exist`
      + ' (from RAFA_PARITY_STORE_DIR)',
    );
  });

  it.skipIf(isRoot)('carries the error code of a path it cannot read', () => {
    const tree = plantFixture();
    lock(tree.logDir);

    const fixture = resolvePlanted(tree);

    expect(reasonOf(fixture)).toBe(
      'parity fixture absent: '
      + `session logs at ${tree.logDir}: cannot be read, EACCES`
      + ' (from RAFA_PARITY_LOG_DIR)',
    );
  });
});
