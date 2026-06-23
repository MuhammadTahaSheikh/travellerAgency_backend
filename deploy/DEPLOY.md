# VPS Deployment (Travel Agency Backend)

Deployment files live in **`deploy/`** only. No changes to `src/` or other app code are required.

## Server requirements

- Ubuntu VPS with Node 20+, PM2, Nginx, MariaDB/MySQL
- Port **5011** free (does not conflict with existing apps on 5000/5002)

## DNS

Add an **A record**:

| Host | Value |
|------|--------|
| `travel-api` | `187.124.52.234` |

(Optional frontend later: `travel` → same IP or Vercel)

## One-command deploy on VPS

```bash
ssh root@187.124.52.234
git clone https://github.com/MuhammadTahaSheikh/travellerAgency_backend.git /var/www/travel-agency-backend
cd /var/www/travel-agency-backend
bash deploy/vps-setup.sh
```

## HTTPS

After DNS propagates:

```bash
certbot --nginx -d travel-api.bestechvision.com
```

## Update after code changes

```bash
cd /var/www/travel-agency-backend
git pull origin main
npm install && npx prisma generate && npx prisma db push && npm run build
pm2 restart travel-agency-api
```

## Use Hostinger MySQL (phpMyAdmin) instead of VPS local DB

### Step 1 — Allow VPS to connect (required)

In **hPanel**:

1. **Websites** → your site → **Databases** → **Remote MySQL**
2. Add this IP: **`187.124.52.234`**
3. Select database: **`u916710688_travel_agency`**
4. Click **Create**

Note the **MySQL hostname** on that page (usually `auth-db1535.hstgr.io`).

### Step 2 — Run switch on VPS

```bash
ssh root@187.124.52.234
bash /var/www/travel-agency-backend/deploy/switch-to-hostinger-db.sh
```

This creates all tables, seeds users, and restarts the API.

### Alternative — Import SQL via phpMyAdmin (if remote MySQL is slow)

1. Download `deploy/hostinger-import.sql` from the server or project
2. phpMyAdmin → `u916710688_travel_agency` → **Import** → choose file → **Go**
3. Still complete **Step 1** so the live API can connect to Hostinger

### Default logins after seed

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@travel.com | admin123 |
| Admin | admin@travel.com | admin123 |


```env
NEXT_PUBLIC_API_URL=https://travel-api.bestechvision.com/api
```

## Files in this folder

| File | Purpose |
|------|---------|
| `vps-setup.sh` | Full server setup script |
| `ecosystem.config.cjs` | PM2 process config |
| `nginx-travel-agency-api.conf` | Nginx reverse proxy |
| `env.production.example` | Environment template |
