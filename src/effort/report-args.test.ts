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
