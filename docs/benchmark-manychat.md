# Benchmark ManyChat + concorrentes → modelo alvo do OpenReply

Documento de análise e plano. Escopo: automação de Instagram (comentário→DM,
DM por palavra-chave, inbox). Objetivo declarado: **usar no meu próprio negócio**,
numa VPS com CPU fraca — não virar SaaS. Toda recomendação é filtrada por isso.

---

## 1. ManyChat — telas, menus e modelo de funcionamento

### 1.1 Arquitetura de informação (barra lateral, na ordem)

| Ordem | Item | O que é | Por que está nessa posição |
|---|---|---|---|
| 1 | **Home** | Números do dia, dicas, saúde da conta | Primeira coisa: "está funcionando?" |
| 2 | **Contacts** | Lista de todo mundo que já falou com o bot; campos, tags, segmentos | A pessoa é a entidade central, não a campanha |
| 3 | **Live Chat** | Inbox unificada, com atribuição para agente humano | Onde o humano assume quando o bot para |
| 4 | **Automation** | Flows (canvas), Keywords, Default Reply, Sequences, Rules | O motor |
| 5 | **Broadcasting** | Disparo em massa para contatos existentes | Depois de ter base |
| 6 | **Growth Tools** | Widgets, Ref URL, QR, comment growth tool | Entrada de contatos |
| 7 | **Settings** | Canais, Fields, Tags, Team, integrações, API | Última, é infraestrutura |

Leitura estratégica: o ManyChat organiza por **pessoa → conversa → automação →
disparo**. A campanha é meio, não fim. Um app que organiza por "campanhas"
(como o OpenReply organizava) perde a visão de "o que essa pessoa já recebeu de
mim" — que é justamente o ponto onde nasce o bug de repetição.

### 1.2 Gatilhos de Instagram disponíveis

- Comentário em post/reel (palavra-chave ou qualquer comentário)
- Comentário em Live
- Resposta a Story / menção em Story
- DM com palavra-chave
- Conversation Started / **Default Reply** (só dispara quando nada mais casou)
- Novo seguidor (Follow-to-DM)
- Ref URL / link `ig.me` com payload
- Anúncio Click-to-Instagram-Direct

### 1.3 Flow Builder (canvas)

Nós: Send Message · Condition · Action · Smart Delay · Randomizer (A/B) ·
Start Another Flow · AI Step. O editor de mensagem tem blocos: texto, imagem,
card, galeria, áudio, vídeo, arquivo, botões (URL / abrir flow / telefone) e
quick replies.

### 1.4 Contacts

Lista com busca e filtros por tag, campo personalizado, data de entrada, status
de assinatura. Ficha do contato: histórico da conversa, tags, campos do sistema
(nome, IGSID, origem, última interação) e campos personalizados.

### 1.5 Live Chat

Inbox com filtros (aberto / resolvido / atribuído a mim), notas internas,
atribuição, snooze, marcar como resolvido, respostas salvas.

### 1.6 Analytics

Crescimento de contatos no tempo; por flow: enviados, entregues, lidos,
cliques, CTR e meta de conversão.

### 1.7 O ponto fraco confessado do ManyChat (nossa maior oportunidade)

O gatilho de comentário do ManyChat dispara **uma vez por pessoa por post** — é
limitação da própria API do Instagram, não uma feature. Mas o **gatilho de DM
por palavra-chave dispara todas as vezes**. Para não repetir mensagem, a
documentação e a comunidade mandam o usuário **montar na mão** um contorno:
criar uma Tag ou um Custom Field numérico, colocar um nó de Condição no começo do
flow checando a tag, e um nó de Action adicionando a tag no fim.

Ou seja: **no ManyChat, "não repetir mensagem para quem já recebeu" é trabalho
manual de configuração, não um padrão do produto.** É exatamente o bug que
existia aqui — e é onde o OpenReply pode ficar objetivamente melhor: fazer disso
o comportamento padrão, com um botão em vez de um flow.

---

## 2. Concorrentes — o que cada um ensina

| Ferramenta | Posicionamento | Ideia que vale copiar |
|---|---|---|
| **Chatfuel** | IA-first, e-commerce | Dois modos de construção: canvas visual **e** blocos simples. Nem todo usuário quer canvas. |
| **InstantDM / Inrō** | Especialistas em comentário→DM, preço baixo | Onboarding de 1 tela: escolhe post, digita palavra, digita mensagem. Zero configuração. |
| **Tidio / Respond.io** | Inbox de time | Inbox como cidadão de primeira classe, com atribuição e SLA |
| **SetSmart / FlowGent** | "AI setter" para vendas em DM | Qualificação em DM: o bot faz 2–3 perguntas antes de entregar o link |
| **BotConversa** (BR) | WhatsApp/IG, PMEs brasileiras | Menu em português direto, "Palavras-chave" como item de menu separado do builder |
| **MobileMonkey/Customers.ai** | Story mention | Menção em Story como gatilho de alto valor |
| **GoHighLevel** | Agência/CRM | Contato unificado por canal (o contato é o CRM) |

