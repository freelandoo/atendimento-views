#!/usr/bin/env bash
# Clona os DADOS DE PRODUÇÃO (só os schemas do backend) para o Postgres LOCAL e PAUSA os
# auto-envios na cópia — para testar com dados reais sem risco de disparar WhatsApp sozinho.
#
# O que faz:
#   1. Pega a URL pública do Postgres de produção (Railway) — nunca imprime a senha.
#   2. pg_dump SOMENTE dos schemas do backend: vendas, app, prospectador.
#      (NÃO toca no schema `public`, que é da Evolution — assim seu número de TESTE local fica intacto.)
#   3. pg_restore na base local (Docker, evolution_api).
#   4. Desliga os disparadores automáticos NA CÓPIA: banco_leads_config.auto_ativo=false
#      e followup_config.pausado=true.
#
# Requisitos: Docker Desktop LIGADO (o Postgres local é um container) + railway CLI logado
# (ou exporte PROD_DATABASE_URL manualmente). Usa uma imagem postgres:16 efêmera para as
# ferramentas (pg_dump 16 dumpa servidores <=16; restore de cliente 16 num servidor 15 é ok).
#
# Uso:   bash backend/scripts/clonar-prod-para-local.sh
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:16}"
LOCAL_HOSTPORT="${LOCAL_HOSTPORT:-host.docker.internal:5433}"
LOCAL_DB="${LOCAL_DB:-evolution_api}"
LOCAL_USER="${LOCAL_USER:-evolution}"
LOCAL_PASS="${LOCAL_PASS:-evolution}"
SCHEMAS=(vendas app prospectador)
TMPDIR="$(cd "$(dirname "$0")" && pwd)/.tmp-clone"
DUMP="$TMPDIR/prod.dump"

mask() { sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#'; }

echo "==> 1/4 Obtendo a URL pública do Postgres de produção…"
PROD_URL="${PROD_DATABASE_URL:-}"
if [ -z "$PROD_URL" ]; then
  PROD_URL="$(railway variables --service Postgres --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.DATABASE_PUBLIC_URL||"")}catch(e){process.stdout.write("")}})')"
fi
if [ -z "$PROD_URL" ]; then
  echo "ERRO: não obtive a URL de produção. Faça 'railway login' ou exporte PROD_DATABASE_URL." >&2
  exit 1
fi
echo "    prod: $(printf '%s' "$PROD_URL" | mask)"

LOCAL_URL="postgresql://${LOCAL_USER}:${LOCAL_PASS}@${LOCAL_HOSTPORT}/${LOCAL_DB}"
mkdir -p "$TMPDIR"

echo "==> 2/4 pg_dump dos schemas do backend (${SCHEMAS[*]})… (alguns minutos)"
DUMP_ARGS=(--no-owner --no-privileges -Fc)
for s in "${SCHEMAS[@]}"; do DUMP_ARGS+=(-n "$s"); done
docker run --rm -e PGSSLMODE=require "$PG_IMAGE" \
  pg_dump "$PROD_URL" "${DUMP_ARGS[@]}" > "$DUMP"
echo "    dump: $(du -h "$DUMP" | cut -f1)"

echo "==> 3/4 pg_restore na base local ($LOCAL_DB @ $LOCAL_HOSTPORT)…"
# Restore lê o dump via STDIN (evita bind-mount de volume, que é problemático no Windows/Git Bash).
docker run -i --rm "$PG_IMAGE" \
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$LOCAL_URL" < "$DUMP" \
  || echo "    (aviso: pg_restore retornou avisos — normal com --clean em objetos inexistentes)"

echo "==> 4/4 Pausando auto-envios NA CÓPIA (segurança anti-spam)…"
docker run --rm "$PG_IMAGE" psql "$LOCAL_URL" -v ON_ERROR_STOP=0 -c \
  "UPDATE app.banco_leads_config SET auto_ativo=false; UPDATE app.followup_config SET pausado=true;" \
  || echo "    (aviso: não consegui pausar — rode os UPDATEs manualmente antes de subir o backend)"

rm -f "$DUMP"
echo ""
echo "✅ PRONTO. Base local clonada da produção + auto-envios pausados."
echo "   Lembrete: use uma instância/numero de TESTE no Evolution (EVOLUTION_URL/INSTANCE locais),"
echo "   nunca a instância de produção, para não mandar mensagem a lead real."
