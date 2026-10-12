# 用與資料庫相同主版本的 pg_dump
FROM postgres:16-alpine
RUN apk add --no-cache tzdata
COPY deploy/backup/backup.sh /usr/local/bin/backup.sh
COPY deploy/backup/crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/backup.sh
CMD ["crond", "-f", "-l", "8"]
