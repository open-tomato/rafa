/**
 * The publish workflow this repository installs at
 * `.github/workflows/release-publish.yml` is rafa's own template
 * (`src/release/templates/release-publish.yml`) committed unchanged, so a
 * fix to the template reaches this repository's copy in the same commit.
 * The root eslint config lints no YAML, so this test is the copy's only
 * gate. The workflow publishes only once the operator has configured a
 * trusted publisher on npmjs.com naming this repository and the file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** The repository root. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the installed publish workflow', () => {
  it('is byte for byte the template rafa release workflows --write writes', () => {
    const installed = readFileSync(join(ROOT, '.github', 'workflows', 'release-publish.yml'), 'utf8');
    const template = readFileSync(join(ROOT, 'src', 'release', 'templates', 'release-publish.yml'), 'utf8');

    expect(installed).toBe(template);
  });
});
