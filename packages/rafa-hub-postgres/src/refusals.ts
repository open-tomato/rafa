/**
 * What the connector's store refuses a request with, worded as the
 * SQLite hub store words the same refusals, so a device reads one line
 * whichever engine its hub keeps rows in. The classes are the
 * connector's own: this package cannot import the hub's, since the hub
 * imports this package to register the connector.
 */

/** The package a hub refused as too old is upgraded to. */
export const HUB_PACKAGE = '@open-tomato/rafa-hub';

/** What a refused push is told to do next. */
export const HUB_UPGRADE: string = `upgrade the hub to a ${HUB_PACKAGE} release whose rafa knows these migrations, then push again`;

/** A push, pull or status naming a project the hub does not list. */
export class PostgresProjectNotServed extends Error {
  override readonly name = 'HubProjectNotServed';
  /** The project the request named. */
  readonly project: string;

  constructor(project: string) {
    super(`rafa-hub: project ${project} is not served here; add it under hub.projects`);
    this.project = project;
  }
}

/** A push whose store has applied migrations the project's schema does not mirror. */
export class PostgresUpgradeRequired extends Error {
  override readonly name = 'HubUpgradeRequired';
  /** The ids the payload named that the schema lacks, in the payload's order. */
  readonly missing: readonly string[];
  /** The one thing to do next: {@link HUB_UPGRADE}. */
  readonly nextStep: string = HUB_UPGRADE;

  constructor(missing: readonly string[]) {
    super(`rafa-hub: the pushing store has applied migration ${missing.join(', ')}, which this hub does not know. Nothing was merged. Next step: ${HUB_UPGRADE}.`);
    this.missing = Object.freeze([...missing]);
  }
}
