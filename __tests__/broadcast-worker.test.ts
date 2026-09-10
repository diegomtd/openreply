import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockSendDirectMessage, mockDecryptToken } = vi.hoisted(() => ({
  mockPrisma: {
    broadcastRecipient: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    broadcast: { update: vi.fn(), updateMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn(), updateMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockSendDirectMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  MetaApiError: class MetaApiError extends Error {
    code = 10;
  },
  RateLimitError: class RateLimitError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
  getUserFollowStatus: vi.fn(),
  sendCommentReply: vi.fn(),
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: vi.fn() }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
  BROADCAST_JOB_NAME: "process-broadcast-recipient",
}));
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  return { Worker: MockWorker, Queue: vi.fn() };
});
vi.mock("@/lib/ops/worker-health", () => ({
  recordWorkerAlert: vi.fn(),
  startWorkerHeartbeat: vi.fn(),
}));

import { createDMWorker } from "@/lib/queue/dm-worker";

type Processor = (job: unknown) => Promise<void>;

function processor(): Processor {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as Processor;
}

const JOB = {
  name: "process-broadcast-recipient",
  id: "job_1",
  attemptsMade: 0,
  data: { broadcastId: "bc_1", recipientId: "rcp_1" },
};

/** Um destinatário pendente, com a janela aberta. */
function recipient(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcp_1",
    status: "PENDING",
    broadcast: {
      id: "bc_1",
      status: "SENDING",
      message: "Oi {username}, saiu o novo lote",
      instagramAccount: {
        id: "iga_row",
        instagramId: "178414",
        accessToken: "encrypted",
      },
    },
    contact: {
      id: "ct_1",
      igsid: "maria_igsid",
      username: "Maria",
      optedOut: false,
      // Uma hora atras: bem dentro da janela de 24h.
      lastInboundAt: new Date(Date.now() - 60 * 60 * 1000),
    },
    ...overrides,
  };
}

/**
 * O status com que o destinatario foi finalizado.
 *
 * Lido do `updateMany`, e nao do `update`: a finalizacao e condicionada a linha
 * ainda estar PENDING, para dois jobs do mesmo destinatario nao contarem duas
 * vezes no total do envio.
 */
function finishedStatus(): string | undefined {
  return mockPrisma.broadcastRecipient.updateMany.mock.calls[0]?.[0]?.data?.status;
}

function finishedReason(): string | undefined {
  return mockPrisma.broadcastRecipient.updateMany.mock.calls[0]?.[0]?.data?.reason;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptToken.mockReturnValue("plain-token");
  mockSendDirectMessage.mockResolvedValue({
    recipient_id: "maria_igsid",
    message_id: "mid_1",
  });
  mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(recipient());
  mockPrisma.broadcastRecipient.update.mockResolvedValue({});
  mockPrisma.broadcastRecipient.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.broadcastRecipient.count.mockResolvedValue(0);
  mockPrisma.broadcast.update.mockResolvedValue({});
  mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
});

