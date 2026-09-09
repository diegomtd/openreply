import { describe, it, expect } from "vitest";
import {
  MESSAGING_WINDOW_HOURS,
  EXPIRING_SOON_HOURS,
  windowState,
  isWindowOpen,
  windowCutoff,
  expiringSoonCutoff,
  formatTimeLeft,
} from "@/lib/broadcast/window";

const NOW = new Date("2026-09-09T12:00:00.000Z");

/** `hours` atrás de NOW. */
function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe("windowState", () => {
  it("mantém a janela aberta logo depois da mensagem", () => {
    const state = windowState(ago(1), NOW);

    expect(state.open).toBe(true);
    expect(state.hoursLeft).toBeCloseTo(23);
    expect(state.expiringSoon).toBe(false);
    expect(state.closesAt).toEqual(new Date("2026-09-10T11:00:00.000Z"));
  });

  it("fecha depois de 24h", () => {
    const state = windowState(ago(MESSAGING_WINDOW_HOURS + 0.1), NOW);

    expect(state.open).toBe(false);
    expect(state.hoursLeft).toBe(0);
  });

  it("trata exatamente 24h como fechada", () => {
    // O limite tem que cair para o lado seguro: 24h em ponto ja e tarde demais,
    // e um envio recusado pela Meta custa mais do que um envio a menos.
    const state = windowState(ago(MESSAGING_WINDOW_HOURS), NOW);

    expect(state.open).toBe(false);
  });

  it("marca como saindo quem esta perto do fim", () => {
    const state = windowState(ago(MESSAGING_WINDOW_HOURS - 2), NOW);

    expect(state.open).toBe(true);
    expect(state.expiringSoon).toBe(true);
    expect(state.hoursLeft).toBeCloseTo(2);
  });

  it("nao marca como saindo quem ainda tem folga", () => {
    const state = windowState(ago(MESSAGING_WINDOW_HOURS - EXPIRING_SOON_HOURS - 1), NOW);

    expect(state.expiringSoon).toBe(false);
  });

  it("nao inventa janela para quem nunca mandou mensagem", () => {
    // Alguem que so comentou entra aqui: comentario nao abre janela.
    const state = windowState(null, NOW);

    expect(state.open).toBe(false);
    expect(state.closesAt).toBeNull();
    expect(state.hoursLeft).toBe(0);
  });
});

describe("isWindowOpen", () => {
  it("concorda com windowState", () => {
    expect(isWindowOpen(ago(1), NOW)).toBe(true);
    expect(isWindowOpen(ago(30), NOW)).toBe(false);
    expect(isWindowOpen(null, NOW)).toBe(false);
  });
});

describe("cortes usados nas queries", () => {
  it("windowCutoff e exatamente 24h atras", () => {
    expect(windowCutoff(NOW)).toEqual(new Date("2026-09-08T12:00:00.000Z"));
  });

  it("uma pessoa no corte da query bate com o estado calculado", () => {
    // A tela conta com `lastInboundAt >= windowCutoff` e cada linha mostra
    // `windowState`. Se os dois discordassem, a contagem mentiria.
    const cutoff = windowCutoff(NOW);
    const justInside = new Date(cutoff.getTime() + 1000);
    const justOutside = new Date(cutoff.getTime() - 1000);

    expect(windowState(justInside, NOW).open).toBe(true);
    expect(windowState(justOutside, NOW).open).toBe(false);
  });

  it("expiringSoonCutoff separa quem sai em breve", () => {
    const cutoff = expiringSoonCutoff(NOW);

    expect(windowState(cutoff, NOW).expiringSoon).toBe(true);
    expect(
      windowState(new Date(cutoff.getTime() + 60 * 60 * 1000), NOW).expiringSoon
    ).toBe(false);
  });
});

describe("formatTimeLeft", () => {
  it("escreve horas e minutos", () => {
    expect(formatTimeLeft(windowState(ago(20.5), NOW))).toBe("3h 30min");
  });

  it("escreve so minutos abaixo de uma hora", () => {
    expect(formatTimeLeft(windowState(ago(23.5), NOW))).toBe("30min");
  });

  it("escreve so horas quando e redondo", () => {
    expect(formatTimeLeft(windowState(ago(21), NOW))).toBe("3h");
  });

  it("diz fechada quando nao da para enviar", () => {
    expect(formatTimeLeft(windowState(ago(48), NOW))).toBe("fechada");
    expect(formatTimeLeft(windowState(null, NOW))).toBe("fechada");
  });

  it("nunca mostra 0min para uma janela aberta", () => {
    // Arredondar para baixo mostraria "0min" numa janela que ainda aceita envio.
    const almostClosed = new Date(NOW.getTime() - (24 * 60 - 0.4) * 60 * 1000);

    expect(windowState(almostClosed, NOW).open).toBe(true);
    expect(formatTimeLeft(windowState(almostClosed, NOW))).toBe("1min");
  });
});
