import { describe, it, expect, vi, afterEach } from "vitest";
import { createReelContainer } from "@/lib/meta/client";

// 17/11: Reel saiu com 1 e 5 segundos porque a Meta baixava só o começo do vídeo do servidor lento.
describe("createReelContainer resumível", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENREPLY_PUBLISH_RESUMABLE; });

  it("baixa o vídeo inteiro e manda os bytes com file_size", async () => {
    process.env.OPENREPLY_PUBLISH_RESUMABLE = "1";
    const video = new Uint8Array(1234).fill(7);
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://firma")) return new Response(video, { status: 200, headers: { "content-length": "1234" } });
      if (url.includes("/media")) return new Response(JSON.stringify({ id: "1790001", uri: "https://rupload.facebook.com/ig-api-upload/v23.0/1790001" }), { status: 200 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const r = await createReelContainer("tok", "1789", { videoUrl: "https://firma.oceanoazul.tech/baixar/x.mp4", caption: "c", shareToFeed: true });
    expect(r.id).toBe("1790001");
    const criar = JSON.parse(String(calls[1].init?.body));
    expect(criar.upload_type).toBe("resumable");
    expect(criar.video_url).toBeUndefined();
    const q = new URL(calls[1].url).searchParams;
    expect(q.get("upload_type")).toBe("resumable");
    expect(q.get("media_type")).toBe("REELS");
    expect(q.get("video_url")).toBeNull();
    const up = calls[2];
    expect(up.url).toBe("https://rupload.facebook.com/ig-api-upload/v23.0/1790001");
    const h = up.init?.headers as Record<string, string>;
    expect(h.file_size).toBe("1234");
    expect(h.offset).toBe("0");
    expect(h.Authorization).toBe("OAuth tok");
  });

  it("vídeo incompleto não cria contêiner", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "999" } }));
    vi.stubGlobal("fetch", f);
    process.env.OPENREPLY_PUBLISH_RESUMABLE = "1";
    await expect(createReelContainer("tok", "1789", { videoUrl: "https://firma/x.mp4", caption: "", shareToFeed: true })).rejects.toThrow(/incompleto/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("padrão (Instagram Login) usa video_url", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ id: "1790002" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await createReelContainer("tok", "1789", { videoUrl: "https://firma/x.mp4", caption: "", shareToFeed: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).video_url).toBe("https://firma/x.mp4");
  });
});
