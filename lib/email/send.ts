/**
 * Envio de e-mail avulso, pela API do Resend.
 *
 * O login já manda e-mail, mas por dentro do provider do next-auth — não existia
 * um caminho para o app avisar sobre qualquer outra coisa. É o que faltava para
 * um alerta sair da tela e chegar em quem precisa agir.
 *
 * `fetch` direto em vez de mais uma dependência: é uma chamada HTTP com três
 * campos, e a mesma `RESEND_API_KEY` que o login já usa.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Corpo em texto puro. Um alerta não precisa de layout. */
  text: string;
}

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

/**
 * Manda o e-mail, ou explica por que não mandou.
 *
 * Nunca lança: quem chama isto está no meio de tratar um problema, e uma falha
 * ao **avisar** sobre o problema não pode virar um segundo problema. Sem chave
 * configurada devolve `not_configured` em silêncio — numa instalação própria,
 * e-mail é opcional, e o aviso na tela continua de pé.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from || apiKey === "missing-resend-api-key") {
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { sent: false, reason: "failed", detail: detail.slice(0, 300) };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: "failed",
      detail: error instanceof Error ? error.message : "erro desconhecido",
    };
  }
}
