import { beforeEach, describe, expect, it, vi } from "vitest";

// A API de agentes deixa um agente de IA (o Netuno) ler e responder pelas
// contas conectadas. Estes testes travam as duas coisas que não podem quebrar:
// a chave e a regra de nunca mandar DM fria.

const { mockPrisma, meta } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    contact: { findUnique: vi.fn(), findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    followerSnapshot: { findMany: vi.fn() },
  },
  meta: {
    sendDirectMessage: vi.fn(),
    sendCommentReply: vi.fn(),
    sendPrivateReply: vi.fn(),
    setCommentHidden: vi.fn(),
    getAllUserMedia: vi.fn(),
    getRecentMediaComments: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/meta/client", () => {
  class MetaApiError extends Error {
    constructor(public code: number, message = "meta") {
      super(message);
    }
  }
  return {
    MetaApiError,
    TokenExpiredError: class extends MetaApiError {},
    PermissionError: class extends MetaApiError {},
    getConversations: vi.fn(),
    getConversationMessages: vi.fn(),
    getFollowerCountSeries: vi.fn(),
    getMediaInsights: vi.fn(),
    getUserInfo: vi.fn(),
    ...meta,
  };
});

import { checkAgentAuth } from "@/lib/agent/auth";
import { handleAgentRequest } from "@/lib/agent/router";

const TOKEN = "x".repeat(40);
const account = {
  id: "acc1",
  instagramId: "ig-owner",
  username: "i_mdiego",
  accessToken: "enc",
  tokenInvalidAt: null,
  tokenInvalidReason: null,
};

function req(method: string, path: string, body?: unknown, query = "") {
  return handleAgentRequest({
    method,
    path: path.split("/").filter(Boolean),
    query: new URLSearchParams(query),
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
});

describe("checkAgentAuth", () => {
  it("fica desligada sem chave configurada, nunca aberta", () => {
    expect(checkAgentAuth(`Bearer ${TOKEN}`, undefined)).toMatchObject({ ok: false, status: 503 });
  });

  it("recusa chave curta configurada", () => {
    expect(checkAgentAuth("Bearer abc", "abc")).toMatchObject({ ok: false, status: 503 });
  });

  it("recusa header ausente ou chave errada", () => {
    expect(checkAgentAuth(null, TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(checkAgentAuth(`Bearer ${"y".repeat(40)}`, TOKEN)).toMatchObject({ ok: false, status: 401 });
  });

  it("aceita a chave certa", () => {
    expect(checkAgentAuth(`Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true });
  });
});

describe("POST accounts/:id/messages — sem DM fria", () => {
  it("recusa quem nunca escreveu", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null);
    const res = await req("POST", "accounts/i_mdiego/messages", { recipientId: "u1", text: "oi" });
    expect(res.status).toBe(409);
    expect(meta.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("recusa janela de 24h fechada", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      lastInboundAt: new Date(Date.now() - 25 * 3_600_000),
      optedOut: false,
    });
    const res = await req("POST", "accounts/i_mdiego/messages", { recipientId: "u1", text: "oi" });
    expect(res.status).toBe(409);
    expect(meta.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("recusa quem pediu para parar", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      lastInboundAt: new Date(),
      optedOut: true,
    });
    const res = await req("POST", "accounts/i_mdiego/messages", { recipientId: "u1", text: "oi" });
    expect(res.status).toBe(409);
    expect(meta.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("envia dentro da janela", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      lastInboundAt: new Date(Date.now() - 3_600_000),
      optedOut: false,
    });
    meta.sendDirectMessage.mockResolvedValue({ recipient_id: "u1", message_id: "m1" });
    const res = await req("POST", "accounts/i_mdiego/messages", { recipientId: "u1", text: "oi" });
    expect(res.status).toBe(200);
    expect(meta.sendDirectMessage).toHaveBeenCalledWith("token", "ig-owner", "u1", "oi");
  });
});

describe("comentários", () => {
  it("responde em público", async () => {
    meta.sendCommentReply.mockResolvedValue({ id: "r1" });
    const res = await req("POST", "accounts/acc1/comments/c1/reply", { message: "valeu!" });
    expect(res).toEqual({ status: 200, body: { replied: true, id: "r1" } });
  });

  it("oculta por padrão e permite desocultar", async () => {
    meta.setCommentHidden.mockResolvedValue({ success: true });
    await req("POST", "accounts/acc1/comments/c1/hide", {});
    await req("POST", "accounts/acc1/comments/c1/hide", { hidden: false });
    expect(meta.setCommentHidden.mock.calls).toEqual([
      ["token", "c1", true],
      ["token", "c1", false],
    ]);
  });

  it("lista só os não respondidos e ignora comentários do dono", async () => {
    meta.getAllUserMedia.mockResolvedValue([
      { id: "m1", comments_count: 3, timestamp: "2026-10-17T00:00:00Z", media_type: "VIDEO" },
    ]);
    meta.getRecentMediaComments.mockResolvedValue([
      { id: "c1", text: "quanto custa?", from: { id: "u1" }, timestamp: "2026-10-17T10:00:00Z" },
      {
        id: "c2",
        text: "top",
        from: { id: "u2" },
        timestamp: "2026-10-17T09:00:00Z",
        replies: { data: [{ id: "r", from: { id: "ig-owner" } }] },
      },
      { id: "c3", text: "eu mesmo", from: { id: "ig-owner" }, timestamp: "2026-10-17T08:00:00Z" },
    ]);
    const res = await req("GET", "accounts/acc1/comments", undefined, "unanswered=1");
    const body = res.body as { comments: { id: string }[] };
    expect(body.comments.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("contas", () => {
  it("recusa conta com token inválido", async () => {
    mockPrisma.instagramAccount.findFirst.mockResolvedValue({
      ...account,
      tokenInvalidAt: new Date(),
      tokenInvalidReason: "senha trocada",
    });
    const res = await req("GET", "accounts/acc1/media");
    expect(res.status).toBe(409);
  });

  it("404 para conta desconhecida e rota desconhecida", async () => {
    mockPrisma.instagramAccount.findFirst.mockResolvedValue(null);
    expect((await req("GET", "accounts/nada/media")).status).toBe(404);
    expect((await req("GET", "qualquer")).status).toBe(404);
  });
});
