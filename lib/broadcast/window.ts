/**
 * A janela de mensagens do Instagram.
 *
 * A Meta só permite enviar para uma pessoa dentro de **24h** contadas a partir
 * da última mensagem que **ela** te mandou. Dentro dessa janela pode ir conteúdo
 * promocional; fora dela não existe caminho automatizado legal no Instagram:
 *
 * - One-Time Notifications: "not available for IG Messaging API"
 * - Sponsored Messages: "not available for IG Messaging API"
 * - As message tags de marketing do Messenger não existem no Instagram, e desde
 *   27/04/2026 CONFIRMED_EVENT_UPDATE / ACCOUNT_UPDATE / POST_PURCHASE_UPDATE
 *   respondem erro 100.
 * - HUMAN_AGENT dá 7 dias, mas é para um humano responder à mão. Usar em envio
 *   automatizado é violação de política e a API bloqueia.
 *
 * Por isso "envio em massa" aqui não é uma lista estática: é uma **audiência
 * rolante**. Quem está alcançável muda a cada hora, e o que abre janela é a
 * pessoa mandar mensagem — DM, resposta a story ou menção em story. Comentário
 * **não** abre janela, e é por isso que `processComment` não mexe em
 * `lastInboundAt`.
 */

/** Janela padrão da Meta, em horas. */
export const MESSAGING_WINDOW_HOURS = 24;

/**
 * Quem está a menos disto do fim é destacado como "saindo".
 *
 * Serve para uma decisão, não para enfeite: são as pessoas que só serão
 * alcançáveis se o envio sair hoje.
 */
export const EXPIRING_SOON_HOURS = 3;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface WindowState {
  /** Dá para enviar para esta pessoa agora? */
  open: boolean;
  /**
   * Horas restantes até a janela fechar. `0` quando já fechou.
   * Fracionário de propósito — a tela arredonda, a decisão não.
   */
  hoursLeft: number;
  /** Aberta, mas por pouco tempo: prioridade de envio. */
  expiringSoon: boolean;
  /** Quando fecha. `null` se a pessoa nunca mandou mensagem. */
  closesAt: Date | null;
}

/**
 * Estado da janela de uma pessoa.
 *
 * `lastInboundAt` nulo significa que ela nunca mandou mensagem — só comentou, ou
 * só recebeu. Nesse caso não há janela nenhuma, e nunca houve.
 */
export function windowState(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date()
): WindowState {
  if (!lastInboundAt) {
    return { open: false, hoursLeft: 0, expiringSoon: false, closesAt: null };
  }

  const closesAt = new Date(
    lastInboundAt.getTime() + MESSAGING_WINDOW_HOURS * MS_PER_HOUR
  );
  const msLeft = closesAt.getTime() - now.getTime();

  if (msLeft <= 0) {
    return { open: false, hoursLeft: 0, expiringSoon: false, closesAt };
  }

  const hoursLeft = msLeft / MS_PER_HOUR;
  return {
    open: true,
    hoursLeft,
    expiringSoon: hoursLeft <= EXPIRING_SOON_HOURS,
    closesAt,
  };
}

/** Atalho para o caminho quente do worker, que só quer o sim ou não. */
export function isWindowOpen(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  return windowState(lastInboundAt, now).open;
}

/**
 * O instante a partir do qual uma pessoa ainda está alcançável.
 *
 * Vira `lastInboundAt: { gte: ... }` na query. Fica aqui para a regra das 24h
 * existir num lugar só — a tela, a prévia e o worker usam o mesmo corte.
 */
export function windowCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - MESSAGING_WINDOW_HOURS * MS_PER_HOUR);
}

/** O corte de quem está saindo da janela, para o contador da tela. */
export function expiringSoonCutoff(now: Date = new Date()): Date {
  return new Date(
    now.getTime() -
      (MESSAGING_WINDOW_HOURS - EXPIRING_SOON_HOURS) * MS_PER_HOUR
  );
}

/**
 * "3h 20min", "45min", "fechada".
 *
 * Texto curto porque aparece dentro de linha de tabela e de selo.
 */
export function formatTimeLeft(state: WindowState): string {
  if (!state.open) return "fechada";

  const totalMinutes = Math.max(1, Math.round(state.hoursLeft * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}
