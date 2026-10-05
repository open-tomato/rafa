import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  commandsOf,
  issueCreateOptionsOf,
  jsonFieldsOf,
  judgeLine,
  mapIssueCreate,
  PR_SHOW_ANSWERED_FIELDS,
  repoFlagOf,
  repoOf,
  reportOffer,
} from './rafa-hookify/files/rafa-tooling-hook';

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

describe('issueCreateOptionsOf', () => {
  test.each([
    [['--title', 'x', '--body-file=spec.md'], [{ flag: '--title', value: 'x' }, { flag: '--body-file', value: 'spec.md' }]],
    [['-t', 'x', '-lbug', '-F', '-'], [{ flag: '--title', value: 'x' }, { flag: '--label', value: 'bug' }, { flag: '--body-file', value: '-' }]],
    [['--web', 'stray'], [{ flag: '--web', value: undefined }, { flag: '', value: 'stray' }]],
    [['--title', '--web'], [{ flag: '--title', value: undefined }, { flag: '--web', value: undefined }]],
  ])('reads %p as %p', (words, options) => {
    expect(issueCreateOptionsOf(words)).toEqual(options);
  });
});

describe('judgeLine: gh issue create', () => {
  const denied = (line: string): string => {
    const verdict = judgeLine(line);
    expect(verdict?.decision).toBe('deny');
    return verdict?.reason ?? '';
  };

  test('denies a spec filed from a body file, naming the translated line', () => {
    expect(denied('gh issue create --label type:spec --body-file spec.md')).toContain('run `rafa issue create --type=spec --body-file=spec.md` in place of `gh issue create --label type:spec --body-file spec.md`');
  });

  test('maps comma-joined labels, each one, in the line\'s order', () => {
    expect(denied('gh issue create --title x --label type:bug,module:cli,priority:high')).toContain('`rafa issue create --title=x --type=bug --module=cli --priority=high`');
  });

  test('maps short flags onto their long rafa flags', () => {
    expect(denied('gh issue create -t x -l type:spec -lmodule:hook -F spec.md')).toContain('`rafa issue create --title=x --type=spec --module=hook --body-file=spec.md`');
  });

  test('maps -b and a body read from standard input', () => {
    expect(denied('gh issue create -t x -b y')).toContain('`rafa issue create --title=x --body=y`');
    expect(denied('cat spec.md | gh issue create -t x -F -')).toContain('`rafa issue create --title=x --body-file=-`');
  });

  test('shows a quoted value it cannot read as an ellipsis', () => {
    expect(denied('gh issue create --title "Gap in the hook" --body="a; b"')).toContain('`rafa issue create --title="…" --body="…"`');
  });

  test('leaves spec:blocked to rafa on a spec with a body file, and says so', () => {
    const reason = denied('gh issue create -t x --label type:spec --label spec:blocked --body-file spec.md');
    expect(reason).toContain('`rafa issue create --title=x --type=spec --body-file=spec.md`');
    expect(reason).toContain('Leave `spec:blocked` off');
  });

  test('says rafa needs a title when the line leaves it out', () => {
    expect(denied('gh issue create --label type:spec --body-file spec.md')).toContain('needs a `--title`');
    expect(denied('gh issue create -t x')).not.toContain('needs a `--title`');
  });

  test('drops -R naming the project\'s own repository', () => {
    const verdict = judgeLine('gh issue create -R open-tomato/rafa -t x', 'open-tomato/rafa');
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain('`rafa issue create --title=x`');
  });

  test('lets an epic: label through, naming it and ending with the report offer', () => {
    const verdict = judgeLine('gh issue create -t x --label type:spec,epic:backlog-fixes --body-file spec.md');
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain('`rafa issue create` has no flag for epic: label.');
    expect(verdict?.reason).not.toContain('in place of');
    expect(verdict?.reason.endsWith(reportOffer('rafa issue create', ['epic: label']))).toBe(true);
  });

  test.each([
    ['gh issue create -t x --assignee @me', ['--assignee']],
    ['gh issue create -t x -a @me -w', ['--assignee', '--web']],
    ['gh issue create -t x --label bug', ['bug label']],
    ['gh issue create -t x --label type:feature', ['type:feature label']],
    ['gh issue create -t x --label priority:p1', ['priority:p1 label']],
    ['gh issue create -t x --label spec:blocked --body-file spec.md', ['spec:blocked label']],
    ['gh issue create -t x --label type:spec,spec:blocked --body y', ['spec:blocked label']],
    ['gh issue create -t x stray', ['argument stray']],
  ])('lets %s through, naming %p', (line, unmapped) => {
    const verdict = judgeLine(line);
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain(`has no flag for ${unmapped.join(', ')}.`);
  });

  test('lets a quoted label through, which it cannot read', () => {
    const verdict = judgeLine('gh issue create -t x --label "type:spec"');
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain('cannot read a quoted --label');
    expect(verdict?.reason).toContain('--title="rafa issue create has no <flag or field>"');
  });

  test('lets two types through, since rafa takes one', () => {
    const verdict = judgeLine('gh issue create -t x -l type:spec -l type:bug');
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain('asks --type for two values');
  });

  test('takes a label repeated with the same value once', () => {
    expect(mapIssueCreate(['-l', 'type:spec', '-l', 'type:spec,module:x']).flags).toEqual(['--type=spec', '--module=x']);
  });

  test('maps every type and priority rafa takes', () => {
    for (const type of ['code', 'bug', 'spike', 'adr', 'chore', 'package-api', 'epic', 'spec']) {
      expect(mapIssueCreate(['-l', `type:${type}`]).flags).toEqual([`--type=${type}`]);
    }
    for (const priority of ['urgent', 'high', 'medium', 'low']) {
      expect(mapIssueCreate(['-l', `priority:${priority}`]).flags).toEqual([`--priority=${priority}`]);
    }
  });
});

