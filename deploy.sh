#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
npm install

echo "Building frontend..."
npm run build --workspace=frontend

echo "Building backend..."
npm run build --workspace=backend

echo "Restarting backend..."
if ! command -v pm2 &> /dev/null; then
  echo "PM2 not found, installing globally..."
  npm install -g pm2
fi

pm2 startOrRestart ecosystem.config.js --env production
pm2 save

echo "Deploy complete!"
