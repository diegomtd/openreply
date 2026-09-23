/**
 * Traduz o erro cru de uma API para algo que diga o que fazer.
 *
 * As telas mostravam a mensagem da Meta como veio — em inglês, e escrita para
 * quem programa: *"Error validating access token: The session has been
 * invalidated because the user changed their password..."*. Quem lê isso na
 * Caixa de entrada não tem como saber que a resposta é "reconecte a conta".
 *
 * Fica separado das telas porque o mesmo erro aparece em quatro delas, e a
 * resposta certa é a mesma nas quatro.
 */

export interface FriendlyError {
  title: string;
  detail: string;
  /** Quando existe uma ação concreta, o botão que a executa. */
  action?: { label: string; href: string };
}

/** Padrões da Meta que significam "o token morreu". */
const TOKEN_DEAD = [
  /error validating access token/i,
  /session has been invalidated/i,
  /\berror 190\b/i,
  /access token.*expired/i,
];

export function humanizeApiError(raw: string | null | undefined): FriendlyError {
  const message = (raw ?? "").trim();

  if (TOKEN_DEAD.some((pattern) => pattern.test(message))) {
    return {
      title: "A conta do Instagram está desconectada",
      detail:
        "A Meta recusou o acesso — normalmente porque a senha do Instagram mudou ou a sessão foi encerrada por segurança. Enquanto isso, nenhuma automação envia e nenhuma conversa carrega.",
      action: { label: "Reconectar agora", href: "/api/instagram/connect" },
    };
  }

  if (/no instagram account|nenhuma conta/i.test(message)) {
    return {
      title: "Nenhuma conta do Instagram conectada",
      detail: "Conecte uma conta para começar a receber comentários e mensagens.",
      action: { label: "Conectar Instagram", href: "/api/instagram/connect" },
    };
  }

  if (/rate limit|too many calls|\berror 368\b/i.test(message)) {
    return {
      title: "O Instagram pediu uma pausa",
      detail:
        "A conta bateu no limite de chamadas da Meta. Isso passa sozinho em alguns minutos — não é preciso fazer nada.",
    };
  }

  return {
    title: "Não foi possível carregar",
    detail: message || "Tente de novo em instantes.",
  };
}
