import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockSendEmail } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/email/send", () => ({ sendEmail: mockSendEmail }));

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
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    id: "iga_1",
    username: "odiegoalves_",
    workspace: { owner: { email: "dono@exemplo.com" } },
  });
  mockSendEmail.mockResolvedValue({ sent: true });
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

describe("aviso por e-mail", () => {
  it("avisa o dono quando a conta cai", async () => {
    await markTokenInvalid("iga_1", "session invalidated");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const message = mockSendEmail.mock.calls[0][0];
    expect(message.to).toBe("dono@exemplo.com");
    expect(message.subject).toContain("odiegoalves_");
    // Precisa dizer o que fazer, nao so que quebrou.
    expect(message.text).toContain("/settings");
    expect(message.text).toContain("session invalidated");
  });

  it("não manda e-mail quando a conta já estava marcada", async () => {
    // Esta e a garantia que importa: o incidente real foram DEZENAS de falhas
    // em meia hora. Sem isto, teriam virado dezenas de e-mails.
    mockPrisma.instagramAccount.updateMany.mockResolvedValue({ count: 0 });

    await markTokenInvalid("iga_1", "session invalidated");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("não deixa uma falha de e-mail virar um segundo problema", async () => {
    // Quem chama isto esta no meio de tratar um problema. Falhar ao AVISAR nao
    // pode derrubar o worker: o aviso na tela nao depende do e-mail.
    mockSendEmail.mockRejectedValue(new Error("resend fora do ar"));

    await expect(
      markTokenInvalid("iga_1", "session invalidated")
    ).resolves.toBeUndefined();
  });

  it("não tenta enviar quando não há dono com e-mail", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      id: "iga_1",
      username: "conta",
      workspace: { owner: { email: null } },
    });

    await markTokenInvalid("iga_1", "session invalidated");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("avisa também quando a marcação vem pelo IGSID do webhook", async () => {
    await markTokenInvalidByInstagramId("178414", "session invalidated");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});
