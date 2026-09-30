import { describe, expect, test } from 'bun:test';

import { commandsOf, judgeLine } from './rafa-hookify/files/rafa-tooling-hook';

const HOOK = `${import.meta.dir}/rafa-hookify/files/rafa-tooling-hook.ts`;

describe('commandsOf', () => {
  test('splits a line on its separators and drops env assignments', () => {
    expect(commandsOf('cd x && FOO=1 rafa pr show 4 | tail -5')).toEqual([
      ['cd', 'x'],
      ['rafa', 'pr', 'show', '4'],
      ['tail', '-5'],
    ]);
  });

  test('blanks quoted text so a separator inside a body does not split', () => {
    expect(commandsOf('rafa issue comment 3 --body="a; gh pr merge 4"')).toEqual([
      ['rafa', 'issue', 'comment', '3', '--body=""'],
    ]);
  });
});

describe('judgeLine: rafa commands the user runs', () => {
  test.each([
    'rafa pr merge 442 --skip-checks',
    'rafa pr merge 442 --yes --skip-checks',
    'rafa release tag',
    'rafa self-update',
    'rafa loop start --plan=.rafa/plans/PLAN-x.md',
    'rafa issue ready 57 --no-hint </dev/null',
    'rafa cleanup',
    'rafa next --roadmap',
    'rafa next --yes=sync,merge',
    '~/.rafa/bin/rafa pr merge 4',
    'cd ../rafa && rafa release tag',
  ])('denies %s with a hand-over', (line) => {
    const verdict = judgeLine(line);
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain('the user\'s to run');
  });
});

describe('judgeLine: rafa commands an agent runs', () => {
  test.each([
    'rafa pr show 442',
    'rafa pr current --output=json',
    'rafa issue list --type=bug',
    'rafa issue move 12 done',
    'rafa next --dry-run',
    'rafa next --yes=sync,wait,unblock',
    'rafa cleanup --dry-run',
    'rafa plan create --next --dry-run',
    'rafa loop list',
    'grep -rn "rafa pr merge" src',
  ])('lets %s through', (line) => {
    expect(judgeLine(line)).toBeNull();
  });

  test.each(['rafa plan create --issue=20', 'rafa pr triage 41', 'rafa epic close 40'])('asks before %s, which spends a session', (line) => {
    expect(judgeLine(line)?.decision).toBe('ask');
  });
});

describe('judgeLine: gh commands rafa replaces', () => {
  test.each([
    ['gh pr checks 442', 'rafa pr show 442'],
    ['gh pr view 442 --json state,statusCheckRollup', 'rafa pr show 442'],
    ['gh pr view', 'rafa pr current'],
    ['gh pr view 41 --web', 'rafa pr view 41'],
    ['gh pr checks 41 --watch', 'rafa pr wait 41'],
    ['gh pr list', 'rafa pr list'],
    ['gh issue view #12', 'rafa issue show 12'],
    ['gh issue close 374 --comment "shipped"', 'rafa issue move 374 done'],
    ['gh issue comment 12 --body x', 'rafa issue comment 12'],
  ])('denies %s and names %s', (line, rafa) => {
    const verdict = judgeLine(line);
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain(rafa);
  });

  test('hands gh pr merge over as the rafa line', () => {
    expect(judgeLine('gh pr merge 41 --squash --delete-branch')?.reason).toContain('`rafa pr merge 41` is the user\'s to run');
  });

  test.each(['gh pr list --state open', 'gh pr list --json number'])('denies %s, which rafa pr list answers', (line) => {
    expect(judgeLine(line)?.reason).toContain('rafa pr list');
  });

  test.each([
    'gh pr create --fill',
    'gh pr checkout 41',
    'gh run view 9 --log',
    'gh api repos/x/y',
    'gh auth status',
    'gh pr list --head feat/x --state all --json number',
    'gh pr list --state merged',
    'gh pr list -s closed',
    'gh pr list --author @me',
  ])('lets %s through', (line) => {
    expect(judgeLine(line)).toBeNull();
  });
});

describe('the hook process', () => {
  const run = async (input: string): Promise<string> => {
    const proc = Bun.spawn(['bun', HOOK], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return out;
  };

  test('prints a PreToolUse deny for a gh command rafa replaces', async () => {
    const out = JSON.parse(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr checks 442' } })));
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('prints nothing for a command it lets through', async () => {
    expect(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rafa pr show 442' } }))).toBe('');
  });

  test('prints nothing for input that is not JSON, and still exits 0', async () => {
    expect(await run('not json')).toBe('');
  });
});
