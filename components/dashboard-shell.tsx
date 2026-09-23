"use client";

import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import DeadAccountBanner from "@/components/dead-account-banner";

interface DeadAccount {
  id: string;
  username: string;
  tokenInvalidAt: string;
  tokenInvalidReason: string | null;
}

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
  /// Contas cujo token a Meta recusou. Enquanto houver alguma, nada envia.
  deadAccounts: DeadAccount[];
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
  deadAccounts,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        {/* Acima do conteúdo e fora da área rolável: com o token morto nada
            funciona, então o aviso não pode sair de vista ao rolar. */}
        <DeadAccountBanner accounts={deadAccounts} />

        <main className="flex-1 overflow-y-auto">
          <div className="px-4 lg:px-8 py-5 sm:py-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
