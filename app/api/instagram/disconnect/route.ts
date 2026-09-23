import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * O que uma desconexão levaria junto.
 *
 * Desconectar não é pausar: `InstagramAccount` é a âncora das automações, e o
 * `onDelete: Cascade` do schema apaga automações, registros de DM, contatos e
 * cliques daquela conta. A tela precisa dizer isso com número antes de
 * perguntar, senão a pessoa confirma achando que só está tirando o token.
 *
 * Uma consulta por clique no botão, não por carregamento de tela.
 */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const instagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  if (!instagramAccountId) {
    return NextResponse.json(
      { success: false, error: "Missing instagramAccountId" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: instagramAccountId, workspaceId: context.workspaceId },
    select: {
      username: true,
      _count: { select: { automations: true, contacts: true, dmLogs: true } },
    },
  });

  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta não encontrada" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      username: account.username,
      automations: account._count.automations,
      contacts: account._count.contacts,
      dmLogs: account._count.dmLogs,
    },
  });
}

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
      { success: false, error: "Only owners and admins can disconnect accounts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body.instagramAccountId === "string" ? body.instagramAccountId : null;

  await prisma.instagramAccount.deleteMany({
    where: {
      workspaceId: context.workspaceId,
      ...(instagramAccountId ? { id: instagramAccountId } : {}),
    },
  });

  return NextResponse.json({ success: true });
}
