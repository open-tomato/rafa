/**
 * `@open-tomato/rafa-d2c`: the public entry. The commands reach rafa
 * through the manifest's `commands` entry; these are the steps and
 * readings under them, for a caller that drives them itself.
 */
export type { LoadedConfig } from './src/config/load.js';
export { D2C_CONFIG_FILE, loadD2cConfig } from './src/config/load.js';
export type { D2cConfig, RunnerConfig, StoreConfig, SuiteConfig } from './src/config/read.js';
export { D2cConfigError, readD2cConfig } from './src/config/read.js';
export type { CheckReport } from './src/steps/check.js';
export { checkVisual } from './src/steps/check.js';
export type { MigratePlan, MigrateResult } from './src/steps/migrate.js';
export { applyMigration, planMigration } from './src/steps/migrate.js';
export { listOrphans } from './src/steps/orphans.js';
export type { PlaceResult } from './src/steps/place.js';
export { placeVisual } from './src/steps/place.js';
export type { PromoteResult } from './src/steps/promote.js';
export { promoteVisual } from './src/steps/promote.js';
export type { RunResult } from './src/steps/run.js';
export { runVisual } from './src/steps/run.js';
export type { SeedRecord, SeedResult } from './src/steps/seed.js';
export { seedVisual } from './src/steps/seed.js';
export type { SetPaths } from './src/store/key.js';
export { hostRunnerKey, setPaths, stagingDir } from './src/store/key.js';
export type { RunCounts, SetRecord } from './src/store/set-record.js';
