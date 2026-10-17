import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { parseCutMap, readCutMap } from './cut-map';

/**
 * A planted table: `rafa-three` holds three folders, `src/split/` is cut
 * across `rafa-three` and `rafa-other` (both name it), `rafa-empty` lists
 * no file under the folder it names, and `src/ci/` is unassigned. The
 * keys the map does not read ride along, as the live table carries them.
 */
const TABLE = {
  graph: 'docs/survey/import-graph.json',
  packages: [
    {
      files: [
        'src/a/one.ts',
        'src/a/one.test.ts',
        'src/b/two.ts',
        'src/c/three.ts',
        'src/split/kept.ts',
      ],
      folders: ['src/a/', 'src/b/', 'src/c/', 'src/split/'],
      name: 'rafa-three',
      rank: 1,
    },
    {
      files: ['src/split/moved.ts', 'src/split/moved.test.ts'],
      folders: ['src/split/'],
      name: 'rafa-other',
      rank: 2,
    },
    {
      files: [],
      folders: ['packages/empty/'],
      name: 'rafa-empty',
      rank: 3,
    },
  ],
  unassigned: [
    {
      files: ['src/ci/runs.ts', 'src/ci/runs.test.ts'],
      folder: 'src/ci/',
      importedBy: {},
    },
  ],
};

const TEXT = JSON.stringify(TABLE, null, 2);

/** The table with `change` applied to a copy, as JSON text. */
function tableWith(change: (table: Record<string, unknown>) => void): string {
  const copy = structuredClone(TABLE) as unknown as Record<string, unknown>;
  change(copy);
  return JSON.stringify(copy);
}

describe('parseCutMap', () => {
  const map = parseCutMap(TEXT, 'docs/survey/cut-table.json');

  it('keeps the path it was handed', () => {
    expect(map.path).toBe('docs/survey/cut-table.json');
  });

  it('hashes the text as sha256 hex, and a changed text hashes otherwise', () => {
    const expected = createHash('sha256')
      .update(TEXT)
      .digest('hex');
    expect(map.sha256).toBe(expected);
    expect(map.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parseCutMap(`${TEXT}\n`, 'x').sha256).not.toBe(map.sha256);
  });

  it('places the files of three folders in the one package that lists them', () => {
    expect(map.unitOf('src/a/one.ts')).toBe('rafa-three');
    expect(map.unitOf('src/a/one.test.ts')).toBe('rafa-three');
    expect(map.unitOf('src/b/two.ts')).toBe('rafa-three');
    expect(map.unitOf('src/c/three.ts')).toBe('rafa-three');
  });

  it('places the files of one folder in each of the two packages that list them', () => {
    expect(map.unitOf('src/split/kept.ts')).toBe('rafa-three');
    expect(map.unitOf('src/split/moved.ts')).toBe('rafa-other');
    expect(map.unitOf('src/split/moved.test.ts')).toBe('rafa-other');
  });

  it('answers the unassigned folder that lists a file, spelled as the table spells it', () => {
    expect(map.unitOf('src/ci/runs.ts')).toBe('src/ci/');
  });

  it('lists every unit sorted, a package with no files included', () => {
    expect(map.units).toEqual(['rafa-empty', 'rafa-other', 'rafa-three', 'src/ci/']);
  });

  it('answers the unplaced files of a set sorted and once each', () => {
    const files = [
      'src/z.ts',
      'src/a/one.ts',
      'src/split/new.ts',
      'src/z.ts',
      'src/ci/runs.ts',
      'src/a/new.test.ts',
      'src/a/sub/new.test.ts',
      'src/split/deep/new.ts',
    ];
    expect(map.unplaced(files)).toEqual(['src/split/deep/new.ts', 'src/split/new.ts', 'src/z.ts']);
    expect(map.unplaced(new Set(['src/a/one.ts']))).toEqual([]);
  });

  it('keeps the first listing of a file listed twice, packages before unassigned', () => {
    const twice = parseCutMap(tableWith((table) => {
      (table.unassigned as { files: string[] }[])[0]!.files.push('src/a/one.ts');
    }), 'x');
    expect(twice.unitOf('src/a/one.ts')).toBe('rafa-three');
  });
});