Padrão comum a todos: **contato > conversa > automação**, inbox integrada,
e alguma forma de limitar frequência por pessoa.

---

## 3. Lista completa de funcionalidades (mapa de referência)

Legenda: ✅ existe no OpenReply · 🟡 parcial · ➕ adicionado neste trabalho ·
⬜ backlog consciente

### Gatilhos
- ✅ Comentário em post/reel com palavra-chave (whole-word ou parcial)
- ✅ Qualquer comentário (`matchAnyWord`)
- ✅ Qualquer post (`matchAnyPost`) e "próximo reel" (`pendingNextReel`)
- ✅ DM recebido com palavra-chave (`dmTriggerEnabled`)
- ✅ Toque em botão (postback) e fallback por leitura da mensagem
- ⬜ Resposta/menção em Story · Live comments · novo seguidor · Ref URL · Ads

### Mensagem
- ✅ Texto com `{username}`
- ✅ Até 2 botões de link, cada um com link rastreado próprio
- ✅ Opening DM com botão (contorna limite de private reply)
- ✅ Resposta pública no comentário, com variações sorteadas
- ✅ Follow-up agendado com atraso em minutos
- ⬜ Imagem/card/galeria · quick replies · sequência de múltiplas mensagens

### Regras e segurança de envio
- ✅ Rate limit por conta (750 private replies/h) com fila de excedente
- ✅ Dedupe por comentário (`ProcessedComment` + `DmLog`)
- ✅ Follow gate com re-verificação no toque do botão
- ➕ **Frequência por contato: 1x por pessoa / cooldown em horas / sempre**
- ➕ **Teto global anti-flood por contato, somando todas as automações**
- ➕ **Opt-out por palavra ("parar", "sair", "stop") e mute manual**
- ➕ **Skip logado com motivo, em vez de silêncio**

### Pessoas
- ➕ **Tela de Contatos: quem é, o que já recebeu, tags, opt-out, histórico**
- 🟡 Inbox de DMs (existe, janela de 24h, cache no cliente)
- ⬜ Campos personalizados · segmentos salvos · atribuição para time

### Análise
- ✅ Cliques e CTR por link rastreado
- ✅ Série diária de DMs, top palavras-chave, histórico de seguidores
- ✅ Relatório compartilhável por slug público
- ⬜ Funil por automação (enviado → lido → clicado) com taxa em cada passo

### Operação
- ✅ Logs de DM com motivo de falha
- ✅ Diagnóstico + heartbeat do worker + eventos operacionais
- ✅ Polling reconciler para comentários que o webhook perde
- ✅ Multi-conta, workspaces e papéis
- ➕ **Retenção/limpeza automática de dados**
- ➕ **Concorrência e polling configuráveis para VPS fraca**

---

## 4. UI/UX — padrões que valem, e os que não valem

**Copiar:**

1. **Construtor em frases, não em formulário.** "Quando alguém comenta em `[post]`
   / e o comentário tem `[palavra]` / a pessoa recebe `[mensagem]`". O
   `campaign-builder.tsx` já faz isso ("When someone comments on…"). É melhor UX
   que o canvas do ManyChat para o caso simples.
2. **Preview do DM ao lado do editor**, atualizando ao digitar. Já existe
   (`campaign-preview.tsx`).
3. **Estado vazio que ensina** em vez de tela vazia.
4. **Motivo visível de skip.** "Não enviei porque essa pessoa já recebeu em
   12/03" é a informação mais valiosa da tela de logs.
5. **Ficha do contato com histórico**, com um botão de "não automatizar esta
   pessoa".

**Não copiar:**

- Canvas visual completo: custo alto de UI e de CPU, ganho baixo para 1 negócio
  com automações de 1–2 passos.
- Menu com 7 seções e submenus profundos: o OpenReply tem ~8 telas, cabe em uma
  lista plana com um agrupamento leve.
- Onboarding com wizard longo: aqui o setup difícil é o app da Meta, não o app.

---

## 5. Cruzamento com o sistema atual — lacunas encontradas

