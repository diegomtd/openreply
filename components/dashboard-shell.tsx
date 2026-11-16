"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Sidebar from "@/components/sidebar";
import TopBar, { type ContaResumo } from "@/components/top-bar";
import DeadAccountBanner from "@/components/dead-account-banner";
import { MODO_LOCAL_KEY, MODOS, type Aparencia, type Modo } from "@/lib/tema";

interface DeadAccount {
  id: string;
  username: string;
  tokenInvalidAt: string;
  tokenInvalidReason: string | null;
}

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  /// Tema, acento e marca do workspace (Configurações → Aparência).
  aparencia: Aparencia;
  accounts: ContaResumo[];
  /// Contas cujo token a Meta recusou. Enquanto houver alguma, nada envia.
  deadAccounts: DeadAccount[];
}

/** Evento que a tela de Aparência dispara para repintar na hora, sem recarregar. */
export const EVENTO_APARENCIA = "anzol:aparencia";

/** Avisa as abas/componentes que o modo local mudou. */
const EVENTO_MODO_LOCAL = "anzol:modo-local";

function assinarModoLocal(aviso: () => void) {
  window.addEventListener("storage", aviso);
  window.addEventListener(EVENTO_MODO_LOCAL, aviso);
  return () => {
    window.removeEventListener("storage", aviso);
    window.removeEventListener(EVENTO_MODO_LOCAL, aviso);
  };
}

export function gravarModoLocal(modo: Modo | null) {
  try {
    if (modo) window.localStorage.setItem(MODO_LOCAL_KEY, modo);
    else window.localStorage.removeItem(MODO_LOCAL_KEY);
  } catch {
    // Sem armazenamento (aba anônima): fica no padrão do workspace.
  }
  window.dispatchEvent(new Event(EVENTO_MODO_LOCAL));
}

function lerModoLocal(): Modo | null {
  try {
    const salvo = window.localStorage.getItem(MODO_LOCAL_KEY);
    return (MODOS as readonly string[]).includes(salvo ?? "")
      ? (salvo as Modo)
      : null;
  } catch {
    return null;
  }
}

export default function DashboardShell({
  children,
  workspaceName,
  aparencia: aparenciaInicial,
  accounts,
  deadAccounts,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aparencia, setAparencia] = useState(aparenciaInicial);
  // Escolha desta pessoa neste navegador; vence o padrão do workspace.
  const modoLocal = useSyncExternalStore(
    assinarModoLocal,
    lerModoLocal,
    () => null
  );

  useEffect(() => {
    function aoMudar(evento: Event) {
      const detalhe = (evento as CustomEvent<Partial<Aparencia>>).detail;
      setAparencia((atual) => ({ ...atual, ...detalhe }));
    }
    window.addEventListener(EVENTO_APARENCIA, aoMudar);
    return () => window.removeEventListener(EVENTO_APARENCIA, aoMudar);
  }, []);

  const modo = modoLocal ?? aparencia.modo;

  const trocarModo = useCallback(() => {
    const proximo: Modo =
      modo === "auto" ? "escuro" : modo === "escuro" ? "claro" : "auto";
    gravarModoLocal(proximo);
  }, [modo]);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div
      data-tema={modo}
      data-acento={aparencia.acento}
      className="flex h-dvh overflow-hidden horizonte-fundo text-foreground"
    >
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
        marca={aparencia.marca}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          accounts={accounts}
          modo={modo}
          onTrocarModo={trocarModo}
        />

        {/* Acima do conteúdo e fora da área rolável: com o token morto nada
            funciona, então o aviso não pode sair de vista ao rolar. */}
        <DeadAccountBanner accounts={deadAccounts} />

        <main className="flex-1 overflow-y-auto">
          <div className="px-4 lg:px-8 py-5 sm:py-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
