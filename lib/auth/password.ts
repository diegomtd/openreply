/**
 * Hash e verificação de senha para o login com e-mail e senha.
 *
 * `scrypt` do próprio `node:crypto`, não uma dependência nova — o mesmo
 * princípio de `lib/meta/oauth.ts`, que já cifra o token do Instagram sem
 * puxar biblioteca externa. `scrypt` é lento de propósito (é a defesa contra
 * força bruta se o banco vazar), com custo de memória alto o bastante para
 * inviabilizar GPU/ASIC sem pesar nesta VPS: um hash por login, não por
 * requisição.
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Metade do padrão de memória do scrypt (16MB) chega para um app deste porte,
 * sem pesar na VPS a cada login. */
const SCRYPT_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1 };

// `promisify(scrypt)` resolve para a sobrecarga sem `options`, então a
// derivação com N/r/p custom precisa do próprio wrapper.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordStrengthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Checagem mínima, não um medidor de força. O objetivo é recusar o óbvio
 * (curta demais, ou vazia) antes de gastar o custo do scrypt — não substituir
 * julgamento de quem está escolhendo a senha.
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    };
  }
  if (password.trim().length === 0) {
    return { ok: false, reason: "A senha não pode ser só espaços." };
  }
  return { ok: true };
}

/** `salt:hash`, os dois em hex, num campo de texto só — sem tabela nova. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS
  );

  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

// Salt fixo só para o caso de "não existe hash" abaixo — nunca usado para
// proteger senha nenhuma de verdade, só para gastar o mesmo tempo de scrypt
// que uma comparação real gastaria.
const DUMMY_SALT = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000000",
  "hex"
).subarray(0, SALT_LENGTH);

/**
 * `timingSafeEqual` porque isto compara segredo contra segredo — um `===`
 * comum vaza, por tempo de resposta, quantos bytes bateram até o primeiro
 * diferente.
 *
 * Quando `stored` é nulo (e-mail que não existe, ou existe mas só usa o link
 * mágico), roda o scrypt do mesmo jeito contra um salt fixo em vez de sair
 * na hora — senão o tempo de resposta já entrega se aquele e-mail tem senha
 * cadastrada, sem precisar acertar senha nenhuma.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  const [saltHex, hashHex] = stored?.split(":") ?? [];

  if (!saltHex || !hashHex) {
    await scryptAsync(password.normalize("NFKC"), DUMMY_SALT, KEY_LENGTH, SCRYPT_OPTIONS);
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const derivedKey = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    expected.length,
    SCRYPT_OPTIONS
  );

  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Senha temporária para "criar acesso direto" — a pessoa que administra o
 * workspace entrega isto por fora do e-mail (WhatsApp, em mão) e quem recebe
 * troca depois. Sem caracteres ambíguos (0/O, 1/l/I) porque vai ser digitada
 * por alguém lendo de uma tela ou de um papel.
 */
export function generateTemporaryPassword(length = 12): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return result;
}
