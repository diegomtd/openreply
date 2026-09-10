/**
 * Saúde do token da conta conectada.
 *
 * A Meta responde **erro 190** quando o token não vale mais — e o motivo mais
 * comum não é expiração por data, é a pessoa ter trocado a senha do Instagram
 * ou a Meta ter derrubado a sessão por segurança. Isso acontece do nada, no
 * meio de um dia normal.
 *
 * Antes disto, o app lançava `TokenExpiredError` e não fazia nada com ele: a
 * fila seguia tentando contra um token morto, três vezes por job, com 5, 15 e
 * 45 minutos de espera, e o único sinal era uma lista de alertas no Diagnóstico.
 * O resultado em produção foi meia hora de automações falhando em silêncio
 * enquanto pessoas reais comentavam e não recebiam nada.
 *
 * Agora o estado fica na conta: quem tenta enviar desiste rápido, e a interface
 * inteira mostra o aviso com o botão de reconectar.
 */

import { prisma } from "@/lib/db/client";
import { TokenExpiredError } from "@/lib/meta/client";

/** O erro é a Meta dizendo "este token morreu"? */
export function isTokenDead(error: unknown): boolean {
  return error instanceof TokenExpiredError;
}

/**
 * Marca a conta como desconectada.
 *
 * `updateMany` com `tokenInvalidAt: null` no where: a primeira falha grava o
 * horário, as seguintes não o empurram para frente. O que interessa é **desde
 * quando** está quebrado, não a última vez que alguém tentou.
 */
export async function markTokenInvalid(
  instagramAccountRowId: string,
  reason: string
): Promise<void> {
  await prisma.instagramAccount.updateMany({
    where: { id: instagramAccountRowId, tokenInvalidAt: null },
    data: { tokenInvalidAt: new Date(), tokenInvalidReason: reason.slice(0, 500) },
  });
}

/** Mesma marcação, a partir do IGSID que vem no webhook. */
export async function markTokenInvalidByInstagramId(
  instagramId: string,
  reason: string
): Promise<void> {
  await prisma.instagramAccount.updateMany({
    where: { instagramId, tokenInvalidAt: null },
    data: { tokenInvalidAt: new Date(), tokenInvalidReason: reason.slice(0, 500) },
  });
}

/**
 * Limpa o estado depois de uma reconexão bem-sucedida.
 *
 * Chamado no callback do OAuth: se um token novo entrou, a conta voltou a
 * funcionar, e deixar o aviso na tela seria mentira.
 */
export async function clearTokenInvalid(
  instagramAccountRowId: string
): Promise<void> {
  await prisma.instagramAccount.updateMany({
    where: { id: instagramAccountRowId },
    data: { tokenInvalidAt: null, tokenInvalidReason: null },
  });
}

export interface DeadAccount {
  id: string;
  username: string;
  tokenInvalidAt: Date;
  tokenInvalidReason: string | null;
}

/**
 * As contas mortas de um workspace, para o aviso global.
 *
 * Uma query por carregamento de painel, coberta por índice — barato o bastante
 * para rodar em toda navegação nesta VPS.
 */
export async function findDeadAccounts(
  workspaceId: string
): Promise<DeadAccount[]> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId, tokenInvalidAt: { not: null } },
    orderBy: { tokenInvalidAt: "asc" },
    select: {
      id: true,
      username: true,
      tokenInvalidAt: true,
      tokenInvalidReason: true,
    },
  });

  // O `not: null` já garante isto; o filtro é só para o tipo sair sem null.
  return accounts.flatMap((account) =>
    account.tokenInvalidAt
      ? [{ ...account, tokenInvalidAt: account.tokenInvalidAt }]
      : []
  );
}
