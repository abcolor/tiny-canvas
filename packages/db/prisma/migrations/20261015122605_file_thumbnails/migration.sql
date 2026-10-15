-- 首頁卡片縮圖（見 docs/DECISIONS.md 2026-10-15）
-- AlterTable
ALTER TABLE "files" ADD COLUMN     "thumbnail_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "file_thumbnails" (
    "file_id" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "file_thumbnails_pkey" PRIMARY KEY ("file_id")
);

-- AddForeignKey
ALTER TABLE "file_thumbnails" ADD CONSTRAINT "file_thumbnails_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
