import { describe, it, expect } from "vitest";
import {
  checkPasswordStrength,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/password";

describe("checkPasswordStrength", () => {
  it("recusa senha curta demais", () => {
    expect(checkPasswordStrength("abc123").ok).toBe(false);
  });

  it("aceita no comprimento mínimo", () => {
    expect(checkPasswordStrength("a".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it("recusa senha só de espaços, mesmo comprida o bastante", () => {
    expect(checkPasswordStrength(" ".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("confere a senha certa", async () => {
    const hash = await hashPassword("uma-senha-boa");
    expect(await verifyPassword("uma-senha-boa", hash)).toBe(true);
  });

  it("recusa a senha errada", async () => {
    const hash = await hashPassword("uma-senha-boa");
    expect(await verifyPassword("outra-coisa", hash)).toBe(false);
  });

  it("dois hashes da mesma senha nunca são iguais (salt aleatório)", async () => {
    // Garante que duas contas com a mesma senha não têm o mesmo hash no banco
    // — sem isso, um vazamento revelaria quem repete senha com quem.
    const a = await hashPassword("mesma-senha");
    const b = await hashPassword("mesma-senha");
    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha", a)).toBe(true);
    expect(await verifyPassword("mesma-senha", b)).toBe(true);
  });

  it("recusa quando não há hash nenhum, sem lançar", async () => {
    // Este é o caminho de quem só usa o link mágico — precisa devolver false
    // liso, não estourar, senão o login por senha quebraria pra essa conta.
    expect(await verifyPassword("qualquer-coisa", null)).toBe(false);
    expect(await verifyPassword("qualquer-coisa", undefined)).toBe(false);
  });

  it("recusa um valor de hash malformado sem lançar", async () => {
    expect(await verifyPassword("qualquer-coisa", "isto-nao-e-um-hash-valido")).toBe(
      false
    );
  });
});

describe("generateTemporaryPassword", () => {
  it("gera senhas diferentes a cada chamada", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).not.toBe(b);
  });

  it("nunca usa caracteres ambíguos (0/O, 1/l/I)", () => {
    for (let i = 0; i < 20; i++) {
      const password = generateTemporaryPassword(24);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it("respeita o comprimento pedido", () => {
    expect(generateTemporaryPassword(16)).toHaveLength(16);
  });
});
