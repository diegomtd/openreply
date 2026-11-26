import { beforeEach, describe, expect, it, vi } from "vitest";

// Publicar Reel pela API de agentes (15/11). Trava: sem OPENREPLY_AGENT_CAN_PUBLISH=1
// nada vai ao ar; só publica contêiner FINISHED; legenda dentro das regras da Meta.

const { mockPrisma, meta } = vi.hoisted(() => ({
  mockPrisma: { instagramAccount: { findMany: vi.fn(), findFirst: vi.fn() } },
  meta: {
    createReelContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    publishContainer: vi.fn(),
    getMediaPermalink: vi.fn(),
    getPublishingLimit: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/meta/client", () => {
  class MetaApiError extends Error {
    constructor(public code: number, message = "meta") { super(message); }
  }
  return {
    MetaApiError,
    TokenExpiredError: class extends MetaApiError {},
    PermissionError: class extends MetaApiError {},
    isInstagramHandle: () => true,
    ...meta,
  };
});

import { captionProblem, handleAgentRequest } from "@/lib/agent/router";

const account = { id: "acc1", instagramId: "1789", username: "i_mdiego", accessToken: "enc", tokenInvalidAt: null, tokenInvalidReason: null };
const req = (method: string, path: string, body?: unknown) =>
  handleAgentRequest({ method, path: path.split("/").filter(Boolean), query: new URLSearchParams(), body });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
});

describe("POST accounts/:c/publish", () => {
  it("fica desligado sem OPENREPLY_AGENT_CAN_PUBLISH=1", async () => {
    const r = await req("POST", "accounts/i_mdiego/publish", { videoUrl: "https://firma.oceanoazul.tech/baixar/x.mp4", caption: "oi" });
    expect(r.status).toBe(403);
    expect(meta.createReelContainer).not.toHaveBeenCalled();
  });

  it("cria o contêiner REELS com o link público e a legenda", async () => {
    vi.stubEnv("OPENREPLY_AGENT_CAN_PUBLISH", "1");
    meta.createReelContainer.mockResolvedValue({ id: "17900000001" });
    const r = await req("POST", "accounts/i_mdiego/publish", { videoUrl: "https://firma.oceanoazul.tech/baixar/x.mp4", caption: "Legenda #ia" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ containerId: "17900000001", status: "IN_PROGRESS" });
    expect(meta.createReelContainer).toHaveBeenCalledWith("token", "1789", expect.objectContaining({ videoUrl: "https://firma.oceanoazul.tech/baixar/x.mp4", caption: "Legenda #ia", shareToFeed: true }));
  });

  it("Reel de teste passa a estratégia de graduação e recusa valor inventado", async () => {
    vi.stubEnv("OPENREPLY_AGENT_CAN_PUBLISH", "1");
    meta.createReelContainer.mockResolvedValue({ id: "17900000002" });
    const r = await req("POST", "accounts/i_mdiego/publish", { videoUrl: "https://x.com/a.mp4", caption: "c", trial: "MANUAL" });
    expect(r.status).toBe(200);
    expect(meta.createReelContainer).toHaveBeenCalledWith("token", "1789", expect.objectContaining({ trial: "MANUAL" }));
    expect((await req("POST", "accounts/i_mdiego/publish", { videoUrl: "https://x.com/a.mp4", trial: "SEMPRE" })).status).toBe(400);
  });

  it("recusa link sem https e legenda com hashtag demais", async () => {
    vi.stubEnv("OPENREPLY_AGENT_CAN_PUBLISH", "1");
    expect((await req("POST", "accounts/i_mdiego/publish", { videoUrl: "http://x.com/a.mp4" })).status).toBe(400);
    const muitas = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect((await req("POST", "accounts/i_mdiego/publish", { videoUrl: "https://x.com/a.mp4", caption: muitas })).status).toBe(400);
    expect(meta.createReelContainer).not.toHaveBeenCalled();
  });
});

describe("status e publicação", () => {
  it("devolve o status do contêiner", async () => {
    meta.getContainerStatus.mockResolvedValue({ id: "17900000001", status_code: "IN_PROGRESS" });
    const r = await req("GET", "accounts/i_mdiego/publish/17900000001");
    expect(r.body).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("só publica contêiner FINISHED", async () => {
    vi.stubEnv("OPENREPLY_AGENT_CAN_PUBLISH", "1");
    meta.getContainerStatus.mockResolvedValue({ id: "17900000001", status_code: "IN_PROGRESS" });
    const r = await req("POST", "accounts/i_mdiego/publish/17900000001/go", {});
    expect(r.status).toBe(409);
    expect(meta.publishContainer).not.toHaveBeenCalled();
  });

  it("publica e devolve o link do post", async () => {
    vi.stubEnv("OPENREPLY_AGENT_CAN_PUBLISH", "1");
    meta.getContainerStatus.mockResolvedValue({ id: "17900000001", status_code: "FINISHED" });
    meta.publishContainer.mockResolvedValue({ id: "18000000009" });
    meta.getMediaPermalink.mockResolvedValue({ id: "18000000009", permalink: "https://www.instagram.com/reel/abc/" });
    const r = await req("POST", "accounts/i_mdiego/publish/17900000001/go", {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mediaId: "18000000009", permalink: "https://www.instagram.com/reel/abc/" });
    expect(meta.publishContainer).toHaveBeenCalledWith("token", "1789", "17900000001");
  });

  it("recusa id de contêiner estranho", async () => {
    expect((await req("GET", "accounts/i_mdiego/publish/abc")).status).toBe(400);
  });
});

describe("captionProblem", () => {
  it("aceita legenda normal", () => expect(captionProblem("Oi #ia @fulano")).toBeNull());
});
