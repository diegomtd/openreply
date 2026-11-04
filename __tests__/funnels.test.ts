import { describe, expect, it } from "vitest";
import { decideSequenceStep } from "@/lib/funnels/sequence";
import { FUNNEL_STRATEGIES } from "@/lib/funnels/strategies";

const H = 60 * 60 * 1000;
const now = new Date("2026-11-04T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * H);

describe("decideSequenceStep", () => {
  it("sends an ALWAYS step inside the window", () => {
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: false, chainStartedAt: ago(1), lastInboundAt: ago(1), now })
    ).toEqual({ action: "send" });
  });

  it("stops the chain once 24h passed since the last interaction", () => {
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: false, chainStartedAt: ago(25), lastInboundAt: ago(26), now })
    ).toEqual({ action: "stop", reason: "window_closed" });
  });

  it("a newer message from the person renews the window", () => {
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: false, chainStartedAt: ago(25), lastInboundAt: ago(2), now })
    ).toEqual({ action: "send" });
  });

  it("hands over to a human when the person replied and stopOnReply is on", () => {
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: true, chainStartedAt: ago(3), lastInboundAt: ago(1), now })
    ).toEqual({ action: "stop", reason: "replied" });
  });

  it("ignores the tap that started the chain as a reply", () => {
    const t = ago(3);
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: true, chainStartedAt: t, lastInboundAt: t, now })
    ).toEqual({ action: "send" });
  });

  it("skips NOT_CLICKED for a clicker and CLICKED for a non-clicker", () => {
    const base = { stopOnReply: false, chainStartedAt: ago(1), lastInboundAt: ago(1), now };
    expect(decideSequenceStep({ ...base, condition: "NOT_CLICKED", clicked: true })).toEqual({ action: "skip", reason: "condition" });
    expect(decideSequenceStep({ ...base, condition: "NOT_CLICKED", clicked: false })).toEqual({ action: "send" });
    expect(decideSequenceStep({ ...base, condition: "CLICKED", clicked: false })).toEqual({ action: "skip", reason: "condition" });
    expect(decideSequenceStep({ ...base, condition: "CLICKED", clicked: true })).toEqual({ action: "send" });
  });

  it("lets Meta decide for legacy jobs with no reference time", () => {
    expect(
      decideSequenceStep({ condition: "ALWAYS", clicked: false, stopOnReply: true, chainStartedAt: null, lastInboundAt: null, now })
    ).toEqual({ action: "send" });
  });
});

describe("FUNNEL_STRATEGIES", () => {
  it.each(FUNNEL_STRATEGIES.map((s) => [s.slug, s] as const))(
    "%s respeita a política da Meta",
    (_slug, s) => {
      // Sequência inteira dentro da janela de 24h, até 3 passos.
      expect(s.steps.reduce((t, st) => t + st.delayMinutes, 0)).toBeLessThanOrEqual(1440);
      expect(s.steps.length).toBeLessThanOrEqual(3);
      expect(s.keywords.length).toBeGreaterThan(0);
      expect(s.dmMessage).toContain("{link}");
      // Toda estratégia avisa que é robô na primeira mensagem que a pessoa vê.
      const first = s.openingDmMessage || s.dmMessage;
      expect(first).toMatch(/automático/);
      // Botão de abertura completo ou ausente (story já abre janela).
      expect(Boolean(s.openingDmMessage)).toBe(Boolean(s.openingDmButtonLabel));
      expect(s.linkButtonLabel.length).toBeLessThanOrEqual(20);
      for (const st of s.steps) expect(st.message.length).toBeLessThanOrEqual(1000);
    }
  );
});
