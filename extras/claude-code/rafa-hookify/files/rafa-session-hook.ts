/**
 * A Claude Code SessionStart hook that syncs the effort store with its hub
 * when a session opens: it runs the installed `rafa effort sync
 * --output=json`, the `rafa` first on `PATH`, in the project directory
 * (`CLAUDE_PROJECT_DIR`, else the current one), and prints the lines that
 * run wrote, one per line, when it contacted a hub. A SessionStart hook's
 * output goes to the session as context, so a session opened after weeks
 * starts with `hub: reachable, contract 1, project rafa; pulled 312 rows`,
 * or with the refusal or offline line standing in its place.
 *
 * It prints nothing when no hub was contacted: under `effort.sync: local`
 * or `file`, outside a rafa project, under a rafa with no `effort sync`
 * action, and for anything it cannot read as the command's json output
 * ({@link linesToPrint} says which results count as a contact). It exits 0
 * whatever `rafa` answers, a missing `rafa` included, so a session always
 * starts. The hook input on stdin is not read.
 *
 * `/rafa-hookify` copies it to `.claude/hooks/` and wires it in
 * `.claude/settings.json`:
 *
 * ```json
 * { "hooks": { "SessionStart": [{ "hooks": [
 *   { "type": "command", "command": "bun \"$CLAUDE_PROJECT_DIR/.claude/hooks/rafa-session-hook.ts\"", "timeout": 120 }
 * ] }] } }
 * ```
 */

/** The command the hook runs, its program found on `PATH`. */
export const SYNC_COMMAND: readonly string[] = Object.freeze(['rafa', 'effort', 'sync', '--output=json']);

/** The error code the dispatcher gives a command that exited nonzero itself. */
const COMMAND_EXIT_CODE = 'command_exit';

/** How the command opens a refusal of its own line or config, which contacts nothing. */
const OWN_REFUSAL_MARK = '❌';

/** The terminal result event of a `--output=json` run, as far as the hook reads it. */
interface ResultEvent {
  readonly type: 'result';
  readonly ok: boolean;
  readonly data?: { readonly contacted?: unknown; readonly lines?: unknown };
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The last `result` event among the json lines of `stdout`, or null when none parses. */
export const resultEventOf = (stdout: string): ResultEvent | null => {
  const events = stdout.split('\n').flatMap((line): ResultEvent[] => {
    try {
      const event: unknown = JSON.parse(line);
      return isRecord(event) && event.type === 'result' && typeof event.ok === 'boolean'
        ? [event as unknown as ResultEvent]
        : [];
    } catch {
      return [];
    }
  });
  return events.at(-1) ?? null;
};

const textLines = (value: unknown): string[] => (Array.isArray(value)
  ? value.filter((line): line is string => typeof line === 'string')
  : [])
  .flatMap((line) => line.split('\n'))
  .filter((line) => line.trim() !== '');

/**
 * The lines the hook prints for the stdout of a `rafa effort sync
 * --output=json` run; empty when no hub was contacted.
 *
 * - A run exiting 0 gives `data.contacted` and `data.lines`: the lines
 *   when `contacted` is true, none when it is false.
 * - A run exiting 1 carries no data, and its error's message is the lines
 *   it wrote. It counts as a contact when the command exited itself
 *   (`command_exit`) with a message not opening with `❌`, the command's
 *   refusal of its own line or config. Any other error, such as no rafa
 *   project or an action this rafa does not have, contacted nothing.
 * - Output holding no result event prints nothing.
 */
export const linesToPrint = (stdout: string): string[] => {
  const result = resultEventOf(stdout);
  if (result === null) return [];
  if (result.ok) {
    return result.data?.contacted === true
      ? textLines(result.data.lines)
      : [];
  }
  const { code, message } = result.error ?? {};
  if (code !== COMMAND_EXIT_CODE || typeof message !== 'string' || message.trimStart().startsWith(OWN_REFUSAL_MARK)) return [];
  return textLines([message]);
};

/** Runs {@link SYNC_COMMAND} in `cwd` and answers its stdout, or null when `rafa` could not be started. */
export const runSync = async (cwd: string): Promise<string | null> => {
  try {
    const child = Bun.spawn([...SYNC_COMMAND], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const stdout = await new Response(child.stdout).text();
    await child.exited;
    return stdout;
  } catch {
    return null;
  }
};

if (import.meta.main) {
  const stdout = await runSync(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const lines = stdout === null
    ? []
    : linesToPrint(stdout);
  if (lines.length > 0) console.log(lines.join('\n'));
  process.exit(0);
}
