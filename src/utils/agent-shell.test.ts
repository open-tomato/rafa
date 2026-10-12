/**
 * `isAgentShell` over environments built here, never the process's own:
 * the session these cases run in may itself set the variable, so a case
 * reading `process.env` would answer for the runner and not for the
 * function.
 */
import { describe, expect, it } from 'bun:test';

import { AGENT_SHELL_ENV, isAgentShell } from './agent-shell.js';

describe('isAgentShell', () => {
  it('reads CLAUDECODE', () => {
    expect(AGENT_SHELL_ENV).toBe('CLAUDECODE');
  });

  it('is false for an environment without the variable', () => {
    expect(isAgentShell({})).toBe(false);
    expect(isAgentShell({ PATH: '/usr/bin' })).toBe(false);
    expect(isAgentShell({ [AGENT_SHELL_ENV]: undefined })).toBe(false);
  });

  it('is false for the variable set to an empty value', () => {
    expect(isAgentShell({ [AGENT_SHELL_ENV]: '' })).toBe(false);
  });

  it('is true for the variable set to any non-empty value', () => {
    expect(isAgentShell({ [AGENT_SHELL_ENV]: '1' })).toBe(true);
    expect(isAgentShell({ [AGENT_SHELL_ENV]: '0' })).toBe(true);
  });
});
