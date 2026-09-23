import { describe, it, expect } from "vitest";
import {
  audienceWhere,
  expiringSoonWhere,
  ignoringWindowWhere,
  cleanTags,
} from "@/lib/broadcast/audience";
import { windowCutoff, expiringSoonCutoff } from "@/lib/broadcast/window";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const BASE = { instagramAccountId: "iga_1" };

describe("audienceWhere", () => {
  it("sempre recorta pela janela de 24h", () => {
    // A regra da Meta não é uma opção da tela: se este filtro sumir, o app
    // manda DM para fora da janela e a conta entra em risco.
    const where = audienceWhere("w1", BASE, NOW);

    expect(where.lastInboundAt).toEqual({ gte: windowCutoff(NOW) });
  });

  it("sempre exclui quem pediu para parar", () => {
    expect(audienceWhere("w1", BASE, NOW).optedOut).toBe(false);
  });

  it("escopa por workspace e por conta", () => {
    const where = audienceWhere("w1", BASE, NOW);

    expect(where.workspaceId).toBe("w1");
    expect(where.instagramAccountId).toBe("iga_1");
  });

  it("exige todas as tags pedidas, não qualquer uma", () => {
    // hasEvery e não hasSome: "cliente E vip" é um recorte muito menor que
    // "cliente OU vip", e mandar para o segundo achando que é o primeiro é um
    // envio irreversível para a lista errada.
    const where = audienceWhere("w1", { ...BASE, tags: ["cliente", "vip"] }, NOW);

    expect(where.tags).toEqual({ hasEvery: ["cliente", "vip"] });
  });

  it("exclui quem tem qualquer uma das tags bloqueadas", () => {
    const where = audienceWhere("w1", { ...BASE, excludedTags: ["ja_comprou"] }, NOW);

    expect(where.NOT).toEqual({ tags: { hasSome: ["ja_comprou"] } });
  });

  it("normaliza tag dos dois lados do filtro", () => {
    const where = audienceWhere(
      "w1",
      { ...BASE, tags: [" Cliente ", "VIP"], excludedTags: ["  Bloqueado"] },
      NOW
    );

    expect(where.tags).toEqual({ hasEvery: ["cliente", "vip"] });
    expect(where.NOT).toEqual({ tags: { hasSome: ["bloqueado"] } });
  });

  it("ignora tag vazia em vez de filtrar por string vazia", () => {
    const where = audienceWhere("w1", { ...BASE, tags: ["", "  "] }, NOW);

    expect(where.tags).toBeUndefined();
  });

  it("filtra pela automação de origem quando pedido", () => {
    const where = audienceWhere("w1", { ...BASE, sourceAutomationId: "a1" }, NOW);

    expect(where.sourceAutomationId).toBe("a1");
  });

  it("não filtra por origem quando nenhuma é escolhida", () => {
    expect(audienceWhere("w1", { ...BASE, sourceAutomationId: null }, NOW).sourceAutomationId)
      .toBeUndefined();
  });
});

describe("expiringSoonWhere", () => {
  it("é o mesmo recorte, limitado a quem está saindo", () => {
    const where = expiringSoonWhere("w1", { ...BASE, tags: ["cliente"] }, NOW);

    expect(where.optedOut).toBe(false);
    expect(where.tags).toEqual({ hasEvery: ["cliente"] });
    expect(where.lastInboundAt).toEqual({
      gte: windowCutoff(NOW),
      lte: expiringSoonCutoff(NOW),
    });
  });
});

describe("ignoringWindowWhere", () => {
  it("solta a janela mas mantém todo o resto", () => {
    // Serve só para a tela poder dizer "231 no filtro, 47 alcançáveis agora".
    // Se soltasse o opt-out junto, o número contaria gente que pediu para parar.
    const where = ignoringWindowWhere("w1", { ...BASE, tags: ["cliente"] });

    expect(where.lastInboundAt).toBeUndefined();
    expect(where.optedOut).toBe(false);
    expect(where.tags).toEqual({ hasEvery: ["cliente"] });
    expect(where.workspaceId).toBe("w1");
  });
});

describe("cleanTags", () => {
  it("normaliza, tira vazios e remove repetidas", () => {
    expect(cleanTags([" Cliente ", "cliente", "", "VIP"])).toEqual([
      "cliente",
      "vip",
    ]);
  });

  it("aceita ausência de tags", () => {
    expect(cleanTags(undefined)).toEqual([]);
  });
});
