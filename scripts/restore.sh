#!/bin/sh
# 從 ./backups 還原指定日期的備份。
# 用法：docker compose stop api sync && scripts/restore.sh 2026-10-12 && docker compose start api sync
set -eu
DATE=${1:?用法：scripts/restore.sh <YYYY-MM-DD>}
cd "$(dirname "$0")/.."
DUMP="backups/db-$DATE.dump"
FILES="backups/files-$DATE.tar.gz"
[ -f "$DUMP" ] || { echo "找不到 $DUMP" >&2; exit 1; }
[ -f "$FILES" ] || { echo "找不到 $FILES" >&2; exit 1; }

docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U tinycanvas >/dev/null 2>&1; do sleep 1; done

echo "還原資料庫…"
docker compose exec -T postgres pg_restore -U tinycanvas -d tinycanvas --clean --if-exists --no-owner < "$DUMP"

echo "還原上傳的檔案…"
VOLUME=$(docker volume ls -q --filter name=tinycanvas_files_data | head -n1)
[ -n "$VOLUME" ] || VOLUME=tinycanvas_files_data
docker run --rm -i -v "$VOLUME":/data/files alpine:3 sh -c 'rm -rf /data/files/* && tar -xzf - -C /data/files' < "$FILES"

echo "完成。請執行：docker compose start api sync"
