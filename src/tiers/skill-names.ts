/**
 * A served skill's name as a plan uses it, and as a loop session uses it.
 *
 * Plans, prompts and `skills=` always use a skill's bare name.
 * {@link SKILL_DELIVERY} (`src/tiers/delivery.ts`) decides what a
 * session calls a skill that was served to it:
 *
 *   - `add-dir`: the bare name. The probe listed a skill under
 *     `<served>/.claude/skills/<name>` by its bare name, so both
 *     functions here return the name unchanged.
 *   - `plugin-dir`: `rafa:<name>`. The probe listed a plugin's skills as
 *     `<plugin>:<name>`, and `serve.ts` names the served plugin
 *     {@link SERVED_PLUGIN_NAME}. {@link sessionSkillName} adds that
 *     prefix and {@link bareSkillName} removes it.
 *
 * Code that prints a name to the user, or compares a plan's name with
 * one a session reported, maps the name here so plans can keep bare
 * names under either delivery. The mapping applies to skills only.
 * Agents go through `--agents` under both deliveries and keep their
 * bare names (`serve.ts`, "The layout, by delivery").
 *
 * Both functions leave alone any name they did not produce. Under
 * `plugin-dir`, {@link bareSkillName} removes only the `rafa:` prefix,
 * so another plugin's `<plugin>:<name>` keeps its own prefix. It is
 * never matched as a served skill. {@link sessionSkillName} returns a
 * name that already has the prefix unchanged, so mapping a name twice
 * gives the same result as mapping it once.
 */
import type { SkillDelivery } from './delivery.js';

import { SKILL_DELIVERY } from './delivery.js';
import { SERVED_PLUGIN_NAME } from './serve.js';

/** The prefix a `plugin-dir` delivery puts on a served skill's name. */
export const SERVED_SKILL_PREFIX = `${SERVED_PLUGIN_NAME}:`;

/**
 * The name a session knows the served skill `bare` by under `delivery`,
 * which defaults to {@link SKILL_DELIVERY}. See the module note.
 */
export function sessionSkillName(bare: string, delivery: SkillDelivery = SKILL_DELIVERY): string {
  return delivery === 'plugin-dir' && !bare.startsWith(SERVED_SKILL_PREFIX)
    ? `${SERVED_SKILL_PREFIX}${bare}`
    : bare;
}

/**
 * The bare name for `name`, a name a session reported under `delivery`,
 * which defaults to {@link SKILL_DELIVERY}. See the module note.
 */
export function bareSkillName(name: string, delivery: SkillDelivery = SKILL_DELIVERY): string {
  return delivery === 'plugin-dir' && name.startsWith(SERVED_SKILL_PREFIX)
    ? name.slice(SERVED_SKILL_PREFIX.length)
    : name;
}