| # | Lacuna | Gravidade | Onde |
|---|---|---|---|
| L1 | **Nenhum estado por pessoa.** Dedupe era por id de mensagem/comentário. Toda mensagem nova re-disparava a automação. | 🔴 crítica (bug relatado) | `lib/queue/dm-worker.ts` `processMessage` |
| L2 | Sem opt-out. A pessoa não tinha como parar de receber. | 🔴 crítica (risco de bloqueio/report na Meta) | idem |
| L3 | Sem teto de frequência entre automações. 3 automações ativas = 3 DMs para a mesma pessoa. | 🟠 alta | idem |
| L4 | Nenhuma tela de pessoas. Impossível responder "o que essa usuária já recebeu?" | 🟠 alta | UI |
| L5 | Skip silencioso: `continue` sem log. Bug invisível. | 🟠 alta | worker |
| L6 | Menu com "Campaigns" e "Automations" coexistindo, sem hierarquia | 🟡 média | `components/sidebar.tsx` |
| L7 | Dashboard com 7 `COUNT` sequenciais + carga de todos os `commenterId` distintos | 🟠 alta (CPU) | `app/api/dashboard/stats/route.ts` |
| L8 | Webhook fazia 1 insert + N updates por requisição | 🟡 média (CPU) | `app/api/webhook/route.ts` |
| L9 | `WebhookEvent`/`OperationalEvent`/`ProcessedComment` crescem para sempre | 🟠 alta (disco/CPU) | schema |
| L10 | Concorrência 5 e polling de 5 min fixos, altos para a VPS | 🟡 média (CPU) | worker |

---

## 6. Modelo alvo (o que foi construído)

**Princípio:** o OpenReply não vira ManyChat. Vira **a parte do ManyChat que
importa, com a proteção que o ManyChat não dá de fábrica.**

Três camadas, em ordem de valor:

1. **Camada de pessoas (nova).** `Contact` + `ContactAutomationState` +
   tela de Contatos. Resolve L1–L5 de uma vez: a decisão de enviar deixa de ser
   "já vi esta mensagem?" e passa a ser "**esta pessoa já recebeu isto?**".
2. **Camada de automação (melhorada).** O construtor ganha a seção
   *"Frequência e segurança"*: 1x por pessoa (padrão) · reenviar após N horas ·
   sempre. Mais opt-out e mute.
3. **Camada de operação (afinada).** Retenção de dados, concorrência e polling
   configuráveis, queries do dashboard reescritas. O sistema tem que caber na VPS.

### Ordem final do menu

```
Home · Inbox · Contatos · Automações · Análise · Logs · Configurações · Diagnóstico
```

Pessoa antes de automação, igual ao ManyChat, porque é o que evita o erro que
gerou este trabalho.

---

## 7. Roteiro depois deste trabalho

| Prioridade | Item | Por que |
|---|---|---|
| P1 | Story reply e menção em Story como gatilho | Maior volume de contato hoje no Instagram |
| P1 | Sequência de mensagens (2–3 passos com atraso) dentro da janela de 24h | Qualificação em DM converte mais que link seco |
| P2 | Tags e campos usados como condição | A base já está no `Contact` |
| P2 | Funil por automação: enviado → lido → clicado | Fecha a conta do ROI |
| P3 | Editor de mensagem em blocos | Antes de qualquer canvas |
| P3 | Canvas visual | Só se aparecer necessidade real de ramificação |

---

## Fontes

- [Honest Manychat Review After Using It For 6+ Years (2026) — Chatimize](https://chatimize.com/reviews/manychat/)
- [Instagram Post and Reel Comments trigger — Manychat Help](https://help.manychat.com/hc/en-us/articles/14281316989724-Instagram-Post-and-Reel-Comments-trigger)
- [How to set custom rules with Triggers, Conditions, and Actions — Manychat Help](https://help.manychat.com/hc/en-us/articles/14281170185628-How-to-set-custom-rules-with-Triggers-Conditions-and-Actions)
- [Comments Growth Tool troubleshooting — Manychat Help](https://support.manychat.com/en/support/solutions/articles/36000126581-comments-growth-tool-troubleshooting)
- [Enviar somente uma vez por contato — Manychat Community](https://community.manychat.com/general-q-a-43/after-setting-up-my-automation-where-all-comments-should-trigger-towards-a-dm-to-be-sent-only-once-it-doesn-t-work-8308)
- [Full ManyChat Review 2026 — GPTBots](https://www.gptbots.ai/blog/manychat-review)
- [15 Best ManyChat Alternatives for Instagram Automation (2026) — InstantDM](https://instantdm.com/blog/top-15-manychat-alternatives-for-instagram-automation-in-2026)
- [Manychat vs Chatfuel (2026) — Chatimize](https://chatimize.com/manychat-vs-chatfuel/)
- [ManyChat Alternatives 2026: 8 Instagram DM Tools Compared — Massively](https://massively.ai/general/manychat-alternatives-2026-8-instagram-dm-tools-compared-massively/)
