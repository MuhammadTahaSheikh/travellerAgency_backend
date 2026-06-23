#!/usr/bin/env bash
# Point production API at Hostinger MySQL and create tables + seed data.
# Prerequisite: hPanel → Databases → Remote MySQL → add VPS IP 187.124.52.234 (or Any Host)
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/travel-agency-backend}"
DB_HOST="${DB_HOST:-auth-db1535.hstgr.io}"
DB_NAME="${DB_NAME:-u916710688_travel_agency}"
DB_USER="${DB_USER:-u916710688_travel_agency}"
DB_PASS="${DB_PASS:-Limton123@}"

cd "$APP_DIR"

ENC_PASS=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DB_PASS}', safe=''))")

echo "==> Testing Hostinger MySQL connection (${DB_HOST})..."
if ! mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SELECT 1 AS ok;" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Hostinger MySQL."
  echo "  1. hPanel → Websites → Databases → Remote MySQL"
  echo "  2. Add IP: 187.124.52.234  (or enable Any Host)"
  echo "  3. Use hostname from Remote MySQL page (default: auth-db1535.hstgr.io)"
  echo "  4. Confirm DB password matches DB_PASS in this script"
  exit 1
fi

echo "==> Updating .env to use Hostinger database"
# Preserve other env vars
if [ -f .env ]; then
  grep -v '^DATABASE_URL=' .env > .env.tmp || true
  mv .env.tmp .env
fi
echo "DATABASE_URL=\"mysql://${DB_USER}:${ENC_PASS}@${DB_HOST}:3306/${DB_NAME}\"" >> .env

echo "==> Push schema and seed"
npx prisma generate
npx prisma db push --accept-data-loss
npm run db:seed

echo "==> Restart API"
pm2 restart travel-agency-api

sleep 2
curl -sf http://127.0.0.1:5011/api/health
echo ""
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW TABLES;" | head -15
echo "==> Hostinger database ready"
