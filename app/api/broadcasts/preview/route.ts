/**
 * Prévia da audiência de um Envio ativo.
 *
 * Responde três números, e os três importam:
 *
 * - `reachable`: quem dá para alcançar agora (dentro da janela de 24h).
 * - `expiringSoon`: destes, quantos saem da janela nas próximas horas.
 * - `total`: quantos casariam com o filtro se a janela não existisse.
 *
 * O `total` existe para a tela poder explicar a diferença em vez de mostrar um
 * número pequeno e parecer quebrada. "231 no filtro, 47 alcançáveis agora" é a
 * regra da Meta ficando visível; só o 47 seria um mistério.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  audienceWhere,
  expiringSoonWhere,
  ignoringWindowWhere,
  type AudienceFilters,
} from "@/lib/broadcast/audience";
import { EXPIRING_SOON_HOURS } from "@/lib/broadcast/window";

const filtersSchema = z.object({
  instagramAccountId: z.string().min(1),
  tags: z.array(z.string()).max(20).optional(),
  excludedTags: z.array(z.string()).max(20).optional(),
  sourceAutomationId: z.string().nullish(),
});

/** Quantas linhas de exemplo voltam junto. Só para a tela mostrar quem é. */
const SAMPLE_SIZE = 8;

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Corpo inválido" },
      { status: 400 }
    );
  }

  const parsed = filtersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Filtro inválido" },
      { status: 400 }
    );
  }

  const filters: AudienceFilters = parsed.data;

  // Uma conta de outro workspace não pode ser alvo. O `where` já é escopado por
  // workspaceId, mas checar aqui devolve 404 em vez de uma audiência vazia
  // silenciosa, que pareceria "ninguém alcançável".
  const account = await prisma.instagramAccount.findFirst({
    where: { id: filters.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta não encontrada" },
      { status: 404 }
    );
  }

  // Um relógio só para os três recortes: com `new Date()` em cada query, um
  // envio na virada de segundo poderia contar alguém em dois baldes.
  const now = new Date();

  const [reachable, expiringSoon, total, sample] = await Promise.all([
    prisma.contact.count({
      where: audienceWhere(context.workspaceId, filters, now),
    }),
    prisma.contact.count({
      where: expiringSoonWhere(context.workspaceId, filters, now),
    }),
    prisma.contact.count({
      where: ignoringWindowWhere(context.workspaceId, filters),
    }),
    prisma.contact.findMany({
      where: audienceWhere(context.workspaceId, filters, now),
      // Quem está saindo primeiro aparece primeiro: é quem a decisão afeta.
      orderBy: { lastInboundAt: "asc" },
      take: SAMPLE_SIZE,
      select: {
        id: true,
        igsid: true,
        username: true,
        lastInboundAt: true,
        tags: true,
      },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      reachable,
      expiringSoon,
      total,
      /** Quantos o filtro pega mas a janela já fechou. */
      outOfWindow: Math.max(0, total - reachable),
      expiringSoonHours: EXPIRING_SOON_HOURS,
      sample,
      computedAt: now.toISOString(),
    },
  });
}
