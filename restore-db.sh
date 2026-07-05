#!/bin/bash
# Restores the MannaDash database from a backup file in R2.
#
# Usage: ./restore-db.sh mannadash-2026-07-05_02-00.sql.gz
#
# WARNING: this REPLACES the current database contents. Only run this if you
# genuinely need to recover from data loss — it is not reversible.
set -e
source /root/backup-config.env

if [ -z "$1" ]; then
  echo "Usage: $0 <backup-filename>"
  echo "List available backups first with: aws s3 ls s3://\$R2_BUCKET_NAME/ --endpoint-url \$R2_ENDPOINT"
  exit 1
fi

FILENAME="$1"
LOCAL_PATH="/root/backups/$FILENAME"

echo "This will REPLACE the current database with the contents of $FILENAME."
read -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo "[$(date)] Downloading $FILENAME from R2..."
aws s3 cp "s3://$R2_BUCKET_NAME/$FILENAME" "$LOCAL_PATH" --endpoint-url "$R2_ENDPOINT"

echo "[$(date)] Restoring into the running database..."
gunzip -c "$LOCAL_PATH" | docker exec -i mannadash-db psql -U app -d mannadash

echo "[$(date)] Restore complete. Verify with:"
echo "  curl http://localhost:3000/restaurants"
