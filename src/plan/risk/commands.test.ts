/**
 * Tests for the command-line and outside-path reader.
 *
 * Every "reports nothing" case stands beside a case that goes red under
 * the same reader on the same words set as a command: the prose
 * sentence `git push --force` beside the fence and the code span that
 * carry it, a `/dev/null` redirection beside a `/tmp` one. A silent
 * reading is only evidence when the reader could have spoken.
 */

import type { CommandFinding, PathSeams } from './commands.js';

import { describe, expect, it } from 'bun:test';

import {
  isOutsidePath,
  outsidePaths,
  readBodyCommands,
  readTaskLineCommands,
  shellCommandLines,
  shellTokens,
  taskLineCommands,
} from './commands.js';

/** A repository and a home that do not contain each other. */
const SEAMS: PathSeams = { repoRoot: '/work/repo', home: '/home/dev' };

/** A home the repository sits under, as a checkout usually does. */
const NESTED: PathSeams = { repoRoot: '/home/dev/code/repo', home: '/home/dev' };

/** The fence marker, spelled once so no line below nests one. */
const FENCE = '```';

/** A body holding one fence of `info` with `lines` in it. */
function fenced(info: string, lines: readonly string[]): string {
  return [`${FENCE}${info}`, ...lines, FENCE].join('\n');
}

/** The level, kind and subject of each finding, in order. */
function summary(findings: readonly CommandFinding[]): readonly string[] {
  return findings.map((finding) => `${finding.level} ${finding.kind} ${finding.subject}`);
}

describe('prose is never a command', () => {
  const sentence = 'Never run git push --force on main, and never rm -rf ~/.config.';

  it('reports nothing for the sentence as body prose', () => {
    expect(readBodyCommands(sentence, SEAMS)).toEqual([]);
  });

  it('reports nothing for the sentence as a task line', () => {
    expect(readTaskLineCommands(`- [ ] ${sentence}`, 7, SEAMS)).toEqual([]);
  });

  it('reports the same words set in a shell fence, the control', () => {
    const body = [sentence, '', fenced('bash', ['git push --force origin main'])].join('\n');

    expect(summary(readBodyCommands(body, SEAMS))).toEqual(['high destructive git push --force']);
  });

  it('reports the same words set in a task line code span, the control', () => {
    const line = '- [ ] Stop the `git push --force` in the release step';

    expect(readTaskLineCommands(line, 12, SEAMS)).toEqual([
      {
        level: 'high',
        kind: 'destructive',
        text: 'git push --force — git push --force',
        subject: 'git push --force',
        command: 'git push --force',
        line: 12,
      },
    ]);
  });

  it('does not read a force-with-lease push as a force push', () => {
    const body = fenced('sh', ['git push --force-with-lease origin main']);

    expect(readBodyCommands(body, SEAMS)).toEqual([]);
  });
});

