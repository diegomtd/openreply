/**
 * A audiência de um Envio ativo.
 *
 * Uma regra manda em tudo aqui: **só entra quem está dentro da janela de 24h**.
 * Não é uma opção da tela nem um filtro que o usuário possa desligar — é o
 * limite da API do Instagram (ver `lib/broadcast/window.ts`). Uma tela que
 * deixasse escolher "enviar para todos" entregaria uma pilha de
 * `outside of allowed window` e colocaria a conta em risco.
 *
 * Por isso o filtro de janela é montado aqui dentro, junto do workspace, e não
 * recebido de fora.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeTag } from "@/lib/contacts/state";
import { windowCutoff, expiringSoonCutoff } from "@/lib/broadcast/window";

export interface AudienceFilters {
  instagramAccountId: string;
  /** Precisa ter TODAS estas tags. Vazio = sem exigência. */
  tags?: string[];
  /** Não pode ter NENHUMA destas. Vazio = sem exclusão. */
  excludedTags?: string[];
  /** Só quem chegou por esta automação. */
  sourceAutomationId?: string | null;
}

/** Normaliza e joga fora tag vazia, dos dois lados do filtro. */
export function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map(normalizeTag).filter(Boolean))];
}

/**
 * O `where` da audiência.
 *
 * `now` entra por parâmetro para a prévia da tela e o momento do disparo usarem
 * o mesmo relógio — e para o teste não depender da hora em que roda.
 */
export function audienceWhere(
  workspaceId: string,
  filters: AudienceFilters,
  now: Date = new Date()
): Prisma.ContactWhereInput {
  const tags = cleanTags(filters.tags);
  const excludedTags = cleanTags(filters.excludedTags);

  return {
    workspaceId,
    instagramAccountId: filters.instagramAccountId,
    // Quem pediu para parar nunca entra, em nenhuma circunstância.
    optedOut: false,
    // A janela. `gte` porque `lastInboundAt` é quando ela falou: quanto mais
    // recente, mais tempo resta.
    lastInboundAt: { gte: windowCutoff(now) },
    ...(tags.length > 0 ? { tags: { hasEvery: tags } } : {}),
    ...(excludedTags.length > 0 ? { NOT: { tags: { hasSome: excludedTags } } } : {}),
    ...(filters.sourceAutomationId
      ? { sourceAutomationId: filters.sourceAutomationId }
      : {}),
  };
}

/**
 * O mesmo recorte, restrito a quem sai da janela nas próximas horas.
 *
 * É o número que transforma a tela em decisão: essas pessoas só serão
 * alcançadas se o envio sair agora.
 */
export function expiringSoonWhere(
  workspaceId: string,
  filters: AudienceFilters,
  now: Date = new Date()
): Prisma.ContactWhereInput {
  return {
    ...audienceWhere(workspaceId, filters, now),
    lastInboundAt: {
      gte: windowCutoff(now),
      lte: expiringSoonCutoff(now),
    },
  };
}

/**
 * Quantas pessoas o mesmo recorte teria se a janela não existisse.
 *
 * Existe para a tela poder dizer "231 no total, 47 alcançáveis agora" em vez de
 * mostrar só o 47 e parecer que o filtro está quebrado. É a diferença entre a
 * pessoa entender a regra da Meta e achar que o sistema está errado.
 */
export function ignoringWindowWhere(
  workspaceId: string,
  filters: AudienceFilters
): Prisma.ContactWhereInput {
  const where = audienceWhere(workspaceId, filters);
  delete where.lastInboundAt;
  return where;
}
