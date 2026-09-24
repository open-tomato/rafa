/**
 * Tests for the mapping between a served skill's bare name and its
 * session name.
 *
 * There is one case per delivery path, and each holds both directions.
 * Each also has a control: a name the mapping must leave alone, so a
 * case cannot pass because the function returned its input every time.
 * The last case holds the default to the delivery `delivery.ts`
 * recorded, so changing that pin changes what these functions do.
 */
import { describe, expect, it } from 'bun:test';

import { SKILL_DELIVERY } from './delivery.js';
import { SERVED_PLUGIN_NAME } from './serve.js';
import { bareSkillName, SERVED_SKILL_PREFIX, sessionSkillName } from './skill-names.js';

describe('the served skill name mapping', () => {
  it('keeps bare names both ways under add-dir', () => {
    expect(sessionSkillName('documentation', 'add-dir')).toBe('documentation');
    expect(bareSkillName('documentation', 'add-dir')).toBe('documentation');
    // Control: under add-dir rafa adds no namespace, so a rafa: name is some plugin's and stays whole.
    expect(bareSkillName('rafa:documentation', 'add-dir')).toBe('rafa:documentation');
  });

  it('maps bare names to and from rafa:<name> under plugin-dir', () => {
    expect(SERVED_SKILL_PREFIX).toBe(`${SERVED_PLUGIN_NAME}:`);
    expect(sessionSkillName('documentation', 'plugin-dir')).toBe('rafa:documentation');
    expect(bareSkillName('rafa:documentation', 'plugin-dir')).toBe('documentation');
    expect(bareSkillName(sessionSkillName('ts-symbols-for-agents', 'plugin-dir'), 'plugin-dir')).toBe('ts-symbols-for-agents');
    // Mapping twice gives the result of mapping once.
    expect(sessionSkillName('rafa:documentation', 'plugin-dir')).toBe('rafa:documentation');
    // Control: another plugin's name is not a served skill and keeps its prefix.
    expect(bareSkillName('other:documentation', 'plugin-dir')).toBe('other:documentation');
    expect(bareSkillName('documentation', 'plugin-dir')).toBe('documentation');
  });

  it('follows the recorded SKILL_DELIVERY when no delivery is given', () => {
    expect(sessionSkillName('documentation')).toBe(sessionSkillName('documentation', SKILL_DELIVERY));
    expect(bareSkillName('rafa:documentation')).toBe(bareSkillName('rafa:documentation', SKILL_DELIVERY));
    expect(SKILL_DELIVERY).toBe('add-dir');
    expect(sessionSkillName('documentation')).toBe('documentation');
  });
});
