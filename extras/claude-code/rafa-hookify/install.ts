/**
 * Puts the rafa tooling pack in place in the rafa project the current
 * directory belongs to, and says what it changed. Every step checks first,
 * so a second run changes nothing, and a run after this folder is updated
 * replaces only the files that differ.
 *
 * 1. `.claude/skills/rafa-tooling/SKILL.md` and its `help-tree.ts`.
 * 2. `.claude/hooks/rafa-tooling-hook.ts`.
 * 3. The PreToolUse entry for that hook in `.claude/settings.json`.
 * 4. The pointer line in `AGENTS.md`, or `CLAUDE.md` when there is no
 *    `AGENTS.md`.
 *
 * Usage: `bun install.ts [--dry-run]`. Exit 0 on success, 2 when it refuses.
 */

import { dirname, join } from 'node:path';

type Change = 'added' | 'updated' | 'unchanged';

interface Step {
  change: Change;
  path: string;
  content: string | null;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[] | undefined> };

const SOURCE = join(import.meta.dir, 'files');
const COPIES = [
  { from: 'rafa-tooling-skill.md', to: '.claude/skills/rafa-tooling/SKILL.md' },
  { from: 'help-tree.ts', to: '.claude/skills/rafa-tooling/help-tree.ts' },
  { from: 'rafa-tooling-hook.ts', to: '.claude/hooks/rafa-tooling-hook.ts' },
];
const HOOK_FILE = 'rafa-tooling-hook.ts';
const HOOK_COMMAND = 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/rafa-tooling-hook.ts"';
const SETTINGS = '.claude/settings.json';
const SKILL_PATH = '.claude/skills/rafa-tooling/SKILL.md';
const POINTER = [
  'The `rafa` CLI is installed here: read `.claude/skills/rafa-tooling/SKILL.md`',
  'before running or suggesting any `gh`, `rafa` or branch-cleanup command.',
].join('\n');

const refuse = (message: string): never => {
  console.error(`rafa-hookify: ${message}`);
  process.exit(2);
};

const readText = async (path: string): Promise<string | null> => {
  const file = Bun.file(path);
  return await file.exists()
    ? file.text()
    : null;
};

const projectRoot = async (): Promise<string> => {
  const top = await Bun.$`git rev-parse --show-toplevel`.nothrow().quiet();
  if (top.exitCode !== 0) return refuse('not inside a git repository; run it from the rafa project\'s checkout');
  const root = top.text().trim();
  if (!await Bun.file(join(root, '.rafa/config.yaml')).exists()) {
    return refuse(`${root} has no .rafa/config.yaml; run it from the checkout that holds .rafa/ (a session worktree often has none), or run rafa init first`);
  }
  return root;
};

const copyStep = async (root: string, from: string, to: string): Promise<Step> => {
  const wanted = await readText(join(SOURCE, from));
  if (wanted === null) return refuse(`the pack is missing ${join(SOURCE, from)}`);
  const current = await readText(join(root, to));
  if (current === wanted) return { change: 'unchanged', path: to, content: null };
  return { change: current === null
    ? 'added'
    : 'updated', path: to, content: wanted };
};

const isOurHook = (entry: HookEntry): boolean => (entry.hooks ?? []).some((hook) => hook.command?.includes(HOOK_FILE) ?? false);

const withOurHook = (entries: HookEntry[]): HookEntry[] => {
  const ours: HookEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_COMMAND }] };
  return [...entries.filter((entry) => !isOurHook(entry)), ours];
};

const settingsStep = async (root: string): Promise<Step> => {
  const text = await readText(join(root, SETTINGS));
  let settings: Settings;
  try {
    settings = text === null
      ? {}
      : JSON.parse(text) as Settings;
  } catch {
    return refuse(`${SETTINGS} is not valid JSON; fix it by hand, then run this again`);
  }
  const entries = settings.hooks?.PreToolUse ?? [];
  const already = entries.some((entry) => entry.matcher === 'Bash' && entry.hooks?.some((hook) => hook.command === HOOK_COMMAND));
  if (already) return { change: 'unchanged', path: SETTINGS, content: null };
  const next: Settings = { ...settings, hooks: { ...settings.hooks, PreToolUse: withOurHook(entries) } };
  const change: Change = text === null || !entries.some(isOurHook)
    ? 'added'
    : 'updated';
  return { change, path: SETTINGS, content: `${JSON.stringify(next, null, 2)}\n` };
};

const pointerStep = async (root: string): Promise<Step> => {
  const agents = await readText(join(root, 'AGENTS.md'));
  const path = agents === null
    ? 'CLAUDE.md'
    : 'AGENTS.md';
  const text = agents ?? await readText(join(root, 'CLAUDE.md'));
  if (text?.includes(SKILL_PATH) === true) return { change: 'unchanged', path, content: null };
  const content = text === null
    ? `${POINTER}\n`
    : `${text.trimEnd()}\n\n${POINTER}\n`;
  return { change: text === null
    ? 'added'
    : 'updated', path, content };
};

const apply = async (root: string, step: Step): Promise<void> => {
  if (step.content === null) return;
  const target = join(root, step.path);
  await Bun.$`mkdir -p ${dirname(target)}`.quiet();
  await Bun.write(target, step.content);
};

const dryRun = process.argv.includes('--dry-run');
const root = await projectRoot();
const steps = [
  ...await Promise.all(COPIES.map(({ from, to }) => copyStep(root, from, to))),
  await settingsStep(root),
  await pointerStep(root),
];
if (!dryRun) {
  for (const step of steps) await apply(root, step);
}

console.log(`${dryRun
  ? 'Would change'
  : 'Changed'} in ${root}:`);
for (const step of steps) console.log(`  ${step.change.padEnd(9)} ${step.path}`);
const changed = steps.some((step) => step.change !== 'unchanged');
if (dryRun) console.log('--dry-run: nothing was written.');
else if (changed) console.log('Start a new Claude Code session: skills and hooks load when a session starts.');
else console.log('Everything was already in place.');
