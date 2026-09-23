import { describe, it, expect } from "vitest";
import { humanizeApiError } from "@/lib/ui/api-error";

describe("humanizeApiError", () => {
  it("reconhece a mensagem exata que a Meta mandou em produção", () => {
    const raw =
      "Meta API Error 190: Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.";

    const friendly = humanizeApiError(raw);

    expect(friendly.title).toContain("desconectada");
    // O ponto todo: a tela precisa oferecer a acao que resolve.
    expect(friendly.action?.href).toBe("/api/instagram/connect");
  });

  it("reconhece o token morto por outras formulações da Meta", () => {
    for (const raw of [
      "Error validating access token",
      "The session has been invalidated",
      "Meta API Error 190: something",
      "The access token has expired",
    ]) {
      expect(humanizeApiError(raw).action?.href).toBe("/api/instagram/connect");
    }
  });

  it("não manda reconectar por causa de rate limit", () => {
    // Rate limit passa sozinho; pedir reconexao aqui seria mandar a pessoa
    // refazer login a toa.
    const friendly = humanizeApiError("Meta API Error 368: too many calls");

    expect(friendly.action).toBeUndefined();
    expect(friendly.detail).toContain("passa sozinho");
  });

  it("oferece conectar quando não há conta nenhuma", () => {
    const friendly = humanizeApiError("No Instagram account connected");

    expect(friendly.action?.href).toBe("/api/instagram/connect");
    expect(friendly.title).toContain("Nenhuma conta");
  });

  it("preserva um erro desconhecido em vez de escondê-lo", () => {
    const friendly = humanizeApiError("ECONNREFUSED 127.0.0.1:5432");

    expect(friendly.detail).toBe("ECONNREFUSED 127.0.0.1:5432");
    expect(friendly.action).toBeUndefined();
  });

  it("não quebra sem erro nenhum", () => {
    expect(humanizeApiError(null).detail).toBeTruthy();
    expect(humanizeApiError(undefined).detail).toBeTruthy();
    expect(humanizeApiError("").detail).toBeTruthy();
  });
});
