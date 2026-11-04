#!/usr/bin/env python3
"""Sobe o OpenReply/Anzol (e guarda o Darkflow) na Contabo a partir do backup da Hostinger.

Uso, como root na Contabo:
  preparar  -> confere o backup, constrói as imagens, sobe Postgres + Redis + web com o banco
               copiado. NÃO liga worker nem cron (evita DM duplicada enquanto a Hostinger roda).
  virar     -> usa /root/final.sql.gz e /root/final.rdb (dump final), recria banco e Redis,
               reinicia o web e liga worker + cron.
  rota      -> depois do DNS apontar para cá: cria a rota no Traefik copiando o modelo da Firma.

Não mexe na Firma (porta 4242), não reinicia o Traefik e nunca imprime variáveis de ambiente.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time

BACKUP = "/root/essencial.tgz"
B = "/root/migracao-restaurar"
O = "/opt/openreply"
DARK = "/opt/darkflow"
NET = "oa-net"
PORTA = "4300"
DOMINIO = "automacao.conteudos.tech"
TRAEFIK = "/etc/easypanel/traefik/config"
REPO = "https://github.com/diegomtd/openreply.git"
os.umask(0o077)


def run(cmd, check=True, quiet=False, **kw):
    r = subprocess.run(cmd, text=True, capture_output=True, **kw)
    if check and r.returncode != 0:
        print("  FALHOU:", " ".join(cmd[:3]), "\n", (r.stderr or r.stdout)[-1500:])
        sys.exit(1)
    return r


def passo(t):
    print("\n== " + t, flush=True)


def ok(t):
    print("  ok  " + t, flush=True)


def spec(servico):
    f = f"{B}/inspect/servico_{servico}.json"
    if not os.path.exists(f):
        return {}
    return json.load(open(f))[0]["Spec"]["TaskTemplate"]["ContainerSpec"]


def envfile(servico):
    src = f"{B}/env/{servico}.env"
    dst = f"{O}/env/{servico}.env"
    os.makedirs(f"{O}/env", exist_ok=True)
    shutil.copy(src, dst)
    os.chmod(dst, 0o600)
    return dst


def env_dict(servico):
    d = {}
    for linha in open(f"{B}/env/{servico}.env"):
        if "=" in linha:
            k, v = linha.rstrip("\n").split("=", 1)
            d[k] = v
    return d


def rm(nome):
    run(["docker", "rm", "-f", nome], check=False)


def imagem_base(servico, padrao):
    img = spec(servico).get("Image", padrao)
    return img.split("@")[0]


def extrair():
    passo("1 Conferindo e abrindo o backup")
    if not os.path.exists(BACKUP):
        print("  Não achei /root/essencial.tgz. Rode o scp da Hostinger primeiro.")
        sys.exit(1)
    if os.path.exists("/root/conferencia.sha256"):
        r = run(["sha256sum", "-c", "--ignore-missing", "conferencia.sha256"], check=False, cwd="/root")
        if r.returncode != 0:
            print("  Backup corrompido na cópia. Repita o scp.")
            sys.exit(1)
        ok("arquivo íntegro (sha256 confere)")
    shutil.rmtree(B, ignore_errors=True)
    os.makedirs(B)
    run(["tar", "xzf", BACKUP, "-C", B])
    ok("backup aberto em " + B)
    run(["docker", "network", "create", NET], check=False)


def postgres(dump):
    passo("Banco Postgres (recriado do zero a partir do dump)")
    s = spec("openreply_postgres")
    e = env_dict("openreply_postgres")
    user = e.get("POSTGRES_USER", "postgres")
    db = e.get("POSTGRES_DB", "postgres")
    rm("openreply-postgres")
    run(["docker", "volume", "rm", "oa_openreply_pg"], check=False)
    cmd = ["docker", "run", "-d", "--name", "openreply-postgres", "--restart", "unless-stopped",
           "--network", NET, "--network-alias", "openreply_postgres",
           "--env-file", envfile("openreply_postgres"),
           "-v", "oa_openreply_pg:/var/lib/postgresql/data",
           imagem_base("openreply_postgres", "postgres:17")] + s.get("Args", [])
    run(cmd)
    for _ in range(60):
        if run(["docker", "exec", "openreply-postgres", "pg_isready", "-U", user, "-d", db], check=False).returncode == 0:
            break
        time.sleep(2)
    time.sleep(3)
    with open(dump, "rb") as f:
        gz = subprocess.Popen(["gzip", "-dc"], stdin=f, stdout=subprocess.PIPE)
        r = subprocess.run(["docker", "exec", "-i", "openreply-postgres", "psql", "-U", user, "-d", "postgres"],
                           stdin=gz.stdout, capture_output=True, text=True)
    erros = [l for l in r.stderr.splitlines() if "ERROR" in l and "already exists" not in l]
    tabelas = run(["docker", "exec", "openreply-postgres", "psql", "-U", user, "-d", db, "-tAc",
                   "select count(*) from information_schema.tables where table_schema='public'"]).stdout.strip()
    ok(f"banco restaurado: {tabelas} tabelas, {len(erros)} erros relevantes")
    for l in erros[:5]:
        print("   ", l[:200])


def redis(rdb=None):
    passo("Redis")
    s = spec("openreply_redis")
    rm("openreply-redis")
    run(["docker", "volume", "rm", "oa_openreply_redis"], check=False)
    cmd = ["docker", "create", "--name", "openreply-redis", "--restart", "unless-stopped",
           "--network", NET, "--network-alias", "openreply_redis",
           "--env-file", envfile("openreply_redis"),
           "-v", "oa_openreply_redis:/data", imagem_base("openreply_redis", "redis:7")]
    if s.get("Command"):
        cmd[2:2] = ["--entrypoint", s["Command"][0]]
        cmd += s["Command"][1:]
    cmd += s.get("Args", [])
    run(cmd)
    if rdb and os.path.exists(rdb):
        run(["docker", "cp", rdb, "openreply-redis:/data/dump.rdb"])
        ok("fila restaurada do dump final")
    run(["docker", "start", "openreply-redis"])
    ok("redis no ar")


def codigo():
    passo("2 Código (o mesmo que rodava na Hostinger)")
    achados = sorted(glob.glob(f"{B}/etc/easypanel/projects/openreply/*/code/Dockerfile"))
    shutil.rmtree(f"{O}/app", ignore_errors=True)
    os.makedirs(O, exist_ok=True)
    if achados:
        shutil.copytree(os.path.dirname(achados[0]), f"{O}/app", symlinks=True)
        ok("código copiado do EasyPanel da Hostinger")
    else:
        run(["git", "clone", "--depth", "1", REPO, f"{O}/app"])
        ok("código não estava no backup; usei a main do GitHub")
    passo("3 Construindo imagens (alguns minutos)")
    for nome, df in (("web", "Dockerfile"), ("worker", "Dockerfile.worker"), ("cron", "Dockerfile.cron")):
        run(["docker", "build", "-q", "-t", f"oa/openreply-{nome}", "-f", f"{O}/app/{df}", f"{O}/app"])
        ok(f"imagem {nome}")


def web():
    passo("Web")
    rm("openreply-web")
    portas = ["-p", f"127.0.0.1:{PORTA}:3000"]
    m = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", run(["ip", "-4", "-o", "addr", "show", "docker0"], check=False).stdout)
    if m:
        portas += ["-p", f"{m.group(1)}:{PORTA}:3000"]
    run(["docker", "run", "-d", "--name", "openreply-web", "--restart", "unless-stopped",
         "--network", NET, "--env-file", envfile("openreply_web")] + portas + ["oa/openreply-web"])
    if run(["docker", "network", "connect", "easypanel", "openreply-web"], check=False).returncode == 0:
        ok("ligado à rede do Traefik")
    for _ in range(90):
        r = run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", f"http://127.0.0.1:{PORTA}/"], check=False)
        if r.stdout.strip() not in ("", "000"):
            ok(f"web respondendo (HTTP {r.stdout.strip()}) em 127.0.0.1:{PORTA}")
            return
        time.sleep(2)
    print("  web não respondeu em 3 min. Últimas linhas do log (sem env):")
    print(run(["docker", "logs", "--tail", "25", "openreply-web"], check=False).stderr[-2500:])


def worker_cron():
    passo("Worker e cron")
    for nome in ("worker", "cron"):
        rm(f"openreply-{nome}")
        run(["docker", "run", "-d", "--name", f"openreply-{nome}", "--restart", "unless-stopped",
             "--network", NET, "--env-file", envfile(f"openreply_{nome}"), f"oa/openreply-{nome}"])
        ok(f"{nome} ligado")


def darkflow():
    passo("Darkflow (guardado, não liga: já estava parado na Hostinger)")
    shutil.rmtree(DARK, ignore_errors=True)
    os.makedirs(f"{DARK}/env")
    src = f"{B}/etc/easypanel/projects/mpt-stack"
    if os.path.isdir(src):
        shutil.copytree(src, f"{DARK}/projeto", symlinks=True)
    for f in glob.glob(f"{B}/env/mpt-stack_*.env"):
        shutil.copy(f, f"{DARK}/env/")
    for f in glob.glob(f"{B}/inspect/servico_mpt-stack_*.json"):
        shutil.copy(f, f"{DARK}/env/")
    dfs = [p.replace(DARK + "/projeto/", "") for p in glob.glob(f"{DARK}/projeto/*/code/Dockerfile*")]
    ok(f"guardado em {DARK} ({len(dfs)} Dockerfiles: {', '.join(dfs) or 'nenhum'})")


def rota():
    passo("Rota do Traefik")
    modelo = f"{TRAEFIK}/firma.yaml"
    if not os.path.exists(modelo):
        print("  Não achei firma.yaml para usar de modelo. Me avise.")
        sys.exit(1)
    redes = run(["docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", "openreply-web"]).stdout
    url = "http://openreply-web:3000" if '"easypanel"' in redes else f"http://172.17.0.1:{PORTA}"
    txt = open(modelo).read()
    txt = re.sub(r"firma\.oceanoazul\.tech", DOMINIO, txt)
    txt = re.sub(r"(url:\s*)[\"']?[^\"'\s]+[\"']?", rf'\1"{url}"', txt)
    txt = re.sub(r"firma", "anzol", txt)
    destino = f"{TRAEFIK}/anzol.yaml"
    open(destino, "w").write(txt)
    os.chmod(destino, 0o644)
    ok(f"rota criada em {destino} -> {url}")
    print(txt)


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else ""
    if modo == "preparar":
        extrair()
        codigo()
        postgres(f"{B}/bancos/openreply_postgres.sql.gz")
        redis()
        web()
        darkflow()
        passo("PRONTO (fase preparar). Worker e cron ficam desligados até a virada.")
    elif modo == "virar":
        if not os.path.exists("/root/final.sql.gz"):
            print("  Falta /root/final.sql.gz (rode o final-hostinger.sh na Hostinger).")
            sys.exit(1)
        postgres("/root/final.sql.gz")
        redis("/root/final.rdb")
        run(["docker", "restart", "openreply-web"])
        worker_cron()
        passo("VIRADA FEITA. Agora troque o DNS e depois rode o modo rota.")
    elif modo == "rota":
        rota()
    else:
        print(__doc__)
        sys.exit(1)
    print(run(["docker", "ps", "--filter", "name=openreply", "--format", "{{.Names}} | {{.Status}}"]).stdout)


if __name__ == "__main__":
    main()
