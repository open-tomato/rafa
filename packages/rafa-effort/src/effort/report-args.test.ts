import { describe, expect, it } from 'bun:test';

import { parseReportArgs } from './report-args.js';

describe('parseReportArgs', () => {
  it('defaults to a table over everything', () => {
    expect(parseReportArgs([])).toEqual({
      json: false,
      kinds: null,
      entrypoints: null,
      skills: false,
      plans: null,
      trend: null,
      errors: [],
    });
  });

  it('reads --json', () => {
    expect(parseReportArgs(['--json']).json).toBe(true);
  });

  it('reads a comma-separated kind list', () => {
    const parsed = parseReportArgs(['--kind=task, wrap-up']);

    expect(parsed.kinds).toEqual(['task', 'wrap-up']);
    expect(parsed.errors).toEqual([]);
  });

  it('unions a repeated flag and drops the duplicate', () => {
    const parsed = parseReportArgs([
      '--kind=task',
      '--kind=task,other',
      '--entrypoint=sdk-cli',
      '--entrypoint=sdk-cli',
    ]);

    expect(parsed.kinds).toEqual(['task', 'other']);
    expect(parsed.entrypoints).toEqual(['sdk-cli']);
  });

  it('refuses a kind that is not a session kind', () => {
    const parsed = parseReportArgs(['--kind=tasks']);

    expect(parsed.kinds).toBeNull();
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('tasks');
  });

  it('refuses a valueless flag', () => {
    expect(parseReportArgs(['--kind']).errors).toEqual([
      '--kind takes a value, as --kind=<value>',
    ]);
    expect(parseReportArgs(['--entrypoint']).errors).toHaveLength(1);
  });

  it('refuses an unrecognised argument', () => {
    const parsed = parseReportArgs(['--entrypint=sdk-cli']);

    expect(parsed.entrypoints).toBeNull();
    expect(parsed.errors).toEqual([
      'unrecognised argument: --entrypint=sdk-cli',
    ]);
  });

  it('collects every refusal, not just the first', () => {
    const parsed = parseReportArgs(['--nope', '--kind=nope']);

    expect(parsed.errors).toHaveLength(2);
  });
});

describe('parseReportArgs for the skills report', () => {
  it('reads --skills alone as every plan', () => {
    expect(parseReportArgs(['--skills'])).toMatchObject({ skills: true, plans: null, errors: [] });
  });

  it('reads --plan= beside --skills, unioning a repeat and dropping the duplicate, in the order typed', () => {
    const parsed = parseReportArgs(['--plan=b, a', '--skills', '--plan=a,c']);

    expect(parsed).toMatchObject({ skills: true, plans: ['b', 'a', 'c'], errors: [] });
  });

  it('refuses --plan= without --skills, naming the flag, and reads the same stubs once --skills is typed', () => {
    const alone = parseReportArgs(['--plan=x']);

    expect(alone.errors).toEqual(['--plan narrows the skills report and needs --skills']);
    expect(alone.skills).toBe(false);
    // The control: the same flag beside --skills is no refusal.
    expect(parseReportArgs(['--plan=x', '--skills']).errors).toEqual([]);
  });

  it('refuses a --plan that names no stub, with or without a value sign', () => {
    expect(parseReportArgs(['--skills', '--plan=']).errors).toEqual(['--plan names no plan stub: --plan=']);
    expect(parseReportArgs(['--skills', '--plan= , ']).errors).toHaveLength(1);
    expect(parseReportArgs(['--skills', '--plan']).errors).toEqual(['--plan takes a value, as --plan=<value>']);
  });

  it('refuses a session-row filter beside --skills, once per flag, and neither without it', () => {
    const parsed = parseReportArgs(['--skills', '--kind=task', '--kind=other', '--entrypoint=sdk-cli']);

    expect(parsed.errors).toEqual([
      '--kind narrows the session tables, which --skills does not print',
      '--entrypoint narrows the session tables, which --skills does not print',
    ]);
    expect(parseReportArgs(['--kind=task', '--entrypoint=sdk-cli']).errors).toEqual([]);
  });

  it('refuses a value on --skills as an unrecognised argument', () => {
    expect(parseReportArgs(['--skills=yes']).errors).toEqual(['unrecognised argument: --skills=yes']);
  });
});

