CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_embedding_hnsw_idx" ON "organizations" USING hnsw ("embedding" vector_cosine_ops);