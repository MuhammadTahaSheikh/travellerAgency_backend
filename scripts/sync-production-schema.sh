#!/usr/bin/env bash
# Apply Prisma schema to the production database (additive columns/tables only).
# Run on the server where DATABASE_URL points to production:
#   cd backend && bash scripts/sync-production-schema.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Syncing schema to database..."
npx prisma db push
echo "Done. Restart the API if it is running."
