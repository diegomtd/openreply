"use client";

/**
 * Barra lateral
 *
 * Ordem no modelo do ManyChat: pessoa → conversa → automação → sistema. É o que
 * mantém "o que essa pessoa já recebeu de mim?" uma pergunta respondível, em vez
 * de organizar tudo por campanha.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

/** /campaigns é a entrada de Automações; /automations é a rota antiga das mesmas telas. */
const AUTOMATION_ROUTES = ["/campaigns", "/automations"];

interface NavItem {
  label: string;
  href: string;
  /** Ícone inline: um <path> de SVG 24×24, stroke. Sem dependência de biblioteca. */
  icon: string;
  hint: string;
}

const navGroups: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [
      {
        label: "Início",
        href: "/dashboard",
        icon: "M3 10.5 12 3l9 7.5M5.25 9.75V20.25h13.5V9.75",
        hint: "Números do dia e saúde do sistema",
      },
      {
        label: "Caixa de entrada",
        href: "/inbox",
        icon: "M20.25 8.5v8.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V8.5m16.5 0-8.25 5.25L3.75 8.5m16.5 0-8.25-5.25L3.75 8.5",
        hint: "Conversas do Instagram",
      },
      {
        label: "Contatos",
        href: "/contacts",
        icon: "M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0",
        hint: "Pessoas, histórico de envios e silenciar",
      },
    ],
  },
  {
    heading: "Automação",
    items: [
      {
        label: "Automações",
        href: "/campaigns",
        icon: "M13.5 3 4.5 13.5h6L10.5 21l9-10.5h-6L13.5 3Z",
        hint: "Palavra-chave no comentário ou no DM",
      },
      {
        label: "Análise",
        href: "/overview",
        icon: "M3.75 20.25h16.5M7.5 20.25V11.25m4.5 9V4.5m4.5 15.75v-6.75",
        hint: "Crescimento, cliques e CTR",
      },
      {
        label: "Registros",
        href: "/logs",
        icon: "M6 3.75h12v16.5H6V3.75Zm3 4.5h6m-6 3.75h6m-6 3.75h4",
        hint: "Cada envio, pulo e falha com o motivo",
      },
    ],
  },
  {
    heading: "Sistema",
    items: [
      {
        label: "Configurações",
        href: "/settings",
        icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2l-.3-2.5H10.2l-.3 2.5a7.5 7.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2 1.2l.3 2.5h3.6l.3-2.5a7.5 7.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z",
        hint: "Conexão, time e regras de automação",
      },
      {
        label: "Diagnóstico",
        href: "/diagnostics",
        icon: "M12 9v3.75m0 3.75h.008M12 3.75 2.25 20.25h19.5L12 3.75Z",
        hint: "Webhook, worker e fila",
      },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Fundo escuro no mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="px-6 py-5 border-b border-border">
          <Link href="/dashboard" className="text-base font-semibold">
            OpenReply
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {navGroups.map((group, index) => (
            <div key={group.heading ?? `grupo-${index}`} className="space-y-1">
              {group.heading && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => {
                const matches = AUTOMATION_ROUTES.includes(item.href)
                  ? AUTOMATION_ROUTES
                  : [item.href];
                const isActive = matches.some(
                  (href) => pathname === href || pathname.startsWith(href + "/")
                );
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    title={item.hint}
                    aria-current={isActive ? "page" : undefined}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded text-sm
                      ${
                        isActive
                          ? "bg-surface-hover text-foreground font-medium"
                          : "text-muted hover:text-foreground hover:bg-surface-hover"
                      }
                    `}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className={`h-[18px] w-[18px] shrink-0 ${
                        isActive ? "text-accent" : ""
                      }`}
                    >
                      <path d={item.icon} />
                    </svg>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">No seu servidor</p>
        </div>
      </aside>
    </>
  );
}
