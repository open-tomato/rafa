/**
 * Puts the rafa tooling pack in place in the rafa project the current
 * directory belongs to, and says what it changed. Every step checks first,
 * so a second run changes nothing, and a run after this folder is updated
 * replaces only the files that differ.
 *
 * 1. `.claude/skills/rafa-tooling/SKILL.md` and its `help-tree.ts`.
 * 2. `.claude/hooks/rafa-tooling-hook.ts` and
 *    `.claude/hooks/rafa-session-hook.ts`.
 * 3. In `.claude/settings.json`, the PreToolUse entry for the tooling hook
 *    (matcher `Bash`) and the SessionStart entry for the session hook
 *    (timeout 120 seconds, room for a hub at the longest `hub.timeout`). Each
 *    is its own row of the list, and the rest of the file is kept.
 * 4. The pointer line in `AGENTS.md`, or `CLAUDE.md` when there is no
 *    `AGENTS.md`.
 *
 * Usage: `bun install.ts [--dry-run]`. Exit 0 on success, 2 when it refuses.
 * `--dry-run` prints the same list, one row per step, and writes nothing.
 */

import { dirname, join } from 'node:path';

type Change = 'added' | 'updated' | 'unchanged';

interface Step {
  change: Change;
  path: string;
  /** What the list prints for the step, when it is more than `path`. */
  label?: string;
  content: string | null;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string; timeout?: number }[];
}

/** One entry the installer keeps in `.claude/settings.json`. */
interface HookSpec {
  event: 'PreToolUse' | 'SessionStart';
  /** The hook file's name, which tells an entry of ours from any other. */
  file: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[] | undefined> };

const SOURCE = join(import.meta.dir, 'files');
const COPIES = [
  { from: 'rafa-tooling-skill.md', to: '.claude/skills/rafa-tooling/SKILL.md' },
  { from: 'help-tree.ts', to: '.claude/skills/rafa-tooling/help-tree.ts' },
  { from: 'rafa-tooling-hook.ts', to: '.claude/hooks/rafa-tooling-hook.ts' },
  { from: 'rafa-session-hook.ts', to: '.claude/hooks/rafa-session-hook.ts' },
];
/** Seconds Claude Code waits for the session hook's `rafa effort sync`. */
const SESSION_HOOK_TIMEOUT_SECONDS = 120;
const HOOK_SPECS: readonly HookSpec[] = [
  {
    event: 'PreToolUse',
    file: 'rafa-tooling-hook.ts',
    matcher: 'Bash',
    command: 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/rafa-tooling-hook.ts"',
  },
  {
    event: 'SessionStart',
    file: 'rafa-session-hook.ts',
    command: 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/rafa-session-hook.ts"',
    timeout: SESSION_HOOK_TIMEOUT_SECONDS,
  },
];
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

const isOurHook = (entry: HookEntry, spec: HookSpec): boolean => (entry.hooks ?? []).some((hook) => hook.command?.includes(spec.file) ?? false);

const ourEntry = (spec: HookSpec): HookEntry => {
  const hook = spec.timeout === undefined
    ? { type: 'command', command: spec.command }
    : { type: 'command', command: spec.command, timeout: spec.timeout };
  return spec.matcher === undefined
    ? { hooks: [hook] }
    : { matcher: spec.matcher, hooks: [hook] };
};

const isInPlace = (entry: HookEntry, spec: HookSpec): boolean => entry.matcher === spec.matcher
  && (entry.hooks ?? []).some((hook) => hook.command === spec.command && hook.timeout === spec.timeout);

const readSettings = async (root: string): Promise<Settings | null> => {
  const text = await readText(join(root, SETTINGS));
  if (text === null) return null;
  try {
    return JSON.parse(text) as Settings;
  } catch {
    return refuse(`${SETTINGS} is not valid JSON; fix it by hand, then run this again`);
  }
};

/**
 * One row per entry of {@link HOOK_SPECS}, each judged on the file as read.
 * Every changed row carries the whole file with all entries in place, so
 * writing it once or twice leaves the same file.
 */
const settingsSteps = async (root: string): Promise<Step[]> => {
  const read = await readSettings(root);
  const settings: Settings = read ?? {};
  const changes = HOOK_SPECS.map((spec): Change => {
    const entries = settings.hooks?.[spec.event] ?? [];
    if (entries.some((entry) => isInPlace(entry, spec))) return 'unchanged';
    return read === null || !entries.some((entry) => isOurHook(entry, spec))
      ? 'added'
      : 'updated';
  });
  const hooks = HOOK_SPECS.reduce<NonNullable<Settings['hooks']>>((acc, spec, index) => changes[index] === 'unchanged'
    ? acc
    : { ...acc, [spec.event]: [...(acc[spec.event] ?? []).filter((entry) => !isOurHook(entry, spec)), ourEntry(spec)] }, { ...settings.hooks });
  const content = `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`;
  return HOOK_SPECS.map((spec, index) => {
    const change = changes[index] ?? 'unchanged';
    return { change, path: SETTINGS, label: `${SETTINGS} ${spec.event}`, content: change === 'unchanged'
      ? null
      : content };
  });
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
  ...await settingsSteps(root),
  await pointerStep(root),
];
if (!dryRun) {
  for (const step of steps) await apply(root, step);
}

console.log(`${dryRun
  ? 'Would change'
  : 'Changed'} in ${root}:`);
for (const step of steps) console.log(`  ${step.change.padEnd(9)} ${step.label ?? step.path}`);
const changed = steps.some((step) => step.change !== 'unchanged');
if (dryRun) console.log('--dry-run: nothing was written.');
else if (changed) console.log('Start a new Claude Code session: skills and hooks load when a session starts.');
else console.log('Everything was already in place.');
