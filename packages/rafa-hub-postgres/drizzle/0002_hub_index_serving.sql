CREATE TABLE "hub_index_serving" (
	"id" integer PRIMARY KEY NOT NULL,
	"build_schema" text NOT NULL,
	"stamp" text NOT NULL,
	"built_at" text NOT NULL,
	CONSTRAINT "hub_index_serving_one_row" CHECK ("hub_index_serving"."id" = 1),
	CONSTRAINT "hub_index_serving_build" CHECK ("hub_index_serving"."build_schema" LIKE 'index\_%')
);
