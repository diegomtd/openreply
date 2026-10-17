import { createHash, timingSafeEqual } from "crypto";

/**
 * API de agentes (`/api/agent/v1/*`): é por onde um agente de IA de fora — o
 * Netuno do ecossistema Oceano Azul — lê e opera as contas conectadas aqui sem
 * sessão de navegador.
 *
 * A chave é uma só, em `OPENREPLY_AGENT_TOKEN`, e vale para a instância
 * inteira. Sem a variável a API fica desligada (503), nunca aberta. Chave curta
 * é recusada: quem tem essa chave lê DMs e responde em nome das contas.
 */
export const AGENT_TOKEN_MIN_LENGTH = 32;

export type AgentAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function checkAgentAuth(
  authorizationHeader: string | null,
  configuredToken: string | undefined = process.env.OPENREPLY_AGENT_TOKEN
): AgentAuthResult {
  if (!configuredToken || configuredToken.length < AGENT_TOKEN_MIN_LENGTH) {
    return {
      ok: false,
      status: 503,
      error: `Agent API disabled: set OPENREPLY_AGENT_TOKEN (at least ${AGENT_TOKEN_MIN_LENGTH} characters).`,
    };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  if (!match) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }

  // Compara os hashes para o tempo não vazar o tamanho nem o prefixo certo.
  if (!timingSafeEqual(digest(match[1].trim()), digest(configuredToken))) {
    return { ok: false, status: 401, error: "Invalid token." };
  }

  return { ok: true };
}
