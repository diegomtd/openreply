# HANDOFF — Memória viva do OpenReply

> **Para que serve este arquivo:** é a memória persistente do projeto. Qualquer
> pessoa (ou IA) que abrir uma sessão nova lê **só este arquivo** e entende o
> sistema inteiro sem varrer o repositório. Economiza tokens e evita perder
> contexto.
>
> **Regra de ouro:** toda mudança estrutural (schema, rota, tela, decisão de
> arquitetura, bug corrigido) é registrada aqui **no mesmo commit** da mudança.
>
> Última atualização: 2026-09-08 · Branch de trabalho: `claude/manychat-automation-system-wk8cxc`

---

## 1. O que é o sistema

**OpenReply** — automação de Instagram no modelo ManyChat: alguém comenta uma
palavra-chave num post/reel, recebe um DM automático com o link. Fork
open-source de `instagram-comment-to-dm`, sem camada de billing.

**Uso real (dono do sistema):** uso próprio no negócio, **1 workspace, poucas
contas de Instagram**. Não é SaaS multi-tenant de escala. Toda decisão de
arquitetura deve favorecer **baixo consumo de CPU/RAM** em cima de disponibilidade
multi-tenant.

### Onde roda (produção)

| Componente | Onde | Observação |
|---|---|---|
| Web app (Next.js) | **VPS própria via EasyPanel** | domínio `automacao.conteudos.tech` |
| Worker (BullMQ) | mesma VPS, container separado | `Dockerfile.worker` |
| Cron | container Alpine + `crond` | `Dockerfile.cron` + `cron-entrypoint.sh` |
| Postgres | container/serviço na VPS | Prisma 7 |
| Redis | container/serviço na VPS | fila BullMQ |

**Restrição dura: a CPU da VPS é fraca.** Tudo que for laço, polling, query sem
índice ou `include` gordo é problema. Ver §7.

---

## 2. Stack

- Next.js 16 (App Router) + React 19 + Tailwind 4
- Prisma 7 + PostgreSQL (client gerado em `app/generated/prisma`)
- BullMQ + ioredis (fila `dm-processing`)
- Auth.js/NextAuth v5, magic link via Resend
- Instagram Graph API oficial (Instagram Login), sem scraping
- Vitest para testes

> `AGENTS.md` avisa: **este Next.js não é o do seu treino.** Antes de escrever
> código de framework, ler `node_modules/next/dist/docs/`.

---

## 3. Mapa de arquivos (o que importa)

### Fluxo de execução (coração do sistema)

| Arquivo | Papel |
|---|---|
| `app/api/webhook/route.ts` | Recebe webhook da Meta, valida assinatura HMAC, grava `WebhookEvent`, enfileira jobs |
| `lib/meta/webhook.ts` | Parsers puros: `parseCommentEvents`, `parseMessageEvents`, `parsePostbackEvents`, `parseReadEvents`. **Já filtra `is_echo`/`is_deleted` e mensagens da própria conta.** |
| `lib/queue/client.ts` | Fila BullMQ, tipos dos jobs, nomes dos jobs |
| `lib/queue/dm-worker.ts` | **~1300 linhas, o cérebro.** `processComment`, `processMessage`, `processPostback`, `processFollowUp` |
| `worker/dm-worker.ts` | Processo do worker: heartbeat + polling reconciler |
| `lib/polling/comment-reconciler.ts` | Rede de segurança: varre comentários que o webhook perdeu |
| `lib/meta/client.ts` | Chamadas à Graph API (DM, private reply, botões, follow status) |
| `lib/utils/keyword-matcher.ts` | Match de palavra-chave (whole-word / parcial) |
| `lib/utils/rate-limiter.ts` | Teto de 750 private replies/hora por conta |
| `lib/contacts/state.ts` | **Estado por contato: decide se pode enviar (anti-repetição)** |

### Telas (App Router)

- `app/(dashboard)/` — `dashboard`, `overview`, `inbox`, `contacts`, `campaigns`,
  `automations`, `logs`, `settings`, `diagnostics`
