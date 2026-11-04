/**
 * Estratégias de funil prontas: conteúdo → comentário com palavra-chave → DM
 * com botão → link → follow-up.
 *
 * "Validadas" aqui quer dizer o padrão que os maiores perfis de automação de
 * comentário usam e que cabe na política da Meta (conferida em 04/11/2026):
 *
 * 1. Resposta privada ao comentário: UMA mensagem só, em até 7 dias. Por isso a
 *    primeira DM leva um botão: o toque é a pessoa respondendo, e é isso que
 *    abre a janela de 24h. Sem toque, nada mais pode sair.
 * 2. Tudo depois do link cabe nas 24h (a API valida a soma dos atrasos).
 * 3. A primeira DM avisa que é automático (a Meta pede aviso de robô) e a
 *    sequência para quando a pessoa responde, para um humano assumir.
 * 4. Nada de DM fria: só fala com quem comentou, respondeu story ou mandou DM.
 *
 * Cada estratégia é ligada a um tipo de conteúdo, porque a palavra-chave e a
 * promessa da DM têm que continuar a conversa que o post começou.
 */

import type { StepCondition } from "./sequence";

export interface FunnelStep {
  message: string;
  delayMinutes: number;
  condition: StepCondition;
}

export interface FunnelStrategy {
  slug: string;
  title: string;
  /** Que conteúdo usa este funil. */
  content: string;
  /** Por que funciona, numa frase. */
  why: string;
  keywords: string[];
  openingDmMessage: string;
  openingDmButtonLabel: string;
  dmMessage: string;
  linkButtonLabel: string;
  requireFollow: boolean;
  publicReplyMessages: string[];
  steps: FunnelStep[];
  stopOnReply: boolean;
  /** O que olhar no relatório para saber se está funcionando. */
  metric: string;
}

const AVISO_ROBO = "(sou o assistente automático do perfil)";

