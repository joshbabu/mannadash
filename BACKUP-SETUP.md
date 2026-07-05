# Database Backups — Setup Guide

## What this does

Every day, a script dumps the entire MannaDash database, compresses it, and uploads it to
Cloudflare R2 — storage completely separate from your Hetzner server. If the server were ever
lost entirely, your data survives in R2.

## One-time setup

### 1. Create an R2 bucket

In the Cloudflare dashboard: **R2** (left sidebar) → **Create bucket** → name it `mannadash-backups`.

### 2. Create an R2 API token

**R2** → **Manage R2 API Tokens** → **Create API Token**. Give it a name, set permissions to
"Object Read & Write", and scope it to just the `mannadash-backups` bucket if the option is
available. Copy the **Access Key ID** and **Secret Access Key** — the secret is shown once.

Also note your **Account ID** (shown on the R2 overview page) — you'll need it for the endpoint URL.

### 3. Install the AWS CLI on the server

R2 is S3-compatible, so the standard AWS CLI works against it:

```bash
apt install -y awscli
```

### 4. Configure the AWS CLI with your R2 credentials

```bash
aws configure
```

- **Access Key ID**: from step 2
- **Secret Access Key**: from step 2
- **Region**: `auto`
- **Output format**: `json`

### 5. Set up the backup config

```bash
cp backup-config.env.example /root/backup-config.env
nano /root/backup-config.env
```

Fill in your real bucket name and endpoint (`https://<your-account-id>.r2.cloudflarestorage.com`).

### 6. Make the scripts executable

```bash
chmod +x backup-db.sh restore-db.sh
```

### 7. Test the backup manually

```bash
./backup-db.sh
```

Check the R2 bucket in the Cloudflare dashboard — you should see a new file appear.

### 8. Schedule it daily via cron

```bash
crontab -e
```

Add this line (runs daily at 2am):
```
0 2 * * * /root/mannadash-app/backup-db.sh >> /root/backup.log 2>&1
```

### 9. Set an auto-expiry rule in R2 (optional but recommended)

In the R2 bucket settings, add a lifecycle rule to delete objects older than 30 days — keeps
storage tidy without any scripting.

## Testing a restore (do this at least once!)

A backup that's never been restored is not a proven safety net. On a quiet moment:

```bash
aws s3 ls s3://mannadash-backups/ --endpoint-url $R2_ENDPOINT
./restore-db.sh <pick-a-recent-filename>.sql.gz
```

Confirm your data is intact afterward with `curl http://localhost:3000/restaurants`.