describe('shellCommandLines', () => {
  it('reads only shell fences, with the line of the file handed in', () => {
    const body = [
      '---',
      'name: demo',
      '---',
      fenced('ts', ['rm("-rf")']),
      fenced('', ['rm -rf build']),
      fenced('bash', ['# clean', '', 'rm -rf build']),
    ].join('\n');

    expect(shellCommandLines(body)).toEqual([{ text: 'rm -rf build', line: 13 }]);
  });

  it.each(['bash', 'sh', 'shell', 'zsh', 'Bash {title="x"}'])('reads a %s fence', (info) => {
    expect(shellCommandLines(fenced(info, ['ls']))).toEqual([{ text: 'ls', line: 2 }]);
  });

  it('reads a console fence\'s prompted lines and not its output', () => {
    const body = fenced('console', ['$ git reset --hard', 'HEAD is now at 1234abc', '$ ls']);

    expect(shellCommandLines(body)).toEqual([
      { text: 'git reset --hard', line: 2 },
      { text: 'ls', line: 4 },
    ]);
  });

  it('joins continued lines into one command at its first line', () => {
    const body = fenced('bash', ['git push \\', '  --force \\', '  origin main', 'ls']);

    expect(shellCommandLines(body)).toEqual([
      { text: 'git push --force origin main', line: 2 },
      { text: 'ls', line: 5 },
    ]);
  });

  it('joins a console continuation, its "> " prompt dropped', () => {
    const body = fenced('console', ['$ git push \\', '> --force']);

    expect(shellCommandLines(body)).toEqual([{ text: 'git push --force', line: 2 }]);
  });

  it('skips a heredoc body and reads on after its terminator', () => {
    const body = fenced('bash', ['cat > notes.txt <<EOF', 'rm -rf /', 'EOF', 'sudo ls']);

    expect(shellCommandLines(body).map((command) => command.text)).toEqual([
      'cat > notes.txt <<EOF',
      'sudo ls',
    ]);
  });

  it('drops a whole fence one line of which is another language', () => {
    const body = fenced('bash', ['rm -rf build', 'const ready = true;']);

    expect(shellCommandLines(body)).toEqual([]);
  });

  it('keeps a four-backtick fence open past an inner three-backtick line', () => {
    const body = ['````bash', 'ls', FENCE, 'rm -rf build', '````', 'rm -rf prose'].join('\n');

    expect(shellCommandLines(body).map((command) => command.text)).toEqual([
      'ls',
      FENCE,
      'rm -rf build',
    ]);
  });

  it('reads a tilde fence and does not close it on backticks', () => {
    const body = ['~~~sh', FENCE, 'sudo ls', '~~~'].join('\n');

    expect(shellCommandLines(body).map((command) => command.text)).toContain('sudo ls');
  });

  it('keeps what a fence the body never closes holds', () => {
    expect(shellCommandLines(`${FENCE}bash\nsudo ls`)).toEqual([{ text: 'sudo ls', line: 2 }]);
  });
});

describe('taskLineCommands', () => {
  it('reads each code span as one command, at the given line', () => {
    const line = '- [ ] Run `rm -rf dist` then `npm publish`  {agent=loop-implementer}';

    expect(taskLineCommands(line, 30)).toEqual([
      { text: 'rm -rf dist', line: 30 },
      { text: 'npm publish', line: 30 },
    ]);
  });

  it('drops a span that is a comment or another language', () => {
    expect(taskLineCommands('- [ ] Keep `# rm -rf x` and `const x = 1;`', 1)).toEqual([]);
  });

  it('reads nothing on a line with no span', () => {
    expect(taskLineCommands('- [ ] Tidy up with rm -rf build', 1)).toEqual([]);
  });
});

describe('shellTokens', () => {
  it('keeps a quoted separator inside one word', () => {
    expect(shellTokens('echo "a; b" && ls')).toEqual([
      { kind: 'word', text: 'echo' },
      { kind: 'word', text: 'a; b' },
      { kind: 'separator', text: '&&' },
      { kind: 'word', text: 'ls' },
    ]);
  });

  it('reads a glued redirection with its fd number', () => {
    expect(shellTokens('make 2>>/tmp/err.log')).toEqual([
      { kind: 'word', text: 'make' },
      { kind: 'redirect', text: '2>>' },
      { kind: 'word', text: '/tmp/err.log' },
    ]);
  });

  it('reads &> and a quoted word with an escaped quote', () => {
    expect(shellTokens('run &> \'/tmp/a b\' "x\\"y"')).toEqual([
      { kind: 'word', text: 'run' },
      { kind: 'redirect', text: '&>' },
      { kind: 'word', text: '/tmp/a b' },
      { kind: 'word', text: 'x"y' },
    ]);
  });
});

describe('isOutsidePath', () => {
  it.each([
    ['/etc/hosts', true],
    ['/', true],
    ['~', true],
    ['~/.zshrc', true],
    ['~other/notes', true],
    ['/work/repo', false],
    ['/work/repo/src/index.ts', false],
    ['/work/repository/x', true],
    ['/work/repo/../elsewhere', true],
    ['/dev/null', false],
    ['//comment', false],
    ['https://example.com/x', false],
    ['relative/path.ts', false],
  ])('%s is outside: %p', (path, outside) => {
    expect(isOutsidePath(path, SEAMS)).toBe(outside);
  });

  it('expands ~ with the home seam, so a checkout under home is inside', () => {
    expect([isOutsidePath('~/code/repo/src', NESTED), isOutsidePath('~/code/other', NESTED)])
      .toEqual([false, true]);
  });
});

