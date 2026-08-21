#!/usr/bin/env bash
# 一键备份：MySQL 全量 + 上传目录
# 运行: npm run db:backup            (备份到 ./backups, 与代码目录隔离)
#       BACKUP_ROOT=/data/zongce/backups npm run db:backup
# 建议 crontab: 0 2 * * * cd /www/wwwroot/zongce && BACKUP_ROOT=/data/zongce/backups npm run db:backup >> /var/log/zongce-backup.log 2>&1
set -euo pipefail

# 从 .env 读取备份所需变量（逐行解析，避免 source 整个文件时
# 因 SMTP_FROM 等含空格/尖括号的值未加引号导致语法错误）
load_env_if_exists() {
  local env_file="$1"
  local key val
  while IFS='=' read -r key val; do
    key="${key//[[:space:]]/}"
    case "$key" in
      DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|UPLOAD_ROOT)
        val="${val%%[[:space:]]#*}"   # 去掉行内注释
        val="${val%\"*}"; val="${val#\"}"
        export "$key=$val"
        ;;
    esac
  done < "$env_file"
}

if [ -f "$(dirname "$0")/../.env" ]; then
  load_env_if_exists "$(dirname "$0")/../.env"
fi

BACKUP_ROOT="${BACKUP_ROOT:-$(dirname "$0")/../backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_ROOT"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-zongce}"
DB_USER="${DB_USER:-root}"

echo "[$STAMP] 开始备份数据库 $DB_NAME ..."

# mysqldump 加 --single-transaction 避免锁表; 用 crontab 时注意 mysqldump 与 mysql 同源版本
mysqldump -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"${DB_PASSWORD}" \
  --single-transaction --routines --triggers --default-character-set=utf8mb4 \
  "$DB_NAME" > "$BACKUP_ROOT/db_$STAMP.sql"

echo "[$STAMP] 数据库备份完成: $BACKUP_ROOT/db_$STAMP.sql"

# 上传目录(材料图片)备份; 未配置 UPLOAD_ROOT 时使用默认目录
UPLOAD_DIR="${UPLOAD_ROOT:-$(dirname "$0")/../public/uploads}"
if [ -d "$UPLOAD_DIR" ]; then
  echo "[$STAMP] 开始备份上传目录 $UPLOAD_DIR ..."
  tar -czf "$BACKUP_ROOT/uploads_$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "[$STAMP] 上传目录备份完成"
else
  echo "[$STAMP] 警告: 上传目录 $UPLOAD_DIR 不存在, 已跳过"
fi

# 保留最近 14 天备份, 自动清理更早的
find "$BACKUP_ROOT" -name 'db_*.sql' -mtime +14 -delete 2>/dev/null || true
find "$BACKUP_ROOT" -name 'uploads_*.tar.gz' -mtime +14 -delete 2>/dev/null || true

echo "[$STAMP] 全部备份完成 ✓  目录: $BACKUP_ROOT"