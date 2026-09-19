/**
 * Tests for the `roadmap.issue` write (`src/board/setup-config.ts`): the
 * three shapes of config text the edit covers, the fourth it refuses,
 * and the setting read back off a project root.
 *
 * The config the branch cases start from is the bytes `rafa init`
 * writes, `projectConfigText()`, so the uncomment branch is driven
 * against the template that actually ships rather than against a
 * two-line imitation of it. Every text is parsed back through
 * `parseConfigText`, which is what a written file would be read with, so
 * a branch that produced a file this rafa cannot load reddens here.
 *
 * A line edit passes while wrong most easily by writing a line that
 * parses and means something else, so the refused shape has a case of
 * its own: `roadmap: {issue: 4}` appended to would read back as the new
 * issue and still hold the key twice.
 *
 * No case touches the real home or a real project: each root is a
 * directory under this file's own temporary root.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { readRoadmapSetting, roadmapIssueIn, withRoadmapIssue } from './setup-config.js';

/** A temporary directory of this file own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-config-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh project root holding `text` as its project config. */
function rootHolding(label: string, text: string): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

describe('withRoadmapIssue', () => {
  it('uncomments the roadmap block the written config carries', () => {
    const text = withRoadmapIssue(projectConfigText(), 31);

    expect(text).toContain('roadmap:\n  issue: 31\n');
    expect(parseConfigText(text, 'config.yaml').values.roadmapIssue).toBe(31);
    expect(text).toContain('# rafa project config');
  });

  it('sets the issue under a roadmap key the file already spells', () => {
    const text = withRoadmapIssue('version: 1\nroadmap:\n', 9);

    expect(text).toBe('version: 1\nroadmap:\n  issue: 9\n');
  });

  it('appends the block to a file naming no roadmap at all', () => {
    const text = withRoadmapIssue('version: 1\n', 7);

    expect(text).toBe('version: 1\nroadmap:\n  issue: 7\n');
    expect(parseConfigText(text, 'config.yaml').values.roadmapIssue).toBe(7);
  });
});

describe('readRoadmapSetting', () => {
  it('answers the problem, and no issue, for a root holding no config', () => {
    const reading = readRoadmapSetting(join(tempBase, 'nowhere'));

    expect(reading.issue).toBe(null);
    expect(reading.problem).toContain('could not be read');
  });
});

describe('withRoadmapIssue over a shape it does not edit', () => {
  it('answers null rather than a file holding the key twice', () => {
    expect(withRoadmapIssue('version: 1\nroadmap: {issue: 4}\n', 5)).toBe(null);
    expect(withRoadmapIssue('version: 1\nroadmap: 4\n', 5)).toBe(null);
  });
});

describe('roadmapIssueIn', () => {
  it('reads the last of two issue lines under one roadmap key, as the parser does', () => {
    expect(roadmapIssueIn('version: 1\nroadmap:\n  issue: 5\n  issue: 4\n', 'config.yaml')).toBe(4);
  });

  it('throws for a text this rafa cannot read as a config', () => {
    expect(() => roadmapIssueIn('version: 1\nroadmap:\n  issue: 0\n', 'config.yaml')).toThrow(/roadmap.issue is 0/u);
  });
});

describe('readRoadmapSetting over a root', () => {
  it('answers the issue the project config names, with the text it read', () => {
    const text = withRoadmapIssue(projectConfigText(), 12) ?? '';
    const root = rootHolding('named', text);

    const reading = readRoadmapSetting(root);

    expect(reading.issue).toBe(12);
    expect(reading.text).toBe(text);
    expect(reading.problem).toBe(null);
  });

  it('answers no issue, and no problem, for a config naming none', () => {
    const reading = readRoadmapSetting(rootHolding('silent', projectConfigText()));

    expect(reading.issue).toBe(null);
    expect(reading.problem).toBe(null);
  });

  it('answers the problem, and no issue, for a config this rafa cannot read', () => {
    const reading = readRoadmapSetting(rootHolding('broken', 'version: 1\nroadmap:\n  issue: 0\n'));

    expect(reading.issue).toBe(null);
    expect(reading.problem).toContain('roadmap.issue is 0');
  });
});
