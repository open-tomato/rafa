/**
 * The workspace gates over this repository: the graph check and the
 * references build, both exit 0. A sweep, since both read every member
 * under `packages/` and no import of this file does. The red control over
 * a planted root is in `facade-check.test.ts`.
 */
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';

import { workspaceGates } from './facade-check';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the workspace gates over this repository', () => {
  it('exits 0 for the graph check and for the references build', () => {
    const gates = workspaceGates(REPO_ROOT);
    expect({ exitCode: gates.graph.exitCode, lines: gates.graph.lines, timedOut: gates.graph.timedOut })
      .toMatchObject({ exitCode: 0, timedOut: false });
    expect(gates.graph.lines.some((line) => line.startsWith('packages/rafa (@open-tomato/rafa-core): ok'))).toBe(true);
    expect({ exitCode: gates.references.exitCode, lines: gates.references.lines, timedOut: gates.references.timedOut })
      .toEqual({ exitCode: 0, lines: [], timedOut: false });
  });
});
