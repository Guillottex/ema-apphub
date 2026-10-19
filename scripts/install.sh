#!/usr/bin/env bash
# EMA AppHub — instalación en un servidor Linux nuevo
# Uso: sudo ./scripts/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Verificando requisitos…"
command -v docker >/dev/null || { echo "✖ Docker no está instalado: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✖ Falta el plugin Docker Compose v2"; exit 1; }
command -v openssl >/dev/null || { echo "✖ Falta openssl"; exit 1; }

if [ ! -f .env ]; then
  echo "▶ Creando .env con secretos aleatorios…"
  cp .env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^MASTER_KEY=.*|MASTER_KEY=$(openssl rand -hex 32)|" .env
  ADMIN_PW="Ema$(openssl rand -hex 6)"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PW}|" .env
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "${IP:-}" ] && sed -i "s|^PUBLIC_HOST=.*|PUBLIC_HOST=${IP}|" .env
  chmod 600 .env
  echo "  Usuario inicial: admin / ${ADMIN_PW}  (se pedirá cambiarla al ingresar)"
  echo "  ⚠ Edite .env para ajustar PLATFORM_DOMAIN, ACME_EMAIL y PUBLIC_HOST si corresponde."
fi

set -a; . ./.env; set +a
echo "▶ Preparando ${DATA_DIR}…"
mkdir -p "${DATA_DIR}"/{applications,backups,databases,logs,tmp}
chmod 750 "${DATA_DIR}"

./scripts/fetch-logo.sh || true

echo "▶ Construyendo e iniciando contenedores…"
docker compose up -d --build

echo "▶ Esperando a la API…"
for i in $(seq 1 60); do
  if docker compose exec -T backend wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "✔ EMA AppHub en línea:"
    echo "   http://${PUBLIC_HOST:-localhost}:${PLATFORM_HTTP_PORT:-8080}"
    [ -n "${PLATFORM_DOMAIN:-}" ] && echo "   https://${PLATFORM_DOMAIN}"
    exit 0
  fi
  sleep 3
done
echo "✖ La API no respondió. Revise: docker compose logs backend"; exit 1
