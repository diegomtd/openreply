/**
 * Mover uma automação de uma conta do Instagram para outra.
 *
 * Existe porque trocar de perfil é real: quem conectou uma conta nova quer
 * levar as automações junto, e até aqui não havia como — o construtor mostrava
 * o seletor de conta ao editar, mandava a conta escolhida no PATCH, e a API
 * descartava o campo em silêncio. A tela dizia "salvo" e nada tinha mudado.
 *
 * A parte que exige decisão é o post do gatilho. `postId` é uma mídia da conta
 * antiga; na conta nova essa mídia não existe, então um comentário jamais
 * casaria com ela. Uma automação assim fica ativa na tela e muda na prática —
 * o pior estado possível, porque não se parece com um erro.
 *
 * Então o post antigo não atravessa a mudança. Se o que sobra não tem gatilho
 * nenhum, a mudança é recusada em vez de salva morta.
 */

export interface AutomationTriggers {
  postId: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
  storyReplyTriggerEnabled: boolean;
  storyMentionTriggerEnabled: boolean;
}

/** Os mesmos campos vindos do PATCH: `undefined` é "não mexe". */
export type AutomationTriggerPatch = Partial<AutomationTriggers>;

export type AccountMovePlan =
  | {
      ok: true;
      /** O post da conta antiga não sobrevive: zerar `postId` e `postUrl`. */
      clearPost: boolean;
    }
  | {
      ok: false;
      reason: "no_trigger";
    };

function effective<K extends keyof AutomationTriggers>(
  existing: AutomationTriggers,
  patch: AutomationTriggerPatch,
  key: K
): AutomationTriggers[K] {
  return patch[key] !== undefined ? (patch[key] as AutomationTriggers[K]) : existing[key];
}

/**
 * O que fazer com os gatilhos quando a automação muda de conta.
 *
 * `patch` são só os campos que vieram na requisição. Um `postId` novo no mesmo
 * PATCH é um post escolhido na conta de destino — esse fica.
 */
export function planAccountMove(
  existing: AutomationTriggers,
  patch: AutomationTriggerPatch
): AccountMovePlan {
  // Só um postId diferente do atual pode ter vindo da conta nova. Repetir o
  // mesmo id é o construtor reenviando o estado antigo, não uma escolha.
  const clearPost = patch.postId === undefined || patch.postId === existing.postId;
  const postId = clearPost ? null : patch.postId ?? null;

  const hasTrigger =
    Boolean(postId) ||
    Boolean(effective(existing, patch, "matchAnyPost")) ||
    Boolean(effective(existing, patch, "pendingNextReel")) ||
    Boolean(effective(existing, patch, "dmTriggerEnabled")) ||
    Boolean(effective(existing, patch, "storyReplyTriggerEnabled")) ||
    Boolean(effective(existing, patch, "storyMentionTriggerEnabled"));

  if (!hasTrigger) return { ok: false, reason: "no_trigger" };

  return { ok: true, clearPost };
}
