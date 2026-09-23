# Revisão do app na Meta (App Review) — para virar SaaS

Por que este documento existe: para o OpenReply virar um SaaS onde **qualquer
cliente conecta a própria conta do Instagram**, sem você precisar cadastrar
cada um manualmente como testador, é preciso passar pela Revisão do App da
Meta e conseguir **Acesso Avançado (Advanced Access)** nas permissões que o
app já usa. Isso é trabalho no painel da Meta (developers.facebook.com), não
no código — mas o código já está pronto para isso. Este arquivo é o checklist
e o texto de apoio para a submissão.

## O que o código já tem pronto

Conferido em 2026-09-23, sem precisar mudar nada:

- **Fluxo certo**: `api.instagram.com/oauth/authorize` — Instagram API with
  Instagram Login. Não pede Facebook, não pede Página vinculada. Cada cliente
  autoriza com o próprio login do Instagram dele.
- **`/privacy`** — já descreve os dados coletados (e-mail, tokens do
  Instagram, comentários processados, logs de envio) e para que servem.
- **`/terms`** — já existe.
- **`/data-deletion`** — já cobre as duas exigências da Meta: desconectar pela
  própria tela (Configurações → Desconectar) e pedir apagamento total por
  e-mail. É uma **Data Deletion Instructions URL** (a Meta aceita isso no
  lugar de um callback automático — não precisa construir endpoint).
- **`/meta-review`** — já existe, feita para o revisor ler: fluxo de uso,
  posição de compliance ("nunca pede senha do Instagram, nunca faz
  scraping"), e um roteiro de teste. Vale conferir se ainda bate com o
  produto atual antes de submeter — foi escrita antes do Envio ativo e do
  login por senha.
- **Nunca pede senha do Instagram**, nunca faz scraping — só a API oficial.
  Token cifrado em repouso (`lib/meta/oauth.ts`).

Ou seja: a parte de engenharia deste requisito está feita. O que falta é
configuração no painel da Meta e a submissão em si.

## Checklist no painel da Meta (developers.facebook.com)

Na ordem que costuma dar menos retrabalho:

1. **Tipo do app = Business.** Configurações básicas → Tipo do app. Se o app
   atual não for Business, a Meta obriga a criar um novo app — vale conferir
   isso **antes** de qualquer outra coisa.
2. **Verificação de negócio** (Business Verification) no Business Manager:
   razão social, endereço, telefone, às vezes documento. Costuma ser a etapa
   mais lenta — comece por ela.
3. **Configurações básicas do app**: ícone, categoria, e as duas URLs:
   - Política de Privacidade → `https://SEU_DOMINIO/privacy`
   - Instruções de Exclusão de Dados → `https://SEU_DOMINIO/data-deletion`
4. **Testar com uma conta testadora antes de submeter.** A Meta rejeita
   submissão se o revisor não conseguir reproduzir o fluxo.
5. **Submeter para revisão** pedindo Acesso Avançado nas 4 permissões abaixo,
   uma gravação de tela por permissão.

## As 4 permissões e o que gravar em cada uma

A Meta quer ver, na tela real do seu produto, a permissão sendo usada — não
um vídeo institucional. Ordem sugerida: conectar a conta primeiro (mostra
`instagram_business_basic` sendo concedida), depois uma automação disparando
de ponta a ponta.

### `instagram_business_basic`

**Uso real**: ler o `user_id`, `username` e tipo de conta ao conectar, para
identificar qual conta do Instagram está vinculada ao workspace.

**Roteiro da gravação**: Configurações → "Conectar Instagram" → tela de
autorização da Meta → aceitar → voltar ao OpenReply e mostrar `@usuario`
aparecendo na lista de contas conectadas.

**Texto de justificativa** (cole e adapte no formulário):
> OpenReply uses `instagram_business_basic` to identify which professional
> Instagram account a workspace has connected, so automations and message
> logs can be scoped to the correct account. It is requested at connection
> time and re-used to keep the account's username in sync.

### `instagram_business_manage_comments`

**Uso real**: ler comentários novos nos posts/reels do cliente para casar
com as palavras-chave da automação, e opcionalmente responder publicamente.

**Roteiro**: comentar (de outra conta de teste) na publicação-alvo de uma
automação já configurada → mostrar o comentário chegando em Registros →
mostrar a resposta pública (se a automação tiver isso ligado).

**Texto de justificativa**:
> OpenReply reads comments on the connected account's posts to match
> configured keywords and trigger an automated private reply, and can post a
> public reply acknowledging the comment. This is the core comment-to-DM
> automation feature the product provides to businesses.

### `instagram_business_manage_messages`

**Uso real**: enviar a DM automática depois que o gatilho casa, e ler as
mensagens recebidas para saber se a pessoa respondeu (mede a janela de 24h).

**Roteiro**: continuação do vídeo anterior — mostrar a DM chegando na conta
de teste que comentou, com o link.

**Texto de justificativa**:
> OpenReply sends a private reply (DM) to a person who triggered an
> automation by commenting, replying to a story, or mentioning the account,
> within Meta's messaging window. It also reads inbound messages to track
> whether the 24-hour messaging window is open before sending.

### `instagram_business_manage_insights`

**Uso real**: contagem de seguidores para o gráfico de crescimento na
Análise.

**Roteiro**: tela de Análise mostrando o gráfico de seguidores.

**Texto de justificativa**:
> OpenReply reads follower count insights to show account growth over time
> on the customer's analytics dashboard.

## O que NÃO precisa esperar a revisão

- Uso próprio e de um punhado de clientes/amigos: cadastrar cada conta como
  **testadora** (Funções do app → Testadores do Instagram) funciona hoje,
  sem revisão nenhuma, na hora.
- A revisão só é obrigatória quando um estranho (fora da lista de
  testadores) precisa conseguir conectar sozinho — ou seja, quando isto virar
  produto de verdade para o público.

## Fora do escopo deste documento: isolar cliente por cliente

App Review resolve "qualquer um consegue autorizar a própria conta". Não
resolve "cada cliente só enxerga a própria conta dentro do produto" — hoje
todo mundo convidado para um workspace (Configurações → Time) vê **todas**
as contas conectadas àquele workspace, sem distinção.

Para um SaaS de verdade onde cada cliente é isolado dos outros, é um projeto
à parte: cada cliente precisaria do próprio workspace (criado automaticamente
no cadastro, sem depender de convite manual seu) e billing por workspace.
**Vale planejar quando o objetivo virar concreto** — nesse momento me chama
para desenhar isso; hoje o app assume "um workspace = um time seu", não
"um workspace por cliente pagante".
