/** The config registry: a snapshot's `dataset` picks its config here. */
import type { DiceTemplate, GraphNode, SoretesConfig } from '../contract/types.ts';
import { RAFA_CONFIG } from './rafa.ts';
import { SERVICES_CONFIG } from './services.ts';

export const CONFIGS: Readonly<Record<string, SoretesConfig>> = {
  rafa: RAFA_CONFIG,
  services: SERVICES_CONFIG,
};

export const DATASETS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'rafa', label: 'this repo' },
  { id: 'services', label: 'services demo' },
];

export const configFor = (dataset: string): SoretesConfig => CONFIGS[dataset] ?? RAFA_CONFIG;

/** The widget id on a slot: the user's drop, else the template's, else the template's widget at the slot's position. */
export function widgetOnSlot(template: DiceTemplate, overrides: Readonly<Record<string, string>> | undefined, slots: readonly string[], slot: string): string | undefined {
  return overrides?.[slot] ?? template.faces[slot] ?? Object.values(template.faces)[slots.indexOf(slot)];
}

/** The template whose `appliesTo` names the node's id, else its type, else the first `*` one. */
export function templateFor(config: SoretesConfig, node: GraphNode): DiceTemplate {
  const names = (key: string) => (t: DiceTemplate): boolean => t.appliesTo !== '*' && t.appliesTo.includes(key);
  const exact = config.templates.find(names(node.id)) ?? config.templates.find(names(node.type));
  const any = config.templates.find((t) => t.appliesTo === '*');
  const first = config.templates[0];
  if (!first) throw new Error(`config ${config.id} has no templates`);
  return exact ?? any ?? first;
}