describe('parseReportArgs for the trend report', () => {
  it('reads --trend alone with the default windows and no split', () => {
    expect(parseReportArgs(['--trend'])).toEqual({
      json: false,
      kinds: null,
      entrypoints: null,
      skills: false,
      plans: null,
      trend: { days: 14, recentDays: 3, loops: null, by: null },
      errors: [],
    });
  });

  it('reads --days, --recent, --loops and --by beside --trend', () => {
    const parsed = parseReportArgs(['--trend', '--days=7', '--recent=2', '--loops=5', '--by=agent']);

    expect(parsed.trend).toEqual({ days: 7, recentDays: 2, loops: 5, by: 'agent' });
    expect(parsed.errors).toEqual([]);
  });

  it('reads the flags in any order, and --json beside them', () => {
    const parsed = parseReportArgs(['--by=model', '--days=30', '--json', '--trend']);

    expect(parsed).toMatchObject({ json: true, trend: { days: 30, recentDays: 3, loops: null, by: 'model' }, errors: [] });
  });

  it('reads each grouping', () => {
    for (const by of ['effort', 'model', 'agent']) {
      expect(parseReportArgs(['--trend', `--by=${by}`]).trend?.by).toBe(by);
    }
  });

  it('refuses a repeated trend flag, each takes one value, and keeps the first value read', () => {
    const parsed = parseReportArgs(['--trend', '--days=3', '--days=5']);

    expect(parsed.errors).toEqual(['--days takes one value and was given more than once']);
    expect(parsed.trend?.days).toBe(3);
    expect(parseReportArgs(['--trend', '--by=agent', '--by=model']).errors).toEqual([
      '--by takes one value and was given more than once',
    ]);
    expect(parseReportArgs(['--trend', '--loops=1', '--loops=1']).errors).toEqual([
      '--loops takes one value and was given more than once',
    ]);
  });

  it('reads a count of one, the smallest accepted', () => {
    expect(parseReportArgs(['--trend', '--days=1', '--recent=1', '--loops=1']).trend).toEqual({
      days: 1,
      recentDays: 1,
      loops: 1,
      by: null,
    });
  });

  it('refuses a day count that is not a whole number of one to 3650, naming the flag and the argument', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '', '1e3', ' 5', '3651', '99999999999999999999']) {
      for (const flag of ['--days', '--recent']) {
        expect(parseReportArgs(['--trend', `${flag}=${value}`]).errors).toEqual([
          `${flag} takes a whole number of one or more and at most 3650: ${flag}=${value}`,
        ]);
      }
    }
  });

  it('refuses a loop count that is not a whole number of one or more, with no upper bound named', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '', '1e3', ' 5', '99999999999999999999']) {
      expect(parseReportArgs(['--trend', `--loops=${value}`]).errors).toEqual([
        `--loops takes a whole number of one or more: --loops=${value}`,
      ]);
    }
  });

  it('reads a day count of 3650, the largest, and refuses 3651', () => {
    expect(parseReportArgs(['--trend', '--days=3650', '--recent=3650']).trend).toMatchObject({ days: 3650, recentDays: 3650 });
    expect(parseReportArgs(['--trend', '--days=3651']).errors).toHaveLength(1);
  });

  it('reads a loop count above 3650', () => {
    expect(parseReportArgs(['--trend', '--loops=100000'])).toMatchObject({ trend: { loops: 100_000 }, errors: [] });
  });

  it('leaves a refused count at its default', () => {
    expect(parseReportArgs(['--trend', '--days=0']).trend).toEqual({ days: 14, recentDays: 3, loops: null, by: null });
  });

  it('refuses a bare count flag, and --by without a value', () => {
    expect(parseReportArgs(['--trend', '--days']).errors).toEqual(['--days takes a value, as --days=<value>']);
    expect(parseReportArgs(['--trend', '--recent']).errors).toEqual(['--recent takes a value, as --recent=<value>']);
    expect(parseReportArgs(['--trend', '--loops']).errors).toEqual(['--loops takes a value, as --loops=<value>']);
    expect(parseReportArgs(['--trend', '--by']).errors).toEqual(['--by takes a value, as --by=<value>']);
  });

  it('refuses a --by value that is not a grouping, listing the groupings', () => {
    expect(parseReportArgs(['--trend', '--by=foo']).errors).toEqual([
      '--by value is not a grouping: foo (one of effort, model, agent)',
    ]);
    expect(parseReportArgs(['--trend', '--by=']).errors).toEqual([
      '--by value is not a grouping:  (one of effort, model, agent)',
    ]);
    expect(parseReportArgs(['--trend', '--by=foo']).trend?.by).toBeNull();
  });

  it('collects every trend refusal, not just the first', () => {
    expect(parseReportArgs(['--trend', '--days=0', '--by=foo', '--loops']).errors).toHaveLength(3);
  });

  it('refuses each trend flag without --trend, saying it needs --trend', () => {
    expect(parseReportArgs(['--days=7']).errors).toEqual(['--days reads the trend report and needs --trend']);
    expect(parseReportArgs(['--recent=2']).errors).toEqual(['--recent reads the trend report and needs --trend']);
    expect(parseReportArgs(['--loops=5']).errors).toEqual(['--loops reads the trend report and needs --trend']);
    expect(parseReportArgs(['--by=agent']).errors).toEqual(['--by reads the trend report and needs --trend']);
  });

  it('gives only the needs --trend line for a trend flag typed without --trend, whatever its value', () => {
    expect(parseReportArgs(['--days=abc']).errors).toEqual(['--days reads the trend report and needs --trend']);
    expect(parseReportArgs(['--days']).errors).toEqual(['--days reads the trend report and needs --trend']);
    expect(parseReportArgs(['--by=foo']).errors).toEqual(['--by reads the trend report and needs --trend']);
    expect(parseReportArgs(['--loops=0']).errors).toEqual(['--loops reads the trend report and needs --trend']);
  });

  it('names a trend flag once however often it is typed without --trend', () => {
    expect(parseReportArgs(['--days=1', '--days=2']).errors).toEqual(['--days reads the trend report and needs --trend']);
  });

  it('refuses --trend beside --skills', () => {
    const parsed = parseReportArgs(['--trend', '--skills']);

    expect(parsed.errors).toEqual(['--trend and --skills each print a report of their own; pick one']);
  });

  it('gives the --skills filter refusal and the --trend --skills line once each, and no --trend filter line, for all three flags', () => {
    expect(parseReportArgs(['--trend', '--skills', '--kind=task']).errors).toEqual([
      '--kind narrows the session tables, which --skills does not print',
      '--trend and --skills each print a report of their own; pick one',
    ]);
  });

  it('reads a bad trend value beside --skills as the --trend --skills line after the value refusal', () => {
    expect(parseReportArgs(['--trend', '--skills', '--days=0']).errors).toEqual([
      '--days takes a whole number of one or more and at most 3650: --days=0',
      '--trend and --skills each print a report of their own; pick one',
    ]);
  });

  it('refuses a session-row filter beside --trend, once per flag', () => {
    expect(parseReportArgs(['--trend', '--kind=task']).errors).toEqual([
      '--kind narrows the session tables, which --trend does not print',
    ]);
    expect(parseReportArgs(['--trend', '--entrypoint=sdk-cli', '--entrypoint=cli']).errors).toEqual([
      '--entrypoint narrows the session tables, which --trend does not print',
    ]);
  });

  it('refuses a value on --trend as an unrecognised argument', () => {
    expect(parseReportArgs(['--trend=1']).errors).toEqual(['unrecognised argument: --trend=1']);
  });

  it('carries no trend options when --trend is not typed', () => {
    expect(parseReportArgs([]).trend).toBeNull();
    expect(parseReportArgs(['--skills']).trend).toBeNull();
    expect(parseReportArgs(['--kind=task', '--json']).trend).toBeNull();
    expect(parseReportArgs(['--days=7']).trend).toBeNull();
  });
});
