-- 搜尋：pg_trgm 擴充與 GIN trigram 索引（見 SPEC.md 第 8.1 節）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "files_title_trgm_idx" ON "files" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "files_search_text_trgm_idx" ON "files" USING GIN ("search_text" gin_trgm_ops);
