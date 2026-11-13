import { z } from "zod";
import type { InstagramAccount } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { generateReportShareSlug } from "@/lib/reports/share";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { stripSpecialCharacters } from "@/lib/utils/keyword-matcher";

const normalizeKeyword = (k: string) => stripSpecialCharacters(k).toLowerCase();

/**
 * Automações pela API de agentes: o agente de Comentários monta a automação de
 * cada post aprovado (palavra-chave + variações, respostas públicas, DM com link).
 *
 * Travas, para nenhum agente precisar lembrar delas:
 * - Nasce DESLIGADA. Ligar é outra chamada, que só existe com
 *   OPENREPLY_AGENT_CAN_ACTIVATE=1; sem ela, quem liga é o dono no painel.
 * - Só gatilho de comentário em post (específico ou o próximo Reel). Nada de
 *   "qualquer palavra", "qualquer post", DM ou story: é o que mais vira spam.
 * - Frequência nunca é "sempre"; padrão é uma vez por pessoa.
 * - Recusa palavra-chave que outra automação ativa da conta já usa no mesmo post.
 * - Pausar sempre pode; apagar não existe aqui.
 * - Funil (13/11): até 3 passos depois do link (lembrete p/ quem não clicou,
 *   pergunta p/ quem clicou), soma dos atrasos dentro das 24 h da Meta, e o
 *   robô sai da conversa quando a pessoa responde (stopOnReply, padrão ligado):
 *   é aí que a Firma entra com IA, só para quem mostrou interesse.
 */

const MARCA = "Criada pelo agente";

export const createBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    postId: z.string().trim().min(1).max(64).optional().nullable(),
    pendingNextReel: z.boolean().optional().default(false),
    keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
    wholeWordMatch: z.boolean().optional().default(true),
    dmMessage: z.string().trim().min(1).max(1000),
    linkUrl: z.string().url().max(2000).optional().nullable(),
    linkButtonLabel: z.string().trim().max(20).optional().nullable(),
    publicReplies: z.array(z.string().trim().min(1).max(300)).max(10).optional().default([]),
    requireFollow: z.boolean().optional().default(false),
    followPromptMessage: z.string().trim().max(1000).optional().nullable(),
    followPromptButtonLabel: z.string().trim().max(20).optional().nullable(),
    sendFrequency: z.enum(["ONCE_PER_CONTACT", "ONCE_PER_POST"]).optional().default("ONCE_PER_CONTACT"),
    steps: z
      .array(
        z.object({
          message: z.string().trim().min(1).max(1000),
          delayMinutes: z.number().int().min(0).max(1440).optional().default(0),
          condition: z.enum(["ALWAYS", "NOT_CLICKED", "CLICKED"]).optional().default("ALWAYS"),
        })
      )
      .max(3)
      .optional()
      .default([]),
    stopOnReply: z.boolean().optional().default(true),
    /** Também dispara quando a pessoa manda a palavra-chave no direct (estilo ManyChat). */
    dmTrigger: z.boolean().optional().default(false),
  })
  .refine((d) => d.steps.reduce((t, s) => t + s.delayMinutes, 0) <= 1440, {
    message: "A soma dos atrasos do funil passa de 24h (janela de mensagens do Instagram).",
  })
  .refine((d) => Boolean(d.postId) !== d.pendingNextReel, {
    message: "Informe postId OU pendingNextReel=true (um dos dois).",
  })
  .refine((d) => !d.requireFollow || (d.followPromptMessage && d.followPromptButtonLabel), {
    message: "requireFollow precisa de followPromptMessage e followPromptButtonLabel.",
  });

export type CreateBody = z.infer<typeof createBody>;
type Result = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Result => ({ status, body });
const fail = (status: number, error: string): Result => ({ status, body: { error } });

export function agentCanActivate(env: NodeJS.ProcessEnv = process.env) {
  return env.OPENREPLY_AGENT_CAN_ACTIVATE === "1";
}

function summary(a: {
  id: string; name: string; goal: string | null; postId: string | null; pendingNextReel: boolean; keywords: string[];
  isActive: boolean; dmMessage: string; publicReplyMessages: string[]; createdAt: Date; _count?: { dmLogs: number };
}) {
  return {
    id: a.id,
    name: a.name,
    byAgent: a.goal === MARCA,
    postId: a.postId,
    pendingNextReel: a.pendingNextReel,
    keywords: a.keywords,
    isActive: a.isActive,
    dmMessage: a.dmMessage,
    publicReplies: a.publicReplyMessages,
    createdAt: a.createdAt,
    sent: a._count?.dmLogs ?? null,
  };
}

