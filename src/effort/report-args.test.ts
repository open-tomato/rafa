import { describe, expect, it } from 'bun:test';

import { parseReportArgs } from './report-args.js';

describe('parseReportArgs', () => {
  it('defaults to a table over everything', () => {
    expect(parseReportArgs([])).toEqual({
      json: false,
      kinds: null,
      entrypoints: null,
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
