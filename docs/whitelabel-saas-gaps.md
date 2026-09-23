# Vender: white-label ou SaaS — o que já dá, o que falta, e o que ninguém vê

Duas formas de vender isto, bem diferentes uma da outra:

- **White-label**: você entrega o código (ou uma instância) para o cliente
  rodar na própria operação — ele é o "dono" daquela instância, com o próprio
  app na Meta, próprio domínio, próprios dados. Você vende a construção e o
  suporte, não o acesso recorrente.
- **SaaS**: uma instância só, sua, com vários clientes pagando para usar —
  cada um conecta a própria conta do Instagram, mas todo mundo divide o
  mesmo app da Meta, o mesmo banco, a mesma cobrança.

Os dois têm pré-requisitos diferentes. Isto documenta os dois, com o que já
está pronto, o que falta de verdade, e as oportunidades que não são óbvias
de fora.

## O que já está pronto para qualquer um dos dois modelos

- **O produto em si funciona e é diferenciado.** Automação comentário → DM,
  sequência de mensagens, condição por tag, gatilho de story, Envio ativo
  dentro da janela de 24h, funil enviado → lido → clicado. Isto não é MVP —
  é mais completo que a maioria dos concorrentes no que documentei em
  `docs/benchmark-manychat.md`.
- **A conta morta se anuncia sozinha.** Estado (`tokenInvalidAt`), aviso fixo
  em toda tela, e-mail para o dono — construído depois de um incidente real
  em produção (`docs/HANDOFF.md` §5.6). A maioria dos concorrentes deste
  porte simplesmente para de funcionar em silêncio; isto é uma vantagem de
  venda de verdade, não só engenharia interna.
- **Login com e-mail e senha**, além do link mágico — construído nesta
  sessão. Ninguém precisa depender de e-mail chegando para entrar, e dá para
  criar acesso direto para alguém sem mandar nada por e-mail (Configurações
  → Time → Acesso direto).
- **Páginas legais já existem**: `/privacy`, `/terms`, `/data-deletion`, e
  uma página feita especificamente para o revisor da Meta ler,
  `/meta-review`. Pré-requisito de App Review já cumprido do lado do código.
- **Multi-conta dentro de um workspace já funciona**: várias contas do
  Instagram, seletor de conta em toda tela, automação move de conta.

## O que falta para cada modelo

### White-label (cliente roda a própria instância)

Isto é o caminho **mais barato** dos dois — cada instância já nasce isolada
(banco próprio, app da Meta próprio, sem depender de revisão nenhuma, porque
o próprio dono da instância cadastra a própria conta como testadora do
próprio app). Falta:

1. **Um jeito de embrulhar o deploy.** Hoje presume alguém confortável com
   EasyPanel, variáveis de ambiente e migrations — o processo que você
   mesmo seguiu para subir isto. Para vender como produto, isso precisa
   virar um script ou um botão ("deploy this app"), não um README técnico.
2. **Trocar a marca é procurar e substituir.** "OpenReply" está espalhado
   pelo código — título das páginas, `app/login/page.tsx`, a barra lateral,
   os metadados de cada página pública. Não existe um único lugar
   ("Configurações → Marca") que troque nome, cor e logo. Para revender
   White-label de verdade, isso devia ser configuração, não edição de
   código a cada cliente novo.
3. **Nenhuma licença/trava de uso.** Uma vez entregue o código, nada impede
   o cliente de continuar usando depois do contrato acabar, ou de repassar
   para outro. Depende inteiramente do contrato, não do produto.

### SaaS (uma instância, vários clientes pagando)

Este é o caminho de **maior alavancagem** (um app, escala para muitos), mas
tem três blocos reais pela frente, nesta ordem de urgência:

1. **Revisão do App na Meta (App Review) — bloqueador, não opcional.**
   Documentado em `docs/meta-app-review.md`. Sem Acesso Avançado nas 4
   permissões, só quem você cadastrar manualmente como testador consegue
   conectar — o que já resolve para uso próprio e alguns clientes, mas
   inviabiliza cadastro aberto.
2. **Isolamento por cliente — não existe hoje.** `Configurações → Time`
   convida gente para o **mesmo** workspace, vendo as **mesmas** contas do
   Instagram. Para SaaS de verdade, cada cliente pagante precisa do próprio
   workspace, criado sozinho no cadastro, sem depender de convite manual
   seu. Isto é o item de maior esforço do documento inteiro — schema,
   onboarding, e reler cada tela que hoje assume "um workspace = meu time".
3. **Cobrança não existe.** `Workspace.dmsSentThisPeriod` já **mede** uso —
   a métrica que qualquer plano por volume precisaria já está sendo
   contada, só não tem nada em cima dela. Falta: planos, checkout
   (Stripe é o caminho óbvio — nada no projeto hoje o usa), e travar o
   envio quando a cota do plano estourar (hoje `reserveWorkspaceDMSend`
   sabe reservar cota, mas contra um teto que não existe por plano nenhum).

## Oportunidades que não são óbvias de fora

- **A métrica de uso já existe, só falta o preço em cima.** Isso é uma
  vantagem real: cobrar por DM enviado (ou por automação ativa) não exige
  instrumentar nada novo — só ler `dmsSentThisPeriod`, que já está sendo
  incrementado a cada envio.
- **O e-mail de conta caída é, sem querer, uma ferramenta de retenção.**
  Um SaaS que avisa **antes** de o cliente perceber que parou de funcionar
  é meio caminho andado para reduzir cancelamento por frustração silenciosa
  — a maioria só descobre quando já perdeu vendas.
- **Story reopens a janela de 24h — motor de audiência alcançável, não só
  recurso.** Documentado em `docs/HANDOFF.md` §5.5: resposta e menção em
  story reabrem a janela de envio. Um pacote de "conteúdo de story
  recomendado" vendido junto do SaaS (não construído — é orientação, não
  código) alimentaria a própria audiência do Envio ativo. Ninguém no
  benchmark (`docs/benchmark-manychat.md`) posiciona isso como parte do
  produto.
- **Revenda por agência é mais fácil que SaaS direto ao consumidor.**
  Dado que o isolamento por cliente não existe ainda, o caminho de menor
  esforço não é "SaaS aberto para qualquer um", é "uma agência gerencia
  várias contas de clientes dentro de um workspace só, dela" — que é
  exatamente o modelo que já funciona hoje, sem nenhuma mudança de código.
  Vender para agências antes de vender para o público final evita o item
  mais caro da lista (isolamento por cliente) até fazer sentido financeiro
  construí-lo.

## Caminho recomendado, em ordem

1. **Agora**: vender/usar como está, para você e clientes que você
   administra diretamente (modelo agência) — zero trabalho novo, e cadastro
   de conta como testadora resolve o acesso.
2. **Quando o primeiro cliente externo pedir para conectar sozinho**:
   submeter a Revisão do App (`docs/meta-app-review.md`).
3. **Quando fizer sentido revender white-label**: extrair a marca para
   configuração (ponto 2 da seção White-label) antes de entregar a primeira
   instância — sem isso, cada cliente novo é uma cópia editada à mão.
4. **Só quando houver demanda real de clientes pagando direto, sem você no
   meio**: isolamento por cliente + cobrança. É o item mais caro; não vale
   construir antes de precisar.
