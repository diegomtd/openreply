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
| GET | `/api/agent/v1/accounts/:conta/comments?hours=72&posts=10&unanswered=1` | comentários recentes, com `answered` |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/reply` `{message}` | resposta pública |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/private-reply` `{message}` | resposta privada ao autor do comentário |
| POST | `/api/agent/v1/accounts/:conta/comments/:id/hide` `{hidden?}` | oculta (ou desoculta) |
| GET | `/api/agent/v1/accounts/:conta/conversations` | DMs com `canReply` e fim da janela |
| GET | `/api/agent/v1/accounts/:conta/conversations/:id` | últimas 20 mensagens |
| POST | `/api/agent/v1/accounts/:conta/messages` `{recipientId, text}` | DM dentro da janela de 24h |
| GET | `/api/agent/v1/accounts/:conta/contacts?since=ISO` | contatos, tags e opt-out |
| GET | `/api/agent/v1/logs?since=ISO` | envios e skips das automações |

## Regras garantidas pela API

- DM só para quem escreveu nas últimas 24h e não pediu para parar (409 caso contrário). Não existe DM fria.
- Resposta privada só como resposta a um comentário da pessoa.
- Ocultar é reversível; apagar comentário não existe aqui.
