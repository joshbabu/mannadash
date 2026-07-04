#!/bin/bash
# Runs on the server, triggered remotely by the GitHub Actions workflow.
# Exits non-zero on failure so the Action reports the deploy as failed.
set -e

cd /root/mannadash-app

echo "Pulling latest code..."
git pull origin main

echo "Rebuilding and restarting containers..."
docker compose -f docker-compose.prod.yml up -d --build

echo "Waiting for backend to come up..."
sleep 8

echo "Health check..."
if curl -sf http://localhost:3000/restaurants > /dev/null; then
  echo "Deploy succeeded — backend is responding."
else
  echo "Deploy FAILED health check — backend is not responding correctly."
  echo "Recent backend logs:"
  docker compose -f docker-compose.prod.yml logs backend --tail 30
  exit 1
fi
