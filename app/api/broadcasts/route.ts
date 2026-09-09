/**
 * Envios ativos.
 *
 * GET  — histórico de envios, com o resultado de cada um.
 * POST — monta a audiência, grava os destinatários e enfileira o disparo.
 *
 * O envio nunca acontece na requisição: ela só grava e enfileira. Mandar
 * centenas de DMs dentro do handler estouraria o timeout do Next e prenderia
 * uma VPS de um core — e um refresh do navegador no meio disparia tudo de novo.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import {
  BROADCAST_JOB_NAME,
  BROADCAST_SPACING_MS,
  getDMQueue,
} from "@/lib/queue/client";
import { audienceWhere, cleanTags, type AudienceFilters } from "@/lib/broadcast/audience";
import { windowState } from "@/lib/broadcast/window";

/**
 * Teto de destinatários por envio.
 *
 * Não é um limite da Meta — é bom senso operacional: com o espaçamento padrão,
 * 500 pessoas já levam mais de dez minutos de fila. Um número maior que isso
 * quase sempre é engano de filtro, e o erro sai caro porque não dá para
 * "des-enviar" um DM.
 */
const MAX_RECIPIENTS = 500;

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const broadcasts = await prisma.broadcast.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      message: true,
      status: true,
      totalRecipients: true,
      sentCount: true,
      failedCount: true,
      skippedCount: true,
      filterTags: true,
      filterExcludedTags: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      instagramAccount: { select: { username: true } },
      sourceAutomation: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ success: true, data: broadcasts });
}

const createSchema = z.object({
  instagramAccountId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  // 900 é folga sobre o limite prático de um DM de texto; a Meta corta bem
  // antes disso, e uma mensagem maior que isso não é um DM, é um artigo.
  message: z.string().trim().min(1).max(900),
  tags: z.array(z.string()).max(20).optional(),
  excludedTags: z.array(z.string()).max(20).optional(),
  sourceAutomationId: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Disparar mensagem para a audiência inteira não é uma edição comum: é a ação
  // mais irreversível do app.
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Só um dono ou administrador pode disparar um envio" },
      { status: 403 }
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta não encontrada" },
      { status: 404 }
    );
  }

  const filters: AudienceFilters = {
    instagramAccountId: input.instagramAccountId,
    tags: input.tags,
    excludedTags: input.excludedTags,
    sourceAutomationId: input.sourceAutomationId ?? null,
  };

  const now = new Date();
  const audience = await prisma.contact.findMany({
    where: audienceWhere(context.workspaceId, filters, now),
    // Quem está mais perto de sair da janela vai primeiro na fila. Se algo der
    // errado no meio do disparo, quem se perde é quem tinha mais tempo.
    orderBy: { lastInboundAt: "asc" },
    take: MAX_RECIPIENTS,
    select: { id: true, lastInboundAt: true },
  });

  if (audience.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Ninguém está dentro da janela de 24h com esse filtro. No Instagram só dá para enviar para quem te mandou mensagem nas últimas 24 horas.",
      },
      { status: 422 }
    );
  }

  const broadcast = await prisma.$transaction(async (tx) => {
    const created = await tx.broadcast.create({
      data: {
        workspaceId: context.workspaceId,
        instagramAccountId: input.instagramAccountId,
        name: input.name,
        message: input.message,
        status: "SENDING",
        filterTags: cleanTags(input.tags),
        filterExcludedTags: cleanTags(input.excludedTags),
        filterSourceAutomationId: input.sourceAutomationId ?? null,
        totalRecipients: audience.length,
        createdById: context.userId ?? null,
        startedAt: now,
      },
      select: { id: true },
    });

    await tx.broadcastRecipient.createMany({
      data: audience.map((contact) => ({
        broadcastId: created.id,
        contactId: contact.id,
        windowClosesAt: windowState(contact.lastInboundAt, now).closesAt,
      })),
    });

    return created;
  });

  // Os destinatários existem no banco antes de qualquer job entrar na fila: se o
  // Redis estiver fora, o envio fica registrado como pendente em vez de sumir.
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: broadcast.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const queue = getDMQueue();
  await queue.addBulk(
    recipients.map((recipient, index) => ({
      name: BROADCAST_JOB_NAME,
      data: { broadcastId: broadcast.id, recipientId: recipient.id },
      opts: {
        // jobId determinístico: um POST repetido pelo mesmo botão não duplica.
        jobId: `broadcast_${broadcast.id}_${recipient.id}`,
        // O espaçamento é o que mantém a conta longe do rate limit da Meta e a
        // VPS de pé — cada envio entra com um atraso a mais que o anterior.
        delay: index * BROADCAST_SPACING_MS,
      },
    }))
  );

  return NextResponse.json({
    success: true,
    data: {
      id: broadcast.id,
      totalRecipients: audience.length,
      /** Estimativa honesta de quanto tempo a fila leva para escoar. */
      estimatedMinutes: Math.ceil(
        (audience.length * BROADCAST_SPACING_MS) / 60000
      ),
      truncated: audience.length === MAX_RECIPIENTS,
      maxRecipients: MAX_RECIPIENTS,
    },
  });
}
