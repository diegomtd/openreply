import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import { findDeadAccounts } from "@/lib/meta/account-health";
import { normalizarAparencia } from "@/lib/tema";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const workspace = await ensureWorkspaceForUser(
    session.user.id,
    session.user.email
  );
  // As duas em paralelo: são independentes, e esta VPS não ganha nada
  // esperando uma para começar a outra.
  const [accounts, deadAccounts] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { connectedAt: "desc" },
      select: { id: true, username: true, tokenInvalidAt: true },
    }),
    findDeadAccounts(workspace.id),
  ]);

  return (
    <DashboardShell
      workspaceName={workspace.name}
      aparencia={normalizarAparencia(workspace)}
      accounts={accounts.map((account) => ({
        id: account.id,
        username: account.username,
        ok: account.tokenInvalidAt === null,
      }))}
      deadAccounts={deadAccounts.map((account) => ({
        ...account,
        tokenInvalidAt: account.tokenInvalidAt.toISOString(),
      }))}
    >
      {children}
    </DashboardShell>
  );
}
