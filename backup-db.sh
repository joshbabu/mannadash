#!/bin/bash
# Daily backup of the MannaDash Postgres database, uploaded to Cloudflare R2.
# Runs via cron — see backup-setup-instructions.md for the one-time setup.
set -e
source /root/backup-config.env

BACKUP_DIR="/root/backups"
DATE=$(date +%F_%H-%M)
FILENAME="mannadash-$DATE.sql.gz"
LOCAL_PATH="$BACKUP_DIR/$FILENAME"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# Dump the database from inside the running Postgres container, compress it
docker exec mannadash-db pg_dump -U app mannadash | gzip > "$LOCAL_PATH"

echo "[$(date)] Dump created: $LOCAL_PATH ($(du -h "$LOCAL_PATH" | cut -f1))"

# Upload to R2 (S3-compatible) — credentials come from the AWS CLI config set up during initial setup
aws s3 cp "$LOCAL_PATH" "s3://$R2_BUCKET_NAME/$FILENAME" --endpoint-url "$R2_ENDPOINT"

echo "[$(date)] Uploaded to R2: $FILENAME"

# Keep only the last 3 days of backups on the server itself — R2 is the durable copy,
# local copies are just for quick access without needing to download from R2
find "$BACKUP_DIR" -name "mannadash-*.sql.gz" -mtime +3 -delete

echo "[$(date)] Backup complete."
