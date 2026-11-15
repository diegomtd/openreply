"use client";

/**
 * Barra superior
 *
 * Título da página, botão de menu no mobile, as contas conectadas com a luz de
 * estado de cada uma e o botão de claro/escuro.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Modo } from "@/lib/tema";

const pageTitles: Record<string, string> = {
  "/dashboard": "Início",
  "/inbox": "Caixa de entrada",
  "/contacts": "Contatos",
  "/broadcasts": "Envio ativo",
  "/campaigns": "Automações",
  "/campaigns/new": "Nova automação",
  "/campaigns/import": "Importar automações",
  "/automations": "Automações",
  "/automations/new": "Nova automação",
  "/overview": "Análise",
  "/logs": "Registros",
  "/settings": "Configurações",
  "/diagnostics": "Diagnóstico",
};

export interface ContaResumo {
  id: string;
  username: string;
  /** false quando a Meta recusou o token (conta parada). */
  ok: boolean;
}

interface TopBarProps {
  onMenuClick: () => void;
  accounts: ContaResumo[];
  modo: Modo;
  onTrocarModo: () => void;
}

const ROTULO_MODO: Record<Modo, string> = {
  auto: "Automático (segue o sistema)",
  escuro: "Escuro",
  claro: "Claro",
};

/** Ícones 24×24 em stroke, sem biblioteca. */
const ICONE_MODO: Record<Modo, string> = {
  auto: "M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18",
  escuro: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  claro:
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
};

export function Avatar({
  username,
  ok = true,
  size = "sm",
}: {
  username: string;
  ok?: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-10 w-10 text-sm" : "h-7 w-7 text-[11px]";
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`${dim} grid place-items-center rounded-full border border-border bg-surface-hover font-mono font-semibold uppercase text-foreground`}
      >
        {username.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?"}
      </span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
          ok ? "bg-success" : "bg-error"
        }`}
        aria-hidden="true"
      />
    </span>
  );
}

export default function TopBar({
  onMenuClick,
  accounts,
  modo,
  onTrocarModo,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/campaigns/") ? "Automação" : "Início");
  const paradas = accounts.filter((a) => !a.ok).length;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-md lg:px-8">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted hover:text-foreground"
          aria-label="Abrir menu"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </button>
        <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
          {title}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {accounts.length > 0 ? (
          <Link
            href="/settings#contas"
            title={
              paradas > 0
                ? `${paradas} conta(s) parada(s): reconecte em Configurações`
                : "Contas conectadas"
            }
            className="flex items-center gap-2 rounded-full border border-border bg-surface/60 py-1 pl-1 pr-3 hover:border-border-hover"
          >
            <span className="flex -space-x-2">
              {accounts.slice(0, 3).map((conta) => (
                <Avatar key={conta.id} username={conta.username} ok={conta.ok} />
              ))}
            </span>
            <span className="hidden text-sm text-muted sm:inline">
              {accounts.length === 1
                ? `@${accounts[0].username}`
                : `${accounts.length} contas`}
            </span>
          </Link>
        ) : (
          <a
            href="/api/instagram/connect"
            className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            {/* O rótulo inteiro não cabe num cabeçalho de 360px. */}
            <span className="sm:hidden">Conectar</span>
            <span className="hidden sm:inline">Conectar Instagram</span>
          </a>
        )}

        <button
          type="button"
          onClick={onTrocarModo}
          title={`Tema: ${ROTULO_MODO[modo]} (clique para trocar)`}
          aria-label={`Tema: ${ROTULO_MODO[modo]}. Trocar`}
          className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted hover:border-border-hover hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ICONE_MODO[modo]} />
          </svg>
        </button>
      </div>
    </header>
  );
}
