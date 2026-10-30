/**
 * The bot fragment workflow this repository installs at
 * `.github/workflows/release-bot-fragment.yml` is rafa's own template
 * (`packages/rafa-release/src/release/templates/release-bot-fragment.yml`) committed unchanged,
 * so a fix to the template reaches this repository's copy in the same
 * commit. The root eslint config lints no YAML, so this test is the
 * copy's only gate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** The repository root. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the installed bot fragment workflow', () => {
  it('is byte for byte the template rafa release workflows --write writes', () => {
    const installed = readFileSync(join(ROOT, '.github', 'workflows', 'release-bot-fragment.yml'), 'utf8');
    const template = readFileSync(join(ROOT, 'packages', 'rafa-release', 'src', 'release', 'templates', 'release-bot-fragment.yml'), 'utf8');

    expect(installed).toBe(template);
  });
});