export const FUNNEL_STRATEGIES: FunnelStrategy[] = [
  {
    slug: "isca-educativa",
    title: "Isca do Reel educativo",
    content:
      "Reel que ensina parte de um método e promete o resto (guia, checklist, aula) na DM.",
    why: "Quem comenta já quer a continuação; o botão abre a janela e o lembrete recupera quem não abriu.",
    keywords: ["GUIA", "QUERO", "EU QUERO"],
    openingDmMessage: `Oi {username}! Separei o material que falei no vídeo ${AVISO_ROBO}. Toca no botão que eu te mando agora.`,
    openingDmButtonLabel: "Me manda",
    dmMessage: "Aqui está, {username}. É curto, dá pra aplicar hoje: {link}",
    linkButtonLabel: "Abrir o guia",
    requireFollow: false,
    publicReplyMessages: [
      "Te mandei na DM 📩",
      "Enviado! Olha sua DM",
      "Chegou aí na DM, confere 👀",
    ],
    steps: [
      {
        message:
          "Vi que o link ainda não foi aberto. Fica aqui de novo, leva 2 minutos: {link}",
        delayMinutes: 120,
        condition: "NOT_CLICKED",
      },
      {
        message:
          "E aí, conseguiu ver? Me conta numa palavra qual é sua maior trava nisso hoje.",
        delayMinutes: 360,
        condition: "CLICKED",
      },
    ],
    stopOnReply: true,
    metric: "Taxa de toque no botão e cliques no link por comentário.",
  },
  {
    slug: "prova-oferta",
    title: "Prova → oferta",
    content:
      "Reel de resultado, bastidor ou depoimento que termina com 'comenta X que te mando como funciona'.",
    why: "Quem viu a prova comenta com intenção de compra; seguir antes filtra curioso e cresce o perfil.",
    keywords: ["COMO", "QUERO", "LINK"],
    openingDmMessage: `Fala {username}! Vi seu comentário ${AVISO_ROBO}. Quer que eu te mande como funciona por dentro?`,
    openingDmButtonLabel: "Quero ver",
    dmMessage:
      "Aqui está tudo, com preço e o que vem junto: {link}",
    linkButtonLabel: "Ver como funciona",
    requireFollow: true,
    publicReplyMessages: ["Te chamei na DM", "Mandei na DM 🔥", "Olha a DM"],
    steps: [
      {
        message:
          "Só pra não se perder: o link ficou aqui em cima. Qualquer dúvida responde aqui que eu (humano) te respondo.",
        delayMinutes: 180,
        condition: "NOT_CLICKED",
      },
      {
        message:
          "Viu a página? Se travou em alguma coisa, me fala qual que eu explico.",
        delayMinutes: 240,
        condition: "CLICKED",
      },
    ],
    stopOnReply: true,
    metric: "Cliques no link e vendas atribuídas à automação.",
  },
  {
    slug: "carrossel-salvavel",
    title: "Carrossel salvável",
    content:
      "Carrossel com lista ou passo a passo; a versão completa (PDF, planilha, prompt) vai na DM.",
    why: "Carrossel é salvo e revisto por dias; a palavra-chave transforma o salvamento em contato.",
    keywords: ["PDF", "LISTA", "PLANILHA"],
    openingDmMessage: `Oi {username}! A versão completa está pronta ${AVISO_ROBO}. Toca aqui que eu libero.`,
    openingDmButtonLabel: "Liberar",
    dmMessage: "Liberado. Salva esse link que ele não expira: {link}",
    linkButtonLabel: "Baixar",
    requireFollow: false,
    publicReplyMessages: ["Liberado na DM ✅", "Mandei, confere a DM", "Na sua DM!"],
    steps: [
      {
        message: "Ficou aqui o link, caso tenha passado batido: {link}",
        delayMinutes: 240,
        condition: "NOT_CLICKED",
      },
    ],
    stopOnReply: true,
    metric: "Cliques no link por salvamento do post.",
  },
  {
    slug: "story-enquete",
    title: "Story de conversa",
    content:
      "Story pedindo pra responder com uma palavra (ou caixinha) para receber o link.",
    why: "Resposta de story já é DM: a janela de 24h abre na hora, sem precisar de botão.",
    keywords: ["EU", "QUERO", "SIM"],
    openingDmMessage: "",
    openingDmButtonLabel: "",
    dmMessage: `Boa, {username}! ${AVISO_ROBO} Aqui está o que eu prometi no story: {link}`,
    linkButtonLabel: "Abrir",
    requireFollow: false,
    publicReplyMessages: [],
    steps: [
      {
        message: "Conseguiu abrir? Se quiser, te mando a próxima parte também.",
        delayMinutes: 180,
        condition: "CLICKED",
      },
    ],
    stopOnReply: true,
    metric: "Respostas de story e cliques no link.",
  },
  {
    slug: "lista-de-espera",
    title: "Lista de espera de lançamento",
    content:
      "Reel ou carrossel anunciando algo que ainda não abriu, com 'comenta EU pra entrar na lista'.",
    why: "Junta quem quer antes do lançamento; no dia, quem respondeu nas últimas 24h recebe pelo Envio ativo.",
    keywords: ["EU", "LISTA", "QUERO"],
    openingDmMessage: `Oi {username}! ${AVISO_ROBO} Quer entrar na lista e ser avisado primeiro quando abrir?`,
    openingDmButtonLabel: "Quero entrar",
    dmMessage:
      "Pronto, você está na lista. Deixa seu WhatsApp aqui pra eu te avisar no dia (é opcional): {link}",
    linkButtonLabel: "Entrar na lista",
    requireFollow: true,
    publicReplyMessages: ["Te coloquei na lista, olha a DM", "Feito! Confere a DM"],
    steps: [
      {
        message:
          "Falta só confirmar no link de cima pra eu conseguir te avisar fora do Instagram.",
        delayMinutes: 360,
        condition: "NOT_CLICKED",
      },
    ],
    stopOnReply: true,
    metric: "Inscrições confirmadas (cliques) por comentário.",
  },
];

export function findFunnelStrategy(slug: string): FunnelStrategy | undefined {
  return FUNNEL_STRATEGIES.find((s) => s.slug === slug);
}
