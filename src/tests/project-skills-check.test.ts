/**
 * `checkDirectory` over this REPOSITORY's own `.claude/skills` — the
 * project tier a consumer of rafa never has to seed by hand, since it
 * ships in the repo's own index — with no `--fix`, so a real run over
 * it never silently rewrites a checked-in file.
 *
 * ## Why `PATH` is seamed rather than read off this machine
 *
 * `.plans/CLOSEOUT-phase-2-schema-checker-demotion.md` ("Hand repair
 * of every remaining failure, all three tiers") records that clearing
 * the earlier `missing-tool` failures on THIS machine meant hand
 * installing a long tail of per-language toolchains — `ripgrep`, `go`,
 * `maven`, `php`, `composer`, `k6`, `trivy`, `grype`, `golangci-lint`,
 * `uv`, `poetry`, `mypy`, `pyright`, `dotnet`, `gcloud`, and more —
 * and adding every one of their install locations to `~/.zshrc`, so
 * every later shell on this machine sees them. A test that ran
 * `checkDirectory` against `process.env.PATH` would read that whole
 * hand-built toolchain as though it were guaranteed, pass here, and
 * say nothing about whether the SAME directory checks clean on a bare
 * CI runner that never ran that install list.
 *
 * `pathDirs` is instead built from a scratch `bin/` directory holding
 * one executable stub per {@link CI_TOOLS} — the tools this bun
 * project's own gates actually need (`bun`, every gate; `git`, the two
 * skills that shell out to it) — and nothing else. Nothing here reads
 * this repo's real `.claude/skills` bodies to pick that list; it is
 * fixed, so a skill added later that leans on a THIRD tool has to
 * declare a `stack` (making a missing tool `missing-tool-off-stack`, a
 * warning) or the tool has to be added to {@link CI_TOOLS} by hand —
 * either way, on purpose, not by whatever happens to be installed here.
 *
 * ## The planted copy beside it
 *
 * A `checkDirectory` call that always answered zero failures would
 * satisfy the assertion above whether or not `pathDirs` and
 * `projectRoot` were wired at all. The second suite is the control: a
 * COPY of the real tier, one required field stripped from one copied
 * file, checked the same way. It has to redden — `failingFiles: 1`,
 * naming exactly the file this test broke — or the first suite's zero
 * is not proof of anything.
 */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { checkDirectory } from '../check/run.js';

/** This checkout's root, resolved off this file's own URL. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The project tier this test measures: the repo's own checked-in skills. */
const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');

/**
 * The tools a CI runner for this project actually provides. See the
 * module note for why this is a fixed list rather than whatever this
 * machine's `PATH` happens to hold.
 */
const CI_TOOLS: readonly string[] = ['bun', 'git'];

/** A temporary directory of this file's own, cleaned up once, at the end. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-project-skills-check-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/**
 * A scratch `bin/` directory under `root`, holding one executable stub
 * per {@link CI_TOOLS} name, and the `pathDirs` list naming it.
 */
function ciPathDirs(root: string): readonly string[] {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const tool of CI_TOOLS) {
    const path = join(bin, tool);
    writeFileSync(path, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(path, 0o755);
  }
  return [bin];
}

describe('this repository skills tier, checked with the PATH a CI runner provides', () => {
  it('exits 0 with no --fix', () => {
    const seamRoot = mkdtempSync(join(tempBase, 'ci-path-'));

    const report = checkDirectory(SKILLS_DIR, 'skill', {
      projectRoot: REPO_ROOT,
      pathDirs: ciPathDirs(seamRoot),
      fix: false,
    });

    expect(report.failingFiles).toBe(0);
    expect(report.exitCode).toBe(0);
  });
});

describe('a planted failing copy of the same tier', () => {
  it('reddens once a required field is stripped from one copied file', () => {
    const seamRoot = mkdtempSync(join(tempBase, 'planted-'));
    const copyRoot = join(seamRoot, 'skills');
    cpSync(SKILLS_DIR, copyRoot, { recursive: true });

    const target = join(copyRoot, 'api', 'SKILL.md');
    const before = readFileSync(target, 'utf8');
    const broken = before.replace(/\ndescription:.*\n/, '\n');
    expect(broken).not.toBe(before);
    writeFileSync(target, broken, 'utf8');

    const report = checkDirectory(copyRoot, 'skill', {
      projectRoot: REPO_ROOT,
      pathDirs: ciPathDirs(seamRoot),
      fix: false,
    });

    expect(report.failingFiles).toBe(1);
    expect(report.exitCode).toBe(1);
    const failed = report.reports.filter((entry) => entry.failed);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.path).toBe(target);
    expect(failed[0]?.issues.map((issue) => `${issue.stage} ${issue.code} (${issue.field ?? ''})`))
      .toContain('schema missing-field (description)');
  });
});
