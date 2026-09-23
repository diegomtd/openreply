import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getLongLivedToken,
  getUserInfo,
  refreshLongLivedToken,
} from "@/lib/meta/client";

// A pessoa não conseguia conectar conta nenhuma — nem reconectar uma que já
// tinha funcionado antes — e a Meta devolvia "Unsupported request - method
// type: get". A causa era a URL: `getLongLivedToken` e `refreshLongLivedToken`
// prefixavam a versão da API (`/v25.0/access_token`), e esses dois endpoints
// vivem na raiz de `graph.instagram.com`, sem versão — diferente de todo o
// resto do client, que é versionado. Estes testes travam a forma certa de
// cada um, para a diferença não sumir de novo numa refatoração.

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
});

describe("endpoints de token de longa duração — sem versão da API", () => {
  it("troca o token de curta duração na raiz de graph.instagram.com", async () => {
    const fetchMock = mockFetchOnce({
      access_token: "long-lived-token",
      expires_in: 5184000,
    });

    await getLongLivedToken("short-lived-token");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(`${calledUrl.origin}${calledUrl.pathname}`).toBe(
      "https://graph.instagram.com/access_token"
    );
    expect(calledUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
  });

  it("renova o token na raiz de graph.instagram.com, não sob /v.../", async () => {
    const fetchMock = mockFetchOnce({
      access_token: "refreshed-token",
      expires_in: 5184000,
    });

    await refreshLongLivedToken("long-lived-token");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(`${calledUrl.origin}${calledUrl.pathname}`).toBe(
      "https://graph.instagram.com/refresh_access_token"
    );
    expect(calledUrl.pathname).not.toMatch(/^\/v\d/);
  });
});

describe("os outros endpoints continuam versionados", () => {
  it("getUserInfo usa /{versão}/me, ao contrário dos dois de cima", async () => {
    const fetchMock = mockFetchOnce({
      id: "123",
      user_id: "456",
      username: "conta",
    });

    await getUserInfo("access-token");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.hostname).toBe("graph.instagram.com");
    expect(calledUrl.pathname).toMatch(/^\/v\d+(\.\d+)?\/me$/);
  });
});
