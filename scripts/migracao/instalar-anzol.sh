#!/usr/bin/env bash
# Instala o Anzol (OpenReply) do zero na Contabo, sem mexer na Firma (porta 4242).
# Uso, como root na Contabo:
#   bash instalar-anzol.sh        -> instala/atualiza e sobe banco, redis, web, worker e cron
#   bash instalar-anzol.sh rota   -> depois que o DNS apontar para cá: cria a rota HTTPS no Traefik
# As chaves são digitadas escondidas e ficam só em /opt/anzol/anzol.env (permissão 600).
set -eu
umask 077
O=/opt/anzol
ENV=$O/anzol.env
DOMINIO=automacao.conteudos.tech
PORTA=4300
NET=anzol-net
TRAEFIK=/etc/easypanel/traefik/config
ok() { printf '  ok  %s\n' "$1"; }

rota() {
  modelo=$TRAEFIK/firma.yaml
  [ -f "$modelo" ] || { echo "Não achei $modelo para usar de modelo."; exit 1; }
  if docker inspect -f '{{json .NetworkSettings.Networks}}' anzol-web | grep -q '"easypanel"'; then
    url="http://anzol-web:3000"
  else
    url="http://$(ip -4 -o addr show docker0 | grep -oE 'inet [0-9.]+' | cut -d' ' -f2):$PORTA"
  fi
  sed -E -e "s/firma\.oceanoazul\.tech/$DOMINIO/g" \
         -e "s#(url:[[:space:]]*)[\"']?[^\"'[:space:]]+[\"']?#\1\"$url\"#" \
         -e "s/firma/anzol/g" "$modelo" > "$TRAEFIK/anzol.yaml"
  chmod 644 "$TRAEFIK/anzol.yaml"
  ok "rota criada ($DOMINIO -> $url). Conteúdo:"
  cat "$TRAEFIK/anzol.yaml"
  exit 0
}
chaves() {
  [ -f "$ENV" ] || { echo "Rode primeiro: bash instalar-anzol.sh"; exit 1; }
  read -rp  "Instagram App ID (Meta > ConteudOS > Instagram > Configuração da API): " igid
  read -rsp "Instagram App Secret (mesma tela, botão Mostrar), cole e Enter: " igsec; echo
  read -rsp "Chave secreta do app (Configurações do app > Básico), cole e Enter: " fbsec; echo
  read -rsp "Chave da Resend (re_...), cole e Enter: " resend; echo
  python3 - "$ENV" "$igid" "$igsec" "$fbsec" "$resend" <<'PY'
import sys
f, igid, igsec, fbsec, rs = sys.argv[1:]
novos = {"INSTAGRAM_APP_ID": igid, "INSTAGRAM_APP_SECRET": igsec, "FACEBOOK_APP_SECRET": fbsec, "RESEND_API_KEY": rs}
linhas = [l for l in open(f).read().splitlines() if l.split("=", 1)[0] not in novos or not novos[l.split("=", 1)[0]]]
linhas += [f"{k}={v}" for k, v in novos.items() if v]
open(f, "w").write("\n".join(linhas) + "\n")
PY
  chmod 600 "$ENV"
  for n in web worker cron; do
    docker rm -f "anzol-$n" >/dev/null 2>&1 || true
  done
  SO_SUBIR=1
}
[ "${1:-}" = "rota" ] && rota
SO_SUBIR=0
[ "${1:-}" = "chaves" ] && chaves

if [ "$SO_SUBIR" = 0 ]; then
echo "== 1/5 Código"
mkdir -p "$O"
if [ -d "$O/app/.git" ]; then git -C "$O/app" pull -q --ff-only; else git clone -q --depth 1 https://github.com/diegomtd/openreply.git "$O/app"; fi
ok "código em $O/app ($(git -C "$O/app" log -1 --format=%h))"

