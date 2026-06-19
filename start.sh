#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="pr-dashboard"

if ! command -v pm2 &>/dev/null; then
  echo "pm2 not found, installing..."
  npm install -g pm2
fi

if pm2 describe "$APP_NAME" &>/dev/null; then
  echo "Restarting $APP_NAME..."
  pm2 restart "$APP_NAME"
else
  echo "Starting $APP_NAME..."
  pm2 start "$DIR/server.js" --name "$APP_NAME" --interpreter node
fi

pm2 save
echo ""
echo "Status:"
pm2 status "$APP_NAME"
echo ""
echo "To enable auto-start on login, run:"
echo "  pm2 startup"
echo "  (then follow the printed instruction)"