describe('repoOf and repoFlagOf', () => {
  test.each([
    ['open-tomato/rafa', 'open-tomato/rafa'],
    ['Open-Tomato/Rafa', 'open-tomato/rafa'],
    ['github.com/open-tomato/rafa', 'open-tomato/rafa'],
    ['git@github.com:open-tomato/rafa.git', 'open-tomato/rafa'],
    ['https://github.com/open-tomato/rafa.git\n', 'open-tomato/rafa'],
    ['ssh://git@github.com/open-tomato/rafa', 'open-tomato/rafa'],
  ])('reads %s as %s', (named, repo) => {
    expect(repoOf(named)).toBe(repo);
  });

  test.each(['rafa', '', '""'])('reads %p as no repository', (named) => {
    expect(repoOf(named)).toBeNull();
  });

  test.each([
    [['issue', 'list', '-R', 'a/b'], 'a/b'],
    [['issue', 'list', '-Ra/b'], 'a/b'],
    [['pr', 'view', '3', '--repo', 'a/b'], 'a/b'],
    [['pr', 'view', '3', '--repo=a/b'], 'a/b'],
    [['pr', 'view', '3'], undefined],
  ])('finds the repository in %p', (words, repo) => {
    expect(repoFlagOf(words)).toBe(repo);
  });
});

describe('judgeLine: gh naming a repository', () => {
  const OWN = 'open-tomato/rafa';

  test.each([
    'gh issue list -R other/repo',
    'gh issue view 12 --repo other/repo',
    'gh issue create -Rother/repo --title x',
    'gh pr view 3 --repo other/repo',
    'gh pr checks 3 --repo=github.com/other/repo',
    'gh pr list -R other/repo',
    'gh pr merge 3 -R other/repo',
  ])('lets %s through, which rafa cannot answer', (line) => {
    expect(judgeLine(line, OWN)).toBeNull();
  });

  test.each([
    ['gh issue list -R open-tomato/rafa', 'rafa issue list'],
    ['gh issue view 12 --repo Open-Tomato/Rafa', 'rafa issue show 12'],
    ['gh pr view 3 --repo=github.com/open-tomato/rafa', 'rafa pr show 3'],
    ['gh pr checks 3 -Ropen-tomato/rafa', 'rafa pr show 3'],
  ])('denies %s, naming the project\'s own repository, with %s', (line, rafa) => {
    const verdict = judgeLine(line, OWN);
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain(rafa);
  });

  test('hands gh pr merge on the project\'s own repository over', () => {
    expect(judgeLine('gh pr merge 41 -R open-tomato/rafa', OWN)?.reason).toContain('`rafa pr merge 41` is the user\'s to run');
  });

  test('denies a gh line naming no repository with the project\'s repository known', () => {
    expect(judgeLine('gh issue list', OWN)?.reason).toContain('rafa issue list');
  });

  test('denies a gh line naming no repository with the project\'s repository unread', () => {
    expect(judgeLine('gh pr view 3', null)?.reason).toContain('rafa pr show 3');
  });

  test('lets a named repository through when the project\'s repository is unread', () => {
    expect(judgeLine('gh issue list -R open-tomato/rafa', null)).toBeNull();
  });

  test('lets a repository named in quotes through, its name unreadable', () => {
    expect(judgeLine('gh issue list --repo "open-tomato/rafa"', OWN)).toBeNull();
  });
});

describe('jsonFieldsOf', () => {
  test.each([
    [['pr', 'view', '41', '--json', 'state,closingIssuesReferences'], ['state', 'closingIssuesReferences']],
    [['pr', 'view', '41', '--json=number,title'], ['number', 'title']],
    [['pr', 'view', '41', '--json', '""'], []],
    [['pr', 'view', '41', '--json'], []],
    [['pr', 'view', '41', '--json', '--jq', '.state'], []],
    [['pr', 'view', '41'], undefined],
  ])('reads %p as %p', (words, fields) => {
    expect(jsonFieldsOf(words)).toEqual(fields);
  });
});

