import { describe, expect, it } from 'bun:test';

import { parseMode } from './test-index-args';

describe('the command line', () => {
  it('is picked by --baseline beside --map=<file>, and any other argument is refused', () => {
    expect(parseMode([])).toBe('survey');
    expect(parseMode(['--baseline', '--map=docs/survey/cut-table.json'])).toEqual({ baseline: true, map: 'docs/survey/cut-table.json' });
    expect(parseMode(['--map=m.json', '--baseline'])).toEqual({ baseline: true, map: 'm.json' });
    expect(() => parseMode(['--base'])).toThrow('unknown arguments: --base.');
    expect(() => parseMode(['--baseline', '--baseline', '--map=m.json'])).toThrow('unknown arguments');
  });

  it('refuses --baseline without --map=<file>, and --map=<file> alone', () => {
    expect(() => parseMode(['--baseline'])).toThrow('--baseline reads the map: pass --map=<file> beside it');
    expect(() => parseMode(['--map=m.json'])).toThrow('--map=<file> names the map of --baseline, --against=<record> or --rekey=<record>, and none was passed');
    expect(() => parseMode(['--baseline', '--map='])).toThrow('unknown arguments: --baseline --map=.');
    expect(() => parseMode(['--baseline', '--map=a.json', '--map=b.json'])).toThrow('unknown arguments');
  });

  it('is picked by --against=<record> beside --map=<file>, each with a path', () => {
    expect(parseMode(['--against=docs/survey/test-index.baseline.json', '--map=docs/survey/cut-table.json'])).toEqual({
      against: 'docs/survey/test-index.baseline.json',
      map: 'docs/survey/cut-table.json',
    });
    expect(() => parseMode(['--against=', '--map=m.json'])).toThrow('unknown arguments: --against= --map=m.json.');
    expect(() => parseMode(['--against'])).toThrow('unknown arguments: --against.');
    expect(() => parseMode(['--baseline', '--against=a.json', '--map=m.json'])).toThrow('unknown arguments');
    expect(() => parseMode(['--against=a.json', '--against=b.json', '--map=m.json'])).toThrow('unknown arguments');
  });

  it('refuses --against=<record> without --map=<file>', () => {
    expect(() => parseMode(['--against=a.json'])).toThrow('--against=<record> reads the map: pass --map=<file> beside it');
  });

  it('names the four modes in the usage text it refuses with', () => {
    expect(() => parseMode(['--base'])).toThrow(
      'unknown arguments: --base. Usage: bun scripts/survey/test-index.ts '
      + '[--baseline --map=<file> | --against=<record> --map=<file> | --rekey=<record> --map=<file> [--dry-run]]',
    );
  });

  it('refuses --rekey= with no path, --rekey twice, and --rekey beside --baseline or --against', () => {
    expect(() => parseMode(['--rekey=', '--map=m.json'])).toThrow('unknown arguments: --rekey= --map=m.json.');
    expect(() => parseMode(['--rekey', '--map=m.json'])).toThrow('unknown arguments: --rekey --map=m.json.');
    expect(() => parseMode(['--rekey=a.json', '--rekey=b.json', '--map=m.json'])).toThrow('unknown arguments');
    expect(() => parseMode(['--rekey=a.json', '--baseline', '--map=m.json'])).toThrow('unknown arguments');
    expect(() => parseMode(['--rekey=a.json', '--against=a.json', '--map=m.json'])).toThrow('unknown arguments');
  });

  it('refuses --rekey=<record> without --map=<file>', () => {
    expect(() => parseMode(['--rekey=a.json'])).toThrow('--rekey=<record> reads the map: pass --map=<file> beside it');
    expect(() => parseMode(['--rekey=a.json', '--dry-run'])).toThrow('--rekey=<record> reads the map: pass --map=<file> beside it');
  });

  it('refuses --dry-run beside any mode but --rekey, alone included, and passed twice', () => {
    expect(() => parseMode(['--dry-run'])).toThrow('unknown arguments: --dry-run.');
    expect(() => parseMode(['--dry-run', '--map=m.json'])).toThrow('unknown arguments: --dry-run --map=m.json.');
    expect(() => parseMode(['--baseline', '--map=m.json', '--dry-run'])).toThrow('unknown arguments');
    expect(() => parseMode(['--against=a.json', '--map=m.json', '--dry-run'])).toThrow('unknown arguments');
    expect(() => parseMode(['--rekey=a.json', '--map=m.json', '--dry-run', '--dry-run'])).toThrow('unknown arguments');
  });

  it('is picked by --rekey=<record> beside --map=<file>, with --dry-run as its one boolean', () => {
    expect(parseMode(['--rekey=docs/survey/test-index.baseline.json', '--map=docs/survey/cut-table.json'])).toEqual({
      dryRun: false,
      map: 'docs/survey/cut-table.json',
      rekey: 'docs/survey/test-index.baseline.json',
    });
    expect(parseMode(['--dry-run', '--map=m.json', '--rekey=r.json'])).toEqual({ dryRun: true, map: 'm.json', rekey: 'r.json' });
  });
});
