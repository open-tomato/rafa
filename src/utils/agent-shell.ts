/**
 * Whether the shell a command runs in belongs to an agent, read off one
 * environment variable.
 *
 * Claude Code sets `CLAUDECODE` in the environment of every command a
 * session runs, so a command finding it set is being run by an agent and
 * not typed by a person. A command that must hear a person's consent,
 * and never an agent's, asks {@link isAgentShell} before it acts.
 *
 * The environment is a parameter and never `process.env` read here: a
 * command hands its `context.env`, so a test decides the answer by the
 * environment it builds, whatever the session running the suite sets.
 *
 * The answer is a reading and not a proof. A shell with the variable
 * removed reads as a person's, and a person who exports it reads as an
 * agent. It is one function so the reading can be widened in one place.
 */

/** The variable Claude Code sets in the shell of every command a session runs. */
export const AGENT_SHELL_ENV = 'CLAUDECODE';

/**
 * True when `env` holds {@link AGENT_SHELL_ENV} with a non-empty value,
 * whatever the value: `0` counts as set. False for an environment
 * without the variable and for one holding it empty.
 */
export function isAgentShell(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[AGENT_SHELL_ENV];
  return value !== undefined && value !== '';
}