describe('parseCutMap fallback for a file listed nowhere', () => {
  const map = parseCutMap(TEXT, 'docs/survey/cut-table.json');

  /** The planted table with `src/split/` named by `rafa-three` alone. */
  const splitOnce = parseCutMap(tableWith((table) => {
    delete (table.packages as Record<string, unknown>[])[1]!.folders;
  }), 'x');

  it('answers the listing before the folder', () => {
    expect(map.unitOf('src/a/one.ts')).toBe('rafa-three');
    expect(map.unitOf('src/ci/runs.ts')).toBe('src/ci/');
  });

  it('places a file beside listed siblings of one unit in that unit', () => {
    expect(map.unitOf('src/a/new.test.ts')).toBe('rafa-three');
  });

  it('places a file beside siblings of two units by the one row naming its folder', () => {
    expect(splitOnce.unitOf('src/split/new.ts')).toBe('rafa-three');
    expect(splitOnce.unitOf('src/split/moved.ts')).toBe('rafa-other');
  });

  it('leaves unplaced a file whose longest folder two rows name', () => {
    expect(map.unitOf('src/split/new.ts')).toBeUndefined();
  });

  it('leaves unplaced a file no listing, sibling or folder matches', () => {
    expect(map.unitOf('src/zzz/file.ts')).toBeUndefined();
    expect(map.unitOf('src/ci/')).toBeUndefined();
    expect(map.unitOf('packages/other/x.ts')).toBeUndefined();
    expect(map.unitOf('src/cia/x.ts')).toBeUndefined();
  });

  it('places a file in a new subfolder of a one-unit folder by the walk', () => {
    expect(map.unitOf('src/a/sub/new.test.ts')).toBe('rafa-three');
    expect(map.unitOf('src/a/sub/deeper/new.test.ts')).toBe('rafa-three');
  });

  it('answers by the walk before any folder, and with no folder named', () => {
    const unnamed = parseCutMap(tableWith((table) => {
      delete (table.packages as Record<string, unknown>[])[0]!.folders;
    }), 'x');
    expect(unnamed.unitOf('src/a/sub/new.test.ts')).toBe('rafa-three');
    const nestedUnderA = parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[1]!.folders = ['src/a/sub/'];
    }), 'x');
    expect(nestedUnderA.unitOf('src/a/sub/x.ts')).toBe('rafa-three');
  });

  it('leaves a new subfolder of a mixed folder to the folder step', () => {
    expect(splitOnce.unitOf('src/split/deep/new.ts')).toBe('rafa-three');
    expect(map.unitOf('src/split/deep/new.ts')).toBeUndefined();
  });

  it('reads the own directory by its direct files and the folders above by every file below', () => {
    const foreign = parseCutMap(tableWith((table) => {
      (table.packages as { files: string[] }[])[1]!.files.push('src/a/sub/foreign.ts');
    }), 'x');
    expect(foreign.unitOf('src/a/new.ts')).toBe('rafa-three');
    expect(foreign.unitOf('src/a/sub/x.ts')).toBe('rafa-other');
    expect(foreign.unitOf('src/a/other/x.ts')).toBe('rafa-three');
  });

  it('walks up to the root and answers nothing there', () => {
    expect(map.unitOf('packages/other/x.ts')).toBeUndefined();
    expect(map.unitOf('root.ts')).toBeUndefined();
    expect(map.unitOf('src/zzz/file.ts')).toBeUndefined();
    expect(map.unitOf('src/cia/x.ts')).toBeUndefined();
    expect(map.unitOf('src/ci/')).toBeUndefined();
  });

  it('places a file under an unassigned folder or an empty row by the folder', () => {
    expect(map.unitOf('src/ci/runs2.ts')).toBe('src/ci/');
    expect(map.unitOf('src/ci/deep/new.ts')).toBe('src/ci/');
    expect(map.unitOf('packages/empty/x.ts')).toBe('rafa-empty');
  });

  it('places a file by the longest folder that holds it', () => {
    const nested = parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[1]!.folders = ['src/split/sub/'];
    }), 'x');
    expect(nested.unitOf('src/split/sub/x.ts')).toBe('rafa-other');
    expect(nested.unitOf('src/split/other/x.ts')).toBe('rafa-three');
  });

  it('places nothing by a shorter folder when two rows name the longest', () => {
    const twice = parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[1]!.folders = ['src/split/'];
      (table.packages as Record<string, unknown>[])[2]!.folders = ['src/split/'];
    }), 'x');
    expect(twice.unitOf('src/split/deep/x.ts')).toBeUndefined();
  });
});

