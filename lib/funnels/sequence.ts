import { MESSAGING_WINDOW_HOURS } from "@/lib/broadcast/window";

/**
 * Decide se um passo da sequência (o follow-up depois do link) sai agora.
 *
 * Regras da Meta que isto respeita (conferidas em 04/11/2026 na documentação
 * de Instagram Messaging):
 * - Só dá para mandar mensagem dentro de 24h da última interação da pessoa.
 *   A sequência só começa depois de um toque no botão ou de uma DM dela, então
 *   a janela abre no início da cadeia (`chainStartedAt`) e é renovada a cada
 *   mensagem nova dela (`lastInboundAt`).
 * - Fora da janela não existe envio automatizado legal no Instagram (a tag
 *   HUMAN_AGENT é só para humano). Então janela fechada encerra a cadeia sem
 *   nem chamar a API.
 * - O app precisa ter caminho para atendimento humano. Com `stopOnReply`, a
 *   pessoa respondeu → o robô sai da conversa.
 *
 * Função pura, sem banco: o worker busca os dados e aplica o resultado.
 */

export type StepCondition = "ALWAYS" | "NOT_CLICKED" | "CLICKED";

export interface StepDecisionInput {
  condition: StepCondition;
  /** A pessoa clicou em algum link desta automação. */
  clicked: boolean;
  stopOnReply: boolean;
  /** Quando a cadeia começou (o link saiu). Nulo em jobs antigos. */
  chainStartedAt: Date | null;
  /** Última mensagem da pessoa para a conta. */
  lastInboundAt: Date | null;
  now?: Date;
}

export type StepDecision =
  /** Manda este passo e agenda o próximo. */
  | { action: "send" }
  /** Pula este passo (condição não bate), mas a cadeia continua. */
  | { action: "skip"; reason: "condition" }
  /** Encerra a cadeia: nada depois disto sai. */
  | { action: "stop"; reason: "window_closed" | "replied" };

const MS_PER_HOUR = 60 * 60 * 1000;

export function decideSequenceStep(input: StepDecisionInput): StepDecision {
  const now = input.now ?? new Date();
  const started = input.chainStartedAt?.getTime() ?? null;
  const inbound = input.lastInboundAt?.getTime() ?? null;

  // A pessoa escreveu depois que o link saiu: conversa de verdade, sai o robô.
  if (input.stopOnReply && started !== null && inbound !== null && inbound > started) {
    return { action: "stop", reason: "replied" };
  }

  // Janela: conta a partir da interação mais recente que conhecemos. Sem
  // nenhuma referência (job antigo e contato sem registro), deixa a Meta
  // decidir, como era antes.
  const opened = Math.max(started ?? -Infinity, inbound ?? -Infinity);
  if (Number.isFinite(opened) && now.getTime() > opened + MESSAGING_WINDOW_HOURS * MS_PER_HOUR) {
    return { action: "stop", reason: "window_closed" };
  }

  if (input.condition === "NOT_CLICKED" && input.clicked) {
    return { action: "skip", reason: "condition" };
  }
  if (input.condition === "CLICKED" && !input.clicked) {
    return { action: "skip", reason: "condition" };
  }
  return { action: "send" };
}
