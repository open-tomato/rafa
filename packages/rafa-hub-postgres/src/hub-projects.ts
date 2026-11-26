/**
 * Where the connector keeps each served project's rows: one Postgres
 * schema per project, named from a prefix and the project's id, so two
 * projects' rows, devices and cursors are never one table's.
 *
 * A context listing no projects, or only the one `default` project a
 * hub with `hub.projects` left out serves, is the single-project hub:
 * one schema, `<prefix>_default`, and every request served there
 * whatever project it names. With projects listed, each one's schema is
 * `<prefix>_<id>`, the id lower-cased; a request naming no project is
 * served in the first listed one, and one naming a project not listed
 * is refused with {@link PostgresProjectNotServed}. An id that makes no
 * schema name the migrator takes, and two projects making one schema,
 * are refused when the layout is read, before anything connects.
 */
import type { HubServedProject } from '@open-tomato/rafa-hub-port';

import { SCHEMA_NAME } from './migrator.js';
import { PostgresProjectNotServed } from './refusals.js';

/** The prefix every project's schema name opens with when the store is given none. */
export const DEFAULT_SCHEMA_PREFIX = 'rafa_hub';

/** The one project of a hub with `hub.projects` left out, as the hub's config names it. */
export const DEFAULT_PROJECT_ID = 'default';

/** One served project and the schema its rows are kept in. */
export interface ProjectSchema {
  /** The project's id, {@link DEFAULT_PROJECT_ID} for the one project of a single-project hub. */
  readonly id: string;
  /** The Postgres schema holding its tables. */
  readonly schema: string;
}

/** Every served project's schema, and the one a request is served in. */
export interface SchemaLayout {
  /** The first listed project's, where a request naming none is served. */
  readonly first: ProjectSchema;
  /** Every served project's, in listed order. */
  readonly all: readonly ProjectSchema[];
  /** The one a request naming `project` is served in; throws {@link PostgresProjectNotServed} for one not listed. */
  readonly schemaOf: (project: string | undefined) => ProjectSchema;
}

/** Whether `projects` is the single-project hub: none listed, or the one default project alone. */
export function servesOneProject(projects: readonly HubServedProject[]): boolean {
  return projects.length === 0 || (projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT_ID);
}

/** The schema of project `id` under `prefix`, refused when it is no name the migrator takes. */
export function projectSchemaName(prefix: string, id: string): string {
  const name = `${prefix}_${id.toLowerCase()}`;
  if (!SCHEMA_NAME.test(name)) {
    throw new TypeError(`hub postgres: project ${id} under the schema prefix ${prefix} makes "${name}", which is no schema name (lower case letters, digits and _, at most 63)`);
  }
  return name;
}

/** Reads the layout of `projects` under `prefix`; see the module note. */
export function schemaLayout(projects: readonly HubServedProject[], prefix: string = DEFAULT_SCHEMA_PREFIX): SchemaLayout {
  if (servesOneProject(projects)) {
    const one: ProjectSchema = Object.freeze({
      id: projects[0]?.id ?? DEFAULT_PROJECT_ID,
      schema: projectSchemaName(prefix, DEFAULT_PROJECT_ID),
    });
    return Object.freeze({ first: one, all: Object.freeze([one]), schemaOf: () => one });
  }
  const all: readonly ProjectSchema[] = Object.freeze(projects.map(({ id }) => Object.freeze({ id, schema: projectSchemaName(prefix, id) })));
  all.forEach((place, position) => {
    const earlier = all.findIndex((other) => other.schema === place.schema);
    if (earlier !== position) {
      throw new TypeError(`hub postgres: projects ${all[earlier]?.id ?? ''} and ${place.id} share the schema ${place.schema}; expected one schema per project`);
    }
  });
  const [first] = all as [ProjectSchema, ...ProjectSchema[]];
  return Object.freeze({
    first,
    all,
    schemaOf: (project: string | undefined) => {
      const id = project ?? first.id;
      const found = all.find((place) => place.id === id);
      if (found === undefined) throw new PostgresProjectNotServed(id);
      return found;
    },
  });
}
