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
    expect(() => parseMode(['--map=m.json'])).toThrow('--map=<file> names the map of --baseline or --against=<record>, and neither was passed');
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
});
