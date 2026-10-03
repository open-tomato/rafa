/**
 * Tests for the workflow-trigger reading (`workflow-triggers.ts`).
 *
 * The case the module exists for is the repository's own
 * `.github/workflows/verify.yml`, read from disk rather than copied, so
 * the cases follow the file: it runs on `pull_request` into `main` and
 * on `push` to `stretch/**`, so it names `main` and not `stretch/1`.
 * Each "does not name" answer has a sibling over a near text that does,
 * because a reader answering false for everything would pass every case
 * about `stretch/1`, and one answering true for everything would pass
 * every case about `main` and every unreadable shape.
 */
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  branchPatternMatches,
  workflowNamesBase,
  workflowsRunOnPullRequestsInto,
} from './workflow-triggers.js';

const VERIFY_YML = await Bun.file(join(import.meta.dir, '..', '..', '.github', 'workflows', 'verify.yml')).text();

/** A workflow whose `on:` block is `onBlock`, indented as written. */
function workflowWith(onBlock: string): string {
  return `name: t\n${onBlock}\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n`;
}

describe('the repository\'s own verify.yml', () => {
  test('holds the pull_request into main and push to stretch/** triggers these cases read', () => {
    const on = (Bun.YAML.parse(VERIFY_YML) as { on: unknown }).on;
    expect(on).toEqual({ pull_request: { branches: ['main'] }, push: { branches: ['stretch/**'] } });
  });

  test('names main', () => {
    expect(workflowNamesBase(VERIFY_YML, 'main')).toBe(true);
    expect(workflowsRunOnPullRequestsInto([VERIFY_YML], 'main')).toBe(true);
  });

  test('does not name stretch/1, whose stretch/** filter sits under push only', () => {
    expect(workflowNamesBase(VERIFY_YML, 'stretch/1')).toBe(false);
    expect(workflowsRunOnPullRequestsInto([VERIFY_YML], 'stretch/1')).toBe(false);
  });

  test('names stretch/1 once the same text puts stretch/** under pull_request', () => {
    const control = VERIFY_YML.replace('      - main', '      - main\n      - \'stretch/**\'');
    expect(control).not.toBe(VERIFY_YML);
    expect(workflowNamesBase(control, 'stretch/1')).toBe(true);
  });
});

describe('workflowsRunOnPullRequestsInto', () => {
  test('answers false for no workflow files', () => {
    expect(workflowsRunOnPullRequestsInto([], 'main')).toBe(false);
  });

  test('answers true when any one file names the base', () => {
    const pushOnly = workflowWith('on: push');
    expect(workflowsRunOnPullRequestsInto([pushOnly, VERIFY_YML], 'main')).toBe(true);
    expect(workflowsRunOnPullRequestsInto([pushOnly, VERIFY_YML], 'stretch/1')).toBe(false);
  });

  test('answers true when one file does not parse', () => {
    expect(workflowsRunOnPullRequestsInto([VERIFY_YML, 'on: [pull_request'], 'stretch/1')).toBe(true);
  });
});

describe('workflowNamesBase: the forms of on', () => {
  test('a string names every base when it is pull_request, none when another event', () => {
    expect(workflowNamesBase(workflowWith('on: pull_request'), 'stretch/1')).toBe(true);
    expect(workflowNamesBase(workflowWith('on: push'), 'stretch/1')).toBe(false);
    expect(workflowNamesBase(workflowWith('on: pull_request_target'), 'stretch/1')).toBe(false);
  });

  test('a list names every base when it holds pull_request, none when it does not', () => {
    expect(workflowNamesBase(workflowWith('on: [push, pull_request]'), 'stretch/1')).toBe(true);
    expect(workflowNamesBase(workflowWith('on: [push, workflow_dispatch]'), 'stretch/1')).toBe(false);
  });

  test('a map with an empty pull_request names every base, one without it none', () => {
    expect(workflowNamesBase(workflowWith('on:\n  pull_request:\n  push:'), 'stretch/1')).toBe(true);
    expect(workflowNamesBase(workflowWith('on:\n  push:\n  workflow_dispatch:'), 'stretch/1')).toBe(false);
  });

  test('a pull_request map holding only types names every base', () => {
    expect(workflowNamesBase(workflowWith('on:\n  pull_request:\n    types: [opened]'), 'stretch/1')).toBe(true);
  });
});

