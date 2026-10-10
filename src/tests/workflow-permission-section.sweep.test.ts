import { readFileSync } from 'fs';
import { join } from 'path';

import { test, expect } from 'bun:test';

test('context/workflow.md holds What reaches a loop session section with permission rows', () => {
  const workflowPath = join(import.meta.dir, '..', '..', 'context', 'workflow.md');
  const content = readFileSync(workflowPath, 'utf-8');

  // Check that the section exists
  expect(content).toContain('### What reaches a loop session');

  // Check for the project,local row
  expect(content).toContain('`project,local`');

  // Check for the user,project,local row
  expect(content).toContain('`user,project,local`');

  // Check for Claude Code version number (format like "2.1.283")
  expect(content).toMatch(/Claude Code version \d+\.\d+\.\d+/);

  // Check that the section contains key phrase about scope limitations
  expect(content).toContain('operates under project and local setting scopes');

  // Check that the section mentions the deny and hook behavior
  expect(content).toContain('Deny held');
  expect(content).toContain('Hook fired');
});
