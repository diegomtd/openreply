#!/bin/sh
set -e
cat > /etc/crontabs/root <<EOF
0 5 * * * curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://automacao.conteudos.tech/api/cron/refresh-tokens
0 6 * * * curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://automacao.conteudos.tech/api/cron/attach-next-reel
0 7 * * * curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" https://automacao.conteudos.tech/api/cron/snapshot-followers
EOF
exec crond -f -l 8
