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

## Frontend `.env` (production)

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
