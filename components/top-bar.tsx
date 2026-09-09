"use client";

/**
 * Barra superior
 *
 * Título da página, botão de menu no mobile e estado da conexão.
 */

import { usePathname } from "next/navigation";

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

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Início";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 h-16 px-4 lg:px-8 border-b border-border bg-background">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden shrink-0 px-2.5 py-1.5 rounded border border-border text-sm text-muted hover:text-foreground"
          aria-label="Abrir menu"
        >
          Menu
        </button>
        <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
      </div>

      {instagramAccountCount > 0 ? (
        <p className="shrink-0 truncate text-sm text-muted">
          {instagramAccountCount > 1
            ? `${instagramAccountCount} contas`
            : `@${instagramUsername}`}
        </p>
      ) : (
        <a
          href="/api/instagram/connect"
          className="shrink-0 whitespace-nowrap text-sm font-medium px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover"
        >
          {/* O rótulo inteiro não cabe num cabeçalho de 360px. */}
          <span className="sm:hidden">Conectar</span>
          <span className="hidden sm:inline">Conectar Instagram</span>
        </a>
      )}
    </header>
  );
}
