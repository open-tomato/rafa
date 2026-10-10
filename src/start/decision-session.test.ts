/**
 * Tests for `start/decision-session.ts`: the argument list a decision
 * session is spawned with, read off a planted spawner, and the prompt
 * and working directory it is handed. The tools are read as the
 * variadic last flag, and a write-capable tool's absence is checked
 * beside the three read tools' presence, so a list naming every tool
 * fails here.
 */
import { describe, expect, it } from 'bun:test';

import { SETTING_SOURCES_FLAG } from '../utils/claude.js';

import { DECISION_TOOLS, decisionFlags, runDecisionSession } from './decision-session.js';
import { SESSION_ID_FLAG } from './dispatch.js';

describe('decisionFlags', () => {
  it('names the session id, then the read-only tools last', () => {
    expect(decisionFlags('id-1')).toEqual([SESSION_ID_FLAG, 'id-1', '--tools', 'Read,Grep,Glob']);
  });

  it('names no tool that writes, edits or runs a command', () => {
    expect(DECISION_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
    for (const tool of ['Write', 'Edit', 'Bash', 'NotebookEdit']) expect(DECISION_TOOLS).not.toContain(tool);
  });
});

describe('runDecisionSession', () => {
  it('spawns one session with the run\'s setting sources, the flags, the prompt on stdin and the checkout as its directory', async () => {
    const calls: { args: readonly string[]; prompt: string; cwd: string | undefined }[] = [];
    const answer = await runDecisionSession({
      prompt: '# Loop continue decision instructions',
      settingSources: ['project', 'local'],
      checkout: '/work/checkout',
      sessionId: () => 'id-7',
      spawn: (args, prompt, options) => {
        calls.push({ args, prompt, cwd: options?.cwd });
        return Promise.resolve({ exitCode: 0, stdout: 'decided' });
      },
    });

    expect(answer).toEqual({ exitCode: 0, stdout: 'decided' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.args.slice(-6)).toEqual([SETTING_SOURCES_FLAG, 'project,local', SESSION_ID_FLAG, 'id-7', '--tools', 'Read,Grep,Glob']);
    expect(call?.prompt).toContain('# Loop continue decision instructions');
    expect(call?.cwd).toBe('/work/checkout');
  });
});
