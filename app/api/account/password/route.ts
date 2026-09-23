import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";

/**
 * A própria pessoa define ou troca a senha da conta — funciona tanto para
 * quem nunca teve senha (só usava o link mágico e quer ganhar um segundo
 * jeito de entrar) quanto para quem já tem uma e quer trocar.
 *
 * Ação pessoal, não de workspace: qualquer usuário autenticado mexe na
 * própria senha, sem checagem de cargo — não é sobre quem administra o quê,
 * é sobre a própria conta.
 */

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input" },
      { status: 400 }
    );
  }

  const strength = checkPasswordStrength(parsed.data.newPassword);
  if (!strength.ok) {
    return NextResponse.json(
      { success: false, error: strength.reason },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  // Só exige a senha atual de quem já tem uma. Quem só usava o link mágico
  // não tem o que confirmar — chegar autenticado já provou dono do e-mail.
  if (user?.passwordHash) {
    const currentValid = await verifyPassword(
      parsed.data.currentPassword ?? "",
      user.passwordHash
    );
    if (!currentValid) {
      return NextResponse.json(
        { success: false, error: "Senha atual incorreta" },
        { status: 403 }
      );
    }
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return NextResponse.json({ success: true });
}
