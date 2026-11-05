#!/usr/bin/env bash
# Backup completo da Hostinger para levar à Contabo. Roda como root na Hostinger.
# Não para, não reinicia e não apaga nada em produção. Pula tudo com "n8n" no nome.
# Segredos (variáveis de ambiente) vão só para arquivos com permissão 600; nada aparece na tela.
set -u
umask 077
D=/root/migracao
rm -rf "$D"; mkdir -p "$D/bancos" "$D/env" "$D/inspect"
cd "$D" || exit 1
ok() { printf '  ok  %s\n' "$1"; }
falha() { printf '  FALHOU  %s\n' "$1"; }

echo "== 1/5 Inventário"
docker service ls --format '{{.Name}} | {{.Image}} | {{.Replicas}}' 2>/dev/null | grep -vi n8n > servicos.txt
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' | grep -vi n8n > conteineres.txt
docker volume ls -q | grep -vi n8n > volumes.txt
cat servicos.txt

echo "== 2/5 Variáveis de ambiente e configuração (só em arquivo)"
for s in $(docker service ls -q 2>/dev/null); do
  n=$(docker service inspect -f '{{.Spec.Name}}' "$s")
  case "$n" in *n8n*) continue;; esac
  docker service inspect "$s" > "inspect/servico_$n.json"
  docker service inspect -f '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "$s" | sed '/^$/d' > "env/$n.env"
  ok "$n ($(wc -l < "env/$n.env") variáveis)"
done
for c in $(docker ps -aq); do
  n=$(docker inspect -f '{{.Name}}' "$c" | tr -d /)
  case "$n" in *n8n*) continue;; esac
  docker inspect "$c" > "inspect/conteiner_$n.json"
done

echo "== 3/5 Bancos (dump lógico, com tudo rodando)"
docker ps --format '{{.Names}} {{.Image}}' | grep -vi n8n | while read -r n i; do
  base=$(echo "$n" | cut -d. -f1)
  case "$i" in
    *postgres*|*postgis*|*pgvector*|*timescale*)
      if docker exec "$n" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' 2>/dev/null | gzip > "bancos/$base.sql.gz" && [ "$(gzip -dc "bancos/$base.sql.gz" | head -c 100 | wc -c)" -gt 0 ]; then ok "$base postgres $(du -h "bancos/$base.sql.gz" | cut -f1)"; else falha "$base postgres"; fi;;
    *mysql*|*mariadb*)
      if docker exec "$n" sh -c 'D=$(command -v mariadb-dump || command -v mysqldump); $D -uroot -p"${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}" --all-databases --single-transaction --routines' 2>/dev/null | gzip > "bancos/$base.mysql.sql.gz"; then ok "$base mysql $(du -h "bancos/$base.mysql.sql.gz" | cut -f1)"; else falha "$base mysql"; fi;;
    *mongo*)
      if docker exec "$n" sh -c 'mongodump --archive --gzip ${MONGO_INITDB_ROOT_USERNAME:+-u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin}' > "bancos/$base.mongo.gz" 2>/dev/null; then ok "$base mongo"; else falha "$base mongo"; fi;;
    *redis*|*valkey*|*keydb*)
      docker exec "$n" sh -c 'redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} SAVE' >/dev/null 2>&1
      if docker cp "$n:/data/dump.rdb" "bancos/$base.rdb" 2>/dev/null; then ok "$base redis"; else falha "$base redis (sem dump.rdb, segue pelo volume)"; fi;;
  esac
done

echo "== 4/5 Pacote essencial (bancos + env + config do EasyPanel e código dos apps)"
tar czf essencial.tgz --exclude=node_modules --exclude=.next --exclude='*n8n*' \
  servicos.txt conteineres.txt volumes.txt bancos env inspect /etc/easypanel 2>/dev/null
ok "essencial.tgz $(du -h essencial.tgz | cut -f1)"

echo "== 5/5 Volumes do Docker (arquivos, uploads, Darkflow)"
echo "  espaço: volumes $(du -sh /var/lib/docker/volumes 2>/dev/null | cut -f1), livre no disco $(df -h / | awk 'NR==2{print $4}')"
tar czf volumes.tgz --exclude='*n8n*' -C /var/lib/docker volumes 2>/dev/null
ok "volumes.tgz $(du -h volumes.tgz | cut -f1)"

chmod 600 essencial.tgz volumes.tgz
sha256sum essencial.tgz volumes.tgz > conferencia.sha256
echo
echo "== PRONTO em $D"
ls -lh "$D"
echo "Copie e me mande tudo acima (não tem segredo na tela)."