describe('workflowNamesBase: branches and branches-ignore', () => {
  test('branches as a single string is one pattern', () => {
    expect(workflowNamesBase(workflowWith('on:\n  pull_request:\n    branches: main'), 'main')).toBe(true);
    expect(workflowNamesBase(workflowWith('on:\n  pull_request:\n    branches: main'), 'stretch/1')).toBe(false);
  });

  test('a later ! pattern takes back a match listed before it, and a later pattern can match it in again', () => {
    const negated = workflowWith('on:\n  pull_request:\n    branches: [\'stretch/**\', \'!stretch/1\']');
    expect(workflowNamesBase(negated, 'stretch/1')).toBe(false);
    expect(workflowNamesBase(negated, 'stretch/2')).toBe(true);
    const restored = workflowWith('on:\n  pull_request:\n    branches: [\'stretch/**\', \'!stretch/*\', \'stretch/1\']');
    expect(workflowNamesBase(restored, 'stretch/1')).toBe(true);
    expect(workflowNamesBase(restored, 'stretch/2')).toBe(false);
  });

  test('branches-ignore names a base none of its patterns match', () => {
    const ignoring = workflowWith('on:\n  pull_request:\n    branches-ignore: [\'stretch/**\']');
    expect(workflowNamesBase(ignoring, 'stretch/1')).toBe(false);
    expect(workflowNamesBase(ignoring, 'main')).toBe(true);
  });
});

describe('workflowNamesBase: unreadable answers name the base', () => {
  test.each([
    ['a text that does not parse', 'on: [pull_request'],
    ['a document that is not a map', '- just\n- a list\n'],
    ['a workflow with no on key', 'name: t\njobs: {}\n'],
    ['a list of events holding a map', workflowWith('on: [push, {pull_request: null}]')],
    ['a pull_request value that is a list', workflowWith('on:\n  pull_request: [main]')],
    ['both branches and branches-ignore', workflowWith('on:\n  pull_request:\n    branches: [main]\n    branches-ignore: [dev]')],
    ['branches holding a number', workflowWith('on:\n  pull_request:\n    branches: [1]')],
    ['a ! pattern under branches-ignore', workflowWith('on:\n  pull_request:\n    branches-ignore: [\'!main\']')],
    ['a pattern that does not compile', workflowWith('on:\n  pull_request:\n    branches: [\'?main\']')],
  ])('%s', (_label, text) => {
    expect(workflowNamesBase(text, 'stretch/1')).toBe(true);
  });
});

describe('branchPatternMatches', () => {
  test('* matches any run but /, ** any run including /', () => {
    expect(branchPatternMatches('stretch/*', 'stretch/1')).toBe(true);
    expect(branchPatternMatches('stretch/*', 'stretch/a/b')).toBe(false);
    expect(branchPatternMatches('stretch/**', 'stretch/a/b')).toBe(true);
    expect(branchPatternMatches('*', 'main')).toBe(true);
    expect(branchPatternMatches('*', 'stretch/1')).toBe(false);
    expect(branchPatternMatches('**', 'stretch/1')).toBe(true);
  });

  test('? matches zero or one of the preceding character, + one or more', () => {
    expect(branchPatternMatches('mains?', 'main')).toBe(true);
    expect(branchPatternMatches('mains?', 'mains')).toBe(true);
    expect(branchPatternMatches('mains?', 'mainx')).toBe(false);
    expect(branchPatternMatches('ma+in', 'maaain')).toBe(true);
    expect(branchPatternMatches('ma+in', 'min')).toBe(false);
  });

  test('[...] matches one character from its set or range', () => {
    expect(branchPatternMatches('stretch/[0-9]', 'stretch/7')).toBe(true);
    expect(branchPatternMatches('stretch/[0-9]', 'stretch/x')).toBe(false);
  });

  test('matches the whole name, and reads regex characters literally', () => {
    expect(branchPatternMatches('main', 'main2')).toBe(false);
    expect(branchPatternMatches('release.1', 'releasex1')).toBe(false);
    expect(branchPatternMatches('release.1', 'release.1')).toBe(true);
    expect(branchPatternMatches('a\\*b', 'a*b')).toBe(true);
    expect(branchPatternMatches('a\\*b', 'axb')).toBe(false);
  });

  test('answers null for a pattern that does not compile', () => {
    expect(branchPatternMatches('?main', 'main')).toBeNull();
    expect(branchPatternMatches('*+', 'main')).toBeNull();
    expect(branchPatternMatches('[0-9', 'main')).toBeNull();
    expect(branchPatternMatches('[z-a]', 'main')).toBeNull();
    expect(branchPatternMatches('main\\', 'main')).toBeNull();
  });
});
