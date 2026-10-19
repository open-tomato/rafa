import { describe, expect, it } from 'bun:test';

import { spawnApis } from './test-index-spawn';

describe('the spawn reading', () => {
  it('reads each way of spawning from a parse', () => {
    expect(spawnApis('a.ts', 'Bun.spawn([]);\nBun.spawnSync([]);\nawait Bun.$`ls`;\n')).toEqual(['Bun.$', 'Bun.spawn', 'Bun.spawnSync']);
    expect(spawnApis('a.ts', 'import { $ } from \'bun\';\nimport { spawn } from \'child_process\';\n')).toEqual(['$ from bun', 'child_process']);
    expect(spawnApis('a.mjs', 'import * as cp from \'node:child_process\';\n')).toEqual(['node:child_process']);
    expect(spawnApis('a.ts', 'import { file } from \'bun\';\nimport { type $ } from \'bun\';\n')).toEqual([]);
  });
});
