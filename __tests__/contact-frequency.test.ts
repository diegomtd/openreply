import { describe, expect, it } from "vitest";
import {
  DM_SCOPE,
  decideAutomationSend,
  isOptOutMessage,
  type FrequencyInput,
} from "@/lib/contacts/state";

const NOW = new Date("2026-09-08T12:00:00.000Z");

function input(overrides: Partial<FrequencyInput> = {}): FrequencyInput {
  return {
    now: NOW,
    optedOut: false,
    contactTags: [],
    requiredTags: [],
    excludedTags: [],
    sendFrequency: "ONCE_PER_CONTACT",
    resendCooldownHours: 24,
    workspaceCooldownHours: 0,
    lastAutomationSentAt: null,
    automationState: [],
    scopeKey: DM_SCOPE,
    ...overrides,
  };
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe("decideAutomationSend", () => {
  it("allows a first contact with no history", () => {
    expect(decideAutomationSend(input())).toEqual({ allowed: true });
  });

  it("blocks an opted-out contact whatever the frequency says", () => {
    const decision = decideAutomationSend(
      input({ optedOut: true, sendFrequency: "ALWAYS" })
    );

    expect(decision).toMatchObject({
      allowed: false,
      status: "SKIPPED_OPTED_OUT",
    });
  });

  // This is the regression the whole module exists for: dedupe used to be per
  // message id, so the second message from the same person re-sent the DM.
  it("blocks a repeat send to someone who already received the automation", () => {
    const decision = decideAutomationSend(
      input({
        automationState: [
          { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(100) },
        ],
      })
    );

    expect(decision).toMatchObject({
      allowed: false,
      status: "SKIPPED_ALREADY_SENT",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain("Já enviada para esta pessoa");
    }
  });

  it("ignores history with no actual delivery", () => {
    expect(
      decideAutomationSend(
        input({
          automationState: [
            { scopeKey: DM_SCOPE, sentCount: 0, lastSentAt: hoursAgo(1) },
          ],
        })
      )
    ).toEqual({ allowed: true });
  });

  it("reports the most recent send, not whichever row came back first", () => {
    const decision = decideAutomationSend(
      input({
        automationState: [
          { scopeKey: "media_1", sentCount: 1, lastSentAt: hoursAgo(200) },
          { scopeKey: "media_2", sentCount: 1, lastSentAt: hoursAgo(2) },
        ],
      })
    );

    if (decision.allowed) throw new Error("expected a block");
    expect(decision.reason).toContain("2026-09-08 10:00");
  });

  describe("condição de tag", () => {
    it("blocks a contact missing a required tag", () => {
      const decision = decideAutomationSend(
        input({ contactTags: ["lead"], requiredTags: ["cliente"] })
      );

      expect(decision).toMatchObject({
        allowed: false,
        status: "SKIPPED_TAG_RULE",
      });
      if (!decision.allowed) {
        expect(decision.reason).toContain("cliente");
      }
    });

    it("requires ALL of them, not just one", () => {
      expect(
        decideAutomationSend(
          input({
            contactTags: ["lead"],
            requiredTags: ["lead", "interessado"],
          })
        )
      ).toMatchObject({ allowed: false, status: "SKIPPED_TAG_RULE" });
    });

    it("allows a contact carrying every required tag", () => {
      expect(
        decideAutomationSend(
          input({
            contactTags: ["lead", "interessado", "extra"],
            requiredTags: ["lead", "interessado"],
          })
        )
      ).toEqual({ allowed: true });
    });

    it("blocks a contact carrying an excluded tag", () => {
      const decision = decideAutomationSend(
        input({ contactTags: ["cliente"], excludedTags: ["cliente"] })
      );

      expect(decision).toMatchObject({
        allowed: false,
        status: "SKIPPED_TAG_RULE",
      });
      if (!decision.allowed) {
        expect(decision.reason).toContain("tag que bloqueia o envio");
      }
    });

    it("compares without case or surrounding space", () => {
      // "Cliente" e "cliente" são a mesma tag para quem usa o sistema.
      expect(
        decideAutomationSend(
          input({ contactTags: [" Cliente "], excludedTags: ["CLIENTE"] })
        )
      ).toMatchObject({ allowed: false, status: "SKIPPED_TAG_RULE" });
    });

    it("does not filter when both lists are empty", () => {
      expect(
        decideAutomationSend(input({ contactTags: ["qualquer", "coisa"] }))
      ).toEqual({ allowed: true });
    });

    it("blocks on the tag rule before the frequency rule", () => {
      // A regra de tag é mais específica: dizer "está no intervalo" para quem
      // nem devia entrar na campanha manda o usuário investigar a coisa errada.
      const decision = decideAutomationSend(
        input({
          excludedTags: ["cliente"],
          contactTags: ["cliente"],
          automationState: [
            { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(1) },
          ],
        })
      );

      expect(decision).toMatchObject({ status: "SKIPPED_TAG_RULE" });
    });

    it("still lets opt-out win over the tag rule", () => {
      expect(
        decideAutomationSend(
          input({
            optedOut: true,
            excludedTags: ["cliente"],
            contactTags: ["cliente"],
          })
        )
      ).toMatchObject({ status: "SKIPPED_OPTED_OUT" });
    });
  });

  describe("ONCE_PER_POST", () => {
    const state = [
      { scopeKey: "media_1", sentCount: 1, lastSentAt: hoursAgo(10) },
    ];

    it("blocks a second send for the same post", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "ONCE_PER_POST",
            scopeKey: "media_1",
            automationState: state,
          })
        )
      ).toMatchObject({ allowed: false, status: "SKIPPED_ALREADY_SENT" });
    });

    it("allows the same person on a different post", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "ONCE_PER_POST",
            scopeKey: "media_2",
            automationState: state,
          })
        )
      ).toEqual({ allowed: true });
    });
  });

  describe("COOLDOWN", () => {
    it("blocks inside the window", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "COOLDOWN",
            resendCooldownHours: 24,
            automationState: [
              { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(5) },
            ],
          })
        )
      ).toMatchObject({ allowed: false, status: "SKIPPED_COOLDOWN" });
    });

    it("allows once the window has passed", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "COOLDOWN",
            resendCooldownHours: 24,
            automationState: [
              { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(25) },
            ],
          })
        )
      ).toEqual({ allowed: true });
    });

    it("treats a zero-hour cooldown as no cooldown", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "COOLDOWN",
            resendCooldownHours: 0,
            automationState: [
              { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(0) },
            ],
          })
        )
      ).toEqual({ allowed: true });
    });
  });

  describe("workspace anti-flood ceiling", () => {
    it("blocks a second automation from piling on the same person", () => {
      const decision = decideAutomationSend(
        input({
          sendFrequency: "ALWAYS",
          workspaceCooldownHours: 12,
          lastAutomationSentAt: hoursAgo(3),
        })
      );

      expect(decision).toMatchObject({
        allowed: false,
        status: "SKIPPED_COOLDOWN",
      });
      if (!decision.allowed) {
        expect(decision.reason).toContain("Outra automação já falou");
      }
    });

    it("is disabled at zero hours", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "ALWAYS",
            workspaceCooldownHours: 0,
            lastAutomationSentAt: hoursAgo(0),
          })
        )
      ).toEqual({ allowed: true });
    });

    it("lets the more specific per-automation reason win when both block", () => {
      const decision = decideAutomationSend(
        input({
          workspaceCooldownHours: 12,
          lastAutomationSentAt: hoursAgo(1),
          automationState: [
            { scopeKey: DM_SCOPE, sentCount: 1, lastSentAt: hoursAgo(1) },
          ],
        })
      );

      expect(decision).toMatchObject({ status: "SKIPPED_ALREADY_SENT" });
    });

    it("does not block a first-ever contact", () => {
      expect(
        decideAutomationSend(
          input({ sendFrequency: "ALWAYS", workspaceCooldownHours: 12 })
        )
      ).toEqual({ allowed: true });
    });
  });

  describe("ALWAYS", () => {
    it("re-sends regardless of history", () => {
      expect(
        decideAutomationSend(
          input({
            sendFrequency: "ALWAYS",
            automationState: [
              { scopeKey: DM_SCOPE, sentCount: 9, lastSentAt: hoursAgo(0) },
            ],
          })
        )
      ).toEqual({ allowed: true });
    });
  });
});

describe("isOptOutMessage", () => {
  it("matches the built-in stop words, case and accent insensitive", () => {
    for (const text of ["parar", "PARAR", "Stop", "cancelar", "sair!", " chega "]) {
      expect(isOptOutMessage(text)).toBe(true);
    }
  });

  it("matches a workspace's own extra words", () => {
    expect(isOptOutMessage("me tira", ["me tira"])).toBe(true);
  });

  it("does not match a stop word buried in a real sentence", () => {
    // The whole point of matching the full message: someone saying they don't
    // want to miss the link is not asking to be removed.
    for (const text of [
      "nao quero parar de receber",
      "vou parar de comprar em outro lugar",
      "quero o link para mim",
      "stop by my profile later",
    ]) {
      expect(isOptOutMessage(text)).toBe(false);
    }
  });

  it("ignores an empty or punctuation-only message", () => {
    expect(isOptOutMessage("   ")).toBe(false);
    expect(isOptOutMessage("!!!")).toBe(false);
  });
});