describe("Envio ativo — um destinatário", () => {
  it("envia para quem está dentro da janela", async () => {
    await processor()(JOB);

    expect(mockSendDirectMessage).toHaveBeenCalledTimes(1);
    const [, instagramId, igsid, text] = mockSendDirectMessage.mock.calls[0];
    expect(instagramId).toBe("178414");
    expect(igsid).toBe("maria_igsid");
    // O nome é interpolado como em qualquer outra mensagem do sistema.
    expect(text).toContain("Maria");
    expect(finishedStatus()).toBe("SENT");
  });

  it("não envia quando a janela fechou entre o disparo e a vez da pessoa", async () => {
    // Este é o ponto do envio espaçado: o último da fila pode chegar horas
    // depois do primeiro, e a Meta recusaria — a checagem tem que ser na hora.
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({
        contact: {
          ...recipient().contact,
          lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        },
      })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("SKIPPED_WINDOW_CLOSED");
  });

  it("não envia para quem nunca mandou mensagem", async () => {
    // Só comentou: nunca houve janela.
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({
        contact: { ...recipient().contact, lastInboundAt: null },
      })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("SKIPPED_WINDOW_CLOSED");
  });

  it("respeita um opt-out feito depois de montar a audiência", async () => {
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({
        contact: { ...recipient().contact, optedOut: true },
      })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("SKIPPED_OPTED_OUT");
  });

  it("não reenvia para um destinatário já resolvido", async () => {
    // Um retry do BullMQ depois de um envio bem-sucedido cai aqui. Reenviar
    // mandaria a mesma mensagem duas vezes para a mesma pessoa.
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({ status: "SENT" })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
  });

  it("para de enviar quando o envio foi cancelado", async () => {
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({
        broadcast: { ...recipient().broadcast, status: "CANCELLED" },
      })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("SKIPPED_CANCELLED");
  });

  it("registra a falha com o motivo em vez de derrubar o envio inteiro", async () => {
    mockSendDirectMessage.mockRejectedValue(new Error("outside of allowed window"));

    await processor()(JOB);

    expect(finishedStatus()).toBe("FAILED");
    expect(finishedReason()).toContain("outside of allowed window");
  });

  it("falha limpo quando o token da conta não abre", async () => {
    mockDecryptToken.mockImplementation(() => {
      throw new Error("bad key");
    });

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("FAILED");
  });

  it("fecha o envio quando não sobra ninguém pendente", async () => {
    mockPrisma.broadcastRecipient.count.mockResolvedValue(0);

    await processor()(JOB);

    expect(mockPrisma.broadcast.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Condicionado a SENDING: dois destinatários terminando juntos chamam
        // isto em paralelo, e sem a condição os dois escreveriam finishedAt.
        where: { id: "bc_1", status: "SENDING" },
        data: expect.objectContaining({ status: "DONE" }),
      })
    );
  });

  it("não fecha o envio enquanto ainda há pendentes", async () => {
    mockPrisma.broadcastRecipient.count.mockResolvedValue(3);

    await processor()(JOB);

    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
  });

  it("marca a conta como desconectada quando a Meta recusa o token", async () => {
    // O incidente real: a Meta invalida a sessao quando a senha do Instagram
    // muda. Sem esta marcacao, os destinatarios seguintes do mesmo disparo
    // batiam num token que ia recusar todos igual, e a interface nao dizia nada.
    const { TokenExpiredError } = await import("@/lib/meta/client");
    mockSendDirectMessage.mockRejectedValue(
      new TokenExpiredError("Error validating access token: session invalidated")
    );

    await processor()(JOB);

    expect(mockPrisma.instagramAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Só grava se ainda não estava marcada: o que interessa é desde quando.
        where: { id: "iga_row", tokenInvalidAt: null },
        data: expect.objectContaining({ tokenInvalidAt: expect.any(Date) }),
      })
    );
    expect(finishedStatus()).toBe("FAILED");
  });

  it("não desconecta a conta por um rate limit", async () => {
    // Rate limit passa sozinho. Marcar a conta aqui pediria uma reconexão que
    // não resolve nada e assustaria à toa.
    const { RateLimitError } = await import("@/lib/meta/client");
    mockSendDirectMessage.mockRejectedValue(new RateLimitError("too many calls"));

    await processor()(JOB);

    expect(mockPrisma.instagramAccount.updateMany).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("FAILED");
  });

  it("não conta duas vezes quando outro job já resolveu o destinatário", async () => {
    // Corrida real: o BullMQ pode redistribuir um job travado. A finalizacao e
    // condicionada a linha ainda estar PENDING, entao a segunda execucao escreve
    // zero linhas — e o total do envio nao pode ser incrementado por ela.
    mockPrisma.broadcastRecipient.updateMany.mockResolvedValue({ count: 0 });

    await processor()(JOB);

    expect(mockPrisma.broadcastRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rcp_1", status: "PENDING" },
      })
    );
    expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
  });

  it("desiste sem chamar a Meta quando a conta já está desconectada", async () => {
    // Um disparo de 500 pessoas com o token morto viraria 500 chamadas que a
    // Meta ja recusou. A conta carrega o estado; o job so precisa lê-lo.
    mockPrisma.broadcastRecipient.findUnique.mockResolvedValue(
      recipient({
        broadcast: {
          ...recipient().broadcast,
          instagramAccount: {
            ...recipient().broadcast.instagramAccount,
            tokenInvalidAt: new Date(),
          },
        },
      })
    );

    await processor()(JOB);

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(finishedStatus()).toBe("FAILED");
    expect(finishedReason()).toContain("desconectada");
  });

  it("ignora um job que aponta para outro envio", async () => {
    await processor()({ ...JOB, data: { broadcastId: "outro", recipientId: "rcp_1" } });

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.broadcastRecipient.update).not.toHaveBeenCalled();
  });
});
