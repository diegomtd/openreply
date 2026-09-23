/**
 * Limite de tentativas de login por senha.
 *
 * O link mágico nunca teve essa superfície — não dá pra "adivinhar" um token
 * de uso único. Senha, dá. Chave por e-mail normalizado: um contador simples
 * no Redis, incrementado a cada tentativa que falha e limpo na que acerta.
 * Não precisa ser atômico feito o de cota de DM
 * (`lib/utils/rate-limiter.ts`) — perder uma corrida rara aqui, na pior das
 * hipóteses, deixa passar UMA tentativa a mais, não uma cota de negócio.
 */

import Redis from "ioredis";

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60; // 15 minutos

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  }
  return redis;
}

function keyFor(email: string): string {
  return `rate:login:${email.trim().toLowerCase()}`;
}

/** `true` = ainda pode tentar. `false` = espera a janela passar. */
export async function isLoginAllowed(email: string): Promise<boolean> {
  const client = getRedis();
  const count = await client.get(keyFor(email));
  return !count || Number.parseInt(count, 10) < MAX_ATTEMPTS;
}

export async function recordFailedLogin(email: string): Promise<void> {
  const client = getRedis();
  const key = keyFor(email);
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, WINDOW_SECONDS);
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await getRedis().del(keyFor(email));
}

export { MAX_ATTEMPTS as LOGIN_MAX_ATTEMPTS, WINDOW_SECONDS as LOGIN_WINDOW_SECONDS };