describe('outsidePaths', () => {
  it.each([
    ['echo x >> ~/.zshrc', '~/.zshrc'],
    ['echo x > /etc/motd', '/etc/motd'],
    ['make 2>/tmp/err.log', '/tmp/err.log'],
    ['mv build /opt/app', '/opt/app'],
    ['mv /opt/old ./here', '/opt/old'],
    ['rm -f /tmp/stale.lock', '/tmp/stale.lock'],
    ['echo 127.0.0.1 x | sudo tee -a /etc/hosts', '/etc/hosts'],
    ['cp dist/app.js /usr/local/bin/app', '/usr/local/bin/app'],
    ['cp -t /opt/app dist/a dist/b', '/opt/app'],
    ['cp --target-directory=/opt/app dist/a', '/opt/app'],
    ['cd sub; rm -rf "~/cache dir"', '~/cache dir'],
  ])('%s writes %s', (command, path) => {
    expect(outsidePaths(command, SEAMS)).toContainEqual({ path, writes: true });
  });

  it.each([
    ['ls ~/.claude/skills', '~/.claude/skills'],
    ['cat /etc/hosts', '/etc/hosts'],
    ['cp /etc/hosts ./hosts.txt', '/etc/hosts'],
    ['sort < /tmp/in.txt', '/tmp/in.txt'],
    ['bun build --outfile=/tmp/out.js', '/tmp/out.js'],
    ['/usr/local/bin/tool --version', '/usr/local/bin/tool'],
  ])('%s only names %s', (command, path) => {
    expect(outsidePaths(command, SEAMS)).toEqual([{ path, writes: false }]);
  });

  it.each([
    'make > /dev/null 2>&1',
    'rm -rf build',
    'curl -o out.json https://example.com/api/items',
    'cp /work/repo/a.txt /work/repo/b.txt',
    'cat <<EOF',
    'rm -rf "$HOME/.cache"',
  ])('%s names no outside path', (command) => {
    expect(outsidePaths(command, SEAMS)).toEqual([]);
  });

  it('names a path once, writing if any mention writes', () => {
    expect(outsidePaths('cat /tmp/x.log > /tmp/x.log', SEAMS)).toEqual([
      { path: '/tmp/x.log', writes: true },
    ]);
  });

  it('reads the tee a wrapper runs, and not the words of the command before the pipe', () => {
    expect(outsidePaths('cat /etc/hosts | sudo -E tee /tmp/hosts', SEAMS)).toEqual([
      { path: '/etc/hosts', writes: false },
      { path: '/tmp/hosts', writes: true },
    ]);
  });
});

describe('readBodyCommands', () => {
  it('reports destructive patterns first, then paths, each at its line', () => {
    const body = [
      '# Setup',
      '',
      fenced('bash', ['sudo rm -rf /opt/old', 'ls ~/.config']),
    ].join('\n');

    expect(readBodyCommands(body, SEAMS).map((finding) => [finding.line, finding.text])).toEqual([
      [4, 'rm -rf — sudo rm -rf /opt/old'],
      [4, 'sudo — sudo rm -rf /opt/old'],
      [4, '/opt/old — written by sudo rm -rf /opt/old'],
      [5, '~/.config — named in ls ~/.config'],
    ]);
  });

  it('levels a written outside path high and a named one a note', () => {
    const body = fenced('sh', ['echo x > ~/.profile', 'cat ~/.profile']);

    expect(summary(readBodyCommands(body, SEAMS))).toEqual([
      'high outside-path ~/.profile',
      'note outside-path ~/.profile',
    ]);
  });

  it('reports nothing for a body with no shell fence', () => {
    expect(readBodyCommands('Run `sudo ls` and `rm -rf /` when asked.', SEAMS)).toEqual([]);
  });
});

describe('readTaskLineCommands', () => {
  it('reads an outside path in a code span', () => {
    const line = '- [ ] Copy `cp dist/cli.js ~/bin/rafa` into place';

    expect(summary(readTaskLineCommands(line, 3, SEAMS))).toEqual(['high outside-path ~/bin/rafa']);
  });

  it('reports a span naming a file inside the repository as nothing', () => {
    const line = '- [ ] Edit `src/plan/risk/commands.ts` and `/work/repo/README.md`';

    expect(readTaskLineCommands(line, 3, SEAMS)).toEqual([]);
  });
});
