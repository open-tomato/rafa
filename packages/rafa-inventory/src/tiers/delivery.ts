/**
 * How a served skill reaches a loop session, and the Claude Code version
 * that answer was measured against.
 *
 * A loop session runs under `--setting-sources project,local` by
 * default, so a winner from the rafa tier, or a user-tier winner under
 * those sources, is one Claude Code would not load by itself. rafa
 * copies such winners into a served directory and hands that directory
 * to the session with a session-only flag. This module records WHICH
 * flag, as {@link SKILL_DELIVERY}. Building the served directory and
 * the flags is not done here.
 *
 * ## The probe it was chosen from
 *
 * Claude Code offers three session-only routes, and nothing documents
 * which of them loads a skill under its bare name under those sources,
 * so the choice is a measurement. It was made on 2026-09-24 against
 * {@link SERVE_CLI_VERSION}. There was one `claude -p` session per flag,
 * started with `--setting-sources project,local` in an empty git
 * repository outside this one. Each run read the `skills` and `agents`
 * of the stream-json `init` message, and the session was asked to list
 * both. A session with no flag listed none of the planted names. A
 * skill planted in that repository's own `.claude/skills` was listed
 * under its bare name. Those two controls show the reading could come
 * out either way.
 *
 *   - `--add-dir <dir>` listed `<dir>/.claude/skills/<name>` and
 *     `<dir>/.claude/agents/<name>.md` under their bare names. A skill
 *     at `<dir>/skills/<name>` was not listed, so a served directory
 *     keeps the `.claude/` layout.
 *   - `--plugin-dir <dir>`, a directory holding
 *     `.claude-plugin/plugin.json`, listed its skill and its agent as
 *     `<plugin>:<name>`. That name is not the one a plan or a prompt
 *     says.
 *   - `--agents` accepted an inline JSON object and listed its agent
 *     under the bare name. It carries agents only, and a file path in
 *     its place exits 1 with `Invalid --agents configuration`.
 *
 * So skills go by `add-dir`. The full reading, with what the probe
 * did not measure, is the "Serving" section of `context/inventory.md`.
 * `delivery.test.ts` holds that section to both constants here, so the
 * page and the pin move together.
 *
 * {@link SERVE_CLI_VERSION} follows the pattern of `PLUGINS_CLI_VERSION`
 * in `inventory/plugins.ts`. It names the one version the answer is
 * known to hold for, and it is not a floor. A later CLI can change any
 * of the three readings, so a new version means running the probe again
 * before trusting the pin.
 */

/** A session-only flag that can carry a served skill into a loop session. */
export type SkillDelivery = 'add-dir' | 'plugin-dir';

/** The Claude Code version the delivery probe ran against. */
export const SERVE_CLI_VERSION = '2.1.280';

/**
 * The flag that serves skills: `--add-dir`, the one of the two that
 * keeps a skill's bare name under `--setting-sources project,local`.
 */
export const SKILL_DELIVERY: SkillDelivery = 'add-dir';
