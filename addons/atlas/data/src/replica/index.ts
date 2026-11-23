/**
 * The Atlas replica: the bucket tables and their whitelist (`ddl.ts`), the
 * writer that builds a replica beside the live one and renames it in
 * (`writer.ts`), and the reader that follows those renames (`reader.ts`).
 * Runs under bun: it imports `bun:sqlite` and `node:fs`, so a browser
 * bundle imports `@open-tomato/atlas-data/contract` instead.
 */
export type { ReplicaTable } from './ddl.js';
export type { OpenReplica, ReplicaMeta, ReplicaReader } from './reader.js';
export type { ReplicaBuild, SourceStamp, WriteReplicaOptions, WriteReplicaResult } from './writer.js';
export { isReplicaTable, META_KEYS, META_TABLES, REPLICA_TABLES, REPLICA_VERSION, replicaDdl } from './ddl.js';
export { openReplica } from './reader.js';
export { buildPathOf, writeReplica } from './writer.js';
