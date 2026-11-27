/**
 * The postgres gate as `contract.test.ts` registers it, alone, for a
 * spawned `bun test` under an environment of the spawner's choosing.
 */
import { describePostgresGate, postgresGate } from './postgres-gate.js';

describePostgresGate(postgresGate(process.env));
