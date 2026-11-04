# API de agentes

Deixa um agente de IA (o Netuno, do ecossistema Oceano Azul) ler e operar as contas de Instagram conectadas aqui, sem sessão de navegador. Código em `lib/agent/`, rota em `app/api/agent/v1/[...path]/route.ts`.

## Ligar

1. Gere a chave: `openssl rand -hex 32`.
2. Coloque em `OPENREPLY_AGENT_TOKEN` no ambiente do web app (EasyPanel) e reinicie. Sem a variável, a API responde 503.
3. Opcional: `OPENREPLY_AGENT_WORKSPACE_ID` restringe a um workspace.

Toda chamada leva `Authorization: Bearer <chave>`. A chave dá leitura de DMs e resposta em nome das contas: trate como senha.

## Rotas

`:conta` aceita o id interno, o id do Instagram ou o @.

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/api/agent/v1/accounts` | contas conectadas e saúde do token |
| GET | `/api/agent/v1/accounts/:conta/insights?days=30` | seguidores, variação diária e snapshots |
| GET | `/api/agent/v1/accounts/:conta/media?limit=25&insights=1` | posts com views, alcance, salvos, envios |
| GET | `/api/agent/v1/accounts/:conta/comments?hours=72&posts=10&unanswered=1` | comentários recentes, com `answered` e `automation` (automação ativa que pega o comentário e o status do envio, ou `null`) |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/reply` `{message}` | resposta pública |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/private-reply` `{message}` | resposta privada ao autor do comentário |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/hide` `{hidden?}` | oculta (ou desoculta) |
| GET | `/api/agent/v1/accounts/:conta/conversations` | DMs com `canReply` e fim da janela |
| GET | `/api/agent/v1/accounts/:conta/conversations/:id` | últimas 20 mensagens |
| POST | `/api/agent/v1/accounts/:conta/messages` `{recipientId, text}` | DM dentro da janela de 24h |
| GET | `/api/agent/v1/accounts/:conta/contacts?since=ISO` | contatos, tags e opt-out |
| GET | `/api/agent/v1/logs?since=ISO` | envios e skips das automações |
| GET | `/api/agent/v1/accounts/:conta/discovery/:perfil?limit=25` | radar: seguidores e últimos posts (curtidas, comentários, views) de outro perfil profissional, com `engagementRate` e `viewsPerFollower` |

| GET | `/api/agent/v1/accounts/:conta/automations` | automações da conta (`byAgent`, `isActive`, envios) |
| POST | `/api/agent/v1/accounts/:conta/automations` `{name, postId \| pendingNextReel, keywords, dmMessage, linkUrl?, linkButtonLabel?, publicReplies?, requireFollow?, sendFrequency?}` | cria automação de comentário (nasce desligada) |
| POST | `/api/agent/v1/accounts/:conta/automations/:id/pause` | desliga |
| POST | `/api/agent/v1/accounts/:conta/automations/:id/activate` | liga, só com `OPENREPLY_AGENT_CAN_ACTIVATE=1` |

### Automações pelo agente

Nasce desligada e marcada "Criada pelo agente"; quem liga é o dono no painel, a não ser que `OPENREPLY_AGENT_CAN_ACTIVATE=1`. Só gatilho de comentário em post específico ou no próximo Reel; sem "qualquer palavra", "qualquer post", gatilho de DM/story ou frequência "sempre". Palavra-chave que outra automação ativa já usa no mesmo post volta 409. Apagar não existe aqui.

### Radar (business discovery)

Só leitura de perfil comercial ou de criador; perfil pessoal ou com restrição de idade volta 502. Tenta primeiro com o token da `:conta` (Instagram Login). Se a Meta negar (403 aqui), configure o caminho do Facebook Login e reinicie: `META_DISCOVERY_TOKEN` (token de usuário do Facebook com `instagram_basic`, `pages_show_list` e `business_management`, de quem é admin do app) e `META_DISCOVERY_IG_USER_ID` (id da conta profissional ligada a uma Página). Conta no limite de chamadas da Meta; o Netuno chama poucas vezes por dia.

## Regras garantidas pela API

- DM só para quem escreveu nas últimas 24h e não pediu para parar (409 caso contrário). Não existe DM fria.
- Resposta privada só como resposta a um comentário da pessoa.
- Ocultar é reversível; apagar comentário não existe aqui.
