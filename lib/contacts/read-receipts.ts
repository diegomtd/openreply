/**
 * Recibos de leitura de DM.
 *
 * A Meta não diz "esta mensagem foi lida". Ela manda um **watermark**: "este
 * usuário leu tudo o que você mandou até este instante". Então marcar o que foi
 * lido é uma varredura, não um update pontual: todo envio para aquela pessoa,
 * naquela conta, anterior ao watermark, conta como lido.
 *
 * Isso é o que fecha o funil enviado → lido → clicado. Sem o "lido" não há como
 * separar "o DM não chegou / não foi aberto" de "foi aberto e o link não
 * convenceu" — que são problemas opostos.
 */

import { prisma } from "@/lib/db/client";

export interface ReadReceipt {
  /** IGSID da conta conectada (o `entry.id` do webhook). */
  instagramAccountId: string;
  /** IGSID de quem leu. */
  igsid: string;
  /** Watermark em milissegundos, como a Meta manda. */
  watermark?: number;
}

/**
 * Marca como lidos os envios anteriores ao watermark.
 *
 * Só toca linhas que ainda estão sem `readAt`, então uma pessoa que abre a
 * conversa dez vezes não gera dez escritas. Retorna quantas linhas mudaram.
 */
export async function markDmLogsRead(receipt: ReadReceipt): Promise<number> {
  if (!receipt.watermark) return 0;

  const readAt = new Date(receipt.watermark);
  if (Number.isNaN(readAt.getTime())) return 0;

  // O IGSID da conta chega do webhook; o DmLog guarda o id da linha da conta.
  const account = await prisma.instagramAccount.findUnique({
    where: { instagramId: receipt.instagramAccountId },
    select: { id: true },
  });
  if (!account) return 0;

  const result = await prisma.dmLog.updateMany({
    where: {
      instagramAccountId: account.id,
      commenterId: receipt.igsid,
      status: "SENT",
      readAt: null,
      dmSentAt: { not: null, lte: readAt },
    },
    data: { readAt },
  });

  return result.count;
}