- `components/` — `sidebar.tsx`, `top-bar.tsx`, `campaign-builder.tsx` (~1000
  linhas, o construtor de automação), `dashboard-shell.tsx`
- Páginas públicas/SEO: `app/page.tsx`, `manychat-alternative`, `templates`,
  legais (`privacy`, `terms`, `data-deletion`)

### Rotas de API que importam

| Rota | Papel |
|---|---|
| `app/api/webhook/route.ts` | Entrada de tudo. 1 insert por entrega (não faz mais update por evento). |
| `app/api/contacts/route.ts` | GET paginado de contatos + PATCH para mutar/desmutar |
| `app/api/workspace/settings/route.ts` | Teto anti-flood e palavras de opt-out (owner/admin) |
| `app/api/automations/route.ts` | CRUD de automação, inclui `sendFrequency` / `resendCooldownHours` |
| `app/api/dashboard/stats/route.ts` | Números do Home. Reescrito para 1 query da semana + `count()` de contatos. |
| `app/api/logs/route.ts` | Logs paginados, filtráveis pelos novos status de skip |

### Cron endpoints (`app/api/cron/*`, protegidos por `CRON_SECRET`)

`refresh-tokens` (05h) · `attach-next-reel` (06h) · `snapshot-followers` (07h) ·
`prune` (03h30, retenção de dados)

Registrados em dois lugares: `cron-entrypoint.sh` (VPS/EasyPanel, o que vale em
produção) e `vercel.json` (caso rode na Vercel). Ao adicionar um cron, os dois.

---

## 4. Modelo de dados (essencial)

```
User ─ WorkspaceMember ─ Workspace ─ InstagramAccount ─ Automation
                                          │                 │
                                          │                 ├─ TrackedLink ─ LinkClick
                                          │                 └─ DmLog
                                          └─ Contact ─ ContactAutomationState
                                          └─ FollowerSnapshot
```

- **`Automation`** = "campanha". Gatilhos: comentário em post (`postId` /
  `matchAnyPost`) e/ou DM recebido (`dmTriggerEnabled`). Tem opening DM,
  follow gate, follow-up, public reply.
- **`DmLog`** = log de cada envio/skip/falha. Chave de dedupe:
  `@@unique([automationId, commentId])`, onde `commentId` é o id do comentário,
  ou `dm:<mid>` (DM recebido), ou `reveal:<igsid>` (toque no botão).
- **`ProcessedComment`** = set de dedupe compartilhado webhook↔polling.
- **`Contact`** = a pessoa (IGSID) por conta de Instagram. Guarda `optedOut`,
  `lastAutomationSentAt`, `automationSentCount`, `tags`.
- **`ContactAutomationState`** = quantas vezes *esta* automação já foi entregue
  para *este* contato, e quando. É o que impede repetição.

`DmStatus`: `PENDING · SENT · FAILED · SKIPPED_DEDUP · SKIPPED_RATE_LIMIT ·
SKIPPED_PLAN_LIMIT · SKIPPED_NO_MATCH · SKIPPED_ALREADY_SENT ·
SKIPPED_COOLDOWN · SKIPPED_OPTED_OUT`

---

## 5. BUG HISTÓRICO CRÍTICO — mensagem automática repetida

**Sintoma relatado:** "toda vez que recebo mensagem o sistema manda sozinho as
mesmas mensagens da automação para a usuária, mesmo para quem eu já conversei".

**Causa-raiz (confirmada no código):** em `processMessage`
(`lib/queue/dm-worker.ts`) a chave de dedupe era `dm:<messageId>`, ou seja
**por mensagem, não por pessoa**. Cada mensagem nova tem um `mid` novo → o
guard nunca casa → a automação dispara de novo. Com `matchAnyWord = true` isso
significa **resposta automática em toda mensagem, para sempre**.

Não era echo de webhook (`is_echo` já era filtrado) nem retry da fila.

