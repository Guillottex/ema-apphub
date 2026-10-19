#!/usr/bin/env bash
# Respaldo completo de la plataforma: base de datos de AppHub + DATA_DIR (código, versiones, backups de apps)
# Uso: ./scripts/backup-platform.sh [destino]     (programar con cron: 0 2 * * * /opt/ema-apphub/scripts/backup-platform.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DEST="${1:-/opt/ema-apphub/platform-backups}"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
echo "▶ pg_dump de la base de la plataforma"
docker compose exec -T platform-db pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "$DEST/apphub-db-$TS.dump"
echo "▶ Archivando ${DATA_DIR} (sin temporales)"
tar --exclude="${DATA_DIR}/tmp" -czf "$DEST/apphub-data-$TS.tar.gz" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")"
cp .env "$DEST/apphub-env-$TS.env" && chmod 600 "$DEST/apphub-env-$TS.env"
# Retención: 14 días
find "$DEST" -name 'apphub-*' -mtime +14 -delete
echo "✔ Respaldo en $DEST (incluye .env con MASTER_KEY: guárdelo en un lugar seguro)"
