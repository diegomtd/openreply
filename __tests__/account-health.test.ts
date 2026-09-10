import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { updateMany: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  isTokenDead,
  markTokenInvalid,
  markTokenInvalidByInstagramId,
  clearTokenInvalid,
  findDeadAccounts,
} from "@/lib/meta/account-health";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
});

describe("isTokenDead", () => {
  it("reconhece o erro 190 da Meta", () => {
    // Este é o erro real que derrubou a conta em producao: "The session has
    // been invalidated because the user changed their password or Facebook has
    // changed the session for security reasons."
    expect(isTokenDead(new TokenExpiredError("session invalidated"))).toBe(true);
  });

  it("não confunde rate limit com token morto", () => {
    // Rate limit passa sozinho; token morto so sai com reconexao. Tratar os
    // dois igual desconectaria a conta por um pico de trafego.
    expect(isTokenDead(new RateLimitError("too many calls"))).toBe(false);
  });

  it("não confunde outros erros da Meta com token morto", () => {
    expect(isTokenDead(new MetaApiError(100, undefined, undefined, "bad param"))).toBe(
      false
    );
    expect(isTokenDead(new Error("network"))).toBe(false);
    expect(isTokenDead(null)).toBe(false);
  });
});

describe("markTokenInvalid", () => {
  it("só grava se a conta ainda não estava marcada", async () => {
    // O que interessa é DESDE QUANDO esta quebrado. Se cada falha empurrasse o
    // horario para frente, o aviso diria "ha 1 minuto" para sempre.
    await markTokenInvalid("iga_1", "session invalidated");

    const call = mockPrisma.instagramAccount.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "iga_1", tokenInvalidAt: null });
    expect(call.data.tokenInvalidAt).toBeInstanceOf(Date);
    expect(call.data.tokenInvalidReason).toBe("session invalidated");
  });

  it("corta um motivo gigante em vez de estourar a coluna", async () => {
    await markTokenInvalid("iga_1", "x".repeat(900));

    const call = mockPrisma.instagramAccount.updateMany.mock.calls[0][0];
    expect(call.data.tokenInvalidReason).toHaveLength(500);
  });

  it("também marca a partir do IGSID que vem no webhook", async () => {
    await markTokenInvalidByInstagramId("178414", "session invalidated");

    const call = mockPrisma.instagramAccount.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ instagramId: "178414", tokenInvalidAt: null });
  });
});

describe("clearTokenInvalid", () => {
  it("limpa horário e motivo depois de reconectar", async () => {
    // Sem condicao de estado: reconectou, o aviso sai. Manter o aviso aceso com
    // um token novo funcionando seria o app mentindo sobre si mesmo.
    await clearTokenInvalid("iga_1");

    const call = mockPrisma.instagramAccount.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "iga_1" });
    expect(call.data).toEqual({ tokenInvalidAt: null, tokenInvalidReason: null });
  });
});

describe("findDeadAccounts", () => {
  it("pede só as contas marcadas, mais antiga primeiro", async () => {
    await findDeadAccounts("w1");

    const call = mockPrisma.instagramAccount.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ workspaceId: "w1", tokenInvalidAt: { not: null } });
    expect(call.orderBy).toEqual({ tokenInvalidAt: "asc" });
  });

  it("devolve as contas mortas", async () => {
    const brokenAt = new Date("2026-09-09T20:20:04.000Z");
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      {
        id: "iga_1",
        username: "odiegoalves_",
        tokenInvalidAt: brokenAt,
        tokenInvalidReason: "session invalidated",
      },
    ]);

    const dead = await findDeadAccounts("w1");

    expect(dead).toHaveLength(1);
    expect(dead[0].username).toBe("odiegoalves_");
    expect(dead[0].tokenInvalidAt).toEqual(brokenAt);
  });

  it("não devolve nada quando está tudo saudável", async () => {
    expect(await findDeadAccounts("w1")).toEqual([]);
  });
});
