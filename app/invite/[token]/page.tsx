import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export const metadata: Metadata = {
  title: "Aceitar convite — OpenReply",
  robots: { index: false, follow: false },
};

/** Papéis do workspace com nome legível. */
const roleLabels: Record<string, string> = {
  OWNER: "dono",
  ADMIN: "administrador",
  MEMBER: "membro",
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
        <Link href="/" className="mb-8 text-sm font-bold text-cyan-100">
          OpenReply
        </Link>
        <section className="border border-white/10 bg-white/[0.035] p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
            Convite
          </p>
          <h1 className="mt-4 text-3xl font-black leading-tight text-white">
            Entrar em {invitation.workspace.name}
          </h1>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            Você foi convidado como {roleLabels[invitation.role] ?? invitation.role}{" "}
            no e-mail {invitation.email}.
          </p>
          <div className="mt-8">
            {expired ? (
              <p className="text-sm text-error">
                Este convite expirou. Peça para o dono do workspace enviar de
                novo.
              </p>
            ) : (
              <InvitationAcceptCard
                token={token}
                isSignedIn={Boolean(session?.user?.id)}
                invitedEmail={invitation.email}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

