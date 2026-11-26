CREATE TABLE "blockers" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"what" text NOT NULL,
	"artifact" text,
	"outcome" text NOT NULL,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "bug_routes" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"entry_index" bigint NOT NULL,
	"what" text NOT NULL,
	"said" text,
	"kind" text NOT NULL,
	"route" text NOT NULL,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"level" text NOT NULL,
	"area" text,
	"summary" text NOT NULL,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"sha" text NOT NULL,
	"row_json" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"declaration" text,
	"agent" text,
	"model" text,
	"effort" text,
	"budget_usd" double precision,
	"tools" text,
	"flags" text NOT NULL,
	"collected_at" text NOT NULL,
	"resolver" text,
	"skills_offered" text,
	"lessons_offered" text,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"kind" text,
	"trigger" text,
	"what" text,
	"cause" text,
	"resolution" text,
	"artifact" text,
	"signal" text,
	"outcome" text NOT NULL,
	"tracker_ref" text,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "hub_store_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"contract_version" integer NOT NULL,
	"created_at" text NOT NULL,
	"embedding_model" text,
	"embedding_hash" text,
	"embedding_dimension" integer,
	"embedding_precision" text,
	CONSTRAINT "hub_store_meta_one_row" CHECK ("hub_store_meta"."id" = 1),
	CONSTRAINT "hub_store_meta_project" CHECK ("hub_store_meta"."project_id" <> ''),
	CONSTRAINT "hub_store_meta_contract" CHECK ("hub_store_meta"."contract_version" > 0),
	CONSTRAINT "hub_store_meta_dimension" CHECK ("hub_store_meta"."embedding_dimension" > 0),
	CONSTRAINT "hub_store_meta_precision" CHECK ("hub_store_meta"."embedding_precision" IN ('half', 'full')),
	CONSTRAINT "hub_store_meta_embedding" CHECK ((
      "hub_store_meta"."embedding_model" IS NULL
      AND "hub_store_meta"."embedding_hash" IS NULL
      AND "hub_store_meta"."embedding_dimension" IS NULL
      AND "hub_store_meta"."embedding_precision" IS NULL
    ) OR (
      "hub_store_meta"."embedding_model" IS NOT NULL
      AND "hub_store_meta"."embedding_hash" IS NOT NULL
      AND "hub_store_meta"."embedding_dimension" IS NOT NULL
      AND "hub_store_meta"."embedding_precision" IS NOT NULL
    ))
);
--> statement-breakpoint
CREATE TABLE "out_of_scope_bugs" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"what" text NOT NULL,
	"artifact" text,
	"security" bigint,
	"outcome" text NOT NULL,
	"collected_at" text NOT NULL,
	"scope" text,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "plan_ci" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"plan_stub" text NOT NULL,
	"pr" bigint NOT NULL,
	"head_sha" text NOT NULL,
	"verdict" text NOT NULL,
	"failing" text NOT NULL,
	"read_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "preflight" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"position" bigint NOT NULL,
	"tier" text NOT NULL,
	"kind" text NOT NULL,
	"item" text NOT NULL,
	"probe" text,
	"outcome" text NOT NULL,
	"duration_ms" bigint NOT NULL,
	"failure" text,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "reading_supersedes" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"canonical_key" text NOT NULL,
	"superseded_key" text NOT NULL,
	"rule" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "report_absences" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text NOT NULL,
	"block_body" text,
	"outcome" text NOT NULL,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"row_json" text NOT NULL,
	"worktree" text,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "skill_invocations" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"name" text,
	"sidechain" bigint,
	"count" bigint,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "stale_docs" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"kind" text NOT NULL,
	"where_at" text,
	"what" text NOT NULL,
	"outcome" text NOT NULL,
	"collected_at" text NOT NULL,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "task_reports" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"plan_stub" text,
	"task_line" text NOT NULL,
	"status" text,
	"outcome" text NOT NULL,
	"collected_at" text NOT NULL,
	"skills_used" text,
	"origin_store" text,
	"origin_seq" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blockers_by_origin" ON "blockers" USING btree ("origin_store","origin_seq") WHERE "blockers"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bug_routes_by_origin" ON "bug_routes" USING btree ("origin_store","origin_seq") WHERE "bug_routes"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "changes_by_origin" ON "changes" USING btree ("origin_store","origin_seq") WHERE "changes"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commits_by_origin" ON "commits" USING btree ("origin_store","origin_seq") WHERE "commits"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_by_origin" ON "dispatches" USING btree ("origin_store","origin_seq") WHERE "dispatches"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_by_origin" ON "findings" USING btree ("origin_store","origin_seq") WHERE "findings"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "out_of_scope_bugs_by_origin" ON "out_of_scope_bugs" USING btree ("origin_store","origin_seq") WHERE "out_of_scope_bugs"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_ci_by_origin" ON "plan_ci" USING btree ("origin_store","origin_seq") WHERE "plan_ci"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "preflight_by_origin" ON "preflight" USING btree ("origin_store","origin_seq") WHERE "preflight"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_supersedes_by_origin" ON "reading_supersedes" USING btree ("origin_store","origin_seq") WHERE "reading_supersedes"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "report_absences_by_origin" ON "report_absences" USING btree ("origin_store","origin_seq") WHERE "report_absences"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_by_origin" ON "sessions" USING btree ("origin_store","origin_seq") WHERE "sessions"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_invocations_by_origin" ON "skill_invocations" USING btree ("origin_store","origin_seq") WHERE "skill_invocations"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stale_docs_by_origin" ON "stale_docs" USING btree ("origin_store","origin_seq") WHERE "stale_docs"."origin_store" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_reports_by_origin" ON "task_reports" USING btree ("origin_store","origin_seq") WHERE "task_reports"."origin_store" IS NOT NULL;