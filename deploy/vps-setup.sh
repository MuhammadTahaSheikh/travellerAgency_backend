#!/usr/bin/env bash
# Travel Agency API — VPS deployment (does not modify application source)
# Usage on server: bash deploy/vps-setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/travel-agency-backend}"
APP_PORT="${APP_PORT:-5011}"
DB_NAME="${DB_NAME:-travel_agency}"
DB_USER="${DB_USER:-travel_user}"
REPO_URL="${REPO_URL:-https://github.com/MuhammadTahaSheikh/travellerAgency_backend.git}"
DOMAIN="${DOMAIN:-travel-api.bestechvision.com}"
FRONTEND_URL="${FRONTEND_URL:-https://traveller-agency-frontend.vercel.app}"

echo "==> App directory: $APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

mkdir -p logs uploads

if [ ! -f "$APP_DIR/.env" ]; then
  DB_PASS=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 24)
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  echo "==> Creating MySQL database and user"
  mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
  mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
  mysql -e "FLUSH PRIVILEGES;"
  cat > "$APP_DIR/.env" << EOF
DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@localhost:3306/${DB_NAME}"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"
PORT=${APP_PORT}
NODE_ENV=production
UPLOAD_DIR=./uploads
FRONTEND_URL=${FRONTEND_URL}
EOF
  chmod 600 "$APP_DIR/.env"
  echo "==> Saved credentials in $APP_DIR/.env"
else
  echo "==> Using existing .env"
fi

echo "==> Install, database, build"
npm install --no-audit --no-fund
npx prisma generate
npx prisma db push --accept-data-loss
npm run db:seed
npm run build

echo "==> PM2"
cp "$APP_DIR/deploy/ecosystem.config.cjs" "$APP_DIR/ecosystem.config.cjs"
pm2 delete travel-agency-api 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save

echo "==> Nginx"
cp "$APP_DIR/deploy/nginx-travel-agency-api.conf" "/etc/nginx/sites-available/travel-agency-api.conf"
ln -sf /etc/nginx/sites-available/travel-agency-api.conf /etc/nginx/sites-enabled/travel-agency-api.conf
nginx -t
systemctl reload nginx

sleep 2
curl -sf "http://127.0.0.1:${APP_PORT}/api/health"
echo ""
echo "==> Deploy complete"
echo "    Local:  http://127.0.0.1:${APP_PORT}/api/health"
echo "    Public: http://${DOMAIN}/api/health (after DNS A record -> this server)"
echo "    SSL:    certbot --nginx -d ${DOMAIN}"
