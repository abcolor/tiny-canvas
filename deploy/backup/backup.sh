#!/bin/sh
# 備份資料庫（pg_dump -Fc）與上傳的檔案，並刪除超過保留天數的備份
set -eu
DATE=$(date +%Y-%m-%d)
DIR=/backups
RETENTION=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$DIR"

pg_dump -Fc "$DATABASE_URL" -f "$DIR/db-$DATE.dump.tmp"
mv "$DIR/db-$DATE.dump.tmp" "$DIR/db-$DATE.dump"

tar -czf "$DIR/files-$DATE.tar.gz.tmp" -C /data/files .
mv "$DIR/files-$DATE.tar.gz.tmp" "$DIR/files-$DATE.tar.gz"

find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$RETENTION" -delete
echo "{\"level\":\"info\",\"msg\":\"backup done\",\"date\":\"$DATE\"}"
