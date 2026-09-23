import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * Acesso direto: cria (ou reseta a senha de) alguém no workspace com e-mail e
 * senha, sem depender de e-mail nenhum. O convite normal (`/api/workspace/
 * members`) só funciona se a pessoa tiver acesso à própria caixa de entrada
 * pra clicar no link — errado para quem vai entregar a senha por outro canal
 * (WhatsApp, em mão) ou não quer depender de e-mail chegando.
 *
 * A senha sai em texto puro **só nesta resposta**, uma vez. Nada disto é
 * gravado: nem aqui, nem em log — só o hash vai para o banco.
 */

const directAccessSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can create direct access" },
      { status: 403 }
    );
  }

  const parsed = directAccessSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = normalizeInvitationEmail(parsed.data.email);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  // Cada chamada gera e grava uma senha nova — chamar de novo para o mesmo
  // e-mail é, de propósito, como se reseta a senha de alguém que já tinha
  // acesso direto.
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: parsed.data.name,
      passwordHash,
    },
    update: {
      passwordHash,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: context.workspaceId,
        userId: user.id,
      },
    },
    create: {
      workspaceId: context.workspaceId,
      userId: user.id,
      role: parsed.data.role,
    },
    update: {
      role: parsed.data.role,
    },
  });

  return NextResponse.json({
    success: true,
    data: { email, temporaryPassword },
  });
}
