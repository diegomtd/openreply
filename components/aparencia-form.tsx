"use client";

/**
 * Configurações → Aparência
 *
 * Modo, cor de destaque e nome da marca do workspace. Cada clique repinta o
 * painel na hora (evento para o DashboardShell) e já salva; quem revende o
 * Anzol troca a cara inteira por aqui, sem rebuild.
 */

import { useEffect, useState } from "react";
import { EVENTO_APARENCIA, gravarModoLocal } from "@/components/dashboard-shell";
import {
  ACENTOS,
  MARCA_PADRAO,
  normalizarAparencia,
  type Aparencia,
  type Modo,
} from "@/lib/tema";

const OPCOES_MODO: { id: Modo; nome: string; dica: string }[] = [
  { id: "auto", nome: "Automático", dica: "Segue o sistema" },
  { id: "escuro", nome: "Escuro", dica: "Horizonte noturno" },
  { id: "claro", nome: "Claro", dica: "Luz do dia" },
];

export default function AparenciaForm({ podeEditar }: { podeEditar: boolean }) {
  const [aparencia, setAparencia] = useState<Aparencia | null>(null);
  const [marcaRascunho, setMarcaRascunho] = useState("");
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | "erro">("");

  useEffect(() => {
    fetch("/api/workspace/settings")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const atual = normalizarAparencia(payload.data);
        setAparencia(atual);
        setMarcaRascunho(payload.data.uiMarca ?? "");
      })
      .catch(() => setEstado("erro"));
  }, []);

  async function aplicar(mudanca: Partial<Aparencia>, corpo: Record<string, unknown>) {
    if (!aparencia) return;
    const anterior = aparencia;
    const nova = { ...aparencia, ...mudanca };
    setAparencia(nova);
    window.dispatchEvent(new CustomEvent(EVENTO_APARENCIA, { detail: mudanca }));
    if (mudanca.modo) {
      // O modo do workspace passa a valer também neste navegador.
      gravarModoLocal(null);
    }
    setEstado("salvando");
    try {
      const res = await fetch("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) throw new Error();
      setEstado("salvo");
    } catch {
      setAparencia(anterior);
      window.dispatchEvent(new CustomEvent(EVENTO_APARENCIA, { detail: anterior }));
      setEstado("erro");
    }
  }

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="rotulo">Design system</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Aparência</h2>
          <p className="mt-1 text-xs text-muted">
            Vale para todo o time deste workspace. O botão de lua no topo troca
            só para você.
          </p>
        </div>
        <span className="font-mono text-xs text-muted" aria-live="polite">
          {estado === "salvando" && "salvando…"}
          {estado === "salvo" && "salvo"}
          {estado === "erro" && <span className="text-error">não salvou</span>}
        </span>
      </div>

      {!aparencia ? (
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-surface-hover/60" />
      ) : (
        <fieldset disabled={!podeEditar} className="mt-6 space-y-7 disabled:opacity-60">
          <div>
            <p className="rotulo mb-3">Modo</p>
            <div className="grid grid-cols-3 gap-2">
              {OPCOES_MODO.map((opcao) => {
                const ativo = aparencia.modo === opcao.id;
                return (
                  <button
                    key={opcao.id}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => aplicar({ modo: opcao.id }, { uiTema: opcao.id })}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      ativo
                        ? "border-accent bg-accent-soft"
                        : "border-border hover:border-border-hover"
                    }`}
                  >
                    <span
                      className={`mb-2 block h-8 rounded-md border border-border ${
                        opcao.id === "escuro"
                          ? "bg-[#0d1118]"
                          : opcao.id === "claro"
                          ? "bg-[#f3f5fa]"
                          : "bg-[linear-gradient(90deg,#0d1118_50%,#f3f5fa_50%)]"
                      }`}
                    />
                    <span className="block text-sm font-medium">{opcao.nome}</span>
                    <span className="block text-[11px] text-muted">{opcao.dica}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="rotulo mb-3">Cor de destaque</p>
            <div className="flex flex-wrap gap-3">
              {ACENTOS.map((acento) => {
                const ativo = aparencia.acento === acento.id;
                return (
                  <button
                    key={acento.id}
                    type="button"
                    aria-pressed={ativo}
                    title={acento.nome}
                    onClick={() =>
                      aplicar({ acento: acento.id }, { uiAcento: acento.id })
                    }
                    className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm transition-colors ${
                      ativo
                        ? "border-accent bg-accent-soft text-foreground"
                        : "border-border text-muted hover:border-border-hover hover:text-foreground"
                    }`}
                  >
                    <span
                      className="h-6 w-6 rounded-full ring-1 ring-inset ring-black/10"
                      style={{ background: acento.amostra }}
                    />
                    {acento.nome}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(evento) => {
              evento.preventDefault();
              const marca = marcaRascunho.trim();
              aplicar({ marca: marca || MARCA_PADRAO }, { uiMarca: marca || null });
            }}
          >
            <label className="flex-1">
              <span className="rotulo mb-2 block">Nome da marca</span>
              <input
                value={marcaRascunho}
                onChange={(e) => setMarcaRascunho(e.target.value)}
                maxLength={32}
                placeholder={MARCA_PADRAO}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-accent/40 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              Salvar nome
            </button>
          </form>
          {!podeEditar && (
            <p className="text-xs text-muted">
              Só dono ou admin do workspace muda a aparência.
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}
