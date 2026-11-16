/**
 * Aparência do painel: modo (claro/escuro/automático), cor de destaque e nome
 * da marca. Fica no workspace para quem revende o Anzol trocar a cara inteira
 * sem mexer em código; as cores em si moram em `app/tema.css`.
 */

export const MODOS = ["auto", "escuro", "claro"] as const;
export type Modo = (typeof MODOS)[number];

/** `amostra` é só para pintar o botão do seletor; a cor real vem do CSS. */
export const ACENTOS = [
  { id: "gelo", nome: "Gelo", amostra: "#BFD3FF" },
  { id: "ambar", nome: "Âmbar", amostra: "#FFB36B" },
  { id: "oceano", nome: "Oceano", amostra: "#7FD6E0" },
  { id: "menta", nome: "Menta", amostra: "#7FE0B0" },
  { id: "coral", nome: "Coral", amostra: "#FF9A8A" },
  { id: "violeta", nome: "Violeta", amostra: "#C9B5FF" },
] as const;
export type Acento = (typeof ACENTOS)[number]["id"];
export const ACENTO_IDS = ACENTOS.map((a) => a.id) as [Acento, ...Acento[]];

export const MARCA_PADRAO = "Anzol";

export interface Aparencia {
  modo: Modo;
  acento: Acento;
  marca: string;
}

export function normalizarAparencia(dados: {
  uiTema?: string | null;
  uiAcento?: string | null;
  uiMarca?: string | null;
}): Aparencia {
  const modo = (MODOS as readonly string[]).includes(dados.uiTema ?? "")
    ? (dados.uiTema as Modo)
    : "auto";
  const acento = (ACENTO_IDS as readonly string[]).includes(dados.uiAcento ?? "")
    ? (dados.uiAcento as Acento)
    : "gelo";
  const marca = dados.uiMarca?.trim() || MARCA_PADRAO;
  return { modo, acento, marca };
}

/** Chave do modo escolhido por esta pessoa neste navegador (botão da barra). */
export const MODO_LOCAL_KEY = "anzol-modo";
