import NextAuth, { type NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { verifyPassword } from "@/lib/auth/password";
import { isLoginAllowed, recordFailedLogin, clearLoginAttempts } from "@/lib/auth/login-rate-limit";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
      from: process.env.EMAIL_FROM ?? "OpenReply <login@example.com>",
    }),
    // Login com e-mail e senha, para quem foi convidado direto (Configurações
    // → Time → "Criar acesso direto") sem depender de receber e clicar num
    // link por e-mail. Continua existindo lado a lado com o link mágico —
    // quem só tem conta pelo link (a maioria) simplesmente não tem senha
    // cadastrada, e este provider sempre recusa nesse caso.
    Credentials({
      id: "credentials",
      name: "Senha",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        // Checado antes de tocar o banco: uma conta sob ataque de força bruta
        // não deve nem gastar a consulta, e menos ainda o scrypt.
        if (!(await isLoginAllowed(email))) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // `verifyPassword` roda o scrypt mesmo quando `passwordHash` é nulo,
        // de propósito — senão o tempo de resposta já entregaria se aquele
        // e-mail tem senha cadastrada, sem precisar acertar senha nenhuma.
        const valid = await verifyPassword(password, user?.passwordHash);

        if (!valid) {
          await recordFailedLogin(email);
          return null;
        }

        await clearLoginAttempts(email);
        return { id: user!.id, email: user!.email, name: user!.name };
      },
    }),
  ],
  callbacks: {
    // Sessão em JWT (ver nota em `session` abaixo): aqui é `token`, não
    // `user` do banco — `token.sub` já vem preenchido com o id retornado por
    // `authorize`/pelo adapter no momento do login.
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  events: {
    // Só dispara para contas criadas pelo adapter (link mágico, OAuth) — uma
    // conta de acesso direto (senha) já nasce com workspace na hora em que é
    // criada em `/api/workspace/members`, então não passa por aqui.
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  // O Credentials provider só funciona com sessão em JWT — é uma restrição
  // do próprio Auth.js, não uma escolha nossa (sessão em banco não tem como
  // saber "de onde" viria a sessão de um login por senha, já que este
  // provider não fala com o adapter). O adapter continua presente e
  // funcionando normal para o link mágico: ele grava User/Account/
  // VerificationToken do mesmo jeito, só a sessão em si passa a viver num
  // cookie assinado em vez de uma linha em `Session`. Não muda nada em quem
  // pode fazer o quê: toda checagem de permissão deste app já relê o cargo
  // do banco a cada requisição (`getCurrentWorkspaceContext`), nunca confia
  // em nada que esteja dentro da sessão além do id do usuário.
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
