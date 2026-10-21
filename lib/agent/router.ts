import { z } from "zod";
import type { InstagramAccount } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { windowState } from "@/lib/broadcast/window";
import {
  getAllUserMedia,
  getConversationMessages,
  getConversations,
  getFollowerCountSeries,
  getMediaInsights,
  getRecentMediaComments,
  getUserInfo,
  MetaApiError,
  PermissionError,
  sendCommentReply,
  sendDirectMessage,
  sendPrivateReply,
  setCommentHidden,
  TokenExpiredError,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

/**
 * Roteador da API de agentes. Fica fora do `route.ts` para ser testável sem
 * Next: recebe método, caminho e corpo, devolve status e JSON.
 *
 * Regras que a API garante, para nenhum agente precisar lembrar delas:
 * - DM só para quem tem a janela de 24h aberta (a pessoa falou por último há
 *   menos de 24h) e não pediu para parar. Isso impede DM fria por construção.
 * - Resposta privada só existe como resposta a um comentário da própria pessoa.
 * - Ocultar comentário é reversível; apagar não existe aqui de propósito.
 */

export type AgentRequest = {
  method: string;
  path: string[];
  query: URLSearchParams;
  body: unknown;
};

export type AgentResponse = { status: number; body: unknown };

const ok = (body: unknown): AgentResponse => ({ status: 200, body });
const fail = (status: number, error: string): AgentResponse => ({
  status,
  body: { error },
});

const MAX_MEDIA = 100;
const INSIGHTS_CONCURRENCY = 4;

function intParam(query: URLSearchParams, name: string, fallback: number, max: number) {
  const n = Number.parseInt(query.get(name) ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function isVideoLike(m: InstagramMedia) {
  return (
    m.media_type === "VIDEO" ||
    m.media_product_type === "REELS" ||
    m.media_product_type === "STORY"
  );
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

function accountSummary(a: InstagramAccount) {
  return {
    id: a.id,
    instagramId: a.instagramId,
    username: a.username,
    name: a.name,
    connectedAt: a.connectedAt,
    tokenExpiresAt: a.tokenExpiresAt,
    tokenInvalid: a.tokenInvalidAt !== null,
    tokenInvalidReason: a.tokenInvalidReason,
    webhookSubscribed: a.webhookSubscribed,
  };
}

function workspaceFilter() {
  const workspaceId = process.env.OPENREPLY_AGENT_WORKSPACE_ID;
  return workspaceId ? { workspaceId } : {};
}

/** Aceita o id interno, o id do Instagram ou o @ da conta. */
async function findAccount(ref: string) {
  const handle = ref.replace(/^@/, "");
  return prisma.instagramAccount.findFirst({
    where: {
      ...workspaceFilter(),
      OR: [
        { id: ref },
        { instagramId: ref },
        { username: { equals: handle, mode: "insensitive" } },
      ],
    },
  });
}

const messageBody = z.object({ message: z.string().trim().min(1).max(1000) });
const dmBody = z.object({
  recipientId: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
});
const hideBody = z.object({ hidden: z.boolean().default(true) });

async function listMedia(account: InstagramAccount, token: string, query: URLSearchParams) {
  const limit = intParam(query, "limit", 25, MAX_MEDIA);
  const media = await getAllUserMedia(token, limit);
  const withInsights = query.get("insights") !== "0";
  let permissionDenied = false;

  const insights = withInsights
    ? await mapLimited(media, INSIGHTS_CONCURRENCY, async (m) => {
        const metrics = isVideoLike(m)
          ? ["views", "reach", "saved", "shares", "total_interactions"]
          : ["reach", "saved", "shares", "total_interactions"];
        try {
          return await getMediaInsights(token, m.id, metrics);
        } catch (err) {
          if (err instanceof PermissionError) permissionDenied = true;
          return null;
        }
      })
    : media.map(() => null);

  return ok({
    account: account.username,
    insightsPermissionDenied: permissionDenied,
    media: media.map((m, i) => ({
      id: m.id,
      caption: m.caption ?? null,
      type: m.media_product_type ?? m.media_type,
      permalink: m.permalink ?? null,
      timestamp: m.timestamp,
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      ...(insights[i] ?? {}),
    })),
  });
}

async function listRecentComments(account: InstagramAccount, token: string, query: URLSearchParams) {
  const hours = intParam(query, "hours", 72, 24 * 30);
  const posts = intParam(query, "posts", 10, 50);
  const onlyUnanswered = query.get("unanswered") === "1";
  const sinceMs = Date.now() - hours * 3_600_000;

  const media = (await getAllUserMedia(token, posts)).filter(
    (m) => (m.comments_count ?? 0) > 0
  );
  const perMedia = await mapLimited(media, INSIGHTS_CONCURRENCY, (m) =>
    getRecentMediaComments(token, m.id, sinceMs, 200)
  );

  // Comentário que bate com uma automação ativa é dela: o agente não responde
  // por cima, a não ser que ela tenha falhado (status FAILED).
  const automations = await prisma.automation.findMany({
    where: { instagramAccountId: account.id, isActive: true },
    select: { id: true, name: true, postId: true, matchAnyPost: true, keywords: true, matchAnyWord: true, wholeWordMatch: true },
  });
  const automationFor = (mediaId: string, text: string) => {
    for (const a of automations) {
      if (!a.matchAnyPost && a.postId !== mediaId) continue;
      if (a.matchAnyWord) return { automation: a, keyword: null };
      const hit = matchKeywords(text ?? "", a.keywords, a.wholeWordMatch);
      if (hit.matched) return { automation: a, keyword: hit.matchedKeyword };
    }
    return null;
  };

  const raw = media.flatMap((m, i) =>
    perMedia[i]
      // O próprio dono comentando não é conversa para responder.
      .filter((c) => c.from?.id !== account.instagramId)
      .map((c) => ({ m, c, match: automationFor(m.id, c.text) }))
  );
  const matchedIds = raw.filter((r) => r.match).map((r) => r.c.id);
  const logs = matchedIds.length
    ? await prisma.dmLog.findMany({
        where: { instagramAccountId: account.id, commentId: { in: matchedIds } },
        select: { commentId: true, automationId: true, status: true },
      })
    : [];
  const statusOf = (commentId: string, automationId: string) =>
    logs.find((l) => l.commentId === commentId && l.automationId === automationId)?.status ?? "PENDING";

  const comments = raw.map(({ m, c, match }) => ({
    id: c.id,
    mediaId: m.id,
    permalink: m.permalink ?? null,
    text: c.text,
    from: c.from ?? null,
    timestamp: c.timestamp,
    answered: (c.replies?.data ?? []).some(
      (r) => r.from?.id === account.instagramId
    ),
    automation: match
      ? {
          id: match.automation.id,
          name: match.automation.name,
          keyword: match.keyword,
          status: statusOf(c.id, match.automation.id),
        }
      : null,
  }));

  return ok({
    account: account.username,
    sinceHours: hours,
    comments: (onlyUnanswered ? comments.filter((c) => !c.answered) : comments).sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
    ),
  });
}

async function listConversations(account: InstagramAccount, token: string) {
  const raw = await getConversations(token, account.instagramId);
  const igsids = raw
    .map((c) => c.participants?.data?.find((p) => p.id !== account.instagramId)?.id)
    .filter((id): id is string => Boolean(id));
  const contacts = await prisma.contact.findMany({
    where: { instagramAccountId: account.id, igsid: { in: igsids } },
    select: { igsid: true, lastInboundAt: true, optedOut: true, tags: true },
  });
  const byIgsid = new Map(contacts.map((c) => [c.igsid, c]));

  return ok({
    account: account.username,
    conversations: raw.map((c) => {
      const other = c.participants?.data?.find((p) => p.id !== account.instagramId) ?? null;
      const contact = other ? byIgsid.get(other.id) : undefined;
      const last = c.messages?.data?.[0] ?? null;
      const win = windowState(contact?.lastInboundAt);
      return {
        id: c.id,
        contact: other ? { id: other.id, username: other.username ?? null } : null,
        updatedTime: c.updated_time ?? null,
        lastMessage: last
          ? {
              text: last.message ?? "",
              fromMe: last.from?.id === account.instagramId,
              createdTime: last.created_time ?? null,
            }
          : null,
        canReply: win.open && !contact?.optedOut,
        windowClosesAt: win.closesAt,
        optedOut: contact?.optedOut ?? false,
        tags: contact?.tags ?? [],
      };
    }),
  });
}

async function getThread(account: InstagramAccount, token: string, conversationId: string) {
  const messages = await getConversationMessages(token, conversationId);
  return ok({
    conversationId,
    messages: messages
      .map((m) => ({
        id: m.id,
        text: m.message ?? "",
        fromMe: m.from?.id === account.instagramId,
        from: m.from ?? null,
        createdTime: m.created_time ?? null,
      }))
      .reverse(),
  });
}

async function sendDm(account: InstagramAccount, token: string, body: unknown) {
  const parsed = dmBody.safeParse(body);
  if (!parsed.success) return fail(400, "Body must be { recipientId, text }.");
  const { recipientId, text } = parsed.data;

  const contact = await prisma.contact.findUnique({
    where: {
      instagramAccountId_igsid: { instagramAccountId: account.id, igsid: recipientId },
    },
    select: { lastInboundAt: true, optedOut: true },
  });
  if (contact?.optedOut) return fail(409, "Contact opted out. Not sending.");
  const win = windowState(contact?.lastInboundAt);
  if (!win.open) {
    return fail(
      409,
      "Messaging window closed: the person has not written in the last 24h. Cold DMs are not allowed."
    );
  }

  const sent = await sendDirectMessage(token, account.instagramId, recipientId, text);
  return ok({ sent: true, messageId: sent.message_id, windowClosesAt: win.closesAt });
}

async function commentAction(
  account: InstagramAccount,
  token: string,
  commentId: string,
  action: string,
  body: unknown
) {
  if (action === "hide") {
    const parsed = hideBody.safeParse(body ?? {});
    if (!parsed.success) return fail(400, "Body must be { hidden?: boolean }.");
    await setCommentHidden(token, commentId, parsed.data.hidden);
    return ok({ hidden: parsed.data.hidden });
  }

  const parsed = messageBody.safeParse(body);
  if (!parsed.success) return fail(400, "Body must be { message }.");

  if (action === "reply") {
    const res = await sendCommentReply(token, commentId, parsed.data.message);
    return ok({ replied: true, id: res.id });
  }
  if (action === "private-reply") {
    const res = await sendPrivateReply(token, account.instagramId, commentId, parsed.data.message);
    return ok({ sent: true, messageId: res.message_id });
  }
  return fail(404, `Unknown comment action: ${action}`);
}

async function listContacts(account: InstagramAccount, query: URLSearchParams) {
  const since = query.get("since");
  const sinceDate = since ? new Date(since) : null;
  const contacts = await prisma.contact.findMany({
    where: {
      instagramAccountId: account.id,
      ...(sinceDate && !Number.isNaN(sinceDate.getTime())
        ? { updatedAt: { gte: sinceDate } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: intParam(query, "limit", 100, 500),
    select: {
      igsid: true,
      username: true,
      name: true,
      firstSeenAt: true,
      lastInboundAt: true,
      optedOut: true,
      tags: true,
      note: true,
      updatedAt: true,
    },
  });
  return ok({ account: account.username, contacts });
}

async function accountInsights(account: InstagramAccount, token: string, query: URLSearchParams) {
  const days = intParam(query, "days", 30, 30);
  const [profile, series, snapshots] = await Promise.all([
    getUserInfo(token),
    getFollowerCountSeries(token, account.instagramId, days).catch(() => null),
    prisma.followerSnapshot.findMany({
      where: { instagramAccountId: account.id },
      orderBy: { date: "desc" },
      take: 90,
    }),
  ]);
  return ok({
    account: account.username,
    followers: profile.followers_count ?? null,
    followerDeltas: series,
    snapshots,
  });
}

async function listLogs(query: URLSearchParams) {
  const since = query.get("since");
  const sinceDate = since ? new Date(since) : null;
  const logs = await prisma.dmLog.findMany({
    where: {
      ...workspaceFilter(),
      ...(sinceDate && !Number.isNaN(sinceDate.getTime())
        ? { createdAt: { gte: sinceDate } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: intParam(query, "limit", 100, 500),
    select: {
      id: true,
      instagramAccountId: true,
      automationId: true,
      commenterId: true,
      commenterName: true,
      commentText: true,
      matchedKeyword: true,
      status: true,
      dmSentAt: true,
      readAt: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  return ok({ logs });
}

export async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  const { method, path, query, body } = req;
  const [root, accountRef, resource, id, action] = path;

  try {
    if (method === "GET" && root === "accounts" && path.length === 1) {
      const accounts = await prisma.instagramAccount.findMany({
        where: workspaceFilter(),
        orderBy: { connectedAt: "asc" },
      });
      return ok({ accounts: accounts.map(accountSummary) });
    }

    if (method === "GET" && root === "logs" && path.length === 1) {
      return await listLogs(query);
    }

    if (root !== "accounts" || !accountRef || !resource) {
      return fail(404, "Not found.");
    }

    const account = await findAccount(decodeURIComponent(accountRef));
    if (!account) return fail(404, `Account not found: ${accountRef}`);
    if (account.tokenInvalidAt) {
      return fail(
        409,
        `Instagram token for @${account.username} is invalid (${account.tokenInvalidReason ?? "reconnect the account"}).`
      );
    }

    if (method === "GET" && resource === "contacts" && !id) {
      return await listContacts(account, query);
    }

    const token = decryptToken(account.accessToken);

    if (method === "GET") {
      if (resource === "media" && !id) return await listMedia(account, token, query);
      if (resource === "comments" && !id) return await listRecentComments(account, token, query);
      if (resource === "conversations" && !id) return await listConversations(account, token);
      if (resource === "conversations" && id) return await getThread(account, token, id);
      if (resource === "insights" && !id) return await accountInsights(account, token, query);
    }

    if (method === "POST") {
      if (resource === "messages" && !id) return await sendDm(account, token, body);
      if (resource === "comments" && id && action) {
        return await commentAction(account, token, id, action, body);
      }
    }

    return fail(404, "Not found.");
  } catch (err) {
    if (err instanceof TokenExpiredError) return fail(409, `Instagram token expired: ${err.message}`);
    if (err instanceof MetaApiError) return fail(502, `Meta API error ${err.code}: ${err.message}`);
    console.error("[agent-api]", err);
    return fail(500, "Internal error.");
  }
}
