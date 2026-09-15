import { describe, it, expect } from "vitest";
import {
  planAccountMove,
  type AutomationTriggers,
} from "@/lib/automations/move-account";

function automation(overrides: Partial<AutomationTriggers> = {}): AutomationTriggers {
  return {
    postId: null,
    matchAnyPost: false,
    pendingNextReel: false,
    dmTriggerEnabled: false,
    storyReplyTriggerEnabled: false,
    storyMentionTriggerEnabled: false,
    ...overrides,
  };
}

describe("planAccountMove", () => {
  it("não deixa o post da conta antiga atravessar a mudança", () => {
    // O caso que motivou tudo: a pessoa trocou de perfil do Instagram. A mídia
    // 17900 pertence à conta antiga; na nova ela não existe, então nenhum
    // comentário casaria e a automação ficaria ativa na tela e muda na prática.
    const plan = planAccountMove(automation({ postId: "17900", dmTriggerEnabled: true }), {});

    expect(plan).toEqual({ ok: true, clearPost: true });
  });

  it("mantém um post escolhido na conta nova", () => {
    const plan = planAccountMove(automation({ postId: "17900" }), { postId: "18422" });

    expect(plan).toEqual({ ok: true, clearPost: false });
  });

  it("trata o mesmo postId como estado antigo reenviado, não como escolha", () => {
    // O construtor manda o formulário inteiro a cada salvamento. Repetir o id
    // que já estava lá não é alguém escolhendo um post na conta de destino.
    const plan = planAccountMove(automation({ postId: "17900", matchAnyPost: false, dmTriggerEnabled: true }), {
      postId: "17900",
    });

    expect(plan).toEqual({ ok: true, clearPost: true });
  });

  it("recusa a mudança quando limpar o post não deixa gatilho nenhum", () => {
    // Salvar isto criaria uma automação viva que nunca dispara — pior que um
    // erro, porque não parece um erro.
    const plan = planAccountMove(automation({ postId: "17900" }), {});

    expect(plan).toEqual({ ok: false, reason: "no_trigger" });
  });

  it("deixa passar quem responde DM, mesmo sem post", () => {
    const plan = planAccountMove(automation({ dmTriggerEnabled: true }), {});

    expect(plan.ok).toBe(true);
  });

  it("deixa passar quem responde story", () => {
    expect(planAccountMove(automation({ storyReplyTriggerEnabled: true }), {}).ok).toBe(true);
    expect(planAccountMove(automation({ storyMentionTriggerEnabled: true }), {}).ok).toBe(true);
  });

  it("deixa passar 'qualquer post' e 'próximo reel', que não dependem de mídia", () => {
    // Estes dois casam por conta, não por id de mídia, então sobrevivem à
    // troca sem precisar que alguém escolha nada.
    expect(planAccountMove(automation({ matchAnyPost: true }), {}).ok).toBe(true);
    expect(planAccountMove(automation({ pendingNextReel: true }), {}).ok).toBe(true);
  });

  it("lê o gatilho que vem na própria requisição, não só o que estava salvo", () => {
    // Ligar o gatilho de DM e mudar de conta no mesmo salvamento é uma
    // requisição só; olhar apenas o estado salvo recusaria algo válido.
    const plan = planAccountMove(automation({ postId: "17900" }), {
      dmTriggerEnabled: true,
    });

    expect(plan).toEqual({ ok: true, clearPost: true });
  });

  it("recusa quando a requisição desliga o último gatilho que restava", () => {
    const plan = planAccountMove(automation({ postId: "17900", dmTriggerEnabled: true }), {
      dmTriggerEnabled: false,
    });

    expect(plan).toEqual({ ok: false, reason: "no_trigger" });
  });

  it("não pede limpeza quando a própria requisição já manda postId nulo", () => {
    const plan = planAccountMove(automation({ postId: "17900", matchAnyPost: true }), {
      postId: null,
    });

    expect(plan).toEqual({ ok: true, clearPost: false });
  });
});
