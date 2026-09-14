#!/usr/bin/env bun

/**
 * `rafa usage`: the Claude usage bar.
 *
 * Every line goes through the active output (`adapters/output/active.ts`)
 * at `info`, each message as `console.log` printed it in phase 0, so text
 * mode writes the same bytes and json mode writes each line as a `log`
 * event. The command reads no argument.
 */
import { activeOutput } from './adapters/output/active.js';
import { getClaudeUsagePercent } from './utils/claude.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- implementation tbd
export default async function usage(_args: string[]): Promise<void> {
  const pct = await getClaudeUsagePercent();

  if (pct === null) {
    activeOutput().info('Claude usage: unavailable');
    activeOutput().info(
      'Tip: set CLAUDE_USAGE_PERCENT=<0-100> to override until a live source is available.',
    );
    return;
  }

  const bar = buildBar(pct);
  const label =
    pct >= 90
      ? 'CRITICAL — consider pausing'
      : pct >= 80
        ? 'HIGH — monitor closely'
        : pct >= 70
          ? 'ELEVATED'
          : 'OK';

  activeOutput().info(`Claude usage: ${pct.toFixed(1)}%  [${bar}]  ${label}`);
}

function buildBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