/** Palavras que já disparam outra automação ativa no mesmo post (ou em qualquer post). */
export function keywordConflicts(
  wanted: string[],
  postId: string | null,
  active: { name: string; postId: string | null; matchAnyPost: boolean; matchAnyWord: boolean; keywords: string[] }[]
) {
  const norm = new Set(wanted.map(normalizeKeyword));
  const out: string[] = [];
  for (const a of active) {
    if (!a.matchAnyPost && postId !== null && a.postId !== postId) continue;
    if (!a.matchAnyPost && postId === null) continue; // próximo Reel ainda não tem post: só "qualquer post" colide
    if (a.matchAnyWord) {
      out.push(`"${a.name}" responde qualquer palavra`);
      continue;
    }
    for (const k of a.keywords) if (norm.has(normalizeKeyword(k))) out.push(`"${k}" já é de "${a.name}"`);
  }
  return out;
}

export async function listAutomations(account: InstagramAccount): Promise<Result> {
  const rows = await prisma.automation.findMany({
    where: { instagramAccountId: account.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { dmLogs: true } } },
  });
  return ok({ account: account.username, canActivate: agentCanActivate(), automations: rows.map(summary) });
}

export async function createAutomation(account: InstagramAccount, body: unknown): Promise<Result> {
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues.map((i) => i.message).join(" "));
  const d = parsed.data;
  const postId = d.pendingNextReel ? null : d.postId ?? null;

  const active = await prisma.automation.findMany({
    where: { instagramAccountId: account.id, isActive: true },
    select: { name: true, postId: true, matchAnyPost: true, matchAnyWord: true, keywords: true },
  });
  const conflicts = keywordConflicts(d.keywords, postId, active);
  if (conflicts.length) return fail(409, `Palavra-chave em uso: ${conflicts.join("; ")}.`);

  const created = await prisma.automation.create({
    data: {
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      name: d.name,
      goal: MARCA,
      postId,
      pendingNextReel: d.pendingNextReel,
      matchAnyPost: false,
      matchAnyWord: false,
      keywords: Array.from(new Set(d.keywords)),
      wholeWordMatch: d.wholeWordMatch,
      dmMessage: d.dmMessage,
      linkButtonLabel: d.linkUrl ? d.linkButtonLabel || null : null,
      requireFollow: d.requireFollow,
      followPromptMessage: d.requireFollow ? d.followPromptMessage ?? null : null,
      followPromptButtonLabel: d.requireFollow ? d.followPromptButtonLabel ?? null : null,
      publicReplyEnabled: d.publicReplies.length > 0,
      publicReplyMessages: d.publicReplies,
      publicReplyMessage: d.publicReplies[0] ?? null,
      sendFrequency: d.sendFrequency,
      stopOnReply: d.stopOnReply,
      dmTriggerEnabled: d.dmTrigger,
      ...(d.steps.length
        ? { steps: { create: d.steps.map((st, i) => ({ order: i + 1, message: st.message, delayMinutes: st.delayMinutes, condition: st.condition })) } }
        : {}),
      isActive: false,
      reportShareSlug: generateReportShareSlug(),
      ...(d.linkUrl
        ? {
            trackedLinks: {
              create: [{ workspaceId: account.workspaceId, slug: generateTrackedLinkSlug(), label: "Primary campaign link", destinationUrl: d.linkUrl }],
            },
          }
        : {}),
    },
  });
  return ok({ automation: summary(created), activateWith: agentCanActivate() ? "activate" : "painel (dono liga)" }, 201);
}

export async function setAutomationActive(account: InstagramAccount, automationId: string, active: boolean): Promise<Result> {
  if (active && !agentCanActivate()) {
    return fail(403, "Agente não liga automação aqui (OPENREPLY_AGENT_CAN_ACTIVATE desligado). O dono liga no painel.");
  }
  const found = await prisma.automation.findFirst({ where: { id: automationId, instagramAccountId: account.id } });
  if (!found) return fail(404, `Automation not found: ${automationId}`);
  if (active) {
    const others = await prisma.automation.findMany({
      where: { instagramAccountId: account.id, isActive: true, id: { not: found.id } },
      select: { name: true, postId: true, matchAnyPost: true, matchAnyWord: true, keywords: true },
    });
    const conflicts = keywordConflicts(found.keywords, found.postId, others);
    if (conflicts.length) return fail(409, `Palavra-chave em uso: ${conflicts.join("; ")}.`);
  }
  const updated = await prisma.automation.update({ where: { id: found.id }, data: { isActive: active } });
  return ok({ automation: summary(updated) });
}