echo "== 2/5 Chaves"
if [ ! -f "$ENV" ]; then
  tok=$(grep -hs '^OPENREPLY_AGENT_TOKEN=' /root/firma/.env /etc/a-firma/*.env /opt/a-firma/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
  [ -n "$tok" ] && ok "reaproveitei o token do agente que o Netuno/Firma já usam" || tok=$(openssl rand -hex 32)
  igid=pendente; igsec=pendente; fbsec=pendente; resend=pendente
  pgp=$(openssl rand -hex 24); rdp=$(openssl rand -hex 24)
  cat > "$ENV" <<EOF
NEXTAUTH_URL=https://$DOMINIO
NEXTAUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)
OPENREPLY_AGENT_TOKEN=$tok
DATABASE_URL=postgresql://postgres:$pgp@anzol-postgres:5432/openreply
REDIS_URL=redis://default:$rdp@anzol-redis:6379
POSTGRES_PASSWORD=$pgp
REDIS_PASSWORD=$rdp
INSTAGRAM_APP_ID=$igid
INSTAGRAM_APP_SECRET=$igsec
FACEBOOK_APP_SECRET=$fbsec
RESEND_API_KEY=$resend
EMAIL_FROM=Anzol <onboarding@resend.dev>
META_GRAPH_API_VERSION=v25.0
EOF
  chmod 600 "$ENV"
  ok "chaves salvas em $ENV"
else
  ok "chaves já existem em $ENV (mantidas)"
fi
val() { grep -m1 "^$1=" "$ENV" | cut -d= -f2-; }

echo "== 3/5 Banco e fila"
docker network create "$NET" >/dev/null 2>&1 || true
if ! docker inspect anzol-postgres >/dev/null 2>&1; then
  docker run -d --name anzol-postgres --restart unless-stopped --network "$NET" \
    -e POSTGRES_PASSWORD="$(val POSTGRES_PASSWORD)" -e POSTGRES_DB=openreply \
    -v anzol_pg:/var/lib/postgresql/data postgres:17 >/dev/null
fi
if ! docker inspect anzol-redis >/dev/null 2>&1; then
  docker run -d --name anzol-redis --restart unless-stopped --network "$NET" \
    -v anzol_redis:/data redis:7 redis-server --appendonly yes --requirepass "$(val REDIS_PASSWORD)" >/dev/null
fi
for i in $(seq 30); do docker exec anzol-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
ok "postgres e redis no ar"

echo "== 4/5 Imagens (alguns minutos na primeira vez)"
for n in web worker cron; do
  df=Dockerfile; [ "$n" = web ] || df=Dockerfile.$n
  docker build -q -t "anzol/$n" -f "$O/app/$df" "$O/app" >/dev/null
  ok "imagem $n"
done
fi

echo "== 5/5 Subindo web, worker e cron"
d0=$(ip -4 -o addr show docker0 2>/dev/null | grep -oE 'inet [0-9.]+' | cut -d' ' -f2 || true)
for n in web worker cron; do docker rm -f "anzol-$n" >/dev/null 2>&1 || true; done
portas="-p 127.0.0.1:$PORTA:3000"; [ -n "$d0" ] && portas="$portas -p $d0:$PORTA:3000"
# shellcheck disable=SC2086
docker run -d --name anzol-web --restart unless-stopped --network "$NET" --env-file "$ENV" $portas anzol/web >/dev/null
docker network connect easypanel anzol-web >/dev/null 2>&1 && ok "web ligado à rede do Traefik" || true
docker run -d --name anzol-worker --restart unless-stopped --network "$NET" --env-file "$ENV" anzol/worker >/dev/null
docker run -d --name anzol-cron --restart unless-stopped --network "$NET" --env-file "$ENV" anzol/cron >/dev/null
for i in $(seq 90); do
  c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/" || true)
  [ -n "$c" ] && [ "$c" != 000 ] && { ok "web respondendo (HTTP $c)"; break; }
  sleep 2
done
[ "${c:-000}" = 000 ] && { echo "  web não respondeu. Últimas linhas:"; docker logs --tail 20 anzol-web 2>&1 | grep -viE 'secret|key|password' ; }
echo
docker ps --filter name=anzol --format '{{.Names}} | {{.Status}}'
grep -q "=pendente" "$ENV" && echo "FALTA: chaves da Meta e da Resend. Rode: bash instalar-anzol.sh chaves"
echo "PRONTO. Próximo: apontar o DNS de $DOMINIO para 169.58.190.45 e rodar: bash instalar-anzol.sh rota"