**Correção implementada:** estado por contato (`Contact` +
`ContactAutomationState`) e política de frequência por automação
(`sendFrequency`: `ONCE_PER_CONTACT` padrão / `ONCE_PER_POST` / `COOLDOWN` /
`ALWAYS`), mais:

1. Teto global anti-flood por contato (`Workspace.contactCooldownHours`, padrão
   12h), válido para *todas* as automações somadas.
2. Palavras de opt-out (`parar`, `sair`, `stop`, ...) → `Contact.optedOut = true`,
   nunca recebe automação de novo.
3. Skips ficam **visíveis** em DmLog com status próprio, em vez de silêncio.
4. Toque em botão (postback) e follow-up respeitam `optedOut`, mas **não** as
   demais regras de frequência: um toque é a pessoa pedindo explicitamente.
5. Histórico antigo entra com `scopeKey = "legacy"` (o `DmLog` nunca guardou o
   media id). `ONCE_PER_CONTACT` ignora o scope, então para o padrão o guard é
   exato; só `ONCE_PER_POST` não tem histórico por post anterior à migration.

**Onde se ajusta na UI:** frequência por automação no construtor (seção *"But
only send"*); teto global e palavras de opt-out em **Configurações → Automation
rules**; mute manual em **Contatos**.

**Invariante a nunca quebrar:** *nenhum caminho de envio automático
(`processComment`, `processMessage`, `processPostback`) pode enviar sem passar por
`canSendAutomation()` de `lib/contacts/state.ts`.* Se um caminho novo de gatilho
for criado, ele passa por lá também.

---

## 6. Decisões de arquitetura (e por quê)

| # | Decisão | Motivo |
|---|---|---|
| D1 | Frequência padrão = **1x por contato por automação** | É o comportamento que o ManyChat entrega no gatilho de comentário e o que o usuário espera. "Sempre" é opt-in explícito. |
| D2 | Estado de contato no **Postgres**, não no Redis | Redis da VPS é volátil/pequeno; a garantia anti-repetição não pode morrer num restart. |
| D3 | Skip é **logado**, não silencioso | Sem isso é impossível diagnosticar "por que não enviou?" — foi o que tornou o bug invisível. |
| D4 | Fail-closed no follow gate no primeiro contato, fail-open depois do toque | Já era a regra do código; mantida. |
| D5 | Sem flow builder visual (canvas) | Custo/benefício ruim para 1 negócio; o ganho real está em gatilhos + anti-repetição + inbox. Ver `docs/benchmark-manychat.md` §6. |
| D6 | Polling reconciler continua, mas com intervalo maior por padrão | CPU fraca; webhook cobre o caso comum. |

---

## 7. Economia de CPU/RAM (regras para esta VPS)

Feito:

- `WORKER_CONCURRENCY` configurável (padrão **2**, era 5 fixo).
- `COMMENT_POLL_INTERVAL_MS` padrão **15 min** (era 5 min); sweep aborta cedo
  se não houver automação ativa.
- Webhook grava **1 linha** por evento (antes: insert + N updates de
  `workspaceId`).
- `processMessage` sem N+1: um único lote de queries para logs/estado, em vez de
  2 queries por automação.
- Dashboard: os 7 `COUNT` sequenciais viraram **1 query da semana** agrupada em
  memória; contagem de contatos virou `count()` na tabela `Contact` em vez de
  carregar todos os `commenterId` distintos.
- Cron `prune`: retenção de `WebhookEvent` (7d), `OperationalEvent` INFO (14d),
  `ProcessedComment` (30d). Sem isso as tabelas crescem para sempre.
- Índices novos: `DmLog(commenterId)`, `DmLog(automationId, commenterId)`,
  `WebhookEvent(createdAt)`, `Contact(instagramAccountId, igsid)` e os índices de
  filtro de `Contact` / `ContactAutomationState`.
- Deletes do `prune` são **sequenciais** de propósito: três DELETE em massa
  simultâneos numa VPS de 1 core derrubam o app junto.

Regras para mudanças futuras:

1. Nunca `findMany` sem `take` ou sem filtro de data em tabela que cresce.
2. Nunca `include` de relação inteira quando um `select` resolve.
3. Nada de laço com `await` dentro para gerar agregados — usar `groupBy`.
4. Todo endpoint novo de listagem nasce paginado.
5. Antes de subir intervalo de polling, perguntar: o webhook já cobre isso?

---

## 8. Estrutura de menu (IA — arquitetura de informação)

Ordem final, espelhando ManyChat mas enxuta:

```
Home            → /dashboard   (números do dia + saúde do sistema)
Inbox           → /inbox       (conversas, janela de 24h)
Contatos        → /contacts    (pessoas, histórico de envios, mute)  ← novo

── Automation ──
Automations     → /campaigns   (lista, criar, templates)
Analytics       → /overview    (crescimento, cliques, CTR, relatórios)
DM Logs         → /logs        (cada envio/skip/falha com motivo)

── System ──
Settings        → /settings    (conexão IG, time, automation rules, uso)
Diagnostics     → /diagnostics
```

`/campaigns` continua existindo como rota legada (mesma tela) para não quebrar
links salvos. Nomenclatura oficial na UI: **Automação**, não "Campanha".

---

## 9. Variáveis de ambiente

Base em `.env.example`. Além dela:

| Var | Padrão | Para que |
|---|---|---|
| `WORKER_CONCURRENCY` | `2` | Jobs simultâneos no worker (CPU fraca → baixo) |
| `COMMENT_POLL_INTERVAL_MS` | `900000` | Intervalo do reconciler (15 min) |
| `COMMENT_POLL_LOOKBACK_HOURS` | `72` | Janela de comentários varridos |
| `COMMENT_POLL_MAX_PER_SWEEP` | `30` | Teto de comentários por sweep |
| `DATA_RETENTION_WEBHOOK_DAYS` | `7` | Retenção de `WebhookEvent` |
| `DATA_RETENTION_EVENT_DAYS` | `14` | Retenção de `OperationalEvent` INFO (×6 para WARNING/ERROR) |
| `DATA_RETENTION_COMMENT_DAYS` | `30` | Retenção de `ProcessedComment` |

---

## 10. Como rodar / validar

```bash
npm install
docker-compose up -d          # Postgres + Redis locais
npm run db:migrate
npm run dev                   # web  :3000
npm run worker                # worker (obrigatório para enviar DM)

npm test                      # vitest
npm run typecheck
npm run lint
```

**Sempre dois processos.** Se comentário chega e DM não sai, o suspeito nº 1 é o
worker parado.

Depois de mexer em `prisma/schema.prisma`: criar migration em
`prisma/migrations/<timestamp>_<nome>/migration.sql` (o padrão do repo é SQL
escrito à mão, sem `prisma migrate dev`) e rodar `npm run db:generate`.

---

## 11. Backlog priorizado (o que ficou fora)

| Prioridade | Item | Nota |
|---|---|---|
| P1 | Story reply / story mention como gatilho | Grande ganho, API já permite |
| P1 | Broadcast/sequência dentro da janela de 24h | Precisa respeitar tags de marketing da Meta |
| P2 | Tags e campos personalizados usados em condição de automação | Base (`Contact.tags`) já existe |
| P2 | Editor de mensagem em blocos (texto/imagem/botões) | Passo antes de qualquer canvas |
| P3 | Flow builder visual | Só se o negócio realmente precisar de ramificação |
| P3 | Integrações (Sheets, webhook de saída) | Depende de demanda |

---

## 12. Log de sessões

| Data | O que foi feito |
|---|---|
| 2026-09-08 | Análise ManyChat + concorrentes (`docs/benchmark-manychat.md`). Correção do bug de repetição (Contact/ContactAutomationState/sendFrequency/opt-out). Tela de Contatos. Reestruturação do menu. Otimizações de CPU para a VPS. Criação deste handoff. |
