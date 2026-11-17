/** `migrate`: move a flat baseline set into the key layout; the person commits. */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa-core/core/command';

import { applyMigration, planMigration } from '../steps/migrate.js';

import { execLine, prepare, refusing, SUBJECT } from './shared.js';

/** A string flag's value, undefined when absent; refuses one typed with no value. */
function textFlag(context: RafaContext, name: string): string | undefined {
  const value = context.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true || value.trim() === '') throw new Error(`--${name} needs a value`);
  return value;
}

export const migrateCommand: RafaCommand = {
  name: 'visual migrate',
  subject: SUBJECT,
  action: 'migrate',
  summary: 'move a flat baseline set into the playwright/runner key layout',
  description: 'Moves <set>/__image_snapshots__ to <set>/<playwright>/<runner key>/__image_snapshots__ and writes its set.json from the old ENVIRONMENT file. The old ENVIRONMENT and MANIFEST.sha256 are removed only when the store\'s git already holds them in a commit. Commits nothing.',
  args: [],
  flags: [
    { name: 'dry-run', description: 'print the move and the record, and write nothing', type: 'boolean' },
    { name: 'playwright', description: 'the playwright version that drew the set, when there is no ENVIRONMENT', type: 'string' },
    { name: 'runner', description: 'the runner key that drew the set (host-darwin-arm64), when there is no ENVIRONMENT', type: 'string' },
  ],
  examples: [
    { cmd: execLine('migrate', '--dry-run'), note: 'prints what the migration would do' },
    { cmd: execLine('migrate'), note: 'moves the set and writes its record' },
  ],
  outputs: ['text'],
  needsProject: false,
  run: (context) => refusing(context, async () => {
    const playwright = textFlag(context, 'playwright');
    const runner = textFlag(context, 'runner');
    const env = await prepare(context);
    const plan = await planMigration(env.loaded, { ...(playwright === undefined
      ? {}
      : { playwright }), ...(runner === undefined
      ? {}
      : { runner }) });
    if (context.flags['dry-run'] === true) {
      context.output.info(`would move ${plan.from} to ${plan.to}`);
      context.output.info(`would write ${plan.recordFile}:\n${JSON.stringify(plan.record, null, 2)}`);
      for (const file of plan.removes) context.output.info(`would remove ${file} if the store's git holds it in a commit, else keep it`);
      context.output.info('dry run: nothing was written');
      return;
    }
    const result = await applyMigration(plan, env.run);
    context.output.info(`moved ${plan.record.files} files to ${plan.to}`);
    for (const file of result.removed) context.output.info(`removed ${file}; its content stays in the store's history`);
    for (const file of result.kept) context.output.warn(`kept ${file}: git does not hold it in a commit; commit it or remove it yourself`);
    context.output.info('commit the migration in the store yourself when it looks right');
  }),
};
