/**
 * The epic guard this repository installs at
 * `.github/workflows/epic-guard.yml` is rafa's own template
 * (`src/board/templates/epic-guard.yml`) committed unchanged, so a fix to
 * the template reaches this repository's copy in the same commit. The
 * root eslint config lints no YAML, so this test is the copy's only gate.
 * The guard is installed disabled; `context/workflow.md` says when the
 * person turns it on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** The repository root. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the installed epic guard', () => {
  it('is byte for byte the template rafa init --board --epic-guard writes', () => {
    const installed = readFileSync(join(ROOT, '.github', 'workflows', 'epic-guard.yml'), 'utf8');
    const template = readFileSync(join(ROOT, 'src', 'board', 'templates', 'epic-guard.yml'), 'utf8');

    expect(installed).toBe(template);
  });
});