describe('judgeLine: gh pr view --json', () => {
  test.each([
    ['gh pr view 41 --json closingIssuesReferences', 'rafa pr show 41'],
    ['gh pr view 41 --json=number,closingIssuesReferences,statusCheckRollup', 'rafa pr show 41'],
    ['gh pr view 41 --json state --jq .state', 'rafa pr show 41'],
    ['gh pr view --json headRefName,url', 'rafa pr show --output=json'],
  ])('denies %s, every field answered, naming %s', (line, rafa) => {
    const verdict = judgeLine(line);
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain(rafa);
  });

  test('denies a line asking for every field in the table', () => {
    expect(judgeLine(`gh pr view 41 --json ${PR_SHOW_ANSWERED_FIELDS.join(',')}`)?.decision).toBe('deny');
  });

  test('lets a field rafa pr show lacks through, naming it and ending with the report offer', () => {
    const verdict = judgeLine('gh pr view 41 --json someFieldRafaLacks');
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain('does not answer the --json field someFieldRafaLacks.');
    expect(verdict?.reason).toContain('rafa issue list --module=cli-gap --search="rafa pr show someFieldRafaLacks"');
    expect(verdict?.reason).toContain('rafa issue create --type=bug --module=cli-gap --title="rafa pr show has no someFieldRafaLacks"');
    expect(verdict?.reason.endsWith(reportOffer('rafa pr show', ['someFieldRafaLacks']))).toBe(true);
  });

  test('names only the fields rafa pr show lacks among several', () => {
    const reason = judgeLine('gh pr view 41 --json number,reviews,comments')?.reason ?? '';
    expect(reason).toContain('the --json fields reviews, comments.');
    expect(reason).not.toContain('fields number');
    expect(reason).toContain('once for each one named');
    expect(reason.endsWith(reportOffer('rafa pr show', ['reviews', 'comments']))).toBe(true);
  });

  test('lets a quoted field list through, which it cannot read', () => {
    const verdict = judgeLine('gh pr view 41 --json "closingIssuesReferences"');
    expect(verdict?.decision).toBe('let-through');
    expect(verdict?.reason).toContain('cannot read the --json fields');
    expect(verdict?.reason).toContain('rafa issue list --module=cli-gap');
  });

  test('keeps the deny for gh pr view with no --json', () => {
    expect(judgeLine('gh pr view 41')?.decision).toBe('deny');
  });

  test('lets the line through on another repository before reading its fields', () => {
    expect(judgeLine('gh pr view 41 --json someFieldRafaLacks -R other/repo', 'open-tomato/rafa')).toBeNull();
  });
});

describe('reportOffer', () => {
  test('ends with the ask-once rule and names the duplicate search before the report line', () => {
    const offer = reportOffer('rafa issue create', ['--epic']);
    const search = offer.indexOf('rafa issue list --module=cli-gap --search="rafa issue create --epic"');
    const ask = offer.indexOf('ask the person once');
    const file = offer.indexOf('rafa issue create --type=bug --module=cli-gap --title="rafa issue create has no --epic" --body=');
    expect(search).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(search);
    expect(file).toBeGreaterThan(ask);
  });

  test('carries a placeholder when no single gap is named', () => {
    expect(reportOffer('rafa pr show', [])).toContain('--title="rafa pr show has no <flag or field>"');
  });
});

describe('the hook process', () => {
  const run = async (input: string, cwd?: string): Promise<string> => {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const proc = Bun.spawn(['bun', HOOK], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe', cwd, env });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return out;
  };

  test('prints a PreToolUse deny for a gh command rafa replaces', async () => {
    const out = JSON.parse(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr checks 442' } })));
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('prints a let-through as additionalContext with no permission decision', async () => {
    const out = JSON.parse(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr view 41 --json someFieldRafaLacks' } })));
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(out.hookSpecificOutput.permissionDecisionReason).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain('someFieldRafaLacks');
    expect(out.hookSpecificOutput.additionalContext).toContain('rafa issue list --module=cli-gap');
  });

  test('prints the translated rafa line for a gh issue create that maps', async () => {
    const out = JSON.parse(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh issue create --label type:spec --body-file spec.md' } })));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('rafa issue create --type=spec --body-file=spec.md');
  });

  test('prints nothing for a command it lets through', async () => {
    expect(await run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rafa pr show 442' } }))).toBe('');
  });

  test('prints nothing for input that is not JSON, and still exits 0', async () => {
    expect(await run('not json')).toBe('');
  });

  describe('with the project\'s repository read from origin', () => {
    let dir = '';
    const bash = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rafa-hook-repo-'));
      await Bun.$`git init -q ${dir}`.quiet();
      await Bun.$`git -C ${dir} remote add origin git@github.com:open-tomato/rafa.git`.quiet();
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test('denies a gh line naming the origin repository', async () => {
      const out = JSON.parse(await run(bash('gh pr view 3 --repo open-tomato/rafa'), dir));
      expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(out.hookSpecificOutput.permissionDecisionReason).toContain('rafa pr show 3');
    });

    test('prints nothing for a gh line naming another repository', async () => {
      expect(await run(bash('gh pr view 3 --repo other/repo'), dir)).toBe('');
    });
  });
});
