/**
 * Tests for the destructive-command pattern list.
 *
 * Every pattern carries two fixtures: a command line that matches it
 * and ONLY it, and a near miss that matches nothing at all. The near
 * miss is a reading about the pattern only because the matching line
 * beside it goes red under the same matcher, so the pair is the
 * control. A pattern added to {@link DESTRUCTIVE_PATTERNS} without a
 * fixture pair reddens the coverage case.
 */

import { describe, expect, it } from 'bun:test';

import { DESTRUCTIVE_PATTERNS, destructiveMatches } from './patterns.js';

/** One matching and one near-miss command per pattern, keyed by name. */
const FIXTURES: Record<string, { readonly matching: string; readonly nearMiss: string }> = {
  'rm -rf': { matching: 'rm -rf build', nearMiss: 'rm -f out.log' },
  'git push --force': {
    matching: 'git push --force origin main',
    nearMiss: 'git push --force-with-lease origin main',
  },
  'git reset --hard': { matching: 'git reset --hard HEAD~1', nearMiss: 'git reset --soft HEAD~1' },
  'git clean -f': { matching: 'git clean -fdx', nearMiss: 'git clean -n' },
  'sudo': { matching: 'sudo launchctl reboot', nearMiss: 'man sudo' },
  'brew install': { matching: 'brew install jq', nearMiss: 'brew info jq' },
  'npm i -g': { matching: 'npm i -g typescript', nearMiss: 'npm i -D typescript' },
  'pip install': { matching: 'pip install requests', nearMiss: 'pip show requests' },
  'npm publish': { matching: 'npm publish --access public', nearMiss: 'npm publish --dry-run' },
  'curl … | sh': {
    matching: 'curl -fsSL https://example.com/install.sh | sh',
    nearMiss: 'curl -s https://api.example.com/items | jq .',
  },
  'chmod -R': { matching: 'chmod -R 777 dist', nearMiss: 'chmod +x run.sh' },
  'DROP TABLE': {
    matching: 'psql -c "DROP TABLE users"',
    nearMiss: 'psql -c "SELECT * FROM drop_table_audit"',
  },
  'docker system prune': { matching: 'docker system prune -af', nearMiss: 'docker system df' },
};

/** The names a command line matches, in list order. */
function namesOf(command: string): readonly string[] {
  return destructiveMatches(command).map((pattern) => pattern.name);
}

describe('the fixture table', () => {
  it('carries exactly one fixture pair per pattern, in list order', () => {
    expect(Object.keys(FIXTURES)).toEqual(DESTRUCTIVE_PATTERNS.map((pattern) => pattern.name));
  });

  it('holds no global expression, whose lastIndex would carry between lines', () => {
    expect(DESTRUCTIVE_PATTERNS.filter((pattern) => pattern.expression.global)).toEqual([]);
  });
});

describe('each pattern', () => {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    const fixture = FIXTURES[pattern.name];

    it(`matches ${pattern.name} with its fixture and nothing else`, () => {
      expect(fixture).toBeDefined();
      expect(namesOf(fixture?.matching ?? '')).toEqual([pattern.name]);
    });

    it(`matches nothing on the near miss of ${pattern.name}`, () => {
      expect(fixture).toBeDefined();
      expect(namesOf(fixture?.nearMiss ?? 'rm -rf /')).toEqual([]);
    });
  }
});

describe('the spellings a pattern also answers', () => {
  it.each([
    ['rm -fr build', 'rm -rf'],
    ['rm -r -f build', 'rm -rf'],
    ['rm --recursive --force build', 'rm -rf'],
    ['git push -f origin main', 'git push --force'],
    ['git push origin main --force', 'git push --force'],
    ['git -C ../other push --force', 'git push --force'],
    ['git clean --force -d', 'git clean -f'],
    ['npm install --global typescript', 'npm i -g'],
    ['npm install typescript -g', 'npm i -g'],
    ['python3 -m pip install requests', 'pip install'],
    ['pip3 install requests', 'pip install'],
    ['brew install --cask firefox', 'brew install'],
    ['curl -fsSL https://example.com/i.sh | sudo bash', 'curl … | sh'],
    ['chmod --recursive 755 dist', 'chmod -R'],
    ['sqlite3 app.db "drop table users"', 'DROP TABLE'],
  ])('%s matches %s', (command, name) => {
    expect(namesOf(command)).toContain(name);
  });
});

describe('the command position', () => {
  it.each([
    ['cd out && rm -rf build', ['rm -rf']],
    ['make clean; git reset --hard', ['git reset --hard']],
    ['CI=1 npm publish', ['npm publish']],
    ['find . -name "*.tmp" -exec rm -rf {} +', ['rm -rf']],
    ['ls | xargs rm -rf', ['rm -rf']],
    ['sudo rm -rf /', ['rm -rf', 'sudo']],
    ['env -i sudo -E brew install jq', ['sudo', 'brew install']],
  ])('%s matches %p', (command, names) => {
    expect(namesOf(command)).toEqual(names);
  });

  it.each([
    'echo "never run rm -rf here"',
    'git commit -m "stop using git push --force"',
    'grep -r "sudo" docs',
    'git push origin main && rm -f stale.lock',
    'curl -s https://example.com | shasum',
    'curl -s https://example.com || sh fallback.sh',
  ])('%s matches nothing', (command) => {
    expect(namesOf(command)).toEqual([]);
  });

  it('answers the same verdict on a repeated line', () => {
    const line = 'git push --force';

    expect([namesOf(line), namesOf(line)]).toEqual([['git push --force'], ['git push --force']]);
  });
});
