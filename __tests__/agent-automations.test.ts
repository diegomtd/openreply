import { beforeEach, describe, expect, it, vi } from "vitest";

// O agente de Comentários monta a automação de cada post. Estes testes travam o
// que não pode quebrar: nasce desligada, só liga com a chave de ambiente, e não
// rouba palavra-chave de outra automação ativa.

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn(), findMany: vi.fn() },
    automation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));

import { handleAgentRequest } from "@/lib/agent/router";
import { keywordConflicts } from "@/lib/agent/automations";

const account = { id: "acc1", workspaceId: "ws1", instagramId: "ig1", username: "i_mdiego", accessToken: "enc", tokenInvalidAt: null, tokenInvalidReason: null };
const req = (method: string, path: string, body?: unknown) =>
  handleAgentRequest({ method, path: path.split("/"), query: new URLSearchParams(), body });
const row = (over: Record<string, unknown> = {}) => ({
  id: "a1", name: "FIRMA", goal: "Criada pelo agente", postId: "p1", pendingNextReel: false, keywords: ["firma"], isActive: false,
  dmMessage: "oi", publicReplyMessages: [], createdAt: new Date("2026-11-02"), ...over,
});
const valido = { name: "Reel Firma", postId: "p1", keywords: ["firma", "firmahq"], dmMessage: "Te mandei o link 👇", linkUrl: "https://firmahq.oceanoazul.tech/", publicReplies: ["Te chamei no direct!"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockPrisma.automation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data, id: "novo" }));
});

describe("automações pela API de agentes", () => {
  it("cria sempre desligada, marcada como do agente, com link rastreado", async () => {
    const res = await req("POST", "accounts/acc1/automations", valido);
    expect(res.status).toBe(201);
    const data = mockPrisma.automation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ isActive: false, goal: "Criada pelo agente", matchAnyPost: false, matchAnyWord: false, sendFrequency: "ONCE_PER_CONTACT", publicReplyEnabled: true });
    expect(data.trackedLinks.create[0].destinationUrl).toBe("https://firmahq.oceanoazul.tech/");
  });

  it("recusa qualquer-palavra, frequência sempre e post + próximo Reel juntos", async () => {
    expect((await req("POST", "accounts/acc1/automations", { ...valido, keywords: [] })).status).toBe(400);
    expect((await req("POST", "accounts/acc1/automations", { ...valido, sendFrequency: "ALWAYS" })).status).toBe(400);
    expect((await req("POST", "accounts/acc1/automations", { ...valido, pendingNextReel: true })).status).toBe(400);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("recusa palavra-chave que outra automação ativa já usa no mesmo post", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ name: "FIRMA antiga", postId: null, matchAnyPost: true, matchAnyWord: false, keywords: ["FIRMA"] }]);
    const res = await req("POST", "accounts/acc1/automations", valido);
    expect(res.status).toBe(409);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("pausa sempre; liga só com OPENREPLY_AGENT_CAN_ACTIVATE=1", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(row({ isActive: true }));
    mockPrisma.automation.update.mockImplementation(async ({ data }: { data: { isActive: boolean } }) => row(data));
    expect((await req("POST", "accounts/acc1/automations/a1/pause")).status).toBe(200);
    expect((await req("POST", "accounts/acc1/automations/a1/activate")).status).toBe(403);
    vi.stubEnv("OPENREPLY_AGENT_CAN_ACTIVATE", "1");
    expect((await req("POST", "accounts/acc1/automations/a1/activate")).status).toBe(200);
  });

  it("não mexe em automação de outra conta", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(null);
    expect((await req("POST", "accounts/acc1/automations/outra/pause")).status).toBe(404);
  });

  it("conflito ignora outro post e acentos/maiúsculas contam como iguais", () => {
    const ativas = [{ name: "X", postId: "p2", matchAnyPost: false, matchAnyWord: false, keywords: ["firma"] }];
    expect(keywordConflicts(["firma"], "p1", ativas)).toEqual([]);
    expect(keywordConflicts(["FIRMA!"], "p2", ativas)).toHaveLength(1);
  });

  it("funil: passos em ordem, robô sai quando a pessoa responde, gatilho no direct opcional", async () => {
    const steps = [
      { message: "Conseguiu abrir?", delayMinutes: 180, condition: "NOT_CLICKED" },
      { message: "Me conta: tu usaria pra quê?", delayMinutes: 60, condition: "CLICKED" },
    ];
    const res = await req("POST", "accounts/acc1/automations", { ...valido, steps, dmTrigger: true });
    expect(res.status).toBe(201);
    const data = mockPrisma.automation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ stopOnReply: true, dmTriggerEnabled: true, isActive: false });
    expect(data.steps.create).toEqual([
      { order: 1, message: "Conseguiu abrir?", delayMinutes: 180, condition: "NOT_CLICKED" },
      { order: 2, message: "Me conta: tu usaria pra quê?", delayMinutes: 60, condition: "CLICKED" },
    ]);
  });

  it("funil: recusa atrasos que passam de 24 h e mais de 3 passos", async () => {
    const longo = [{ message: "a", delayMinutes: 1000 }, { message: "b", delayMinutes: 500 }];
    expect((await req("POST", "accounts/acc1/automations", { ...valido, steps: longo })).status).toBe(400);
    const muitos = [1, 2, 3, 4].map((n) => ({ message: "m" + n }));
    expect((await req("POST", "accounts/acc1/automations", { ...valido, steps: muitos })).status).toBe(400);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("etiqueta e nota do contato: só formato válido, sem mexer em opt-out", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", tags: ["veio-do-reel", "frio"] });
    mockPrisma.contact.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ igsid: "u1", username: "ana", ...data }));
    const res = await req("POST", "accounts/acc1/contacts/u1/tags", { add: ["Lead-Quente", "com espaço"], remove: ["frio"], note: "  quer pra imobiliária  " });
    expect(res.status).toBe(200);
    const data = mockPrisma.contact.update.mock.calls[0][0].data;
    expect(data).toEqual({ tags: ["veio-do-reel", "lead-quente"], note: "quer pra imobiliária" });
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    expect((await req("POST", "accounts/acc1/contacts/x/tags", { add: ["a"] })).status).toBe(404);
  });
});