describe('parseCutMap refusals', () => {
  it('refuses a text that is not JSON, naming the path', () => {
    expect(() => parseCutMap('{ not json', 'bad.json')).toThrow('bad.json: the cut table is not JSON');
  });

  it('refuses JSON that is not an object', () => {
    expect(() => parseCutMap('[]', 'x')).toThrow('the cut table is not a JSON object');
  });

  it('refuses a table with no packages array', () => {
    expect(() => parseCutMap(tableWith((table) => {
      delete table.packages;
    }), 'x')).toThrow('holds no `packages` array');
    expect(() => parseCutMap(tableWith((table) => {
      table.packages = {};
    }), 'x')).toThrow('holds no `packages` array');
  });

  it('refuses a package row with no name, naming the row', () => {
    expect(() => parseCutMap(tableWith((table) => {
      delete (table.packages as Record<string, unknown>[])[1]!.name;
    }), 'x')).toThrow('`packages[1]` holds no string `name`');
  });

  it('refuses a package row with no files array, naming the row', () => {
    expect(() => parseCutMap(tableWith((table) => {
      delete (table.packages as Record<string, unknown>[])[0]!.files;
    }), 'x')).toThrow('`packages[0]` holds no `files` array of strings');
    expect(() => parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[0]!.files = [1];
    }), 'x')).toThrow('`packages[0]` holds no `files` array of strings');
  });

  it('refuses a package row whose folders is not an array of strings, naming the row', () => {
    expect(() => parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[0]!.folders = 'src/a/';
    }), 'x')).toThrow('`packages[0]` holds no `folders` array of strings');
    expect(() => parseCutMap(tableWith((table) => {
      (table.packages as Record<string, unknown>[])[0]!.folders = [1];
    }), 'x')).toThrow('`packages[0]` holds no `folders` array of strings');
  });

  it('refuses a table with no unassigned array', () => {
    expect(() => parseCutMap(tableWith((table) => {
      delete table.unassigned;
    }), 'x')).toThrow('holds no `unassigned` array');
  });

  it('refuses an unassigned entry with no folder or no files, naming the entry', () => {
    expect(() => parseCutMap(tableWith((table) => {
      delete (table.unassigned as Record<string, unknown>[])[0]!.folder;
    }), 'x')).toThrow('`unassigned[0]` holds no string `folder`');
    expect(() => parseCutMap(tableWith((table) => {
      delete (table.unassigned as Record<string, unknown>[])[0]!.files;
    }), 'x')).toThrow('`unassigned[0]` holds no `files` array of strings');
  });

  it('refuses a row that is not an object', () => {
    expect(() => parseCutMap(tableWith((table) => {
      table.unassigned = ['src/ci/'];
    }), 'x')).toThrow('`unassigned[0]` holds no string `folder`');
  });
});

describe('readCutMap', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cut-map-'));
    writeFileSync(join(root, 'table.json'), TEXT);
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads a file relative to the root, keeping the path as handed', () => {
    const map = readCutMap(root, 'table.json');
    expect(map.path).toBe('table.json');
    expect(map.sha256).toBe(parseCutMap(TEXT, 'x').sha256);
    expect(map.unitOf('src/split/moved.ts')).toBe('rafa-other');
  });

  it('reads an absolute file, ignoring the root', () => {
    const absolute = join(root, 'table.json');
    const map = readCutMap('/nowhere', absolute);
    expect(map.path).toBe(absolute);
    expect(map.unitOf('src/ci/runs.ts')).toBe('src/ci/');
  });

  it('refuses a file that is not there', () => {
    expect(() => readCutMap(root, 'absent.json')).toThrow();
  });

  it('refuses a file whose table is malformed, naming the file', () => {
    writeFileSync(join(root, 'bad.json'), '{"packages": []}');
    expect(() => readCutMap(root, 'bad.json')).toThrow('bad.json: the cut table holds no `unassigned` array');
  });
});
