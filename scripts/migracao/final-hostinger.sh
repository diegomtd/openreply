#!/usr/bin/env bash
# Virada: roda como root na HOSTINGER. Desliga só o worker e o cron do OpenReply (o web segue
# no ar até o DNS mudar), tira o dump final do banco e da fila e manda direto para a Contabo.
# Para desfazer: docker service scale openreply_worker=1 openreply_cron=1
set -eu
umask 077
D=/root/migracao-final
rm -rf "$D"; mkdir -p "$D"; cd "$D"
docker service scale -d openreply_worker=0 openreply_cron=0 >/dev/null
echo "  ok  worker e cron desligados na Hostinger"
sleep 20
pg=$(docker ps -qf name=openreply_postgres | head -1)
docker exec "$pg" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip > final.sql.gz
echo "  ok  dump final do banco $(du -h final.sql.gz | cut -f1)"
rd=$(docker ps -qf name=openreply_redis | head -1)
pass=$(docker inspect -f '{{json .Config.Cmd}} {{json .Args}}' "$rd" | grep -oE 'requirepass[", ]+[^", ]+' | head -1 | sed -E 's/requirepass[", ]+//')
docker exec -e REDISCLI_AUTH="$pass" "$rd" redis-cli SAVE >/dev/null 2>&1 || true
docker cp "$rd:/data/dump.rdb" final.rdb && echo "  ok  fila (redis) salva"
echo "Agora a senha root da Contabo:"
scp -o StrictHostKeyChecking=accept-new final.sql.gz final.rdb root@169.58.190.45:/root/
echo "  ok  enviado para a Contabo"
